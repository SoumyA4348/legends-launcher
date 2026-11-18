const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

// Exclusive fullscreen makes Windows hand the display over to the game; on dual-GPU
// laptops that swap resizes every other window. So a fullscreen game starts windowed and
// the launcher turns its window into a borderless one covering the monitor.

// Left in the game directory while options.txt is flipped, so a launcher that dies
// mid-game still restores the player's fullscreen setting on the next launch.
const MARKER = ".legends-borderless";
const FULLSCREEN_LINE = /^fullscreen:(true|false)[ \t]*$/m;

function readOptions(gameDir) {
  try {
    return fs.readFileSync(path.join(gameDir, "options.txt"), "utf8");
  } catch (_error) {
    return null;
  }
}

function writeFullscreen(gameDir, value) {
  const options = readOptions(gameDir);
  if (options === null || !FULLSCREEN_LINE.test(options)) return;
  fs.writeFileSync(path.join(gameDir, "options.txt"), options.replace(FULLSCREEN_LINE, `fullscreen:${value}`));
}

// Marker content once the game saved fullscreen:true mid-session: the player switched it in
// game (F11 or Video Settings), so whatever the game saves last is their own choice.
const PLAYER_CHOICE = "player";
const watchers = new Map();

// The game believes it is windowed, so turning fullscreen on in game is the only switch the
// player can make; it shows up as a save of fullscreen:true.
function watchPlayerChoice(gameDir) {
  if (watchers.has(gameDir)) return;
  const optionsPath = path.join(gameDir, "options.txt");
  const onChange = () => {
    if (FULLSCREEN_LINE.exec(readOptions(gameDir) || "")?.[1] !== "true") return;
    try {
      fs.writeFileSync(path.join(gameDir, MARKER), PLAYER_CHOICE);
    } catch (_error) {
      // the session may be ending
    }
  };
  fs.watchFile(optionsPath, { interval: 500 }, onChange);
  watchers.set(gameDir, () => fs.unwatchFile(optionsPath, onChange));
}

// Returns true when this launch should go borderless. Flips options.txt to windowed if
// that is where fullscreen came from (F11 or Video Settings).
function beginBorderless(gameDir, launcherFullscreen) {
  const marker = path.join(gameDir, MARKER);
  if (fs.existsSync(marker)) {
    if (fs.readFileSync(marker, "utf8") !== PLAYER_CHOICE) {
      watchPlayerChoice(gameDir);
      return true;
    }
    // The last session ended on the player's own choice but was never closed out.
    fs.rmSync(marker, { force: true });
  }
  const optionsFullscreen = FULLSCREEN_LINE.exec(readOptions(gameDir) || "")?.[1] === "true";
  if (optionsFullscreen) {
    fs.writeFileSync(marker, "");
    writeFullscreen(gameDir, false);
    watchPlayerChoice(gameDir);
    return true;
  }
  return Boolean(launcherFullscreen);
}

// Game closed: put fullscreen back in options.txt so the game's own setting stays on,
// unless the player switched it in game.
function endBorderless(gameDir) {
  watchers.get(gameDir)?.();
  watchers.delete(gameDir);
  const marker = path.join(gameDir, MARKER);
  if (!fs.existsSync(marker)) return;
  try {
    if (fs.readFileSync(marker, "utf8") !== PLAYER_CHOICE) writeFullscreen(gameDir, true);
  } finally {
    fs.rmSync(marker, { force: true });
  }
}

// Waits for the game window (GLFW30 on 1.13+, LWJGL on older), strips its frame and
// stretches it over its monitor. Checks again for a while, since loading can reset it.
const HELPER = String.raw`
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class Borderless {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int Size; public RECT Monitor, Work; public uint Flags; }
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO i);
  const int GWL_STYLE = -16, FRAME = 0x00C00000 | 0x00040000 | 0x00020000 | 0x00010000 | 0x00080000;

  public static IntPtr Find(uint pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint owner; GetWindowThreadProcessId(h, out owner);
      if (owner != pid || !IsWindowVisible(h)) return true;
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      if (cls.ToString() == "GLFW30" || cls.ToString() == "LWJGL") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static void Apply(IntPtr h) {
    SetProcessDPIAware();
    int style = GetWindowLong(h, GWL_STYLE);
    if ((style & FRAME) != 0) SetWindowLong(h, GWL_STYLE, (style & ~FRAME) | unchecked((int)0x80000000));
    var mi = new MONITORINFO(); mi.Size = Marshal.SizeOf(mi);
    GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);
    SetWindowPos(h, IntPtr.Zero, mi.Monitor.L, mi.Monitor.T, mi.Monitor.R - mi.Monitor.L, mi.Monitor.B - mi.Monitor.T, 0x0020 | 0x0040 | 0x0004);
  }
}
'@
$found = $null
for ($i = 0; $i -lt 240; $i++) {
  if (-not (Get-Process -Id $GamePid -ErrorAction SilentlyContinue)) { exit }
  $h = [Borderless]::Find($GamePid)
  if ($h -ne [IntPtr]::Zero) {
    [Borderless]::Apply($h)
    if ($null -eq $found) { $found = $i }
    if ($i - $found -ge 30) { exit }
  }
  Start-Sleep -Milliseconds 500
}
`;

function makeBorderless(pid) {
  if (process.platform !== "win32" || !Number.isInteger(pid)) return;
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `$GamePid = ${pid}\n${HELPER}`],
    { windowsHide: true, stdio: "ignore" }
  );
  child.on("error", () => {});
  child.unref();
}

module.exports = { beginBorderless, endBorderless, makeBorderless, MARKER };
