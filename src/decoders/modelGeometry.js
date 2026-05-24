import { RECORD_TYPES } from "../core/recordTypes.js";

const MODEL_VERTEX_RECORD_TYPES = new Set([
  RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA,
  RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_WII
]);

const MODEL_INDEX_RECORD_TYPES = new Set([
  RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_TABLE,
  RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_TABLE_WII
]);

const WII_MODEL_VERTEX_RECORD_TYPES = new Set([
  RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_WII
]);

const WII_MODEL_INDEX_RECORD_TYPES = new Set([
  RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_TABLE_WII
]);

const GX_PRIMITIVES = new Set([0x80, 0x90, 0x98, 0xa0, 0xa8, 0xb0, 0xb8]);
const WII_TEXCOORD_SCALE = 1024;
const WII_TEXCOORD_MAX = WII_TEXCOORD_SCALE * 4;

export function extractModelGeometry(records) {
  if (records.some((record) => WII_MODEL_VERTEX_RECORD_TYPES.has(record.type)) && records.some((record) => WII_MODEL_INDEX_RECORD_TYPES.has(record.type))) {
    return extractWiiModelGeometry(records);
  }

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

function extractWiiModelGeometry(records) {
  const vertexRecords = records.filter((record) => WII_MODEL_VERTEX_RECORD_TYPES.has(record.type)).map((record) => record.data);
  const indexRecords = records.filter((record) => WII_MODEL_INDEX_RECORD_TYPES.has(record.type)).map((record) => record.data);

  if (vertexRecords.length === 0 || indexRecords.length === 0) {
    throw new Error("Wii model has no vertex/display-list data.");
  }

  const vertices = [];
  const uvs = [];
  const faces = [];
  const groups = [];

  for (let blockIndex = 0; blockIndex < Math.min(vertexRecords.length, indexRecords.length); blockIndex += 1) {
    const blockGeometry = extractWiiVertices(vertexRecords[blockIndex]);
    const displayList = parseWiiDisplayList(indexRecords[blockIndex], blockGeometry.vertices.length);
    const blockFaceStart = faces.length;
    let sourceVertexSearchStart = 0;

    for (let segmentIndex = 0; segmentIndex < displayList.segments.length; segmentIndex += 1) {
      const segment = displayList.segments[segmentIndex];
      const segmentVertexCount = segment.maxPositionIndex + 1;
      const sourceVertexBase = findNextWiiVertexRange(blockGeometry.validPositions, sourceVertexSearchStart, segmentVertexCount);
      const texCoordRange = findNextWiiTexCoordRange(blockGeometry.data, sourceVertexBase + segmentVertexCount, segment.maxTexCoordIndex + 1);
      const refToVertexIndex = createWiiRefMapper(blockGeometry, sourceVertexBase, segmentVertexCount, texCoordRange, vertices, uvs);
      const groupFaceStart = faces.length;

      for (const command of segment.commands) {
        appendWiiPrimitiveFaces(command, faces, refToVertexIndex);
      }

      groups.push({
        mode: "submesh",
        name: `Block_${blockIndex}_Part_${segmentIndex}`,
        blockIndex,
        batchIndex: segmentIndex,
        faceStart: groupFaceStart,
        faceEnd: faces.length
      });

      sourceVertexSearchStart = sourceVertexBase + segmentVertexCount;
    }

    groups.push({
      mode: "block",
      name: `Block_${blockIndex}`,
      blockIndex,
      faceStart: blockFaceStart,
      faceEnd: faces.length
    });

  }

  return {
    vertices,
    uvs,
    faces,
    groups,
    bounds: computeBounds(vertices)
  };
}

function extractWiiVertices(data) {
  const vertexSize = 16;
  const vertices = [];
  const validPositions = [];
  const count = Math.floor(data.length / vertexSize);

  for (let index = 0; index < count; index += 1) {
    const offset = index * vertexSize;
    const vertex = [readFloat(data, offset, "BE"), readFloat(data, offset + 4, "BE"), readFloat(data, offset + 8, "BE")];
    const empty = vertex.every((value) => Math.abs(value) < 1e-12);
    const valid = !empty && vertex.every((value) => Number.isFinite(value) && Math.abs(value) < 10000);
    vertices.push(valid ? vertex : [0, 0, 0]);
    validPositions.push(valid);
  }

  return { data, vertices, validPositions };
}

function createWiiRefMapper(blockGeometry, sourceVertexBase, segmentVertexCount, texCoordRange, vertices, uvs) {
  const outputIndices = new Map();

  return (ref) => {
    if (ref.positionIndex < 0 || ref.positionIndex >= segmentVertexCount) {
      return null;
    }

    const sourceVertexIndex = sourceVertexBase + ref.positionIndex;

    if (!blockGeometry.validPositions[sourceVertexIndex]) {
      return null;
    }

    const key = `${ref.positionIndex}:${ref.texCoordIndex}`;

    if (!outputIndices.has(key)) {
      outputIndices.set(key, vertices.length);
      vertices.push(blockGeometry.vertices[sourceVertexIndex] ?? [0, 0, 0]);
      uvs.push(readWiiTexCoord(blockGeometry.data, texCoordRange, ref.texCoordIndex));
    }

    return outputIndices.get(key);
  };
}

function findNextWiiVertexRange(validPositions, startIndex, requiredCount) {
  if (requiredCount <= 0) {
    return startIndex;
  }

  for (let index = Math.max(0, startIndex); index + requiredCount <= validPositions.length; index += 1) {
    let valid = true;

    for (let offset = 0; offset < requiredCount; offset += 1) {
      if (!validPositions[index + offset]) {
        valid = false;
        index += offset;
        break;
      }
    }

    if (valid) {
      return index;
    }
  }

  return startIndex;
}

function findNextWiiTexCoordRange(data, startIndex, requiredPairCount) {
  const totalPairCount = Math.floor(data.length / 4);
  const candidates = [];
  const startPairIndex = Math.max(0, startIndex * 4);

  for (let index = startPairIndex; index < totalPairCount; index += 1) {
    if (!isWiiTexCoordPair(data, index)) {
      continue;
    }

    const pairStart = index;

    while (index < totalPairCount && isWiiTexCoordPair(data, index)) {
      index += 1;
    }

    const range = {
      pairStart,
      pairCount: index - pairStart
    };

    candidates.push(range);
  }

  if (candidates.length === 0) {
    return null;
  }

  const nearestRange = candidates[0];
  const missingPairs = requiredPairCount - nearestRange.pairCount;

  if (missingPairs <= 0 || missingPairs <= 4 || nearestRange.pairCount >= requiredPairCount * 0.9) {
    return nearestRange;
  }

  return candidates.find((range) => range.pairCount >= requiredPairCount) ?? nearestRange;
}

function isWiiTexCoordPair(data, pairIndex) {
  const offset = pairIndex * 4;

  if (offset + 4 > data.length) {
    return false;
  }

  const u = data.readUInt16BE(offset);
  const v = data.readUInt16BE(offset + 2);

  return u !== 0xffff && v !== 0xffff && u <= WII_TEXCOORD_MAX && v <= WII_TEXCOORD_MAX;
}

function readWiiTexCoord(data, texCoordRange, texCoordIndex) {
  if (!texCoordRange || texCoordIndex < 0 || texCoordRange.pairCount <= 0) {
    return [0, 0];
  }

  const safeTexCoordIndex = Math.min(texCoordIndex, texCoordRange.pairCount - 1);
  const offset = (texCoordRange.pairStart + safeTexCoordIndex) * 4;

  if (offset + 4 > data.length) {
    return [0, 0];
  }

  return [
    data.readUInt16BE(offset) / WII_TEXCOORD_SCALE,
    1 - data.readUInt16BE(offset + 2) / WII_TEXCOORD_SCALE
  ];
}

function parseWiiDisplayList(data, vertexCount) {
  const segments = [];
  let offset = 0;

  while (offset < data.length) {
    while (offset < data.length && data[offset] === 0) {
      offset += 1;
    }

    if (offset >= data.length) {
      break;
    }

    const candidates = [
      parseWiiDisplayListSegment(data, offset, "u16", vertexCount),
      parseWiiDisplayListSegment(data, offset, "u8", vertexCount)
    ].filter((candidate) => candidate.commands.length > 0 && candidate.maxPositionIndex < vertexCount);

    if (candidates.length === 0) {
      break;
    }

    candidates.sort((left, right) => right.score - left.score);
    const segment = candidates[0];
    segments.push(segment);
    offset = segment.endOffset;

    if (segment.endedBy === "invalid") {
      break;
    }
  }

  return { segments };
}

function parseWiiDisplayListSegment(data, startOffset, indexFormat, vertexCount) {
  const stride = indexFormat === "u16" ? 8 : 4;
  const commands = [];
  let offset = startOffset;
  let maxPositionIndex = 0;
  let maxTexCoordIndex = 0;
  let endedBy = "end";

  while (offset < data.length) {
    const commandOffset = offset;
    const op = data[offset];

    if (op === 0) {
      endedBy = "padding";
      break;
    }

    if (!GX_PRIMITIVES.has(op) || offset + 3 > data.length) {
      endedBy = "invalid";
      break;
    }

    const vertexCountInCommand = data.readUInt16BE(offset + 1);
    const dataOffset = offset + 3;
    const byteLength = vertexCountInCommand * stride;

    if (vertexCountInCommand <= 0 || vertexCountInCommand > 10000 || dataOffset + byteLength > data.length) {
      endedBy = "invalid";
      break;
    }

    const refs = [];

    for (let index = 0; index < vertexCountInCommand; index += 1) {
      const refOffset = dataOffset + index * stride;
      const ref = readWiiVertexRef(data, refOffset, indexFormat);
      maxPositionIndex = Math.max(maxPositionIndex, ref.positionIndex);
      maxTexCoordIndex = Math.max(maxTexCoordIndex, ref.texCoordIndex);
      refs.push(ref);
    }

    if (maxPositionIndex >= vertexCount) {
      endedBy = "invalid";
      break;
    }

    commands.push({
      op,
      refs,
      offset: commandOffset,
      indexFormat
    });
    offset = dataOffset + byteLength;
  }

  const vertexRefs = commands.reduce((total, command) => total + command.refs.length, 0);
  const endWeight = endedBy === "padding" || endedBy === "end" ? 10000000 : 0;

  return {
    commands,
    startOffset,
    endOffset: offset,
    indexFormat,
    maxPositionIndex,
    maxTexCoordIndex,
    endedBy,
    score: endWeight + commands.length * 100000 + vertexRefs * 100 + Math.max(0, offset - startOffset)
  };
}

function readWiiVertexRef(data, offset, indexFormat) {
  if (indexFormat === "u16") {
    return {
      positionIndex: data.readUInt16BE(offset),
      normalIndex: data.readUInt16BE(offset + 2),
      colorIndex: data.readUInt16BE(offset + 4),
      texCoordIndex: data.readUInt16BE(offset + 6)
    };
  }

  return {
    positionIndex: data[offset],
    normalIndex: data[offset + 1],
    colorIndex: data[offset + 2],
    texCoordIndex: data[offset + 3]
  };
}

function appendWiiPrimitiveFaces(command, faces, refToVertexIndex) {
  const refs = command.refs;

  if (command.op === 0x90) {
    for (let index = 0; index < refs.length - 2; index += 3) {
      pushWiiFace(faces, [refs[index], refs[index + 1], refs[index + 2]], refToVertexIndex);
    }
    return;
  }

  if (command.op === 0x98) {
    for (let index = 2; index < refs.length; index += 1) {
      const ordered = index % 2 === 0
        ? [refs[index - 2], refs[index - 1], refs[index]]
        : [refs[index - 1], refs[index - 2], refs[index]];
      pushWiiFace(faces, ordered, refToVertexIndex);
    }
    return;
  }

  if (command.op === 0xa0) {
    for (let index = 2; index < refs.length; index += 1) {
      pushWiiFace(faces, [refs[0], refs[index - 1], refs[index]], refToVertexIndex);
    }
    return;
  }

  if (command.op === 0x80) {
    for (let index = 0; index < refs.length - 3; index += 4) {
      pushWiiFace(faces, [refs[index], refs[index + 1], refs[index + 2]], refToVertexIndex);
      pushWiiFace(faces, [refs[index], refs[index + 2], refs[index + 3]], refToVertexIndex);
    }
  }
}

function pushWiiFace(faces, refs, refToVertexIndex) {
  if (new Set(refs.map((ref) => ref.positionIndex)).size !== 3) {
    return;
  }

  const face = refs.map((ref) => refToVertexIndex(ref));

  if (face.some((vertexIndex) => vertexIndex == null) || new Set(face).size !== 3) {
    return;
  }

  faces.push(face);
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

function safeFloat(buffer, offset, endian = "LE") {
  if (offset + 4 > buffer.length) {
    return 0;
  }

  const value = readFloat(buffer, offset, endian);
  return Number.isFinite(value) ? value : 0;
}

function readFloat(buffer, offset, endian = "LE") {
  if (offset + 4 > buffer.length) {
    return 0;
  }

  return endian === "BE" ? buffer.readFloatBE(offset) : buffer.readFloatLE(offset);
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
