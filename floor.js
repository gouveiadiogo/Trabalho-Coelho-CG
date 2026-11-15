import {
  createIdentityMat4,
  createNormalMat4,
  multiplyMat4,
} from "./lib/utils.js";

/**
  Cria a geometria do chão como uma malha de triângulos no plano Y = 0.

  @param {number} size Extensão total do chão nos eixos X e Z (padrão: 24)
  @param {number} subdivisions Número de subdivisões ao longo de cada eixo (padrão: 24)
  @param {number} repeat Quantas vezes a textura deve se repetir ao longo da extensão (padrão: 10)
  @returns {{ positions: Float32Array, normals: Float32Array, uvs: Float32Array, indices: Uint32Array }}
*/
export function createFloorGeometry(size = 24, subdivisions = 24, repeat = 10) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const halfSize = size / 2;
  const step = size / subdivisions;

  for (let j = 0; j <= subdivisions; j++) {
    const z = -halfSize + j * step;
    const v = (j / subdivisions) * repeat;
    for (let i = 0; i <= subdivisions; i++) {
      const x = -halfSize + i * step;
      const u = (i / subdivisions) * repeat;

      positions.push(x, 0.0, z, 1.0);
      normals.push(0.0, 1.0, 0.0, 0.0);
      uvs.push(u, v);
    }
  }

  const stride = subdivisions + 1;
  for (let j = 0; j < subdivisions; j++) {
    for (let i = 0; i < subdivisions; i++) {
      const i0 = i + j * stride;
      const i1 = i + 1 + j * stride;
      const i2 = i + 1 + (j + 1) * stride;
      const i3 = i + (j + 1) * stride;

      // Dois triângulos por célula do grid com orientação CCW vista de cima (+Y)
      indices.push(i0, i3, i1);
      indices.push(i1, i3, i2);
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
  };
}

export class FloorMesh {
  constructor(gpu, program, texture, sampler, size = 24, subdivisions = 24, repeat = 10) {
    this.program = program;
    const geometry = createFloorGeometry(size, subdivisions, repeat);

    this.shape = gpu.createShape({
      buffers: [geometry.positions, geometry.normals, geometry.uvs],
      indices: geometry.indices,
      indexFormat: "uint32",
      vertexCount: geometry.positions.length / 4,
    });

    this.uniform = gpu.createUniform(program, new Float32Array(84));
    this.textureBindGroup = gpu.createBindGroup(
      program,
      [
        { binding: 0, resource: texture.createView() },
        { binding: 1, resource: sampler },
      ],
      1,
    );

    this.modelMatrix = createIdentityMat4();
  }

  updateUniform(model, view, projection, light) {
    const modelView = multiplyMat4(view, model);
    const normalMatrix = createNormalMat4(modelView);

    this.uniform.data.set(model, 0);
    this.uniform.data.set(view, 16);
    this.uniform.data.set(projection, 32);
    this.uniform.data.set(normalMatrix, 48);
    this.uniform.data.set(light.position, 64);
    this.uniform.data.set(light.ambient, 68);
    this.uniform.data.set(light.diffuse, 72);
    this.uniform.data.set(light.specular, 76);
    this.uniform.data.set(light.params, 80);
  }

  draw(gpu, view, projection, light) {
    this.updateUniform(this.modelMatrix, view, projection, light);
    gpu.writeBuffer(this.uniform.buffer, this.uniform.data);
    gpu.draw(this.program, this.shape, [
      this.uniform.bindGroup,
      this.textureBindGroup,
    ]);
  }
}
