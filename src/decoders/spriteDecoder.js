import { decodeTextureToRgba } from "../exporters/textureExporter.js";

export function parseRenderSprite(data) {
  if (data.length < 20) {
    return [];
  }

  const firstPointer = data.readUInt32LE(16);
  const count = Math.floor((firstPointer - 16) / 4);
  const sprites = [];

  if (count <= 0 || count > 10000) {
    return sprites;
  }

  for (let index = 0; index < count; index += 1) {
    const pointerOffset = 16 + index * 4;

    if (pointerOffset + 4 > data.length) {
      break;
    }

    const pointer = data.readUInt32LE(pointerOffset);
    const spriteData = data.subarray(pointer, pointer + 64);

    if (spriteData.length !== 64) {
      continue;
    }

    sprites.push({
      id: index,
      hash: spriteData.subarray(0, 4).toString("hex").toUpperCase(),
      u1: spriteData.readFloatLE(16),
      v1: spriteData.readFloatLE(20),
      u2: spriteData.readFloatLE(24),
      v2: spriteData.readFloatLE(28)
    });
  }

  return sprites;
}

export function cropSpriteRgba(textureData, texture, sprite) {
  const rgba = decodeTextureToRgba(textureData, texture);
  const x1 = Math.round(sprite.u1 * texture.width);
  const y1 = Math.round(sprite.v1 * texture.height);
  const x2 = Math.round(sprite.u2 * texture.width);
  const y2 = Math.round(sprite.v2 * texture.height);
  const left = clamp(Math.min(x1, x2), 0, texture.width);
  const right = clamp(Math.max(x1, x2), 0, texture.width);
  const top = clamp(Math.min(y1, y2), 0, texture.height);
  const bottom = clamp(Math.max(y1, y2), 0, texture.height);
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const output = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * texture.width + left) * 4;
    const sourceEnd = sourceStart + width * 4;
    rgba.copy(output, y * width * 4, sourceStart, sourceEnd);
  }

  return { width, height, rgba: output };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
