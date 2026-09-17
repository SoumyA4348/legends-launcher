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
const msAuthBtn = document.getElementById("msAuthBtn");
const msAuthBtnText = document.getElementById("msAuthBtnText");
const authBadge = document.getElementById("authBadge");

let currentAuth = null;
let isAuthenticating = false;

// --- Settings persistence ---

const SETTINGS_KEY = "legends_launcher_settings";

const SETTINGS_FIELDS = [
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

// Restore configuration on load
loadSettings();

// --- Auth State Handlers ---

function setAuthenticatedState(profile) {
  currentAuth = profile;
  usernameInput.value = profile.name;
  usernameInput.readOnly = true;

  if (profileAvatar) {
    profileAvatar.src = `https://mc-heads.net/avatar/${profile.name}/200.png`;
    profileAvatar.onerror = () => {
      profileAvatar.src = `https://minotar.net/helm/${profile.name}/200.png`;
    };
    profileAvatar.title = `Signed in as ${profile.name}`;
  }

  if (authBadge) {
    authBadge.textContent = "VERIFIED";
    authBadge.className = "auth-badge auth";
  }

  if (msAuthBtnText) {
    msAuthBtnText.textContent = "Sign Out";
  }
  if (msAuthBtn) {
    msAuthBtn.title = `Signed in as ${profile.name}. Click to sign out.`;
  }

  if (launchBtn.textContent !== "RUNNING" && launchBtn.textContent !== "STARTING...") {
    launchBtn.disabled = false;
    launchBtn.textContent = "PLAY";
    setStatus(`Ready to play as ${profile.name}`);
  }
}

function setUnauthenticatedState() {
  currentAuth = null;
  usernameInput.value = "";
  usernameInput.placeholder = "Sign in required...";
  usernameInput.readOnly = true;

  if (profileAvatar) {
    profileAvatar.src = "https://mc-heads.net/avatar/MHF_Steve/200.png";
    profileAvatar.title = "Click to sign in with Microsoft";
  }

  if (authBadge) {
    authBadge.textContent = "NOT SIGNED IN";
    authBadge.className = "auth-badge unauth";
  }

  if (msAuthBtnText) {
    msAuthBtnText.textContent = "Sign In";
  }
  if (msAuthBtn) {
    msAuthBtn.title = "Sign in with Microsoft";
  }

  if (launchBtn.textContent !== "RUNNING" && launchBtn.textContent !== "STARTING...") {
    launchBtn.disabled = false;
    launchBtn.textContent = "SIGN IN TO PLAY";
    setStatus("Microsoft account required to play.", true);
  }
}

async function handleLogin() {
  if (isAuthenticating) return;
  isAuthenticating = true;

  if (msAuthBtn) msAuthBtn.disabled = true;
  launchBtn.disabled = true;
  if (msAuthBtnText) msAuthBtnText.textContent = "Signing in...";
  setStatus("Signing in with Microsoft...");
  pushLog("Opening Microsoft sign-in window...");

  try {
    const result = await window.launcherApi.login();
    if (result && result.ok && result.profile) {
      setAuthenticatedState(result.profile);
      pushLog(`Microsoft Auth Success: ${result.profile.name}`);
      setStatus(`Logged in as ${result.profile.name}`);
    } else {
      setUnauthenticatedState();
      const msg = result?.message || "Sign-in was cancelled or failed.";
      setStatus(msg, true);
      pushLog(`Auth: ${msg}`);
    }
  } catch (error) {
    setUnauthenticatedState();
    const msg = error?.message || "Authentication error.";
    setStatus(msg, true);
    pushLog(`Auth Error: ${msg}`);
  } finally {
    isAuthenticating = false;
    if (msAuthBtn) msAuthBtn.disabled = false;
  }
}

async function handleLogout() {
  if (msAuthBtn) msAuthBtn.disabled = true;
  if (msAuthBtnText) msAuthBtnText.textContent = "Signing out...";
  try {
    await window.launcherApi.logout();
    setUnauthenticatedState();
    setStatus("Signed out. Sign in with Microsoft to play.");
    pushLog("Signed out of Microsoft account.");
  } catch (error) {
    pushLog(`Logout Error: ${error.message}`);
  } finally {
    if (msAuthBtn) msAuthBtn.disabled = false;
  }
}

async function checkInitialAuth() {
  setStatus("Checking Microsoft account...");
  try {
    const res = await window.launcherApi.getAuth();
    if (res && res.authenticated && res.profile) {
      setAuthenticatedState(res.profile);
      pushLog(`Active Microsoft session: ${res.profile.name}`);
    } else {
      setUnauthenticatedState();
    }
  } catch (_e) {
    setUnauthenticatedState();
  }
}

// Initial check on load
checkInitialAuth();

// --- Event Listeners ---

if (msAuthBtn) {
  msAuthBtn.addEventListener("click", () => {
    if (currentAuth) {
      handleLogout();
    } else {
      handleLogin();
    }
  });
}

if (profileAvatar) {
  profileAvatar.addEventListener("click", () => {
    if (!currentAuth) {
      handleLogin();
    } else {
      const settingsNav = document.querySelector('.nav-item[data-tab="settings"]');
      if (settingsNav) settingsNav.click();
    }
  });
}

// --- Status & Logs ---

function pushLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  logsEl.textContent += `[${timestamp}] ${message}\n`;
  logsEl.scrollTop = logsEl.scrollHeight;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.className = `status-text ${isError ? "error" : "ok"}`;
}

const unsubscribe = window.launcherApi.onStatus((message) => {
  pushLog(message);

  if (message.includes("Minecraft closed.")) {
    launchBtn.disabled = false;
    launchBtn.textContent = currentAuth ? "PLAY" : "SIGN IN TO PLAY";
    setStatus("Minecraft closed. Ready to launch again.");
    return;
  }

  if (message.includes("Launch error:")) {
    launchBtn.disabled = false;
    launchBtn.textContent = currentAuth ? "PLAY" : "SIGN IN TO PLAY";
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

// --- Launch Action ---

launchBtn.addEventListener("click", async () => {
  if (!currentAuth) {
    await handleLogin();
    return;
  }

  launchBtn.disabled = true;
  launchBtn.textContent = "STARTING...";
  setStatus("Starting launch sequence...");
  saveSettings();

  const config = {
    username: currentAuth.name,
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
    launchBtn.textContent = currentAuth ? "PLAY" : "SIGN IN TO PLAY";
    return;
  }

  setStatus(result.message);
  pushLog(result.message);
});
