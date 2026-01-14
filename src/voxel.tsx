import { useEffect, useRef, useState } from "react";

// 矩阵辅助函数
function mat4Perspective(fov: number, aspect: number, near: number, far: number): Float32Array {
    const f = 1.0 / Math.tan(fov / 2);
    const rangeInv = 1.0 / (near - far);
    return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (near + far) * rangeInv, -1,
        0, 0, near * far * rangeInv * 2, 0
    ]);
}

function mat4LookAt(eye: Float32Array, target: Float32Array, up: Float32Array): Float32Array {
    const zAxis = new Float32Array([
        eye[0] - target[0],
        eye[1] - target[1],
        eye[2] - target[2]
    ]);
    normalize(zAxis);

    const xAxis = cross(up, zAxis);
    normalize(xAxis);

    const yAxis = cross(zAxis, xAxis);

    return new Float32Array([
        xAxis[0], yAxis[0], zAxis[0], 0,
        xAxis[1], yAxis[1], zAxis[1], 0,
        xAxis[2], yAxis[2], zAxis[2], 0,
        -dot(xAxis, eye), -dot(yAxis, eye), -dot(zAxis, eye), 1
    ]);
}

function normalize(v: Float32Array) {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len > 0) {
        v[0] /= len;
        v[1] /= len;
        v[2] /= len;
    }
}

function cross(a: Float32Array, b: Float32Array): Float32Array {
    return new Float32Array([
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ]);
}

function dot(a: Float32Array, b: Float32Array): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/* -----------------------------------------------------------
 * 辅助: 相机控制器（替换散碎的键鼠处理）
 * 返回 processInput() 与 cleanup()，用于在渲染循环中更新 cameraState
 * cameraState: { position: Float32Array, target: Float32Array, yaw:number, pitch:number }
 */
function setupControls(cameraState: { position: Float32Array; target: Float32Array; yaw: number; pitch: number }, canvas: HTMLCanvasElement) {
    const keys: Record<string, boolean> = {};

    const onKeyDown = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = true; };
    const onKeyUp = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false; };

    const onMouseMove = (e: MouseEvent) => {
        if (e.buttons === 1) {
            // moving mouse right should rotate camera to the right (increase yaw)
            cameraState.yaw += e.movementX * 0.005;
            // keep pitch sign so mouse up (negative movementY) increases pitch
            cameraState.pitch -= e.movementY * 0.005;
            cameraState.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraState.pitch));
        }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousemove', onMouseMove);

    function processInput() {
        const moveSpeed = keys['shift'] ? 0.6 : 0.3; // boost behavior similar to App
        const rotSpeed = 0.05;

        // keyboard look
        if (keys['arrowleft']) cameraState.yaw -= rotSpeed;
        if (keys['arrowright']) cameraState.yaw += rotSpeed;
        if (keys['arrowup']) cameraState.pitch += rotSpeed;
        if (keys['arrowdown']) cameraState.pitch -= rotSpeed;

        cameraState.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraState.pitch));

        // movement relative to yaw/pitch (forward uses yaw and pitch for incline)
        const forward = new Float32Array([
            Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch),
            Math.sin(cameraState.pitch),
            -Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch)
        ]);
        const right = new Float32Array([
            Math.cos(cameraState.yaw), 0, Math.sin(cameraState.yaw)
        ]);

        if (keys['w']) {
            cameraState.position[0] += forward[0] * moveSpeed;
            cameraState.position[1] += forward[1] * moveSpeed;
            cameraState.position[2] += forward[2] * moveSpeed;
        }
        if (keys['s']) {
            cameraState.position[0] -= forward[0] * moveSpeed;
            cameraState.position[1] -= forward[1] * moveSpeed;
            cameraState.position[2] -= forward[2] * moveSpeed;
        }
        if (keys['a']) {
            cameraState.position[0] -= right[0] * moveSpeed;
            cameraState.position[2] -= right[2] * moveSpeed;
        }
        if (keys['d']) {
            cameraState.position[0] += right[0] * moveSpeed;
            cameraState.position[2] += right[2] * moveSpeed;
        }
        if (keys['q']) cameraState.position[1] -= moveSpeed;
        if (keys['e']) cameraState.position[1] += moveSpeed;
    }

    function cleanup() {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        canvas.removeEventListener('mousemove', onMouseMove);
    }

    return { processInput, cleanup };
}

function App() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [debugInfo, setDebugInfo] = useState("Initializing WebGPU...");
    const [fps, setFps] = useState<number>(0);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        let animationId: number;
        let device: GPUDevice | undefined;
        let context: GPUCanvasContext | undefined;
        let cleanupControls: (() => void) | undefined;
        let wireframeEnabled = true;
        let isDestroyed = false;

        async function init() {
            // 1. 获取 WebGPU 适配器与设备
            if (!navigator.gpu) {
                setDebugInfo("WebGPU not supported!");
                return;
            }

            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) {
                setDebugInfo("Failed to get GPU adapter");
                return;
            }

            const requestedDevice = await adapter.requestDevice();
            if (isDestroyed) {
                requestedDevice.destroy();
                return;
            }
            device = requestedDevice;

            const ctx = canvas!.getContext("webgpu");
            if (!ctx) {
                setDebugInfo("Failed to get WebGPU context");
                return;
            }
            context = ctx;

            const format = navigator.gpu.getPreferredCanvasFormat();
            context.configure({
                device: device,
                format,
                alphaMode: "opaque"
            });

            setDebugInfo("WebGPU initialized, loading voxels...");

            // 2. 定义立方体几何（单位立方体）
            const vertices = new Float32Array([
                // 位置 (x,y,z) + 法线 (nx,ny,nz)
                // Front face
                -0.5, -0.5, 0.5, 0, 0, 1,
                0.5, -0.5, 0.5, 0, 0, 1,
                0.5, 0.5, 0.5, 0, 0, 1,
                -0.5, 0.5, 0.5, 0, 0, 1,
                // Back face
                -0.5, -0.5, -0.5, 0, 0, -1,
                -0.5, 0.5, -0.5, 0, 0, -1,
                0.5, 0.5, -0.5, 0, 0, -1,
                0.5, -0.5, -0.5, 0, 0, -1,
                // Top face
                -0.5, 0.5, -0.5, 0, 1, 0,
                -0.5, 0.5, 0.5, 0, 1, 0,
                0.5, 0.5, 0.5, 0, 1, 0,
                0.5, 0.5, -0.5, 0, 1, 0,
                // Bottom face
                -0.5, -0.5, -0.5, 0, -1, 0,
                0.5, -0.5, -0.5, 0, -1, 0,
                0.5, -0.5, 0.5, 0, -1, 0,
                -0.5, -0.5, 0.5, 0, -1, 0,
                // Right face
                0.5, -0.5, -0.5, 1, 0, 0,
                0.5, 0.5, -0.5, 1, 0, 0,
                0.5, 0.5, 0.5, 1, 0, 0,
                0.5, -0.5, 0.5, 1, 0, 0,
                // Left face
                -0.5, -0.5, -0.5, -1, 0, 0,
                -0.5, -0.5, 0.5, -1, 0, 0,
                -0.5, 0.5, 0.5, -1, 0, 0,
                -0.5, 0.5, -0.5, -1, 0, 0
            ]);

            const indices = new Uint16Array([
                0, 1, 2, 0, 2, 3,   // front
                4, 5, 6, 4, 6, 7,   // back
                8, 9, 10, 8, 10, 11,   // top
                12, 13, 14, 12, 14, 15,  // bottom
                16, 17, 18, 16, 18, 19,  // right
                20, 21, 22, 20, 22, 23   // left
            ]);

            // 2.5 定义立方体边框（12条边，不包含对角线）
            const edgeVertices = new Float32Array([
                // 8 个顶点（立方体的角）
                -0.5, -0.5, -0.5,  // 0
                 0.5, -0.5, -0.5,  // 1
                 0.5,  0.5, -0.5,  // 2
                -0.5,  0.5, -0.5,  // 3
                -0.5, -0.5,  0.5,  // 4
                 0.5, -0.5,  0.5,  // 5
                 0.5,  0.5,  0.5,  // 6
                -0.5,  0.5,  0.5,  // 7
            ]);

            const edgeIndices = new Uint16Array([
                // 底面4条边
                0, 1,  1, 2,  2, 3,  3, 0,
                // 顶面4条边
                4, 5,  5, 6,  6, 7,  7, 4,
                // 垂直4条边
                0, 4,  1, 5,  2, 6,  3, 7
            ]);

            // 3. 创建顶点缓冲
            const vertexBuffer = device.createBuffer({
                size: vertices.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(vertexBuffer, 0, vertices);

            const indexBuffer = device.createBuffer({
                size: indices.byteLength,
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(indexBuffer, 0, indices);

            // 3.5 创建边框缓冲
            const edgeVertexBuffer = device.createBuffer({
                size: edgeVertices.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(edgeVertexBuffer, 0, edgeVertices);

            const edgeIndexBuffer = device.createBuffer({
                size: edgeIndices.byteLength,
                usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(edgeIndexBuffer, 0, edgeIndices);

            // 4. 加载体素数据
            const voxelData = await loadVoxelBin('/platform_32x128x1.bin');
            if (!voxelData || voxelData.length === 0) {
                setDebugInfo("No voxels loaded");
                return;
            }

            setDebugInfo(`Loaded ${voxelData.length} voxels, creating buffers...`);

            // 5. 创建实例缓冲（每个实例：位置 vec3 + 缩放 float + 颜色 vec3）
            const instanceData = new Float32Array(voxelData.length * 8); // 3+1+3+1(padding)
            for (let i = 0; i < voxelData.length; i++) {
                const v = voxelData[i];
                instanceData[i * 8 + 0] = v.x;
                instanceData[i * 8 + 1] = v.y;
                instanceData[i * 8 + 2] = v.z;
                instanceData[i * 8 + 3] = v.scale;
                instanceData[i * 8 + 4] = v.color[0];
                instanceData[i * 8 + 5] = v.color[1];
                instanceData[i * 8 + 6] = v.color[2];
                instanceData[i * 8 + 7] = 0; // padding
            }

            const instanceBuffer = device.createBuffer({
                size: instanceData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            device.queue.writeBuffer(instanceBuffer, 0, instanceData);

            // 6. 创建 uniform 缓冲（相机矩阵 + 时间）
            const uniformBuffer = device.createBuffer({
                size: 160, // 64 * 2 (matrices) + 32 (time + padding aligned to 16/32)
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });

            const bindGroupLayout = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                        buffer: { type: 'uniform' }
                    },
                ]
            })

            const bindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    { binding: 0, resource: { buffer: uniformBuffer } }
                ]
            });

            // 7. 加载着色器
            const shaderCode = await fetch('/src/shader/voxel.wgsl').then(r => r.text())
            const shaderModule = device.createShaderModule({ code: shaderCode });

            // 7.1 加载线框着色器
            const wireShaderCode = await fetch('/src/shader/vlines.wgsl').then(r => r.text());
            const wireShaderModule = device.createShaderModule({ code: wireShaderCode });

            // 7.5 创建显式 PipelineLayout（使用之前定义的 bindGroupLayout）
            const pipelineLayout = device.createPipelineLayout({
                bindGroupLayouts: [bindGroupLayout]
            });

            // 8. 创建渲染管线（使用显式布局而非 "auto"）
            const pipeline = device.createRenderPipeline({
                layout: pipelineLayout,  // 使用显式布局，与 bindGroup 兼容
                vertex: {
                    module: shaderModule,
                    entryPoint: "vs_main",
                    buffers: [
                        {
                            arrayStride: 24, // 6 floats (pos + normal)
                            stepMode: 'vertex',
                            attributes: [
                                { shaderLocation: 0, offset: 0, format: "float32x3" },  // position
                                { shaderLocation: 1, offset: 12, format: "float32x3" }  // normal
                            ]
                        },
                        {
                            arrayStride: 32, // 8 floats per instance
                            stepMode: "instance",
                            attributes: [
                                { shaderLocation: 2, offset: 0, format: "float32x3" },   // instancePos
                                { shaderLocation: 3, offset: 12, format: "float32" },    // instanceScale
                                { shaderLocation: 4, offset: 16, format: "float32x3" }   // instanceColor
                            ]
                        }
                    ]
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: "fs_main",
                    targets: [{ format }]
                },
                primitive: {
                    topology: "triangle-list",
                    cullMode: "back"
                },
                depthStencil: {
                    depthWriteEnabled: true,
                    depthCompare: "less",
                    format: "depth24plus"
                }
            });

            // 8.5 创建线框渲染管线
            const wirePipeline = device.createRenderPipeline({
                layout: pipelineLayout,
                vertex: {
                    module: wireShaderModule,
                    entryPoint: "vs_main",
                    buffers: [
                        {
                            arrayStride: 12, // 3 floats (position only)
                            stepMode: 'vertex',
                            attributes: [
                                { shaderLocation: 0, offset: 0, format: "float32x3" }  // position
                            ]
                        },
                        {
                            arrayStride: 32, // 8 floats per instance
                            stepMode: "instance",
                            attributes: [
                                { shaderLocation: 1, offset: 0, format: "float32x3" },   // instancePos
                                { shaderLocation: 2, offset: 12, format: "float32" }     // instanceScale
                            ]
                        }
                    ]
                },
                fragment: {
                    module: wireShaderModule,
                    entryPoint: "fs_main",
                    targets: [{ format }]
                },
                primitive: {
                    topology: "line-list",
                    cullMode: "none"
                },
                depthStencil: {
                    depthWriteEnabled: false,
                    depthCompare: "less-equal",
                    format: "depth24plus"
                }
            });

            // 9. 创建深度纹理
            let depthTexture = device.createTexture({
                size: [canvas!.width, canvas!.height],
                format: "depth24plus",
                usage: GPUTextureUsage.RENDER_ATTACHMENT
            });

            // 10. 相机控制
            const cameraState = {
                position: new Float32Array([2,2, 10]),
                target: new Float32Array([0, 0, 0]),
                yaw: 0,
                pitch: 0
            };

            // 如果 caller 提供了 target，基于 target-position 计算初始 yaw/pitch，
            // 使相机初始朝向匹配 target（避免被默认的 yaw/pitch 覆盖为看向 -Z）
            (function initYawPitchFromTarget() {
                const dir = new Float32Array([
                    cameraState.target[0] - cameraState.position[0],
                    cameraState.target[1] - cameraState.position[1],
                    cameraState.target[2] - cameraState.position[2]
                ]);
                normalize(dir);
                // forward 实现为: [sin(yaw)*cos(pitch), sin(pitch), -cos(yaw)*cos(pitch)]
                // 所以 pitch = asin(forward.y)
                // yaw = atan2(forward.x, -forward.z)
                cameraState.pitch = Math.asin(Math.max(-1, Math.min(1, dir[1])));
                cameraState.yaw = Math.atan2(dir[0], -dir[2]);
            })();

            // setupControls will manage keyboard and mouse input and provide processInput/cleanup
            const controls = setupControls(cameraState, canvas!);
            const processInput = controls.processInput;
            cleanupControls = controls.cleanup;

            // 添加切换边框显示的按键监听
            const onToggleWireframe = (e: KeyboardEvent) => {
                if (e.repeat) return;
                if (e.key === 'Control') {
                    wireframeEnabled = !wireframeEnabled;
                }
            };
            window.addEventListener('keydown', onToggleWireframe);
            
            // 更新 cleanup 以移除边框切换监听
            const originalCleanup = cleanupControls;
            cleanupControls = () => {
                originalCleanup();
                window.removeEventListener('keydown', onToggleWireframe);
            };

            // FPS tracking
            let frameCount = 0;
            let lastFpsCalc = performance.now();

            // 11. 渲染循环
            function render() {
                if (isDestroyed || !device || !context) return;

                // 处理输入
                // processInput updates cameraState based on keyboard/mouse
                processInput();

                cameraState.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraState.pitch));

                // 计算 target
                cameraState.target[0] = cameraState.position[0] + Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch);
                cameraState.target[1] = cameraState.position[1] + Math.sin(cameraState.pitch);
                cameraState.target[2] = cameraState.position[2] - Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch);

                // 更新矩阵
                const projection = mat4Perspective(Math.PI / 4, canvas!.width / canvas!.height, 0.1, 1000);
                const view = mat4LookAt(cameraState.position, cameraState.target, new Float32Array([0, 1, 0]));

                device.queue.writeBuffer(uniformBuffer, 0, projection.buffer, projection.byteOffset, projection.byteLength);
                device.queue.writeBuffer(uniformBuffer, 64, view.buffer, view.byteOffset, view.byteLength);
                
                const time = performance.now() / 1000.0;
                // 写入 time (128) 和 padding (144)，共需 32 字节以对齐结构体结尾 (160)
                device.queue.writeBuffer(uniformBuffer, 128, new Float32Array([time, 0, 0, 0, 0, 0, 0, 0]));

                // 渲染
                const commandEncoder = device.createCommandEncoder();
                const textureView = context.getCurrentTexture().createView();

                const renderPass = commandEncoder.beginRenderPass({
                    colorAttachments: [{
                        view: textureView,
                        clearValue: { r: 0.1, g: 0.1, b: 0.15, a: 1.0 },
                        loadOp: "clear",
                        storeOp: "store"
                    }],
                    depthStencilAttachment: {
                        view: depthTexture.createView(),
                        depthClearValue: 1.0,
                        depthLoadOp: "clear",
                        depthStoreOp: "store"
                    }
                });

                renderPass.setPipeline(pipeline);
                renderPass.setBindGroup(0, bindGroup);
                renderPass.setVertexBuffer(0, vertexBuffer);
                renderPass.setVertexBuffer(1, instanceBuffer);
                renderPass.setIndexBuffer(indexBuffer, "uint16");
                renderPass.drawIndexed(indices.length, voxelData.length);
                
                // 绘制边框（如果启用）
                if (wireframeEnabled) {
                    renderPass.setPipeline(wirePipeline);
                    renderPass.setBindGroup(0, bindGroup);
                    renderPass.setVertexBuffer(0, edgeVertexBuffer);
                    renderPass.setVertexBuffer(1, instanceBuffer);
                    renderPass.setIndexBuffer(edgeIndexBuffer, "uint16");
                    renderPass.drawIndexed(edgeIndices.length, voxelData.length);
                }
                
                renderPass.end();

                device.queue.submit([commandEncoder.finish()]);

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

                animationId = requestAnimationFrame(render);
            }

            setDebugInfo(`Rendering ${voxelData.length} voxels with WebGPU`);
            render();
        }

        init();

        return () => {
            isDestroyed = true;
            if (animationId) cancelAnimationFrame(animationId);
            if (cleanupControls) {
                try { cleanupControls(); } catch (e) { /* ignore */ }
            }
            if (device) {
                device.destroy();
                device = undefined;
            }
        };
    }, []);

    // 加载体素二进制数据
    async function loadVoxelBin(url: string): Promise<Array<{ 
        x: number; y: number; z: number; 
        scale: number; 
        color: [number, number, number];
    }>> {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const buf = await resp.arrayBuffer();
            const view = new DataView(buf);

            const recordSize = 33;
            const count = Math.floor(buf.byteLength / recordSize);

            const voxels: Array<{ 
                x: number; y: number; z: number; 
                scale: number; 
                color: [number, number, number];
            }> = [];

            for (let i = 0; i < count; i++) {
                const base = i * recordSize;
                if (base + recordSize > buf.byteLength) continue;

                const filled = view.getUint8(base + 24) !== 0;
                if (!filled) continue;

                const cx = view.getFloat64(base + 0, true);
                const cy = view.getFloat64(base + 8, true);
                const cz = view.getFloat64(base + 16, true);

                voxels.push({
                    x: cx,
                    y: cy,
                    z: cz,
                    scale: 0.5,
                    color: [Math.random(), Math.random(), Math.random()]
                });
            }

            return voxels;
        } catch (err) {
            console.error("Failed to load voxel bin:", err);
            return [];
        }
    }

    return (
        <>
            <div style={{
                position: 'absolute', top: 10, left: 10, padding: 12,
                background: 'rgba(0,0,0,0.8)', color: '#0f0',
                fontFamily: 'monospace', pointerEvents: 'none', borderRadius: 4
            }}>
                <div>{debugInfo}</div>
                <div style={{ marginTop: 5, color: '#aaa', fontSize: '0.9em' }}>
                    WASD/QE to Move | Arrows to Look | Shift to Boost
                </div>
                <div style={{ marginTop: 5, color: '#aaa', fontSize: '0.9em' }}>
                    Ctrl to Toggle Wireframe
                </div>
                <div style={{ marginTop: 5, color: '#aaa', fontSize: '0.9em' }}>
                    FPS: {fps}
                </div>
            </div>
            <canvas ref={canvasRef} width={window.innerWidth} height={window.innerHeight} style={{ display: 'block' }} />
        </>
    );
}

export default App;