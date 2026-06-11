const gameSelect = document.querySelector("#gameSelect");
const openFileButton = document.querySelector("#openFileButton");
const treeRoot = document.querySelector("#treeRoot");
const fileName = document.querySelector("#fileName");
const providerName = document.querySelector("#providerName");
const detailsTitle = document.querySelector("#detailsTitle");
const detailsSubtitle = document.querySelector("#detailsSubtitle");
const recordCounter = document.querySelector("#recordCounter");
const detailsList = document.querySelector("#detailsList");
const hexPreview = document.querySelector("#hexPreview");
const actionBar = document.querySelector("#actionBar");
const previewArea = document.querySelector("#previewArea");
const previewPanel = document.querySelector(".preview-panel");
const api = window.hnkApi ?? {
  listGames: async () => [],
  getDebugState: async () => ({ enabled: false, findUnknowns: false, skeletonRotationControls: false }),
  onDebugStateChanged: () => () => {},
  openFile: async () => {
    throw new Error("Electron preload API is not available.");
  },
  previewAsset: async () => ({ ok: false }),
  exportAsset: async () => ({ canceled: true }),
  exportAll: async () => ({ canceled: true }),
  importDat: async () => ({ canceled: true }),
  importTextureDds: async () => {
    throw new Error("DDS import is not available.");
  },
  saveTextureEdit: async () => ({ canceled: true }),
  saveSpriteTable: async () => ({ updated: 0 }),
  saveSpriteFontCharacters: async () => ({ characters: [] }),
  selectSoundsFolder: async () => ({ canceled: true })
};

const state = {
  games: [],
  project: null,
  selectedNodeId: null,
  selectedNode: null,
  expandedNodeIds: new Set(),
  spriteIndexes: new Map(),
  spriteTextureIds: new Map(),
  spriteEditorIds: new Set(),
  modelViewMode: "model",
  skeletonPreviewRotation: { x: 15, y: -40, z: -133 },
  debug: { enabled: false, findUnknowns: false, skeletonRotationControls: false }
};

const DEFAULT_SKELETON_PREVIEW_ROTATION = { x: 15, y: -40, z: -133 };

const SPRITE_FONT_CHARACTERS = [
  " ", "!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  ":", ";", "<", "=", ">", "?", "@",
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  "-", "`",
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
  "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
  ",",
  " ", "¡", "«", "®", "º", "º", "»", "¿",
  ["À", "Ą"], ["Á", "ą"], ["Â", "Ć"], ["Ã", "ć"],
  ["Ä", "Ę"], ["Å", "ę"], ["Æ", "Ł"], ["Ç", "ł"],
  ["È", "Ń"], ["É", "ń"], ["Ê", "Ó"], ["Ë", "ó"],
  ["Ì", "Ś"], ["Í", "ś"], ["Î", "Ż"], ["Ï", "ż"],
  ["Ð", "Ź"], ["Ñ", "ź"],
  "Ò", "Ó", "Ô", "Õ", "Ö", "Ø", "Ù", "Ú", "Û", "Ü", "Ý", "Þ", "ß"
];

const DEFAULT_SPRITE_FONT_CHARACTERS = [
  " ", "!", "\"", "#", "$", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
  ":", ";", "<", "=", ">", "?", "@",
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M",
  "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z",
  "-", "`",
  "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m",
  "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z",
  ",",
  " ", "\u00A1", "\u00AB", "\u00AE", "\u00BA", "\u00BA", "\u00BB", "\u00BF",
  ["\u00C0", "\u0104"], ["\u00C1", "\u0105"], ["\u00C2", "\u0106"], ["\u00C3", "\u0107"],
  ["\u00C4", "\u0118"], ["\u00C5", "\u0119"], ["\u00C6", "\u0141"], ["\u00C7", "\u0142"],
  ["\u00C8", "\u0143"], ["\u00C9", "\u0144"], ["\u00CA", "\u00D3"], ["\u00CB", "\u00F3"],
  ["\u00CC", "\u015A"], ["\u00CD", "\u015B"], ["\u00CE", "\u017B"], ["\u00CF", "\u017C"],
  ["\u00D0", "\u0179"], ["\u00D1", "\u017A"],
  "\u00D2", "\u00D3", "\u00D4", "\u00D5", "\u00D6", "\u00D8", "\u00D9",
  "\u00DA", "\u00DB", "\u00DC", "\u00DD", "\u00DE", "\u00DF"
];

init();

async function init() {
  previewPanel.hidden = true;
  const [games, debug] = await Promise.all([api.listGames(), api.getDebugState()]);
  state.games = games;
  state.debug = debug;
  api.onDebugStateChanged((nextDebug) => {
    state.debug = nextDebug;
    updateOpenButtonLabel();
    if (state.selectedNode) {
      void showNodeDetails(state.selectedNode);
    }
  });
  renderGameOptions();
  updateOpenButtonLabel();
  renderTree();
}

gameSelect.addEventListener("change", () => {
  openFileButton.disabled = !gameSelect.value;
  state.project = null;
  state.selectedNodeId = null;
  state.selectedNode = null;
  state.expandedNodeIds.clear();
  state.spriteIndexes.clear();
  state.spriteTextureIds.clear();
  state.spriteEditorIds.clear();
  fileName.textContent = "No file";
  providerName.textContent = selectedGameLabel();
  recordCounter.textContent = "";
  detailsTitle.textContent = "HNK Studio";
  detailsSubtitle.textContent = gameSelect.value ? "Open an HNK file." : "Select a game provider.";
  detailsList.replaceChildren();
  hexPreview.textContent = "";
  actionBar.replaceChildren();
  previewArea.replaceChildren();
  previewPanel.hidden = true;
  updateOpenButtonLabel();
  renderTree();
});

openFileButton.addEventListener("click", async () => {
  openFileButton.disabled = true;
  openFileButton.textContent = state.debug.findUnknowns ? "Scanning..." : "Opening...";

  try {
    const result = await api.openFile(gameSelect.value);

    if (result?.canceled) {
      return;
    }

    state.project = result;
    state.selectedNodeId = null;
    state.selectedNode = null;
    state.spriteIndexes.clear();
    state.spriteTextureIds.clear();
    state.spriteEditorIds.clear();
    state.expandedNodeIds = new Set(result.tree.filter((node) => node.kind === "folder" && node.children.length <= 2).map((node) => node.id));

    fileName.textContent = result.fileName;
    providerName.textContent = `${result.provider.name} (${result.provider.platform})`;
    recordCounter.textContent = result.debugScan ? `${result.records.length} unknowns` : `${result.assets.length} files`;
    detailsTitle.textContent = result.fileName;
    detailsSubtitle.textContent = result.debugScan ? `Scanned ${result.scannedFiles} files in ${result.filePath}` : result.filePath;
    detailsList.replaceChildren(
      makeDetailsItem("Provider", providerName.textContent),
      makeDetailsItem(result.debugScan ? "Unknowns" : "Size", result.debugScan ? result.records.length.toString() : formatBytes(result.fileSize))
    );
    hexPreview.textContent = "";
    actionBar.replaceChildren();
    previewArea.replaceChildren();
    previewPanel.hidden = true;
    renderTree();
  } catch (error) {
    detailsTitle.textContent = "Could not open file";
    detailsSubtitle.textContent = error.message;
  } finally {
    openFileButton.disabled = !gameSelect.value;
    updateOpenButtonLabel();
  }
});

function renderGameOptions() {
  for (const game of state.games) {
    const option = document.createElement("option");
    option.value = game.id;
    option.textContent = `${game.name} - ${game.platform}`;
    gameSelect.append(option);
  }
}

function updateOpenButtonLabel() {
  openFileButton.textContent = state.debug.findUnknowns ? "Scan Folder" : "Open HNK";
}

function renderTree() {
  treeRoot.replaceChildren();

  if (!state.project) {
    const empty = document.createElement("div");
    empty.className = "tree-empty";
    empty.textContent = gameSelect.value ? "No HNK file loaded." : "No game selected.";
    treeRoot.append(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "tree-list";

  for (const node of state.project.tree) {
    list.append(renderTreeNode(node, 0));
  }

  treeRoot.append(list);
}

function renderTreeNode(node, depth) {
  const item = document.createElement("li");
  item.className = "tree-item";

  const row = document.createElement("button");
  row.type = "button";
  row.className = "tree-row";
  row.style.setProperty("--depth", depth);
  row.dataset.nodeId = node.id;

  if (state.selectedNodeId === node.id) {
    row.classList.add("selected");
  }

  const hasChildren = node.children.length > 0;
  const expanded = state.expandedNodeIds.has(node.id);

  const twist = document.createElement("span");
  twist.className = "twist";
  twist.textContent = hasChildren ? (expanded ? "v" : ">") : "";

  const icon = document.createElement("span");
  icon.className = `node-icon ${node.kind}`;
  icon.textContent = node.kind;

  const label = document.createElement("span");
  label.className = "node-label";
  label.textContent = node.label;

  row.append(twist, icon, label);

  row.addEventListener("click", async (event) => {
    if (event.target === twist && hasChildren) {
      if (state.expandedNodeIds.has(node.id)) {
        state.expandedNodeIds.delete(node.id);
      } else {
        state.expandedNodeIds.add(node.id);
      }

      renderTree();
      return;
    }

    state.selectedNodeId = node.id;
    state.selectedNode = node;
    renderTree();
    await showNodeDetails(node);
  });

  row.addEventListener("contextmenu", async (event) => {
    event.preventDefault();
    state.selectedNodeId = node.id;
    state.selectedNode = node;
    renderTree();
    await showNodeDetails(node);
    showContextMenu(event, node);
  });

  item.append(row);

  if (hasChildren && expanded) {
    const childList = document.createElement("ul");
    childList.className = "tree-list";

    for (const child of node.children) {
      childList.append(renderTreeNode(child, depth + 1));
    }

    item.append(childList);
  }

  return item;
}

function showContextMenu(event, node) {
  hideContextMenu();
  const actions = getContextMenuActions(node);

  if (actions.length === 0) {
    return;
  }

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;

  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", async () => {
      hideContextMenu();

      try {
        const result = await action.run();

        if (result && !result.canceled) {
          const errorText = result.errors?.length ? `, ${result.errors.length} errors` : "";
          detailsSubtitle.textContent = `Exported ${result.count} files${errorText}`;
        }
      } catch (error) {
        detailsSubtitle.textContent = error.message;
      }
    });
    menu.append(button);
  }

  document.body.append(menu);
  requestAnimationFrame(() => clampContextMenu(menu));
}

function hideContextMenu() {
  document.querySelector(".context-menu")?.remove();
}

function clampContextMenu(menu) {
  const rect = menu.getBoundingClientRect();
  const left = Math.min(rect.left, window.innerWidth - rect.width - 8);
  const top = Math.min(rect.top, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}

function getContextMenuActions(node) {
  if (node.nodeType !== "category") {
    return [];
  }

  const category = node.category;
  const actionsByCategory = {
    TSETexture: [
      ["Export All DDS", "dds"],
      ["Export All PNG", "png"]
    ],
    RenderModelTemplate: [
      ["Export All OBJ", "obj"],
      ["Export All OBJ Submeshes", "obj-submeshes"]
    ],
    SqueakSample: [["Export All WAV", "wav"]],
    SqueakStream: [["Export All WAV", "wav"]]
  };
  const actionDefs = actionsByCategory[category] ?? (state.project?.debugScan ? [] : [["Export All DAT", "dat"]]);

  return actionDefs.map(([label, format]) => ({
    label,
    run: () => api.exportAll(node.id, format)
  }));
}

document.addEventListener("click", hideContextMenu);
document.addEventListener("scroll", hideContextMenu, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideContextMenu();
  }
});

async function showNodeDetails(node) {
  const records = node.recordIds.map((recordId) => state.project.records[recordId]).filter(Boolean);

  detailsTitle.textContent = node.label;
  detailsSubtitle.textContent = node.subtitle || state.project.filePath;
  recordCounter.textContent = state.project.debugScan ? `${state.project.records.length} unknowns` : `${state.project.assets.length} files`;
  actionBar.replaceChildren();
  previewArea.replaceChildren();
  previewPanel.hidden = node.nodeType !== "asset";

  if (node.nodeType === "category") {
    detailsList.replaceChildren(
      makeDetailsItem("Type", "Katalog"),
      makeDetailsItem("Types", node.categoryLabel),
      makeDetailsItem("Files", node.children.length.toString())
    );
    hexPreview.textContent = "";
    return;
  }

  if (node.nodeType === "record") {
    const record = records[0];
    renderActionButtons(node, ["dat"]);
    detailsList.replaceChildren(
      makeDetailsItem("Type", "Record"),
      makeDetailsItem("Types", record.typeName),
      makeDetailsItem("Role", record.role),
      makeDetailsItem("Record", record.typeHex),
      makeDetailsItem("Size", formatBytes(record.size)),
      makeDetailsItem("Offset", `${record.start} - ${record.end}`),
      ...record.details.map((detail, index) => makeDetailsItem(index === 0 ? "Info" : "", detail))
    );
    hexPreview.textContent = record.hexPreview;
    return;
  }

  if (node.nodeType === "asset") {
    const asset = node.asset;
    const details = [
      makeDetailsItem("Type", asset.resourceType),
      makeDetailsItem("Name", asset.name),
      makeDetailsItem("Folder", asset.folder || "-"),
      makeDetailsItem("Types", asset.categoryLabel),
      makeDetailsItem("Size", formatBytes(asset.size))
    ];

    if ((asset.category === "SqueakSample" || asset.category === "SqueakStream") && asset.audio) {
      details.push(
        makeDetailsItem("Channels", asset.audio.channels.toString()),
        makeDetailsItem("Sample Rate", `${asset.audio.sampleRate} Hz`),
        makeDetailsItem("Bit Depth", `${asset.audio.bitDepth} bit`)
      );
    }

    if (asset.sprite) {
      details.push(makeDetailsItem("Sprites", asset.sprite.count.toString()));
    }

    if (asset.texture) {
      details.push(
        makeDetailsItem("Width", asset.texture.width.toString()),
        makeDetailsItem("Height", asset.texture.height.toString()),
        makeDetailsItem("Format", asset.texture.format)
      );
    }

    renderActionButtons(node, asset.exportFormats);
    renderSpriteEditorAction(node);
    detailsList.replaceChildren(...details);

    const firstPayloadRecord = records.find((record) => record.type !== 0x40071) ?? records[0];
    hexPreview.textContent = firstPayloadRecord?.hexPreview ?? "";

    await renderPreview(node);
  }
}

function renderSpriteEditorAction(node) {
  const asset = node.asset;

  if (asset?.category !== "RenderSprite") {
    return;
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "action-button";
  button.textContent = state.spriteEditorIds.has(node.id) ? "Close Sprite Editor" : "Sprite Editor";
  button.addEventListener("click", async () => {
    if (state.spriteEditorIds.has(node.id)) {
      state.spriteEditorIds.delete(node.id);
    } else {
      state.spriteEditorIds.add(node.id);
    }

    await showNodeDetails(node);
  });
  actionBar.append(button);
}

async function renderPreview(node) {
  const asset = node.asset;

  if (asset.category === "TSETexture" && asset.texture?.dataRecordId != null) {
    const loading = document.createElement("div");
    loading.className = "preview-empty";
    loading.textContent = "Loading texture...";
    previewArea.replaceChildren(loading);

    try {
      const preview = await api.previewAsset(node.id);

      if (!preview.ok) {
        throw new Error("Preview unavailable.");
      }

      const image = document.createElement("img");
      image.className = "texture-preview";
      image.src = preview.dataUrl;
      image.alt = asset.name;
      previewArea.replaceChildren(image);
    } catch (error) {
      const empty = document.createElement("div");
      empty.className = "preview-empty";
      empty.textContent = error.message;
      previewArea.replaceChildren(empty);
    }

    return;
  }

  if (asset.category === "RenderModelTemplate") {
    const loading = document.createElement("div");
    loading.className = "preview-empty";
    loading.textContent = "Loading model...";
    previewArea.replaceChildren(loading);

    try {
      const preview = await api.previewAsset(node.id);

      if (!preview.ok) {
        throw new Error("Model preview unavailable.");
      }

      renderModelPreview(preview);
    } catch (error) {
      const empty = document.createElement("div");
      empty.className = "preview-empty";
      empty.textContent = error.message;
      previewArea.replaceChildren(empty);
    }

    return;
  }

  if (asset.category === "RenderSprite") {
    await renderSpritePreview(node, state.spriteEditorIds.has(node.id));
    return;
  }

  if (asset.category === "SqueakSample" || asset.category === "SqueakStream") {
    await renderAudioPreview(node);
    return;
  }

  const empty = document.createElement("div");
  empty.className = "preview-empty";
  empty.textContent = "No preview";
  previewArea.replaceChildren(empty);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load image."));
    image.src = src;
  });
}

async function renderAudioPreview(node) {
  const asset = node.asset;
  const preview = await api.previewAsset(node.id);
  const wrapper = document.createElement("div");
  wrapper.className = "audio-preview-wrap";

  const meta = document.createElement("div");
  meta.className = "audio-meta";
  const metadata = preview.metadata ?? asset.audio;
  meta.textContent = metadata
    ? `${metadata.sampleRate} Hz, ${metadata.channels} channels, ${metadata.bitDepth} bit`
    : "Audio metadata unavailable";

  wrapper.append(meta);

  if (asset.category === "SqueakStream") {
    const folderLine = document.createElement("div");
    folderLine.className = "audio-folder-line";
    folderLine.textContent = preview.soundsFolder ? `SOUNDS: ${preview.soundsFolder}` : "SOUNDS folder not selected";

    const folderButton = document.createElement("button");
    folderButton.type = "button";
    folderButton.className = "action-button";
    folderButton.textContent = "Select SOUNDS Folder";
    folderButton.addEventListener("click", async () => {
      const result = await api.selectSoundsFolder();

      if (!result.canceled) {
        detailsSubtitle.textContent = result.folderPath;
        await renderPreview(node);
      }
    });

    wrapper.append(folderLine, folderButton);

    if (preview.streamLayout) {
      const status = document.createElement("div");
      status.className = "audio-status";
      const trimmed = preview.streamLayout.trimmedBytes > 0 ? `, trimmed ${formatBytes(preview.streamLayout.trimmedBytes)}` : "";
      status.textContent = `RAWI PCM: ${preview.streamLayout.outputChannels} channels, ${preview.streamLayout.sampleCount ?? "?"} samples${trimmed}`;
      wrapper.append(status);
    }
  }

  if (preview.dataUrl) {
    const audio = document.createElement("audio");
    audio.className = "audio-player";
    audio.controls = true;
    audio.src = preview.dataUrl;
    wrapper.append(audio);
  } else {
    const message = document.createElement("div");
    message.className = "preview-empty";
    message.textContent = preview.message ?? "Audio preview unavailable";
    wrapper.append(message);
  }

  previewArea.replaceChildren(wrapper);
}

async function renderSpritePreview(node, editorMode = false) {
  const asset = node.asset;
  const selectedIndex = state.spriteIndexes.get(node.id) ?? 0;
  const selectedTextureId = state.spriteTextureIds.get(node.id) ?? null;
  const preview = await api.previewAsset(node.id, { spriteIndex: selectedIndex, textureAssetId: selectedTextureId });

  if (!preview.ok) {
    const empty = document.createElement("div");
    empty.className = "preview-empty";
    empty.textContent = asset.sprite ? `${asset.sprite.count} sprites, no matching texture` : "No sprite preview";
    previewArea.replaceChildren(empty);
    return;
  }

  if (preview.texture?.id && !state.spriteTextureIds.has(node.id)) {
    state.spriteTextureIds.set(node.id, preview.texture.id);
  }

  if (!editorMode) {
    renderSimpleSpritePreview(node, preview);
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "sprite-preview-wrap";

  const toolbar = document.createElement("div");
  toolbar.className = "sprite-toolbar";

  const textureSelect = document.createElement("select");
  textureSelect.className = "sprite-texture-select";
  textureSelect.disabled = !preview.textureOptions?.length;

  for (const texture of preview.textureOptions ?? []) {
    const option = document.createElement("option");
    option.value = texture.id;
    option.textContent = texture.matched ? `${texture.label} *` : texture.label;
    textureSelect.append(option);
  }

  textureSelect.value = preview.texture?.id ?? "";
  textureSelect.addEventListener("change", async () => {
    state.spriteTextureIds.set(node.id, textureSelect.value);
    await renderSpritePreview(node, true);
  });

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "mode-button active";
  saveButton.textContent = "Save Table";

  const fullscreenButton = document.createElement("button");
  fullscreenButton.type = "button";
  fullscreenButton.className = "mode-button";
  fullscreenButton.textContent = "Fullscreen";

  const moveOnlyButton = document.createElement("button");
  moveOnlyButton.type = "button";
  moveOnlyButton.className = "mode-button";
  moveOnlyButton.textContent = "Move Only";

  const pixelViewButton = document.createElement("button");
  pixelViewButton.type = "button";
  pixelViewButton.className = "mode-button";
  pixelViewButton.textContent = "Pixel View";
  pixelViewButton.disabled = true;

  const fontOptionsButton = document.createElement("button");
  fontOptionsButton.type = "button";
  fontOptionsButton.className = "mode-button";
  fontOptionsButton.textContent = "Font Options";

  const status = document.createElement("span");
  status.className = "sprite-status";
  status.textContent = preview.texture ? preview.texture.label : "No texture selected";

  toolbar.append(textureSelect, saveButton, fullscreenButton, moveOnlyButton, pixelViewButton, fontOptionsButton, status);

  const stage = document.createElement("div");
  stage.className = "sprite-stage";

  const prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.className = "mode-button";
  prevButton.textContent = "<";
  prevButton.disabled = preview.selectedIndex <= 0;

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "mode-button";
  nextButton.textContent = ">";
  nextButton.disabled = preview.selectedIndex >= preview.spriteCount - 1;

  const caption = document.createElement("div");
  caption.className = "preview-empty";
  caption.textContent = `Sprite ${preview.selectedIndex + 1} / ${preview.spriteCount}`;

  prevButton.addEventListener("click", () => {
    const current = Number(table.dataset.selectedSpriteId) || 0;
    selectSpriteTableRow(table, Math.max(0, current - 1));
  });

  nextButton.addEventListener("click", () => {
    const current = Number(table.dataset.selectedSpriteId) || 0;
    selectSpriteTableRow(table, Math.min(preview.spriteCount - 1, current + 1));
  });

  let spritePreviewImage = null;

  if (preview.dataUrl) {
    spritePreviewImage = document.createElement("img");
    spritePreviewImage.className = "sprite-preview-image";
    spritePreviewImage.src = preview.dataUrl;
    spritePreviewImage.alt = `${asset.name} sprite ${preview.selectedIndex + 1}`;
    stage.append(prevButton, spritePreviewImage, nextButton, caption);
  } else {
    const noTexture = document.createElement("div");
    noTexture.className = "preview-empty";
    noTexture.textContent = "No texture available for this RenderSprite.";
    stage.append(prevButton, noTexture, nextButton, caption);
  }

  const table = makeSpriteTable(preview.sprites, preview.selectedIndex);
  table.addEventListener("sprite:selected", (event) => {
    const spriteId = Number(event.detail?.spriteId);
    caption.textContent = `Sprite ${spriteId + 1} / ${preview.spriteCount}`;
    prevButton.disabled = spriteId <= 0;
    nextButton.disabled = spriteId >= preview.spriteCount - 1;
  });
  const atlasOptions = { moveOnly: false, pixelView: false, zoom: 1 };
  moveOnlyButton.addEventListener("click", () => {
    atlasOptions.moveOnly = !atlasOptions.moveOnly;
    moveOnlyButton.classList.toggle("active", atlasOptions.moveOnly);
  });
  const fontCharactersRef = { value: preview.fontCharacters ?? DEFAULT_SPRITE_FONT_CHARACTERS };
  const atlas = preview.textureDataUrl
    ? await makeSpriteAtlasMapper(preview, table, status, spritePreviewImage, caption, atlasOptions, pixelViewButton, (spriteId) => {
      state.spriteIndexes.set(node.id, spriteId);
    })
    : null;
  const charsetPanel = makeSpriteCharsetPanel(node, table, fontCharactersRef);
  const sample = preview.textureDataUrl ? await makeSpriteSamplePanel(preview, table, fontCharactersRef) : null;
  charsetPanel.hidden = true;

  if (sample) {
    sample.hidden = true;
  }

  const updateFontOptions = (active) => {
    fontOptionsButton.classList.toggle("active", active);
    charsetPanel.hidden = !active;

    if (sample) {
      sample.hidden = !active;
    }

    wrapper.classList.toggle("has-font-options", active);
    wrapper.classList.toggle("has-sample", active && Boolean(sample));
  };

  fontOptionsButton.addEventListener("click", () => {
    updateFontOptions(!fontOptionsButton.classList.contains("active"));
  });

  updateFontOptions(false);
  const tableWrap = document.createElement("div");
  tableWrap.className = "sprite-table-wrap";
  tableWrap.append(table);

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    status.textContent = "Saving table...";

    try {
      const result = await api.saveSpriteTable(node.id, collectSpriteTableEdits(table));
      detailsSubtitle.textContent = result.filePath;
      hexPreview.textContent = result.hexPreview ?? hexPreview.textContent;
      status.textContent = `Saved ${result.updated} sprites`;
      await renderSpritePreview(node, true);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      saveButton.disabled = false;
    }
  });

  fullscreenButton.addEventListener("click", () => {
    const active = wrapper.classList.toggle("sprite-fullscreen");
    fullscreenButton.classList.toggle("active", active);
    fullscreenButton.textContent = active ? "Exit Fullscreen" : "Fullscreen";
    pixelViewButton.disabled = !active || !atlas;

    if (!active && atlasOptions.pixelView) {
      pixelViewButton.disabled = false;
      pixelViewButton.click();
      pixelViewButton.disabled = true;
    }
  });

  const workspace = document.createElement("div");
  workspace.className = "sprite-workspace";

  if (atlas) {
    workspace.append(atlas);
  }

  workspace.append(tableWrap);
  wrapper.append(toolbar, stage);
  wrapper.append(charsetPanel);
  if (sample) {
    wrapper.append(sample);
  }
  wrapper.append(workspace);
  previewArea.replaceChildren(wrapper);
}

function renderSimpleSpritePreview(node, preview) {
  const wrapper = document.createElement("div");
  wrapper.className = "sprite-preview-wrap simple";

  const stage = document.createElement("div");
  stage.className = "sprite-stage";

  const prevButton = document.createElement("button");
  prevButton.type = "button";
  prevButton.className = "mode-button";
  prevButton.textContent = "<";
  prevButton.disabled = preview.selectedIndex <= 0;

  const nextButton = document.createElement("button");
  nextButton.type = "button";
  nextButton.className = "mode-button";
  nextButton.textContent = ">";
  nextButton.disabled = preview.selectedIndex >= preview.spriteCount - 1;

  const caption = document.createElement("div");
  caption.className = "preview-empty";
  caption.textContent = `Sprite ${preview.selectedIndex + 1} / ${preview.spriteCount}`;

  prevButton.addEventListener("click", async () => {
    state.spriteIndexes.set(node.id, Math.max(0, preview.selectedIndex - 1));
    await renderSpritePreview(node, false);
  });

  nextButton.addEventListener("click", async () => {
    state.spriteIndexes.set(node.id, Math.min(preview.spriteCount - 1, preview.selectedIndex + 1));
    await renderSpritePreview(node, false);
  });

  if (preview.dataUrl) {
    const image = document.createElement("img");
    image.className = "sprite-preview-image";
    image.src = preview.dataUrl;
    stage.append(prevButton, image, nextButton, caption);
  } else {
    const empty = document.createElement("div");
    empty.className = "preview-empty";
    empty.textContent = "No sprite preview";
    stage.append(prevButton, empty, nextButton, caption);
  }

  wrapper.append(stage);
  previewArea.replaceChildren(wrapper);
}

async function makeSpriteAtlasMapper(preview, table, status, spritePreviewImage, caption, atlasOptions, pixelViewButton, onSelect) {
  const wrapper = document.createElement("div");
  wrapper.className = "sprite-atlas";

  const readout = document.createElement("div");
  readout.className = "sprite-atlas-readout";

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "sprite-atlas-canvas-wrap";

  const canvas = document.createElement("canvas");
  canvas.className = "sprite-atlas-canvas";
  canvas.width = preview.texture.width;
  canvas.height = preview.texture.height;

  const overlay = document.createElement("canvas");
  overlay.className = "sprite-atlas-overlay";

  const canvasStack = document.createElement("div");
  canvasStack.className = "sprite-atlas-canvas-stack";
  canvasStack.append(canvas, overlay);

  const context = canvas.getContext("2d");
  const image = await loadImage(preview.textureDataUrl);
  let dragging = false;
  let dragState = null;

  const draw = (hover = null) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = !atlasOptions.pixelView;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawSpriteAtlasOverlay(overlay, canvas, getSelectedSpriteFromTable(table, preview.selectedSprite), hover, atlasOptions);
    readout.textContent = formatSpriteAtlasReadout(getSelectedSpriteFromTable(table, preview.selectedSprite), hover);
  };

  pixelViewButton.addEventListener("click", () => {
    atlasOptions.pixelView = !atlasOptions.pixelView;
    pixelViewButton.classList.toggle("active", atlasOptions.pixelView);
    canvas.classList.toggle("pixel-view", atlasOptions.pixelView);

    if (atlasOptions.pixelView && atlasOptions.zoom < 8) {
      atlasOptions.zoom = 8;
      setSpriteAtlasZoom(canvas, canvasStack, atlasOptions.zoom);
    }

    status.textContent = atlasOptions.pixelView ? `Pixel View ${Math.round(atlasOptions.zoom * 100)}%` : `Zoom ${Math.round(atlasOptions.zoom * 100)}%`;
    draw();
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = spriteAtlasPoint(event, canvas);

    if (dragging && dragState) {
      applySpriteAtlasDrag(table, dragState, point);
      updateSpriteCropPreview(spritePreviewImage, image, table);
      status.textContent = "Selection changed - Save Table";
    } else {
      canvas.style.cursor = atlasOptions.moveOnly ? "move" : getSpriteAtlasCursor(getSpriteAtlasHit(point, getSelectedSpriteFromTable(table, preview.selectedSprite), canvas));
    }

    draw(point);
  });

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    const point = spriteAtlasPoint(event, canvas);
    dragState = makeSpriteAtlasDragState(point, getSelectedSpriteFromTable(table, preview.selectedSprite), canvas, atlasOptions.moveOnly);
    applySpriteAtlasDrag(table, dragState, point);
    updateSpriteCropPreview(spritePreviewImage, image, table);
    canvas.setPointerCapture(event.pointerId);
    draw(point);
  });

  canvasWrap.addEventListener("wheel", (event) => {
    if (!event.ctrlKey) {
      return;
    }

    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.85 : 1.18;
    atlasOptions.zoom = clampNumber(atlasOptions.zoom * factor, 0.25, 16);
    setSpriteAtlasZoom(canvas, canvasStack, atlasOptions.zoom);
    status.textContent = `Zoom ${Math.round(atlasOptions.zoom * 100)}%`;
    draw(spriteAtlasPoint(event, canvas));
  }, { passive: false });

  canvas.addEventListener("pointerup", (event) => {
    dragging = false;
    dragState = null;
    draw(spriteAtlasPoint(event, canvas));
  });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
    dragState = null;
  });

  canvas.addEventListener("pointerleave", () => {
    if (!dragging) {
      draw();
    }
  });

  table.addEventListener("sprite:selected", (event) => {
    const spriteId = Number(event.detail?.spriteId);
    onSelect?.(spriteId);
    caption.textContent = `Sprite ${spriteId + 1} / ${preview.spriteCount}`;
    updateSpriteCropPreview(spritePreviewImage, image, table);
    draw();
  });

  table.addEventListener("input", () => {
    updateSpriteCropPreview(spritePreviewImage, image, table);
    draw();
    status.textContent = "Selection changed - Save Table";
  });

  canvasWrap.append(canvasStack);
  wrapper.append(readout, canvasWrap);
  setSpriteAtlasZoom(canvas, canvasStack, atlasOptions.zoom);
  draw();
  updateSpriteCropPreview(spritePreviewImage, image, table);
  return wrapper;
}

function makeSpriteCharsetPanel(node, table, fontCharactersRef) {
  const wrapper = document.createElement("div");
  wrapper.className = "sprite-charset";

  const textarea = document.createElement("textarea");
  textarea.className = "sprite-charset-input";
  textarea.rows = 3;
  textarea.value = serializeSpriteFontCharacters(fontCharactersRef.value);

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "mode-button";
  saveButton.textContent = "Save Mapping";

  const status = document.createElement("span");
  status.className = "sprite-status";

  textarea.addEventListener("input", () => {
    fontCharactersRef.value = parseSpriteFontCharacters(textarea.value);
    table.dispatchEvent(new CustomEvent("sprite:changed"));
  });

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;

    try {
      fontCharactersRef.value = parseSpriteFontCharacters(textarea.value);
      const result = await api.saveSpriteFontCharacters(node.id, fontCharactersRef.value);
      status.textContent = result.filePath;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      saveButton.disabled = false;
    }
  });

  wrapper.append(textarea, saveButton, status);
  return wrapper;
}

function serializeSpriteFontCharacters(characters) {
  return characters.map((entry) => normalizeSpriteFontCharacters(entry).join("|")).join("\n");
}

function parseSpriteFontCharacters(value) {
  return String(value).split(/\r?\n/u).map((line) => {
    if (line === "") {
      return "";
    }

    const parts = line.split("|").filter(Boolean);
    return parts.length > 1 ? parts : parts[0] ?? "";
  });
}

async function makeSpriteSamplePanel(preview, table, fontCharactersRef) {
  const wrapper = document.createElement("div");
  wrapper.className = "sprite-sample";

  const input = document.createElement("textarea");
  input.className = "sprite-sample-input";
  input.rows = 2;
  input.placeholder = "Sample Text";
  input.value = "Sample Text 123\nABC abc\nĄąĆćĘęŁłŃńÓóŚśŹźŻż";

  const canvasWrap = document.createElement("div");
  canvasWrap.className = "sprite-sample-canvas-wrap";

  const canvas = document.createElement("canvas");
  canvas.className = "sprite-sample-canvas";
  canvasWrap.append(canvas);

  const image = await loadImage(preview.textureDataUrl);
  const render = () => renderSpriteSampleText(canvas, image, table, input.value, fontCharactersRef.value);

  input.addEventListener("input", render);
  table.addEventListener("input", render);
  table.addEventListener("sprite:changed", render);

  wrapper.append(input, canvasWrap);
  render();
  return wrapper;
}

function drawSpriteAtlasOverlay(overlay, canvas, sprite, hover, atlasOptions) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  const dpr = getOverlayDevicePixelRatio(width, height);

  if (overlay.width !== Math.round(width * dpr) || overlay.height !== Math.round(height * dpr)) {
    overlay.width = Math.round(width * dpr);
    overlay.height = Math.round(height * dpr);
    overlay.style.width = `${width}px`;
    overlay.style.height = `${height}px`;
  }

  const context = overlay.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);
  drawSpriteOverlayGrid(context, width, height, canvas, atlasOptions);
  drawSpriteOverlaySelection(context, width, height, sprite);

  if (hover && atlasOptions.pixelView && atlasOptions.zoom >= 4) {
    drawSpriteOverlayHoverPixel(context, width, height, hover, canvas);
  }
}

function getOverlayDevicePixelRatio(width, height) {
  const nativeDpr = window.devicePixelRatio || 1;
  const maxDimension = 8192;
  const maxPixels = 14000000;
  const dimensionScale = Math.min(maxDimension / width, maxDimension / height);
  const pixelScale = Math.sqrt(maxPixels / Math.max(1, width * height));

  return Math.max(0.05, Math.min(nativeDpr, dimensionScale, pixelScale));
}

function drawSpriteOverlaySelection(context, width, height, sprite) {
  if (!sprite) {
    return;
  }

  const x1 = Number(sprite.u1) * width;
  const y1 = Number(sprite.v1) * height;
  const x2 = Number(sprite.u2) * width;
  const y2 = Number(sprite.v2) * height;

  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return;
  }

  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const rectWidth = Math.abs(x2 - x1);
  const rectHeight = Math.abs(y2 - y1);

  context.save();
  context.fillStyle = "rgb(0 255 84 / 8%)";
  context.fillRect(left, top, rectWidth, rectHeight);
  context.strokeStyle = "rgb(0 0 0 / 85%)";
  context.lineWidth = 2;
  context.strokeRect(left, top, rectWidth, rectHeight);
  context.strokeStyle = "#24ff5f";
  context.lineWidth = 0.75;
  context.strokeRect(left, top, rectWidth, rectHeight);
  context.restore();
}

function drawSpriteOverlayGrid(context, width, height, canvas, atlasOptions) {
  if (!atlasOptions.pixelView || atlasOptions.zoom < 4) {
    return;
  }

  const stepX = width / canvas.width;
  const stepY = height / canvas.height;

  if (stepX < 3 || stepY < 3) {
    return;
  }

  context.save();
  context.strokeStyle = "rgb(255 255 255 / 26%)";
  context.lineWidth = 0.5;
  context.beginPath();

  for (let x = 0; x <= width + 0.01; x += stepX) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }

  for (let y = 0; y <= height + 0.01; y += stepY) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }

  context.stroke();
  context.restore();
}

function drawSpriteOverlayHoverPixel(context, width, height, hover, canvas) {
  const stepX = width / canvas.width;
  const stepY = height / canvas.height;
  const pixelX = Math.min(canvas.width - 1, Math.max(0, Math.floor(hover.u * canvas.width)));
  const pixelY = Math.min(canvas.height - 1, Math.max(0, Math.floor(hover.v * canvas.height)));
  const x = pixelX * stepX;
  const y = pixelY * stepY;

  context.save();
  context.strokeStyle = "rgb(36 255 95 / 70%)";
  context.lineWidth = 1;
  context.strokeRect(x, y, stepX, stepY);
  context.restore();
}

function spriteAtlasPoint(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const u = clampNumber((event.clientX - rect.left) / rect.width, 0, 1);
  const v = clampNumber((event.clientY - rect.top) / rect.height, 0, 1);
  return snapSpriteAtlasPoint({ u, v }, canvas);
}

function snapSpriteAtlasPoint(point, canvas) {
  return {
    u: clampNumber(Math.round(point.u * canvas.width) / canvas.width, 0, 1),
    v: clampNumber(Math.round(point.v * canvas.height) / canvas.height, 0, 1)
  };
}

function formatSpriteAtlasReadout(sprite, hover = null) {
  const parts = [];

  if (hover) {
    parts.push(`Hover U ${formatUv(hover.u)} V ${formatUv(hover.v)}`);
  }

  if (sprite) {
    parts.push(`U1 ${formatUv(sprite.u1)} V1 ${formatUv(sprite.v1)} U2 ${formatUv(sprite.u2)} V2 ${formatUv(sprite.v2)}`);
  }

  return parts.join(" | ") || "U1 - V1 - U2 - V2 -";
}

function getSelectedSpriteFromTable(table, fallback) {
  const row = table.querySelector(`tr[data-sprite-id="${table.dataset.selectedSpriteId}"]`) ?? table.querySelector("tr.selected-sprite-row");
  return row ? readSpriteRow(row) : fallback;
}

function updateSelectedSpriteCoordinates(table, start, end) {
  const row = table.querySelector(`tr[data-sprite-id="${table.dataset.selectedSpriteId}"]`) ?? table.querySelector("tr.selected-sprite-row");

  if (!row) {
    return;
  }

  row.querySelector('[data-field="u1"]').value = formatUv(start.u);
  row.querySelector('[data-field="v1"]').value = formatUv(start.v);
  row.querySelector('[data-field="u2"]').value = formatUv(end.u);
  row.querySelector('[data-field="v2"]').value = formatUv(end.v);
  table.dispatchEvent(new CustomEvent("sprite:changed", { detail: { spriteId: Number(row.dataset.spriteId) } }));
}

function updateSelectedSpriteCoordinatesFromRect(table, rect) {
  updateSelectedSpriteCoordinates(table, { u: rect.left, v: rect.top }, { u: rect.right, v: rect.bottom });
}

function setSpriteAtlasZoom(canvas, canvasStack, zoom) {
  const width = Math.max(1, Math.round(canvas.width * zoom));
  const height = Math.max(1, Math.round(canvas.height * zoom));
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvasStack.style.width = `${width}px`;
  canvasStack.style.height = `${height}px`;
}

function makeSpriteAtlasDragState(point, sprite, canvas, moveOnly = false) {
  const hit = getSpriteAtlasHit(point, sprite, canvas);
  const rect = snapSpriteRectToPixels(normalizeSpriteRect(sprite) ?? {
    left: point.u,
    top: point.v,
    right: point.u,
    bottom: point.v
  }, canvas);

  if (moveOnly || hit === "move") {
    return {
      mode: "move",
      startPoint: point,
      rect,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top
    };
  }

  if (hit.startsWith("resize")) {
    return { mode: hit, rect };
  }

  return { mode: "draw", startPoint: point };
}

function applySpriteAtlasDrag(table, dragState, point) {
  if (dragState.mode === "move") {
    const dx = point.u - dragState.startPoint.u;
    const dy = point.v - dragState.startPoint.v;
    const left = clampNumber(dragState.rect.left + dx, 0, 1 - dragState.width);
    const top = clampNumber(dragState.rect.top + dy, 0, 1 - dragState.height);
    updateSelectedSpriteCoordinatesFromRect(table, {
      left,
      top,
      right: left + dragState.width,
      bottom: top + dragState.height
    });
    return;
  }

  if (dragState.mode === "draw") {
    updateSelectedSpriteCoordinates(table, dragState.startPoint, point);
    return;
  }

  const rect = { ...dragState.rect };

  if (dragState.mode.includes("left")) {
    rect.left = point.u;
  }

  if (dragState.mode.includes("right")) {
    rect.right = point.u;
  }

  if (dragState.mode.includes("top")) {
    rect.top = point.v;
  }

  if (dragState.mode.includes("bottom")) {
    rect.bottom = point.v;
  }

  updateSelectedSpriteCoordinatesFromRect(table, normalizeRect(rect));
}

function getSpriteAtlasHit(point, sprite, canvas) {
  const rect = normalizeSpriteRect(sprite);

  if (!rect) {
    return "draw";
  }

  const toleranceU = Math.max(0.004, 8 / canvas.width);
  const toleranceV = Math.max(0.004, 8 / canvas.height);
  const nearLeft = Math.abs(point.u - rect.left) <= toleranceU;
  const nearRight = Math.abs(point.u - rect.right) <= toleranceU;
  const nearTop = Math.abs(point.v - rect.top) <= toleranceV;
  const nearBottom = Math.abs(point.v - rect.bottom) <= toleranceV;
  const insideX = point.u >= rect.left && point.u <= rect.right;
  const insideY = point.v >= rect.top && point.v <= rect.bottom;

  if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
    return `resize-${nearTop ? "top" : "bottom"}-${nearLeft ? "left" : "right"}`;
  }

  if (nearLeft && insideY) {
    return "resize-left";
  }

  if (nearRight && insideY) {
    return "resize-right";
  }

  if (nearTop && insideX) {
    return "resize-top";
  }

  if (nearBottom && insideX) {
    return "resize-bottom";
  }

  if (insideX && insideY) {
    return "move";
  }

  return "draw";
}

function getSpriteAtlasCursor(hit) {
  if (hit === "move") {
    return "move";
  }

  if (hit === "resize-top-left" || hit === "resize-bottom-right") {
    return "nwse-resize";
  }

  if (hit === "resize-top-right" || hit === "resize-bottom-left") {
    return "nesw-resize";
  }

  if (hit === "resize-left" || hit === "resize-right") {
    return "ew-resize";
  }

  if (hit === "resize-top" || hit === "resize-bottom") {
    return "ns-resize";
  }

  return "crosshair";
}

function normalizeSpriteRect(sprite) {
  if (!sprite) {
    return null;
  }

  const rect = normalizeRect({
    left: Number(sprite.u1),
    top: Number(sprite.v1),
    right: Number(sprite.u2),
    bottom: Number(sprite.v2)
  });

  return [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite) ? rect : null;
}

function snapSpriteRectToPixels(rect, canvas) {
  const snapped = {
    left: Math.round(rect.left * canvas.width) / canvas.width,
    top: Math.round(rect.top * canvas.height) / canvas.height,
    right: Math.round(rect.right * canvas.width) / canvas.width,
    bottom: Math.round(rect.bottom * canvas.height) / canvas.height
  };

  return normalizeRect(snapped);
}

function normalizeRect(rect) {
  const left = clampNumber(Math.min(rect.left, rect.right), 0, 1);
  const right = clampNumber(Math.max(rect.left, rect.right), 0, 1);
  const top = clampNumber(Math.min(rect.top, rect.bottom), 0, 1);
  const bottom = clampNumber(Math.max(rect.top, rect.bottom), 0, 1);

  return { left, top, right, bottom };
}

function updateSpriteCropPreview(spritePreviewImage, sourceImage, table) {
  if (!spritePreviewImage) {
    return;
  }

  const sprite = getSelectedSpriteFromTable(table, null);
  const rect = normalizeSpriteRect(sprite);

  if (!rect) {
    return;
  }

  const width = sourceImage.naturalWidth || sourceImage.width;
  const height = sourceImage.naturalHeight || sourceImage.height;
  const left = Math.floor(rect.left * width);
  const top = Math.floor(rect.top * height);
  const right = Math.ceil(rect.right * width);
  const bottom = Math.ceil(rect.bottom * height);
  const cropWidth = Math.max(1, right - left);
  const cropHeight = Math.max(1, bottom - top);
  const crop = document.createElement("canvas");
  crop.width = cropWidth;
  crop.height = cropHeight;
  crop.getContext("2d").drawImage(sourceImage, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
  spritePreviewImage.src = crop.toDataURL("image/png");
}

function renderSpriteSampleText(canvas, sourceImage, table, text, fontCharacters = DEFAULT_SPRITE_FONT_CHARACTERS) {
  const glyphs = buildSpriteGlyphMap(
    table,
    sourceImage.naturalWidth || sourceImage.width,
    sourceImage.naturalHeight || sourceImage.height,
    fontCharacters
  );
  const sourcePixels = getSpriteSampleSourcePixels(sourceImage);
  addGlyphVisibleBounds(glyphs, sourcePixels);
  const scale = 2;
  const metrics = measureSpriteSampleText(glyphs, text, scale);
  const placements = layoutSpriteSampleText(glyphs, text, metrics, scale);
  const baselineReferences = getSpriteSampleBaselineReferences(placements);
  canvas.width = metrics.width;
  canvas.height = metrics.height;

  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;

  for (const placement of placements) {
    context.drawImage(
      sourceImage,
      placement.glyph.left,
      placement.glyph.top,
      placement.glyph.width,
      placement.glyph.height,
      placement.x,
      placement.y,
      placement.width,
      placement.height
    );
  }

  for (const placement of placements) {
    const reference = baselineReferences.get(placement.lineIndex) ?? placement.visibleBottom;
    const aligned = Math.abs(placement.visibleBottom - reference) <= 1;
    drawSpriteSampleBaseline(context, placement, aligned);
  }
}

function measureSpriteSampleText(glyphs, text, scale) {
  const glyphValues = Array.from(glyphs.values()).filter((glyph) => glyph.width > 0 && glyph.height > 0);
  const lineHeight = Math.max(16, Math.ceil(Math.max(...glyphValues.map((glyph) => glyph.height), 8) * scale) + 6);
  const averageWidth = glyphValues.length
    ? glyphValues.reduce((total, glyph) => total + glyph.width, 0) / glyphValues.length
    : 8;
  const spaceWidth = Math.max(8, Math.round(averageWidth * scale * 0.55));
  const lines = String(text || " ").split("\n");
  let width = 1;

  for (const line of lines) {
    let lineWidth = 0;

    for (const char of line) {
      const glyph = glyphs.get(char);
      lineWidth += glyph ? Math.max(spaceWidth, glyph.width * scale) : spaceWidth;
    }

    width = Math.max(width, Math.ceil(lineWidth));
  }

  return {
    width: Math.min(4096, Math.max(1, width)),
    height: Math.min(2048, Math.max(lineHeight, lines.length * lineHeight + 4)),
    lineHeight,
    spaceWidth
  };
}

function layoutSpriteSampleText(glyphs, text, metrics, scale) {
  const placements = [];
  let lineIndex = 0;
  let x = 0;
  let y = 0;

  for (const char of text) {
    if (char === "\n") {
      lineIndex += 1;
      x = 0;
      y += metrics.lineHeight;
      continue;
    }

    const glyph = glyphs.get(char) ?? (char === " " ? glyphs.get(" ") : null);

    if (!glyph || char === " ") {
      x += glyph ? Math.max(metrics.spaceWidth, glyph.width * scale) : metrics.spaceWidth;
      continue;
    }

    const width = glyph.width * scale;
    const height = glyph.height * scale;
    const visibleBottom = y + Math.round(glyph.visibleBottom * scale);

    placements.push({
      char,
      glyph,
      lineIndex,
      x,
      y,
      width,
      height,
      visibleBottom
    });
    x += Math.max(1, width);
  }

  return placements;
}

function getSpriteSampleBaselineReferences(placements) {
  const baselinesByLine = new Map();

  for (const placement of placements) {
    if (!baselinesByLine.has(placement.lineIndex)) {
      baselinesByLine.set(placement.lineIndex, []);
    }

    baselinesByLine.get(placement.lineIndex).push(placement.visibleBottom);
  }

  const references = new Map();

  for (const [lineIndex, baselines] of baselinesByLine) {
    baselines.sort((left, right) => left - right);
    references.set(lineIndex, baselines[Math.floor(baselines.length / 2)]);
  }

  return references;
}

function drawSpriteSampleBaseline(context, placement, aligned) {
  const y = placement.visibleBottom + 2.5;
  context.save();
  context.strokeStyle = aligned ? "#38d65a" : "#ff3434";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(placement.x, y);
  context.lineTo(placement.x + placement.width, y);
  context.stroke();
  context.restore();
}

function getSpriteSampleSourcePixels(sourceImage) {
  const width = sourceImage.naturalWidth || sourceImage.width;
  const height = sourceImage.naturalHeight || sourceImage.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(sourceImage, 0, 0);

  return {
    width,
    height,
    data: context.getImageData(0, 0, width, height).data
  };
}

function addGlyphVisibleBounds(glyphs, sourcePixels) {
  for (const glyph of glyphs.values()) {
    let visibleBottom = -1;

    for (let y = 0; y < glyph.height; y += 1) {
      for (let x = 0; x < glyph.width; x += 1) {
        const sourceX = glyph.left + x;
        const sourceY = glyph.top + y;

        if (sourceX < 0 || sourceY < 0 || sourceX >= sourcePixels.width || sourceY >= sourcePixels.height) {
          continue;
        }

        const offset = (sourceY * sourcePixels.width + sourceX) * 4;

        if (isVisibleSpriteSamplePixel(sourcePixels.data, offset)) {
          visibleBottom = Math.max(visibleBottom, y);
        }
      }
    }

    glyph.visibleBottom = visibleBottom >= 0 ? visibleBottom : glyph.height - 1;
  }
}

function isVisibleSpriteSamplePixel(data, offset) {
  const alpha = data[offset + 3];
  const brightness = data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
  return alpha > 16 && brightness > 24;
}

function buildSpriteGlyphMap(table, textureWidth, textureHeight, fontCharacters = DEFAULT_SPRITE_FONT_CHARACTERS) {
  const glyphs = new Map();

  for (const row of table.querySelectorAll("tr[data-sprite-id]")) {
    const spriteId = Number(row.dataset.spriteId);
    const chars = normalizeSpriteFontCharacters(fontCharacters[spriteId]);

    if (chars.length === 0) {
      continue;
    }

    const sprite = readSpriteRow(row);
    const rect = normalizeSpriteRect(sprite);

    if (!rect) {
      continue;
    }

    const left = Math.floor(rect.left * textureWidth);
    const top = Math.floor(rect.top * textureHeight);
    const right = Math.ceil(rect.right * textureWidth);
    const bottom = Math.ceil(rect.bottom * textureHeight);

    const glyph = {
      left,
      top,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top)
    };

    for (const char of chars) {
      if (!glyphs.has(char)) {
        glyphs.set(char, glyph);
      }
    }
  }

  return glyphs;
}

function normalizeSpriteFontCharacters(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return value ? [value] : [];
}

function makeSpriteTable(sprites = [], selectedIndex = 0) {
  const table = document.createElement("table");
  table.className = "sprite-table";
  table.dataset.selectedSpriteId = String(selectedIndex);
  const header = document.createElement("tr");

  for (const label of ["ID", "Hash", "U1", "V1", "U2", "V2"]) {
    const th = document.createElement("th");
    th.textContent = label;
    header.append(th);
  }

  table.append(header);

  for (const sprite of sprites) {
    const row = document.createElement("tr");
    row.dataset.spriteId = sprite.id;
    row.className = sprite.id === selectedIndex ? "selected-sprite-row" : "";
    row.append(
      makeSpriteTextCell(sprite.id.toString()),
      makeSpriteInputCell("hash", sprite.hash, "text"),
      makeSpriteInputCell("u1", sprite.u1, "number"),
      makeSpriteInputCell("v1", sprite.v1, "number"),
      makeSpriteInputCell("u2", sprite.u2, "number"),
      makeSpriteInputCell("v2", sprite.v2, "number")
    );

    table.append(row);

    row.addEventListener("click", () => {
      selectSpriteTableRow(table, sprite.id);
    });

    row.addEventListener("focusin", () => {
      selectSpriteTableRow(table, sprite.id);
    });
  }

  return table;
}

function selectSpriteTableRow(table, spriteId) {
  table.dataset.selectedSpriteId = String(spriteId);

  for (const row of table.querySelectorAll("tr[data-sprite-id]")) {
    row.classList.toggle("selected-sprite-row", row.dataset.spriteId === String(spriteId));
  }

  table.dispatchEvent(new CustomEvent("sprite:selected", { detail: { spriteId } }));
}

function makeSpriteTextCell(value) {
  const td = document.createElement("td");
  td.textContent = value;
  return td;
}

function makeSpriteInputCell(field, value, type) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.className = "sprite-table-input";
  input.dataset.field = field;
  input.type = type;
  input.value = type === "number" ? formatSpriteCoordinate(value) : value;

  if (type === "number") {
    input.step = "0.000001";
  } else {
    input.maxLength = 8;
    input.spellcheck = false;
  }

  td.append(input);
  return td;
}

function collectSpriteTableEdits(table) {
  return Array.from(table.querySelectorAll("tr[data-sprite-id]")).map((row) => ({
    id: Number(row.dataset.spriteId),
    hash: row.querySelector('[data-field="hash"]').value,
    u1: Number(row.querySelector('[data-field="u1"]').value),
    v1: Number(row.querySelector('[data-field="v1"]').value),
    u2: Number(row.querySelector('[data-field="u2"]').value),
    v2: Number(row.querySelector('[data-field="v2"]').value)
  }));
}

function readSpriteRow(row) {
  return {
    id: Number(row.dataset.spriteId),
    hash: row.querySelector('[data-field="hash"]').value,
    u1: Number(row.querySelector('[data-field="u1"]').value),
    v1: Number(row.querySelector('[data-field="v1"]').value),
    u2: Number(row.querySelector('[data-field="u2"]').value),
    v2: Number(row.querySelector('[data-field="v2"]').value)
  };
}

function formatSpriteCoordinate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "";
}

function formatUv(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6).replace(/0+$/u, "").replace(/\.$/u, "") : "-";
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeDegrees(value) {
  let normalized = Math.round(value);

  while (normalized > 180) {
    normalized -= 360;
  }

  while (normalized <= -180) {
    normalized += 360;
  }

  return normalized;
}

function renderActionButtons(node, formats) {
  actionBar.replaceChildren();

  const labels = new Map([
    ["dat", "Export DAT"],
    ["dds", "Export DDS"],
    ["png", "Export PNG"],
    ["obj", "Export OBJ"],
    ["obj-submeshes", "Export OBJ Submeshes"],
    ["wav", "Export WAV"],
    ["sprites-png", "Export Sprites"]
  ]);

  for (const format of formats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button";
    button.textContent = labels.get(format) ?? `Export ${format.toUpperCase()}`;
    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        await api.exportAsset(node.id, format, getExportOptions(node, format));
      } catch (error) {
        detailsSubtitle.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    actionBar.append(button);
  }

  const importLabels = new Map([
    ["dat", "Import DAT"],
    ["png", "Import PNG"],
    ["dds", "Import DDS"]
  ]);

  for (const format of getImportFormats(node)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button";
    button.textContent = importLabels.get(format);
    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        const result = await runImportAction(node, format);

        if (result && !result.canceled) {
          detailsSubtitle.textContent = `${result.mode ? `${result.mode}: ` : ""}${result.filePath}`;
          hexPreview.textContent = result.hexPreview ?? hexPreview.textContent;

          if (node.nodeType === "asset") {
            await renderPreview(node);
          }
        }
      } catch (error) {
        detailsSubtitle.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    actionBar.append(button);
  }
}

function getImportFormats(node) {
  if (node.nodeType === "record") {
    return ["dat"];
  }

  const asset = node.asset;

  if (!asset) {
    return [];
  }

  if (asset.category === "TSETexture" && asset.texture?.dataRecordId != null) {
    return ["dat", "dds", "png"];
  }

  if (asset.payloadRecordIds?.length === 1) {
    return ["dat"];
  }

  return [];
}

async function runImportAction(node, format) {
  if (format === "dat") {
    const file = await pickImportFile(".dat,.hnk,*/*");

    if (!file) {
      return { canceled: true };
    }

    return api.importDat(node.id, await file.arrayBuffer());
  }

  if (format === "dds") {
    const file = await pickImportFile(".dds");

    if (!file) {
      return { canceled: true };
    }

    return api.importTextureDds(node.id, await file.arrayBuffer());
  }

  if (format === "png") {
    const file = await pickImportFile("image/png");

    if (!file) {
      return { canceled: true };
    }

    const url = URL.createObjectURL(file);

    try {
      const image = await loadImage(url);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const rgba = imageData.data.buffer.slice(imageData.data.byteOffset, imageData.data.byteOffset + imageData.data.byteLength);
      return api.saveTextureEdit(node.id, { width: canvas.width, height: canvas.height, rgba });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return { canceled: true };
}

function pickImportFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}

function getExportOptions(node, format) {
  if (format === "sprites-png" && node.asset?.category === "RenderSprite") {
    return { textureAssetId: state.spriteTextureIds.get(node.id) ?? null };
  }

  return {};
}

function makeDetailsItem(label, value) {
  const fragment = document.createDocumentFragment();
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = label;
  dd.textContent = value;
  fragment.append(dt, dd);
  return fragment;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function selectedGameLabel() {
  const game = state.games.find((item) => item.id === gameSelect.value);
  return game ? `${game.name} (${game.platform})` : "";
}

function renderModelPreview(preview) {
  const hasMesh = preview.meshAvailable !== false && preview.geometry.vertexCount > 0 && preview.geometry.faceCount > 0;
  const hasSkeleton = Boolean(preview.skeleton?.positions?.length);
  const activeMode = hasMesh ? state.modelViewMode : "skeleton";

  if (!hasMesh) {
    state.modelViewMode = "skeleton";
  }

  const wrapper = document.createElement("div");
  wrapper.className = "model-preview-shell";

  const toolbar = document.createElement("div");
  toolbar.className = "model-toolbar";

  const modelButton = document.createElement("button");
  modelButton.type = "button";
  modelButton.className = activeMode === "model" ? "mode-button active" : "mode-button";
  modelButton.textContent = "Model";
  modelButton.disabled = !hasMesh;

  const skeletonButton = document.createElement("button");
  skeletonButton.type = "button";
  skeletonButton.className = activeMode === "skeleton" ? "mode-button active" : "mode-button";
  skeletonButton.textContent = "Skeleton";
  skeletonButton.disabled = !hasSkeleton;

  const wireButton = document.createElement("button");
  wireButton.type = "button";
  wireButton.className = "mode-button active";
  wireButton.textContent = "Wire";
  wireButton.disabled = !hasMesh;

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "mode-button";
  resetButton.textContent = "Reset View";

  const info = document.createElement("span");
  info.className = "model-info";
  const truncated = preview.geometry.truncated ? ", preview truncated" : "";
  info.textContent = hasMesh
    ? `${preview.geometry.vertexCount} vertices, ${preview.geometry.faceCount} faces${truncated}`
    : `Skeleton only${preview.modelError ? `, ${preview.modelError}` : ""}`;

  toolbar.append(modelButton, skeletonButton, wireButton, resetButton, info);

  const canvas = document.createElement("canvas");
  canvas.className = "model-canvas";
  const skeletonDebugControls = state.debug.skeletonRotationControls && hasSkeleton
    ? makeSkeletonRotationControls(() => {
      state.modelViewMode = "skeleton";
      renderModelPreview(preview);
    })
    : null;

  wrapper.append(toolbar);

  if (skeletonDebugControls) {
    wrapper.append(skeletonDebugControls);
  }

  wrapper.append(canvas);
  previewArea.replaceChildren(wrapper);

  const viewer = createModelViewer(canvas, preview, { wireButton, info });
  viewer.draw(activeMode);

  modelButton.addEventListener("click", () => {
    if (!hasMesh) {
      return;
    }

    state.modelViewMode = "model";
    modelButton.classList.add("active");
    skeletonButton.classList.remove("active");
    viewer.setMode("model");
  });

  skeletonButton.addEventListener("click", () => {
    if (!hasSkeleton) {
      return;
    }

    state.modelViewMode = "skeleton";
    skeletonButton.classList.add("active");
    modelButton.classList.remove("active");
    viewer.setMode("skeleton");
  });

  wireButton.addEventListener("click", () => {
    viewer.setWireframe(!wireButton.classList.contains("active"));
  });

  resetButton.addEventListener("click", () => {
    viewer.resetView();
  });
}

function makeSkeletonRotationControls(onChange) {
  const wrapper = document.createElement("div");
  wrapper.className = "model-debug-toolbar";

  const label = document.createElement("span");
  label.className = "model-debug-label";

  const updateLabel = () => {
    const rotation = state.skeletonPreviewRotation;
    label.textContent = `Skeleton rotation: X ${rotation.x}° Y ${rotation.y}° Z ${rotation.z}°`;
  };

  for (const [axis, delta] of [
    ["x", -5], ["x", 5],
    ["y", -5], ["y", 5],
    ["z", -5], ["z", 5]
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "mode-button";
    button.textContent = `${axis.toUpperCase()}${delta > 0 ? "+" : "-"}`;
    button.addEventListener("click", () => {
      state.skeletonPreviewRotation[axis] = normalizeDegrees(state.skeletonPreviewRotation[axis] + delta);
      updateLabel();
      onChange();
    });
    wrapper.append(button);
  }

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "mode-button";
  resetButton.textContent = "Reset Skeleton";
  resetButton.addEventListener("click", () => {
    state.skeletonPreviewRotation = { ...DEFAULT_SKELETON_PREVIEW_ROTATION };
    updateLabel();
    onChange();
  });

  updateLabel();
  wrapper.append(resetButton, label);
  return wrapper;
}

function createModelViewer(canvas, preview, options = {}) {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: false })
    ?? canvas.getContext("webgl", { antialias: true, alpha: false });

  if (gl) {
    try {
      return createWebGlModelViewer(canvas, preview, gl, options);
    } catch (error) {
      options.info.textContent += `, WebGL fallback: ${error.message}`;
    }
  }

  if (!gl) {
    options.info.textContent += ", Canvas fallback";
  }

  options.wireButton.disabled = true;
  const fallback = createCanvasModelViewer(canvas, preview);
  return {
    draw: (mode) => fallback.draw(mode),
    setMode: (mode) => fallback.setMode?.(mode) ?? fallback.draw(mode),
    setWireframe: () => {},
    resetView: () => fallback.resetView?.()
  };
}

function createWebGlModelViewer(canvas, preview, gl, options = {}) {
  const program = createWebGlProgram(gl, MODEL_VERTEX_SHADER, MODEL_FRAGMENT_SHADER);
  const locations = getModelProgramLocations(gl, program);
  const model = createWebGlModelBuffers(gl, preview.geometry);
  const grid = createWebGlGridBuffer(gl, preview.geometry.bounds);
  const axes = createWebGlAxisBuffers(gl, preview.geometry.bounds);
  const skeletonPositions = getModelPreviewSkeletonPositions(preview);
  const skeleton = createWebGlSkeletonBuffers(gl, preview.skeleton, skeletonPositions);
  const camera = makeModelCamera(preview.geometry.bounds);
  const resizeObserver = new ResizeObserver(() => draw());
  let mode = state.modelViewMode;
  let showWireframe = true;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  resizeObserver.observe(canvas);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const draw = (nextMode = mode) => {
    mode = nextMode;
    resizeWebGlCanvas(canvas, gl);
    gl.clearColor(0.03, 0.03, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    const viewProjection = makeModelViewProjection(canvas, preview.geometry.bounds, camera);
    gl.uniformMatrix4fv(locations.mvp, false, viewProjection);

    drawWebGlLines(gl, locations, grid, [0.22, 0.22, 0.22, 1]);
    drawWebGlLines(gl, locations, axes.x, [0.95, 0.25, 0.22, 1]);
    drawWebGlLines(gl, locations, axes.y, [0.35, 0.9, 0.35, 1]);
    drawWebGlLines(gl, locations, axes.z, [0.28, 0.48, 1, 1]);

    if (mode === "skeleton") {
      if (skeleton.lines.count > 0) {
        drawWebGlLines(gl, locations, skeleton.lines, [1, 1, 1, 1]);
        drawWebGlPoints(gl, locations, skeleton.points, [0.25, 0.67, 1, 1]);
      }
      return;
    }

    if (model.triangles.count > 0) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      drawWebGlTriangles(gl, locations, model.triangles, [0.52, 0.55, 1, 0.9]);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    if (showWireframe && model.wire.count > 0) {
      drawWebGlLines(gl, locations, model.wire, [0.08, 0.1, 0.18, 0.95]);
    }
  };

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }

    camera.yaw -= (event.clientX - lastX) * 0.01;
    camera.pitch = clampNumber(camera.pitch + (event.clientY - lastY) * 0.01, -1.45, 1.45);
    lastX = event.clientX;
    lastY = event.clientY;
    draw();
  });

  canvas.addEventListener("pointerup", () => {
    dragging = false;
  });

  canvas.addEventListener("pointercancel", () => {
    dragging = false;
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    camera.zoom = clampNumber(camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.08, 20);
    draw();
  }, { passive: false });

  canvas.addEventListener("dblclick", () => {
    resetCamera(camera);
    draw();
  });

  return {
    draw,
    setMode(nextMode) {
      draw(nextMode);
    },
    setWireframe(nextShowWireframe) {
      showWireframe = nextShowWireframe;
      options.wireButton.classList.toggle("active", showWireframe);
      draw();
    },
    resetView() {
      resetCamera(camera);
      draw();
    }
  };
}

const MODEL_VERTEX_SHADER = `
attribute vec3 a_position;
attribute vec3 a_normal;
uniform mat4 u_mvp;
uniform vec4 u_color;
uniform bool u_useLighting;
varying vec4 v_color;

void main() {
  gl_Position = u_mvp * vec4(a_position, 1.0);
  vec3 normal = normalize(a_normal);
  float light = u_useLighting ? (0.35 + 0.65 * max(dot(normal, normalize(vec3(-0.45, 0.75, 0.35))), 0.0)) : 1.0;
  v_color = vec4(u_color.rgb * light, u_color.a);
  gl_PointSize = 6.0;
}
`;

const MODEL_FRAGMENT_SHADER = `
precision mediump float;
varying vec4 v_color;

void main() {
  gl_FragColor = v_color;
}
`;

function createWebGlProgram(gl, vertexSource, fragmentSource) {
  const vertexShader = compileWebGlShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileWebGlShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Could not link WebGL program.");
  }

  return program;
}

function compileWebGlShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "Could not compile WebGL shader.");
  }

  return shader;
}

function getModelProgramLocations(gl, program) {
  return {
    position: gl.getAttribLocation(program, "a_position"),
    normal: gl.getAttribLocation(program, "a_normal"),
    mvp: gl.getUniformLocation(program, "u_mvp"),
    color: gl.getUniformLocation(program, "u_color"),
    useLighting: gl.getUniformLocation(program, "u_useLighting")
  };
}

function createWebGlModelBuffers(gl, geometry) {
  const trianglePositions = [];
  const triangleNormals = [];
  const wirePositions = [];

  for (const face of geometry.faces ?? []) {
    const a = geometry.vertices[face[0]];
    const b = geometry.vertices[face[1]];
    const c = geometry.vertices[face[2]];

    if (!isModelPoint(a) || !isModelPoint(b) || !isModelPoint(c)) {
      continue;
    }

    const normal = normalizeVec3(crossVec3(subVec3(b, a), subVec3(c, a)));
    pushVec3(trianglePositions, a, b, c);
    pushVec3(triangleNormals, normal, normal, normal);
    pushVec3(wirePositions, a, b, b, c, c, a);
  }

  return {
    triangles: makeWebGlBuffer(gl, trianglePositions, triangleNormals),
    wire: makeWebGlBuffer(gl, wirePositions)
  };
}

function createWebGlGridBuffer(gl, bounds) {
  const radius = bounds.radius || 1;
  const center = bounds.center ?? [0, 0, 0];
  const y = bounds.min?.[1] ?? center[1] - radius;
  const span = radius * 1.5;
  const step = span / 10;
  const positions = [];

  for (let index = -10; index <= 10; index += 1) {
    const offset = index * step;
    positions.push(center[0] - span, y, center[2] + offset, center[0] + span, y, center[2] + offset);
    positions.push(center[0] + offset, y, center[2] - span, center[0] + offset, y, center[2] + span);
  }

  return makeWebGlBuffer(gl, positions);
}

function createWebGlAxisBuffers(gl, bounds) {
  const center = bounds.center ?? [0, 0, 0];
  const radius = bounds.radius || 1;
  const origin = [center[0], bounds.min?.[1] ?? center[1], center[2]];
  const length = radius * 0.7;

  return {
    x: makeWebGlBuffer(gl, [origin[0], origin[1], origin[2], origin[0] + length, origin[1], origin[2]]),
    y: makeWebGlBuffer(gl, [origin[0], origin[1], origin[2], origin[0], origin[1] + length, origin[2]]),
    z: makeWebGlBuffer(gl, [origin[0], origin[1], origin[2], origin[0], origin[1], origin[2] + length])
  };
}

function createWebGlSkeletonBuffers(gl, skeleton, displayPositions = []) {
  const linePositions = [];
  const pointPositions = [];
  const positions = displayPositions.length ? displayPositions : (skeleton?.positions ?? []);

  for (const point of positions) {
    if (isModelPoint(point)) {
      pointPositions.push(point[0], point[1], point[2]);
    }
  }

  for (let index = 0; index < positions.length; index += 1) {
    const parent = skeleton?.parents?.[index] ?? -1;
    const childPoint = positions[index];
    const parentPoint = positions[parent];

    if (parent >= 0 && isModelPoint(childPoint) && isModelPoint(parentPoint)) {
      linePositions.push(childPoint[0], childPoint[1], childPoint[2], parentPoint[0], parentPoint[1], parentPoint[2]);
    }
  }

  return {
    lines: makeWebGlBuffer(gl, linePositions),
    points: makeWebGlBuffer(gl, pointPositions)
  };
}

function getModelPreviewSkeletonPositions(preview) {
  const positions = preview.skeleton?.positions ?? [];

  if (positions.length === 0) {
    return [];
  }

  const rotatedPositions = rotateModelPreviewSkeleton(positions, state.skeletonPreviewRotation);
  const skeletonBounds = computePointBounds(rotatedPositions);
  const modelBounds = preview.geometry.bounds;
  const modelCenter = modelBounds.center ?? [0, 0, 0];
  const modelRadius = modelBounds.radius || 1;
  const scale = (modelRadius * 0.85) / Math.max(skeletonBounds.radius, 0.001);

  return rotatedPositions.map((point) => [
    modelCenter[0] + (point[0] - skeletonBounds.center[0]) * scale,
    modelCenter[1] + (point[1] - skeletonBounds.center[1]) * scale,
    modelCenter[2] + (point[2] - skeletonBounds.center[2]) * scale
  ]);
}

function rotateModelPreviewSkeleton(positions, rotation) {
  const bounds = computePointBounds(positions);
  const rx = ((rotation?.x ?? 0) * Math.PI) / 180;
  const ry = ((rotation?.y ?? 0) * Math.PI) / 180;
  const rz = ((rotation?.z ?? 0) * Math.PI) / 180;
  const cosX = Math.cos(rx);
  const sinX = Math.sin(rx);
  const cosY = Math.cos(ry);
  const sinY = Math.sin(ry);
  const cosZ = Math.cos(rz);
  const sinZ = Math.sin(rz);

  return positions.map((point) => {
    if (!isModelPoint(point)) {
      return point;
    }

    const x = point[0] - bounds.center[0];
    const y = point[1] - bounds.center[1];
    const z = point[2] - bounds.center[2];
    const y1 = y * cosX - z * sinX;
    const z1 = y * sinX + z * cosX;
    const x2 = x * cosY + z1 * sinY;
    const z2 = -x * sinY + z1 * cosY;
    const x3 = x2 * cosZ - y1 * sinZ;
    const y3 = x2 * sinZ + y1 * cosZ;

    return [
      bounds.center[0] + x3,
      bounds.center[1] + y3,
      bounds.center[2] + z2
    ];
  });
}

function computePointBounds(points) {
  const validPoints = points.filter(isModelPoint);

  if (validPoints.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      radius: 1
    };
  }

  const min = [...validPoints[0]];
  const max = [...validPoints[0]];

  for (const point of validPoints) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }

  const center = min.map((value, axis) => (value + max[axis]) / 2);
  const radius = Math.max(...validPoints.map((point) => Math.hypot(point[0] - center[0], point[1] - center[1], point[2] - center[2])), 1);

  return { min, max, center, radius };
}

function makeWebGlBuffer(gl, positions, normals = null) {
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

  let normalBuffer = null;

  if (normals) {
    normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
  }

  return {
    positionBuffer,
    normalBuffer,
    count: Math.floor(positions.length / 3)
  };
}

function drawWebGlTriangles(gl, locations, buffer, color) {
  bindWebGlBuffer(gl, locations, buffer, true);
  gl.uniform4fv(locations.color, color);
  gl.uniform1i(locations.useLighting, 1);
  gl.drawArrays(gl.TRIANGLES, 0, buffer.count);
}

function drawWebGlLines(gl, locations, buffer, color) {
  bindWebGlBuffer(gl, locations, buffer, false);
  gl.uniform4fv(locations.color, color);
  gl.uniform1i(locations.useLighting, 0);
  gl.drawArrays(gl.LINES, 0, buffer.count);
}

function drawWebGlPoints(gl, locations, buffer, color) {
  bindWebGlBuffer(gl, locations, buffer, false);
  gl.uniform4fv(locations.color, color);
  gl.uniform1i(locations.useLighting, 0);
  gl.drawArrays(gl.POINTS, 0, buffer.count);
}

function bindWebGlBuffer(gl, locations, buffer, useNormals) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer.positionBuffer);
  gl.enableVertexAttribArray(locations.position);
  gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);

  if (useNormals && buffer.normalBuffer) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer.normalBuffer);
    gl.enableVertexAttribArray(locations.normal);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);
  } else {
    gl.disableVertexAttribArray(locations.normal);
    gl.vertexAttrib3f(locations.normal, 0, 1, 0);
  }
}

function makeModelCamera(bounds) {
  const camera = {};
  resetCamera(camera, bounds);
  return camera;
}

function resetCamera(camera) {
  camera.yaw = -0.75;
  camera.pitch = 0.35;
  camera.zoom = 1;
}

function makeModelViewProjection(canvas, bounds, camera) {
  const center = bounds.center ?? [0, 0, 0];
  const radius = bounds.radius || 1;
  const distance = Math.max(radius * 0.2, radius * 3.2 / camera.zoom);
  const cosPitch = Math.cos(camera.pitch);
  const eye = [
    center[0] + Math.sin(camera.yaw) * cosPitch * distance,
    center[1] + Math.sin(camera.pitch) * distance,
    center[2] + Math.cos(camera.yaw) * cosPitch * distance
  ];
  const aspect = Math.max(1, canvas.width) / Math.max(1, canvas.height);
  const projection = mat4Perspective(Math.PI / 4, aspect, Math.max(0.001, radius / 500), radius * 80 + distance);
  const view = mat4LookAt(eye, center, [0, 1, 0]);
  return mat4Multiply(projection, view);
}

function resizeWebGlCanvas(canvas, gl) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0, 0, width, height);
}

function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0
  ]);
}

function mat4LookAt(eye, center, up) {
  const z = normalizeVec3(subVec3(eye, center));
  const x = normalizeVec3(crossVec3(up, z));
  const y = crossVec3(z, x);

  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dotVec3(x, eye), -dotVec3(y, eye), -dotVec3(z, eye), 1
  ]);
}

function mat4Multiply(a, b) {
  const out = new Float32Array(16);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[0 * 4 + row] * b[column * 4 + 0] +
        a[1 * 4 + row] * b[column * 4 + 1] +
        a[2 * 4 + row] * b[column * 4 + 2] +
        a[3 * 4 + row] * b[column * 4 + 3];
    }
  }

  return out;
}

function pushVec3(target, ...points) {
  for (const point of points) {
    target.push(point[0], point[1], point[2]);
  }
}

function isModelPoint(point) {
  return Array.isArray(point) && point.length >= 3 && point.every(Number.isFinite);
}

function subVec3(left, right) {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function crossVec3(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function dotVec3(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function normalizeVec3(vector) {
  const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function createCanvasModelViewer(canvas, preview) {
  const context = canvas.getContext("2d");
  const geometry = preview.geometry;
  let yaw = -0.75;
  let pitch = 0.35;
  let zoom = 1;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let mode = "model";

  const draw = (nextMode = mode) => {
    mode = nextMode;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    canvas.width = width * window.devicePixelRatio;
    canvas.height = height * window.devicePixelRatio;
    context.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    drawGrid(context, width, height);

    if (mode === "skeleton") {
      drawSkeleton(context, preview.skeleton, geometry.bounds, width, height, yaw, pitch, zoom);
    } else {
      drawGeometry(context, geometry, width, height, yaw, pitch, zoom);
    }
  };

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }

    yaw -= (event.clientX - lastX) * 0.01;
    pitch += (event.clientY - lastY) * 0.01;
    pitch = Math.max(-1.45, Math.min(1.45, pitch));
    lastX = event.clientX;
    lastY = event.clientY;
    draw();
  });

  canvas.addEventListener("pointerup", () => {
    dragging = false;
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoom *= event.deltaY > 0 ? 0.9 : 1.1;
    zoom = Math.max(0.15, Math.min(8, zoom));
    draw();
  });

  window.addEventListener("resize", () => draw());

  return {
    draw,
    setMode(nextMode) {
      draw(nextMode);
    },
    resetView() {
      yaw = -0.75;
      pitch = 0.35;
      zoom = 1;
      draw();
    }
  };
}

function drawGeometry(context, geometry, width, height, yaw, pitch, zoom) {
  const center = geometry.bounds.center;
  const radius = geometry.bounds.radius || 1;
  const projected = geometry.vertices.map((vertex) => projectPoint(vertex, center, radius, width, height, yaw, pitch, zoom));

  context.lineWidth = 1;
  context.strokeStyle = "#9fb7ff";
  context.beginPath();

  for (const face of geometry.faces) {
    const a = projected[face[0]];
    const b = projected[face[1]];
    const c = projected[face[2]];

    if (!a || !b || !c) {
      continue;
    }

    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.lineTo(c.x, c.y);
    context.lineTo(a.x, a.y);
  }

  context.stroke();
}

function drawSkeleton(context, skeleton, bounds, width, height, yaw, pitch, zoom) {
  if (!skeleton?.positions?.length) {
    context.fillStyle = "#888888";
    context.fillText("No skeleton found", width / 2 - 44, height / 2);
    return;
  }

  const center = bounds.center ?? [0, 0, 0];
  const radius = bounds.radius || 1;
  const displayPositions = getModelPreviewSkeletonPositions({ skeleton, geometry: { bounds } });
  const projected = displayPositions.map((point) => projectPoint(point, center, radius, width, height, yaw, pitch, zoom));

  context.lineWidth = 2;
  context.strokeStyle = "#ffffff";
  context.beginPath();

  for (let index = 0; index < skeleton.parents.length; index += 1) {
    const parent = skeleton.parents[index];

    if (parent >= 0) {
      context.moveTo(projected[index].x, projected[index].y);
      context.lineTo(projected[parent].x, projected[parent].y);
    }
  }

  context.stroke();

  for (let index = 0; index < projected.length; index += 1) {
    context.fillStyle = index === 0 ? "#ff5555" : "#4fb3ff";
    context.beginPath();
    context.arc(projected[index].x, projected[index].y, index === 0 ? 5 : 3, 0, Math.PI * 2);
    context.fill();
  }
}

function projectPoint(point, center, radius, width, height, yaw, pitch, zoom) {
  const x = (point[0] - center[0]) / radius;
  const y = (point[1] - center[1]) / radius;
  const z = (point[2] - center[2]) / radius;
  const cosY = Math.cos(yaw);
  const sinY = Math.sin(yaw);
  const cosP = Math.cos(pitch);
  const sinP = Math.sin(pitch);
  const rx = x * cosY - z * sinY;
  const rz = x * sinY + z * cosY;
  const ry = y * cosP - rz * sinP;
  const rz2 = y * sinP + rz * cosP;
  const distance = 3.2;
  const perspective = distance / (distance + rz2);
  const scale = Math.min(width, height) * 0.42 * zoom * perspective;

  return {
    x: width / 2 + rx * scale,
    y: height / 2 - ry * scale
  };
}

function drawGrid(context, width, height) {
  context.fillStyle = "#080808";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#202020";
  context.lineWidth = 1;

  for (let x = 0; x < width; x += 32) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, height);
    context.stroke();
  }

  for (let y = 0; y < height; y += 32) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }
}
