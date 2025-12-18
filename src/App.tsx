import { useEffect, useRef, useState } from "react";
import {
  Scene,
  PerspectiveCamera,
  BoxGeometry,
  MeshStandardMaterial,
  Vector3,
  HemisphereLight,
  AmbientLight,
  DirectionalLight,
  PCFSoftShadowMap,
  InstancedMesh,
  Object3D,
  Group,
  Color
} from "three";
// 如果环境不支持 WebGPU，请改为 import { WebGLRenderer } from "three";
import { WebGPURenderer } from "three/webgpu"; 

/* -------------------------------
 * 1. 类型定义 (严格匹配你的 JSON)
 * ------------------------------- */
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

/* -------------------------------
 * 2. 配置项
 * ------------------------------- */
const CONFIG = {
  // 定义可见距离 [min, max]
  // Level 0: 0m ~ 60m
  // Level 1: 60m ~ 150m (如果你的JSON里有 "1" 层级)
  // Level 2: 150m ~ 2000m (如果你的JSON里有 "2" 层级)
  visibilityRanges: {
    0: [0, 60],
    1: [60, 150],
    2: [150, 600],
    3: [600, 2000] // 新增 LOD4 (level 3)
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
  
  // 状态引用
  const manifestRef = useRef<GlobalManifest | null>(null);
  const loadedChunksRef = useRef<Map<string, InstancedMesh>>(new Map());
  const loadingQueueRef = useRef<Set<string>>(new Set());

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
    // disable shadows for now to simplify rendering and improve performance
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    const worldGroup = new Group();
    scene.add(worldGroup);

    // --- Shared Geometry & Materials ---
    const geometry = new BoxGeometry(1, 1, 1);
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

        // 创建 InstancedMesh
        const mat = materials[level as unknown as keyof typeof materials] || materials[0];
        const mesh = new InstancedMesh(geometry, mat, count);
        
        // shadows disabled by global setting

        const dummy = new Object3D();
        const scale = voxelSize; 

        // 填充矩阵
        for (let i = 0; i < count; i++) {
          const x = positions[i * 3 + 0];
          const y = positions[i * 3 + 1];
          const z = positions[i * 3 + 2];
          
          dummy.position.set(x, y, z);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        
        mesh.instanceMatrix.needsUpdate = true;
        
        // 关键：禁止视锥体剔除，因为 InstancedMesh 默认包围盒计算可能不准，
        // 或者手动计算 mesh.geometry.boundingSphere。为简单起见先设为 false。
        mesh.frustumCulled = false;
        
        mesh.visible = true; // 加载完成后默认显示

        worldGroup.add(mesh);
        loadedChunksRef.current.set(uniqueKey, mesh);

      } catch (err) {
        console.warn(`Failed to load ${uniqueKey}:`, err);
      } finally {
        loadingQueueRef.current.delete(uniqueKey);
      }
    }

    /* -----------------------------------------------------------
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

    // --- Controls & Loop ---
    const { processInput, cleanup: cleanupControls } = setupControls(camera, mount);

    let frameId: number;
    async function animate() {
      await renderer.init();
      function loop() {
        processInput();
        renderer.render(scene, camera);
        frameId = requestAnimationFrame(loop);
      }
      loop();
    }
    animate();

    return () => {
      cancelAnimationFrame(frameId);
      intervalPromise.then(id => id && clearInterval(id));
      cleanupControls();
      mount.removeChild(renderer.domElement);
      // cleanup resources
      geometry.dispose();
      Object.values(materials).forEach(m => m.dispose());
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
        <div style={{marginTop: 5, color: '#aaa', fontSize: '0.9em'}}>
          WASD to Move | Arrows to Look | Shift to Boost
        </div>
      </div>
      <div ref={mountRef} style={{ width: "100vw", height: "100vh" }} />
    </>
  );
}

/* -----------------------------------------------------------
 * 辅助: 相机控制器
 * ----------------------------------------------------------- */
function setupControls(camera: PerspectiveCamera, mount: HTMLElement) {
  const keys: Record<string, boolean> = {};
  let yaw = 0;   // 左右旋转
  let pitch = 0; // 上下旋转

  const onKeyDown = (e: KeyboardEvent) => keys[e.key.toLowerCase()] = true;
  const onKeyUp = (e: KeyboardEvent) => keys[e.key.toLowerCase()] = false;

  const onMouseMove = (e: MouseEvent) => {
    if (e.buttons === 1) {
      yaw -= e.movementX * 0.005;
      pitch -= e.movementY * 0.005;
      pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  mount.addEventListener('mousemove', onMouseMove);

  return {
    processInput: () => {
      const speed = keys['shift'] ? 2.0 : 0.5;
      const rotSpeed = 0.03;

      // 旋转控制 (方向键)
      if (keys['arrowleft']) yaw += rotSpeed;
      if (keys['arrowright']) yaw -= rotSpeed;
      if (keys['arrowup']) pitch += rotSpeed;
      if (keys['arrowdown']) pitch -= rotSpeed;
      
      // 限制上下视角
      pitch = Math.max(-Math.PI/2, Math.min(Math.PI/2, pitch));

      camera.rotation.set(pitch, yaw, 0, 'YXZ');

      // 移动控制 (WASD)
      const dir = new Vector3();
      camera.getWorldDirection(dir);
      const forward = dir.clone();
      const right = new Vector3().crossVectors(dir, new Vector3(0, 1, 0)).normalize();

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