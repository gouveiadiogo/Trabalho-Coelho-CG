export function parseMesh(text) {
  const lines = text.split("\n");
  let nv = 0;
  let nf = 0;
  let i = 0;

  while (lines[i].trim() !== "end_header") {
    const words = lines[i].trim().split(/\s+/);
    if (words[0] === "element" && words[1] === "vertex")
      nv = parseInt(words[2]);
    if (words[0] === "element" && words[1] === "face") nf = parseInt(words[2]);
    i++;
  }
  i++;

  const coords = [];
  for (let k = 0; k < nv; k++) {
    const v = lines[i + k].trim().split(/\s+/).map(Number);
    coords.push(v[0], v[1], v[2], 1);
  }
  i += nv;

  const indices = [];
  for (let k = 0; k < nf; k++) {
    const f = lines[i + k].trim().split(/\s+/).map(Number);
    indices.push(f[1], f[2], f[3]);
  }

  return { coords, indices };
}

export async function loadMesh(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load mesh: HTTP ${response.status}.`);
  }
  return parseMesh(await response.text());
}
