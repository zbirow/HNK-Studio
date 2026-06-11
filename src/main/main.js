import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
import { readFileSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWav, decodeSqueakStreamRaw, extractEmbeddedAudioData, extractExternalRawName, parseAudioMetadata, parseRawiInfo } from "../decoders/audioDecoder.js";
import { makeHexPreview, readHnkFile } from "../core/hnkReader.js";
import { buildHnkProject } from "../core/projectLoader.js";
import { extractModelGeometry } from "../decoders/modelGeometry.js";
import { findSkeletonForAsset, parseSkeletons } from "../decoders/skeletonDecoder.js";
import { cropSpriteRgba, parseRenderSprite, writeRenderSpriteEntries } from "../decoders/spriteDecoder.js";
import { createObjFromModelRecords } from "../exporters/modelObjExporter.js";
import { createTextureDataUrl, createTextureDds, createTexturePng, decodeDdsToRgba, encodeRgbaPng, encodeRgbaToTextureData, getTextureDataSize } from "../exporters/textureExporter.js";
import { getGameOptions, getProvider } from "../providers/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(process.cwd(), "config.json");
const DEBUG = true;

let mainWindow = null;
let currentSession = null;
let debugFindUnknowns = false;
let debugSkeletonRotationControls = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111111",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  if (process.env.HNK_STUDIO_SMOKE_TEST === "1") {
    mainWindow.webContents.once("did-finish-load", () => {
      console.log("HNK_STUDIO_SMOKE_TEST_LOADED");
      setTimeout(() => app.quit(), 100);
    });
  }

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function createApplicationMenu() {
  const template = [
    {
      label: "File",
      submenu: [
        { role: "quit" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "close" }
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "About HNK Studio",
          enabled: false
        }
      ]
    }
  ];

  if (DEBUG) {
    template.splice(4, 0, {
      label: "Debug",
      submenu: [
        {
          label: "Found Unknowns",
          type: "checkbox",
          checked: debugFindUnknowns,
          click(menuItem) {
            debugFindUnknowns = menuItem.checked;
            mainWindow?.webContents.send("debug:stateChanged", getDebugState());
          }
        },
        {
          label: "Skeleton Rotation Controls",
          type: "checkbox",
          checked: debugSkeletonRotationControls,
          click(menuItem) {
            debugSkeletonRotationControls = menuItem.checked;
            mainWindow?.webContents.send("debug:stateChanged", getDebugState());
          }
        }
      ]
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function getDebugState() {
  return {
    enabled: DEBUG,
    findUnknowns: DEBUG && debugFindUnknowns,
    skeletonRotationControls: DEBUG && debugSkeletonRotationControls
  };
}

ipcMain.handle("games:list", () => getGameOptions());
ipcMain.handle("debug:getState", () => getDebugState());

ipcMain.handle("hnk:open", async (_event, payload) => {
  const provider = getProvider(payload?.gameId);

  if (!provider) {
    throw new Error("Select a game provider before opening a file.");
  }

  if (DEBUG && debugFindUnknowns) {
    return openUnknownScan(provider);
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select HNK file",
    properties: ["openFile"],
    filters: [
      { name: "HNK files", extensions: ["hnk", "dat"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const parsed = await readHnkFile(result.filePaths[0]);
  const project = buildHnkProject(parsed, provider);
  const soundsFolder = getConfiguredSoundsFolder(provider);
  project.settings = { soundsFolder };
  currentSession = { parsed, provider, project, soundsFolder, skeletons: null };

  return project;
});

async function openUnknownScan(provider) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select folder to scan for unknown records",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const project = await scanFolderForUnknownRecords(result.filePaths[0], provider);
  currentSession = {
    parsed: { records: project.rawRecords },
    provider,
    project,
    soundsFolder: null,
    skeletons: null
  };
  delete project.rawRecords;

  return project;
}

async function scanFolderForUnknownRecords(folderPath, provider) {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const rawRecords = [];
  const records = [];
  const tree = [];
  const warnings = [];
  let fileCount = 0;
  let totalSize = 0;

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(folderPath, entry.name);

    if (!isScannableHnkPath(filePath)) {
      continue;
    }

    fileCount += 1;

    try {
      const parsed = await readHnkFile(filePath);
      const project = buildHnkProject(parsed, provider);
      totalSize += parsed.fileSize ?? 0;
      const childNodes = [];

      for (const serialized of project.records) {
        const sourceRecord = parsed.records[serialized.index];

        if (!isUnknownScanRecord(serialized, sourceRecord, provider)) {
          continue;
        }

        const recordId = records.length;
        rawRecords.push({ ...sourceRecord, index: recordId, sourceFile: parsed.fileName, sourcePath: parsed.filePath, sourceRecordIndex: serialized.index });
        records.push({
          ...serialized,
          index: recordId,
          details: [
            `Source file: ${parsed.fileName}`,
            `Source record: ${serialized.index}`,
            ...serialized.details
          ],
          sourceFile: parsed.fileName,
          sourcePath: parsed.filePath,
          sourceRecordIndex: serialized.index
        });
        childNodes.push({
          id: `scan-file:${tree.length}:record:${recordId}`,
          kind: "record",
          nodeType: "record",
          label: `${serialized.typeHex} (${formatBytesForMain(serialized.size)})`,
          recordIds: [recordId],
          children: []
        });
      }

      if (childNodes.length > 0) {
        tree.push({
          id: `scan-file:${tree.length}`,
          kind: "folder",
          nodeType: "category",
          label: parsed.fileName,
          category: "Unknown",
          categoryLabel: `${childNodes.length} unknowns`,
          resourceType: "Unknown",
          recordIds: childNodes.flatMap((node) => node.recordIds),
          children: childNodes
        });
      }
    } catch (error) {
      warnings.push(`${entry.name}: ${error.message}`);
    }
  }

  return {
    canceled: false,
    debugScan: true,
    fileName: "Unknown Records Scan",
    filePath: folderPath,
    fileSize: totalSize,
    provider: {
      id: provider.id,
      name: provider.name,
      platform: provider.platform,
      family: provider.family
    },
    warnings,
    scannedFiles: fileCount,
    records,
    rawRecords,
    assets: [],
    tree
  };
}

function isScannableHnkPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === ".hnk" || extension === ".dat";
}

function isUnknownScanRecord(serialized, sourceRecord, provider) {
  return (
    sourceRecord &&
    serialized.category === "Unknown" &&
    serialized.size > 0 &&
    !provider.recordName(sourceRecord.type)
  );
}

ipcMain.handle("asset:preview", async (_event, payload) => {
  const asset = getAsset(payload?.nodeId);

  if (!asset) {
    return { ok: false };
  }

  if (asset.category === "TSETexture" && asset.texture?.dataRecordId != null) {
    const textureData = getRawRecord(asset.texture.dataRecordId)?.data;

    if (!textureData) {
      return { ok: false };
    }

    return {
      ok: true,
      kind: "texture",
      dataUrl: createTextureDataUrl(textureData, asset.texture)
    };
  }

  if (asset.category === "RenderModelTemplate") {
    const records = asset.payloadRecordIds.map((recordId) => getRawRecord(recordId)).filter(Boolean);
    const skeletons = getSkeletons();
    const skeleton = findSkeletonForAsset(skeletons, asset.name);
    let geometry = null;
    let modelError = null;

    try {
      geometry = serializeGeometryForPreview(extractModelGeometry(records));
    } catch (error) {
      if (!isMissingModelGeometryError(error)) {
        throw error;
      }

      geometry = createEmptyGeometryPreview();
      modelError = error.message;
    }

    return {
      ok: true,
      kind: "model",
      geometry,
      meshAvailable: geometry.vertexCount > 0 && geometry.faceCount > 0,
      modelError,
      skeleton
    };
  }

  if (asset.category === "RenderSprite") {
    const preview = createSpritePreview(asset, payload?.spriteIndex ?? 0, payload?.textureAssetId);
    return preview ? { ok: true, kind: "sprite", ...preview } : { ok: false };
  }

  if (asset.category === "SqueakSample" || asset.category === "SqueakStream") {
    return createAudioPreview(asset);
  }

  return { ok: false };
});

ipcMain.handle("asset:export", async (_event, payload) => {
  const format = payload?.format;
  const target = getExportTarget(payload?.nodeId);

  if (!target) {
    throw new Error("Nothing selected for export.");
  }

  if (format === "sprites-png" && target.kind === "asset") {
    return exportSpritesToDirectory(target.asset, payload?.textureAssetId);
  }

  const { buffer, defaultPath, filters } = createExportPayload(target, format);

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Export asset",
    defaultPath,
    filters
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  await writeFile(result.filePath, buffer);
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle("asset:exportAll", async (_event, payload) => {
  const format = payload?.format;
  const assets = getAssetsForBulkExport(payload?.nodeId);

  if (assets.length === 0) {
    throw new Error("No assets found for bulk export.");
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select export folder",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  await mkdir(result.filePaths[0], { recursive: true });

  const usedNames = new Set();
  const errors = [];
  let count = 0;

  for (const asset of assets) {
    try {
      const { buffer, defaultPath } = createExportPayload({ kind: "asset", asset }, format);
      const filePath = getUniqueExportPath(result.filePaths[0], defaultPath, usedNames);
      await writeFile(filePath, buffer);
      count += 1;
    } catch (error) {
      errors.push(`${asset.name}: ${error.message}`);
    }
  }

  return {
    canceled: false,
    filePath: result.filePaths[0],
    count,
    errors
  };
});

ipcMain.handle("texture:importDds", async (_event, payload) => {
  const asset = getAsset(payload?.nodeId);

  if (!asset || asset.category !== "TSETexture" || asset.texture?.dataRecordId == null) {
    throw new Error("Select a texture asset before importing DDS.");
  }

  const dds = Buffer.from(payload?.dds instanceof ArrayBuffer ? new Uint8Array(payload.dds) : payload?.dds ?? []);
  const record = getRawRecord(asset.texture.dataRecordId);

  if (!record) {
    throw new Error("Texture data record was not found.");
  }

  const directPayload = getDirectDdsPayload(dds, asset.texture, record.size);

  if (directPayload) {
    await writeTextureRecord(asset, record, directPayload, "direct DDS");
    return makeTextureImportResult(asset, record, directPayload.length, "direct DDS");
  }

  const imported = decodeDdsToRgba(dds);

  if (imported.width !== asset.texture.width || imported.height !== asset.texture.height) {
    throw new Error(`Imported DDS is ${imported.width}x${imported.height}, expected ${asset.texture.width}x${asset.texture.height}.`);
  }

  const encoded = encodeRgbaToTextureData(imported.rgba, asset.texture);
  await writeTextureRecord(asset, record, encoded, `DDS ${imported.format}`);
  return makeTextureImportResult(asset, record, encoded.length, `DDS ${imported.format}`);
});

ipcMain.handle("texture:saveEdit", async (_event, payload) => {
  const asset = getAsset(payload?.nodeId);

  if (!asset || asset.category !== "TSETexture" || asset.texture?.dataRecordId == null) {
    throw new Error("Select a texture asset before saving.");
  }

  const record = getRawRecord(asset.texture.dataRecordId);

  if (!record) {
    throw new Error("Texture data record was not found.");
  }

  const width = Number(payload?.width);
  const height = Number(payload?.height);

  if (width !== asset.texture.width || height !== asset.texture.height) {
    throw new Error("Edited image dimensions do not match the source texture.");
  }

  const rgba = Buffer.from(payload?.rgba instanceof ArrayBuffer ? new Uint8Array(payload.rgba) : payload?.rgba ?? []);

  if (rgba.length !== width * height * 4) {
    throw new Error("Edited image data has an invalid size.");
  }

  const encoded = encodeRgbaToTextureData(rgba, asset.texture);
  await writeTextureRecord(asset, record, encoded, "RGBA image");
  return makeTextureImportResult(asset, record, encoded.length, "RGBA image");
});

ipcMain.handle("asset:importDat", async (_event, payload) => {
  const target = getDatImportTarget(payload?.nodeId);
  const data = Buffer.from(payload?.data instanceof ArrayBuffer ? new Uint8Array(payload.data) : payload?.data ?? []);

  if (data.length !== target.record.size) {
    throw new Error(`DAT has ${data.length} bytes, expected ${target.record.size}.`);
  }

  data.copy(target.record.data);
  data.copy(currentSession.parsed.buffer, target.record.dataStart);
  updateSerializedHexPreview(target.record.index);
  await writeFile(currentSession.parsed.filePath, currentSession.parsed.buffer);

  return {
    canceled: false,
    byteLength: data.length,
    filePath: currentSession.parsed.filePath,
    hexPreview: makeHexPreview(target.record.data, 128)
  };
});

ipcMain.handle("sprite:saveTable", async (_event, payload) => {
  const asset = getAsset(payload?.nodeId);

  if (!asset || asset.category !== "RenderSprite") {
    throw new Error("Select a RenderSprite asset before saving.");
  }

  const spriteRecord = getSpriteRecord(asset);

  if (!spriteRecord) {
    throw new Error("RenderSprite data record was not found.");
  }

  const entries = Array.isArray(payload?.sprites) ? payload.sprites : [];
  const nextData = Buffer.from(spriteRecord.data);
  const updated = writeRenderSpriteEntries(nextData, entries);
  nextData.copy(spriteRecord.data);
  const serialized = currentSession.project.records[spriteRecord.index];

  if (serialized) {
    serialized.hexPreview = makeHexPreview(spriteRecord.data, 128);
  }

  if (asset.sprite) {
    const sprites = parseRenderSprite(spriteRecord.data);
    asset.sprite.count = sprites.length;
    asset.sprite.first = sprites[0] ?? null;
  }

  await writeFile(currentSession.parsed.filePath, currentSession.parsed.buffer);

  return {
    updated,
    hexPreview: makeHexPreview(spriteRecord.data, 128),
    filePath: currentSession.parsed.filePath
  };
});

ipcMain.handle("sprite:saveFontCharacters", async (_event, payload) => {
  const asset = getAsset(payload?.nodeId);

  if (!asset || asset.category !== "RenderSprite") {
    throw new Error("Select a RenderSprite asset before saving font mapping.");
  }

  const characters = Array.isArray(payload?.characters) ? payload.characters : [];
  await saveConfiguredSpriteFontCharacters(asset, characters);

  return {
    filePath: CONFIG_PATH,
    characters
  };
});

ipcMain.handle("sounds:selectFolder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select SOUNDS folder",
    properties: ["openDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  if (currentSession) {
    currentSession.soundsFolder = result.filePaths[0];
    currentSession.project.settings = {
      ...currentSession.project.settings,
      soundsFolder: result.filePaths[0]
    };
    await saveConfiguredSoundsFolder(currentSession.provider.id, result.filePaths[0]);
  }

  return { canceled: false, folderPath: result.filePaths[0] };
});

app.whenReady().then(() => {
  createApplicationMenu();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function getAsset(nodeId) {
  if (!currentSession?.project || !nodeId) {
    return null;
  }

  const assetId = nodeId.includes(":record:") ? nodeId.split(":record:")[0] : nodeId;
  return currentSession.project.assets.find((asset) => asset.id === assetId) ?? null;
}

function getExportTarget(nodeId) {
  if (!currentSession?.project || !nodeId) {
    return null;
  }

  const recordMarker = ":record:";

  if (nodeId.includes(recordMarker)) {
    const recordId = Number(nodeId.slice(nodeId.indexOf(recordMarker) + recordMarker.length));
    const record = getRawRecord(recordId);
    const serialized = currentSession.project.records[recordId];

    if (!record || !serialized) {
      return null;
    }

    return { kind: "record", record, serialized };
  }

  const asset = getAsset(nodeId);
  return asset ? { kind: "asset", asset } : null;
}

function getAssetsForBulkExport(nodeId) {
  if (!currentSession?.project || !nodeId) {
    return [];
  }

  if (nodeId.startsWith("category:")) {
    const category = nodeId.slice("category:".length);
    return currentSession.project.assets.filter((asset) => asset.category === category);
  }

  const asset = getAsset(nodeId);
  return asset ? [asset] : [];
}

function createExportPayload(target, format) {
  if (target.kind === "record") {
    return {
      buffer: target.record.data,
      defaultPath: `${safeName(target.serialized.role || target.serialized.typeName)}_${target.serialized.typeHex}.dat`,
      filters: [{ name: "DAT files", extensions: ["dat"] }]
    };
  }

  const asset = target.asset;

  if (format === "dds") {
    const textureData = getTextureData(asset);
    return {
      buffer: createTextureDds(textureData, asset.texture),
      defaultPath: `${safeName(asset.name)}.dds`,
      filters: [{ name: "DDS texture", extensions: ["dds"] }]
    };
  }

  if (format === "png") {
    const textureData = getTextureData(asset);
    return {
      buffer: createTexturePng(textureData, asset.texture),
      defaultPath: `${safeName(asset.name)}.png`,
      filters: [{ name: "PNG image", extensions: ["png"] }]
    };
  }

  if (format === "obj" || format === "obj-submeshes") {
    const records = asset.payloadRecordIds.map((recordId) => getRawRecord(recordId)).filter(Boolean);
    return {
      buffer: Buffer.from(createObjFromModelRecords(records, asset.name, { splitSubmeshes: format === "obj-submeshes" }), "utf8"),
      defaultPath: `${safeName(asset.name)}${format === "obj-submeshes" ? "_submeshes" : ""}.obj`,
      filters: [{ name: "OBJ model", extensions: ["obj"] }]
    };
  }

  if (format === "wav") {
    return {
      buffer: createAudioWav(asset),
      defaultPath: `${safeName(asset.name)}.wav`,
      filters: [{ name: "WAV audio", extensions: ["wav"] }]
    };
  }

  const dataRecords = asset.payloadRecordIds.map((recordId) => getRawRecord(recordId)).filter(Boolean);

  return {
    buffer: Buffer.concat(dataRecords.map((record) => record.data)),
    defaultPath: `${safeName(asset.name)}.dat`,
    filters: [{ name: "DAT files", extensions: ["dat"] }]
  };
}

function getTextureData(asset) {
  if (asset.texture?.dataRecordId == null) {
    throw new Error("Texture data record was not found.");
  }

  const record = getRawRecord(asset.texture.dataRecordId);

  if (!record) {
    throw new Error("Texture data record was not found.");
  }

  return record.data;
}

function getDirectDdsPayload(dds, texture, expectedSize) {
  if (dds.length < 128 || dds.toString("ascii", 0, 4) !== "DDS ") {
    return null;
  }

  const height = dds.readUInt32LE(12);
  const width = dds.readUInt32LE(16);
  const fourCc = dds.toString("ascii", 84, 88).replace(/\0+$/u, "");
  const dataOffset = fourCc === "DX10" ? 148 : 128;

  if (width !== texture.width || height !== texture.height || dds.length < dataOffset) {
    return null;
  }

  const payload = dds.subarray(dataOffset);
  return payload.length === expectedSize ? payload : null;
}

async function writeTextureRecord(asset, record, encoded, sourceLabel) {
  const expectedSize = getTextureDataSize(asset.texture);

  if (expectedSize != null && encoded.length !== expectedSize) {
    throw new Error(`${sourceLabel} import created ${encoded.length} bytes, expected ${expectedSize}.`);
  }

  if (encoded.length !== record.size) {
    throw new Error(`${sourceLabel} import created ${encoded.length} bytes, but the HNK payload is ${record.size} bytes.`);
  }

  encoded.copy(record.data);
  encoded.copy(currentSession.parsed.buffer, record.dataStart);
  updateSerializedHexPreview(record.index);
  await writeFile(currentSession.parsed.filePath, currentSession.parsed.buffer);
}

function makeTextureImportResult(asset, record, byteLength, mode) {
  return {
    canceled: false,
    byteLength,
    mode,
    filePath: currentSession.parsed.filePath,
    hexPreview: makeHexPreview(record.data, 128),
    dataUrl: createTextureDataUrl(record.data, asset.texture)
  };
}

function updateSerializedHexPreview(recordIndex) {
  const serialized = currentSession.project.records[recordIndex];

  if (serialized) {
    const record = getRawRecord(recordIndex);
    serialized.hexPreview = makeHexPreview(record.data, 128);
  }
}

function getDatImportTarget(nodeId) {
  const target = getExportTarget(nodeId);

  if (!target) {
    throw new Error("Nothing selected for DAT import.");
  }

  if (target.kind === "record") {
    return target;
  }

  const asset = target.asset;

  if (asset.texture?.dataRecordId != null) {
    const record = getRawRecord(asset.texture.dataRecordId);
    if (!record) {
      throw new Error("Texture data record was not found.");
    }

    return { kind: "record", record, serialized: currentSession.project.records[record.index] };
  }

  if (asset.payloadRecordIds.length === 1) {
    const record = getRawRecord(asset.payloadRecordIds[0]);
    if (!record) {
      throw new Error("Asset data record was not found.");
    }

    return { kind: "record", record, serialized: currentSession.project.records[record.index] };
  }

  throw new Error("DAT import needs a single target record. Select a child record instead.");
}

function getRawRecord(recordId) {
  return currentSession?.parsed.records[recordId] ?? null;
}

function safeName(name) {
  return String(name || "asset").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "asset";
}

function getUniqueExportPath(folderPath, defaultPath, usedNames) {
  const parsedPath = path.parse(defaultPath);
  const baseName = safeName(parsedPath.name);
  const extension = parsedPath.ext || ".dat";
  let candidate = `${baseName}${extension}`;
  let index = 2;

  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${baseName}_${index}${extension}`;
    index += 1;
  }

  usedNames.add(candidate.toLowerCase());
  return path.join(folderPath, candidate);
}

function formatBytesForMain(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function serializeGeometryForPreview(geometry) {
  const maxFaces = 60000;
  const sourceFaces = geometry.faces.length > maxFaces ? geometry.faces.slice(0, maxFaces) : geometry.faces;
  const vertexMap = new Map();
  const vertices = [];
  const faces = sourceFaces.map((face) =>
    face.map((vertexIndex) => {
      if (!vertexMap.has(vertexIndex)) {
        vertexMap.set(vertexIndex, vertices.length);
        vertices.push(geometry.vertices[vertexIndex]);
      }

      return vertexMap.get(vertexIndex);
    })
  );

  return {
    vertices,
    faces,
    bounds: geometry.bounds,
    truncated: sourceFaces.length !== geometry.faces.length,
    faceCount: geometry.faces.length,
    vertexCount: geometry.vertices.length
  };
}

function createEmptyGeometryPreview() {
  return {
    vertices: [],
    faces: [],
    bounds: {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      radius: 1
    },
    truncated: false,
    faceCount: 0,
    vertexCount: 0
  };
}

function isMissingModelGeometryError(error) {
  return /no vertex\/(?:index|display-list) data/iu.test(error?.message ?? "");
}

function getSkeletons() {
  if (!currentSession) {
    return [];
  }

  if (!currentSession.skeletons) {
    currentSession.skeletons = parseSkeletons(currentSession.parsed.buffer ?? Buffer.alloc(0));
  }

  return currentSession.skeletons;
}

function createAudioWav(asset) {
  const payload = createAudioPayload(asset);

  return createWav(payload.rawData, payload.metadata);
}

function createAudioPayload(asset) {
  const records = asset.payloadRecordIds.map((recordId) => getRawRecord(recordId)).filter(Boolean);
  const metadataRecord = records.find((record) => parseAudioMetadata(record.data));

  if (!metadataRecord) {
    throw new Error("Audio metadata was not found.");
  }

  const metadata = parseAudioMetadata(metadataRecord.data);
  let rawData = null;
  let rawName = null;
  let streamLayout = null;
  let outputMetadata = metadata;

  if (asset.category === "SqueakStream") {
    rawName = extractExternalRawName(metadataRecord.data);

    if (!rawName) {
      throw new Error("RAW filename was not found in SqueakStream metadata.");
    }

    if (!currentSession.soundsFolder) {
      throw new Error("Select the SOUNDS folder before exporting SqueakStream audio.");
    }

    rawData = readExternalRawSync(path.join(currentSession.soundsFolder, rawName));
    const decoded = decodeSqueakStreamRaw(rawData, metadata, parseRawiInfo(metadataRecord.data));
    rawData = decoded.data;
    outputMetadata = decoded.metadata;
    streamLayout = decoded.layout;
  } else {
    rawData = extractEmbeddedAudioData(metadataRecord.data, metadata);
  }

  return {
    metadata: outputMetadata,
    rawData,
    rawName,
    soundsFolder: currentSession?.soundsFolder ?? null,
    streamLayout
  };
}

function createAudioPreview(asset) {
  const records = asset.payloadRecordIds.map((recordId) => getRawRecord(recordId)).filter(Boolean);
  const metadataRecord = records.find((record) => parseAudioMetadata(record.data));

  if (!metadataRecord) {
    return { ok: false, kind: "audio", message: "Audio metadata was not found." };
  }

  const metadata = parseAudioMetadata(metadataRecord.data);

  if (asset.category === "SqueakStream") {
    const rawName = extractExternalRawName(metadataRecord.data);
    const previewMetadata = makeSqueakStreamPreviewMetadata(metadata);

    if (!rawName) {
      return { ok: false, kind: "audio", message: "RAW filename was not found.", metadata: previewMetadata };
    }

    if (!currentSession.soundsFolder) {
      return {
        ok: true,
        kind: "audio",
        needsSoundsFolder: true,
        rawName,
        metadata: previewMetadata,
        soundsFolder: null,
        message: "Select the SOUNDS folder for this game."
      };
    }

    try {
      const payload = createAudioPayload(asset);
      const wav = createWav(payload.rawData, payload.metadata);

      return {
        ok: true,
        kind: "audio",
        needsSoundsFolder: false,
        rawName,
        metadata: payload.metadata,
        soundsFolder: currentSession.soundsFolder,
        streamLayout: payload.streamLayout,
        dataUrl: `data:audio/wav;base64,${wav.toString("base64")}`
      };
    } catch (error) {
      return {
        ok: true,
        kind: "audio",
        needsSoundsFolder: true,
        rawName,
        metadata: previewMetadata,
        soundsFolder: currentSession.soundsFolder,
        message: error.message
      };
    }
  }

  const wav = createWav(extractEmbeddedAudioData(metadataRecord.data, metadata), metadata);

  return {
    ok: true,
    kind: "audio",
    needsSoundsFolder: false,
    metadata,
    dataUrl: `data:audio/wav;base64,${wav.toString("base64")}`
  };
}

function makeSqueakStreamPreviewMetadata(metadata) {
  return {
    ...metadata,
    sourceChannels: metadata.channels,
    channels: 2
  };
}

function readExternalRawSync(rawPath) {
  return readFileSync(rawPath);
}

function createSpritePreview(asset, requestedIndex = 0, textureAssetId = null) {
  const spriteRecord = getSpriteRecord(asset);

  if (!spriteRecord) {
    return null;
  }

  const sprites = parseRenderSprite(spriteRecord.data);
  const selectedIndex = Math.max(0, Math.min(sprites.length - 1, Number(requestedIndex) || 0));
  const selectedSprite = sprites[selectedIndex];
  const textureAsset = findTextureForSprite(asset.name, textureAssetId);
  const textureOptions = getSpriteTextureOptions(asset.name);

  if (!selectedSprite || !textureAsset?.texture) {
    return {
      spriteCount: sprites.length,
      sprites,
      selectedIndex,
      selectedSprite,
      texture: textureAsset ? serializeTextureOption(textureAsset) : null,
      textureOptions,
      fontCharacters: getConfiguredSpriteFontCharacters(asset),
      dataUrl: null
    };
  }

  const textureData = getTextureData(textureAsset);
  const crop = cropSpriteRgba(textureData, textureAsset.texture, selectedSprite);
  const textureDataUrl = createTextureDataUrl(textureData, textureAsset.texture);

  return {
    spriteCount: sprites.length,
    sprites,
    selectedIndex,
    selectedSprite,
    texture: serializeTextureOption(textureAsset),
    textureOptions,
    fontCharacters: getConfiguredSpriteFontCharacters(asset),
    textureDataUrl,
    dataUrl: `data:image/png;base64,${encodeRgbaPng(crop.width, crop.height, crop.rgba).toString("base64")}`
  };
}

function getSpriteRecord(asset) {
  if (asset.sprite?.recordId != null) {
    const record = getRawRecord(asset.sprite.recordId);

    if (record) {
      return record;
    }
  }

  return asset.payloadRecordIds.map((recordId) => getRawRecord(recordId)).find((record) => record?.type === 0x41007) ?? null;
}

function findTextureForSprite(spriteName, textureAssetId = null) {
  const textureAssets = getTextureAssets();

  if (textureAssetId) {
    const selected = textureAssets.find((asset) => asset.id === textureAssetId);

    if (selected) {
      return selected;
    }
  }

  const names = new Set([normalizeName(spriteName), normalizeName(`${spriteName}0`)]);
  const matched = textureAssets.find((asset) => names.has(normalizeName(asset.name)));

  return matched ?? textureAssets[0] ?? null;
}

function getSpriteTextureOptions(spriteName) {
  const names = new Set([normalizeName(spriteName), normalizeName(`${spriteName}0`)]);

  return getTextureAssets()
    .map((asset) => ({
      ...serializeTextureOption(asset),
      matched: names.has(normalizeName(asset.name))
    }))
    .sort((left, right) => Number(right.matched) - Number(left.matched) || left.label.localeCompare(right.label));
}

function getTextureAssets() {
  return currentSession.project.assets.filter((asset) => asset.category === "TSETexture" && asset.texture?.dataRecordId != null);
}

function serializeTextureOption(asset) {
  return {
    id: asset.id,
    name: asset.name,
    folder: asset.folder,
    label: `${asset.name} (${asset.texture.width}x${asset.texture.height} ${asset.texture.format})`,
    width: asset.texture.width,
    height: asset.texture.height,
    format: asset.texture.format
  };
}

async function exportSpritesToDirectory(asset, textureAssetId = null) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select folder for sprites",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const spriteRecord = getSpriteRecord(asset);
  const textureAsset = findTextureForSprite(asset.name, textureAssetId);

  if (!spriteRecord || !textureAsset?.texture) {
    throw new Error("Sprite texture was not found.");
  }

  await mkdir(result.filePaths[0], { recursive: true });

  const sprites = parseRenderSprite(spriteRecord.data);
  const textureData = getTextureData(textureAsset);
  let count = 0;

  for (const sprite of sprites) {
    const crop = cropSpriteRgba(textureData, textureAsset.texture, sprite);
    const filePath = path.join(result.filePaths[0], `${safeName(asset.name)}_${sprite.hash}.png`);
    await writeFile(filePath, encodeRgbaPng(crop.width, crop.height, crop.rgba));
    count += 1;
  }

  return { canceled: false, filePath: result.filePaths[0], count };
}

function normalizeName(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return { providers: {} };
  }
}

async function writeConfig(config) {
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function getConfiguredSoundsFolder(provider) {
  const providersConfig = readConfig().providers ?? {};

  for (const providerId of [provider.id, ...(provider.configAliases ?? [])]) {
    const soundsFolder = providersConfig[providerId]?.soundsFolder;

    if (soundsFolder) {
      return soundsFolder;
    }
  }

  return null;
}

async function saveConfiguredSoundsFolder(providerId, folderPath) {
  const config = readConfig();
  config.providers ??= {};
  config.providers[providerId] = {
    ...config.providers[providerId],
    soundsFolder: folderPath
  };
  await writeConfig(config);
}

function getConfiguredSpriteFontCharacters(asset) {
  const providersConfig = readConfig().providers ?? {};

  for (const providerId of [currentSession.provider.id, ...(currentSession.provider.configAliases ?? [])]) {
    const maps = providersConfig[providerId]?.renderSpriteCharsets ?? {};
    const configured = maps[getSpriteConfigKey(asset)] ?? maps[asset.name];

    if (configured) {
      return configured;
    }
  }

  return null;
}

async function saveConfiguredSpriteFontCharacters(asset, characters) {
  const config = readConfig();
  config.providers ??= {};
  const providerConfig = config.providers[currentSession.provider.id] ?? {};
  providerConfig.renderSpriteCharsets ??= {};
  providerConfig.renderSpriteCharsets[getSpriteConfigKey(asset)] = characters;
  config.providers[currentSession.provider.id] = providerConfig;
  await writeConfig(config);
}

function getSpriteConfigKey(asset) {
  return `${asset.folder || ""}/${asset.name}`;
}
