import { decodeTextureToRgba } from "../exporters/textureExporter.js";

export function parseRenderSprite(data) {
  return parseRenderSpriteLayout(data).sprites;
}

export function parseRenderSpriteLayout(data) {
  const defaultLayout = parseRenderSpriteAt(data, 16);

  if (defaultLayout?.sprites.length > 0) {
    return { tableOffset: defaultLayout.tableOffset, count: defaultLayout.count, sprites: defaultLayout.sprites };
  }

  const candidates = [];
  let best = { tableOffset: 16, count: 0, sprites: [], score: 0 };

  for (let offset = 0; offset <= Math.min(64, data.length - 4); offset += 4) {
    if (offset !== 16) {
      candidates.push(offset);
    }
  }

  for (const tableOffset of candidates) {
    const parsed = parseRenderSpriteAt(data, tableOffset);

    if (parsed && isBetterSpriteLayout(parsed, best)) {
      best = parsed;
    }
  }

  return { tableOffset: best.tableOffset, count: best.count, sprites: best.sprites };
}

export function writeRenderSpriteEntries(data, entries) {
  const layout = parseRenderSpriteLayout(data);
  const spritesById = new Map(layout.sprites.map((sprite) => [sprite.id, sprite]));
  let updated = 0;

  for (const entry of entries) {
    const sprite = spritesById.get(Number(entry.id));

    if (!sprite) {
      continue;
    }

    writeSpriteHash(data, sprite.dataOffset, entry.hash ?? sprite.hash);
    writeSpriteFloat(data, sprite.dataOffset + 16, entry.u1);
    writeSpriteFloat(data, sprite.dataOffset + 20, entry.v1);
    writeSpriteFloat(data, sprite.dataOffset + 24, entry.u2);
    writeSpriteFloat(data, sprite.dataOffset + 28, entry.v2);
    updated += 1;
  }

  return updated;
}

function parseRenderSpriteAt(data, tableOffset) {
  if (data.length < tableOffset + 4) {
    return null;
  }

  const firstPointer = data.readUInt32LE(tableOffset);
  const count = (firstPointer - tableOffset) / 4;

  if (!Number.isInteger(count) || count <= 0 || count > 10000 || firstPointer >= data.length) {
    return null;
  }

  const sprites = [];
  let score = tableOffset === 16 ? 8 : 0;

  for (let index = 0; index < count; index += 1) {
    const pointerOffset = tableOffset + index * 4;

    if (pointerOffset + 4 > data.length) {
      break;
    }

    const pointer = data.readUInt32LE(pointerOffset);
    const spriteData = data.subarray(pointer, pointer + 64);

    if (spriteData.length !== 64) {
      continue;
    }

    const sprite = {
      id: index,
      pointerOffset,
      dataOffset: pointer,
      hash: spriteData.subarray(0, 4).toString("hex").toUpperCase(),
      u1: spriteData.readFloatLE(16),
      v1: spriteData.readFloatLE(20),
      u2: spriteData.readFloatLE(24),
      v2: spriteData.readFloatLE(28)
    };

    if (isPlausibleSprite(sprite, pointer, firstPointer)) {
      score += 4;
    }

    sprites.push(sprite);
  }

  return { tableOffset, count, sprites, score };
}

function isBetterSpriteLayout(candidate, current) {
  if (candidate.score !== current.score) {
    return candidate.score > current.score;
  }

  if (candidate.tableOffset === 16 && current.tableOffset !== 16) {
    return true;
  }

  return candidate.sprites.length > current.sprites.length;
}

function isPlausibleSprite(sprite, pointer, firstPointer) {
  const values = [sprite.u1, sprite.v1, sprite.u2, sprite.v2];

  return (
    pointer >= firstPointer &&
    pointer % 4 === 0 &&
    values.every((value) => Number.isFinite(value) && value >= -0.25 && value <= 1.25) &&
    Math.abs(sprite.u2 - sprite.u1) > 0 &&
    Math.abs(sprite.v2 - sprite.v1) > 0
  );
}

export function cropSpriteRgba(textureData, texture, sprite) {
  const rgba = decodeTextureToRgba(textureData, texture);
  const u1 = Number(sprite.u1);
  const v1 = Number(sprite.v1);
  const u2 = Number(sprite.u2);
  const v2 = Number(sprite.v2);

  if (![u1, v1, u2, v2].every(Number.isFinite)) {
    return { width: 1, height: 1, rgba: Buffer.alloc(4) };
  }

  const x1 = Math.round(u1 * texture.width);
  const y1 = Math.round(v1 * texture.height);
  const x2 = Math.round(u2 * texture.width);
  const y2 = Math.round(v2 * texture.height);
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

function writeSpriteHash(data, offset, hash) {
  const value = String(hash ?? "").replace(/[^a-f0-9]/giu, "").toUpperCase();

  if (!/^[A-F0-9]{8}$/u.test(value)) {
    throw new Error(`Sprite hash "${hash}" is invalid.`);
  }

  Buffer.from(value, "hex").copy(data, offset);
}

function writeSpriteFloat(data, offset, value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new Error("Sprite table contains an invalid number.");
  }

  data.writeFloatLE(number, offset);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
