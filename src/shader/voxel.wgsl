struct Uniforms {
    projection: mat4x4<f32>,
    view: mat4x4<f32>
}
@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexInput {
    @location(0) position: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) instancePos: vec3<f32>,
    @location(3) instanceScale: f32,
    @location(4) instanceColor: vec3<f32>
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) worldPos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) color: vec3<f32>
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    let worldPos = in.position * in.instanceScale + in.instancePos;
    out.position = uniforms.projection * uniforms.view * vec4<f32>(worldPos, 1.0);
    out.worldPos = worldPos;
    out.normal = in.normal;
    out.color = in.instanceColor;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let lightDir = normalize(vec3<f32>(1.0, 2.0, 1.0));
    let ambient = 0.3;
    let diffuse = max(dot(in.normal, lightDir), 0.0) * 0.7;
    let lighting = ambient + diffuse;
    return vec4<f32>(in.color * lighting, 1.0);
}