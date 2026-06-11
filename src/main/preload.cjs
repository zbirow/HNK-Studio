const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hnkApi", {
  listGames: () => ipcRenderer.invoke("games:list"),
  getDebugState: () => ipcRenderer.invoke("debug:getState"),
  onDebugStateChanged: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("debug:stateChanged", handler);
    return () => ipcRenderer.removeListener("debug:stateChanged", handler);
  },
  openFile: (gameId) => ipcRenderer.invoke("hnk:open", { gameId }),
  previewAsset: (nodeId, options = {}) => ipcRenderer.invoke("asset:preview", { nodeId, ...options }),
  exportAsset: (nodeId, format, options = {}) => ipcRenderer.invoke("asset:export", { nodeId, format, ...options }),
  exportAll: (nodeId, format) => ipcRenderer.invoke("asset:exportAll", { nodeId, format }),
  importDat: (nodeId, data) => ipcRenderer.invoke("asset:importDat", { nodeId, data }),
  importTextureDds: (nodeId, dds) => ipcRenderer.invoke("texture:importDds", { nodeId, dds }),
  saveTextureEdit: (nodeId, edit) => ipcRenderer.invoke("texture:saveEdit", { nodeId, ...edit }),
  saveSpriteTable: (nodeId, sprites) => ipcRenderer.invoke("sprite:saveTable", { nodeId, sprites }),
  saveSpriteFontCharacters: (nodeId, characters) => ipcRenderer.invoke("sprite:saveFontCharacters", { nodeId, characters }),
  selectSoundsFolder: () => ipcRenderer.invoke("sounds:selectFolder")
});
