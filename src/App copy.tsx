import { useEffect, useRef } from "react";
import {
  Scene,
  PerspectiveCamera,
  MeshStandardMaterial,
  Vector3,
  HemisphereLight,
  AmbientLight,
  DirectionalLight,
  PCFSoftShadowMap,
  Mesh,
} from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
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
     * Commented out FBX Loading
     * ------------------------------- */
    const fbxLoader = new FBXLoader();
    fbxLoader.load(
      "/地铁站max/地铁站max/XuZhouDTZ.fbx",
      (fbx) => {
        fbx.scale.set(0.1, 0.1, 0.1);

        fbx.traverse((child) => {
          if ((child as Mesh).isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
            (child as Mesh).material = new MeshStandardMaterial({
              color: 0xdddddd,
              metalness: 0.1,
              roughness: 0.6,
            });
          }
        });

        fbx.position.set(0, 0, 0);
        scene.add(fbx);

        console.log("FBX loaded:", fbx);
      },
      (xhr) => {
        console.log(`FBX loading: ${(xhr.loaded / xhr.total) * 100}%`);
      },
      (err) => {
        console.error("FBX load error:", err);
      }
    );

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

    const moveSpeed = 0.1;
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
      const delta = -e.deltaY * 0.002;

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
