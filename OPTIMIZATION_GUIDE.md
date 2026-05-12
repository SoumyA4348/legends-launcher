# Minecraft Performance Optimization Guide

This guide provides comprehensive tuning recommendations to eliminate stutter and maximize FPS stability in Minecraft.

## TL;DR — Priority Order

The biggest wins (in order):
1. **Aikar's GC Flags** — reduces GC pause stutter
2. **Sodium mod** — GPU acceleration
3. **Correct RAM allocation** — prevents memory pressure issues

---

## 1. Java GC & Memory Settings (Critical)

### Aikar's Flags (Java 21 Recommended)

Use these JVM arguments in your launcher configuration:

```
-XX:+UseG1GC -XX:MaxGCPauseMillis=130 -XX:+ParallelRefProcEnabled -XX:+AlwaysPreTouch -XX:+PerfDisableSharedMem -XX:G1HeapWastePercent=5 -XX:G1NewCollectionHeuristicPercent=40 -XX:G1MixedGCLiveThresholdPercent=90 -XX:G1MixedGCCountTarget=8 -XX:G1SoftMaxPercent=80 -XX:G1HeapRegionSize=16M
```

### Memory Allocation

- **For 16GB+ RAM systems:** Allocate 8-10GB (e.g., `-Xmx10G -Xms10G`)
- **For 8GB RAM systems:** Allocate 4-6GB (e.g., `-Xmx6G -Xms6G`)
- **For 4GB RAM systems:** Allocate 2-3GB (e.g., `-Xmx3G -Xms3G`)

**Important:** Always set `-Xms` equal to `-Xmx` to prevent heap resizing during gameplay (causes stutter).

### Java Version

- **Use Java 21** — has better garbage collection than Java 8 or 17
- Verify with: `java -version`

---

## 2. In-Game Settings

### Graphics & Rendering

| Setting | Recommended | Reason |
|---------|-------------|--------|
| **Render Distance** | 8-12 chunks | Higher = more chunk loading = stutter; balance visibility vs performance |
| **Simulation Distance** | Lower than render distance | Reduces server-side entity/chunk updates |
| **Graphics Quality** | Fast | (unless using Sodium, then can be Fancy) |
| **Smooth Lighting** | Off or Minimum | Reduces frame time variance |

### Frame Rate & Sync

| Setting | Recommended | Reason |
|---------|-------------|--------|
| **VSync** | **OFF** | VSync causes input lag; use frame cap instead |
| **Max Framerate** | Cap at monitor refresh rate | 144 FPS for 144Hz monitor; uncapped = wasted work + more stutter |

---

## 3. Chunk Loading Stutter Detection & Fix

### Is it chunk loading stutter?

- Stutter occurs when **moving/exploring** new areas
- Frame drops when rendering new chunks

### Solutions (in order of effectiveness)

1. **Reduce render distance** (immediate but less immersive)
2. **Use Nvidium mod** (Nvidia GPUs only) — enables GPU-driven chunk rendering
3. **Pre-generate your world** with Chunky mod — eliminates on-the-fly chunk gen

---

## 4. Windows-Side Optimization

### Task Manager

- Right-click `javaw.exe` → Set priority to **High** (not Realtime)
- Helps Java process win CPU contention

### Disable Xbox Game Bar

- Uncheck: Settings → Gaming → Xbox Game Bar → "Open Xbox Game Bar on this device"
- Xbox Game Bar hooks into Java processes and can cause stutters

### Power Plan

- Set to **High Performance** or **Ultimate Performance** (if available)
- Prevents CPU frequency scaling during gameplay

---

## 5. Mod Recommendations

### Essential Performance Mods (Fabric)

| Mod | Purpose | Installation |
|-----|---------|--------------|
| **Sodium** | GPU-accelerated rendering | Install via launcher's mod profiles |
| **Lithium** | Entity/block processing optimization | Included in competitive profile |
| **FerriteCore** | Reduced memory footprint | Included in competitive profile |
| **EntityCulling** | Skips rendering hidden entities | Included in competitive profile |

### Optional Mods

- **Chunky** — Pre-generate chunks to eliminate on-the-fly gen stutter
- **Nvidium** — GPU-driven chunk rendering (Nvidia GPUs only)
- **Reese's Sodium Options** — Better Sodium settings UI

---

## 6. Troubleshooting Specific Stutter Types

### "Consistent 200 FPS with periodic freezes"

**Diagnosis:** GC pauses (garbage collection freezing game thread)

**Fix:**
- Implement Aikar's flags (fixes ~80% of cases)
- Ensure `-Xms` = `-Xmx` (pre-allocate RAM)
- Use Java 21

### "Stutter only when exploring/moving"

**Diagnosis:** Chunk loading/generation stutter

**Fix:**
1. Reduce render distance to 8 chunks
2. Pre-generate world with Chunky
3. Install Sodium for better chunk pipeline

### "Periodic stuttering at fixed intervals"

**Diagnosis:** GC pause or Windows background process

**Fix:**
- Check Task Manager for background processes (disable Xbox Game Bar, Windows Update Medic Service, etc.)
- Verify Java 21 with Aikar's flags
- Set process priority to High

### "Stutter goes away when capping FPS lower"

**Diagnosis:** GPU or CPU bottleneck

**Fix:**
- If GPU bottleneck: Lower render distance, disable fancy graphics
- If CPU bottleneck: Ensure Java 21 + Aikar's flags, reduce simulation distance

---

## 7. Quick Start Checklist

- [ ] Set Java to version 21
- [ ] Configure JVM with Aikar's GC flags
- [ ] Allocate correct RAM (`-Xmx` and `-Xms` equal)
- [ ] Set render distance to 8-12
- [ ] Turn OFF VSync
- [ ] Set frame cap to monitor refresh rate (e.g., 144)
- [ ] Install Sodium mod (if using Fabric)
- [ ] Set Minecraft process priority to High in Task Manager
- [ ] Disable Xbox Game Bar
- [ ] Set Windows power plan to High Performance
- [ ] Test and gradually increase render distance if FPS is stable

---

## FAQ

**Q: Why is my 200 FPS game still stuttering?**
A: Uncapped FPS causes wasted GPU work and increases pressure on the GC. Cap at your monitor refresh rate (e.g., 144 FPS) — the Aikar's flags directly fix the underlying GC pause issue.

**Q: Should I use Java 8, 17, or 21?**
A: Use **Java 21** — it has significantly better garbage collection than Java 8 or 17 for modern Minecraft versions.

**Q: Is Sodium required?**
A: Not required, but it's a massive performance gain (30-50% FPS improvement for most systems). Highly recommended.

**Q: Can I use these settings on servers I don't own?**
A: Yes! Client-side settings (render distance, graphics, VSync, frame cap) are purely local. Server-side settings (simulation distance) depend on the server configuration.

---

## References & Mods

- [Sodium Mod](https://modrinth.com/mod/sodium) — GPU-accelerated rendering
- [Lithium Mod](https://modrinth.com/mod/lithium) — Optimization
- [Chunky Mod](https://modrinth.com/mod/chunky) — World pre-generation
- [FerriteCore Mod](https://modrinth.com/mod/ferritecore)
- [EntityCulling Mod](https://modrinth.com/mod/entityculling)
- [Aikar's GC Flags](https://docs.papermc.io/paper/aikars-flags-modern) — Original documentation
