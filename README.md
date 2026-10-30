# Legends Launcher

A one-click Minecraft: Java Edition launcher for Windows. Sign in with Microsoft, press **Play**, and the launcher sets up everything else: the right Java runtime, the Fabric loader, a tuned performance mod pack and the game files. It then drops you straight into your server.

**[Download for Windows](https://github.com/SoumyA4348/legends-launcher/releases/latest/download/Legends-Launcher-Setup.exe)** · one-click installer, updates itself automatically.

## Features

- **One-click setup and launch**: a single Play button runs a staged pipeline (Java → Fabric → Mods → Game files → Launch) with a live progress bar.
- **Automatic Java**: reads the Java version each Minecraft release requires (8, 17, 21, …), reuses a matching local install, or downloads Eclipse Temurin and verifies its SHA-256 checksum before use. No manual Java install needed.
- **Official Microsoft / Xbox Live sign-in**: game ownership is verified (demo accounts are blocked), and the session refreshes silently across restarts.
- **Performance mod profiles** from Modrinth, installed in parallel, with SHA-512 verification of every download:
  - *Competitive*: Fabric API, Sodium, Lithium, FerriteCore, Entity Culling, ImmediatelyFast
  - *Full*: adds Mod Menu, Reese's Sodium Options, Sodium Extra, Fabric Language Kotlin, YACL, Zoomify
- **Instances**: separate setups (version, profile, mods, worlds, options) that share downloaded game files, so a new instance sets up in seconds. Your original setup becomes the *Default* instance.
- **Add any Modrinth mod**: search Fabric mods for the instance's version from the Mods tab; required dependencies are installed automatically.
- **Self-repair**: corrupted library/mod jars are detected and re-downloaded; stale mods are cleaned when the version changes.
- **Fast relaunch**: files that already passed their check are only re-checked when they change, mod updates are looked up once a day, and the game starts offline with your installed mods when Modrinth or Fabric can't be reached.
- **Live server status**: MOTD, server icon, player count and ping, using the same Server List Ping protocol as the in-game server list.
- **Version picker** fed by Mojang's version manifest; **RAM slider** sized to the PC's memory.
- **Console** with filtering, debug-line hiding, copy and auto-scroll.
- **Discord Rich Presence** showing installing / downloading / in-game states.
- **Auto-update** from GitHub Releases.

## Requirements

- Windows 10 or 11 (x64)
- A Microsoft account that owns Minecraft: Java Edition

The installer needs no admin rights and installs for the current user only. Uninstalling asks whether to also delete game data (worlds, mods, Java, sign-in); auto-updates never touch it.

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
| `tests/` | Unit and protocol tests |

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
| `DISCORD_RPC=false` | Disable Discord Rich Presence |
| `DISCORD_CLIENT_ID` | Use your own Discord application (art asset keys: `legends_launcher_logo`, `minecraft_icon`, `play_icon`) |
| `DISCORD_SHOW_SERVER=false` | Always show "Private Server" instead of the server domain. Private/LAN IPs and IPv6 are hidden either way. |
| `DISCORD_BUTTON_1_LABEL` / `_URL`, `DISCORD_BUTTON_2_LABEL` / `_URL` | Up to two presence buttons (http/https only) |

See [OPTIMIZATION_GUIDE.md](./OPTIMIZATION_GUIDE.md) for in-game and Windows performance tuning.

## License

MIT
