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
  exportAsset: (nodeId, format) => ipcRenderer.invoke("asset:export", { nodeId, format }),
  exportAll: (nodeId, format) => ipcRenderer.invoke("asset:exportAll", { nodeId, format }),
  selectSoundsFolder: () => ipcRenderer.invoke("sounds:selectFolder")
});
