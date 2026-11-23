import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SNOWFALL_SETTINGS } from '../public/snowfall-config.js';
import { createDocumentSnowfallStage, measureSnowScene } from '../public/snowfall-engine.js';

function fakeElement(left, docTop, width, height, win) {
  return {
    getBoundingClientRect() {
      const top = docTop - win.scrollY;
      return { left, top, right: left + width, bottom: top + height, width, height };
    },
    closest() { return null; }
  };
}

test('photo masks and snowbank ledges keep the same document Y after scrolling', () => {
  const oldWindow = globalThis.window;
  try {
    const win = { scrollY: 0, getComputedStyle: () => ({ borderTopLeftRadius: '20px' }) };
    globalThis.window = win;
    const photo = fakeElement(25, 1900, 350, 250, win);
    const button = fakeElement(25, 900, 350, 65, win);
    const root = { querySelectorAll(selector) {
      if (selector === 'img, video') return [photo];
      return [button];
    } };
    const before = measureSnowScene(root, 390, 800, 0, 2200);
    win.scrollY = 650;
    const after = measureSnowScene(root, 390, 800, 650, 2200);
    assert.deepEqual(before.masks, after.masks);
    assert.equal(before.surfaces[0].top, after.surfaces[0].top);
    assert.equal(after.masks[0].top, 1899);
    assert.equal(after.surfaces[0].top, 901);
  } finally {
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
  }
});

test('tiles stay at document positions during scrolling without rerender or JS follow offset', () => {
  const names = ['window', 'document', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const previous = new Map(names.map(name => [name, globalThis[name]]));
  const listeners = new Map(), frames = new Map(), canvases = [];
  let nextFrame = 0, drawCount = 0, masks = 0, snowbanks = 0;
  try {
    const win = {
      scrollY: 0, innerWidth: 390, innerHeight: 800, devicePixelRatio: 2,
      matchMedia: () => ({ matches: false }),
      getComputedStyle: () => ({ borderTopLeftRadius: '24px' }),
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name) { listeners.delete(name); }
    };
    const photo = fakeElement(20, 1700, 340, 270, win);
    const button = fakeElement(20, 1100, 340, 65, win);
    const ctx = () => ({
      setTransform() {}, clearRect() { drawCount++; },
      save() {}, restore() {}, beginPath() {}, rect() {}, closePath() {},
      clip(rule) { if (rule === 'evenodd') masks++; },
      lineTo() {}, moveTo() {}, quadraticCurveTo() { snowbanks++; },
      arc() {}, fill() {}, stroke() {},
      createLinearGradient() { return { addColorStop() {} }; }
    });
    const root = { style: {}, children: [], append(node) { this.children.push(node); } };
    globalThis.window = win;
    globalThis.document = {
      hidden: false,
      documentElement: { clientWidth: 390, clientHeight: 800 },
      querySelector: selector => selector === 'main'
        ? { getBoundingClientRect: () => ({ bottom: 9000 - win.scrollY }) }
        : null,
      querySelectorAll(selector) {
        if (selector === 'img, video') return [photo];
        if (selector.includes('.hero-book')) return [button];
        return [];
      },
      createElement(tag) {
        assert.equal(tag, 'canvas');
        const node = {
          style: {}, width: 0, height: 0, setAttribute() {}, getContext: () => ctx(),
          remove() { root.children = root.children.filter(item => item !== node); }
        };
        canvases.push(node);
        return node;
      }
    };
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = callback => {
      const id = ++nextFrame; frames.set(id, callback); return id;
    };
    globalThis.cancelAnimationFrame = id => frames.delete(id);

    const stage = createDocumentSnowfallStage(root, {
      ...DEFAULT_SNOWFALL_SETTINGS, enabled: true, count: 120, speed: 2.4
    }, { collide: true });
    assert.ok(canvases.length >= 6);
    assert.equal(root.style.height, '9000px', 'snow tiles cannot expand the page scroll length');
    assert.equal(canvases.every(c => c.style.position === 'absolute'), true);
    assert.equal(canvases.some(c => c.style.position === 'fixed'), false);
    const positions = () => canvases.map(c => c.style.top);
    assert.ok(positions().includes('768px'));
    const tile = canvases.find(c => c.style.top === '768px');
    const tileTop = tile.style.top;
    const oldDraw = drawCount;

    // An inertial scroll may occur between RAF callbacks. Existing canvas
    // pixels must NOT be moved, repainted or re-positioned by JavaScript.
    win.scrollY = 440;
    listeners.get('scroll')?.();
    assert.equal(tile.style.top, tileTop);
    assert.equal(drawCount, oldDraw);

    for (let n = 1; n <= 1200; n++) {
      const frame = frames.entries().next().value;
      assert.ok(frame, 'RAF remains scheduled');
      frames.delete(frame[0]);
      if (n === 80) { win.scrollY = 1100; listeners.get('scroll')?.(); }
      if (n === 160) { win.scrollY = 2450; listeners.get('scroll')?.(); }
      if (n === 350) { win.scrollY = 6000; listeners.get('scroll')?.(); }
      if (n === 600) { win.scrollY = 1800; listeners.get('scroll')?.(); }
      frame[1](n * 38);
    }
    assert.ok(drawCount > 100);
    assert.ok(masks > 0, 'photos still masked');
    assert.ok(snowbanks > 0, 'snow remains on element ledges');
    assert.equal(canvases.every(c => c.style.pointerEvents === 'none'), true);
    stage.destroy();
    assert.equal(root.children.length, 0);
    assert.equal(frames.size, 0);
    assert.equal(listeners.size, 0);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
