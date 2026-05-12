# Legends Launcher Optimization Guide

This guide provides comprehensive tuning recommendations to eliminate stutter, maximize FPS stability, and squeeze every ounce of performance out of Minecraft. The Legends Launcher automatically applies many of these settings out of the box.

## TL;DR — Priority Order

The biggest performance wins (in order):
1. **Aikar's GC Flags** — Reduces Garbage Collection (GC) pause stutter (Applied automatically by Legends Launcher).
2. **Performance Mod Packs** — GPU acceleration via Sodium/Lithium (Available as one-click profiles).
3. **Correct RAM Allocation** — Prevents memory pressure issues and heap resizing.

---

## 1. Java GC & Memory Settings (Critical)

### Aikar's Flags (Java 21 Recommended)

The Legends Launcher automatically injects the highly-optimized Aikar's JVM arguments under the hood to completely eliminate micro-stutters caused by Java's Garbage Collection. 

For reference, the flags applied are:
```
-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 -XX:InitiatingHeapOccupancyPercent=15 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem -XX:MaxTenuringThreshold=1
```

### Memory Allocation

- **For 16GB+ RAM systems:** Allocate 8-10GB (e.g., `-Xmx10G -Xms10G`)
- **For 8GB RAM systems:** Allocate 4-6GB (e.g., `-Xmx6G -Xms6G`)
- **For 4GB RAM systems:** Allocate 2-3GB (e.g., `-Xmx3G -Xms3G`)

**Important:** The Legends Launcher automatically sets your minimum RAM (`-Xms`) equal to your maximum RAM (`-Xmx`) to prevent heap resizing during gameplay.

### Java Version

- **Use Java 21** — It features significantly better garbage collection efficiency than Java 8 or 17.
- Verify your installation with: `java -version`

---

## 2. In-Game Settings

### Graphics & Rendering

| Setting | Recommended | Reason |
|---------|-------------|--------|
| **Render Distance** | 8-12 chunks | Higher = more chunk loading = stutter; balance visibility vs performance |
| **Simulation Distance** | Lower than render distance | Reduces server-side entity/chunk updates |
| **Graphics Quality** | Fast | (Unless using Sodium, then Fancy is perfectly fine) |
| **Smooth Lighting** | Off or Minimum | Reduces frame time variance |

### Frame Rate & Sync

| Setting | Recommended | Reason |
|---------|-------------|--------|
| **VSync** | **OFF** | VSync causes input lag; use a frame cap instead. Legends Launcher turns this off by default. |
| **Max Framerate** | Cap at monitor refresh rate | Uncapped FPS wastes GPU resources and creates thermal throttling. |

---

## 3. Chunk Loading Stutter Detection & Fix

### Is it chunk loading stutter?

- Stutter occurs specifically when **moving or exploring** new areas.
- Frame drops happen when rendering new chunks on the horizon.

### Solutions (in order of effectiveness)

1. **Use Nvidium mod** (Nvidia GPUs only) — Enables GPU-driven, instantaneous chunk rendering.
2. **Pre-generate your world** with the Chunky mod — Eliminates on-the-fly chunk generation overhead.
3. **Reduce render distance** (Immediate fix but less immersive).

---

## 4. Windows-Side Optimization

### Task Manager

- Right-click the Java process (`javaw.exe`) → Set priority to **High** (Not Realtime).
- Helps the Java process win CPU thread contention.

### Disable Xbox Game Bar

- Uncheck: `Settings → Gaming → Xbox Game Bar → "Open Xbox Game Bar on this device"`
- The Xbox Game Bar hooks into Java rendering processes and is known to cause micro-stutters.

### Power Plan

- Set your Windows power plan to **High Performance** or **Ultimate Performance** (if available).
- Prevents CPU frequency downscaling during gameplay.

---

## 5. Mod Recommendations

The Legends Launcher includes one-click profiles to install these automatically.

### Essential Performance Mods (Fabric)

| Mod | Purpose | Included in Launcher |
|-----|---------|----------------------|
| **Sodium** | GPU-accelerated rendering | Yes (All Profiles) |
| **Lithium** | Entity/block processing optimization | Yes (All Profiles) |
| **FerriteCore** | Reduced memory footprint | Yes (All Profiles) |
| **EntityCulling** | Skips rendering hidden entities | Yes (All Profiles) |
| **ImmediatelyFast** | Speeds up immediate mode UI rendering | Yes (All Profiles) |

### Optional Enhancements

- **Chunky** — Pre-generate chunks to eliminate on-the-fly generation stutter.
- **Nvidium** — GPU-driven chunk rendering (Nvidia GPUs only).
- **Reese's Sodium Options** — Better UI for Sodium settings (Included in Speedrunner Pack).

---

## 6. Troubleshooting Specific Stutter Types

### "Consistent 200 FPS with periodic freezes"
**Diagnosis:** GC pauses (Garbage collection freezing the game thread).
**Fix:** The Legends Launcher automatically applies Aikar's flags and matches min/max RAM allocation to fix this. Ensure you are using Java 21.

### "Stutter only when exploring/moving"
**Diagnosis:** Chunk loading/generation stutter.
**Fix:** Reduce render distance to 8 chunks, pre-generate the world with Chunky, and ensure Sodium is installed.

### "Periodic stuttering at fixed intervals"
**Diagnosis:** GC pause or Windows background process interference.
**Fix:** Check Task Manager for background processes (disable Xbox Game Bar, Windows Update). Ensure the Legends Launcher is using High process priority.

### "Stutter goes away when capping FPS lower"
**Diagnosis:** GPU or CPU bottleneck.
**Fix:** Cap FPS to your monitor's refresh rate. If GPU bottlenecked, lower render distance. If CPU bottlenecked, reduce simulation distance.

---

## 7. Quick Start Checklist

- [ ] Install Java 21.
- [ ] Select a Mod Profile (Competitive or Speedrunner) in the Legends Launcher.
- [ ] Set Render Distance to 8-12.
- [ ] Set Frame Cap to monitor refresh rate (e.g., 144).
- [ ] Set Windows Power Plan to High Performance.

---

## FAQ

**Q: Why is my 200 FPS game still stuttering?**
A: Uncapped FPS causes wasted GPU work and increases pressure on the GC. Cap it at your monitor's refresh rate.

**Q: Should I use Java 8, 17, or 21?**
A: Use **Java 21**. It has significantly better garbage collection and threading optimizations for modern Minecraft.

**Q: Is Sodium required?**
A: It is highly recommended. It provides a massive 30-50% FPS improvement for most systems.

---

## References & Mods

- [Sodium Mod](https://modrinth.com/mod/sodium) — GPU-accelerated rendering
- [Lithium Mod](https://modrinth.com/mod/lithium) — Optimization
- [Chunky Mod](https://modrinth.com/mod/chunky) — World pre-generation
- [FerriteCore Mod](https://modrinth.com/mod/ferritecore)
- [EntityCulling Mod](https://modrinth.com/mod/entityculling)
- [Aikar's GC Flags](https://docs.papermc.io/paper/aikars-flags-modern) — Original documentation
