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

export function decodeDdsToRgba(ddsData) {
  const dds = Buffer.from(ddsData);

  if (dds.length < 128 || dds.toString("ascii", 0, 4) !== "DDS ") {
    throw new Error("Selected file is not a valid DDS texture.");
  }

  const headerSize = dds.readUInt32LE(4);
  const pixelFormatSize = dds.readUInt32LE(76);

  if (headerSize !== 124 || pixelFormatSize !== 32) {
    throw new Error("DDS header is not supported.");
  }

  const height = dds.readUInt32LE(12);
  const width = dds.readUInt32LE(16);
  const pixelFormatFlags = dds.readUInt32LE(80);
  const fourCc = dds.toString("ascii", 84, 88).replace(/\0+$/u, "");
  const rgbBitCount = dds.readUInt32LE(88);
  const masks = {
    r: dds.readUInt32LE(92),
    g: dds.readUInt32LE(96),
    b: dds.readUInt32LE(100),
    a: dds.readUInt32LE(104)
  };
  let dataOffset = 128;
  let format = fourCc || "RGBA";
  let rgba = null;

  if ((pixelFormatFlags & 0x4) !== 0) {
    if (fourCc === "DX10") {
      if (dds.length < 148) {
        throw new Error("DDS DX10 header is incomplete.");
      }

      const dxgiFormat = dds.readUInt32LE(128);
      dataOffset = 148;
      ({ format, rgba } = decodeDx10Dds(dds.subarray(dataOffset), width, height, dxgiFormat));
    } else if (fourCc === "DXT1") {
      rgba = decodeDxt1(dds.subarray(dataOffset), width, height);
    } else if (fourCc === "DXT5") {
      rgba = decodeDxt5(dds.subarray(dataOffset), width, height);
    } else {
      throw new Error(`DDS compression ${fourCc || "unknown"} is not supported.`);
    }
  } else if ((pixelFormatFlags & 0x40) !== 0 || rgbBitCount > 0) {
    rgba = decodeUncompressedDds(dds.subarray(dataOffset), width, height, rgbBitCount, masks);
    format = `${rgbBitCount}-bit RGBA`;
  } else {
    throw new Error("DDS pixel format is not supported.");
  }

  return { width, height, format, rgba };
}

export function encodeRgbaToTextureData(rgba, texture) {
  const format = normalizeFormat(texture.format);
  const width = texture.width;
  const height = texture.height;

  if (rgba.length !== width * height * 4) {
    throw new Error("RGBA buffer size does not match the texture dimensions.");
  }

  if (format === "DXT1") {
    return encodeDxt1(rgba, width, height);
  }

  if (format === "DXT5") {
    return encodeDxt5(rgba, width, height);
  }

  if (format === "R8G8B8A8") {
    return Buffer.from(rgba);
  }

  throw new Error(`Texture editing is not supported for texture format ${texture.format}.`);
}

export function getTextureDataSize(texture) {
  const format = normalizeFormat(texture.format);
  const blocksWide = Math.max(1, Math.ceil(texture.width / 4));
  const blocksHigh = Math.max(1, Math.ceil(texture.height / 4));

  if (format === "DXT1") {
    return blocksWide * blocksHigh * 8;
  }

  if (format === "DXT5") {
    return blocksWide * blocksHigh * 16;
  }

  if (format === "R8G8B8A8") {
    return texture.width * texture.height * 4;
  }

  return null;
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

function encodeDxt1(rgba, width, height) {
  const output = Buffer.alloc(getCompressedTextureDataSize(width, height, 8));
  let outputOffset = 0;

  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      encodeDxtColorBlock(rgba, width, height, x, y).copy(output, outputOffset);
      outputOffset += 8;
    }
  }

  return output;
}

function encodeDxt5(rgba, width, height) {
  const output = Buffer.alloc(getCompressedTextureDataSize(width, height, 16));
  let outputOffset = 0;

  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      encodeDxt5AlphaBlock(rgba, width, height, x, y).copy(output, outputOffset);
      encodeDxtColorBlock(rgba, width, height, x, y).copy(output, outputOffset + 8);
      outputOffset += 16;
    }
  }

  return output;
}

function getCompressedTextureDataSize(width, height, blockSize) {
  return Math.max(1, Math.ceil(width / 4)) * Math.max(1, Math.ceil(height / 4)) * blockSize;
}

function decodeDx10Dds(data, width, height, dxgiFormat) {
  if (dxgiFormat === 71 || dxgiFormat === 72) {
    return { format: "BC1/DXT1", rgba: decodeDxt1(data, width, height) };
  }

  if (dxgiFormat === 77 || dxgiFormat === 78) {
    return { format: "BC3/DXT5", rgba: decodeDxt5(data, width, height) };
  }

  if (dxgiFormat === 28 || dxgiFormat === 29) {
    return {
      format: "R8G8B8A8",
      rgba: decodeUncompressedDds(data, width, height, 32, {
        r: 0x000000ff,
        g: 0x0000ff00,
        b: 0x00ff0000,
        a: 0xff000000
      })
    };
  }

  if (dxgiFormat === 87 || dxgiFormat === 91) {
    return {
      format: "B8G8R8A8",
      rgba: decodeUncompressedDds(data, width, height, 32, {
        r: 0x00ff0000,
        g: 0x0000ff00,
        b: 0x000000ff,
        a: 0xff000000
      })
    };
  }

  throw new Error(`DDS DX10 format ${dxgiFormat} is not supported.`);
}

function decodeUncompressedDds(data, width, height, bitCount, masks) {
  const bytesPerPixel = bitCount / 8;

  if (!Number.isInteger(bytesPerPixel) || bytesPerPixel < 2 || bytesPerPixel > 4) {
    throw new Error(`${bitCount}-bit uncompressed DDS textures are not supported.`);
  }

  const expectedSize = width * height * bytesPerPixel;

  if (data.length < expectedSize) {
    throw new Error("DDS pixel data is incomplete.");
  }

  const rgba = Buffer.alloc(width * height * 4);

  for (let index = 0; index < width * height; index += 1) {
    const value = data.readUIntLE(index * bytesPerPixel, bytesPerPixel);
    const outputOffset = index * 4;
    rgba[outputOffset] = extractMaskedChannel(value, masks.r, 0);
    rgba[outputOffset + 1] = extractMaskedChannel(value, masks.g, 0);
    rgba[outputOffset + 2] = extractMaskedChannel(value, masks.b, 0);
    rgba[outputOffset + 3] = masks.a ? extractMaskedChannel(value, masks.a, 255) : 255;
  }

  return rgba;
}

function extractMaskedChannel(value, mask, fallback) {
  if (!mask) {
    return fallback;
  }

  const shift = countTrailingZeroBits(mask);
  const bits = countSetBits(mask >>> shift);
  const raw = ((value & mask) >>> 0) >>> shift;
  const max = (2 ** bits) - 1;

  if (max <= 0) {
    return fallback;
  }

  return Math.round((raw / max) * 255);
}

function countTrailingZeroBits(value) {
  let count = 0;
  let current = value >>> 0;

  while (count < 32 && (current & 1) === 0) {
    current >>>= 1;
    count += 1;
  }

  return count;
}

function countSetBits(value) {
  let count = 0;
  let current = value >>> 0;

  while (current) {
    count += current & 1;
    current >>>= 1;
  }

  return count;
}

function encodeDxt5AlphaBlock(rgba, width, height, blockX, blockY) {
  const block = Buffer.alloc(8);
  const alphas = [];

  for (let py = 0; py < 4; py += 1) {
    for (let px = 0; px < 4; px += 1) {
      const x = Math.min(width - 1, blockX + px);
      const y = Math.min(height - 1, blockY + py);
      alphas.push(rgba[(y * width + x) * 4 + 3]);
    }
  }

  const alpha0 = Math.max(...alphas);
  const alpha1 = Math.min(...alphas);
  const table = makeDxt5AlphaTable(alpha0, alpha1);
  let bits = 0n;

  for (let index = 0; index < alphas.length; index += 1) {
    const alphaIndex = findNearestAlphaIndex(alphas[index], table);
    bits |= BigInt(alphaIndex) << BigInt(index * 3);
  }

  block[0] = alpha0;
  block[1] = alpha1;

  for (let index = 0; index < 6; index += 1) {
    block[2 + index] = Number((bits >> BigInt(index * 8)) & 0xffn);
  }

  return block;
}

function makeDxt5AlphaTable(alpha0, alpha1) {
  const table = [alpha0, alpha1];

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

  return table;
}

function findNearestAlphaIndex(alpha, table) {
  let bestIndex = 0;
  let bestDistance = Infinity;

  for (let index = 0; index < table.length; index += 1) {
    const distance = Math.abs(alpha - table[index]);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function encodeDxtColorBlock(rgba, width, height, blockX, blockY) {
  const block = Buffer.alloc(8);
  const pixels = [];
  const opaquePixels = [];

  for (let py = 0; py < 4; py += 1) {
    for (let px = 0; px < 4; px += 1) {
      const x = Math.min(width - 1, blockX + px);
      const y = Math.min(height - 1, blockY + py);
      const offset = (y * width + x) * 4;
      const pixel = [rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]];
      pixels.push(pixel);

      if (pixel[3] > 8) {
        opaquePixels.push(pixel);
      }
    }
  }

  const colorPixels = opaquePixels.length > 0 ? opaquePixels : pixels;
  const endpoints = findColorEndpoints(colorPixels);
  let color0 = rgbTo565(endpoints.max);
  let color1 = rgbTo565(endpoints.min);

  if (color0 < color1) {
    [color0, color1] = [color1, color0];
  }

  const colors = makeDxtColors(color0, color1);
  let codes = 0;

  for (let index = 0; index < pixels.length; index += 1) {
    const colorIndex = findNearestColorIndex(pixels[index], colors);
    codes |= colorIndex << (index * 2);
  }

  block.writeUInt16LE(color0, 0);
  block.writeUInt16LE(color1, 2);
  block.writeUInt32LE(codes >>> 0, 4);
  return block;
}

function findColorEndpoints(pixels) {
  let min = [255, 255, 255];
  let max = [0, 0, 0];

  for (const pixel of pixels) {
    for (let channel = 0; channel < 3; channel += 1) {
      min[channel] = Math.min(min[channel], pixel[channel]);
      max[channel] = Math.max(max[channel], pixel[channel]);
    }
  }

  return { min, max };
}

function findNearestColorIndex(pixel, colors) {
  let bestIndex = 0;
  let bestDistance = Infinity;

  for (let index = 0; index < colors.length; index += 1) {
    const color = colors[index];
    const dr = pixel[0] - color[0];
    const dg = pixel[1] - color[1];
    const db = pixel[2] - color[2];
    const distance = dr * dr + dg * dg + db * db;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function rgbTo565(pixel) {
  const r = Math.round((pixel[0] / 255) * 31) & 0x1f;
  const g = Math.round((pixel[1] / 255) * 63) & 0x3f;
  const b = Math.round((pixel[2] / 255) * 31) & 0x1f;
  return (r << 11) | (g << 5) | b;
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
