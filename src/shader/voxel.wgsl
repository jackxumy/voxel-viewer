struct Uniforms {
    projection: mat4x4<f32>,
    view: mat4x4<f32>,
    time: f32,
    padding: vec3<f32>,
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) instancePos: vec3<f32>,
    @location(3) instanceScale: f32,
    @location(4) instanceColor: vec3<f32>,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) worldPos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec3<f32>
}

fn gerstnerWave(pos: vec3<f32>, time: f32) -> vec3<f32> {
    var p = pos;
    // 波浪参数：振幅，波长，速度，方向X
    let waves = array<vec4<f32>, 3>(
        vec4<f32>(0.2, 8.0, 1.2, 1.0),
        vec4<f32>(0.1, 4.0, 2.0, 0.5),
        vec4<f32>(0.05, 2.0, 3.0, -0.7)
    );

    for (var i = 0u; i < 3u; i = i + 1u) {
        let w = waves[i];
        let amp = w.x;
        let wl = w.y;
        let speed = w.z;
        let d = normalize(vec2<f32>(w.w, sqrt(1.0 - w.w * w.w)));
        
        let freq = 2.0 / wl;
        let phase = speed * freq;
        // 使用原始 XZ 计算位移，确保相邻体素一致
        let theta = dot(d, pos.xz) * freq + time * phase;
        
        p.x += d.x * (amp * cos(theta));
        p.z += d.y * (amp * cos(theta));
        p.y += amp * sin(theta);
    }
    return p;
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    // 1. 判断是否为“表面”顶点。在我们的立方体定义中，y > 0 的是顶面。
    let isSurface = in.position.y > 0.0;

    var localPos = in.position;
    var worldPos = localPos * in.instanceScale + in.instancePos;

    // 2. 只有表面顶点应用 Gerstner Wave
    // if (isSurface) {
    //     // 应用波浪产生的动态位移（包括 XZ 偏移和 Y 偏移）
    //     worldPos = gerstnerWave(worldPos, uniforms.time);
    // }

    out.position = uniforms.projection * uniforms.view * vec4<f32>(worldPos, 1.0);
    out.worldPos = worldPos;
    out.normal = in.normal;
    
    // 3. 区分颜色：本体设为极暗（近乎不可见），表面保持原色
    if (isSurface) {
        out.color = vec3<f32>(0.3, 0.7, 1.0); // 亮蓝色
    } else {
        out.color = in.instanceColor * 0.1; // 本体极暗，模拟“无色”或影子
    }
    
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let lightDir = normalize(vec3<f32>(0.0, 1.0, 0.0));
    let ambient = 0.1;
    let diffuse = max(dot(in.normal, lightDir), 0.0) * 0.7;
    let lighting = ambient + diffuse;
    return vec4<f32>(in.color * lighting, 1.0);
}