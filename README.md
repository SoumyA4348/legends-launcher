# Legends Launcher

A one-click Minecraft: Java Edition launcher for Windows. Sign in with Microsoft, press **Play**, and the launcher sets up everything else: the right Java runtime, the Fabric loader, a tuned performance mod pack and the game files. It then drops you straight into your server.

**[Download for Windows](https://github.com/SoumyA4348/legends-launcher/releases/latest/download/Legends-Launcher-Setup.exe)** · [Website](https://soumyapatel.dev/legends) · one-click installer, updates itself automatically.

## Features

- **One-click setup and launch**: a single Play button runs a staged pipeline (Java → Fabric → Mods → Game files → Launch) with a live progress bar.
- **Automatic Java**: reads the Java version each Minecraft release requires (8, 17, 21, …), reuses a matching local install, or downloads Eclipse Temurin and verifies its SHA-256 checksum before use. No manual Java install needed.
- **Official Microsoft / Xbox Live sign-in**: game ownership is verified (demo accounts are blocked), and the session refreshes silently across restarts.
- **Performance mod profiles** from Modrinth, installed in parallel, with SHA-512 verification of every download:
  - *Competitive*: Fabric API, Sodium, Lithium, FerriteCore, Entity Culling, ImmediatelyFast
  - *Full*: adds Mod Menu, Reese's Sodium Options, Sodium Extra, Fabric Language Kotlin, YACL, Zoomify
- **Instances**: separate setups (version, profile, mods, worlds, options) that share downloaded game files, so a new instance sets up in seconds. Your original setup becomes the *Default* instance.
- **Add any Modrinth mod**: search Fabric mods for the instance's version from the Mods tab; required dependencies are installed automatically.
- **Self-repair**: corrupted library/mod jars are detected and re-downloaded; stale mods are cleaned when the version changes. Mods you add to the folder by hand are never removed.
- **Fast relaunch**: files that already passed their check are only re-checked when they change, mod updates are looked up once a day, and the game starts offline with your installed mods when Modrinth or Fabric can't be reached.
- **Stop button and crash reports**: stop the game from the launcher; if Minecraft crashes, the launcher comes back and opens the crash report in one click.
- **Game options**: window size, fullscreen, and keep the launcher open or minimized while playing. Your own video settings (render distance, VSync, FPS cap) are never overwritten; performance defaults only fill in settings you haven't set.
- **Resource packs and shaders** from Modrinth, per instance: packs turn on automatically after install, and adding a shader installs Iris for you. Packs you add by hand are never touched.
- **News** on the Play screen: the latest Java release notes, Java Edition news from Mojang and launcher updates, cached for a few hours so most launches make no extra requests.
- **Skin preview**: your Minecraft skin stands in the Play screen's scene with a name tag. It is drawn from Mojang's skin servers with the same clean-up rules as the game, including slim arms and old 64x32 skins.
- **Living pixel-art scene**: a sunny landscape generated for each instance, like a world seed, with drifting clouds, a sailboat on the bay and a lantern tree. It only animates on the Play page and freezes while you play.
- **Multiple accounts**: save up to 10 Microsoft accounts and switch between them in one click.
- **Playtime** tracked per instance.
- **Sign-in tokens encrypted** with Windows DPAPI, and only one launcher can run at a time.
- **Live server status**: MOTD, server icon, player count and ping, using the same Server List Ping protocol as the in-game server list.
- **Version picker** fed by Mojang's version manifest; **RAM slider** sized to the PC's memory.
- **Console** with filtering, debug-line hiding, copy and auto-scroll.
- **Discord Rich Presence** showing installing / downloading / in-game states.
- **Auto-update** from GitHub Releases.
- **Support menu**: report a bug, copy diagnostic info for a report, email support, and the website and privacy policy.
- **Reviews**: after your second real play session the launcher asks for a quick rating (once per player; "Not now" asks once more later). You can also rate any time from the Support menu.
- **Lightweight**: about 230 MB of RAM in two processes and near-zero CPU when idle. It uses no graphics memory, and drops to low priority while you play so it never competes with the game.

## Requirements

- Windows 10 or 11 (x64)
- A Microsoft account that owns Minecraft: Java Edition

The installer needs no admin rights and installs for the current user only. Uninstalling asks whether to also delete game data (worlds, mods, Java, sign-in); auto-updates never touch it.

## Privacy

The launcher sends anonymous usage stats to [Aptabase](https://aptabase.com) (open source, no cookies, no stored IP addresses) so we can see which Minecraft versions people play and which launches fail. If you leave a review, your rating, optional comment and an anonymous one-way hash of your account id are sent to soumyapatel.dev so each player can review once. Events: launcher opened, launch started/failed, game started/closed/crashed, account added/switched, mod or pack added, instance created, update installed. Each carries only coarse details such as Minecraft version, mod count, an error category or a rounded play time.

It never sends your Minecraft name, UUID, Microsoft tokens, server addresses or file paths. Turn it off any time in **Settings → Privacy**.
## Development

```bash
npm install
npm start        # run the launcher
npm test         # unit tests (node:test, no extra dependencies)
npm run build    # build dist/Legends-Launcher-Setup.exe locally
```

`Open-Legends-Launcher.cmd` installs dependencies on first run and starts the launcher (double-click friendly).

### Project layout

| Path | Responsibility |
| :--- | :--- |
| `main.js` | Electron main process: window, IPC, Microsoft auth, Discord presence, auto-update |
| `src/launcher.js` | Launch pipeline: Fabric profile, mods, game files, JVM flags |
| `src/java.js` | Java version detection and Temurin provisioning |
| `src/server-status.js` | Minecraft Server List Ping client |
| `src/presence.js` | Discord presence helpers (privacy-safe server labels) |
| `src/renderer/` | UI (HTML/CSS/JS, strict Content-Security-Policy) |
| `src/chaos.js` | Chaos Monkey: fault injection for the network layer |
| `tests/` | Unit and protocol tests |

### Chaos testing

Inspired by Netflix's [Chaos Monkey](https://netflixtechblog.com/the-netflix-simian-army-16e57fbab116), which shuts down production servers on purpose so engineers can find weak spots before users do. `src/chaos.js` is a small version of that idea for the launcher. It makes a share of the launcher's own requests fail with connection resets, timeouts or 503s:

```bash
LEGENDS_CHAOS=0.5 LEGENDS_DATA_DIR=./chaos-data npm start   # ~50% of requests fail
```

The runs found six problems, now fixed. Each one has a regression test in `tests/chaos.test.js`:

| What broke | Fix |
| :--- | :--- |
| One failed request (a 503 or a dropped connection) failed the whole launch | Requests are retried with backoff. A 4xx is a real answer and is not retried |
| A download cut off partway through left Play stuck forever | Errors that happen mid-download now fail the download, which is then retried |
| A stalled download hung with no timeout | Downloads time out if no data arrives for 30 seconds |
| An offline Java lookup gave Minecraft 1.8.9–1.16 Java 21, which those versions can't run on | The fallback now uses the Java version each release line shipped with |
| One dropped connection while sending a review lost the review | Reviews are retried. The website keeps one review per player, so a repeat is safe |
| An update download that failed partway left "Downloading update…" on screen for hours, and a failed check waited 4 hours to try again | The banner clears and the check is retried after 5, 15, then 60 minutes |

## Releasing

1. Bump `version` in `package.json`.
2. Commit, then tag and push: `git tag v1.0.0 && git push origin v1.0.0`.
3. GitHub Actions runs the tests, builds the installer and publishes it to a GitHub Release, along with `latest.yml`, which installed launchers use to auto-update.

The download link above always points at the newest release.

## Configuration

Optional environment variables:

| Variable | Effect |
| :--- | :--- |
| `LEGENDS_JAVA_PATH` | Use a specific `java`/`javaw` binary instead of auto-detection |
| `LEGENDS_DATA_DIR` | Keep all game data and settings in this folder instead of `%APPDATA%` (handy for testing a clean first run) |
| `LEGENDS_CHAOS` | Fail this share (0–1) of network requests on purpose, for resilience testing (see [Chaos testing](#chaos-testing)) |
| `DISCORD_RPC=false` | Disable Discord Rich Presence |
| `DISCORD_CLIENT_ID` | Use your own Discord application (art asset keys: `legends_launcher_logo`, `minecraft_icon`, `play_icon`) |
| `DISCORD_SHOW_SERVER=false` | Always show "Private Server" instead of the server domain. Private/LAN IPs and IPv6 are hidden either way. |
| `DISCORD_BUTTON_1_LABEL` / `_URL`, `DISCORD_BUTTON_2_LABEL` / `_URL` | Up to two presence buttons (http/https only) |

See [OPTIMIZATION_GUIDE.md](./OPTIMIZATION_GUIDE.md) for in-game and Windows performance tuning.

## License

MIT

Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.
