# Private Custom Minecraft Launcher

A starter private Minecraft launcher built with Electron + `minecraft-launcher-core`.

## Features

- Branded desktop launcher window (custom title bar, dark UI)
- Launches Minecraft with chosen version and username
- Default private server host/port passed at launch
- Live log streaming to the launcher UI
- **Settings persistence** — username, version, server, memory and profile are saved automatically and restored on next launch
- One-click parkour speedrunner mod pack installer (Fabric + Modrinth)
- Competitive mod profile (Sodium, Lithium, FerriteCore, EntityCulling)
- Discord Rich Presence with dynamic states (idle, downloading, installing, in-game)
- Performance video settings auto-applied (VSync off, 240 FPS cap, G1GC tuned)

## Important notes

- This starter currently uses **offline mode authentication** (username-only local profile).
- For public distribution or premium account enforcement, add Microsoft/Xbox Live auth before shipping.
- Users still need a Java runtime installed for Minecraft.

## Prerequisites

- Node.js 20+ (includes npm)
- Java 17+ (recommended for modern Minecraft versions)

## Setup

1. Open this project folder in a terminal.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Run launcher:

   ```bash
   npm start
   ```

## One-click launcher (double-click)

Use `Open-Legends-Launcher.cmd` in the project root.

- Double-click it to start the launcher.
- On first run, it auto-installs dependencies (`npm install`).
- After that, it directly opens the launcher app.

If you want it on Desktop:
- Right-click `Open-Legends-Launcher.cmd` -> **Send to** -> **Desktop (create shortcut)**.

### PowerShell note on Windows

If `npm` is blocked by execution policy, use:

```bash
npm.cmd install
npm.cmd start
```

## Parkour speedrunner mod pack

Enable **Install parkour speedrunner mod pack** in the launcher UI, then launch.

The launcher will automatically:
- Install Fabric loader for your selected Minecraft version
- Download compatible Fabric mods from Modrinth
- Launch with that Fabric profile enabled

Current pack contents:
- Fabric API
- Sodium
- Lithium
- FerriteCore
- Mod Menu
- Reese's Sodium Options
- Entity Culling
- ImmediatelyFast
- Zoomify

## Discord Rich Presence (activity image)

This launcher includes Discord Rich Presence support.

1. Create an app in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy your **Application ID**.
3. In **Rich Presence -> Art Assets**, upload image assets with these keys:
   - `legends_launcher_logo` (large image)
   - `minecraft_icon` (small idle image)
   - `play_icon` (small in-game image)
4. Start launcher with your app id as environment variable:

```bash
$env:DISCORD_CLIENT_ID="YOUR_APP_ID"
npm.cmd start
```

If Discord desktop app is open, your profile activity will show your custom launcher image.

## Performance Tuning

Getting choppy FPS even with high framerates? See [OPTIMIZATION_GUIDE.md](./OPTIMIZATION_GUIDE.md) for:

- **Aikar's GC flags** — eliminates GC pause stutter (biggest win)
- **Memory allocation & Java version** — use Java 21 with correct RAM settings
- **In-game settings** — render distance, VSync, frame cap tuning
- **Windows optimization** — process priority, Xbox Game Bar disable
- **Mod recommendations** — Sodium, Lithium, EntityCulling for best performance
- **Troubleshooting** — how to diagnose different types of stutter

**TL;DR:** Use Aikar's flags + Sodium + Java 21 with 8-10GB allocated RAM.

### Presence upgrades included

- Dynamic states: idle, downloading files, installing mod pack, launching, and in-game.
- Auto state text with selected version and username.
- Server/IP is hidden by default (`Private Server`) for privacy.
- Optional Discord activity buttons (up to 2):

```bash
$env:DISCORD_BUTTON_1_LABEL="Join Discord"
$env:DISCORD_BUTTON_1_URL="https://discord.gg/yourinvite"
$env:DISCORD_BUTTON_2_LABEL="Download Launcher"
$env:DISCORD_BUTTON_2_URL="https://your-site.example/download"
```

If you want to show host:port anyway:

```bash
$env:DISCORD_SHOW_SERVER="true"
```

## Customize branding

- App window title and dimensions: `main.js`
- Launcher name and UI look: `src/renderer/index.html`
- Default server settings in the form: `src/renderer/index.html`
- Launch rules and memory/args: `src/launcher.js`

## Planned upgrades

- Microsoft / Xbox Live account login flow
- Auto-update from a self-hosted endpoint
- News panel + server status display
- One-click Windows installer build (`.exe`)
