import { RECORD_TYPES } from "../core/recordTypes.js";

const MODEL_VERTEX_RECORD_TYPES = new Set([
  RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA,
  RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_WII
]);

const MODEL_INDEX_RECORD_TYPES = new Set([
  RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_TABLE,
  RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_TABLE_WII
]);

export function extractModelGeometry(records) {
  const vertexRecords = records.filter((record) => MODEL_VERTEX_RECORD_TYPES.has(record.type)).map((record) => record.data);
  const indexRecords = records.filter((record) => MODEL_INDEX_RECORD_TYPES.has(record.type)).map((record) => record.data);

  if (vertexRecords.length === 0 || indexRecords.length === 0) {
    throw new Error("Model has no vertex/index data.");
  }

  const vertices = [];
  const uvs = [];
  const faces = [];
  const groups = [];
  let globalVertexCounter = 0;

  for (let blockIndex = 0; blockIndex < Math.min(vertexRecords.length, indexRecords.length); blockIndex += 1) {
    const vertexData = vertexRecords[blockIndex];
    const indexData = indexRecords[blockIndex];
    const vertexSize = detectVertexSize(vertexData);
    const uvOffset = vertexSize === 64 ? 44 : 12;
    const blockGeometry = extractVertices(vertexData, vertexSize, uvOffset);
    const indices = extractIndices(indexData);
    const batches = splitBatches(indices);
    const blockFaceStart = faces.length;

    for (const vertex of blockGeometry.vertices) {
      vertices.push(vertex);
    }

    for (const uv of blockGeometry.uvs) {
      uvs.push(uv);
    }

    let localBlockOffset = 0;

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      const groupFaceStart = faces.length;

      if (batch.length === 0) {
        continue;
      }

      for (let index = 0; index < batch.length - 2; index += 3) {
        const face = [
          batch[index] + localBlockOffset + globalVertexCounter,
          batch[index + 1] + localBlockOffset + globalVertexCounter,
          batch[index + 2] + localBlockOffset + globalVertexCounter
        ];

        if (face.every((vertexIndex) => vertexIndex >= 0 && vertexIndex < vertices.length)) {
          faces.push(face);
        }
      }

      groups.push({
        mode: "submesh",
        name: `Block_${blockIndex}_Part_${batchIndex}`,
        blockIndex,
        batchIndex,
        faceStart: groupFaceStart,
        faceEnd: faces.length
      });

      localBlockOffset += maxValue(batch) + 1;
    }

    groups.push({
      mode: "block",
      name: `Block_${blockIndex}`,
      blockIndex,
      faceStart: blockFaceStart,
      faceEnd: faces.length
    });

    globalVertexCounter += blockGeometry.vertices.length;
  }

  return {
    vertices,
    uvs,
    faces,
    groups,
    bounds: computeBounds(vertices)
  };
}

export function buildObjFromGeometry(geometry, modelName, options = {}) {
  const splitSubmeshes = options.splitSubmeshes === true;
  const groupMode = splitSubmeshes ? "submesh" : "block";
  const groups = geometry.groups.filter((group) => group.mode === groupMode && group.faceEnd > group.faceStart);
  const lines = [`# HNK Reconstructed Model: ${sanitizeName(modelName)}`, `# Split Submeshes: ${splitSubmeshes}`, ""];

  for (const vertex of geometry.vertices) {
    lines.push(`v ${vertex[0].toFixed(6)} ${vertex[1].toFixed(6)} ${vertex[2].toFixed(6)}`);
  }

  for (const uv of geometry.uvs) {
    lines.push(`vt ${uv[0].toFixed(6)} ${uv[1].toFixed(6)}`);
  }

  for (const group of groups) {
    lines.push("", `o ${group.name}`, `g ${group.name}`);

    for (let faceIndex = group.faceStart; faceIndex < group.faceEnd; faceIndex += 1) {
      const face = geometry.faces[faceIndex];
      const a = face[0] + 1;
      const b = face[1] + 1;
      const c = face[2] + 1;
      lines.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function detectVertexSize(data) {
  const sizes = [];
  let last = 0;

  for (let index = 0; index < data.length - 3; index += 4) {
    if (data[index] === 0xff && data[index + 1] === 0xff && data[index + 2] === 0xff && data[index + 3] === 0xff) {
      const size = index + 4 - last;

      if (size >= 16 && size <= 128) {
        sizes.push(size);
      }

      last = index + 4;
    }

    if (sizes.length >= 10) {
      break;
    }
  }

  return sizes.length === 0 ? 64 : mode(sizes);
}

function extractVertices(data, vertexSize, uvOffset) {
  const vertices = [];
  const uvs = [];
  const count = Math.floor(data.length / vertexSize);

  for (let index = 0; index < count; index += 1) {
    const offset = index * vertexSize;
    const vertex = data.subarray(offset, offset + vertexSize);
    const markerPosition = vertex.indexOf(Buffer.from([0xff, 0xff, 0xff, 0xff]));
    const actualUvOffset = markerPosition !== -1 && markerPosition + 12 <= vertexSize ? markerPosition + 4 : uvOffset;

    vertices.push([safeFloat(vertex, 0), safeFloat(vertex, 4), safeFloat(vertex, 8)]);
    uvs.push([
      actualUvOffset + 8 <= vertexSize ? safeFloat(vertex, actualUvOffset) : 0,
      actualUvOffset + 8 <= vertexSize ? 1 - safeFloat(vertex, actualUvOffset + 4) : 0
    ]);
  }

  return { vertices, uvs };
}

function extractIndices(data) {
  const indices = [];

  for (let index = 0; index < data.length - 1; index += 2) {
    indices.push(data.readUInt16LE(index));
  }

  return indices;
}

function splitBatches(indices) {
  const batches = [];
  let current = [];

  for (let index = 0; index < indices.length; index += 1) {
    if (index > 2 && index + 1 < indices.length && indices[index] === 0 && indices[index + 1] === 1 && current.length > 0) {
      batches.push(current);
      current = [];
    }

    current.push(indices[index]);
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

function safeFloat(buffer, offset) {
  if (offset + 4 > buffer.length) {
    return 0;
  }

  const value = buffer.readFloatLE(offset);
  return Number.isFinite(value) ? value : 0;
}

function mode(values) {
  const counts = new Map();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0];
}

function computeBounds(vertices) {
  if (vertices.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      radius: 1
    };
  }

  const min = [...vertices[0]];
  const max = [...vertices[0]];

  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }

  const center = min.map((value, axis) => (value + max[axis]) / 2);
  let radius = 1;

  for (const vertex of vertices) {
    radius = Math.max(radius, Math.hypot(vertex[0] - center[0], vertex[1] - center[1], vertex[2] - center[2]));
  }

  return { min, max, center, radius };
}

function maxValue(values) {
  let max = Number.NEGATIVE_INFINITY;

  for (const value of values) {
    max = Math.max(max, value);
  }

  return max;
}

function sanitizeName(name) {
  return String(name).replace(/[^\w -]/g, "_");
}
