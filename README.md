<div align="center">
  <h1>Legends Launcher</h1>
  <p><b>A high-performance Minecraft launcher optimized for competitive play and speedrunning.</b></p>

  [![Build Status](https://img.shields.io/github/actions/workflow/status/SoumyA4348/legends-launcher/build.yml?branch=main&style=for-the-badge)](https://github.com/SoumyA4348/legends-launcher/actions)
  [![Electron](https://img.shields.io/badge/Electron-191970?style=for-the-badge&logo=Electron&logoColor=white)](https://electronjs.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
  [![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
</div>

<hr>

## 🚀 Why Legends Launcher?
Designed from the ground up for speedrunners, competitive players, and server communities, Legends Launcher provides a zero-setup path to optimized Minecraft performance. It handles JVM tuning, Modrinth integration, and Microsoft Authentication seamlessly within a modern, glassmorphic UI.

## 🛠 Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS with a custom-designed glassmorphic UI, responsive animations, and custom titlebar.
- **Backend/Desktop**: Electron, Node.js (`minecraft-launcher-core` for game execution).
- **Authentication**: `msmc` for Microsoft/Xbox Live OAuth flow.
- **CI/CD**: GitHub Actions for automated Windows `.exe` releases.
- **Integrations**: `discord-rpc` for dynamic Discord Rich Presence.

---

## Features

- **Microsoft & Offline Authentication** — Fully integrated Microsoft / Xbox Live login flow via `msmc`.
- **Branded Desktop UI** — Custom title bar, sleek dark UI, and intuitive launch controls.
- **Automated Cloud Builds** — GitHub Actions automatically builds a Windows `.exe` installer on every push to the `main` branch.
- **Mod Profiles** — One-click Parkour Speedrunner pack or Competitive pack (Sodium, Lithium, FerriteCore, EntityCulling) auto-installed via Modrinth.
- **Discord Rich Presence** — Dynamic states (idle, downloading, installing mods, launching, in-game) using `.env` config.
- **Performance Auto-Tuning** — Aikar's GC flags, VSync disabled, 240 FPS cap, and auto-applied performance video settings.
- **Settings Persistence** — Username, version, server, memory, and profile are saved automatically and restored on next launch.
- **Live Log Streaming** — In-app terminal displaying launcher status.

## Prerequisites

- Node.js 20+ (includes npm)
- Java 17+ (recommended for modern Minecraft versions, Java 21 preferred)

## Setup

1. Open this project folder in a terminal.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the root directory for Discord Rich Presence (optional):
   ```env
   DISCORD_CLIENT_ID=your_discord_app_id_here
   ```
4. Run launcher:
   ```bash
   npm start
   ```

## One-click launcher (double-click)

Use `Open-Legends-Launcher.cmd` in the project root.
- Double-click it to start the launcher.
- On first run, it auto-installs dependencies (`npm install`).
- After that, it directly opens the launcher app.

If you want it on your Desktop:
Right-click `Open-Legends-Launcher.cmd` -> **Send to** -> **Desktop (create shortcut)**.

## Mod Profiles

Select a profile in the launcher UI, then launch. The launcher will automatically install the Fabric loader and download compatible mods directly from Modrinth.

### Parkour Speedrunner Pack
Includes: Fabric API, Sodium, Lithium, FerriteCore, Mod Menu, Reese's Sodium Options, Entity Culling, ImmediatelyFast, Zoomify.

### Competitive Pack
Includes: Fabric API, Sodium, Lithium, FerriteCore, Entity Culling, ImmediatelyFast.

## Discord Rich Presence (activity image)

This launcher includes dynamic Discord Rich Presence support.

1. Create an app in the [Discord Developer Portal](https://discord.com/developers/applications).
2. Copy your **Application ID**.
3. In **Rich Presence -> Art Assets**, upload image assets with these keys:
   - `legends_launcher_logo` (large image)
   - `minecraft_icon` (small idle image)
   - `play_icon` (small in-game image)
4. Add your ID and any custom buttons to your `.env` file:

```env
DISCORD_CLIENT_ID=your_discord_app_id_here
DISCORD_SHOW_SERVER=true
DISCORD_BUTTON_1_LABEL=Join Discord
DISCORD_BUTTON_1_URL=https://discord.gg/yourinvite
DISCORD_BUTTON_2_LABEL=Download Launcher
DISCORD_BUTTON_2_URL=https://your-site.example/download
```

If the Discord desktop app is open, your profile activity will seamlessly show your custom launcher image and status.

## Performance Tuning

Getting choppy FPS even with high framerates? See [OPTIMIZATION_GUIDE.md](./OPTIMIZATION_GUIDE.md) for a deep dive into:

- **Aikar's GC flags** — eliminates GC pause stutter (biggest win)
- **Memory allocation & Java version** — use Java 21 with correct RAM settings
- **In-game settings** — render distance, VSync, frame cap tuning
- **Windows optimization** — process priority, Xbox Game Bar disable
- **Troubleshooting** — how to diagnose different types of stutter

**TL;DR:** Use Aikar's flags + Sodium + Java 21 with 8-10GB allocated RAM.

## Customize branding

- App window title and dimensions: `main.js`
- Launcher name and UI look: `src/renderer/index.html`
- Default server settings in the form: `src/renderer/index.html`
- Launch rules and memory/args: `src/launcher.js`

## Planned upgrades

- Auto-update from a self-hosted endpoint
- News panel + server status display
