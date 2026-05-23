import zlib from "node:zlib";

export function createTextureDds(textureData, texture) {
  const format = normalizeFormat(texture.format);

  if (format === "DXT1" || format === "DXT5") {
    return Buffer.concat([createCompressedDdsHeader(texture.width, texture.height, format), textureData]);
  }

  const rgba = decodeTextureToRgba(textureData, texture);
  return Buffer.concat([createRgbaDdsHeader(texture.width, texture.height), rgba]);
}

export function createTexturePng(textureData, texture) {
  const rgba = decodeTextureToRgba(textureData, texture);
  return encodeRgbaPng(texture.width, texture.height, rgba);
}

export function createTextureDataUrl(textureData, texture) {
  return `data:image/png;base64,${createTexturePng(textureData, texture).toString("base64")}`;
}

export function decodeTextureToRgba(textureData, texture) {
  const format = normalizeFormat(texture.format);

  if (format === "DXT1") {
    return decodeDxt1(textureData, texture.width, texture.height);
  }

  if (format === "DXT5") {
    return decodeDxt5(textureData, texture.width, texture.height);
  }

  if (format === "CMPR") {
    return decodeCmpr(textureData, texture.width, texture.height);
  }

  if (format === "BGRA8888") {
    return decodeWiiBgra8888(textureData, texture.width, texture.height);
  }

  if (format === "R8G8B8A8") {
    return Buffer.from(textureData.subarray(0, texture.width * texture.height * 4));
  }

  throw new Error(`PNG preview is not supported for texture format ${texture.format}.`);
}

function normalizeFormat(format) {
  const upper = String(format ?? "").toUpperCase();

  if (upper.includes("DXT1")) {
    return "DXT1";
  }

  if (upper.includes("DXT5")) {
    return "DXT5";
  }

  if (upper.includes("CMPR") || upper.includes("CRMP")) {
    return "CMPR";
  }

  if (upper.includes("R8G8B8A8")) {
    return "R8G8B8A8";
  }

  if (upper.includes("BGRA8888") || upper.includes("B8G8R8A8")) {
    return "BGRA8888";
  }

  return upper;
}

function createCompressedDdsHeader(width, height, format) {
  const header = Buffer.alloc(128);
  const blockSize = format === "DXT1" ? 8 : 16;
  const linearSize = Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * blockSize;

  header.write("DDS ", 0, "ascii");
  header.writeUInt32LE(124, 4);
  header.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, 8);
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(width, 16);
  header.writeUInt32LE(linearSize, 20);
  header.writeUInt32LE(0, 24);
  header.writeUInt32LE(0, 28);
  header.writeUInt32LE(32, 76);
  header.writeUInt32LE(0x4, 80);
  header.write(format, 84, "ascii");
  header.writeUInt32LE(0x1000, 108);

  return header;
}

function createRgbaDdsHeader(width, height) {
  const header = Buffer.alloc(128);

  header.write("DDS ", 0, "ascii");
  header.writeUInt32LE(124, 4);
  header.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x8 | 0x1000, 8);
  header.writeUInt32LE(height, 12);
  header.writeUInt32LE(width, 16);
  header.writeUInt32LE(width * 4, 20);
  header.writeUInt32LE(0, 24);
  header.writeUInt32LE(0, 28);
  header.writeUInt32LE(32, 76);
  header.writeUInt32LE(0x41, 80);
  header.writeUInt32LE(32, 88);
  header.writeUInt32LE(0x000000ff, 92);
  header.writeUInt32LE(0x0000ff00, 96);
  header.writeUInt32LE(0x00ff0000, 100);
  header.writeUInt32LE(0xff000000, 104);
  header.writeUInt32LE(0x1000, 108);

  return header;
}

function decodeDxt1(data, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  let offset = 0;

  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      if (offset + 8 > data.length) {
        return rgba;
      }

      decodeDxt1Block(data.subarray(offset, offset + 8), x, y, width, height, rgba);
      offset += 8;
    }
  }

  return rgba;
}

function decodeDxt5(data, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  let offset = 0;

  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      if (offset + 16 > data.length) {
        return rgba;
      }

      const alphaValues = decodeDxt5Alpha(data.subarray(offset, offset + 8));
      decodeDxt1Block(data.subarray(offset + 8, offset + 16), x, y, width, height, rgba, alphaValues);
      offset += 16;
    }
  }

  return rgba;
}

function decodeCmpr(data, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  const blocksWide = Math.ceil(width / 8);

  for (let blockIndex = 0; blockIndex < Math.floor(data.length / 32); blockIndex += 1) {
    const blockX = blockIndex % blocksWide;
    const blockY = Math.floor(blockIndex / blocksWide);
    const block = data.subarray(blockIndex * 32, blockIndex * 32 + 32);
    const offsets = [
      [0, 0],
      [4, 0],
      [0, 4],
      [4, 4]
    ];

    for (let part = 0; part < 4; part += 1) {
      const [dx, dy] = offsets[part];
      decodeDxt1Block(block.subarray(part * 8, part * 8 + 8), blockX * 8 + dx, blockY * 8 + dy, width, height, rgba, null, true, true);
    }
  }

  return rgba;
}

function decodeWiiBgra8888(data, width, height) {
  const rgba = Buffer.alloc(width * height * 4);
  let offset = 0;

  for (let tileY = 0; tileY < height; tileY += 4) {
    for (let tileX = 0; tileX < width; tileX += 4) {
      if (offset + 64 > data.length) {
        return rgba;
      }

      for (let py = 0; py < 4; py += 1) {
        for (let px = 0; px < 4; px += 1) {
          const targetX = tileX + px;
          const targetY = tileY + py;

          if (targetX >= width || targetY >= height) {
            continue;
          }

          const pixelIndex = py * 4 + px;
          const arOffset = offset + pixelIndex * 2;
          const gbOffset = offset + 32 + pixelIndex * 2;
          const outputOffset = (targetY * width + targetX) * 4;

          rgba[outputOffset] = data[arOffset + 1];
          rgba[outputOffset + 1] = data[gbOffset];
          rgba[outputOffset + 2] = data[gbOffset + 1];
          rgba[outputOffset + 3] = data[arOffset];
        }
      }

      offset += 64;
    }
  }

  return rgba;
}

function decodeDxt1Block(block, x, y, width, height, rgba, alphaValues = null, swapRgb565 = false, bigEndianCodes = false) {
  const color0 = swapRgb565 ? swap16(block.readUInt16LE(0)) : block.readUInt16LE(0);
  const color1 = swapRgb565 ? swap16(block.readUInt16LE(2)) : block.readUInt16LE(2);
  const codes = bigEndianCodes ? block.readUInt32BE(4) : block.readUInt32LE(4);
  const colors = makeDxtColors(color0, color1);

  for (let py = 0; py < 4; py += 1) {
    for (let px = 0; px < 4; px += 1) {
      const targetX = x + px;
      const targetY = y + py;

      if (targetX >= width || targetY >= height) {
        continue;
      }

      const pixelIndex = py * 4 + px;
      const colorIndex = bigEndianCodes ? (codes >> (2 * (15 - pixelIndex))) & 0x03 : (codes >> (2 * pixelIndex)) & 0x03;
      const source = colors[colorIndex];
      const outputOffset = (targetY * width + targetX) * 4;
      rgba[outputOffset] = source[0];
      rgba[outputOffset + 1] = source[1];
      rgba[outputOffset + 2] = source[2];
      rgba[outputOffset + 3] = alphaValues ? alphaValues[py * 4 + px] : source[3];
    }
  }
}

function makeDxtColors(color0, color1) {
  const c0 = rgb565(color0);
  const c1 = rgb565(color1);
  const colors = [c0, c1];

  if (color0 > color1) {
    colors.push([
      Math.round((2 * c0[0] + c1[0]) / 3),
      Math.round((2 * c0[1] + c1[1]) / 3),
      Math.round((2 * c0[2] + c1[2]) / 3),
      255
    ]);
    colors.push([
      Math.round((c0[0] + 2 * c1[0]) / 3),
      Math.round((c0[1] + 2 * c1[1]) / 3),
      Math.round((c0[2] + 2 * c1[2]) / 3),
      255
    ]);
  } else {
    colors.push([
      Math.round((c0[0] + c1[0]) / 2),
      Math.round((c0[1] + c1[1]) / 2),
      Math.round((c0[2] + c1[2]) / 2),
      255
    ]);
    colors.push([0, 0, 0, 0]);
  }

  return colors;
}

function decodeDxt5Alpha(block) {
  const alpha0 = block[0];
  const alpha1 = block[1];
  const table = [alpha0, alpha1];
  let bits = 0n;

  for (let index = 0; index < 6; index += 1) {
    bits |= BigInt(block[2 + index]) << BigInt(index * 8);
  }

  if (alpha0 > alpha1) {
    for (let index = 1; index <= 6; index += 1) {
      table.push(Math.round(((7 - index) * alpha0 + index * alpha1) / 7));
    }
  } else {
    for (let index = 1; index <= 4; index += 1) {
      table.push(Math.round(((5 - index) * alpha0 + index * alpha1) / 5));
    }
    table.push(0, 255);
  }

  return Array.from({ length: 16 }, (_item, index) => {
    const alphaIndex = Number((bits >> BigInt(index * 3)) & 0x07n);
    return table[alphaIndex];
  });
}

function rgb565(value) {
  return [
    (((value >> 11) & 0x1f) * 255) / 31,
    (((value >> 5) & 0x3f) * 255) / 63,
    ((value & 0x1f) * 255) / 31,
    255
  ].map(Math.round);
}

function swap16(value) {
  return ((value & 0xff) << 8) | (value >> 8);
}

export function encodeRgbaPng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  const rows = Buffer.alloc((width * 4 + 1) * height);

  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * (width * 4 + 1);
    rows[rowOffset] = 0;
    rgba.copy(rows, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);

  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let index = 0; index < 8; index += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
