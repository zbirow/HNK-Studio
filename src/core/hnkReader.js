import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export async function readHnkFile(filePath) {
  const buffer = await readFile(filePath);
  return {
    fileName: basename(filePath),
    filePath,
    fileSize: buffer.length,
    buffer,
    ...parseHnkBuffer(buffer)
  };
}

export function parseHnkBuffer(buffer) {
  const records = [];
  const warnings = [];
  let offset = 0;
  let index = 0;

  while (offset + 8 <= buffer.length) {
    const start = offset;
    const size = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + size;

    if (dataEnd > buffer.length) {
      const message = `Record ${index} is truncated. Expected ${size} bytes, found ${buffer.length - dataStart}.`;
      warnings.push(message);
      records.push({
        index,
        size,
        type,
        start,
        dataStart,
        end: buffer.length,
        data: buffer.subarray(dataStart),
        malformed: true,
        warning: message
      });
      return { records, warnings };
    }

    records.push({
      index,
      size,
      type,
      start,
      dataStart,
      end: dataEnd,
      data: buffer.subarray(dataStart, dataEnd),
      malformed: false
    });

    offset = dataEnd;
    index += 1;
  }

  if (offset < buffer.length) {
    warnings.push(`${buffer.length - offset} trailing bytes could not form a full record header.`);
  }

  return { records, warnings };
}

export function parseFilenameHeader(data) {
  if (data.length < 10) {
    return {
      folder: "",
      filename: "ErrorParsing",
      displayName: "ErrorParsing",
      error: "Filename header is shorter than 10 bytes."
    };
  }

  const folderLength = data.readInt16LE(6);
  const filenameLength = data.readInt16LE(8);
  const folderOffset = 10;
  const filenameOffset = folderOffset + Math.max(folderLength, 0);
  const folderEnd = folderOffset + Math.max(folderLength, 0);
  const filenameEnd = filenameOffset + Math.max(filenameLength, 0);

  if (folderLength < 0 || filenameLength < 0 || filenameEnd > data.length) {
    return {
      folder: "",
      filename: "ErrorParsing",
      displayName: "ErrorParsing",
      error: "Filename header has invalid string lengths."
    };
  }

  const folder = data.subarray(folderOffset, folderEnd).toString("utf8").replace(/\0+$/u, "");
  const filename = data.subarray(filenameOffset, filenameEnd).toString("utf8").replace(/\0+$/u, "");

  return {
    folder,
    filename,
    displayName: filename || folder || "Unnamed",
    error: null
  };
}

export function makeHexPreview(data, maxBytes = 64) {
  const lines = [];
  const limit = Math.min(data.length, maxBytes);

  for (let index = 0; index < limit; index += 16) {
    const chunk = data.subarray(index, index + 16);
    const hex = Array.from(chunk, (byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    const ascii = Array.from(chunk, (byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : ".")).join("");
    lines.push(`${index.toString(16).toUpperCase().padStart(4, "0")}: ${hex.padEnd(47, " ")}  ${ascii}`);
  }

  if (data.length > limit) {
    lines.push("...");
  }

  return lines.join("\n");
}
