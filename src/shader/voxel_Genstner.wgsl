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

fn gerstnerWave(pos: vec3<f32>, time: f32) -> WaveResult {
    var p = pos;
    var tangent = vec3<f32>(1.0, 0.0, 0.0);
    var binormal = vec3<f32>(0.0, 0.0, 1.0);

    // 波浪参数：振幅，波长，速度，方向X权重
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
        
        // 陡峭度 Q 控制波峰形状(4层的叠加不超过1.0)
        let q = 0.3 / (freq * amp * 4.0); 
        
        p.x += d.x * (q * amp * cos_theta);
        p.z += d.y * (q * amp * cos_theta);
        p.y += amp * sin_theta;
        
        // let wa = freq * amp;
        // tangent.x -= d.x * d.x * (q * wa * sin_theta);
        // tangent.y += d.x * (wa * cos_theta);
        // tangent.z -= d.x * d.y * (q * wa * sin_theta);
        
        // binormal.x -= d.x * d.y * (q * wa * sin_theta);
        // binormal.y += d.y * (wa * cos_theta);
        // binormal.z -= d.y * d.y * (q * wa * sin_theta);

        let k  = freq;
        let wa = k * amp;

        // θ 只用参考坐标
        let theta0 = k * dot(d, pos.xz) + time * phase;

        let sin_t = sin(theta0);
        let cos_t = cos(theta0);

        // ∂P / ∂x0
        tangent += vec3<f32>(
            -q * wa * d.x * d.x * sin_t,
            wa * d.x * cos_t,
            -q * wa * d.x * d.y * sin_t
        );

        // ∂P / ∂z0
        binormal += vec3<f32>(
            -q * wa * d.x * d.y * sin_t,
            wa * d.y * cos_t,
            -q * wa * d.y * d.y * sin_t
        );
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
        let wave = gerstnerWave(worldPos, uniforms.time);
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