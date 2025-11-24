import { useEffect, useRef } from "react";
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
  Color,
} from "three";
import { WebGPURenderer } from "three/webgpu";

function App() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    /* -------------------------------
     * Scene / Camera / Renderer
     * ------------------------------- */
    const scene = new Scene();
    const camera = new PerspectiveCamera(
      75,
      mount.clientWidth / mount.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 1, 5);

    const renderer = new WebGPURenderer();
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    /* -------------------------------
     * Dynamic LOD Voxel System for Performance
     * ------------------------------- */
    
    // LOD配置
    const LOD_CONFIG = {
      maxRenderDistance: 200,    // 最大渲染距离
      lodDistances: [20, 50, 100, 200], // LOD级别距离
      lodSampleRates: [1, 4, 16, 64],   // 采样率 (1=全部, 4=每4个取1个)
      maxInstancesPerFrame: 50000,      // 每帧最大实例数
      voxelSize: 0.5
    };

    const allVoxels: Array<{x: number, y: number, z: number}> = [];
    let currentLODMeshes: InstancedMesh[] = [];
    const lastCameraPosition = new Vector3();
    let frameCount = 0;

    async function loadVoxelData(url: string) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const view = new DataView(buf);
        
        const recordSize = 49;
        const count = Math.floor(buf.byteLength / recordSize);
        
        console.log(`Loading ${count} voxels...`);
        
        // 只存储体素位置，不立即渲染
        for (let i = 0; i < count; i++) {
          const base = i * recordSize;
          if (base + recordSize > buf.byteLength) continue;
          
          const filled = view.getUint8(base + 24);
          if (!filled) continue;
          
          const x = view.getFloat64(base + 0, true);
          const y = view.getFloat64(base + 8, true);
          const z = view.getFloat64(base + 16, true);
          
          allVoxels.push({x, y, z});
        }
        
        console.log(`Loaded ${allVoxels.length} filled voxels`);
        
        // 初始渲染
        updateLODRendering();
        
      } catch (err) {
        console.error('Failed to load voxel data:', err);
      }
    }

    function updateLODRendering() {
      const camPos = camera.position;
      
      // 清理旧的mesh
      currentLODMeshes.forEach(mesh => {
        scene.remove(mesh);
        mesh.dispose();
      });
      currentLODMeshes = [];

      const geometry = new BoxGeometry(LOD_CONFIG.voxelSize, LOD_CONFIG.voxelSize, LOD_CONFIG.voxelSize);
      const material = new MeshStandardMaterial({ 
        metalness: 0.05, 
        roughness: 0.8 
      });

      // 按LOD级别分组
      const lodGroups: Array<{x: number, y: number, z: number}[]> = [[], [], [], []];
      let totalProcessed = 0;

      for (const voxel of allVoxels) {
        const dist = camPos.distanceTo(new Vector3(voxel.x, voxel.y, voxel.z));
        
        if (dist > LOD_CONFIG.maxRenderDistance) continue;
        
        // 确定LOD级别
        let lodLevel = 0;
        for (let i = 0; i < LOD_CONFIG.lodDistances.length; i++) {
          if (dist < LOD_CONFIG.lodDistances[i]) {
            lodLevel = i;
            break;
          }
        }
        
        // 采样控制
        const sampleRate = LOD_CONFIG.lodSampleRates[lodLevel];
        if (totalProcessed % sampleRate !== 0) {
          totalProcessed++;
          continue;
        }
        
        lodGroups[lodLevel].push(voxel);
        totalProcessed++;
        
        // 限制总实例数
        const currentTotal = lodGroups.reduce((sum, group) => sum + group.length, 0);
        if (currentTotal >= LOD_CONFIG.maxInstancesPerFrame) break;
      }

      // 为每个LOD级别创建InstancedMesh
      lodGroups.forEach((group, lodLevel) => {
        if (group.length === 0) return;
        
        const instanced = new InstancedMesh(geometry, material, group.length);
        const dummy = new Object3D();
        const color = new Color();
        
        // 根据LOD级别设置不同颜色
        const lodColors = [0xffffff, 0xcccccc, 0x999999, 0x666666];
        
        group.forEach((voxel, index) => {
          dummy.position.set(voxel.x, voxel.y, voxel.z);
          dummy.updateMatrix();
          instanced.setMatrixAt(index, dummy.matrix);
          
          color.setHex(lodColors[lodLevel]);
          instanced.setColorAt(index, color);
        });
        
        instanced.instanceMatrix.needsUpdate = true;
        instanced.instanceColor!.needsUpdate = true;
        
        scene.add(instanced);
        currentLODMeshes.push(instanced);
      });

      const totalRendered = lodGroups.reduce((sum, group) => sum + group.length, 0);
      const lodInfo = lodGroups.map((group, i) => `LOD${i}: ${group.length}`).join(', ');
      console.log(`LOD Update: Rendered ${totalRendered}/${allVoxels.length} voxels (${lodInfo})`);
    }



    // 加载体素数据
    loadVoxelData('/voxel(3).bin');
    /* -------------------------------
     * Add Lighting
     * ------------------------------- */
    const ambient = new AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    /* 半球光，上方偏蓝，下方偏暖 */
    const hemiLight = new HemisphereLight(0xffffff, 0x444444, 0.8);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight = new DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(5, 10, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    /* -------------------------------
     * Enable Shadows in WebGPURenderer
     * ------------------------------- */
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;

    /* -------------------------------
     * Camera Controls
     * ------------------------------- */
    const { processKeyboardMovement, cleanup: cleanupCameraControls } =
      setupCameraControls(camera, mount);

    /* -------------------------------
     * Animation Loop with LOD Updates
     * ------------------------------- */
    async function initAndAnimate() {
      await renderer.init();

      function animate() {
        processKeyboardMovement();
        
        // 每30帧或相机移动超过阈值时更新LOD
        frameCount++;
        const cameraMoved = lastCameraPosition.distanceTo(camera.position) > 5;
        
        if (frameCount % 30 === 0 || cameraMoved) {
          updateLODRendering();
          lastCameraPosition.copy(camera.position);
        }
        
        renderer.render(scene, camera);
        requestAnimationFrame(animate);
      }

      animate();
    }

    initAndAnimate();

    /* -------------------------------
     * Cleanup
     * ------------------------------- */
    return () => {
      cleanupCameraControls();
      mount.removeChild(renderer.domElement);
    };
  }, []);

  /* -------------------------------
   * Camera Control Logic
   * ------------------------------- */
  function setupCameraControls(camera: PerspectiveCamera, mount: HTMLDivElement) {
    let isMouseDown = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    let yaw = 0;
    let pitch = 0;

    const moveSpeed = 0.5;
    const keysPressed: Record<string, boolean> = {};

    /* --- Mouse drag to look --- */
    function onMouseDown(e: MouseEvent) {
      isMouseDown = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    }

    function onMouseUp() {
      isMouseDown = false;
    }

    function onMouseMove(e: MouseEvent) {
      if (!isMouseDown) return;

      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;

      lastMouseX = e.clientX;
      lastMouseY = e.clientY;

      const sensitivity = 0.002;

      yaw -= dx * sensitivity;
      pitch -= dy * sensitivity;

      const maxPitch = Math.PI / 2 - 0.1;
      pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));

      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    }

    /* --- Scroll forward/backward --- */
    function onWheel(e: WheelEvent) {
      const delta = -e.deltaY * 0.02;

      const forward = new Vector3();
      camera.getWorldDirection(forward);
      camera.position.addScaledVector(forward, delta);
    }

    /* --- Keyboard --- */
    function onKeyDown(e: KeyboardEvent) {
      keysPressed[e.key.toLowerCase()] = true;
    }

    function onKeyUp(e: KeyboardEvent) {
      keysPressed[e.key.toLowerCase()] = false;
    }

    function processKeyboardMovement() {
      const forward = new Vector3();
      const up = new Vector3(0, 1, 0);

      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      const right = new Vector3();
      right.crossVectors(forward, new Vector3(0, 1, 0)).normalize();

      // 上下平移
      if (keysPressed["w"]) camera.position.addScaledVector(up, moveSpeed);
      if (keysPressed["s"]) camera.position.addScaledVector(up, -moveSpeed);

      // 左右旋转摄像头
      if (keysPressed["a"]) yaw += moveSpeed / 5;
      if (keysPressed["d"]) yaw -= moveSpeed / 5;

      // 左右平移
      if (keysPressed["arrowleft"]) camera.position.addScaledVector(right, -moveSpeed);
      if (keysPressed["arrowright"]) camera.position.addScaledVector(right, moveSpeed);

      // 前后移动
      if (keysPressed["arrowup"]) camera.translateZ(-moveSpeed);
      if (keysPressed["arrowdown"]) camera.translateZ(moveSpeed);

      camera.rotation.y = yaw;
    }

    /* --- Register events --- */
    mount.addEventListener("mousedown", onMouseDown);
    mount.addEventListener("mouseup", onMouseUp);
    mount.addEventListener("mousemove", onMouseMove);
    mount.addEventListener("wheel", onWheel);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return {
      processKeyboardMovement,
      cleanup: () => {
        mount.removeEventListener("mousedown", onMouseDown);
        mount.removeEventListener("mouseup", onMouseUp);
        mount.removeEventListener("mousemove", onMouseMove);
        mount.removeEventListener("wheel", onWheel);

        window.removeEventListener("keydown", onKeyDown);
        window.removeEventListener("keyup", onKeyUp);
      },
    };
  }

  return <div ref={mountRef} style={{ width: "100vw", height: "100vh" }} />;
}

export default App;
