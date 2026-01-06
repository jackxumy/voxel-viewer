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
     * Voxel bin -> Instanced cubes
     * ------------------------------- */
    async function buildVoxelsFromBin(url: string) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buf = await resp.arrayBuffer();
        const view = new DataView(buf);
        console.log(buf.byteLength)
        // 根据新的 Python voxel_dtype 结构计算记录大小
        // cx(float64=8) + cy(float64=8) + cz(float64=8) + filled(bool=1) + neighbors(6*int32=24) = 49 bytes
        const recordSize = 49;

        // 字段偏移（与新的 Python voxel_dtype 一致）
        const offCx = 0;         // float64
        const offCy = 8;         // float64
        const offCz = 16;        // float64
        const offFilled = 24;    // bool (1 byte)
        // neighbors 从偏移 25 开始，包含 6 * int32 = 24 bytes，但此处不使用

        // 首先扫描所有记录以确定网格尺寸
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        
        // 修复 count 的计算，确保为整数
        const count = Math.floor(buf.byteLength / recordSize);
        console.log(buf.byteLength / recordSize)
        // 添加边界检查，确保偏移量不会超出缓冲区范围
        for (let i = 0; i < count; i++) {
          const base = i * recordSize;
          if (base + recordSize > buf.byteLength) {
            console.warn(`Skipping record at index ${i} due to out-of-bounds access`);
            continue;
          }

          const cx = view.getFloat64(base + offCx, true);
          const cy = view.getFloat64(base + offCy, true);
          const cz = view.getFloat64(base + offCz, true);

          minX = Math.min(minX, cx);
          minY = Math.min(minY, cy);
          minZ = Math.min(minZ, cz);
          maxX = Math.max(maxX, cx);
          maxY = Math.max(maxY, cy);
          maxZ = Math.max(maxZ, cz);
        }

        // 确保 voxelSize 在计算网格维度之前定义
        const voxelSize = 0.5; // 与 Python VOXEL_SIZE 一致

        // 修复网格维度计算，改为直接查找最后一个体素的 xyz
        const lastBase = (count - 1) * recordSize;
        const lastCx = view.getFloat64(lastBase + offCx, true);
        const lastCy = view.getFloat64(lastBase + offCy, true);
        const lastCz = view.getFloat64(lastBase + offCz, true);

        const nx = Math.round((lastCx - minX) / voxelSize) + 1;
        const ny = Math.round((lastCy - minY) / voxelSize) + 1;
        const nz = Math.round((lastCz - minZ) / voxelSize) + 1;

        console.log(`Grid dimensions: ${nx} x ${ny} x ${nz}`);
        console.log(`Grid bounds: X[${minX},${maxX}] Y[${minY},${maxY}] Z[${minZ},${maxZ}]`);

        // 统计 filled voxel 数量
        let filledCount = 0;
        for (let i = 0; i < count; i++) {
          const base = i * recordSize;
          const filled = view.getUint8(base + offFilled) !== 0;
          if (filled) filledCount++;
        }
        
        console.log(`Found ${filledCount} filled voxels out of ${count} total voxels`);
        
        if (filledCount === 0) {
          console.warn('No filled voxels to render');
          return;
        }

        // 创建 InstancedMesh
        const geometry = new BoxGeometry(voxelSize, voxelSize, voxelSize);
        const material = new MeshStandardMaterial({ 
          metalness: 0.05, 
          roughness: 0.8 
        });
        const instanced = new InstancedMesh(geometry, material, filledCount);
        instanced.castShadow = true;
        instanced.receiveShadow = true;

        // 创建颜色属性
        const color = new Color();

        // 填充实例矩阵和颜色
        const dummy = new Object3D();
        let instanceIdx = 0;

        for (let i = 0; i < count; i++) {
          const base = i * recordSize;
          const filled = view.getUint8(base + offFilled) !== 0;
          if (!filled) continue;

          const cx = view.getFloat64(base + offCx, true);
          const cy = view.getFloat64(base + offCy, true);
          const cz = view.getFloat64(base + offCz, true);

          // 使用 cx, cy, cz 作为世界坐标
          dummy.position.set(cx, cy, cz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          instanced.setMatrixAt(instanceIdx, dummy.matrix);

          // 为每个实例生成随机颜色
          color.setHex(Math.random() * 0xffffff);
          instanced.setColorAt(instanceIdx, color);

          instanceIdx++;
        }

        instanced.instanceMatrix.needsUpdate = true;
        instanced.instanceColor!.needsUpdate = true;
        scene.add(instanced);

        console.log(`Successfully rendered ${instanceIdx} voxel instances`);
        
      } catch (err) {
        console.error('Failed to build voxels from bin:', err);
      }
    }



    // NOTE: ensure the bin is placed at `voxel-app/public/voxels.bin` so it is served at `/voxels.bin`.
    buildVoxelsFromBin('/voxel.bin');

    /* -------------------------------
     * (FBX loading is intentionally commented out)
     * ------------------------------- */
    // const fbxLoader = new FBXLoader();
    // fbxLoader.load(
    //   "/地铁站max/地铁站max/XuZhouDTZ.fbx",
    //   (fbx) => {
    //     fbx.scale.set(0.1, 0.1, 0.1);

    //     fbx.traverse((child) => {
    //       if ((child as Mesh).isMesh) {
    //         child.castShadow = true;
    //         child.receiveShadow = true;
    //         (child as Mesh).material = new MeshStandardMaterial({
    //           color: 0xdddddd,
    //           metalness: 0.1,
    //           roughness: 0.6,
    //         });
    //       }
    //     });

    //     fbx.position.set(0, 0, 0);
    //     scene.add(fbx);

    //     console.log("FBX loaded:", fbx);
    //   },
    //   (xhr) => {
    //     console.log(`FBX loading: ${(xhr.loaded / xhr.total) * 100}%`);
    //   },
    //   (err) => {
    //     console.error("FBX load error:", err);
    //   }
    // );

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
     * Animation Loop
     * ------------------------------- */
    async function initAndAnimate() {
      await renderer.init();

      function animate() {
        processKeyboardMovement();
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

      if (keysPressed["w"]) camera.position.addScaledVector(up, moveSpeed);
      if (keysPressed["s"]) camera.position.addScaledVector(up, -moveSpeed);

      const right = new Vector3();
      right.crossVectors(forward, new Vector3(0, 1, 0)).normalize();

      if (keysPressed["a"]) camera.position.addScaledVector(right, -moveSpeed);
      if (keysPressed["d"]) camera.position.addScaledVector(right, moveSpeed);

      // New arrow key functionality
      if (keysPressed["arrowup"]) camera.translateZ(-moveSpeed); // Move forward
      if (keysPressed["arrowdown"]) camera.translateZ(moveSpeed); // Move backward
      if (keysPressed["arrowleft"]) yaw += moveSpeed / 5; // Turn left
      if (keysPressed["arrowright"]) yaw -= moveSpeed / 5; // Turn right

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
