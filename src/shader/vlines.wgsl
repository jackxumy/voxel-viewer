// Wireframe shader for voxel edges
struct Uniforms {
    projection: mat4x4<f32>,
    view: mat4x4<f32>,
    time: f32,
    padding: vec3<f32>,
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
        let theta = dot(d, pos.xz) * freq + time * phase;
        
        p.x += d.x * (amp * cos(theta));
        p.z += d.y * (amp * cos(theta));
        p.y += amp * sin(theta);
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
    // if (isTop) {
    //     worldPos = gerstnerWave(worldPos, uniforms.time);
    // }
    
    out.position = uniforms.projection * uniforms.view * vec4<f32>(worldPos, 1.0);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Black wireframe
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
