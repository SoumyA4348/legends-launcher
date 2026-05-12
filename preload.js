const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcherApi", {
  start: (config) => ipcRenderer.invoke("launcher:start", config),
  auth: () => ipcRenderer.invoke("launcher:auth"),
  onStatus: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("launcher:status", listener);
    return () => ipcRenderer.removeListener("launcher:status", listener);
  }
});
