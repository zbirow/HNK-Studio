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
  getDebugState: async () => ({ enabled: false, findUnknowns: false }),
  onDebugStateChanged: () => () => {},
  openFile: async () => {
    throw new Error("Electron preload API is not available.");
  },
  previewAsset: async () => ({ ok: false }),
  exportAsset: async () => ({ canceled: true }),
  exportAll: async () => ({ canceled: true }),
  selectSoundsFolder: async () => ({ canceled: true })
};

const state = {
  games: [],
  project: null,
  selectedNodeId: null,
  selectedNode: null,
  expandedNodeIds: new Set(),
  spriteIndexes: new Map(),
  modelViewMode: "model",
  debug: { enabled: false, findUnknowns: false }
};

init();

async function init() {
  previewPanel.hidden = true;
  const [games, debug] = await Promise.all([api.listGames(), api.getDebugState()]);
  state.games = games;
  state.debug = debug;
  api.onDebugStateChanged((nextDebug) => {
    state.debug = nextDebug;
    updateOpenButtonLabel();
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
    detailsList.replaceChildren(...details);

    const firstPayloadRecord = records.find((record) => record.type !== 0x40071) ?? records[0];
    hexPreview.textContent = firstPayloadRecord?.hexPreview ?? "";

    await renderPreview(node);
  }
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
    await renderSpritePreview(node);
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

async function renderSpritePreview(node) {
  const asset = node.asset;
  const selectedIndex = state.spriteIndexes.get(node.id) ?? 0;
  const preview = await api.previewAsset(node.id, { spriteIndex: selectedIndex });

  if (preview.ok && preview.dataUrl) {
    const wrapper = document.createElement("div");
    wrapper.className = "sprite-preview-wrap";

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

    const image = document.createElement("img");
    image.className = "sprite-preview-image";
    image.src = preview.dataUrl;
    image.alt = `${asset.name} sprite ${preview.selectedIndex + 1}`;

    const caption = document.createElement("div");
    caption.className = "preview-empty";
    caption.textContent = `Sprite ${preview.selectedIndex + 1} / ${preview.spriteCount}`;

    prevButton.addEventListener("click", async () => {
      state.spriteIndexes.set(node.id, Math.max(0, preview.selectedIndex - 1));
      await renderSpritePreview(node);
    });

    nextButton.addEventListener("click", async () => {
      state.spriteIndexes.set(node.id, Math.min(preview.spriteCount - 1, preview.selectedIndex + 1));
      await renderSpritePreview(node);
    });

    stage.append(prevButton, image, nextButton, caption);
    wrapper.append(stage, makeSpriteTable(preview.sprites, preview.selectedIndex, async (index) => {
      state.spriteIndexes.set(node.id, index);
      await renderSpritePreview(node);
    }));
    previewArea.replaceChildren(wrapper);
    return;
  }

  const empty = document.createElement("div");
  empty.className = "preview-empty";
  empty.textContent = asset.sprite ? `${asset.sprite.count} sprites, no matching texture` : "No sprite preview";
  previewArea.replaceChildren(empty);
}

function makeSpriteTable(sprites = [], selectedIndex = 0, onSelect = null) {
  const table = document.createElement("table");
  table.className = "sprite-table";
  const header = document.createElement("tr");

  for (const label of ["ID", "Hash", "U1", "V1", "U2", "V2"]) {
    const th = document.createElement("th");
    th.textContent = label;
    header.append(th);
  }

  table.append(header);

  for (const sprite of sprites) {
    const row = document.createElement("tr");
    row.className = sprite.id === selectedIndex ? "selected-sprite-row" : "";
    const values = [sprite.id, sprite.hash, sprite.u1, sprite.v1, sprite.u2, sprite.v2];

    for (const value of values) {
      const td = document.createElement("td");
      td.textContent = typeof value === "number" ? value.toFixed(3).replace(/\.000$/u, "") : value;
      row.append(td);
    }

    table.append(row);

    if (onSelect) {
      row.addEventListener("click", () => onSelect(sprite.id));
    }
  }

  return table;
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
        await api.exportAsset(node.id, format);
      } catch (error) {
        detailsSubtitle.textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    actionBar.append(button);
  }
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
  const wrapper = document.createElement("div");
  wrapper.className = "model-preview-shell";

  const toolbar = document.createElement("div");
  toolbar.className = "model-toolbar";

  const modelButton = document.createElement("button");
  modelButton.type = "button";
  modelButton.className = state.modelViewMode === "model" ? "mode-button active" : "mode-button";
  modelButton.textContent = "Model";

  const skeletonButton = document.createElement("button");
  skeletonButton.type = "button";
  skeletonButton.className = state.modelViewMode === "skeleton" ? "mode-button active" : "mode-button";
  skeletonButton.textContent = "Skeleton";

  const info = document.createElement("span");
  info.className = "model-info";
  info.textContent = `${preview.geometry.vertexCount} vertices, ${preview.geometry.faceCount} faces`;

  toolbar.append(modelButton, skeletonButton, info);

  const canvas = document.createElement("canvas");
  canvas.className = "model-canvas";
  wrapper.append(toolbar, canvas);
  previewArea.replaceChildren(wrapper);

  const viewer = createCanvasModelViewer(canvas, preview);
  viewer.draw(state.modelViewMode);

  modelButton.addEventListener("click", () => {
    state.modelViewMode = "model";
    modelButton.classList.add("active");
    skeletonButton.classList.remove("active");
    viewer.draw("model");
  });

  skeletonButton.addEventListener("click", () => {
    state.modelViewMode = "skeleton";
    skeletonButton.classList.add("active");
    modelButton.classList.remove("active");
    viewer.draw("skeleton");
  });
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
      drawSkeleton(context, preview.skeleton, width, height, yaw, pitch, zoom);
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

    yaw += (event.clientX - lastX) * 0.01;
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

  return { draw };
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

function drawSkeleton(context, skeleton, width, height, yaw, pitch, zoom) {
  if (!skeleton?.positions?.length) {
    context.fillStyle = "#888888";
    context.fillText("No skeleton found", width / 2 - 44, height / 2);
    return;
  }

  const center = [0, 0, 0];
  const radius = 1;
  const projected = skeleton.positions.map((point) => projectPoint(point, center, radius, width, height, yaw, pitch, zoom));

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
