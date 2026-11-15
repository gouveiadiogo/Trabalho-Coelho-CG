import vertShaderSrc from "./illumination.vert.js";
import fragShaderSrc from "./illumination.frag.js";
import floorVertShaderSrc from "./floor.vert.js";
import floorFragShaderSrc from "./floor.frag.js";
import WebGPU from "./lib/webgpu.js";
import { HalfEdgeDS } from "./lib/half-edge.js";
import { loadMesh } from "./loadMesh.js";
import { generateTableMesh } from "./marchingCubes.js";
import { FloorMesh } from "./floor.js";
import {
  createIdentityMat4,
  createLookAtMat4,
  createNormalMat4,
  createPerspectiveMat4,
  createScaleMat4,
  createTranslationMat4,
  multiplyMat4,
} from "./lib/utils.js";

class Mesh {
  constructor(gpu, program, coords, indices, color, transform = null) {
    this.program = program;
    this.heds = new HalfEdgeDS();
    this.heds.build(coords, indices);

    if (transform) {
      this.translate = transform.translate ?? createIdentityMat4();
      this.scale = transform.scale ?? createIdentityMat4();
    } else {
      this.computeTransform(coords);
    }

    for (const vertex of this.heds.vertices) {
      vertex.color = color;
    }
    const [positions, colors, normals, triangles] = this.heds.getVBOs();
    this.shape = gpu.createShape({
      buffers: [positions, colors, normals],
      indices: triangles,
      indexFormat: "uint32",
      vertexCount: this.heds.vertices.length,
    });
    this.uniform = gpu.createUniform(program, new Float32Array(84));
  }

  createModelMatrix() {
    return multiplyMat4(this.translate, this.scale);
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
    const model = this.createModelMatrix();

    this.updateUniform(model, view, projection, light);
    gpu.writeBuffer(this.uniform.buffer, this.uniform.data);
    gpu.draw(this.program, this.shape, [this.uniform.bindGroup]);
  }

  computeTransform(coords) {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < coords.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], coords[i + c]);
        max[c] = Math.max(max[c], coords[i + c]);
      }
    }

    // largura do coelho = metade do diametro do topo da mesa (2.8)
    const s = 1.4 / (max[0] - min[0]);
    const cx = (min[0] + max[0]) / 2;
    const cz = (min[2] + max[2]) / 2;

    // a escala vem antes, entao a translacao usa os valores ja escalados
    this.scale = createScaleMat4(s, s, s);
    this.translate = createTranslationMat4(-s * cx, 1.6 - s * min[1], -s * cz);
  }
}

class Scene {
  constructor(gpu, bunnyData, tableData, floorTexture) {
    this.light = {
      position: [-2, 3, 4, 1],
      ambient: [1, 1, 1, 0.25],
      diffuse: [1, 1, 1, 0.75],
      specular: [1, 1, 1, 0.2],
      params: [48, 0, 0, 0],
    };

    // Programa para objetos com cores sólidas (Bunny e Mesa)
    this.program = gpu.createProgram(vertShaderSrc, fragShaderSrc, {
      cullMode: "back",
      buffers: [
        {
          arrayStride: 4 * 4,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }],
        },
        {
          arrayStride: 4 * 4,
          attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
        },
        {
          arrayStride: 4 * 4,
          attributes: [{ shaderLocation: 2, offset: 0, format: "float32x4" }],
        },
      ],
    });

    // Programa para o chão texturizado
    this.floorProgram = gpu.createProgram(floorVertShaderSrc, floorFragShaderSrc, {
      cullMode: "back",
      buffers: [
        {
          arrayStride: 4 * 4,
          attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }],
        },
        {
          arrayStride: 4 * 4,
          attributes: [{ shaderLocation: 1, offset: 0, format: "float32x4" }],
        },
        {
          arrayStride: 2 * 4,
          attributes: [{ shaderLocation: 2, offset: 0, format: "float32x2" }],
        },
      ],
    });

    // Sampler com repetição (wrap/repeat)
    this.floorSampler = gpu.createSampler({
      addressModeU: "repeat",
      addressModeV: "repeat",
      magFilter: "linear",
      minFilter: "linear",
    });

    // Chão plano texturizado na altura y = 0
    this.floor = new FloorMesh(
      gpu,
      this.floorProgram,
      floorTexture,
      this.floorSampler,
      24,
      24,
      10,
    );

    // Malha da Mesa implícita (cor sólida azul)
    const tableTransform = {
      translate: createIdentityMat4(),
      scale: createIdentityMat4(),
    };
    const tableMesh = new Mesh(
      gpu,
      this.program,
      tableData.coords,
      tableData.indices,
      [0.15, 0.42, 0.85, 1.0],
      tableTransform,
    );

    // Stanford Bunny (cor sólida clara)
    const bunnyMesh = new Mesh(
      gpu,
      this.program,
      bunnyData.coords,
      bunnyData.indices,
      [0.93, 0.9, 0.8, 1.0],
    );

    this.meshes = [tableMesh, bunnyMesh];
  }

  createViewMatrix() {
    const eye = [0, 2.6, 4.5];
    const at = [0, 1.6, 0];
    const up = [0, 1, 0];

    return createLookAtMat4(eye, at, up, true);
  }

  createProjectionMatrix() {
    const aspect = 1024 / 768;
    return createPerspectiveMat4(Math.PI / 4, aspect, 0.1, 25);
  }

  draw(gpu) {
    const view = this.createViewMatrix();
    const projection = this.createProjectionMatrix();

    // Renderiza o chão
    this.floor.draw(gpu, view, projection, this.light);

    // Renderiza a mesa e o bunny
    for (const mesh of this.meshes) {
      mesh.draw(gpu, view, projection, this.light);
    }
  }
}

class Main {
  async init() {
    this.gpu = await WebGPU.createCanvas("#glcanvas", 1024, 768, {
      clearColor: { r: 0.2, g: 0.2, b: 0.22, a: 1 },
    });

    const [bunnyData, floorTexture] = await Promise.all([
      loadMesh(new URL("./bun_zipper.ply", import.meta.url)),
      this.gpu.createTextureFromImage(
        new URL("./Tiles074_1K-JPG_Color.jpg", import.meta.url),
      ),
    ]);

    // Resolução escolhida para o Marching Cubes: 80 x 50 x 80
    // Células cúbicas perfeitas: dx = 3.2/80 = 0.04, dy = 2.0/50 = 0.04, dz = 3.2/80 = 0.04
    const tableData = generateTableMesh(128, 80, 128);

    this.scene = new Scene(this.gpu, bunnyData, tableData, floorTexture);
  }

  draw() {
    this.gpu.start();
    this.scene.draw(this.gpu);
    this.gpu.finish();
    requestAnimationFrame(this.draw.bind(this));
  }
}

try {
  const app = new Main();
  await app.init();
  app.draw();
} catch (error) {
  console.error(error);
  document.body.insertAdjacentHTML("beforeend", `<p>${error.message}</p>`);
}
