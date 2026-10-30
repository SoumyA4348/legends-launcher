const api = window.launcherApi;
const $ = (id) => document.getElementById(id);

// ---------- Elements ----------
const playBtn = $("playBtn");
const playLabel = $("playLabel");
const playSub = $("playSub");
const statusEl = $("status");
const progressEl = $("progress");
const progressFill = $("progressFill");
const progressLabel = $("progressLabel");
const progressValue = $("progressValue");
const scene = window.NightScene;

const versionInput = $("version");
const versionList = $("versionList");
const versionHint = $("versionHint");
const profileInputs = [...document.querySelectorAll('input[name="profile"]')];
const profileHint = $("profileHint");
const serverHostInput = $("serverHost");
const serverPortInput = $("serverPort");
const serverHint = $("serverHint");
const memoryInput = $("maxMemoryMb");
const memoryValue = $("memoryValue");
const memoryHint = $("memoryHint");
const fpsHudInput = $("installFpsHud");
const gameWidthInput = $("gameWidth");
const gameHeightInput = $("gameHeight");
const gameFullscreenInput = $("gameFullscreen");
const behaviorInputs = [...document.querySelectorAll('input[name="launcherBehavior"]')];
const crashBtn = $("crashBtn");
const instanceSelect = $("instanceSelect");
const homeInstanceSelect = $("homeInstanceSelect");
const newInstanceRow = $("newInstanceRow");
const newInstanceName = $("newInstanceName");

const myModsEl = $("myMods");
const modResultsEl = $("modResults");
const modSearchInput = $("modSearch");
const modSearchHint = $("modSearchHint");

const logsEl = $("logs");
const logFilter = $("logFilter");
const hideDebug = $("hideDebug");
const autoScroll = $("autoScroll");

// ---------- State ----------
let currentAuth = null;
let authChecked = false;
let phase = "idle"; // idle | preparing | running | error
let isAuthenticating = false;
let knownVersions = null;
let activeView = "home";
let instances = [];
let selectedInstanceId = "default";
// Playtime is credited to the instance that was launched, even if the player switches away.
let runningInstanceId = null;
let runningSince = 0;

const STAGES = ["java", "loader", "mods", "game", "launching"];
const STAGE_WEIGHTS = { java: 15, loader: 5, mods: 15, game: 60, launching: 5 };
let overallProgress = 0;

// What each Mods-page tab adds. Resource packs work on every version; shaders need Fabric.
const CONTENT_INFO = {
  mod: { plural: "mods", title: "mods", empty: "Nothing added yet. Find a mod on the right and press Add.", search: "Fabric mods" },
  resourcepack: { plural: "resource packs", title: "resource packs", empty: "No resource packs yet. They turn on automatically after install.", search: "Resource packs" },
  shader: { plural: "shaders", title: "shaders", empty: "No shaders yet. Iris is installed for you when you add one.", search: "Shaders" }
};

const PROFILE_INFO = {
  competitive: { label: "Competitive", hint: "Performance mods only: Sodium, Lithium, FerriteCore, Entity Culling, ImmediatelyFast." },
  full: { label: "Full", hint: "Performance mods plus utilities: Mod Menu, Zoomify, Sodium Extra, Reese's Sodium Options." }
};

// ---------- Utilities ----------
let toastTimer = null;
function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("visible"), 3500);
}

function setStatus(message, tone = "") {
  statusEl.textContent = message;
  statusEl.className = `status-line ${tone}`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatMemory(mb) {
  return `${(mb / 1024).toFixed(1)} GB`;
}

function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function avatarUrl(profile, size) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(profile.uuid || profile.name)}/${size}`;
}

// ---------- Navigation ----------
function showView(name, focusId) {
  activeView = name;
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    if (btn.dataset.view === name) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  $("stage").classList.toggle("dimmed", name !== "home");
  updateSceneActivity();
  if (name === "console") renderLogs();
  if (name === "mods") searchModsIfStale();
  if (focusId) $(focusId)?.focus();
}

// The scene only animates on the Play page, and never while Minecraft is running.
function updateSceneActivity() {
  scene.setActive(activeView === "home" && phase !== "running");
}

document.querySelectorAll(".nav-btn").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));

// ---------- Settings ----------
const SETTINGS_KEY = "legends_launcher_settings";
const LAUNCHED_KEY = "legends_launcher_launched_versions";

function getProfile() {
  return profileInputs.find((input) => input.checked)?.value || "competitive";
}

function getLauncherBehavior() {
  return behaviorInputs.find((input) => input.checked)?.value || "keep";
}

function isLegacyVersion(version) {
  const match = /^1\.(\d+)/.exec(version);
  return Boolean(match) && Number(match[1]) <= 13;
}

function normalizeInstance(raw) {
  const extraMods = Array.isArray(raw.extraMods) ? raw.extraMods : [];
  return {
    id: String(raw.id),
    name: String(raw.name || "Instance").slice(0, 32),
    version: String(raw.version || versionInput.defaultValue),
    launchProfile: raw.launchProfile === "full" ? "full" : "competitive",
    installFpsHud: typeof raw.installFpsHud === "boolean" ? raw.installFpsHud : true,
    playtimeMs: Number.isFinite(raw.playtimeMs) && raw.playtimeMs > 0 ? raw.playtimeMs : 0,
    lastPlayed: Number.isFinite(raw.lastPlayed) ? raw.lastPlayed : 0,
    extraMods: extraMods
      .filter((mod) => mod && typeof mod.slug === "string")
      .map((mod) => ({
        slug: mod.slug,
        name: String(mod.name || mod.slug),
        type: CONTENT_INFO[mod.type] ? mod.type : "mod",
        iconUrl: String(mod.iconUrl || "").startsWith("https://cdn.modrinth.com/") ? mod.iconUrl : ""
      }))
  };
}

function currentInstance() {
  return instances.find((instance) => instance.id === selectedInstanceId) || instances[0];
}

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch (_error) {
    // corrupted storage: keep defaults
  }
  if (saved.serverHost !== undefined) serverHostInput.value = saved.serverHost;
  if (saved.serverPort) serverPortInput.value = saved.serverPort;
  if (saved.maxMemoryMb) memoryInput.value = saved.maxMemoryMb;
  if (saved.gameWidth) gameWidthInput.value = saved.gameWidth;
  if (saved.gameHeight) gameHeightInput.value = saved.gameHeight;
  gameFullscreenInput.checked = saved.gameFullscreen === true;
  behaviorInputs.forEach((input) => (input.checked = input.value === (saved.launcherBehavior === "minimize" ? "minimize" : "keep")));

  // Settings saved before instances existed kept version/profile at the top level:
  // they become the "Default" instance.
  const raw = Array.isArray(saved.instances) ? saved.instances.filter((i) => i && typeof i.id === "string") : [];
  if (!raw.some((instance) => instance.id === "default")) {
    raw.unshift({ ...saved, id: "default", name: "Default" });
  }
  instances = raw.map(normalizeInstance);
  selectedInstanceId = instances.some((i) => i.id === saved.selectedInstance) ? saved.selectedInstance : "default";
  applyInstance();
}

// Copies the selected instance into the form.
function applyInstance() {
  const instance = currentInstance();
  versionInput.value = instance.version;
  profileInputs.forEach((input) => (input.checked = input.value === instance.launchProfile));
  fpsHudInput.checked = instance.installFpsHud;
  for (const select of [instanceSelect, homeInstanceSelect]) {
    select.replaceChildren(...instances.map((i) => new Option(i.name, i.id, false, i.id === selectedInstanceId)));
  }
  $("deleteInstanceBtn").disabled = instance.id === "default";
  scene.setSeed(instance.id);
  renderMyMods();
  renderModResults();
}

const flashSaved = debounce(() => {
  const flag = $("savedFlag");
  flag.classList.add("visible");
  setTimeout(() => flag.classList.remove("visible"), 1200);
}, 250);

function saveSettings() {
  const instance = currentInstance();
  instance.version = versionInput.value.trim();
  instance.launchProfile = getProfile();
  instance.installFpsHud = fpsHudInput.checked;
  const settings = {
    serverHost: serverHostInput.value.trim(),
    serverPort: serverPortInput.value,
    maxMemoryMb: memoryInput.value,
    gameWidth: gameWidthInput.value,
    gameHeight: gameHeightInput.value,
    gameFullscreen: gameFullscreenInput.checked,
    launcherBehavior: getLauncherBehavior(),
    selectedInstance: selectedInstanceId,
    instances
  };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (_error) {
    // storage unavailable: settings still apply for this session
  }
  flashSaved();
}

function getLaunchedVersions() {
  try {
    return new Set(JSON.parse(localStorage.getItem(LAUNCHED_KEY) || "[]"));
  } catch (_error) {
    return new Set();
  }
}

function markVersionLaunched(version) {
  const versions = getLaunchedVersions();
  versions.add(version);
  try {
    localStorage.setItem(LAUNCHED_KEY, JSON.stringify([...versions]));
  } catch (_error) {
    // ignore
  }
}

// Returns an error message per invalid field, or null when everything is valid.
function validateSettings() {
  const errors = {};
  const version = versionInput.value.trim();
  if (!version) errors.version = "Enter a Minecraft version.";
  else if (knownVersions && !knownVersions.has(version)) errors.version = `"${version}" is not a Minecraft release.`;

  const port = Number(serverPortInput.value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.serverPort = "Port must be 1–65535.";

  const host = serverHostInput.value.trim();
  if (/\s/.test(host)) errors.serverHost = "Server address can't contain spaces.";

  const width = gameWidthInput.value.trim();
  const height = gameHeightInput.value.trim();
  if (width || height) {
    const w = Number(width);
    const h = Number(height);
    if (!Number.isInteger(w) || w < 640 || w > 7680 || !Number.isInteger(h) || h < 480 || h > 4320) {
      errors.gameWindow = "Enter both: width 640–7680 and height 480–4320.";
    }
  }
  return Object.keys(errors).length ? errors : null;
}

function renderValidation() {
  const errors = validateSettings() || {};
  versionInput.classList.toggle("invalid", Boolean(errors.version));
  serverPortInput.classList.toggle("invalid", Boolean(errors.serverPort));
  serverHostInput.classList.toggle("invalid", Boolean(errors.serverHost));

  versionHint.textContent = errors.version || versionHintText();
  versionHint.classList.toggle("error", Boolean(errors.version));
  const serverError = errors.serverHost || errors.serverPort;
  serverHint.textContent = serverError || (serverHostInput.value.trim()
    ? "The game joins this server automatically after loading."
    : "No server set: the game opens to the main menu.");
  serverHint.classList.toggle("error", Boolean(serverError));
  gameWidthInput.classList.toggle("invalid", Boolean(errors.gameWindow));
  gameHeightInput.classList.toggle("invalid", Boolean(errors.gameWindow));
  $("gameWindowHint").textContent = errors.gameWindow || "Leave empty for Minecraft's default size.";
  $("gameWindowHint").classList.toggle("error", Boolean(errors.gameWindow));
  return errors;
}

function versionHintText() {
  const latest = versionList.dataset.latest;
  return latest ? `Latest release: ${latest}. Fabric mods apply to 1.14 and newer.` : "Fabric mods apply to 1.14 and newer.";
}

// One plain sentence says what Play will do.
function describeLaunch() {
  const instance = currentInstance();
  const version = versionInput.value.trim() || "?";
  const host = serverHostInput.value.trim();
  const ownMods = instance.extraMods.filter((mod) => mod.type === "mod").length;
  const ownPacks = instance.extraMods.length - ownMods;
  const mods = isLegacyVersion(version)
    ? "without mods"
    : `with ${PROFILE_INFO[getProfile()].label} mods${ownMods ? ` and ${ownMods} of your own` : ""}`;
  const packsNote = ownPacks ? `, ${ownPacks} pack${ownPacks === 1 ? "" : "s"}` : "";
  const sentence = `Minecraft ${version} ${mods}${packsNote}, ${host ? `joining ${host}` : "opening to the main menu"}.`;
  return instance.playtimeMs >= 60000
    ? `${sentence} Played ${formatPlaytime(instance.playtimeMs)}, last on ${new Date(instance.lastPlayed).toLocaleDateString()}.`
    : sentence;
}

function formatPlaytime(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function creditPlaytime() {
  if (!runningInstanceId) return;
  const instance = instances.find((i) => i.id === runningInstanceId);
  if (instance) {
    instance.playtimeMs += Date.now() - runningSince;
    instance.lastPlayed = Date.now();
    saveSettings();
    renderSummary();
  }
  runningInstanceId = null;
}

function renderSummary() {
  $("heroTitle").textContent = currentInstance().name;
  $("heroSub").textContent = describeLaunch();
  profileHint.textContent = PROFILE_INFO[getProfile()].hint;
  memoryValue.textContent = formatMemory(Number(memoryInput.value));
}

function onSettingsChanged() {
  saveSettings();
  renderValidation();
  renderSummary();
  renderPlayButton();
  renderMyMods();
  renderModResults();
}

// ---------- Instances ----------
for (const select of [instanceSelect, homeInstanceSelect]) {
  select.addEventListener("change", () => {
    saveSettings();
    selectedInstanceId = select.value;
    applyInstance();
    onSettingsChanged();
  });
}

function toggleNewInstanceRow(show) {
  newInstanceRow.hidden = !show;
  newInstanceName.value = "";
  newInstanceName.classList.remove("invalid");
  if (show) newInstanceName.focus();
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "instance";
}

function createInstance() {
  const name = newInstanceName.value.trim();
  if (!name) {
    newInstanceName.classList.add("invalid");
    return;
  }
  saveSettings();
  const base = currentInstance();
  // Random suffix keeps folder names unique even when two instances share a name.
  const id = `${slugify(name)}-${Math.random().toString(36).slice(2, 7)}`;
  instances.push(normalizeInstance({ id, name, version: base.version, launchProfile: base.launchProfile, installFpsHud: base.installFpsHud }));
  selectedInstanceId = id;
  toggleNewInstanceRow(false);
  applyInstance();
  onSettingsChanged();
  toast(`Created instance "${name}".`);
}

$("newInstanceBtn").addEventListener("click", () => toggleNewInstanceRow(true));
$("cancelInstanceBtn").addEventListener("click", () => toggleNewInstanceRow(false));
$("createInstanceBtn").addEventListener("click", createInstance);
newInstanceName.addEventListener("keydown", (event) => {
  if (event.key === "Enter") createInstance();
  if (event.key === "Escape") toggleNewInstanceRow(false);
});

$("deleteInstanceBtn").addEventListener("click", async () => {
  const instance = currentInstance();
  if (instance.id === "default") return;
  const result = await api.deleteInstance(instance.id, instance.name).catch(() => null);
  if (result?.ok) {
    instances = instances.filter((i) => i.id !== instance.id);
    selectedInstanceId = "default";
    applyInstance();
    onSettingsChanged();
    toast(`Deleted "${instance.name}".`);
  } else if (!result?.cancelled) {
    toast(result?.message || "Could not delete the instance.", true);
  }
});

// ---------- Mods ----------
const MAX_EXTRA_MODS = 100;
const contentTypeInputs = [...document.querySelectorAll('input[name="contentType"]')];
let contentType = "mod";
let modHits = [];
let modSearchId = 0;
let profileSlugs = { competitive: [], full: [], fpsHud: [] };
let lastModSearchKey = null;

function makeButton(label, onClick, extraClass = "") {
  const button = document.createElement("button");
  button.className = `btn ${extraClass}`.trim();
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

// Builds a mod list row with textContent only: Modrinth data is untrusted.
function modRow({ name, description, iconUrl, meta }, button) {
  const row = document.createElement("li");
  row.className = "mod-row";
  const icon = document.createElement("img");
  icon.className = "mod-icon";
  icon.alt = "";
  if (iconUrl) icon.src = iconUrl;
  const info = document.createElement("div");
  info.className = "mod-info";
  const title = document.createElement("div");
  title.className = "mod-name";
  title.textContent = name;
  info.append(title);
  for (const [text, className] of [[description, "mod-desc"], [meta, "mod-meta"]]) {
    if (!text) continue;
    const line = document.createElement("div");
    line.className = className;
    line.textContent = text;
    info.append(line);
  }
  row.append(icon, info, button);
  return row;
}

function formatCount(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  return String(n);
}

function onModsChanged() {
  saveSettings();
  renderSummary();
  renderMyMods();
  renderModResults();
}

function renderMyMods() {
  const instance = currentInstance();
  const info = CONTENT_INFO[contentType];
  $("myModsTitle").textContent = `Your ${info.title}`;
  $("findModsTitle").textContent = `Find ${info.title}`;
  $("myModsEmpty").textContent = info.empty;
  const rows = instance.extraMods.filter((mod) => mod.type === contentType).map((mod) =>
    modRow({ name: mod.name, iconUrl: mod.iconUrl, meta: mod.slug }, makeButton("Remove", () => {
      instance.extraMods = instance.extraMods.filter((m) => m.slug !== mod.slug);
      onModsChanged();
    }))
  );
  myModsEl.replaceChildren(...rows);
  $("myModsEmpty").hidden = rows.length > 0;
  $("modsSub").textContent = `Extra Modrinth mods for the "${instance.name}" instance. They install on top of the ${PROFILE_INFO[instance.launchProfile].label} profile on your next launch.`;
  const notice = $("modsNotice");
  notice.hidden = contentType === "resourcepack" || !isLegacyVersion(instance.version);
  notice.textContent = contentType === "shader"
    ? `Shaders need Fabric. Switch this instance to 1.16.5 or newer to use them.`
    : `Minecraft ${instance.version} has no Fabric mods. Switch this instance to 1.14 or newer to use them.`;
}

function renderModResults() {
  const instance = currentInstance();
  const added = new Set(instance.extraMods.map((mod) => mod.slug));
  const included = new Set(contentType === "mod" ? [
    ...profileSlugs[instance.launchProfile],
    ...(instance.installFpsHud ? profileSlugs.fpsHud : [])
  ] : []);
  modResultsEl.replaceChildren(
    ...modHits.map((hit) => {
      const isIncluded = included.has(hit.slug);
      const isAdded = isIncluded || added.has(hit.slug);
      const button = makeButton(isIncluded ? "In profile" : isAdded ? "Added" : "Add", () => {
        if (instance.extraMods.length >= MAX_EXTRA_MODS) {
          toast(`An instance can hold up to ${MAX_EXTRA_MODS} extra mods.`, true);
          return;
        }
        instance.extraMods.push({ slug: hit.slug, name: hit.name, iconUrl: hit.iconUrl, type: contentType });
        onModsChanged();
        toast(`${hit.name} will install on your next launch.`);
      });
      button.disabled = isAdded;
      return modRow({ name: hit.name, description: hit.description, iconUrl: hit.iconUrl, meta: `${formatCount(hit.downloads)} downloads` }, button);
    })
  );
}

async function searchMods() {
  const query = modSearchInput.value.trim();
  const version = versionInput.value.trim();
  const requestId = ++modSearchId;
  const label = CONTENT_INFO[contentType].search;
  lastModSearchKey = `${query}|${version}|${contentType}`;
  modSearchHint.textContent = "Searching…";
  const result = await api.searchMods(query, version, contentType).catch(() => null);
  if (requestId !== modSearchId) return; // a newer search superseded this one
  modHits = result?.ok ? result.hits : [];
  if (!result?.ok) modSearchHint.textContent = result?.message || "Search failed.";
  else if (!modHits.length) modSearchHint.textContent = `No ${label.toLowerCase()} for ${version} match "${query}".`;
  else modSearchHint.textContent = query ? `${label} for Minecraft ${version}` : `Popular ${label.toLowerCase()} for Minecraft ${version}`;
  renderModResults();
}

function searchModsIfStale() {
  if (lastModSearchKey !== `${modSearchInput.value.trim()}|${versionInput.value.trim()}|${contentType}`) searchMods();
}

contentTypeInputs.forEach((input) =>
  input.addEventListener("change", () => {
    contentType = input.value;
    modSearchInput.placeholder = `Search Modrinth ${CONTENT_INFO[contentType].plural}`;
    modHits = [];
    renderMyMods();
    renderModResults();
    searchModsIfStale();
  })
);

modSearchInput.addEventListener("input", debounce(searchMods, 400));

[versionInput, serverHostInput, serverPortInput, memoryInput, gameWidthInput, gameHeightInput].forEach((el) => el.addEventListener("input", onSettingsChanged));
[fpsHudInput, gameFullscreenInput, ...profileInputs, ...behaviorInputs].forEach((el) => el.addEventListener("change", onSettingsChanged));
const refreshServerSoon = debounce(() => refreshServerStatus(), 600);
serverHostInput.addEventListener("input", refreshServerSoon);
serverPortInput.addEventListener("input", refreshServerSoon);

const VERSIONS_KEY = "legends_launcher_versions";

// Shows the last known version list immediately (and offline), then refreshes it.
async function loadVersions() {
  try {
    const cached = JSON.parse(localStorage.getItem(VERSIONS_KEY) || "null");
    if (cached?.ok) applyVersions(cached);
  } catch (_error) {
    // no cache yet
  }
  const result = await api.getVersions().catch(() => null);
  if (!result?.ok) return;
  try {
    localStorage.setItem(VERSIONS_KEY, JSON.stringify(result));
  } catch (_error) {
    // storage unavailable
  }
  applyVersions(result);
}

function applyVersions(result) {
  knownVersions = new Set(result.releases);
  versionList.dataset.latest = result.latest || "";
  const fragment = document.createDocumentFragment();
  for (const id of result.releases) {
    const option = document.createElement("option");
    option.value = id;
    fragment.appendChild(option);
  }
  versionList.replaceChildren(fragment);
  renderValidation();
}

async function loadSystemInfo() {
  const info = await api.getSystemInfo().catch(() => null);
  if (!info) return;
  $("appVersion").textContent = `v${info.appVersion}`;
  profileSlugs = info.profileSlugs || profileSlugs;
  renderModResults();

  // Leave at least 2 GB for Windows; cap at 16 GB (more only adds GC pauses).
  const total = info.totalMemoryMb;
  const max = Math.max(2048, Math.min(16384, Math.floor((total - 2048) / 512) * 512));
  const recommended = total >= 16000 ? 6144 : total >= 8000 ? 4096 : 3072;
  memoryInput.max = String(max);
  if (Number(memoryInput.value) > max) memoryInput.value = String(max);
  memoryHint.textContent = `This PC has ${formatMemory(total)}. Recommended: ${formatMemory(Math.min(recommended, max))}.`;
  renderSummary();
}

// ---------- Account ----------
function renderAccount() {
  const signedIn = Boolean(currentAuth);
  const sidebarAvatar = $("accountAvatar");
  const settingsAvatar = $("settingsAvatar");
  $("accountDot").classList.toggle("on", signedIn);
  // SVG elements have no .hidden property; toggle the attribute instead.
  $("accountIcon").toggleAttribute("hidden", signedIn);
  sidebarAvatar.hidden = !signedIn;
  settingsAvatar.hidden = !signedIn;
  $("settingsAvatarFallback").hidden = signedIn;

  if (signedIn) {
    sidebarAvatar.src = avatarUrl(currentAuth, 64);
    settingsAvatar.src = avatarUrl(currentAuth, 88);
    $("accountName").textContent = currentAuth.name;
    $("accountMeta").textContent = "Microsoft account · Minecraft: Java Edition";
    $("authBtnText").textContent = "Sign out";
    $("accountBtn").setAttribute("aria-label", `Signed in as ${currentAuth.name}`);
    $("accountLabel").textContent = currentAuth.name;
  } else {
    $("accountName").textContent = "Not signed in";
    $("accountMeta").textContent = "A Microsoft account that owns Minecraft is required.";
    $("authBtnText").textContent = "Sign in";
    $("accountBtn").setAttribute("aria-label", "Sign in with Microsoft");
    $("accountLabel").textContent = "Sign in";
  }
  $("addAccountBtn").hidden = !signedIn;
  renderAccountList();
}

// Other saved accounts, one click to switch. Names come from Mojang: textContent only.
async function renderAccountList() {
  const list = await api.listAccounts().catch(() => []);
  const rows = list.filter((account) => !account.active).map((account) => {
    const row = document.createElement("li");
    row.className = "account-list-row";
    const avatar = document.createElement("img");
    avatar.alt = "";
    avatar.src = avatarUrl(account, 32);
    const name = document.createElement("span");
    name.className = "account-list-name";
    name.textContent = account.name;
    row.append(
      avatar,
      name,
      makeButton("Switch", () => switchAccount(account.uuid), "compact"),
      makeButton("Remove", () => removeAccount(account), "compact")
    );
    return row;
  });
  $("accountList").replaceChildren(...rows);
}

function applyAccountResult(result, successMessage) {
  if (!result?.ok) {
    toast(result?.message || "Something went wrong with that account.", true);
    return;
  }
  currentAuth = result.profile || null;
  if (successMessage) toast(successMessage);
  setStatus(currentAuth ? `Playing as ${currentAuth.name}.` : "Signed out. Sign in with Microsoft to play.", currentAuth ? "ok" : "");
  renderAccount();
  renderPlayButton();
}

async function switchAccount(uuid) {
  const result = await api.switchAccount(uuid).catch(() => null);
  applyAccountResult(result, result?.profile ? `Switched to ${result.profile.name}.` : "");
}

async function removeAccount(account) {
  const result = await api.removeAccount(account.uuid).catch(() => null);
  applyAccountResult(result, `Removed ${account.name}.`);
}

async function handleLogin() {
  if (isAuthenticating) return;
  isAuthenticating = true;
  renderPlayButton();
  setStatus("Complete sign-in in the Microsoft window…");
  pushLog("Opening Microsoft sign-in window...");
  try {
    const result = await api.login();
    if (result?.ok && result.profile) {
      currentAuth = result.profile;
      pushLog(`Signed in as ${result.profile.name}`);
      setStatus(`Signed in as ${result.profile.name}. You're ready to play.`, "ok");
    } else {
      const message = result?.message || "Sign-in was cancelled.";
      setStatus(message, "error");
      pushLog(`Auth: ${message}`);
    }
  } catch (error) {
    setStatus(error?.message || "Sign-in failed.", "error");
  } finally {
    isAuthenticating = false;
    renderAccount();
    renderPlayButton();
  }
}

async function handleLogout() {
  const signedOutName = currentAuth?.name;
  const result = await api.logout().catch(() => null);
  pushLog(`Signed out ${signedOutName || ""}.`.replace(" .", "."));
  applyAccountResult(result || { ok: true, profile: null }, "");
}

// The saved session is shown at once; if its background refresh fails, sign the player out.
api.onSignedOut(({ message }) => {
  currentAuth = null;
  setStatus(message || "Session expired. Sign in again to play.", "error");
  renderAccount();
  renderPlayButton();
});

$("authBtn").addEventListener("click", () => (currentAuth ? handleLogout() : handleLogin()));
$("addAccountBtn").addEventListener("click", handleLogin);
$("accountBtn").addEventListener("click", () => (currentAuth ? showView("settings") : handleLogin()));

async function checkInitialAuth() {
  try {
    const res = await api.getAuth();
    if (res?.authenticated && res.profile) {
      currentAuth = res.profile;
      pushLog(`Active Microsoft session: ${res.profile.name}`);
    }
  } catch (_error) {
    // treat as signed out
  }
  authChecked = true;
  renderAccount();
  renderPlayButton();
  setStatus(currentAuth ? "Ready to play." : "Sign in with your Microsoft account to play.", currentAuth ? "ok" : "");
}

// ---------- Play button: single source of truth ----------
function renderPlayButton() {
  playBtn.classList.remove("secondary", "running", "busy");
  const version = versionInput.value.trim();
  playSub.textContent = "";

  if (!authChecked) {
    playBtn.disabled = true;
    playLabel.textContent = "Loading";
    return;
  }
  if (isAuthenticating) {
    playBtn.disabled = true;
    playLabel.textContent = "Signing in";
    return;
  }
  if (!currentAuth) {
    playBtn.disabled = false;
    playBtn.classList.add("secondary");
    playLabel.innerHTML =
      '<svg class="ms-logo" viewBox="0 0 23 23" aria-hidden="true"><path fill="#f25022" d="M0 0h11v11H0z"/><path fill="#7fba00" d="M12 0h11v11H12z"/><path fill="#00a4ef" d="M0 12h11v11H0z"/><path fill="#ffb900" d="M12 12h11v11H12z"/></svg>Sign in';
    playSub.textContent = "Microsoft account required";
    return;
  }
  if (phase === "preparing") {
    playBtn.disabled = true;
    playBtn.classList.add("busy");
    playLabel.textContent = `${Math.round(overallProgress)}%`;
    playSub.textContent = "Setting up…";
    return;
  }
  if (phase === "running") {
    playBtn.disabled = false;
    playBtn.classList.add("running");
    playLabel.textContent = "Stop";
    playSub.textContent = `Minecraft ${version} is running`;
    return;
  }

  const errors = validateSettings();
  playBtn.disabled = Boolean(errors);
  playLabel.textContent = phase === "error" ? "Retry" : "Play";
  playSub.textContent = errors
    ? "Fix settings to play"
    : getLaunchedVersions().has(version)
      ? `Minecraft ${version}`
      : `First launch sets up ${version}`;
}

// ---------- Progress ----------
function resetProgress() {
  overallProgress = 0;
  progressFill.style.width = "0%";
  progressFill.classList.remove("indeterminate");
  progressLabel.textContent = "Preparing…";
  progressValue.textContent = "";
  playBtn.style.setProperty("--pct", "0%");
}

function renderProgress({ stage, label, current, total, unit }) {
  const index = STAGES.indexOf(stage);
  if (index === -1) return;
  const fraction = total > 0 ? Math.min(current / total, 1) : 0;
  const before = STAGES.slice(0, index).reduce((sum, s) => sum + STAGE_WEIGHTS[s], 0);
  // Never move backwards: game files arrive in several groups that each restart at 0.
  overallProgress = Math.max(overallProgress, before + STAGE_WEIGHTS[stage] * fraction);

  if (total > 0) {
    progressValue.textContent = unit === "bytes"
      ? `${formatBytes(current)} / ${formatBytes(total)}`
      : `${current.toLocaleString()} / ${total.toLocaleString()}`;
  } else {
    progressValue.textContent = "";
  }
  progressFill.classList.toggle("indeterminate", total === 0 && stage !== "launching");
  progressFill.style.width = `${overallProgress}%`;
  playBtn.style.setProperty("--pct", `${overallProgress}%`);
  progressLabel.textContent = `Step ${index + 1} of ${STAGES.length}: ${label}`;
  renderPlayButton();
}

function setPhase(next, message, crashReport = false) {
  if (phase === "running" && next !== "running") creditPlaytime();
  if (next === "running" && phase !== "running") {
    runningInstanceId = selectedInstanceId;
    runningSince = Date.now();
  }
  phase = next;
  crashBtn.hidden = !(next === "error" && crashReport);
  const showProgress = next === "preparing";
  progressEl.classList.toggle("visible", showProgress);
  progressEl.setAttribute("aria-hidden", String(!showProgress));
  if (next === "preparing") resetProgress();
  if (next === "running") {
    markVersionLaunched(versionInput.value.trim());
    setStatus(message || "Minecraft is running. Have fun!", "ok");
  } else if (next === "error") {
    setStatus(message || "Launch failed. Open the console for details.", "error");
    toast(message || "Launch failed.", true);
  } else if (next === "idle" && message) {
    setStatus(message);
  }
  renderPlayButton();
  updateSceneActivity();
}

api.onProgress(renderProgress);
api.onPhase(({ phase: next, message, crashReport }) => {
  // "preparing" is set locally the moment Play is clicked.
  if (next !== "preparing") setPhase(next, message, crashReport);
});

crashBtn.addEventListener("click", async () => {
  const result = await api.openCrashReport().catch(() => null);
  if (!result?.ok) toast(result?.message || "Could not open the crash report.", true);
});

async function stopGame() {
  playBtn.disabled = true;
  setStatus("Stopping Minecraft…");
  const result = await api.stop().catch(() => null);
  if (!result?.ok) {
    toast(result?.message || "Could not stop Minecraft.", true);
    renderPlayButton();
  }
}

async function launch() {
  if (phase === "running") {
    await stopGame();
    return;
  }
  if (!currentAuth) {
    await handleLogin();
    return;
  }
  const errors = renderValidation();
  if (Object.keys(errors).length) {
    showView("settings");
    toast("Fix the highlighted settings first.", true);
    return;
  }

  saveSettings();
  setPhase("preparing");
  setStatus("Preparing your game…");

  const profile = getProfile();
  const config = {
    version: versionInput.value.trim(),
    launchProfile: profile,
    installParkourPack: profile === "full",
    installFpsHud: fpsHudInput.checked,
    serverHost: serverHostInput.value.trim(),
    serverPort: serverPortInput.value,
    maxMemoryMb: memoryInput.value,
    instanceId: selectedInstanceId,
    gameWindow: {
      width: gameWidthInput.value,
      height: gameHeightInput.value,
      fullscreen: gameFullscreenInput.checked
    },
    launcherBehavior: getLauncherBehavior(),
    extraMods: currentInstance().extraMods.map(({ slug, name, type }) => ({ slug, name, type }))
  };

  let result;
  try {
    result = await api.start(config);
  } catch (error) {
    result = { ok: false, message: error?.message || "Launch failed unexpectedly." };
  }
  if (!result.ok) {
    pushLog(`ERROR: ${result.message}`);
    setPhase("error", result.message);
  }
}

playBtn.addEventListener("click", launch);

// ---------- Server status ----------
let serverRequestId = 0;

async function refreshServerStatus() {
  const host = serverHostInput.value.trim();
  const port = serverPortInput.value;
  const requestId = ++serverRequestId;
  const refreshBtn = $("serverRefresh");
  $("serverHostLabel").textContent = host || "No server set";

  // No server: the readout has nothing to show, and the hero sentence already says "main menu".
  $("serverCard").hidden = !host;
  if (!host) return;

  refreshBtn.classList.add("spinning");
  $("serverStateText").textContent = "Checking";
  const status = await api.getServerStatus(host, port).catch(() => ({ online: false, error: "Unavailable" }));
  if (requestId !== serverRequestId) return; // a newer request superseded this one
  refreshBtn.classList.remove("spinning");

  $("serverDot").className = `dot ${status.online ? "online" : "offline"}`;
  $("serverStats").hidden = !status.online;
  if (status.online) {
    $("serverStateText").textContent = "Online";
    $("serverPlayers").textContent =
      status.playersOnline != null ? `${status.playersOnline.toLocaleString()} / ${status.playersMax.toLocaleString()}` : "—";
    $("serverPing").textContent = `${status.latencyMs} ms`;
    if (status.favicon) $("serverIcon").src = status.favicon;
    else $("serverIcon").removeAttribute("src");
  } else {
    $("serverStateText").textContent = status.error ? `Offline: ${status.error}` : "Offline";
    $("serverIcon").removeAttribute("src");
  }
}

$("serverRefresh").addEventListener("click", refreshServerStatus);
setInterval(() => {
  if (activeView === "home" && document.visibilityState === "visible" && phase !== "running") {
    refreshServerStatus();
  }
}, 60000);

// ---------- Quick actions ----------
$("openFolderBtn").addEventListener("click", async () => {
  const result = await api.openGameFolder(selectedInstanceId);
  if (!result?.ok) toast(result?.message || "Could not open the game folder.", true);
});

// ---------- Console ----------
// MCLC emits thousands of lines per launch: keep a bounded buffer and only render while
// the console is visible, at most once per frame.
const MAX_LOG_LINES = 2000;
const logLines = [];
let renderPending = false;

function pushLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  logLines.push({ text: `[${timestamp}] ${message}`, debug: message.startsWith("DEBUG:") });
  if (logLines.length > MAX_LOG_LINES) logLines.splice(0, logLines.length - MAX_LOG_LINES);
  scheduleLogRender();
}

function scheduleLogRender() {
  if (renderPending || activeView !== "console") return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderLogs();
  });
}

function visibleLogLines() {
  const query = logFilter.value.trim().toLowerCase();
  return logLines.filter(
    (line) => !(hideDebug.checked && line.debug) && (!query || line.text.toLowerCase().includes(query))
  );
}

function renderLogs() {
  logsEl.textContent = visibleLogLines().map((line) => line.text).join("\n");
  if (autoScroll.checked) logsEl.scrollTop = logsEl.scrollHeight;
}

api.onLog((lines) => lines.forEach(pushLog));
logFilter.addEventListener("input", debounce(renderLogs, 120));
hideDebug.addEventListener("change", renderLogs);
$("clearLogs").addEventListener("click", () => {
  logLines.length = 0;
  renderLogs();
});
$("copyLogs").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(visibleLogLines().map((line) => line.text).join("\n"));
    toast("Console copied to clipboard.");
  } catch (_error) {
    toast("Could not copy the console.", true);
  }
});

// ---------- Updates ----------
api.onUpdate(({ state, version, percent }) => {
  const banner = $("updateBanner");
  banner.classList.add("visible");
  if (state === "ready") {
    $("updateText").textContent = `Legends Launcher ${version} is ready to install.`;
    $("updateBtn").hidden = false;
  } else {
    $("updateText").textContent = `Downloading update ${version}${percent ? ` (${percent}%)` : ""}…`;
  }
});
$("updateBtn").addEventListener("click", async () => {
  const result = await api.installUpdate().catch(() => null);
  if (result && !result.ok) toast(result.message, true);
});

// ---------- Boot ----------
scene.mount($("scene"));
loadSettings();
renderSummary();
renderValidation();
renderPlayButton();
checkInitialAuth();
loadSystemInfo();
loadVersions();
refreshServerStatus();
