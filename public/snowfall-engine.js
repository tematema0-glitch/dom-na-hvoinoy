import { DEFAULT_SNOWFALL_SETTINGS } from './snowfall-config.js';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const random = (min, max) => min + Math.random() * (max - min);

// The screen is always measured in CSS pixels, not physical device pixels.
// Rotation changes the axis used for lateral drift without relying on a
// browser-specific screen-orientation permission.
export function windFromOrientation(beta, gamma, screenAngle = 0) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return 0;
  const angle = (Number(screenAngle) || 0) * Math.PI / 180;
  return clamp((gamma * Math.cos(angle) - beta * Math.sin(angle)) / 46, -1, 1);
}

// Project the direction of earthly gravity into the SCREEN PLANE. On a
// tilted/upright phone snow can move sideways or even toward the top edge.
// On a flat screen the projection is weak; use conventional downward snowfall.
export function gravityFromOrientation(beta, gamma, screenAngle = 0) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return { x: 0, y: 1 };
  const radians = Math.PI / 180;
  const gx = Math.sin(clamp(gamma, -90, 90) * radians) * 0.93;
  const gy = Math.sin(clamp(beta, -180, 180) * radians);
  const angle = (Number(screenAngle) || 0) * radians;
  const x = gx * Math.cos(angle) - gy * Math.sin(angle);
  const y = gx * Math.sin(angle) + gy * Math.cos(angle);
  const magnitude = Math.hypot(x, y);
  if (magnitude < 0.22) return { x: 0, y: 1 };
  return { x: x / magnitude, y: y / magnitude };
}

function makeFlake(width, height, settings, startAnywhere = false) {
  return {
    x: random(-12, width + 12),
    y: startAnywhere ? random(-height, height) : random(-height * 0.4 - 20, -8),
    radius: random(0.65, 1.22) * (0.95 + settings.size * 0.78),
    speed: random(28, 82),
    wind: random(-11, 11),
    alpha: random(0.45, 0.95),
    drift: random(0, TAU),
    shape: Math.random(),
    edge: null,
    edgeAge: 0,
    slide: Math.random() < 0.5 ? -1 : 1
  };
}

function paintFlake(ctx, flake, shape) {
  const r = flake.radius;
  if (shape === 'mixed') {
    shape = flake.shape < 0.57 ? 'soft' : flake.shape < 0.87 ? 'crystal' : 'star';
  }
  ctx.globalAlpha = flake.alpha;
  ctx.fillStyle = shape === 'soft' ? '#fff' : '#e3f5ff';
  ctx.strokeStyle = '#effaff';
  if (shape === 'soft') {
    ctx.beginPath();
    ctx.arc(flake.x, flake.y, r * 0.61, 0, TAU);
    ctx.fill();
    return;
  }
  if (shape === 'star') {
    const spikes = 6;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const a = -Math.PI / 2 + i * Math.PI / spikes;
      const reach = i % 2 === 0 ? r : r * 0.46;
      const x = flake.x + Math.cos(a) * reach;
      const y = flake.y + Math.sin(a) * reach;
      if (!i) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.lineWidth = clamp(r * 0.24, 0.7, 1.5);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = i * Math.PI / 3;
    const ux = Math.cos(angle), uy = Math.sin(angle);
    ctx.moveTo(flake.x, flake.y);
    ctx.lineTo(flake.x + ux * r, flake.y + uy * r);
    if (r > 3.3) {
      const bx = flake.x + ux * r * 0.59, by = flake.y + uy * r * 0.59;
      const side = r * 0.19;
      ctx.moveTo(bx + Math.cos(angle + 0.65) * side, by + Math.sin(angle + 0.65) * side);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle - 0.65) * side, by + Math.sin(angle - 0.65) * side);
    }
  }
  ctx.stroke();
}

// Surface geometry is read only. We never insert elements or change the
// site's photos, buttons, event handlers or scroll position.
export const SNOWBANK_SURFACE_SELECTOR = [
  '.header-book',
  '.hero-book',
  '.navtabs [role="tab"][data-state="active"]',
  '.stay-hero-photo',
  '.house-photo',
  '.house-gallery-card .house-gallery-photo',
  '.photo-thumbnails button',
  '.booking-card',
  'main button.primary',
  'main a.primary',
  'main .booking-card .primary'
].join(', ');

function bounding(element) {
  const r = element?.getBoundingClientRect?.();
  if (!r) return null;
  const left = Number(r.left), top = Number(r.top);
  const right = Number(r.right ?? (left + r.width));
  const bottom = Number(r.bottom ?? (top + r.height));
  if (![left, top, right, bottom].every(Number.isFinite)) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

// Browser getBoundingClientRect() may include a temporary elastic visual
// translation while iOS overscroll is active, even though scrollY is clamped
// at zero. Anchor snowbanks and image masks to layout offsets instead.
// These properties do not drift when Safari applies rubber-band scrolling.
export function stableDocumentRect(element, visibleRect, pageY = 0) {
  const rect = visibleRect || bounding(element);
  if (!rect) return null;
  const fallback = {
    left: rect.left, right: rect.right, top: rect.top + pageY,
    bottom: rect.bottom + pageY, width: rect.width, height: rect.height
  };
  let current = element;
  let left = 0, top = 0, depth = 0;
  if (!current || !Number.isFinite(current.offsetTop) ||
      !Number.isFinite(current.offsetLeft)) return fallback;
  do {
    left += current.offsetLeft;
    top += current.offsetTop;
    current = current.offsetParent;
    depth++;
  } while (current && depth < 32 &&
           Number.isFinite(current.offsetTop) &&
           Number.isFinite(current.offsetLeft));
  if (current || !Number.isFinite(top) || !Number.isFinite(left)) return fallback;
  return {
    left, right: left + rect.width, top, bottom: top + rect.height,
    width: rect.width, height: rect.height
  };
}

function intersects(rect, width, height, margin = 0) {
  return rect && rect.width > 0 && rect.height > 0 &&
    rect.right > -margin && rect.left < width + margin &&
    rect.bottom > -margin && rect.top < height + margin;
}

// Exported independently for tests. The photo mask is deliberately broader
// than snowbank targets: EVERY image is kept free of falling snow.
export function measureSnowScene(root, width, height, pageY = 0, buffer = 0) {
  const query = selector => Array.from(root.querySelectorAll?.(selector) || []);
  const masks = [];
  const surfaces = [];

  for (const element of query('img, video')) {
    const visible = bounding(element);
    if (!visible) continue;
    const doc = stableDocumentRect(element, visible, pageY);
    const pageViewport = { ...doc, top: doc.top - pageY, bottom: doc.bottom - pageY };
    if (!intersects(pageViewport, width, height, buffer + 4) ||
        doc.width < 12 || doc.height < 12) continue;
    // Both ends stay tied to document layout during Safari's elastic bounce.
    masks.push({
      left: Math.max(0, doc.left - 1),
      top: Math.max(pageY - buffer, doc.top - 1),
      right: Math.min(width, doc.right + 1),
      bottom: Math.min(pageY + height + buffer, doc.bottom + 1)
    });
  }

  for (const element of query(SNOWBANK_SURFACE_SELECTOR)) {
    if (surfaces.length >= 24) break;
    const visible = bounding(element);
    if (!visible) continue;
    const doc = stableDocumentRect(element, visible, pageY);
    const pageViewport = { ...doc, top: doc.top - pageY, bottom: doc.bottom - pageY };
    if (!intersects(pageViewport, width, height, buffer + 40) || doc.width < 80 ||
        doc.height < 25 || doc.height > height * 2.2) continue;
    if (element.closest?.('#owner-seasonal-snow, .house-gallery-lightbox')) continue;
    let radius = 0;
    try {
      const style = typeof window !== 'undefined' ? window.getComputedStyle?.(element) : null;
      if (style?.position === 'fixed' || style?.position === 'sticky') continue;
      radius = parseFloat(style?.borderTopLeftRadius) || 0;
    } catch {}
    const inset = clamp(Math.max(6, radius * 0.32), 6, Math.min(32, doc.width * 0.1));
    const left = Math.max(0, doc.left + inset);
    const right = Math.min(width, doc.right - inset);
    if (right - left < 50 || pageViewport.top < -buffer - 36 ||
        pageViewport.top > height + buffer + 36) continue;
    surfaces.push({ element, left, right, top: doc.top + 1 });
  }

  surfaces.sort((a, b) => a.top - b.top);
  return { masks, surfaces };
}

// Snow in this mode follows the page instead of looking painted on the glass.
// Modulo wraps very large scroll jumps so a quick swipe doesn't empty the sky.
export function scrolledSnowY(y, delta, height, margin = 30) {
  if (!Number.isFinite(y) || !Number.isFinite(delta) || !Number.isFinite(height) || height <= 0) return y;
  const span = height + margin * 2;
  return ((y - delta + margin) % span + span) % span - margin;
}

// Ordinary scrolls keep snow attached. A fast swipe must sustain speed over
// significant distance; single noisy events and elastic boundary pulls do not count.
export function classifySnowScroll(previous, position, time) {
  const y = Number.isFinite(position) ? position : 0;
  const now = Number.isFinite(time) ? time : 0;
  const start = { position: y, time: now, fastTravel: 0, direction: 0, armed: true, lastShake: -Infinity };
  if (!previous || !Number.isFinite(previous.position) || !Number.isFinite(previous.time)) {
    return { state: start, shake: false, speed: 0, delta: 0 };
  }
  const delta = y - previous.position;
  const elapsed = now - previous.time;
  const lastShake = Number.isFinite(previous.lastShake) ? previous.lastShake : -Infinity;
  if (elapsed < 6 || elapsed > 240 || !Number.isFinite(delta)) {
    return { state: { ...start, lastShake }, shake: false, speed: 0, delta: 0 };
  }
  const direction = Math.abs(delta) >= 0.5 ? Math.sign(delta) : previous.direction;
  const speed = Math.abs(delta) * 1000 / elapsed;
  let armed = previous.armed !== false;
  if ((previous.direction !== 0 && direction !== previous.direction) || speed < 750) armed = true;
  const fastTravel = speed >= 1000
    ? Math.min(600, (previous.direction === direction ? previous.fastTravel || 0 : 0) + Math.abs(delta))
    : 0;
  const shake = armed && speed >= 1700 && fastTravel >= 115 && now - lastShake >= 650;
  return {
    state: { position: y, time: now, fastTravel, direction,
      armed: shake ? false : armed, lastShake: shake ? now : lastShake },
    shake, speed, delta
  };
}

const BANK_BINS = 19;
const BANK_LIMIT = 38;
const MAX_CHUNKS = 12;
const MAX_CRUMBS = 48;

function makeBank(geometry) {
  return {
    geometry,
    depths: new Float32Array(BANK_BINS),
    noise: Array.from({ length: BANK_BINS }, () => random(0.78, 1.24)),
    cooldown: random(0, 4),
    age: 0
  };
}

function bankDepth(bank, x) {
  const g = bank.geometry;
  if (!g || g.right <= g.left) return 0;
  const index = clamp((x - g.left) / (g.right - g.left) * (BANK_BINS - 1), 0, BANK_BINS - 1);
  const first = Math.floor(index), next = Math.min(BANK_BINS - 1, first + 1);
  const frac = index - first;
  return bank.depths[first] * (1 - frac) + bank.depths[next] * frac;
}

function deposit(bank, x, amount) {
  const { left, right } = bank.geometry;
  if (right <= left) return;
  const center = (x - left) / (right - left) * (BANK_BINS - 1);
  for (let i = 0; i < BANK_BINS; i++) {
    const distance = Math.abs(i - center);
    if (distance < 2.4) {
      bank.depths[i] = Math.min(BANK_LIMIT, bank.depths[i] + amount * Math.max(0, 1 - distance / 2.4));
    }
  }
}

function growBank(bank, dt, settings, chunks, gravity, crumbs) {
  bank.age += dt;
  bank.cooldown = Math.max(0, bank.cooldown - dt);
  const rate = 0.64 * clamp(settings.count / 70, 0.2, 2.3) *
    Math.sqrt(settings.speed) * (0.72 + settings.size * 0.062);
  let peak = 0, peakAt = 0;
  for (let i = 0; i < BANK_BINS; i++) {
    const envelope = Math.pow(Math.max(0, Math.sin(Math.PI * i / (BANK_BINS - 1))), 0.46);
    bank.depths[i] = Math.min(BANK_LIMIT,
      bank.depths[i] + dt * rate * envelope * bank.noise[i]);
    if (bank.depths[i] > peak) {
      peak = bank.depths[i];
      peakAt = i;
    }
  }
  const threshold = 29 + Math.min(5, (bank.geometry.right - bank.geometry.left) * 0.013);
  if (bank.cooldown || peak < threshold || chunks.length >= MAX_CHUNKS || gravity.y < 0.27) return;

  // One loaded patch breaks loose. The rest of the snowbank stays and can
  // accumulate again, rather than the whole site abruptly losing its snow.
  const ratio = peakAt / (BANK_BINS - 1);
  const start = bank.geometry.left + ratio * (bank.geometry.right - bank.geometry.left);
  const dir = Math.abs(gravity.x) > 0.2 ? Math.sign(gravity.x) :
    (ratio > 0.52 ? 1 : ratio < 0.48 ? -1 : (Math.random() < 0.5 ? -1 : 1));
  const mass = clamp(peak * 0.47, 9, 18);
  for (let i = 0; i < BANK_BINS; i++) {
    const distance = Math.abs(i - peakAt);
    const loss = mass * Math.max(0, 1 - distance / 5);
    bank.depths[i] = Math.max(0, bank.depths[i] - loss);
  }
  chunks.push({
    x: start, y: bank.geometry.top - peak, radius: mass * 0.75,
    vx: dir * random(105, 150), vy: 0, bank, onEdge: true, age: 0, debrisAt: 0
  });
  bank.cooldown = random(10, 16);
  // Small crystals detach as the first layer starts moving.
  for (let i = 0; i < 4 && crumbs.length < MAX_CRUMBS; i++) {
    crumbs.push({
      x: start + random(-9, 9), y: bank.geometry.top - peak + random(-5, 5),
      vx: dir * random(12, 80), vy: random(-45, 5),
      radius: random(0.8, 2.8), life: random(0.65, 1.6)
    });
  }
}

// A rapid swipe knocks snow from visible ledges into actual falling chunks.
// Existing bank objects survive, so regular snowfall gradually rebuilds them.
export function shedSnowbanks(banks, pageTop, viewHeight, scrollDelta, chunks, crumbs, force = 1) {
  if (!Array.isArray(banks) || !Array.isArray(chunks) || !Array.isArray(crumbs)) return 0;
  const amount = 0.68 + 0.2 * clamp(Number.isFinite(force) ? force : 1, 0.5, 1);
  const direction = scrollDelta > 0 ? 1 : -1;
  let affected = 0;
  for (const bank of banks) {
    const g = bank?.geometry;
    if (!g || g.right <= g.left || !bank.depths?.length ||
        g.top < pageTop - 34 || g.top > pageTop + viewHeight + 34) continue;
    const peak = Math.max(...bank.depths);
    if (peak < 1.3) continue;
    affected++;
    const before = Array.from(bank.depths);
    for (let i = 0; i < bank.depths.length; i++) bank.depths[i] *= 1 - amount;
    bank.cooldown = Math.max(3, bank.cooldown || 0);
    const sections = clamp(Math.ceil((g.right - g.left) / 150), 1, 3);
    for (let i = 0; i < sections && chunks.length < MAX_CHUNKS; i++) {
      const fraction = (i + 0.4 + Math.random() * 0.2) / sections;
      const index = clamp(Math.floor(fraction * (BANK_BINS - 1)), 0, BANK_BINS - 1);
      const depth = before[index];
      if (depth < 3) continue;
      chunks.push({
        x: g.left + fraction * (g.right - g.left), y: g.top - depth,
        radius: clamp(depth * 0.44, 2.3, 11),
        vx: random(-56, 56) + direction * random(8, 38),
        vy: random(-115, -30), bank, onEdge: false, age: 0, debrisAt: 0
      });
    }
    for (let i = 0; i < 7 && crumbs.length < MAX_CRUMBS; i++) {
      const fraction = Math.random();
      const index = clamp(Math.floor(fraction * (BANK_BINS - 1)), 0, BANK_BINS - 1);
      const depth = before[index];
      if (depth < 1) continue;
      crumbs.push({
        x: g.left + fraction * (g.right - g.left), y: g.top - depth,
        vx: random(-85, 85) + direction * random(8, 46),
        vy: random(-130, -10), radius: random(0.7, clamp(depth * 0.28, 1.1, 3.8)),
        life: random(0.9, 1.7)
      });
    }
  }
  return affected;
}

// A decorative tap is detected only within a real, sufficiently thick
// snow-cap silhouette. The canvas itself stays pointer-events:none, so normal
// links, booking buttons, scrolling and forms keep all native interactions.
// Deliberate stationary tap only. Swipes, long holds and multi-touch must not
// interfere with native scrolling or the site's buttons and booking forms.
export function isSnowTapGesture(start, finish, pageScroll, time) {
  if (!start || !finish || !Number.isFinite(start.x) ||
      !Number.isFinite(start.y) || !Number.isFinite(start.time) ||
      !Number.isFinite(start.scroll) || !Number.isFinite(finish.x) ||
      !Number.isFinite(finish.y) || !Number.isFinite(pageScroll) ||
      !Number.isFinite(time) || time < start.time || time - start.time > 520) return false;
  if (finish.id !== start.id) return false;
  if (Math.hypot(finish.x - start.x, finish.y - start.y) > 12) return false;
  return Math.abs(pageScroll - start.scroll) < 4;
}

export function burstSnowbankAt(banks, x, pageY, chunks, crumbs) {
  if (!Array.isArray(banks) || !Array.isArray(chunks) ||
      !Array.isArray(crumbs) || !Number.isFinite(x) ||
      !Number.isFinite(pageY)) return false;

  for (const bank of banks) {
    const g = bank?.geometry;
    if (!g || !bank.depths?.length || g.right <= g.left ||
        x < g.left || x > g.right) continue;
    const depth = bankDepth(bank, x);
    const peak = Math.max(...bank.depths);
    // Require visibly accumulated snow. A small finger-sized margin makes
    // the thin white ledge tappable on mobile without covering whole buttons.
    if (peak < 10 || depth < 7 ||
        pageY < g.top - depth - 12 || pageY > g.top + 10) continue;

    const previous = Array.from(bank.depths);
    const strength = clamp(peak / 22, 0.65, 1.7);
    // Remove most (not every pixel) of this one bank. Natural snowfall
    // immediately begins building it back up after the touch.
    for (let i = 0; i < bank.depths.length; i++) {
      bank.depths[i] = previous[i] * 0.1;
    }
    bank.cooldown = Math.max(2.0, bank.cooldown || 0);

    const reach = Math.min((g.right - g.left) * 0.43, 62);
    const chunkCount = clamp(Math.round(peak / 5), 3, 7);
    for (let i = 0; i < chunkCount && chunks.length < MAX_CHUNKS; i++) {
      const px = clamp(x + random(-reach, reach), g.left + 2, g.right - 2);
      const fraction = (px - g.left) / (g.right - g.left);
      const index = clamp(Math.round(fraction * (previous.length - 1)), 0, previous.length - 1);
      const snow = previous[index];
      if (snow < 3) continue;
      chunks.push({
        x: px, y: g.top - snow,
        radius: clamp(random(2.2, 5.1) * strength, 2.3, 9),
        vx: (px - x) * random(1.0, 1.8) + random(-55, 55),
        vy: -random(35, 120) * strength,
        bank, onEdge: false, age: 0, debrisAt: 0
      });
    }

    for (let i = 0; i < 16 && crumbs.length < MAX_CRUMBS; i++) {
      const px = clamp(x + random(-reach, reach), g.left + 1, g.right - 1);
      const fraction = (px - g.left) / (g.right - g.left);
      const index = clamp(Math.round(fraction * (previous.length - 1)), 0, previous.length - 1);
      const snow = previous[index];
      if (snow < 1.4) continue;
      crumbs.push({
        x: px, y: g.top - snow + random(-3, 2),
        vx: (px - x) * random(0.8, 2.1) + random(-65, 65),
        vy: -random(32, 155) * strength,
        radius: random(0.8, clamp(snow * 0.24, 1.5, 3.8)),
        life: random(0.8, 1.65)
      });
    }
    return true;
  }
  return false;
}

function drawBank(ctx, bank) {
  const g = bank.geometry;
  const peak = Math.max(...bank.depths);
  if (!g || peak < 0.5) return;
  const step = (g.right - g.left) / (BANK_BINS - 1);
  ctx.save();
  ctx.globalAlpha = 0.97;
  ctx.shadowColor = 'rgba(196, 223, 239, .34)';
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 2;
  if (ctx.createLinearGradient) {
    const gradient = ctx.createLinearGradient(0, g.top - peak - 5, 0, g.top + 2);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.62, '#f5fcff');
    gradient.addColorStop(1, '#c9e4f0');
    ctx.fillStyle = gradient;
  } else ctx.fillStyle = '#f9fdff';
  ctx.beginPath();
  ctx.moveTo(g.left, g.top + 2);
  ctx.lineTo(g.left, g.top - bank.depths[0]);
  let prevX = g.left, prevY = g.top - bank.depths[0];
  for (let i = 1; i < BANK_BINS; i++) {
    const x = g.left + step * i;
    const y = g.top - bank.depths[i];
    ctx.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
    prevX = x; prevY = y;
  }
  ctx.lineTo(prevX, prevY);
  ctx.lineTo(g.right, g.top + 2);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function paintChunk(ctx, chunk) {
  const r = chunk.radius;
  ctx.save();
  ctx.globalAlpha = clamp(1 - Math.max(0, chunk.age - 4.5) / 1.2, 0, 0.98);
  ctx.fillStyle = '#f9fdff';
  ctx.shadowColor = 'rgba(200,231,247,.33)';
  ctx.shadowBlur = 6;
  ctx.beginPath();
  ctx.arc(chunk.x - r * 0.32, chunk.y, r * 0.67, 0, TAU);
  ctx.arc(chunk.x + r * 0.25, chunk.y - r * 0.17, r * 0.72, 0, TAU);
  ctx.arc(chunk.x + r * 0.5, chunk.y + r * 0.2, r * 0.42, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function photoClip(ctx, masks, width, height, originY = 0) {
  if (!masks.length || typeof ctx.clip !== 'function') return false;
  ctx.beginPath();
  ctx.rect(0, originY, width, height);
  for (const r of masks) {
    if (r.right > r.left && r.bottom > r.top) {
      ctx.rect(r.left, r.top, r.right - r.left, r.bottom - r.top);
    }
  }
  ctx.clip('evenodd');
  return true;
}

function flakeOverPhoto(x, y, radius, masks) {
  return masks.some(rect =>
    x + radius >= rect.left && x - radius <= rect.right &&
    y + radius >= rect.top && y - radius <= rect.bottom);
}

// Standalone artist; only its own canvas is touched. The feature can be
// switched off immediately without affecting bookings, forms or navigation.
export function createSnowfallStage(canvas, initialSettings = DEFAULT_SNOWFALL_SETTINGS, options = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { update() {}, setWind() {}, setGravity() {}, destroy() {} };

  const preview = options.preview === true;
  const collide = options.collide === true && !preview;
  const reduceMotion = typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let settings = { ...DEFAULT_SNOWFALL_SETTINGS, ...initialSettings };
  let width = 0, height = 0, frame = 0, lastFrame = 0, removed = false;
  let flakes = [], activeBanks = [], photoMasks = [], chunks = [], crumbs = [];
  let bankStore = new WeakMap();
  let gravity = { x: 0, y: 1 }, desiredGravity = { x: 0, y: 1 };
  let sceneDirty = true, lastScan = 0;
  const maxFps = preview ? 30 : 40;

  function scrollPosition() {
    return Number.isFinite(window.scrollY) ? window.scrollY :
      (Number.isFinite(window.pageYOffset) ? window.pageYOffset :
        Number(document.documentElement?.scrollTop) || 0);
  }
  let lastScrollY = preview ? 0 : scrollPosition();

  function syncFlakes() {
    const viewportScale = clamp(Math.sqrt((width * height) / 850000), 0.45, 1.35);
    const target = preview
      ? clamp(Math.round(settings.count * 0.35), 8, 48)
      : clamp(Math.round(settings.count * viewportScale), 10, width < 700 ? 95 : 160);
    while (flakes.length > target) flakes.pop();
    while (flakes.length < target) flakes.push(makeFlake(width, height, settings, true));
  }

  function resize() {
    if (removed) return;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    syncFlakes();
    sceneDirty = true;
  }

  function updateScene(time) {
    if (preview || !sceneDirty && time - lastScan < 440) return;
    const geometry = measureSnowScene(document, width, height);
    photoMasks = geometry.masks;
    activeBanks = [];
    if (collide && settings.interaction) {
      for (const item of geometry.surfaces) {
        let bank = bankStore.get(item.element);
        if (!bank) {
          bank = makeBank(item);
          bankStore.set(item.element, bank);
        }
        bank.geometry = item;
        activeBanks.push(bank);
      }
    }
    lastScan = time;
    sceneDirty = false;
  }

  function advanceScroll() {
    if (preview) return;
    const position = scrollPosition();
    const delta = position - lastScrollY;
    lastScrollY = position;
    if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;
    for (const flake of flakes) {
      flake.y = scrolledSnowY(flake.y, delta, height);
      flake.edge = null;
    }
    for (const chunk of chunks) {
      if (!chunk.onEdge) chunk.y -= delta;
    }
    for (const crumb of crumbs) crumb.y -= delta;
    sceneDirty = true;
  }

  function moveFlake(flake, dt, time) {
    if (flake.edge) {
      const bank = flake.edge;
      const ledge = bank.geometry;
      const push = Math.abs(gravity.x) > 0.2 ? Math.sign(gravity.x) : flake.slide;
      flake.x += push * (19 + flake.speed * 0.22) * settings.speed * dt;
      flake.y = ledge.top - bankDepth(bank, flake.x) - flake.radius * 0.75;
      flake.edgeAge += dt;
      if (flake.x < ledge.left || flake.x > ledge.right || flake.edgeAge > 1.25) {
        flake.edge = null;
        flake.edgeAge = 0;
      } else return;
    }

    const oldY = flake.y;
    const fall = flake.speed * settings.speed;
    const gust = Math.sin(time * 0.00067 + flake.drift) * 12;
    flake.x += (flake.wind + gust + gravity.x * fall * 0.9) * dt;
    flake.y += gravity.y * fall * dt;

    if (collide && settings.interaction && gravity.y > 0.25 && flake.y > oldY) {
      for (const bank of activeBanks) {
        const ledge = bank.geometry;
        const top = ledge.top - bankDepth(bank, flake.x);
        if (flake.x > ledge.left && flake.x < ledge.right &&
            oldY + flake.radius <= top &&
            flake.y + flake.radius >= top) {
          deposit(bank, flake.x, random(0.7, 1.5));
          flake.edge = bank;
          flake.edgeAge = 0;
          flake.y = top - flake.radius;
          break;
        }
      }
    }

    const margin = 28;
    if (flake.y > height + margin) {
      Object.assign(flake, makeFlake(width, height, settings));
    } else if (flake.y < -margin && gravity.y < -0.05) {
      flake.y = height + margin;
    } else if (flake.x < -margin) {
      flake.x = width + margin;
    } else if (flake.x > width + margin) {
      flake.x = -margin;
    }
  }

  function moveDebris(dt) {
    for (let i = chunks.length - 1; i >= 0; i--) {
      const chunk = chunks[i];
      chunk.age += dt;
      if (chunk.onEdge) {
        chunk.x += chunk.vx * dt;
        const g = chunk.bank.geometry;
        chunk.y = g.top - bankDepth(chunk.bank, chunk.x) - chunk.radius * 0.58;
        if (chunk.x <= g.left || chunk.x >= g.right || chunk.age > 3) {
          chunk.onEdge = false;
          chunk.vy = 30;
          for (let j = 0; j < 9 && crumbs.length < MAX_CRUMBS; j++) {
            crumbs.push({
              x: chunk.x + random(-9, 9), y: chunk.y + random(-5, 5),
              vx: chunk.vx * random(0.35, 1.2),
              vy: random(-65, 10), radius: random(0.9, 3.6),
              life: random(0.6, 1.7)
            });
          }
        }
      } else {
        chunk.x += chunk.vx * dt;
        chunk.vy += (300 + Math.abs(gravity.y) * 140) * dt;
        chunk.y += chunk.vy * dt;
      }
      if (chunk.age > 5.7 || chunk.y > height + 60 || chunk.x < -70 || chunk.x > width + 70) {
        chunks.splice(i, 1);
      }
    }
    for (let i = crumbs.length - 1; i >= 0; i--) {
      const p = crumbs[i];
      p.x += p.vx * dt;
      p.vy += 420 * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y > height + 15) crumbs.splice(i, 1);
    }
  }

  function drawScene(time) {
    ctx.clearRect(0, 0, width, height);
    if (!preview && typeof document.querySelector === 'function' &&
        document.querySelector('.house-gallery-lightbox,[role="dialog"][aria-modal="true"]')) {
      return; // Never snow over an expanded photograph or modal.
    }
    ctx.save();
    const clipped = photoClip(ctx, photoMasks, width, height);
    for (const flake of flakes) {
      if (!clipped && flakeOverPhoto(flake.x, flake.y, flake.radius, photoMasks)) continue;
      paintFlake(ctx, flake, settings.shape);
    }
    for (const p of crumbs) {
      if (!clipped && flakeOverPhoto(p.x, p.y, p.radius, photoMasks)) continue;
      ctx.globalAlpha = clamp(p.life, 0, 0.92);
      ctx.fillStyle = '#f4fdff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, TAU);
      ctx.fill();
    }
    for (const chunk of chunks) {
      if (!clipped && flakeOverPhoto(chunk.x, chunk.y, chunk.radius, photoMasks)) continue;
      paintChunk(ctx, chunk);
    }
    for (const bank of activeBanks) drawBank(ctx, bank);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function tick(time) {
    if (removed) return;
    frame = requestAnimationFrame(tick);
    if (document.hidden || reduceMotion) return;
    advanceScroll();
    if (!lastFrame) {
      lastFrame = time;
      updateScene(time);
      return;
    }
    const elapsed = time - lastFrame;
    if (elapsed < 1000 / (width < 700 ? 32 : maxFps)) return;
    const dt = clamp(elapsed / 1000, 0, 0.05);
    lastFrame = time;
    updateScene(time);
    gravity.x += (desiredGravity.x - gravity.x) * Math.min(1, dt * 2.6);
    gravity.y += (desiredGravity.y - gravity.y) * Math.min(1, dt * 2.6);
    for (const flake of flakes) moveFlake(flake, dt, time);
    if (collide && settings.interaction && gravity.y > 0.25) {
      for (const bank of activeBanks) growBank(bank, dt, settings, chunks, gravity, crumbs);
    }
    moveDebris(dt);
    drawScene(time);
  }

  function update(next) {
    if (removed) return;
    const oldSize = settings.size;
    const previousInteraction = settings.interaction;
    settings = { ...settings, ...next };
    if (settings.size !== oldSize) {
      for (const flake of flakes) {
        flake.radius *= (0.95 + settings.size * 0.78) / (0.95 + oldSize * 0.78);
      }
    }
    syncFlakes();
    if (!settings.interaction) {
      activeBanks = [];
      chunks = [];
      crumbs = [];
      for (const flake of flakes) flake.edge = null;
    } else if (!previousInteraction) {
      bankStore = new WeakMap();
      sceneDirty = true;
    }
  }

  function setGravity(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      desiredGravity = { x: 0, y: 1 };
      return;
    }
    const magnitude = Math.hypot(x, y);
    desiredGravity = magnitude >= 0.15
      ? { x: x / magnitude, y: y / magnitude }
      : { x: 0, y: 1 };
  }

  function setWind(value) {
    const x = Number.isFinite(value) ? clamp(value * 0.75, -0.75, 0.75) : 0;
    setGravity(x, Math.sqrt(1 - x * x));
  }

  const onResize = () => resize();
  const onScroll = () => {
    if (!preview) advanceScroll();
  };
  window.addEventListener('resize', onResize, { passive: true });
  if (!preview) window.addEventListener('scroll', onScroll, { passive: true });
  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      if (Math.abs(rect.width - width) > 1 || Math.abs(rect.height - height) > 1) resize();
    }) : null;
  resizeObserver?.observe(canvas);
  resize();
  if (!reduceMotion) frame = requestAnimationFrame(tick);

  return {
    update,
    setWind,
    setGravity,
    destroy() {
      removed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      if (!preview) window.removeEventListener('scroll', onScroll);
      resizeObserver?.disconnect();
      flakes = [];
      activeBanks = [];
      photoMasks = [];
      chunks = [];
      crumbs = [];
      ctx.clearRect(0, 0, width, height);
    }
  };
}

// The live site uses DOCUMENT-ANCHORED canvas tiles. Safari/Chrome composite
// these exactly with ordinary page content during async/inertial scrolling.
// No scroll event or animation frame is ever needed to move painted snow.
export function createDocumentSnowfallStage(root, initialSettings = DEFAULT_SNOWFALL_SETTINGS, options = {}) {
  const NOOP = { update() {}, setWind() {}, setGravity() {}, destroy() {} };
  if (!root || typeof document === 'undefined' || typeof window === 'undefined') return NOOP;
  const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const collide = options.collide === true;
  const TILE_HEIGHT = 768; // Stable across Safari address-bar collapse/expansion.
  const POOL_SIZE = 7; // 2-3 screens of compositor-owned coverage around viewport.
  const MAX_CRUMB_COUNT = 48;
  const layers = [];
  let settings = { ...DEFAULT_SNOWFALL_SETTINGS, ...initialSettings };
  let width = 1, viewHeight = 1, pixelRatio = 1, pageHeight = 1;
  let flakes = [], chunks = [], crumbs = [], photoMasks = [], activeBanks = [];
  let bankStore = new WeakMap();
  let frame = 0, previousTime = 0, lastScan = 0, removed = false, sceneDirty = true;
  let gravity = { x: 0, y: 1 }, targetGravity = { x: 0, y: 1 };
  const fps = 32; // Only snow FALLING updates at 32 fps; scroll never waits.
  const clock = () => window.performance?.now?.() ?? Date.now();
  let scrollMotion = null;
  let tapStart = null;

  const onPointerDown = event => {
    if (removed || !collide || !settings.interaction || document.hidden ||
        event.isPrimary === false || event.button !== 0 ||
        !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      tapStart = null;
      return;
    }
    tapStart = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      time: clock(), scroll: viewportTop()
    };
  };

  const onPointerMove = event => {
    if (!tapStart || tapStart.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) > 12) {
      tapStart = null;
    }
  };

  const onPointerUp = event => {
    const start = tapStart;
    tapStart = null;
    if (removed || !collide || !settings.interaction || document.hidden ||
        !isSnowTapGesture(start, {
          id: event.pointerId, x: event.clientX, y: event.clientY
        }, viewportTop(), clock())) return;
    // Most taps are ordinary UI interactions. Avoid a DOM geometry scan
    // unless the pointer was actually near a currently drawn snowcap.
    const pageY = event.clientY + viewportTop();
    const nearSnow = activeBanks.some(bank => {
      const g = bank?.geometry;
      return g && event.clientX >= g.left && event.clientX <= g.right &&
        pageY >= g.top - 54 && pageY <= g.top + 11;
    });
    if (!nearSnow) return;
    // Re-read the snowbank positions if layout changed since the last frame.
    // Pointer position is in page CSS coordinates, exactly like the tiles.
    syncScene(clock());
    burstSnowbankAt(activeBanks, event.clientX, pageY, chunks, crumbs);
    // Never call preventDefault, stopPropagation or change pointer capture.
    // The original underlying button/link receives its normal click.
  };

  const onPointerCancel = () => { tapStart = null; };

  const onScroll = () => {
    if (removed) return;
    tapStart = null; // Scrolling must never be interpreted as tapping a snowbank.
    sceneDirty = true;
    syncTiles();
    const movement = classifySnowScroll(scrollMotion, viewportTop(), clock());
    scrollMotion = movement.state;
    if (!movement.shake || !collide || !settings.interaction || document.hidden) return;
    syncScene(movement.state.time);
    shedSnowbanks(
      activeBanks, viewportTop(), viewHeight, movement.delta,
      chunks, crumbs, clamp(movement.speed / 3200, 0.5, 1)
    );
  };
  const onResize = () => {
    if (removed) return;
    tapStart = null;
    resize();
    // Safari's disappearing address bar must not trigger a fake shake.
    scrollMotion = classifySnowScroll(null, viewportTop(), clock()).state;
  };

  const viewportTop = () => {
    const y = Number.isFinite(window.scrollY) ? window.scrollY :
      (Number.isFinite(window.pageYOffset) ? window.pageYOffset :
        Number(document.documentElement?.scrollTop) || 0);
    return Math.max(0, y);
  };

  // Canvas positions are document coordinates, not viewport coordinates.
  // Existing visible tiles retain both their DOM position and painted bitmap
  // while new far-offscreen tiles are recycled.
  function syncTiles() {
    const first = Math.max(0, Math.floor(viewportTop() / TILE_HEIGHT) - 2);
    const wanted = new Set();
    for (let i = 0; i < POOL_SIZE; i++) wanted.add(first + i);
    for (const index of wanted) {
      if (layers.some(item => item.index === index)) continue;
      const available = layers.find(item => !wanted.has(item.index));
      if (!available) continue;
      available.index = index;
      available.top = index * TILE_HEIGHT;
      available.canvas.style.top = available.top + 'px';
      available.canvas.style.visibility = 'hidden';
      available.ready = false;
    }
  }

  function countFlakes() {
    const scale = clamp(Math.sqrt((width * viewHeight) / 850000), 0.45, 1.35);
    return clamp(Math.round(settings.count * scale * 5), 50, width < 700 ? 320 : 460);
  }

  function newWorldFlake() {
    const flake = makeFlake(width, viewHeight, settings, true);
    const y = viewportTop();
    flake.y = random(y - viewHeight * 1.4, y + viewHeight * 3.8);
    return flake;
  }

  function syncFlakes() {
    const target = countFlakes();
    while (flakes.length < target) flakes.push(newWorldFlake());
    while (flakes.length > target) flakes.pop();
  }

  // Absolutely positioned canvases must NOT increase the site's scroll height.
  // Measure real page content, then clip the decorative root to its bottom.
  function updatePageBounds() {
    const position = viewportTop();
    let bottom = viewHeight;
    for (const selector of ['main', 'footer']) {
      const element = document.querySelector?.(selector);
      const rect = bounding(element);
      const doc = stableDocumentRect(element, rect, position);
      if (Number.isFinite(doc?.bottom)) {
        bottom = Math.max(bottom, doc.bottom);
      }
    }
    if (bottom <= viewHeight + 1) {
      // Safe fallback on unexpected pages. Ignore the decorative root itself.
      bottom = Math.max(bottom, document.body?.offsetHeight || 0);
    }
    pageHeight = Math.ceil(bottom);
    root.style.height = pageHeight + 'px';
  }

  function resize() {
    const docWidth = document.documentElement?.clientWidth || window.innerWidth || 375;
    const nextWidth = Math.max(1, Math.round(Math.min(window.innerWidth || docWidth, docWidth + 2)));
    const nextHeight = Math.max(1, Math.round(window.innerHeight || document.documentElement?.clientHeight || 700));
    const nextRatio = clamp(window.devicePixelRatio || 1, 1, nextWidth < 700 ? 1.5 : 1.25);
    const changed = nextWidth !== width || Math.abs(nextRatio - pixelRatio) > 0.01;
    width = nextWidth;
    viewHeight = nextHeight;
    pixelRatio = nextRatio;
    if (changed) {
      for (const tile of layers) {
        tile.canvas.style.width = width + 'px';
        tile.canvas.width = Math.round(width * pixelRatio);
        tile.canvas.height = Math.round(TILE_HEIGHT * pixelRatio);
        tile.ready = false;
      }
    }
    sceneDirty = true;
    updatePageBounds();
    syncFlakes();
    syncTiles();
  }

  for (let i = 0; i < POOL_SIZE; i++) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'absolute', left: '0', top: '0', width: '100%',
      height: TILE_HEIGHT + 'px', pointerEvents: 'none',
      visibility: 'hidden', display: 'block'
    });
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      canvas.remove();
      for (const tile of layers) tile.canvas.remove();
      return NOOP;
    }
    root.append(canvas);
    layers.push({ canvas, ctx, index: -i - 1, top: 0, ready: false });
  }

  function syncScene(time) {
    if (!sceneDirty && time - lastScan < 550) return;
    const pageTop = viewportTop();
    // Mask every visible/soon-visible photo, even those that do NOT collect snow.
    updatePageBounds();
    // Always mask the entire document, including photos below the next swipe.
    const scene = measureSnowScene(document, width, viewHeight, pageTop, pageHeight + viewHeight);
    photoMasks = scene.masks;
    activeBanks = [];
    if (collide && settings.interaction) {
      for (const geometry of scene.surfaces) {
        let bank = bankStore.get(geometry.element);
        if (!bank) {
          bank = makeBank(geometry);
          bankStore.set(geometry.element, bank);
        }
        bank.geometry = geometry; // Page Y remains fixed across scroll frames.
        activeBanks.push(bank);
      }
    }
    sceneDirty = false;
    lastScan = time;
  }

  function moveFlakes(dt, time) {
    const top = viewportTop();
    const lowest = top - viewHeight * 2.0;
    const highest = top + viewHeight * 5.0;
    for (const flake of flakes) {
      if (flake.edge) {
        const bank = flake.edge;
        const ledge = bank.geometry;
        const push = Math.abs(gravity.x) > 0.2 ? Math.sign(gravity.x) : flake.slide;
        flake.x += push * (19 + flake.speed * 0.22) * settings.speed * dt;
        flake.y = ledge.top - bankDepth(bank, flake.x) - flake.radius * 0.75;
        flake.edgeAge += dt;
        if (flake.x < ledge.left || flake.x > ledge.right || flake.edgeAge > 1.25) {
          flake.edge = null;
          flake.edgeAge = 0;
        } else continue;
      }

      const previousY = flake.y;
      const fall = flake.speed * settings.speed;
      const gust = Math.sin(time * 0.00067 + flake.drift) * 12;
      flake.x += (flake.wind + gust + gravity.x * fall * 0.9) * dt;
      flake.y += gravity.y * fall * dt;

      if (collide && settings.interaction && gravity.y > 0.25 &&
          previousY < top + viewHeight + 70 && flake.y > top - 70 &&
          flake.y > previousY) {
        for (const bank of activeBanks) {
          const ledge = bank.geometry;
          if (ledge.top < top - 50 || ledge.top > top + viewHeight + 50) continue;
          const surfaceY = ledge.top - bankDepth(bank, flake.x);
          if (flake.x > ledge.left && flake.x < ledge.right &&
              previousY + flake.radius <= surfaceY &&
              flake.y + flake.radius >= surfaceY) {
            deposit(bank, flake.x, random(0.7, 1.5));
            flake.edge = bank;
            flake.edgeAge = 0;
            flake.y = surfaceY - flake.radius;
            break;
          }
        }
      }

      if (flake.y > highest || flake.y < lowest ||
          !Number.isFinite(flake.y)) {
        Object.assign(flake, newWorldFlake());
      }
      if (flake.x < -30) flake.x = width + 30;
      else if (flake.x > width + 30) flake.x = -30;
    }
  }

  function moveDebris(dt) {
    for (let i = chunks.length - 1; i >= 0; i--) {
      const chunk = chunks[i];
      chunk.age += dt;
      if (chunk.onEdge) {
        chunk.x += chunk.vx * dt;
        const g = chunk.bank.geometry;
        chunk.y = g.top - bankDepth(chunk.bank, chunk.x) - chunk.radius * 0.58;
        if (chunk.x <= g.left || chunk.x >= g.right || chunk.age > 3) {
          chunk.onEdge = false;
          chunk.vy = 30;
          for (let j = 0; j < 9 && crumbs.length < MAX_CRUMB_COUNT; j++) {
            crumbs.push({
              x: chunk.x + random(-9, 9), y: chunk.y + random(-5, 5),
              vx: chunk.vx * random(0.35, 1.2), vy: random(-65, 10),
              radius: random(0.9, 3.6), life: random(0.6, 1.7)
            });
          }
        }
      } else {
        chunk.x += chunk.vx * dt;
        chunk.vy += (300 + Math.abs(gravity.y) * 140) * dt;
        chunk.y += chunk.vy * dt;
      }
      if (chunk.age > 5.7 || chunk.y > viewportTop() + viewHeight * 2 ||
          chunk.y < viewportTop() - viewHeight * 2 ||
          chunk.x < -70 || chunk.x > width + 70) chunks.splice(i, 1);
    }
    for (let i = crumbs.length - 1; i >= 0; i--) {
      const crumb = crumbs[i];
      crumb.x += crumb.vx * dt;
      crumb.vy += 420 * dt;
      crumb.y += crumb.vy * dt;
      crumb.life -= dt;
      if (crumb.life <= 0 || crumb.y > viewportTop() + viewHeight * 2) {
        crumbs.splice(i, 1);
      }
    }
  }

  function drawTile(tile) {
    const { ctx, canvas, top } = tile;
    // Translating the drawing context DOES NOT move its DOM canvas. CSS keeps
    // the bitmap anchored in the document through async/inertial scrolling.
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, -top * pixelRatio);
    ctx.clearRect(0, top, width, TILE_HEIGHT);
    if (document.querySelector?.('.house-gallery-lightbox,[role="dialog"][aria-modal="true"]')) {
      canvas.style.visibility = 'hidden';
      return;
    }

    ctx.save();
    const clipped = photoClip(ctx, photoMasks, width, TILE_HEIGHT, top);
    for (const flake of flakes) {
      if (flake.y < top - 20 || flake.y > top + TILE_HEIGHT + 20) continue;
      if (!clipped && flakeOverPhoto(flake.x, flake.y, flake.radius, photoMasks)) continue;
      paintFlake(ctx, flake, settings.shape);
    }
    for (const crumb of crumbs) {
      if (crumb.y < top - 10 || crumb.y > top + TILE_HEIGHT + 10) continue;
      if (!clipped && flakeOverPhoto(crumb.x, crumb.y, crumb.radius, photoMasks)) continue;
      ctx.globalAlpha = clamp(crumb.life, 0, 0.92);
      ctx.fillStyle = '#f4fdff';
      ctx.beginPath();
      ctx.arc(crumb.x, crumb.y, crumb.radius, 0, TAU);
      ctx.fill();
    }
    for (const chunk of chunks) {
      if (chunk.y < top - 50 || chunk.y > top + TILE_HEIGHT + 50) continue;
      if (!clipped && flakeOverPhoto(chunk.x, chunk.y, chunk.radius, photoMasks)) continue;
      paintChunk(ctx, chunk);
    }
    if (settings.interaction && collide) {
      for (const bank of activeBanks) {
        if (bank.geometry.top >= top - 48 && bank.geometry.top <= top + TILE_HEIGHT + 3) {
          drawBank(ctx, bank);
        }
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (!tile.ready) {
      canvas.style.visibility = 'visible';
      tile.ready = true;
    }
  }

  function tick(time) {
    if (removed) return;
    frame = requestAnimationFrame(tick);
    if (document.hidden || reduceMotion) {
      previousTime = time; // Do not simulate minutes of motion after tab restore.
      return;
    }
    if (!previousTime) {
      previousTime = time;
      syncScene(time);
      syncTiles();
      return;
    }
    const elapsed = time - previousTime;
    if (elapsed < 1000 / fps) return;
    const dt = clamp(elapsed / 1000, 0, 0.05);
    previousTime = time;
    syncScene(time);
    syncTiles();
    gravity.x += (targetGravity.x - gravity.x) * Math.min(1, dt * 2.6);
    gravity.y += (targetGravity.y - gravity.y) * Math.min(1, dt * 2.6);
    moveFlakes(dt, time);
    if (collide && settings.interaction && gravity.y > 0.25) {
      const upper = viewportTop() - 48, lower = viewportTop() + viewHeight + 48;
      for (const bank of activeBanks) {
        if (bank.geometry.top >= upper && bank.geometry.top <= lower) {
          growBank(bank, dt, settings, chunks, gravity, crumbs);
        }
      }
    }
    moveDebris(dt);
    const firstVisible = Math.floor(viewportTop() / TILE_HEIGHT);
    const lastVisible = Math.floor((viewportTop() + viewHeight) / TILE_HEIGHT);
    // A native-scroll safety buffer stays painted before the user swipes.
    for (const tile of layers) {
      if (!tile.ready || (tile.index >= firstVisible - 2 && tile.index <= lastVisible + 2)) {
        drawTile(tile);
      }
    }
  }

  function update(next) {
    if (removed) return;
    const previousSize = settings.size;
    const previousInteraction = settings.interaction;
    settings = { ...settings, ...next };
    if (previousSize !== settings.size) {
      const ratio = (0.95 + settings.size * 0.78) / (0.95 + previousSize * 0.78);
      for (const flake of flakes) flake.radius *= ratio;
    }
    syncFlakes();
    if (!settings.interaction) {
      activeBanks = [];
      bankStore = new WeakMap();
      chunks = [];
      crumbs = [];
      for (const flake of flakes) flake.edge = null;
    } else if (!previousInteraction) {
      sceneDirty = true;
    }
  }

  function setGravity(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      targetGravity = { x: 0, y: 1 };
      return;
    }
    const length = Math.hypot(x, y);
    targetGravity = length >= 0.15
      ? { x: x / length, y: y / length }
      : { x: 0, y: 1 };
  }
  function setWind(value) {
    const x = Number.isFinite(value) ? clamp(value * 0.75, -0.75, 0.75) : 0;
    setGravity(x, Math.sqrt(1 - x * x));
  }

  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  // Only observe pointer events. The decorative canvas never catches clicks.
  document.addEventListener?.('pointerdown', onPointerDown, { capture: true, passive: true });
  document.addEventListener?.('pointermove', onPointerMove, { capture: true, passive: true });
  document.addEventListener?.('pointerup', onPointerUp, { capture: true, passive: true });
  document.addEventListener?.('pointercancel', onPointerCancel, { capture: true, passive: true });
  resize();
  scrollMotion = classifySnowScroll(null, viewportTop(), clock()).state;
  if (!reduceMotion) frame = requestAnimationFrame(tick);
  return {
    update, setGravity, setWind,
    destroy() {
      removed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener?.('pointerdown', onPointerDown, true);
      document.removeEventListener?.('pointermove', onPointerMove, true);
      document.removeEventListener?.('pointerup', onPointerUp, true);
      document.removeEventListener?.('pointercancel', onPointerCancel, true);
      tapStart = null;
      for (const tile of layers) tile.canvas.remove();
      layers.length = 0;
      flakes = [];
      chunks = [];
      crumbs = [];
      activeBanks = [];
      photoMasks = [];
    }
  };
}
