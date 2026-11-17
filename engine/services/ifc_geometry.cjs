const { IfcAPI } = require('web-ifc');
const fs = require('node:fs');

function meshGeometry(api, model, mesh) {
  const vertices = [];
  const indices = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let footprint = 0;
  let sideX = 0;
  let sideZ = 0;
  let volume = 0;
  for (let piece = 0; piece < mesh.geometries.size(); piece++) {
    const part = mesh.geometries.get(piece);
    const geom = api.GetGeometry(model, part.geometryExpressID);
    try {
      const raw = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const faces = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const matrix = part.flatTransformation;
      const base = vertices.length / 3;
      for (let index = 0; index < raw.length; index += 6) {
        const x = raw[index], y = raw[index + 1], z = raw[index + 2];
        for (let axis = 0; axis < 3; axis++) {
          const value = matrix[axis] * x + matrix[axis + 4] * y + matrix[axis + 8] * z + matrix[axis + 12];
          min[axis] = Math.min(min[axis], value);
          max[axis] = Math.max(max[axis], value);
          vertices.push(Math.round(value * 100000) / 100000);
        }
      }
      let pieceVolume = 0;
      for (let i = 0; i < faces.length; i += 3) {
        const a = base + faces[i], b = base + faces[i + 1], c = base + faces[i + 2];
        indices.push(a, b, c);
        const [ax, ay, az] = vertices.slice(a * 3, a * 3 + 3);
        const [bx, by, bz] = vertices.slice(b * 3, b * 3 + 3);
        const [cx, cy, cz] = vertices.slice(c * 3, c * 3 + 3);
        const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
        const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
        const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
        footprint += Math.max(0, ny) / 2;
        sideX += Math.max(0, nx) / 2;
        sideZ += Math.max(0, nz) / 2;
        pieceVolume += (ax * nx + ay * ny + az * nz) / 6;
      }
      volume += Math.abs(pieceVolume);
    } finally {
      geom.delete();
    }
  }
  if (!indices.length || !min.every(Number.isFinite) || !max.every(Number.isFinite)) return null;
  return {
    vertices, indices,
    xM: min[0], yM: min[2], zM: min[1],
    widthM: max[0] - min[0], depthM: max[2] - min[2], heightM: max[1] - min[1],
    areaM2: footprint, sideAreaM2: Math.hypot(sideX, sideZ), volumeM3: volume,
  };
}

async function decode() {
  const api = new IfcAPI();
  await api.Init();
  api.SetLogLevel(4);
  const model = api.OpenModel(new Uint8Array(fs.readFileSync(process.argv[2])), { COORDINATE_TO_ORIGIN: true });
  if (model < 0 || !api.IsModelOpen(model)) throw new Error('Unable to open the IFC model.');
  try {
    const levelByItem = new Map();
    const tree = await api.properties.getSpatialStructure(model);
    function readLevels(node, level = 'Unassigned level') {
      if (!node) return;
      const current = node.type?.toUpperCase() === 'IFCBUILDINGSTOREY'
        ? api.GetLine(model, node.expressID)?.Name?.value || `Level #${node.expressID}`
        : level;
      levelByItem.set(node.expressID, current);
      for (const child of node.children ?? []) readLevels(child, current);
    }
    readLevels(tree);
    const elements = [];
    api.StreamAllMeshes(model, (mesh) => {
      const entity = api.GetLine(model, mesh.expressID);
      if (!entity) return;
      const ifcClass = api.GetNameFromTypeCode(entity.type);
      if (/^Ifc(?:Opening|Space|Annotation)/i.test(ifcClass)) return;
      const geometry = meshGeometry(api, model, mesh);
      if (!geometry) return;
      elements.push({
        id: `ifc-${mesh.expressID}`, globalId: entity.GlobalId?.value ?? `#${mesh.expressID}`,
        ifcClass, name: entity.Name?.value || `${ifcClass} #${mesh.expressID}`,
        level: levelByItem.get(mesh.expressID) ?? 'Unassigned level',
        ...geometry,
      });
    });
    fs.writeFileSync(process.argv[3], JSON.stringify(elements));
  } finally {
    api.CloseModel(model);
  }
}

decode().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
