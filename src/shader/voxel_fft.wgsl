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

struct WaveResult {
    position: vec3<f32>,
    normal: vec3<f32>,
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

fn tessendorfWave(pos: vec3<f32>, time: f32) -> WaveResult {
    var p = pos;
    var tangent = vec3<f32>(1.0, 0.0, 0.0);
    var binormal = vec3<f32>(0.0, 0.0, 1.0);

    // Tessendorf / Phillips Spectrum Based Stochastic Sum
    // 为了性能，我们手动采样 8 组具有代表性的频率。
    // 在真正的 FFT 方案中，这将是 256x256 的逆变换。
    let numWaves = 8u;
    
    // 预定义的频率分布（模拟 Phillips 频谱分布）
    let frequencies = array<vec2<f32>, 8>(
        vec2<f32>(0.62, 0.15), vec2<f32>(-0.45, 0.32), 
        vec2<f32>(1.25, -0.1), vec2<f32>(0.15, 0.82),
        vec2<f32>(-0.9, -0.45), vec2<f32>(1.8, 0.2),
        vec2<f32>(0.3, -1.5), vec2<f32>(-0.1, 2.1)
    );
    
    let windSpeed = 20.0;
    let L = (windSpeed * windSpeed) / 9.81; // Rmax = V^2 / g

    for (var i = 0u; i < numWaves; i = i + 1u) {
        let k = frequencies[i];
        let k_len = length(k);
        
        let p_val = phillips(k, L);
        let amplitude = sqrt(p_val) * 0.05; // 缩放因子以适配场景
        
        let omega = sqrt(9.81 * k_len); // 色散关系 w^2 = g*k
        let theta = dot(k, pos.xz) - omega * time;
        
        let cos_theta = cos(theta);
        let sin_theta = sin(theta);
        
        // 陡峭度 Q 与统计高度相关的近似
        let q = 1.0 / (k_len * f32(numWaves)); 
        
        p.x += (k.x / k_len) * amplitude * cos_theta * q;
        p.z += (k.y / k_len) * amplitude * cos_theta * q;
        p.y += amplitude * sin_theta;
        
        // 导数累加用于法线
        let ka = k_len * amplitude;
        tangent.x -= (k.x * k.x / k_len) * amplitude * sin_theta * q;
        tangent.y += k.x * amplitude * cos_theta;
        tangent.z -= (k.x * k.y / k_len) * amplitude * sin_theta * q;
        
        binormal.x -= (k.x * k.y / k_len) * amplitude * sin_theta * q;
        binormal.y += k.y * amplitude * cos_theta;
        binormal.z -= (k.y * k.y / k_len) * amplitude * sin_theta * q;
    }
    
    var res: WaveResult;
    res.position = p;
    res.normal = normalize(cross(binormal, tangent));
    return res;
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    let isSurface = in.position.y > 0.0;
    var worldPos = in.position * in.instanceScale + in.instancePos;
    var worldNormal = in.normal;

    if (isSurface) {
        let wave = tessendorfWave(worldPos, uniforms.time);
        worldPos = wave.position;
        worldNormal = wave.normal;
    }

    out.position = uniforms.projection * uniforms.view * vec4<f32>(worldPos, 1.0);
    out.worldPos = worldPos;
    out.normal = worldNormal;
    
    if (isSurface) {
        out.color = vec3<f32>(0.3, 0.7, 1.0);
    } else {
        out.color = in.instanceColor * 0.1;
    }
    
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let N = normalize(in.normal); // 法线
    let L = normalize(uniforms.lightPos - in.worldPos); // 光照方向
    let V = normalize(uniforms.cameraPos - in.worldPos); // 视线方向
    let H = normalize(L + V); // 半程向量(它是光照方向 L 和视线方向 V 的中间向量（角平分线）)

    // Ambient(环境光)
    let ambient = uniforms.ambient * in.color;

    // Diffuse(漫反射)
    let diff = uniforms.diffuse * max(dot(N, L), 0.0);
    let diffuse = diff * uniforms.lightColor * in.color;

    // Specular (镜面高光(N 与 H 重合时最亮))
    let spec = uniforms.specular * pow(max(dot(N, H), 0.0), uniforms.shininess);
    let specular = spec * uniforms.lightColor;

    let result = ambient + diffuse + specular;
    return vec4<f32>(result, 1.0);
}