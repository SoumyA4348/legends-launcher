const { contextBridge, ipcRenderer } = require("electron");

// Subscribes to a main-process channel; returns an unsubscribe function.
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("launcherApi", {
  start: (config) => ipcRenderer.invoke("launcher:start", config),
  stop: () => ipcRenderer.invoke("launcher:stop"),
  openCrashReport: () => ipcRenderer.invoke("launcher:open-crash-report"),
  getAuth: () => ipcRenderer.invoke("launcher:auth-get"),
  login: () => ipcRenderer.invoke("launcher:auth-login"),
  logout: () => ipcRenderer.invoke("launcher:auth-logout"),
  listAccounts: () => ipcRenderer.invoke("launcher:accounts-list"),
  switchAccount: (uuid) => ipcRenderer.invoke("launcher:accounts-switch", uuid),
  removeAccount: (uuid) => ipcRenderer.invoke("launcher:accounts-remove", uuid),
  getVersions: () => ipcRenderer.invoke("launcher:versions"),
  getSystemInfo: () => ipcRenderer.invoke("launcher:system-info"),
  getServerStatus: (host, port) => ipcRenderer.invoke("launcher:server-status", host, port),
  openGameFolder: (instanceId) => ipcRenderer.invoke("launcher:open-game-folder", instanceId),
  searchMods: (query, version) => ipcRenderer.invoke("launcher:mods-search", query, version),
  deleteInstance: (instanceId, name) => ipcRenderer.invoke("launcher:instance-delete", instanceId, name),
  installUpdate: () => ipcRenderer.invoke("launcher:install-update"),
  onLog: (callback) => subscribe("launcher:log", callback),
  onProgress: (callback) => subscribe("launcher:progress", callback),
  onPhase: (callback) => subscribe("launcher:phase", callback),
  onUpdate: (callback) => subscribe("launcher:update", callback),
  onSignedOut: (callback) => subscribe("launcher:signed-out", callback)
});
