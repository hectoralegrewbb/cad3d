// Topología de mallas de triángulos (pura: sin DOM ni kernel).
// Un STL exportado de CAD puede traer cuerpos que se tocan en una arista (4 triángulos en una misma arista). Coser eso tal cual
// empareja las caras al azar y da sólidos inválidos. `makeManifold` empareja los triángulos de cada arista y separa apenas los
// vértices que se tocan; `splitBodies` reparte el resultado en cuerpos cerrados que se cosen uno por uno.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (a) => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
const circularDistance = (x, y) => {
  const d = Math.abs(x - y) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};

const makeUnionFind = (size) => {
  const parent = new Int32Array(size).map((_, i) => i);
  const find = (a) => {
    let root = a;
    while (parent[root] !== root) root = parent[root];
    for (let node = a; parent[node] !== root; ) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  return { find, union: (a, b) => { parent[find(a)] = find(b); } };
};

// Aristas → lista de { t, from, to, k } (triángulo, extremos en el sentido del triángulo, posición de la arista en él).
function edgeTable(triangles, vertexCount) {
  const table = new Map();
  for (let t = 0; t < triangles.length / 3; t += 1) {
    for (let k = 0; k < 3; k += 1) {
      const from = triangles[t * 3 + k];
      const to = triangles[t * 3 + ((k + 1) % 3)];
      const key = from < to ? from * vertexCount + to : to * vertexCount + from;
      const entry = { t, from, to, k };
      const list = table.get(key);
      if (list) list.push(entry);
      else table.set(key, [entry]);
    }
  }
  return table;
}

// Triángulos de una arista con más de dos: los que la recorren en un sentido se emparejan con los que la recorren al revés,
// de a los que forman el ángulo más chico alrededor de la arista (cada par = una lámina que atraviesa la arista).
function pairAroundEdge(point, triangles, list, opposite = false) {
  const a = list[0].from;
  const b = list[0].to;
  const axis = normalize(sub(point(b), point(a)));
  const u = normalize(cross(axis, Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  const w = cross(axis, u);
  const angleOf = (entry) => {
    const d = sub(point(triangles[entry.t * 3 + ((entry.k + 2) % 3)]), point(a));
    const flat = [d[0] - dot(d, axis) * axis[0], d[1] - dot(d, axis) * axis[1], d[2] - dot(d, axis) * axis[2]];
    return Math.atan2(dot(flat, w), dot(flat, u));
  };
  const forward = list.filter((entry) => entry.from === a).map((entry) => ({ entry, angle: angleOf(entry) }));
  const backward = list.filter((entry) => entry.from !== a).map((entry) => ({ entry, angle: angleOf(entry) }));
  const candidates = forward.flatMap((f) => backward.map((r) => ({ f, r, distance: circularDistance(f.angle, r.angle) }))).sort((x, y) => opposite ? y.distance - x.distance : x.distance - y.distance);
  const used = new Set();
  const pairs = [];
  candidates.forEach(({ f, r }) => {
    if (used.has(f) || used.has(r)) return;
    used.add(f);
    used.add(r);
    pairs.push([f.entry, r.entry]);
  });
  return pairs;
}

// Devuelve { vertices: Float64Array, triangles: Uint32Array, splitCount }: los vértices donde se tocan láminas se duplican y
// cada copia se corre `nudge` hacia adentro de su lámina (un valor mayor que la tolerancia de cosido) para que el cosido no las confunda.
export function makeManifold(vertices, triangles, nudge, { opposite = false } = {}) {
  const vertexCount = vertices.length / 3;
  const triangleCount = triangles.length / 3;
  const point = (i) => [vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]];
  const pairs = [];
  edgeTable(triangles, vertexCount).forEach((list) => {
    if (list.length === 2) pairs.push([list[0], list[1]]);
    else if (list.length > 2) pairs.push(...pairAroundEdge(point, triangles, list, opposite));
  });
  // Esquinas (triángulo, vértice) unidas por los pares: cada clase es un abanico de triángulos alrededor de un vértice.
  const corners = makeUnionFind(triangleCount * 3);
  const cornerOf = (t, v) => t * 3 + [0, 1, 2].find((k) => triangles[t * 3 + k] === v);
  pairs.forEach(([first, second]) => [first.from, first.to].forEach((v) => corners.union(cornerOf(first.t, v), cornerOf(second.t, v))));
  const fans = new Map();
  for (let c = 0; c < triangleCount * 3; c += 1) {
    const root = corners.find(c);
    if (!fans.has(root)) fans.set(root, { vertex: triangles[c], corners: [] });
    fans.get(root).corners.push(c);
  }
  const fansOfVertex = new Map();
  fans.forEach((fan) => {
    if (!fansOfVertex.has(fan.vertex)) fansOfVertex.set(fan.vertex, []);
    fansOfVertex.get(fan.vertex).push(fan);
  });
  const triangleNormal = (t) => normalize(cross(sub(point(triangles[t * 3 + 1]), point(triangles[t * 3])), sub(point(triangles[t * 3 + 2]), point(triangles[t * 3]))));
  const outVertices = [];
  const outTriangles = new Uint32Array(triangles.length);
  let splitCount = 0;
  fansOfVertex.forEach((list, vertex) => {
    list.forEach((fan, index) => {
      let position = point(vertex);
      if (index > 0) {
        splitCount += 1;
        const sum = [0, 0, 0];
        fan.corners.forEach((c) => triangleNormal(Math.floor(c / 3)).forEach((value, k) => { sum[k] += value; }));
        const inward = normalize(sum);
        position = position.map((value, k) => value - inward[k] * nudge);
      }
      const id = outVertices.length / 3;
      outVertices.push(...position);
      fan.corners.forEach((c) => { outTriangles[c] = id; });
    });
  });
  return { vertices: Float64Array.from(outVertices), triangles: outTriangles, splitCount };
}

// Separa una malla en cuerpos: dos triángulos son del mismo cuerpo si comparten una arista que tiene exactamente esos dos.
// Cada componente sale con sus vértices reindexados: { points: [[x,y,z]…], triangles: [i,j,k…] }.
export function splitBodies(vertices, triangles) {
  const count = triangles.length / 3;
  const bodies = makeUnionFind(count);
  edgeTable(triangles, vertices.length / 3).forEach((list) => {
    if (list.length === 2) bodies.union(list[0].t, list[1].t);
  });
  const groups = new Map();
  for (let t = 0; t < count; t += 1) {
    const root = bodies.find(t);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(t);
  }
  return [...groups.values()].map((members) => {
    const remap = new Map();
    const points = [];
    const indices = [];
    members.forEach((t) => {
      for (let k = 0; k < 3; k += 1) {
        const v = triangles[t * 3 + k];
        let id = remap.get(v);
        if (id === undefined) {
          id = points.length;
          remap.set(v, id);
          points.push([vertices[v * 3], vertices[v * 3 + 1], vertices[v * 3 + 2]]);
        }
        indices.push(id);
      }
    });
    return { points, triangles: indices };
  });
}
