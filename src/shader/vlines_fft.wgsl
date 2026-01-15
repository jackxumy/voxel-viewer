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

fn phillips(k: vec2<f32>, L: f32) -> f32 {
    let k_len = length(k);
    if (k_len < 0.0001) { return 0.0; }
    
    let kL = k_len * L;
    let k2 = k_len * k_len;
    let k4 = k2 * k2;
    
    // Wind direction (example: 1.0, 0.0)
    let w_dir = vec2<f32>(1.0, 0.0);
    let k_dot_w = dot(normalize(k), w_dir);
    
    return exp(-1.0 / (kL * kL)) / k4 * (k_dot_w * k_dot_w);
}

fn tessendorfWave(pos: vec3<f32>, time: f32) -> vec3<f32> {
    var p = pos;
    let numWaves = 8u;
    
    let frequencies = array<vec2<f32>, 8>(
        vec2<f32>(0.62, 0.15), vec2<f32>(-0.45, 0.32), 
        vec2<f32>(1.25, -0.1), vec2<f32>(0.15, 0.82),
        vec2<f32>(-0.9, -0.45), vec2<f32>(1.8, 0.2),
        vec2<f32>(0.3, -1.5), vec2<f32>(-0.1, 2.1)
    );
    
    let windSpeed = 20.0;
    let L = (windSpeed * windSpeed) / 9.81;

    for (var i = 0u; i < numWaves; i = i + 1u) {
        let k = frequencies[i];
        let k_len = length(k);
        
        let p_val = phillips(k, L);
        let amplitude = sqrt(p_val) * 0.05;
        
        let omega = sqrt(9.81 * k_len);
        let theta = dot(k, pos.xz) - omega * time;
        
        let cos_theta = cos(theta);
        let sin_theta = sin(theta);
        
        let q = 1.0 / (k_len * f32(numWaves)); 
        
        p.x += (k.x / k_len) * amplitude * cos_theta * q;
        p.z += (k.y / k_len) * amplitude * cos_theta * q;
        p.y += amplitude * sin_theta;
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
        worldPos = tessendorfWave(worldPos, uniforms.time);
    }
    
    out.position = uniforms.projection * uniforms.view * vec4<f32>(worldPos, 1.0);
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Black wireframe
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
