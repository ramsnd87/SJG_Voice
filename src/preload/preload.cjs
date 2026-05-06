const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("gsb", {
  pickFile: (opts) => ipcRenderer.invoke("gsb:pickFile", opts),
  env: () => ipcRenderer.invoke("gsb:env"),
});
