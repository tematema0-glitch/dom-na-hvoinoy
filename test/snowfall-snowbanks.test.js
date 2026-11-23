import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SNOWFALL_SETTINGS } from '../public/snowfall-config.js';
import { createSnowfallStage } from '../public/snowfall-engine.js';

test('scrolling keeps snow aligned to ledges, never draws on photos and releases accumulated snow', () => {
  const originals = new Map(
    ['window', 'document', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame']
      .map(key => [key, globalThis[key]])
  );
  const listeners = new Map(), frames = new Map();
  let nextFrameId = 0;
  let snowbankPaths = 0, maskedFrames = 0, fallenChunks = 0, paintedFrames = 0;
  try {
    const photo = {
      getBoundingClientRect: () => ({ left: 24, top: 310, right: 374, bottom: 570, width: 350, height: 260 })
    };
    const heroButton = {
      getBoundingClientRect: () => ({ left: 24, top: 170, right: 374, bottom: 240, width: 350, height: 70 }),
      closest: () => null
    };
    globalThis.window = {
      devicePixelRatio: 2,
      scrollY: 0,
      matchMedia: () => ({ matches: false }),
      getComputedStyle: () => ({ borderTopLeftRadius: '24px' }),
      addEventListener(name, fn) { listeners.set(name, fn); },
      removeEventListener(name) { listeners.delete(name); }
    };
    globalThis.document = {
      hidden: false,
      querySelector: () => null,
      querySelectorAll(selector) {
        if (selector === 'img, video') return [photo];
        if (selector.includes('.hero-book')) return [heroButton];
        return [];
      }
    };
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    globalThis.requestAnimationFrame = fn => {
      const id = ++nextFrameId;
      frames.set(id, fn);
      return id;
    };
    globalThis.cancelAnimationFrame = id => frames.delete(id);

    const context = {
      setTransform() {},
      clearRect() { paintedFrames++; },
      beginPath() {}, rect() {},
      clip(rule) { if (rule === 'evenodd') maskedFrames++; },
      save() {}, restore() {}, fill() {}, stroke() {},
      moveTo() {}, lineTo() {}, closePath() {},
      quadraticCurveTo() { snowbankPaths++; },
      createLinearGradient() { return { addColorStop() {} }; },
      arc(x, y, r) { if (r > 6) fallenChunks++; }
    };
    const canvas = {
      getContext: () => context,
      getBoundingClientRect: () => ({ width: 420, height: 650 }),
      width: 0, height: 0
    };
    const stage = createSnowfallStage(canvas,
      { ...DEFAULT_SNOWFALL_SETTINGS, enabled: true, speed: 2.4, size: 4, count: 100 },
      { collide: true }
    );
    for (let n = 1; n <= 1800; n++) {
      const first = frames.entries().next().value;
      assert.ok(first, 'animation frame should be scheduled');
      frames.delete(first[0]);
      if (n === 600 || n === 1200) {
        globalThis.window.scrollY = n === 600 ? 310 : 0;
        listeners.get('scroll')?.();
      }
      first[1](n * 44);
    }
    assert.ok(maskedFrames > 100, 'photos stay masked during animation');
    assert.ok(snowbankPaths > 100, 'snowbanks grow and draw above chosen ledges');
    assert.ok(fallenChunks > 0, 'accumulated snow eventually slides and falls');
    assert.ok(paintedFrames > 100);
    stage.destroy();
    assert.equal(frames.size, 0);
    assert.equal(listeners.size, 0);
  } finally {
    for (const [key, value] of originals) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
