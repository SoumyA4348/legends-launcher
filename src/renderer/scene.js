// Procedural pixel-art daytime landscape behind the launcher: a bright sky with drifting
// cumulus clouds, hazy mountains, a bay with a little town, rolling hills and a lantern tree.
// Each instance id seeds its own world, like a world seed. Static layers are cached; only the
// clouds, birds, sea sparkles and lantern animate, at a few frames per second, and the scene
// freezes while hidden, off-screen or in game. Its top and bottom edges dissolve pixel by pixel
// into the paper-coloured bars.
(() => {
  const PIXEL = 4; // screen pixels per art pixel
  const FPS = 8;
  const GROUND_CSS = 104; // keep in sync with --bar-h: the bottom bar sits on this paper band
  const PAPER = "#faf8f4";

  const SKY = ["#4ba3e4", "#58abe8", "#66b4ec", "#76bdef", "#88c7f1", "#9cd1f3", "#b2dbf5", "#c9e6f7", "#ddf0f8"];
  const CLOUD = ["#ffffff", "#e4f0f9", "#cde1f0"]; // body, shade, base
  const MOUNTAINS = ["#bad4e8", "#a3c4de"]; // far, near
  const SEA = ["#8ccbee", "#7fc0e8", "#72b5e1", "#66a9d8"];
  const SPARKLE = "#f2fbff";
  const WAVE = "#acdcf4";
  const BOAT = { sail: "#ffffff", shade: "#dce8f1", wood: ["#8b5a36", "#5d3921"] }; // wood: hull, mast
  const SHORE = "#a9cc98";
  const HILLS = [
    { color: "#93c274", shade: "#84b868", tree: ["#6aa55a", "#89bf6b"], rise: 0.42, from: 0.3, to: 0.95, amp: 0.05, trees: 0.22, houses: 5 },
    { color: "#76ae5d", shade: "#69a252", tree: ["#4f8d44", "#6aa857"], rise: 0.24, from: 0.45, to: 1, amp: 0.06, trees: 0.3, houses: 2 }
  ];
  const GRASS = ["#5a9a45", "#6aaa50", "#80bf5f"]; // dark, body, sunlit edge
  const FLOWERS = ["#ffffff", "#ffe27a", "#f6b2c8"];
  const WALLS = ["#f7f2e8", "#efe5d3", "#fbf8f1"];
  const ROOFS = ["#e2774b", "#cf5f3a", "#d96c42", "#b9553b"];
  const WINDOW = "#6f93b3";
  const TRUNK = ["#7a4b2e", "#5d3921", "#93603d"]; // body, shade, light
  const LEAVES = ["#356f35", "#428341", "#53964b", "#6aaa55", "#86c262"];
  const LANTERN = { frame: "#3b332d", glow: ["#ffd27a", "#fff0c4"], halo: "rgba(255, 214, 130, 0.3)" };
  const BIRD = "#46525e";
  // 4x4 Bayer matrix for ordered dithering between colour bands.
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

  // Smooth 1D value noise with two octaves, sampled per column; values are roughly 0 to 1.
  // Wider spacings give gentler shapes (mountains); narrow ones give texture (meadow).
  function heightLine(rand, columns, coarse = 9, fine = 3) {
    const octave = (spacing, weight) => {
      const points = Array.from({ length: Math.ceil(columns / spacing) + 2 }, rand);
      return (x) => {
        const i = Math.floor(x / spacing);
        const t = (1 - Math.cos(((x % spacing) / spacing) * Math.PI)) / 2;
        return (points[i] * (1 - t) + points[i + 1] * t) * weight;
      };
    };
    const a = octave(coarse, 0.7);
    const b = octave(fine, 0.3);
    return Array.from({ length: columns }, (_, x) => a(x) + b(x));
  }

  const smoothstep = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const pick = (rand, list) => list[Math.floor(rand() * list.length)];
  const threshold = (x, y) => (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
  const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  let canvas = null;
  let ctx = null;
  let W = 0;
  let H = 0;
  let seed = "default";
  let skyLayer = null;
  let terrainLayer = null;
  let clouds = [];
  let birds = [];
  let sparkles = [];
  let lantern = null;
  let boat = null;
  let active = true;
  let timer = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function offscreen(width = W, height = H) {
    const layer = document.createElement("canvas");
    layer.width = Math.max(1, width);
    layer.height = Math.max(1, height);
    return layer;
  }

  // A filled circle from whole-pixel rows, so edges stay crisp.
  function disc(g, cx, cy, r) {
    for (let dy = -Math.floor(r); dy <= r; dy++) {
      const half = Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy)));
      g.fillRect(Math.round(cx) - half, Math.round(cy) + dy, half * 2 + 1, 1);
    }
  }

  // Dithered colour bands between rows y0 and y1, as in old pixel art.
  function ditherRows(g, colors, y0, y1) {
    for (let y = y0; y < y1; y++) {
      const position = ((y - y0) / Math.max(1, y1 - y0)) * (colors.length - 1);
      const band = Math.floor(position);
      const mix = position - band;
      for (let x = 0; x < W; x++) {
        g.fillStyle = colors[Math.min(band + (mix > threshold(x, y) ? 1 : 0), colors.length - 1)];
        g.fillRect(x, y, 1, 1);
      }
    }
  }

  // The sky is the largest layer, so it is written straight into pixels.
  function buildSky(horizon) {
    const layer = offscreen();
    const g = layer.getContext("2d");
    const image = g.createImageData(W, H);
    const rgb = SKY.map(hexRgb);
    for (let y = 0; y < H; y++) {
      const position = Math.min(y / horizon, 1) * (SKY.length - 1);
      const band = Math.floor(position);
      const mix = position - band;
      for (let x = 0; x < W; x++) {
        const [r, gr, b] = rgb[Math.min(band + (mix > threshold(x, y) ? 1 : 0), SKY.length - 1)];
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

  // A cumulus: overlapping round puffs on a flat base. Each pixel takes its shade from the puff
  // it sits deepest in: lower-right parts of a puff and the base are in shadow, giving volume.
  function makeCloud(rand, width) {
    const height = Math.max(5, Math.round(width * 0.42));
    const puffs = Array.from({ length: 3 + Math.floor(width / 10) }, () => {
      const r = Math.max(2, Math.round(height * (0.28 + rand() * 0.24)));
      return { x: r + rand() * Math.max(1, width - 2 * r), y: height - r * (0.7 + rand() * 0.3), r };
    });
    const layer = offscreen(width, height);
    const g = layer.getContext("2d");
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let home = null;
        let depth = 0;
        for (const p of puffs) {
          const inside = 1 - ((x - p.x) ** 2 + (y - p.y) ** 2) / (p.r * p.r);
          if (inside >= 0 && inside >= depth) {
            depth = inside;
            home = p;
          }
        }
        if (!home) continue;
        const shaded = (x - home.x > home.r * 0.3 && y - home.y > -home.r * 0.25) || y > height * 0.72;
        g.fillStyle = y === height - 1 ? CLOUD[2] : shaded ? CLOUD[1] : CLOUD[0];
        g.fillRect(x, y, 1, 1);
      }
    }
    return layer;
  }

  // Towering banks low over the mountains, then smaller puffs higher up.
  function makeClouds(rand, horizon) {
    const banks = Array.from({ length: 2 }, () => ({
      image: makeCloud(rand, Math.round(W * (0.24 + rand() * 0.14))),
      x: rand() * W,
      y: Math.round(horizon * (0.42 + rand() * 0.18)),
      speed: 0.12 + rand() * 0.08
    }));
    const puffs = Array.from({ length: 4 }, () => ({
      image: makeCloud(rand, Math.round(W * (0.06 + rand() * 0.08))),
      x: rand() * W,
      y: Math.round(horizon * (0.04 + rand() * 0.22)),
      speed: 0.2 + rand() * 0.2
    }));
    return [...banks, ...puffs];
  }

  function drawHouse(g, x, ground, w, h, rand) {
    g.fillStyle = pick(rand, WALLS);
    g.fillRect(x, ground - h, w, h + 1);
    g.fillStyle = pick(rand, ROOFS);
    const roofRows = w > 6 ? 3 : 2;
    for (let i = 0; i < roofRows; i++) g.fillRect(x - 1 + i, ground - h - 1 - i, w + 2 - i * 2, 1);
    if (rand() < 0.4) g.fillRect(x + w - 2, ground - h - roofRows - 1, 1, 2); // chimney
    g.fillStyle = WINDOW;
    for (let wx = x + 1; wx < x + w - 1; wx += 2) g.fillRect(wx, ground - h + 1, 1, 1);
    if (h > 4) for (let wx = x + 1; wx < x + w - 1; wx += 2) g.fillRect(wx, ground - h + 3, 1, 1);
  }

  // Houses gathered into a village around `center`, each sitting on the slope beneath it.
  function drawVillage(g, rand, center, spread, count, surface, small) {
    const spots = [];
    for (let i = 0; i < count * 3 && spots.length < count; i++) {
      const w = small ? 2 : 5 + Math.floor(rand() * 4);
      const x = Math.round(center + (rand() + rand() - 1) * spread);
      if (x < 1 || x + w >= W - 1 || spots.some((s) => x < s.x + s.w + 1 && s.x < x + w + 1)) continue;
      spots.push({ x, w });
    }
    for (const { x, w } of spots.sort((a, b) => surface(a.x) - surface(b.x))) {
      let ground = 0;
      for (let i = x; i < x + w; i++) ground = Math.max(ground, surface(i));
      if (small) {
        g.fillStyle = pick(rand, WALLS);
        g.fillRect(x, ground - 2, 2, 2);
        g.fillStyle = pick(rand, ROOFS);
        g.fillRect(x, ground - 3, 2, 1);
      } else {
        drawHouse(g, x, ground + 1, w, 4 + Math.floor(rand() * 3), rand);
      }
    }
  }

  function drawBush(g, x, ground, r, colors) {
    g.fillStyle = TRUNK[1];
    g.fillRect(x, ground - 2, 1, 2);
    g.fillStyle = colors[0];
    disc(g, x, ground - 2 - r, r);
    g.fillStyle = colors[1];
    g.fillRect(x - Math.ceil(r / 2), ground - 2 - r - Math.ceil(r / 2), Math.max(1, Math.floor(r / 2)), 1);
  }

  // The foreground tree on the right edge. Its branch reaches left past the news column
  // (`tipX`), so the lantern hangs in open sky instead of behind the cards.
  function drawLanternTree(g, rand, groundTop, tipX) {
    const unit = Math.max(1, W / 270);
    const trunkW = Math.max(7, Math.round(9 * unit));
    const trunkX = W - trunkW - Math.round(2 * unit);
    const trunkTop = Math.round(groundTop * 0.1);
    g.fillStyle = TRUNK[0];
    g.fillRect(trunkX, trunkTop, trunkW, groundTop - trunkTop);
    g.fillRect(trunkX - 2, groundTop - 3, trunkW + 4, 3); // roots
    g.fillStyle = TRUNK[1];
    g.fillRect(trunkX + trunkW - 2, trunkTop, 2, groundTop - trunkTop);
    g.fillStyle = TRUNK[2];
    g.fillRect(trunkX + 1, trunkTop, 1, groundTop - trunkTop);
    g.fillStyle = TRUNK[1];
    for (let y = trunkTop; y < groundTop; y += 3 + Math.floor(rand() * 4)) {
      g.fillRect(trunkX + 1 + Math.floor(rand() * (trunkW - 2)), y, 1, 2);
    }

    // The branch rises a little toward its tip, thinning out.
    const branchY = Math.round(groundTop * 0.3);
    const branchEnd = Math.min(tipX, trunkX - Math.round(W * 0.14));
    const lift = (x) => Math.round(((trunkX - x) / (trunkX - branchEnd)) * 4);
    g.fillStyle = TRUNK[0];
    for (let x = branchEnd; x < trunkX; x++) {
      g.fillRect(x, branchY - lift(x), 1, x > (branchEnd + trunkX) / 2 ? 3 : 2);
    }
    g.fillStyle = TRUNK[1];
    for (let x = branchEnd; x < trunkX; x++) g.fillRect(x, branchY - lift(x) + 1, 1, 1);

    const clusters = Array.from({ length: Math.round(22 * unit) }, () => ({
      x: W * (0.72 + rand() * 0.32),
      y: groundTop * (-0.05 + rand() * 0.28),
      r: (4 + rand() * 8) * unit
    }));
    for (let i = 0; i < 5; i++) {
      clusters.push({
        x: branchEnd + (trunkX - branchEnd) * (0.05 + i * 0.2),
        y: branchY - (5 + rand() * 4) * unit,
        r: (3 + rand() * 3) * unit
      });
    }
    // Dark to light passes, each nudged up-left, so the canopy looks lit from the sky.
    LEAVES.slice(0, 3).forEach((color, pass) => {
      g.fillStyle = color;
      for (const c of clusters) disc(g, c.x - pass * c.r * 0.18, c.y - pass * c.r * 0.22, c.r * (1 - pass * 0.22));
    });
    for (const c of clusters) {
      g.fillStyle = LEAVES[3];
      disc(g, c.x - c.r * 0.45, c.y - c.r * 0.5, c.r * 0.3);
      g.fillStyle = LEAVES[4];
      g.fillRect(Math.round(c.x - c.r * 0.5), Math.round(c.y - c.r * 0.6), 1, 1);
    }

    const lx = branchEnd + Math.round(3 * unit);
    const top = branchY - lift(lx) + 2;
    g.fillStyle = LANTERN.frame;
    g.fillRect(lx, top, 1, 4); // chain
    g.fillRect(lx - 2, top + 4, 5, 1); // cap
    g.fillRect(lx - 2, top + 5, 1, 5);
    g.fillRect(lx + 2, top + 5, 1, 5);
    g.fillRect(lx - 2, top + 10, 5, 1); // base
    lantern = { x: lx - 1, y: top + 5, w: 3, h: 5 };
  }

  function buildTerrain(rand, groundTop, horizon, tipX) {
    const layer = offscreen();
    const g = layer.getContext("2d");
    // Highest land pixel in front of the sea, per column: sparkles and the boat stay on water.
    const front = new Array(W).fill(groundTop);

    // Hazy mountains on the horizon: broad, gentle shapes, paler with distance.
    MOUNTAINS.forEach((color, i) => {
      const heights = heightLine(rand, W, 40 - i * 12, 13 - i * 4);
      g.fillStyle = color;
      for (let x = 0; x < W; x++) {
        const top = Math.round(horizon - groundTop * (0.05 - i * 0.02 + heights[x] * (0.22 - i * 0.08)));
        g.fillRect(x, top, 1, horizon - top);
      }
    });

    // The far shore of the bay, low and green, tapering off to the right, with a small village.
    const shore = heightLine(rand, W, 24, 8).map((h, x) =>
      Math.round(horizon - 1 - h * groundTop * 0.06 * (1 - smoothstep(0.55, 0.85, x / W)))
    );
    g.fillStyle = SHORE;
    for (let x = 0; x < W; x++) g.fillRect(x, shore[x], 1, horizon - shore[x] + 1);
    drawVillage(g, rand, W * (0.12 + rand() * 0.3), W * 0.08, Math.max(4, Math.floor(W / 30)), (x) => shore[x], true);

    ditherRows(g, SEA, horizon + 1, groundTop);
    g.fillStyle = WAVE;
    for (let i = 0; i < Math.floor((W * (groundTop - horizon)) / 45); i++) {
      g.fillRect(Math.floor(rand() * W), horizon + 2 + Math.floor(rand() * (groundTop - horizon - 2)), 2 + Math.floor(rand() * 3), 1);
    }

    HILLS.forEach((spec, index) => {
      const heights = heightLine(rand, W, 28, 9);
      const tops = heights.map((h, x) =>
        Math.round(groundTop - groundTop * (spec.rise * smoothstep(spec.from, spec.to, x / W) + spec.amp * h))
      );
      for (let x = 0; x < W; x++) {
        g.fillStyle = spec.color;
        g.fillRect(x, tops[x], 1, groundTop - tops[x]);
        g.fillStyle = spec.shade;
        for (let y = tops[x] + 2; y < groundTop; y += 3 + Math.floor(rand() * 6)) g.fillRect(x, y, 1, 1);
        front[x] = Math.min(front[x], tops[x]);
      }
      for (let x = 2; x < W - 2; x++) {
        if (rand() < spec.trees * smoothstep(spec.from - 0.1, spec.to, x / W) * 0.6) {
          drawBush(g, x, tops[x] + 1, 1 + Math.floor(rand() * 3), spec.tree);
        }
      }
      const center = W * (index === 0 ? 0.5 + rand() * 0.16 : 0.66 + rand() * 0.1);
      drawVillage(g, rand, center, W * (index === 0 ? 0.07 : 0.04), spec.houses, (x) => tops[x], false);
    });

    // Meadow along the bottom, full of flowers.
    const meadow = heightLine(rand, W).map((h) => groundTop - 5 - Math.round(h * 6));
    for (let x = 0; x < W; x++) {
      g.fillStyle = GRASS[1];
      g.fillRect(x, meadow[x], 1, groundTop - meadow[x]);
      g.fillStyle = GRASS[2];
      g.fillRect(x, meadow[x], 1, 1);
      for (let y = meadow[x] + 1; y < groundTop; y++) {
        const r = rand();
        if (r < 0.12) {
          g.fillStyle = GRASS[0];
          g.fillRect(x, y, 1, 1);
        } else if (r < 0.18) {
          g.fillStyle = pick(rand, FLOWERS);
          g.fillRect(x, y, 1, 1);
        }
      }
      front[x] = Math.min(front[x], meadow[x]);
    }

    drawLanternTree(g, rand, groundTop, tipX);

    sparkles = [];
    for (let i = 0; i < Math.floor(W / 4); i++) {
      const x = Math.floor(rand() * W);
      const y = horizon + 2 + Math.floor(rand() * Math.max(1, groundTop - horizon - 4));
      if (y < front[x] - 1) sparkles.push({ x, y, w: 1 + Math.floor(rand() * 2), phase: rand() * Math.PI * 2 });
    }

    // A boat sails back and forth across the open water on the left.
    const boatY = horizon + Math.max(6, Math.round((groundTop - horizon) * 0.32));
    let reach = 0;
    while (reach < W && front[reach] > boatY + 2) reach++;
    boat = reach > 48 ? { from: 6, to: reach - 8, y: boatY, speed: 0.5 + rand() * 0.4, phase: rand() } : null;

    // Both edges dissolve into the paper bars, pixel by pixel, catching a few flowers.
    for (let y = groundTop - 5; y < groundTop + 2; y++) {
      const p = (y - (groundTop - 5)) / 7;
      for (let x = 0; x < W; x++) {
        const r = rand();
        if (r < p) {
          g.fillStyle = PAPER;
          g.fillRect(x, y, 1, 1);
        } else if (r < p + 0.04) {
          g.fillStyle = pick(rand, FLOWERS);
          g.fillRect(x, y, 1, 1);
        }
      }
    }
    g.fillStyle = PAPER;
    g.fillRect(0, groundTop + 2, W, H - groundTop - 2);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < W; x++) {
        if (rand() < (y === 0 ? 0.6 : 0.25)) g.fillRect(x, y, 1, 1);
      }
    }
    return layer;
  }

  // A small sailing boat; `dir` flips it to face the way it sails.
  function drawBoat(g, x, y, dir) {
    const row = (dx, dy, w = 1) => g.fillRect(dir > 0 ? x + dx : x - dx - w + 1, y + dy, w, 1);
    g.fillStyle = BOAT.sail;
    row(1, -5);
    row(1, -4, 2);
    row(1, -3, 3);
    row(-2, -2, 2);
    g.fillStyle = BOAT.shade;
    row(1, -2, 3);
    g.fillStyle = BOAT.wood[1];
    for (let dy = -6; dy < 0; dy++) row(0, dy);
    row(-2, 1, 5);
    g.fillStyle = BOAT.wood[0];
    row(-3, 0, 7);
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
    const horizon = Math.round(groundTop * 0.6);
    // Where the lantern branch must reach: just left of the news column. Keep in sync with
    // .news in styles.css (300px plus the gutter, or 240px on windows 1000px wide or less).
    const tipX = W - Math.ceil((rect.width > 1000 ? 348 : 268) / PIXEL) - 4;
    lantern = null;
    boat = null;
    if (groundTop < 24) {
      // Too small to paint (e.g. hidden): leave a plain paper backdrop.
      skyLayer = offscreen();
      terrainLayer = offscreen();
      const g = skyLayer.getContext("2d");
      g.fillStyle = PAPER;
      g.fillRect(0, 0, W, H);
      clouds = [];
      birds = [];
      sparkles = [];
    } else {
      skyLayer = buildSky(horizon);
      clouds = makeClouds(rand, horizon);
      terrainLayer = buildTerrain(rand, groundTop, horizon, tipX);
      // Birds keep to the top of the sky, above the headline, so they never cross the text.
      birds = Array.from({ length: 3 }, () => ({
        x: rand() * W,
        y: Math.round(horizon * (0.06 + rand() * 0.1)),
        speed: 1 + rand() * 1.2,
        phase: rand() * Math.PI * 2
      }));
    }
    draw(performance.now());
  }

  function draw(time) {
    if (!ctx || !skyLayer) return;
    const t = time / 1000;
    ctx.drawImage(skyLayer, 0, 0);

    for (const cloud of clouds) {
      const w = cloud.image.width;
      ctx.drawImage(cloud.image, Math.round(((cloud.x + t * cloud.speed) % (W + w)) - w), cloud.y);
    }

    ctx.drawImage(terrainLayer, 0, 0);

    ctx.fillStyle = SPARKLE;
    for (const sparkle of sparkles) {
      if (Math.sin(t * 2.2 + sparkle.phase) > 0.55) ctx.fillRect(sparkle.x, sparkle.y, sparkle.w, 1);
    }

    if (boat) {
      const span = boat.to - boat.from;
      const travel = (t * boat.speed + boat.phase * span * 2) % (span * 2);
      const heading = travel < span ? 1 : -1;
      drawBoat(ctx, Math.round(boat.from + (heading > 0 ? travel : span * 2 - travel)), boat.y, heading);
    }

    if (lantern) {
      ctx.fillStyle = LANTERN.halo;
      ctx.fillRect(lantern.x - 2, lantern.y - 2, lantern.w + 4, lantern.h + 4);
      ctx.fillStyle = LANTERN.glow[Math.sin(t * 6.5) > 0.3 ? 1 : 0];
      ctx.fillRect(lantern.x, lantern.y, lantern.w, lantern.h);
    }

    ctx.fillStyle = BIRD;
    for (const bird of birds) {
      const x = Math.round(((bird.x + t * bird.speed) % (W + 6)) - 3);
      if (Math.sin(t * 5 + bird.phase) > 0) {
        ctx.fillRect(x, bird.y, 1, 1);
        ctx.fillRect(x + 1, bird.y + 1, 1, 1);
        ctx.fillRect(x + 2, bird.y, 1, 1);
      } else {
        ctx.fillRect(x, bird.y + 1, 3, 1);
      }
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
