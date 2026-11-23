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

function visiblePhotoEdges(width, height) {
  if (typeof document === 'undefined') return [];
  const elements = document.querySelectorAll('.house-gallery-card .house-gallery-photo');
  const edges = [];
  for (const element of elements) {
    if (edges.length >= (width < 700 ? 2 : 4)) break;
    const rect = element.getBoundingClientRect();
    if (rect.width < 90 || rect.top < 25 || rect.top > height - 15 ||
        rect.right < 0 || rect.left > width) continue;
    edges.push({
      left: Math.max(0, rect.left + 12),
      right: Math.min(width, rect.right - 12),
      top: rect.top + 2
    });
  }
  return edges;
}

// Isolated painter: no DOM changes except its own canvas, no intercepted clicks,
// no new dependencies, and a bounded number of particles on every device.
export function createSnowfallStage(canvas, initialSettings = DEFAULT_SNOWFALL_SETTINGS, options = {}) {
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return { update() {}, setWind() {}, destroy() {} };

  const preview = options.preview === true;
  const collide = options.collide === true && !preview;
  const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let settings = { ...DEFAULT_SNOWFALL_SETTINGS, ...initialSettings };
  let width = 0, height = 0, frame = 0, lastFrame = 0, lastEdges = 0, removed = false;
  let flakes = [], edges = [], wind = 0, targetWind = 0;
  const maxFps = preview ? 30 : width < 700 ? 32 : 40;

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
    edges = [];
    lastEdges = 0;
  }

  function syncFlakes() {
    const viewportScale = clamp(Math.sqrt((width * height) / 850000), 0.45, 1.35);
    const target = preview
      ? clamp(Math.round(settings.count * 0.35), 8, 48)
      : clamp(Math.round(settings.count * viewportScale), 10, width < 700 ? 95 : 160);
    while (flakes.length > target) flakes.pop();
    while (flakes.length < target) flakes.push(makeFlake(width, height, settings, true));
  }

  function releaseFromEdge(flake) {
    flake.edge = null;
    flake.edgeAge = 0;
    flake.y += flake.radius * 0.5;
  }

  function move(flake, dt, time) {
    if (flake.edge) {
      flake.edgeAge += dt;
      const speed = (27 + flake.speed * 0.34) * settings.speed;
      const push = Math.abs(wind) > 0.18 ? Math.sign(wind) : flake.slide;
      flake.x += push * speed * dt;
      flake.y = flake.edge.top - flake.radius * 0.72;
      if (flake.x < flake.edge.left || flake.x > flake.edge.right || flake.edgeAge > 1.8) {
        releaseFromEdge(flake);
      } else {
        return;
      }
    }

    const previousY = flake.y;
    const fall = flake.speed * settings.speed;
    const gust = Math.sin(time * 0.00067 + flake.drift) * 12;
    flake.x += (flake.wind + gust + wind * fall * 0.65) * dt;
    flake.y += fall * dt;

    if (settings.interaction && collide && edges.length &&
        previousY + flake.radius < flake.y + flake.radius) {
      for (const edge of edges) {
        if (previousY + flake.radius <= edge.top &&
            flake.y + flake.radius >= edge.top &&
            flake.x > edge.left && flake.x < edge.right) {
          flake.edge = edge;
          flake.edgeAge = 0;
          flake.y = edge.top - flake.radius * 0.72;
          break;
        }
      }
    }

    const margin = 22;
    if (flake.y > height + margin) {
      Object.assign(flake, makeFlake(width, height, settings));
    } else if (flake.x < -margin) {
      flake.x = width + margin;
    } else if (flake.x > width + margin) {
      flake.x = -margin;
    }
  }

  function tick(time) {
    if (removed) return;
    frame = requestAnimationFrame(tick);
    if (document.hidden || reduceMotion) return;
    if (!lastFrame) {
      lastFrame = time;
      return;
    }
    const elapsed = time - lastFrame;
    if (elapsed < 1000 / (width < 700 ? 32 : maxFps)) return;
    const dt = clamp(elapsed / 1000, 0, 0.05);
    lastFrame = time;
    if (collide && settings.interaction && time - lastEdges > 450) {
      edges = visiblePhotoEdges(width, height);
      lastEdges = time;
    }
    wind += (targetWind - wind) * Math.min(1, dt * 2.6);
    ctx.clearRect(0, 0, width, height);
    for (const flake of flakes) {
      move(flake, dt, time);
      paintFlake(ctx, flake, settings.shape);
    }
    ctx.globalAlpha = 1;
  }

  function update(next) {
    if (removed) return;
    const oldSize = settings.size;
    settings = { ...settings, ...next };
    if (settings.size !== oldSize) {
      for (const flake of flakes) {
        flake.radius *= (0.95 + settings.size * 0.78) / (0.95 + oldSize * 0.78);
      }
    }
    syncFlakes();
    if (!settings.interaction) {
      edges = [];
      flakes.forEach(flake => { if (flake.edge) releaseFromEdge(flake); });
    }
  }

  function setWind(value) {
    targetWind = Number.isFinite(value) ? clamp(value, -1, 1) : 0;
  }

  const onResize = () => resize();
  window.addEventListener('resize', onResize, { passive: true });
  resize();
  if (!reduceMotion) frame = requestAnimationFrame(tick);

  return {
    update,
    setWind,
    destroy() {
      removed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', onResize);
      flakes = [];
      edges = [];
      ctx.clearRect(0, 0, width, height);
    }
  };
}
