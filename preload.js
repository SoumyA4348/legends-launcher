const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("launcherApi", {
  start: (config) => ipcRenderer.invoke("launcher:start", config),
  getAuth: () => ipcRenderer.invoke("launcher:auth-get"),
  login: () => ipcRenderer.invoke("launcher:auth-login"),
  logout: () => ipcRenderer.invoke("launcher:auth-logout"),
  auth: () => ipcRenderer.invoke("launcher:auth-login"),
  onStatus: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("launcher:status", listener);
    return () => ipcRenderer.removeListener("launcher:status", listener);
  }
});
