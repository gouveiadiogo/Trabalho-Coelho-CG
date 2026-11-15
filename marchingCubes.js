import { edgeTable, triTable } from "./mc_tables.js";


export const edgeConnections = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

/*
  Função implícita que define a geometria da mesa:
  F(x, y, z) = max(x^2 + z^2 - 0.36 - 2.5(y - 0.8)^2, -y, y - 1.6)
  O interior da mesa corresponde a F < 0.
*/
export function tableImplicitFunction(x, y, z) {
  const g = x * x + z * z - 0.36 - 2.5 * (y - 0.8) * (y - 0.8);
  return Math.max(g, -y, y - 1.6);
}

/**
  Gera a malha da mesa usando o algoritmo Marching Cubes.
  Avalia a função nos vértices de uma grade regular no domínio [-1.6, 1.6] x [-0.2, 1.8] x [-1.6, 1.6].
  Interpola linearmente as arestas intersectadas e gera as faces triangulares com orientação CCW.

  @param {number} resX Resolução no eixo X (padrão: 80)
  @param {number} resY Resolução no eixo Y (padrão: 50)
  @param {number} resZ Resolução no eixo Z (padrão: 80)
  @returns {{ coords: number[], indices: number[] }}
*/
export function generateTableMesh(resX = 80, resY = 50, resZ = 80) {
  const minX = -1.6, maxX = 1.6;
  const minY = -0.2, maxY = 1.8;
  const minZ = -1.6, maxZ = 1.6;

  const dx = (maxX - minX) / resX;
  const dy = (maxY - minY) / resY;
  const dz = (maxZ - minZ) / resZ;

  const strideY = resX + 1;
  const strideZ = (resX + 1) * (resY + 1);
  const grid = new Float32Array(strideZ * (resZ + 1));

  // Amostragem da função escalar na grade regular tridimensional
  for (let k = 0; k <= resZ; k++) {
    const z = minZ + k * dz;
    for (let j = 0; j <= resY; j++) {
      const y = minY + j * dy;
      for (let i = 0; i <= resX; i++) {
        const x = minX + i * dx;
        grid[i + j * strideY + k * strideZ] = tableImplicitFunction(x, y, z);
      }
    }
  }

  const cornerVals = new Float32Array(8);
  const edgeVerts = new Array(12);

  const coords = [];
  const indices = [];
  const vertexMap = new Map();

  // Varredura de cada célula da grade
  for (let k = 0; k < resZ; k++) {
    const z0 = minZ + k * dz;
    for (let j = 0; j < resY; j++) {
      const y0 = minY + j * dy;
      for (let i = 0; i < resX; i++) {
        const x0 = minX + i * dx;
        const p = [
          [x0, y0, z0],
          [x0 + dx, y0, z0],
          [x0 + dx, y0 + dy, z0],
          [x0, y0 + dy, z0],
          [x0, y0, z0 + dz],
          [x0 + dx, y0, z0 + dz],
          [x0 + dx, y0 + dy, z0 + dz],
          [x0, y0 + dy, z0 + dz],
        ];

        const idx0 = i + j * strideY + k * strideZ;
        const idx1 = i + 1 + j * strideY + k * strideZ;
        const idx2 = i + 1 + (j + 1) * strideY + k * strideZ;
        const idx3 = i + (j + 1) * strideY + k * strideZ;
        const idx4 = i + j * strideY + (k + 1) * strideZ;
        const idx5 = i + 1 + j * strideY + (k + 1) * strideZ;
        const idx6 = i + 1 + (j + 1) * strideY + (k + 1) * strideZ;
        const idx7 = i + (j + 1) * strideY + (k + 1) * strideZ;

        cornerVals[0] = grid[idx0];
        cornerVals[1] = grid[idx1];
        cornerVals[2] = grid[idx2];
        cornerVals[3] = grid[idx3];
        cornerVals[4] = grid[idx4];
        cornerVals[5] = grid[idx5];
        cornerVals[6] = grid[idx6];
        cornerVals[7] = grid[idx7];

        // Determinação do índice da célula (casos do Marching Cubes)
        let cubeIndex = 0;
        for (let c = 0; c < 8; c++) {
          if (cornerVals[c] < 0) {
            cubeIndex |= 1 << c;
          }
        }

        const edges = edgeTable[cubeIndex];
        if (edges === 0) continue;

        // Interpolação linear nos pontos de corte das arestas
        for (let e = 0; e < 12; e++) {
          if (edges & (1 << e)) {
            const [c0, c1] = edgeConnections[e];
            const p0 = p[c0];
            const p1 = p[c1];
            const v0 = cornerVals[c0];
            const v1 = cornerVals[c1];
            const t = (0 - v0) / (v1 - v0);
            edgeVerts[e] = [
              p0[0] + t * (p1[0] - p0[0]),
              p0[1] + t * (p1[1] - p0[1]),
              p0[2] + t * (p1[2] - p0[2]),
            ];
          }
        }

        // Geração dos triângulos a partir da tabela
        for (let t = 0; t < 16; t += 3) {
          const e0 = triTable[cubeIndex * 16 + t];
          if (e0 === -1) break;
          const e1 = triTable[cubeIndex * 16 + t + 1];
          const e2 = triTable[cubeIndex * 16 + t + 2];

          // Inversão da ordem dos vértices (e0, e2, e1) para garantir normal externa CCW
          const triEdges = [e0, e2, e1];
          const triIndices = [];
          for (const edgeIdx of triEdges) {
            const v = edgeVerts[edgeIdx];
            const key = `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)}`;
            let vIdx = vertexMap.get(key);
            if (vIdx === undefined) {
              vIdx = coords.length / 4;
              vertexMap.set(key, vIdx);
              coords.push(v[0], v[1], v[2], 1.0);
            }
            triIndices.push(vIdx);
          }

          // Filtra triângulos degenerados (com vértices coincidentes)
          if (
            triIndices[0] !== triIndices[1] &&
            triIndices[1] !== triIndices[2] &&
            triIndices[2] !== triIndices[0]
          ) {
            indices.push(...triIndices);
          }
        }
      }
    }
  }

  return { coords, indices };
}
