import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SNOWFALL_SETTINGS,
  SNOWFLAKE_SHAPES,
  normalizeSnowfallSettings
} from '../public/snowfall-config.js';
import {
  gravityFromOrientation,
  windFromOrientation,
  createSnowfallStage
} from '../public/snowfall-engine.js';

test('snowfall is disabled on first deploy and does not require migrations', () => {
  assert.equal(DEFAULT_SNOWFALL_SETTINGS.enabled, false);
  assert.equal(DEFAULT_SNOWFALL_SETTINGS.interaction, true);
  assert.equal(DEFAULT_SNOWFALL_SETTINGS.tilt, true);
});

test('valid owner settings preserve each supported control', () => {
  const request = {
    enabled: true,
    size: 6,
    speed: 1.5,
    count: 160,
    shape: 'crystal',
    tilt: false,
    interaction: false
  };
  assert.deepEqual(normalizeSnowfallSettings(request), request);
  assert.deepEqual(SNOWFLAKE_SHAPES, ['mixed', 'soft', 'crystal', 'star']);
});

test('unsupported settings and malformed payloads are rejected', () => {
  const defaults = { ...DEFAULT_SNOWFALL_SETTINGS };
  assert.throws(() => normalizeSnowfallSettings(null));
  assert.throws(() => normalizeSnowfallSettings([]));
  assert.throws(() => normalizeSnowfallSettings({ ...defaults, unknown: true }));
  assert.throws(() => normalizeSnowfallSettings({ ...defaults, count: 99999 }));
  assert.throws(() => normalizeSnowfallSettings({ ...defaults, speed: NaN }));
  assert.throws(() => normalizeSnowfallSettings({ ...defaults, speed: Infinity }));
  assert.throws(() => normalizeSnowfallSettings({ ...defaults, speed: 1.234 }));
  assert.throws(() => normalizeSnowfallSettings({ ...defaults, size: '6' }));
  assert.throws(() => normalizeSnowfallSettings({ ...defaults, shape: 'script' }));
  assert.throws(() => normalizeSnowfallSettings({ ...defaults, enabled: 'yes' }));
  assert.throws(() => normalizeSnowfallSettings({ enabled: true }));
});

test('normal upward-facing phone produces conventional falling snow', () => {
  const downward = gravityFromOrientation(90, 0, 0);
  assert.ok(Math.abs(downward.x) < 0.001);
  assert.ok(downward.y > 0.99);
  assert.deepEqual(gravityFromOrientation(0, 0, 0), { x: 0, y: 1 });
});

test('landscape rotation rotates the direction of screen-space gravity', () => {
  const portrait = gravityFromOrientation(0, 90, 0);
  const landscape = gravityFromOrientation(0, 90, 90);
  assert.ok(portrait.x > 0.99);
  assert.ok(Math.abs(portrait.y) < 0.001);
  assert.ok(landscape.y > 0.99);
  assert.ok(Math.abs(landscape.x) < 0.001);
});

test('invalid orientation data safely uses default gravity', () => {
  assert.deepEqual(gravityFromOrientation(null, undefined), { x: 0, y: 1 });
  assert.equal(windFromOrientation(null, undefined), 0);
  assert.ok(Math.abs(windFromOrientation(0, 90, 0)) <= 1);
});

test('canvas effect is self-contained and cleans up resize/scroll listeners', () => {
  const globals = ['window', 'document', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(globals.map(key => [key, globalThis[key]]));
  const listeners = new Map();
  const frames = new Map();
  let sequence = 0;
  let drawCount = 0;
  try {
    globalThis.window = {
      devicePixelRatio: 2,
      matchMedia: () => ({ matches: false }),
      addEventListener(name, fn) { listeners.set(name, fn); },
      removeEventListener(name) { listeners.delete(name); }
    };
    globalThis.document = { hidden: false, querySelectorAll: () => [] };
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    globalThis.requestAnimationFrame = callback => {
      const id = ++sequence;
      frames.set(id, callback);
      return id;
    };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    const ctx = {
      setTransform() {}, clearRect() { drawCount++; },
      beginPath() {}, arc() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, closePath() {}
    };
    const canvas = {
      width: 0, height: 0,
      getContext: () => ctx,
      getBoundingClientRect: () => ({ width: 480, height: 260 })
    };
    const settings = { ...DEFAULT_SNOWFALL_SETTINGS, enabled: true };
    const painter = createSnowfallStage(canvas, settings, { preview: true });
    assert.equal(canvas.width, 960);
    assert.equal(canvas.height, 520);
    assert.ok(listeners.has('resize'));
    painter.setGravity(1, 0);
    painter.update({ ...settings, count: 100, size: 4, shape: 'crystal' });
    for (const time of [20, 60, 100]) {
      const [id, callback] = frames.entries().next().value;
      frames.delete(id);
      callback(time);
    }
    assert.ok(drawCount > 0);
    painter.destroy();
    assert.equal(frames.size, 0);
    assert.equal(listeners.size, 0);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
