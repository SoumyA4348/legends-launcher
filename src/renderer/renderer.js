const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');

navItems.forEach(item => {
  item.addEventListener('click', () => {
    navItems.forEach(nav => nav.classList.remove('active'));
    views.forEach(view => view.classList.remove('active'));
    item.classList.add('active');
    const targetView = document.getElementById(`view-${item.getAttribute('data-tab')}`);
    if (targetView) targetView.classList.add('active');
  });
});

const launchBtn = document.getElementById("launchBtn");
const statusEl = document.getElementById("status");
const logsEl = document.getElementById("logs");

const usernameInput = document.getElementById("username");
const versionInput = document.getElementById("version");
const launchProfileInput = document.getElementById("launchProfile");
const serverHostInput = document.getElementById("serverHost");
const serverPortInput = document.getElementById("serverPort");
const maxMemoryInput = document.getElementById("maxMemoryMb");
const installParkourPackInput = document.getElementById("installParkourPack");
const installFpsHudInput = document.getElementById("installFpsHud");
const profileAvatar = document.getElementById("profileAvatar");
const msLoginBtn = document.getElementById("msLoginBtn");

let currentAuth = null;

// --- Settings persistence ---

const SETTINGS_KEY = "legends_launcher_settings";

const SETTINGS_FIELDS = [
  { el: usernameInput,        key: "username",           type: "text" },
  { el: versionInput,         key: "version",            type: "text" },
  { el: launchProfileInput,   key: "launchProfile",      type: "text" },
  { el: serverHostInput,      key: "serverHost",         type: "text" },
  { el: serverPortInput,      key: "serverPort",         type: "text" },
  { el: maxMemoryInput,       key: "maxMemoryMb",        type: "text" },
  { el: installParkourPackInput, key: "installParkourPack", type: "checkbox" },
  { el: installFpsHudInput,   key: "installFpsHud",      type: "checkbox" },
];

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    for (const field of SETTINGS_FIELDS) {
      if (field.el && saved[field.key] !== undefined) {
        if (field.type === "checkbox") {
          field.el.checked = saved[field.key];
        } else {
          field.el.value = saved[field.key];
        }
      }
    }
    const savedName = saved.username ? saved.username.trim() : "Steve";
    if (profileAvatar) {
      profileAvatar.src = `https://minotar.net/helm/${savedName}/200.png`;
    }
  } catch (_e) {
    // Corrupted storage — ignore and use defaults.
  }
}

function saveSettings() {
  const settings = {};
  for (const field of SETTINGS_FIELDS) {
    if (!field.el) continue;
    settings[field.key] = field.type === "checkbox" ? field.el.checked : field.el.value;
  }
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (_e) {
    // Storage quota exceeded — ignore.
  }
}

// Save on any input change
for (const field of SETTINGS_FIELDS) {
  if (!field.el) continue;
  const event = field.type === "checkbox" ? "change" : "input";
  field.el.addEventListener(event, saveSettings);
}

// Restore on load
loadSettings();

// --- Avatar ---

usernameInput.addEventListener("blur", () => {
  const name = usernameInput.value.trim() || "Steve";
  if (profileAvatar) profileAvatar.src = `https://minotar.net/helm/${name}/200.png`;
  saveSettings();
});

// --- Launcher ---

function pushLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  logsEl.textContent += `[${timestamp}] ${message}\n`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

msLoginBtn.addEventListener("click", async () => {
  msLoginBtn.disabled = true;
  msLoginBtn.textContent = "Logging in...";
  setStatus("Authenticating with Microsoft...");

  const result = await window.launcherApi.auth();
  if (result.ok) {
    currentAuth = result.profile;
    usernameInput.value = result.profile.name;
    if (profileAvatar) profileAvatar.src = `https://minotar.net/helm/${result.profile.name}/200.png`;
    setStatus(`Logged in as ${result.profile.name}`);
    pushLog(`Microsoft Auth Success: ${result.profile.name}`);
    saveSettings();
  } else {
    setStatus(result.message, true);
    pushLog(`Auth Error: ${result.message}`);
  }

  msLoginBtn.disabled = false;
  msLoginBtn.textContent = "Microsoft Login";
});

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = `status-text ${isError ? "error" : "ok"}`;
}

const unsubscribe = window.launcherApi.onStatus((message) => {
  pushLog(message);

  if (message.includes("Minecraft closed.")) {
    launchBtn.disabled = false;
    launchBtn.textContent = "PLAY";
    setStatus("Minecraft closed. Ready to launch again.");
    return;
  }

  if (message.includes("Launch error:")) {
    launchBtn.disabled = false;
    launchBtn.textContent = "PLAY";
    setStatus(message, true);
    return;
  }

  if (message.includes("Loading Minecraft") || message.includes("Minecraft process")) {
    setStatus("Minecraft is running.");
    launchBtn.textContent = "RUNNING";
  }
});

window.addEventListener("beforeunload", () => {
  if (typeof unsubscribe === "function") unsubscribe();
});

launchBtn.addEventListener("click", async () => {
  launchBtn.disabled = true;
  launchBtn.textContent = "STARTING...";
  setStatus("Starting launch sequence...");
  saveSettings();

  const config = {
    username: usernameInput.value,
    version: versionInput.value,
    launchProfile: launchProfileInput.value,
    serverHost: serverHostInput.value,
    serverPort: serverPortInput.value,
    maxMemoryMb: maxMemoryInput.value,
    installParkourPack: installParkourPackInput.checked,
    installFpsHud: installFpsHudInput.checked,
    auth: currentAuth
  };

  const result = await window.launcherApi.start(config);
  if (!result.ok) {
    setStatus(result.message, true);
    pushLog(`ERROR: ${result.message}`);
    launchBtn.disabled = false;
    launchBtn.textContent = "PLAY";
    return;
  }

  setStatus(result.message);
  pushLog(result.message);
});
