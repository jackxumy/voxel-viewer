// Wireframe shader for voxel edges
struct Uniforms {
    projection: mat4x4<f32>,
    view: mat4x4<f32>,
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

@vertex
fn vs_main(
    in: VertexInput,
    instance: InstanceInput,
) -> VertexOutput {
    var out: VertexOutput;
    
    // Scale and translate vertex position by instance data
    let worldPos = in.position * instance.instanceScale + instance.instancePos;
    
    out.position = uniforms.projection * uniforms.view * vec4<f32>(worldPos, 1.0);
    
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Black wireframe
    return vec4<f32>(1.0, 1.0, 1.0, 1.0);
}
