export default /* wgsl */ `
struct Uniforms {
  model : mat4x4f,
  view : mat4x4f,
  projection : mat4x4f,
  normalMatrix : mat4x4f,
  lightPosition : vec4f,
  ambient : vec4f,
  diffuse : vec4f,
  specular : vec4f,
  lightParams : vec4f,
};

@group(0) @binding(0) var<uniform> uniforms : Uniforms;
@group(1) @binding(0) var floorTexture : texture_2d<f32>;
@group(1) @binding(1) var floorSampler : sampler;

@fragment
fn main(
  @location(0) uv : vec2f,
  @location(1) viewPosition : vec3f,
  @location(2) viewNormal : vec3f,
) -> @location(0) vec4f {
  let normal = normalize(viewNormal);
  let viewLightPosition = uniforms.view * uniforms.lightPosition;
  let lightDir = normalize(viewLightPosition.xyz - viewPosition);
  let cameraDir = normalize(-viewPosition);

  let diffuseFactor = max(0.0, dot(lightDir, normal));
  let halfVector = normalize(lightDir + cameraDir);
  let specularFactor = pow(max(0.0, dot(halfVector, normal)), uniforms.lightParams.x);

  // Amostragem da textura do chão
  let texColor = textureSample(floorTexture, floorSampler, uv);

  // Iluminação de Phong utilizando a cor da textura como cor difusa do material do chão
  let ambientColor = uniforms.ambient.a * uniforms.ambient.rgb * texColor.rgb;
  let diffuseColor = diffuseFactor * uniforms.diffuse.a * uniforms.diffuse.rgb * texColor.rgb;
  let specularColor = select(vec3f(0.0),
    specularFactor * uniforms.specular.a * uniforms.specular.rgb, diffuseFactor > 0.0);
  let litColor = ambientColor + diffuseColor + specularColor;

  return vec4f(litColor, 1.0);
}
`;
