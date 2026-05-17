import { basename } from "node:path";
import { parseAudioMetadata, parseRawiInfo } from "../decoders/audioDecoder.js";
import { parseTextureHeader } from "../decoders/textureHeaders.js";
import { parseRenderSprite } from "../decoders/spriteDecoder.js";
import { CATEGORY_ORDER } from "../providers/categories.js";
import { RECORD_TYPES, formatRecordType } from "./recordTypes.js";
import { makeHexPreview, parseFilenameHeader, readHnkFile } from "./hnkReader.js";

const RESOURCE_TYPES = new Map([
  ["TSETexture", "Textura"],
  ["RenderModelTemplate", "Model 3D"],
  ["Animation", "Animacja"],
  ["RenderSprite", "Sprite"],
  ["SqueakSample", "Dzwiek"],
  ["SqueakStream", "Dzwiek"],
  ["TSEFontDescriptor", "Font"],
  ["TSEDataTable", "Tabela danych"],
  ["StateFlowTemplate", "State Flow"],
  ["LiteScript", "Skrypt"],
  ["ClankBodyTemplate", "Clank Body"],
  ["EntityPlacement", "Entity Placement"],
  ["EntityTemplate", "Entity Template"],
  ["EffectsParams", "Efekty"],
  ["NavMesh", "Navmesh"],
  ["NavNetwork", "Nav network"],
  ["HomeMenu", "Home menu"],
  ["SaveGameBin", "Save game bin"],
  ["TSEStringTable", "Tabela tekstu"],
  ["Unknown", "Nieznany"]
]);

const RECORD_ROLE_LABELS = new Map([
  [RECORD_TYPES.FILENAME_HEADER, "Filename Header"],
  [RECORD_TYPES.TSE_TEXTURE_HEADER, "Header"],
  [RECORD_TYPES.SCOOBY_TEXTURE_HEADER_PC, "Header"],
  [RECORD_TYPES.SCOOBY_TEXTURE_HEADER_WII, "Header"],
  [RECORD_TYPES.TSE_TEXTURE_DATA, "Data"],
  [RECORD_TYPES.TSE_TEXTURE_DATA_2, "Data"],
  [RECORD_TYPES.TSE_TEXTURE_DATA_WII, "Data"],
  [RECORD_TYPES.SCOOBY_TEXTURE_DATA_PC, "Data"],
  [RECORD_TYPES.SCOOBY_TEXTURE_DATA_WII, "Data"],
  [RECORD_TYPES.SCOOBY_TEXTURE_DATA_WII_ALT, "Data"],
  [RECORD_TYPES.RENDER_MODEL_TEMPLATE_HEADER, "Header"],
  [RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA, "Vertex Data"],
  [RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_TABLE, "Index Data"],
  [RECORD_TYPES.RENDER_MODEL_TEMPLATE_HEADER_WII, "Header"],
  [RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_WII, "Vertex Data"],
  [RECORD_TYPES.RENDER_MODEL_TEMPLATE_DATA_TABLE_WII, "Index Data"],
  [RECORD_TYPES.RENDER_MODEL_TEMPLATE_RIG_WII, "Rig"],
  [RECORD_TYPES.SCOOBY_RENDER_MODEL_TEMPLATE_HEADER_DATA_PC, "Header"],
  [RECORD_TYPES.SCOOBY_RENDER_MODEL_TEMPLATE_DATA_PC, "Data"]
]);

export async function loadHnkProject(filePath, provider) {
  const parsed = await readHnkFile(filePath);
  return buildHnkProject(parsed, provider);
}

export function buildHnkProject(parsed, provider) {
  const records = parsed.records.map((record) => serializeRecord(record, provider));
  const assets = buildAssets(parsed.records, records, provider);
  const tree = buildRecordTree(assets, records, provider);

  return {
    canceled: false,
    fileName: parsed.fileName ?? basename(parsed.filePath),
    filePath: parsed.filePath,
    fileSize: parsed.fileSize,
    provider: {
      id: provider.id,
      name: provider.name,
      platform: provider.platform,
      family: provider.family
    },
    warnings: parsed.warnings,
    records,
    assets,
    tree
  };
}

function serializeRecord(record, provider) {
  const typeHex = formatRecordType(record.type);
  const typeName = provider.recordName(record.type) ?? `Unknown ${typeHex}`;
  const details = [];
  const texture = provider.textureHeaderTypes.includes(record.type) ? parseTextureHeader(provider, record.data) : null;

  if (record.type === RECORD_TYPES.FILENAME_HEADER) {
    const parsedName = parseFilenameHeader(record.data);
    details.push(`Folder: ${parsedName.folder || "-"}`);
    details.push(`Filename: ${parsedName.filename || "-"}`);

    if (parsedName.error) {
      details.push(parsedName.error);
    }
  }

  if (texture) {
    details.push(`Texture: ${texture.width}x${texture.height} ${texture.format}`);
    details.push(`Marker: ${texture.marker}`);
  }

  if (record.warning) {
    details.push(record.warning);
  }

  return {
    index: record.index,
    type: record.type,
    typeHex,
    typeName,
    category: provider.categoryForType(record.type),
    role: getRecordRole(record, provider, typeName),
    size: record.size,
    start: record.start,
    dataStart: record.dataStart,
    end: record.end,
    malformed: record.malformed,
    texture,
    details,
    hexPreview: makeHexPreview(record.data, 128)
  };
}

function buildAssets(rawRecords, records, provider) {
  const sections = [];
  const rawRecordsByIndex = new Map(rawRecords.map((record) => [record.index, record]));
  let current = null;
  let unnamedCounter = 1;

  const finishCurrent = () => {
    if (current && current.recordIds.length > 0) {
      sections.push(current);
    }
    current = null;
  };

  for (const rawRecord of rawRecords) {
    if (rawRecord.type === RECORD_TYPES.HUNKFILE_HEADER) {
      continue;
    }

    if (rawRecord.type === RECORD_TYPES.FILENAME_HEADER) {
      finishCurrent();
      const parsedName = parseFilenameHeader(rawRecord.data);
      current = {
        filenameRecordIndex: rawRecord.index,
        name: parsedName.displayName || `Unnamed_${unnamedCounter++}`,
        folder: parsedName.folder || "",
        recordIds: [rawRecord.index]
      };
      continue;
    }

    if (!current) {
      current = {
        filenameRecordIndex: null,
        name: records[rawRecord.index]?.typeName ?? `Record_${rawRecord.index}`,
        folder: "",
        recordIds: []
      };
    }

    if (isDisplayableRecord(rawRecord)) {
      current.recordIds.push(rawRecord.index);
    }
  }

  finishCurrent();

  return sections
    .map((section, assetIndex) => makeAsset(section, assetIndex, records, rawRecordsByIndex, provider))
    .filter((asset) => asset.payloadRecordIds.length > 0);
}

function makeAsset(section, assetIndex, records, rawRecordsByIndex, provider) {
  const payloadRecords = section.recordIds
    .map((recordId) => records[recordId])
    .filter((record) => record && record.type !== RECORD_TYPES.FILENAME_HEADER && record.size > 0 && record.type !== RECORD_TYPES.EMPTY);
  const category = pickAssetCategory(payloadRecords);
  const categoryLabel = provider.categoryLabel(category);
  const texture = findTextureInfo(payloadRecords, provider);
  const audio = findAudioInfo(payloadRecords, rawRecordsByIndex, category);
  const sprite = findSpriteInfo(payloadRecords, rawRecordsByIndex);
  const size = payloadRecords.reduce((total, record) => total + record.size, 0);
  const id = `asset:${section.filenameRecordIndex ?? payloadRecords[0]?.index ?? assetIndex}`;
  const exportFormats = getExportFormats(category, texture);

  return {
    id,
    name: section.name,
    folder: section.folder,
    category,
    categoryLabel,
    resourceType: RESOURCE_TYPES.get(category) ?? categoryLabel,
    size,
    recordIds: section.recordIds,
    payloadRecordIds: payloadRecords.map((record) => record.index),
    texture,
    audio,
    sprite,
    exportFormats
  };
}

function pickAssetCategory(payloadRecords) {
  const knownCategories = payloadRecords
    .map((record) => record.category)
    .filter((category) => category && category !== "Unknown");

  if (knownCategories.length === 0) {
    return "Unknown";
  }

  const order = new Map(CATEGORY_ORDER.map((category, index) => [category, index]));
  return knownCategories.sort((left, right) => (order.get(left) ?? 999) - (order.get(right) ?? 999))[0];
}

function findTextureInfo(payloadRecords, provider) {
  const header = payloadRecords.find((record) => provider.textureHeaderTypes.includes(record.type) && record.texture);

  if (!header) {
    return null;
  }

  const data = payloadRecords.find((record) => provider.textureDataTypes?.includes(record.type));

  return {
    ...header.texture,
    headerRecordId: header.index,
    dataRecordId: data?.index ?? null
  };
}

function getExportFormats(category, texture) {
  const formats = ["dat"];

  if (category === "TSETexture" && texture && texture.dataRecordId != null) {
    formats.push("dds", "png");
  }

  if (category === "RenderModelTemplate") {
    formats.push("obj", "obj-submeshes");
  }

  if (category === "SqueakSample" || category === "SqueakStream") {
    formats.push("wav");
  }

  if (category === "RenderSprite") {
    formats.push("sprites-png");
  }

  return formats;
}

function buildRecordTree(assets, records, provider) {
  const rootNodes = [];
  const categoryNodes = new Map();

  for (const asset of assets) {
    const categoryNode = ensureCategoryNode(asset.category, rootNodes, categoryNodes, provider);
    categoryNode.children.push(makeAssetNode(asset, records));
  }

  return sortRootNodes(rootNodes);
}

function ensureCategoryNode(category, rootNodes, categoryNodes, provider) {
  if (!categoryNodes.has(category)) {
    const node = {
      id: `category:${category}`,
      kind: "folder",
      nodeType: "category",
      label: provider.categoryLabel(category),
      category,
      categoryLabel: provider.categoryLabel(category),
      resourceType: RESOURCE_TYPES.get(category) ?? provider.categoryLabel(category),
      recordIds: [],
      children: []
    };
    categoryNodes.set(category, node);
    rootNodes.push(node);
  }

  return categoryNodes.get(category);
}

function makeAssetNode(asset, records) {
  return {
    id: asset.id,
    kind: "file",
    nodeType: "asset",
    label: asset.name,
    subtitle: asset.folder,
    category: asset.category,
    categoryLabel: asset.categoryLabel,
    resourceType: asset.resourceType,
    asset,
    recordIds: asset.recordIds,
    children: asset.payloadRecordIds.map((recordId) => {
      const record = records[recordId];

      return {
        id: `${asset.id}:record:${recordId}`,
        kind: "record",
        nodeType: "record",
        label: record?.role ?? "Record",
        recordIds: [recordId],
        children: []
      };
    })
  };
}

function sortRootNodes(rootNodes) {
  const order = new Map(CATEGORY_ORDER.map((category, index) => [`category:${category}`, index]));

  return rootNodes.sort((a, b) => {
    const left = order.get(a.id) ?? 999;
    const right = order.get(b.id) ?? 999;
    return left - right || a.label.localeCompare(b.label);
  });
}

function getRecordRole(record, provider, typeName) {
  if (provider.textureHeaderTypes.includes(record.type)) {
    return "Header";
  }

  if (provider.textureDataTypes?.includes(record.type)) {
    return "Data";
  }

  return RECORD_ROLE_LABELS.get(record.type) ?? typeName;
}

function isDisplayableRecord(record) {
  return record.size > 0 && record.type !== RECORD_TYPES.EMPTY;
}

function findAudioInfo(payloadRecords, rawRecordsByIndex, category) {
  if (category !== "SqueakSample" && category !== "SqueakStream") {
    return null;
  }

  for (const record of payloadRecords) {
    const rawData = rawRecordsByIndex.get(record.index)?.data ?? Buffer.alloc(0);
    const metadata = parseAudioMetadata(rawData);
    const rawi = parseRawiInfo(rawData);

    if (metadata) {
      return {
        ...metadata,
        sourceChannels: metadata.channels,
        channels: record.category === "SqueakStream" ? 2 : metadata.channels,
        rawi,
        metadataRecordId: record.index
      };
    }
  }

  return null;
}

function findSpriteInfo(payloadRecords, rawRecordsByIndex) {
  const spriteRecord = payloadRecords.find((record) => record.category === "RenderSprite");

  const rawData = rawRecordsByIndex.get(spriteRecord?.index)?.data;

  if (!rawData) {
    return null;
  }

  const sprites = parseRenderSprite(rawData);
  return {
    recordId: spriteRecord.index,
    count: sprites.length,
    first: sprites[0] ?? null
  };
}
