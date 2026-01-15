// Wireframe shader for voxel edges
struct Uniforms {
    projection: mat4x4<f32>,
    view: mat4x4<f32>,
    cameraPos: vec3<f32>,
    lightPos: vec3<f32>,
    lightColor: vec3<f32>,
    time: f32,
    shininess: f32,
    ambient: f32,
    diffuse: f32,
    specular: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
}

struct InstanceInput {
    @location(1) instancePos: vec3<f32>,
    @location(2) instanceScale: f32,
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
}

fn gerstnerWave(pos: vec3<f32>, time: f32) -> vec3<f32> {
    var p = pos;
    // 与 voxel.wgsl 保持一致的波浪参数与频率计算，确保边框与表面位移一致
    let waves = array<vec4<f32>, 4>(
        vec4<f32>(0.2, 8.0, 1.2, 1.0),
        vec4<f32>(0.1, 4.0, 2.0, 0.5),
        vec4<f32>(0.05, 2.0, 3.0, -0.7),
        vec4<f32>(0.1, 3.0, 4.0, -0.2),
    );

    for (var i = 0u; i < 4u; i = i + 1u) {
        let w = waves[i];
        let amp = w.x;
        let wl = w.y;
        let speed = w.z;
        let d = normalize(vec2<f32>(w.w, sqrt(max(0.0, 1.0 - w.w * w.w))));

        let freq = 2.0 * 3.14159 / wl;
        let phase = speed * freq;
        let theta = dot(d, pos.xz) * freq + time * phase;

        let cos_theta = cos(theta);
        let sin_theta = sin(theta);

        // 使用与 voxel 相同的位移公式（但这里只需返回位置）
        // 陡峭度 q 控制局部 XZ 偏移对高度的影响，增加视觉细节
        let q = 0.3 / (freq * amp * 4.0);

        p.x += d.x * (q * amp * cos_theta);
        p.z += d.y * (q * amp * cos_theta);
        p.y += amp * sin_theta;
    }
    return p;
}

@vertex
fn vs_main(
    in: VertexInput,
    instance: InstanceInput,
) -> VertexOutput {
    var out: VertexOutput;

    let isTop = in.position.y > 0.0;
    
    let inflatedScale = instance.instanceScale * 1.002;
    var worldPos = in.position * inflatedScale + instance.instancePos;

    // 只有顶端顶点应用位移
    if (isTop) {
        worldPos = gerstnerWave(worldPos, uniforms.time);
    }
    
    out.position = uniforms.projection * uniforms.view * vec4<f32>(worldPos, 1.0);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Black wireframe
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
