import { useEffect, useRef, useState } from "react";
import {
  Scene,
  PerspectiveCamera,
  MeshStandardMaterial,
  Vector3,
  AmbientLight,
  DirectionalLight,
  InstancedMesh,
  Group,
  Color,
  BufferGeometry,
  BufferAttribute,
  Mesh,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial
} from "three";
// 如果环境不支持 WebGPU,请改为 import { WebGLRenderer } from "three";
import { WebGPURenderer } from "three/webgpu";

type ChunkMeta = {
  file: string;
  x: number;
  y: number;
  z: number;
  count: number;
};

type LevelManifest = {
  voxel_size: number;
  chunk_physical_size: number;
  chunks: { [key: string]: ChunkMeta };
};

type GlobalManifest = {
  base_voxel_size: number;
  chunk_dimension: number;
  levels: { [key: string]: LevelManifest };
};


const CONFIG = {
  // 定义可见距离 [min, max]
  // Level 0: 0m ~ 60m
  // Level 1: 60m ~ 150m (如果你的JSON里有 "1" 层级)
  // Level 2: 150m ~ 2000m (如果你的JSON里有 "2" 层级)
  visibilityRanges: {
    0: [0, 150],
    1: [150, 300],
    2: [300, 2000],
    3: [2000, 60000] // 新增 LOD4 (level 3)
  },
  colors: {
    0: 0xffffff, // Level 0 颜色 (白色)
    1: 0xcccccc, // Level 1 颜色 (浅灰)
    2: 0x999999, // Level 2 颜色 (深灰)
    3: 0x666666  // Level 3 颜色 (更深的灰)
  },
  checkInterval: 200, // LOD 检测频率 (ms)
};

function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [debugInfo, setDebugInfo] = useState("Initializing...");
  const [fps, setFps] = useState<number>(0);

  // 状态引用
  const manifestRef = useRef<GlobalManifest | null>(null);
  const loadedChunksRef = useRef<Map<string, InstancedMesh>>(new Map());
  const loadingQueueRef = useRef<Set<string>>(new Set());
  // toggles
  const wireframeEnabledRef = useRef<boolean>(true);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    // --- Scene Setup ---
    const scene = new Scene();
    scene.background = new Color(0x202020);

    const camera = new PerspectiveCamera(75, mount.clientWidth / mount.clientHeight, 0.1, 3000);
    camera.position.set(50, 50, 50); // 初始位置

    const renderer = new WebGPURenderer({ antialias: true });
    renderer.setSize(mount.clientWidth, mount.clientHeight);

    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    const worldGroup = new Group();
    scene.add(worldGroup);

    // --- Shared Geometry & Materials ---
    const materials: { [key: number]: MeshStandardMaterial } = {
      0: new MeshStandardMaterial({ color: CONFIG.colors[0], roughness: 0.8 }),
      1: new MeshStandardMaterial({ color: CONFIG.colors[1], roughness: 0.9 }),
      2: new MeshStandardMaterial({ color: CONFIG.colors[2], roughness: 1.0 }),
      3: new MeshStandardMaterial({ color: CONFIG.colors[3], roughness: 1.0 }), // LOD4 material
    };

    /* -----------------------------------------------------------
     * 核心逻辑: 加载单个区块
     * ----------------------------------------------------------- */
    async function loadChunkMesh(level: string, chunkId: string, meta: ChunkMeta, voxelSize: number) {
      const uniqueKey = `${level}_${chunkId}`;

      // 防止重复加载
      if (loadingQueueRef.current.has(uniqueKey)) return;
      loadingQueueRef.current.add(uniqueKey);

      try {
        const url = `/chunks/${level}/${meta.file}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const buffer = await res.arrayBuffer();
        const positions = new Float32Array(buffer);
        const count = positions.length / 3;

        // 构建体素集合用于邻接检测
        const voxelSet = new Set<string>();
        const voxelList: { x: number; y: number; z: number }[] = [];
        
        for (let i = 0; i < count; i++) {
          const x = positions[i * 3 + 0];
          const y = positions[i * 3 + 1];
          const z = positions[i * 3 + 2];
          const key = `${x},${y},${z}`;
          voxelSet.add(key);
          voxelList.push({ x, y, z });
        }

        // 为每个体素生成可见面
        const vertices: number[] = [];
        const normals: number[] = [];
        const indices: number[] = [];
        
        const halfSize = voxelSize / 2;
        
        // 六个面的定义：法线、顶点偏移
        const faces = [
          // Right (+X)
          { normal: [1, 0, 0], vertices: [
            [halfSize, -halfSize, -halfSize], [halfSize, halfSize, -halfSize],
            [halfSize, halfSize, halfSize], [halfSize, -halfSize, halfSize]
          ], check: [voxelSize, 0, 0] },
          // Left (-X)
          { normal: [-1, 0, 0], vertices: [
            [-halfSize, -halfSize, halfSize], [-halfSize, halfSize, halfSize],
            [-halfSize, halfSize, -halfSize], [-halfSize, -halfSize, -halfSize]
          ], check: [-voxelSize, 0, 0] },
          // Top (+Y)
          { normal: [0, 1, 0], vertices: [
            [-halfSize, halfSize, -halfSize], [-halfSize, halfSize, halfSize],
            [halfSize, halfSize, halfSize], [halfSize, halfSize, -halfSize]
          ], check: [0, voxelSize, 0] },
          // Bottom (-Y)
          { normal: [0, -1, 0], vertices: [
            [-halfSize, -halfSize, halfSize], [-halfSize, -halfSize, -halfSize],
            [halfSize, -halfSize, -halfSize], [halfSize, -halfSize, halfSize]
          ], check: [0, -voxelSize, 0] },
          // Front (+Z)
          { normal: [0, 0, 1], vertices: [
            [-halfSize, -halfSize, halfSize], [halfSize, -halfSize, halfSize],
            [halfSize, halfSize, halfSize], [-halfSize, halfSize, halfSize]
          ], check: [0, 0, voxelSize] },
          // Back (-Z)
          { normal: [0, 0, -1], vertices: [
            [halfSize, -halfSize, -halfSize], [-halfSize, -halfSize, -halfSize],
            [-halfSize, halfSize, -halfSize], [halfSize, halfSize, -halfSize]
          ], check: [0, 0, -voxelSize] }
        ];

        for (const voxel of voxelList) {
          for (const face of faces) {
            // 检查邻居是否存在
            const neighborKey = `${voxel.x + face.check[0]},${voxel.y + face.check[1]},${voxel.z + face.check[2]}`;
            
            if (!voxelSet.has(neighborKey)) {
              // 该面未被遮挡，添加到几何体
              // 重要：每个面使用独立的顶点索引，不共享顶点，这样边框才能正确显示
              const startIndex = vertices.length / 3;
              
              for (const v of face.vertices) {
                vertices.push(voxel.x + v[0], voxel.y + v[1], voxel.z + v[2]);
                normals.push(face.normal[0], face.normal[1], face.normal[2]);
              }
              
              // 两个三角形组成一个面
              indices.push(
                startIndex, startIndex + 1, startIndex + 2,
                startIndex, startIndex + 2, startIndex + 3
              );
            }
          }
        }

        if (vertices.length === 0) {
          // 没有可见面（不太可能发生）
          loadingQueueRef.current.delete(uniqueKey);
          return;
        }

        // 创建合并的几何体
        const mergedGeometry = new BufferGeometry();
        mergedGeometry.setAttribute('position', new BufferAttribute(new Float32Array(vertices), 3));
        mergedGeometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
        mergedGeometry.setIndex(indices);

        // 创建材质和网格
        const mat = materials[level as unknown as keyof typeof materials] || materials[0];
        const mesh = new Mesh(mergedGeometry, mat);
        mesh.frustumCulled = false;

        // 创建边框 - 使用角度阈值为0来显示所有边,包括共面的边
        // 这样每个体素面都会有独立的边框
        const edges = new EdgesGeometry(mergedGeometry, 0);
        const wireMat = new LineBasicMaterial({ color: 0x000000 });
        const wireframe = new LineSegments(edges, wireMat);
        wireframe.visible = wireframeEnabledRef.current;
        
        mesh.add(wireframe);
        (mesh as any).userData.wire = wireframe;

        mesh.visible = true;
        worldGroup.add(mesh);
        loadedChunksRef.current.set(uniqueKey, mesh as any);

      } catch (err) {
        console.warn(`Failed to load ${uniqueKey}:`, err);
      } finally {
        loadingQueueRef.current.delete(uniqueKey);
      }
    }    /* -----------------------------------------------------------
     * 核心逻辑: LOD 循环检测
     * ----------------------------------------------------------- */
    function updateLOD() {
      if (!manifestRef.current) return;

      const levels = manifestRef.current.levels;
      const cameraPos = camera.position;

      // 统计数据用于 Debug
      let visibleChunks = 0;
      let loadedCount = loadedChunksRef.current.size;

      // 遍历 manifest 中的每一层 (0, 1, 2...)
      Object.keys(levels).forEach((levelKey) => {
        const levelData = levels[levelKey];
        if (!levelData || !levelData.chunks) return;

        const levelNum = parseInt(levelKey);
        // 获取该层级的可视范围，如果没有定义则默认不显示
        const range = CONFIG.visibilityRanges[levelNum as keyof typeof CONFIG.visibilityRanges];
        if (!range) return;
        const [minDist, maxDist] = range;

        const halfSize = levelData.chunk_physical_size / 2;

        // 遍历该层级下的所有区块
        Object.entries(levelData.chunks).forEach(([chunkId, meta]) => {
          const uniqueKey = `${levelKey}_${chunkId}`;

          // 计算距离：相机 <-> 区块中心
          const dist = Math.sqrt(
            (cameraPos.x - (meta.x + halfSize)) ** 2 +
            (cameraPos.y - (meta.y + halfSize)) ** 2 +
            (cameraPos.z - (meta.z + halfSize)) ** 2
          );

          // 判断是否在范围内
          const shouldBeVisible = dist >= minDist && dist < maxDist;
          const mesh = loadedChunksRef.current.get(uniqueKey);

          if (shouldBeVisible) {
            visibleChunks++;
            if (mesh) {
              mesh.visible = true;
            } else {
              // 还没加载，现在去加载
              loadChunkMesh(levelKey, chunkId, meta, levelData.voxel_size);
            }
          } else {
            // 超出范围，隐藏
            if (mesh) {
              mesh.visible = false;
            }
          }
        });
      });

      setDebugInfo(`Chunks: ${loadedCount} loaded / ${visibleChunks} visible`);
    }

    /* -----------------------------------------------------------
     * 初始化
     * ----------------------------------------------------------- */
    async function init() {
      try {
        setDebugInfo("Fetching manifest...");
        const res = await fetch('/chunks/manifest.json');
        if (!res.ok) throw new Error("Manifest not found");

        const manifest: GlobalManifest = await res.json();

        // 简单校验
        if (!manifest.levels || !manifest.levels["0"]) {
          throw new Error("Manifest is valid but contains no levels.");
        }

        manifestRef.current = manifest;
        setDebugInfo("Manifest loaded. Starting engine...");

        // 启动 LOD 检测循环
        const interval = setInterval(updateLOD, CONFIG.checkInterval);
        return interval;

      } catch (e: any) {
        setDebugInfo(`Error: ${e.message}`);
        console.error(e);
      }
    }

    const intervalPromise = init();

    // --- Lights ---
    const ambient = new AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const dirLight = new DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(100, 200, 100);
    // disable shadows on the directional light for now
    dirLight.castShadow = false;
    scene.add(dirLight);

    // --- Wireframe toggle and Collision toggle ---
    function applyWireframeVisibility(enabled: boolean) {
      for (const mesh of loadedChunksRef.current.values()) {
        const wire = (mesh as any).userData?.wire as LineSegments | undefined;
        if (wire) wire.visible = enabled;
      }
    }

    const onToggleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Control') {
        wireframeEnabledRef.current = !wireframeEnabledRef.current;
        applyWireframeVisibility(wireframeEnabledRef.current);
      }
    };
    window.addEventListener('keydown', onToggleKeyDown);

    // --- Controls & Loop ---
    const { processInput, cleanup: cleanupControls } = setupControls(camera, mount);

    let frameId: number;
    // FPS tracking
    let frameCount = 0;
    let lastFpsCalc = performance.now();
    async function animate() {
      await renderer.init();
      function loop() {
        processInput();
        renderer.render(scene, camera);

        // FPS calculation (updates every 500ms)
        frameCount++;
        const now = performance.now();
        const delta = now - lastFpsCalc;
        if (delta >= 500) {
          const currentFps = (frameCount / delta) * 1000;
          setFps(Math.round(currentFps));
          frameCount = 0;
          lastFpsCalc = now;
        }

        frameId = requestAnimationFrame(loop);
      }
      loop();
    }
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      intervalPromise.then(id => id && clearInterval(id));
      cleanupControls();
      window.removeEventListener('keydown', onToggleKeyDown);
      mount.removeChild(renderer.domElement);
      // cleanup resources
      Object.values(materials).forEach(m => m.dispose());
      // cleanup geometries
      for (const mesh of loadedChunksRef.current.values()) {
        if ((mesh as Mesh).geometry) {
          (mesh as Mesh).geometry.dispose();
        }
        const wire = (mesh as any).userData?.wire;
        if (wire && wire.geometry) {
          wire.geometry.dispose();
        }
        if (wire && wire.material) {
          wire.material.dispose();
        }
      }
    };
  }, []);

  return (
    <>
      <div style={{
        position: 'absolute', top: 10, left: 10, padding: 12,
        background: 'rgba(0,0,0,0.8)', color: '#0f0',
        fontFamily: 'monospace', pointerEvents: 'none', borderRadius: 4
      }}>
        <div>System: {debugInfo}</div>
        <div style={{ marginTop: 5, color: '#aaa', fontSize: '0.9em' }}>
          WASD to Move | Arrows to Look | Shift to Boost
        </div>
        <div style={{ marginTop: 5, color: '#aaa', fontSize: '0.9em' }}>
          FPS: {fps}
        </div>
      </div>
      <div ref={mountRef} style={{ width: "100vw", height: "100vh" }} />
    </>
  );
}

/* -----------------------------------------------------------
 * 辅助: 相机控制器
 * ----------------------------------------------------------- */
function setupControls(
  camera: PerspectiveCamera,
  mount: HTMLElement
) {
  const keys: Record<string, boolean> = {};
  let yaw = 0;   // 左右旋转
  let pitch = 0; // 上下旋转

  const onKeyDown = (e: KeyboardEvent) => keys[e.key.toLowerCase()] = true;
  const onKeyUp = (e: KeyboardEvent) => keys[e.key.toLowerCase()] = false;

  const onMouseMove = (e: MouseEvent) => {
    if (e.buttons === 1) {
      yaw -= e.movementX * 0.005;
      pitch -= e.movementY * 0.005;
      pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  mount.addEventListener('mousemove', onMouseMove);

  return {
    processInput: () => {
      const speed = keys['shift'] ? 2.0 : 0.2;
      const rotSpeed = 0.03;

      // 旋转控制 (方向键)
      if (keys['arrowleft']) yaw += rotSpeed;
      if (keys['arrowright']) yaw -= rotSpeed;
      if (keys['arrowup']) pitch += rotSpeed;
      if (keys['arrowdown']) pitch -= rotSpeed;

      // 限制上下视角
      pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));

      camera.rotation.set(pitch, yaw, 0, 'YXZ');

      // 移动控制 (WASD)
      const dir = new Vector3();
      camera.getWorldDirection(dir);
      const forward = dir.clone();
      const right = new Vector3().crossVectors(dir, new Vector3(0, 1, 0)).normalize();

      // Apply movement directly without collision
      if (keys['w']) camera.position.addScaledVector(forward, speed);
      if (keys['s']) camera.position.addScaledVector(forward, -speed);
      if (keys['a']) camera.position.addScaledVector(right, -speed);
      if (keys['d']) camera.position.addScaledVector(right, speed);
      if (keys['q']) camera.position.y -= speed;
      if (keys['e']) camera.position.y += speed;
    },
    cleanup: () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      mount.removeEventListener('mousemove', onMouseMove);
    }
  };
}

export default App;