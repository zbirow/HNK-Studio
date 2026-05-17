const KEYWORD = Buffer.from("RenderModelTemplate\0", "ascii");
const MAGIC = Buffer.from([0x50, 0x10, 0x10, 0x00]);

export function parseSkeletons(fileBuffer) {
  const skeletons = [];
  let searchOffset = 0;

  while (searchOffset < fileBuffer.length) {
    const keywordOffset = fileBuffer.indexOf(KEYWORD, searchOffset);

    if (keywordOffset === -1) {
      break;
    }

    const nameStart = keywordOffset + KEYWORD.length;
    const nameEnd = fileBuffer.indexOf(0, nameStart);

    if (nameEnd === -1) {
      break;
    }

    let metaOffset = nameEnd;

    while (metaOffset < fileBuffer.length && fileBuffer[metaOffset] === 0) {
      metaOffset += 1;
    }

    if (metaOffset + 8 <= fileBuffer.length && fileBuffer.subarray(metaOffset + 4, metaOffset + 8).equals(MAGIC)) {
      const size = fileBuffer.readUInt32LE(metaOffset);
      const chunkStart = metaOffset + 8;
      const chunk = fileBuffer.subarray(chunkStart, Math.min(chunkStart + size, fileBuffer.length));
      const rawName = fileBuffer.subarray(nameStart, nameEnd).toString("ascii").trim();
      const parsed = parseSkeletonChunk(chunk, rawName || `Skeleton_${skeletons.length + 1}`);

      if (parsed) {
        skeletons.push(parsed);
      }

      searchOffset = chunkStart + size;
    } else {
      searchOffset = nameEnd + 1;
    }
  }

  return skeletons;
}

export function findSkeletonForAsset(skeletons, assetName) {
  if (!skeletons.length) {
    return null;
  }

  const normalizedAsset = normalizeName(assetName);
  return (
    skeletons.find((skeleton) => normalizeName(skeleton.name) === normalizedAsset) ??
    skeletons.find((skeleton) => normalizeName(skeleton.name).includes(normalizedAsset) || normalizedAsset.includes(normalizeName(skeleton.name))) ??
    skeletons[0]
  );
}

function parseSkeletonChunk(chunk, fallbackName) {
  const bones = extractBoneNames(chunk);

  if (bones.length === 0) {
    return null;
  }

  const parents = findParentArray(chunk, bones.length);
  const rawMatrices = extractMatrices(chunk, bones.length);
  const positions = buildWorldPositions(rawMatrices, parents);

  return {
    name: fallbackName,
    bones,
    parents,
    positions
  };
}

function extractBoneNames(chunk) {
  const rootOffset = chunk.indexOf(Buffer.from("x_root\0", "ascii"));

  if (rootOffset === -1) {
    return [];
  }

  const bones = [];
  let offset = rootOffset;

  while (offset < chunk.length) {
    const end = chunk.indexOf(0, offset);

    if (end === -1) {
      break;
    }

    const raw = chunk.subarray(offset, end);

    if (raw.length === 0 || !Array.from(raw).every((byte) => byte >= 32 && byte <= 126)) {
      break;
    }

    const name = raw.toString("ascii");

    if (name === "Mesh") {
      break;
    }

    bones.push(name);
    offset = end + 1;
  }

  return bones;
}

function findParentArray(chunk, boneCount) {
  const size = boneCount * 2;

  for (let offset = 0; offset <= chunk.length - size; offset += 1) {
    const values = [];

    for (let index = 0; index < boneCount; index += 1) {
      values.push(chunk.readInt16LE(offset + index * 2));
    }

    if (values[0] === -1 && values.every((value) => value >= -1 && value < boneCount)) {
      return values;
    }
  }

  return Array.from({ length: boneCount }, () => -1);
}

function extractMatrices(chunk, boneCount) {
  const start = findMatrixBlock(chunk, boneCount);

  if (start === -1) {
    return Array.from({ length: boneCount }, () => identityMatrix());
  }

  return Array.from({ length: boneCount }, (_item, index) => {
    const offset = start + index * 64;
    const matrix = [];

    for (let valueIndex = 0; valueIndex < 16; valueIndex += 1) {
      matrix.push(chunk.readFloatLE(offset + valueIndex * 4));
    }

    return matrix;
  });
}

function findMatrixBlock(chunk, boneCount) {
  const blockSize = boneCount * 64;
  let bestScore = -1;
  let bestOffset = -1;

  for (let offset = 0; offset <= chunk.length - blockSize; offset += 16) {
    let valid = 0;
    let scoreSum = 0;

    for (let boneIndex = 0; boneIndex < boneCount; boneIndex += 1) {
      const matrixOffset = offset + boneIndex * 64;
      const raw = [];

      for (let valueIndex = 0; valueIndex < 16; valueIndex += 1) {
        raw.push(chunk.readFloatLE(matrixOffset + valueIndex * 4));
      }

      if (!isFiniteMatrix(raw)) {
        continue;
      }

      const score = scoreMatrix(raw);

      if (score >= 3) {
        valid += 1;
        scoreSum += score;
      }
    }

    if (valid > boneCount * 0.6 && scoreSum > bestScore) {
      bestScore = scoreSum;
      bestOffset = offset;
    }
  }

  return bestOffset;
}

function buildWorldPositions(rawMatrices, parents) {
  const world = Array.from({ length: rawMatrices.length }, () => null);

  for (let index = 0; index < rawMatrices.length; index += 1) {
    const matrix = isFiniteMatrix(rawMatrices[index]) ? rawMatrices[index] : identityMatrix();
    const parent = parents[index];

    if (parent === -1 || !world[parent]) {
      world[index] = matrix;
    } else {
      world[index] = multiplyMatrices(matrix, world[parent]);
    }
  }

  let positions = world.map((matrix) => (isFiniteMatrix(matrix) ? [matrix[12], matrix[13], matrix[14]] : [0, 0, 0]));
  positions = normalizePositions(positions);
  positions = rotatePositions(positions, 45, 0, 135);

  return positions;
}

function normalizePositions(positions) {
  if (positions.length === 0) {
    return positions;
  }

  const center = [0, 1, 2].map((axis) => positions.reduce((sum, point) => sum + point[axis], 0) / positions.length);
  const centered = positions.map((point) => [point[0] - center[0], point[1] - center[1], point[2] - center[2]]);
  const scale = Math.max(...centered.map((point) => Math.hypot(point[0], point[1], point[2])), 1);

  return centered.map((point) => [point[0] / scale, point[1] / scale, point[2] / scale]);
}

function rotatePositions(positions, rxDegrees, ryDegrees, rzDegrees) {
  const rx = (rxDegrees * Math.PI) / 180;
  const ry = (ryDegrees * Math.PI) / 180;
  const rz = (rzDegrees * Math.PI) / 180;
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);

  return positions.map(([x, y, z]) => {
    const y1 = y * cosX - z * sinX;
    const z1 = y * sinX + z * cosX;
    const x2 = x * cosY + z1 * sinY;
    const z2 = -x * sinY + z1 * cosY;
    const x3 = x2 * cosZ - y1 * sinZ;
    const y3 = x2 * sinZ + y1 * cosZ;
    return [x3, y3, z2];
  });
}

function multiplyMatrices(left, right) {
  const output = Array.from({ length: 16 }, () => 0);

  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      for (let inner = 0; inner < 4; inner += 1) {
        output[row * 4 + col] += left[row * 4 + inner] * right[inner * 4 + col];
      }
    }
  }

  return output;
}

function identityMatrix() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function isFiniteMatrix(matrix) {
  return matrix.every((value) => Number.isFinite(value) && Math.abs(value) < 1e6);
}

function scoreMatrix(raw) {
  let score = 0;

  if (Math.abs(raw[3]) < 1e-3) score += 1;
  if (Math.abs(raw[7]) < 1e-3) score += 1;
  if (Math.abs(raw[11]) < 1e-3) score += 1;
  if (Math.abs(raw[15] - 1) < 1e-3) score += 2;

  return score;
}

function normalizeName(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
