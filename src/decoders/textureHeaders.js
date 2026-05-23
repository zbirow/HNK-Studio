export function parseTextureHeader(provider, data) {
  switch (provider.textureLayout) {
    case "pc-standard":
      return parseStandardPcHeader(data);
    case "wii-standard":
      return parseStandardWiiHeader(data);
    case "scooby-pc":
      return parseScoobyPcHeader(data);
    case "scooby-wii":
      return parseScoobyWiiHeader(data);
    default:
      return null;
  }
}

function parseStandardPcHeader(data) {
  if (data.length < 0x10) {
    return null;
  }

  const marker = data.subarray(0, 2).toString("hex").toUpperCase();
  const formatMap = new Map([
    ["F93D", "DXT1"],
    ["D33A", "DXT5"],
    ["9F5B", "R8G8B8A8"],
    ["6F74", "R8G8B8A8"]
  ]);

  return {
    width: data.readUInt16LE(0x0c),
    height: data.readUInt16LE(0x0e),
    format: formatMap.get(marker) ?? `Unknown ${marker}`,
    marker
  };
}

function parseStandardWiiHeader(data) {
  if (data.length < 0x10) {
    return null;
  }

  const marker = data.subarray(0, 2).toString("hex").toUpperCase();
  const formatMap = new Map([
    ["A1BC", "CMPR"],
    ["E978", "BGRA8888"]
  ]);

  return {
    width: data.readUInt16BE(0x0c),
    height: data.readUInt16BE(0x0e),
    format: formatMap.get(marker) ?? `Unknown ${marker}`,
    marker
  };
}

function parseScoobyPcHeader(data) {
  if (data.length < 0x40) {
    return null;
  }

  const formatBytes = data.subarray(0x34, 0x40);
  const formatText = formatBytes.toString("ascii").replace(/\0+$/u, "").trim();
  const marker = data.subarray(0x34, 0x38).toString("hex").toUpperCase();

  return {
    width: data.readUInt16LE(0x30),
    height: data.readUInt16LE(0x32),
    format: formatText || (data[0x34] === 0x15 ? "R8G8B8A8" : `Unknown ${marker}`),
    marker
  };
}

function parseScoobyWiiHeader(data) {
  if (data.length < 0x68) {
    return null;
  }

  const marker = data.subarray(0x05, 0x09).toString("hex").toUpperCase();
  const offsetsByMarker = new Map([
    ["01000024", [0x58, 0x5a]],
    ["01000028", [0x5c, 0x5e]],
    ["01000020", [0x54, 0x56]],
    ["0100002C", [0x60, 0x62]],
    ["01000030", [0x64, 0x66]]
  ]);
  const offsets = offsetsByMarker.get(marker);

  if (!offsets) {
    return {
      width: 0,
      height: 0,
      format: `Unknown ${marker}`,
      marker
    };
  }

  return {
    width: data.readUInt16BE(offsets[0]),
    height: data.readUInt16BE(offsets[1]),
    format: "CMPR",
    marker
  };
}
