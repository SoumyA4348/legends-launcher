// Procedural pixel-art night landscape behind the launcher. Each instance id seeds its own
// terrain, like a world seed. Static layers are cached; only stars, clouds and torches animate,
// at a few frames per second, and the scene freezes while hidden, off-screen or in game.
(() => {
  const PIXEL = 4; // screen pixels per art pixel
  const FPS = 8;
  const GROUND_CSS = 104; // keep in sync with --bar-h: the bottom bar sits on this ground band

  const SKY = ["#0e1330", "#121839", "#171f45", "#1e2852", "#26315f", "#303d6e", "#3b4a7a"];
  const LAYERS = [
    { color: "#1d2750", block: 3, base: 0.6, amp: 0.1, trees: 0 },
    { color: "#16203f", block: 4, base: 0.68, amp: 0.08, trees: 0.12 },
    { color: "#101931", block: 5, base: 0.76, amp: 0.05, trees: 0.08, houses: 2 }
  ];
  const GROUND = "#0b1424";
  const MOON = "#f4efd8";
  const MOON_SHADE = "#d6cfb0";
  const STAR_COLORS = ["#eef0ff", "#a3aacf", "#c9cdf0"];
  const TORCH = ["#ffb547", "#ffd27a", "#e0791f"];
  // 4x4 Bayer matrix for ordered dithering between sky bands.
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  function hashString(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return h >>> 0;
  }

  function mulberry32(seed) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Smooth 1D value noise with two octaves, sampled per block column.
  function heightLine(rand, columns) {
    const octave = (spacing, weight) => {
      const points = Array.from({ length: Math.ceil(columns / spacing) + 2 }, rand);
      return (x) => {
        const i = Math.floor(x / spacing);
        const t = (1 - Math.cos(((x % spacing) / spacing) * Math.PI)) / 2;
        return (points[i] * (1 - t) + points[i + 1] * t) * weight;
      };
    };
    const a = octave(9, 0.7);
    const b = octave(3, 0.3);
    return Array.from({ length: columns }, (_, x) => a(x) + b(x));
  }

  let canvas = null;
  let ctx = null;
  let W = 0;
  let H = 0;
  let seed = "default";
  let skyLayer = null;
  let terrainLayer = null;
  let stars = [];
  let clouds = [];
  let torches = [];
  let active = true;
  let timer = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function offscreen() {
    const layer = document.createElement("canvas");
    layer.width = W;
    layer.height = H;
    return layer;
  }

  function buildSky(horizon) {
    const layer = offscreen();
    const g = layer.getContext("2d");
    const image = g.createImageData(W, H);
    const rgb = SKY.map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));
    for (let y = 0; y < H; y++) {
      const position = Math.min(y / horizon, 1) * (SKY.length - 1);
      const band = Math.floor(position);
      const mix = position - band;
      for (let x = 0; x < W; x++) {
        const threshold = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
        const [r, gr, b] = rgb[Math.min(band + (mix > threshold ? 1 : 0), SKY.length - 1)];
        const o = (y * W + x) * 4;
        image.data[o] = r;
        image.data[o + 1] = gr;
        image.data[o + 2] = b;
        image.data[o + 3] = 255;
      }
    }
    g.putImageData(image, 0, 0);
    return layer;
  }

  function drawMoon(g, cx, cy, r) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r) {
          g.fillStyle = x + y > r * 0.6 ? MOON_SHADE : MOON;
          g.fillRect(cx + x, cy + y, 1, 1);
        }
      }
    }
    g.fillStyle = MOON_SHADE;
    for (const [dx, dy, s] of [[-3, -2, 2], [2, 1, 3], [-1, 4, 1], [4, -4, 1]]) g.fillRect(cx + dx, cy + dy, s, s);
  }

  // Blocky tree silhouettes in the current fill colour, built from a unit `u` (art px per leaf block).
  function drawTree(g, cx, groundY, u, rand) {
    // Integer coordinates only: fractional rects would blur the pixel edges.
    const row = (width, y) => g.fillRect(cx - Math.floor((width * u) / 2), y, width * u, u);
    const trunkH = u * (3 + Math.floor(rand() * 2));
    g.fillRect(cx - Math.floor(u / 2), groundY - trunkH, u, trunkH);
    // Broadleaf: a wide two-block slab with a narrower cap. Conifer: tiers narrowing to a point.
    const tiers = rand() < 0.5 ? [5, 5, 3, 1] : [5, 3, 3, 1];
    tiers.forEach((width, i) => row(width, groundY - trunkH - u * (i + 1)));
  }

  function buildTerrain(rand, groundTop) {
    const layer = offscreen();
    const g = layer.getContext("2d");
    torches = [];

    LAYERS.forEach((spec, index) => {
      const columns = Math.ceil(W / spec.block) + 1;
      const heights = heightLine(rand, columns);
      const baseY = Math.min(H * spec.base, groundTop - 6 * (LAYERS.length - index));
      g.fillStyle = spec.color;
      for (let c = 0; c < columns; c++) {
        // Quantize height to whole blocks so hills step like stacked cubes.
        const rise = Math.round((heights[c] * H * spec.amp * 2) / spec.block) * spec.block;
        const top = Math.round(baseY - rise);
        g.fillRect(c * spec.block, top, spec.block, H - top);

        if (rand() < spec.trees) {
          drawTree(g, c * spec.block + Math.floor(spec.block / 2), top, Math.ceil(spec.block / 2), rand);
        }
      }

      for (let i = 0; i < (spec.houses || 0); i++) {
        const c = Math.floor(columns * (0.45 + rand() * 0.5));
        const rise = Math.round((heights[c] * H * spec.amp * 2) / spec.block) * spec.block;
        const top = Math.round(baseY - rise);
        const x = c * spec.block;
        const w = 12 + Math.floor(rand() * 6);
        g.fillStyle = spec.color;
        g.fillRect(x, top - 8, w, 8 + spec.block);
        for (let step = 0; step < 4; step++) g.fillRect(x - 1 + step, top - 9 - step, w + 2 - step * 2, 1);
        torches.push({ x: x + 3, y: top - 5, w: 2, h: 2, window: true });
        torches.push({ x: x + w + 3, y: top - 3, w: 1, h: 2, window: false });
      }
    });

    // Ground band the bottom bar rests on, with a stepped top edge.
    g.fillStyle = GROUND;
    for (let x = 0; x < W; x += 4) {
      const bump = rand() < 0.3 ? (rand() < 0.5 ? 1 : 2) : 0;
      g.fillRect(x, groundTop - bump, 4, H - groundTop + bump);
    }
    for (let i = 0; i < Math.max(2, Math.floor(W / 90)); i++) {
      torches.push({ x: Math.floor(rand() * W), y: groundTop - 3, w: 1, h: 2, window: false });
    }
    return layer;
  }

  function rebuild() {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    W = Math.max(1, Math.ceil(rect.width / PIXEL));
    H = Math.max(1, Math.ceil(rect.height / PIXEL));
    canvas.width = W;
    canvas.height = H;

    const rand = mulberry32(hashString(seed));
    const groundTop = H - Math.ceil(GROUND_CSS / PIXEL);
    const horizon = Math.round(groundTop * 0.82);
    skyLayer = buildSky(horizon);
    drawMoon(skyLayer.getContext("2d"), Math.round(W * (0.62 + rand() * 0.25)), Math.round(H * (0.12 + rand() * 0.08)), 7);

    stars = Array.from({ length: Math.floor((W * horizon) / 380) }, () => ({
      x: Math.floor(rand() * W),
      y: Math.floor(rand() * horizon * 0.85),
      color: STAR_COLORS[Math.floor(rand() * STAR_COLORS.length)],
      phase: rand() * Math.PI * 2,
      twinkles: rand() < 0.25
    }));
    clouds = Array.from({ length: 4 }, () => ({
      x: rand() * W,
      y: Math.floor(H * (0.1 + rand() * 0.3)),
      w: 14 + Math.floor(rand() * 24),
      speed: 0.15 + rand() * 0.2
    }));
    terrainLayer = buildTerrain(rand, groundTop);
    draw(0);
  }

  function draw(time) {
    if (!ctx || !skyLayer) return;
    ctx.drawImage(skyLayer, 0, 0);

    const t = time / 1000;
    for (const star of stars) {
      if (star.twinkles && Math.sin(t * 1.3 + star.phase) < -0.4) continue;
      ctx.fillStyle = star.color;
      ctx.fillRect(star.x, star.y, 1, 1);
    }

    ctx.fillStyle = "rgba(58, 72, 122, 0.55)";
    for (const cloud of clouds) {
      const x = Math.round(((cloud.x + t * cloud.speed) % (W + cloud.w)) - cloud.w);
      ctx.fillRect(x, cloud.y, cloud.w, 3);
      ctx.fillRect(x + 4, cloud.y - 2, cloud.w - 10, 2);
    }

    ctx.drawImage(terrainLayer, 0, 0);

    for (const [i, torch] of torches.entries()) {
      const flicker = Math.sin(t * 7 + i * 1.7) > 0.6 ? 1 : 0;
      ctx.fillStyle = "rgba(255, 181, 71, 0.16)";
      ctx.fillRect(torch.x - 2, torch.y - 2, torch.w + 4, torch.h + 4);
      ctx.fillStyle = TORCH[torch.window ? 0 : flicker];
      ctx.fillRect(torch.x, torch.y, torch.w, torch.h);
    }
  }

  function loop() {
    clearTimeout(timer);
    timer = null;
    if (!active || reducedMotion.matches || document.hidden) return;
    draw(performance.now());
    timer = setTimeout(() => requestAnimationFrame(loop), 1000 / FPS);
  }

  window.NightScene = {
    mount(element) {
      canvas = element;
      ctx = canvas.getContext("2d");
      new ResizeObserver(rebuild).observe(canvas);
      document.addEventListener("visibilitychange", loop);
      reducedMotion.addEventListener("change", loop);
    },
    setSeed(value) {
      if (value === seed && skyLayer) return;
      seed = String(value);
      rebuild();
    },
    setActive(value) {
      active = Boolean(value);
      loop();
    }
  };
})();
