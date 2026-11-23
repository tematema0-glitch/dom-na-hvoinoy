import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SNOWFALL_SETTINGS } from '../public/snowfall-config.js';
import { burstSnowbankAt, isSnowTapGesture, createDocumentSnowfallStage } from '../public/snowfall-engine.js';

function cap(top = 850, snow = 19, left = 20, right = 360) {
  return {
    geometry: { left, right, top },
    depths: new Float32Array(19).fill(snow),
    cooldown: 0
  };
}

test('a short stationary touch is recognized as a deliberate snow-cap tap', () => {
  const start = { id: 3, x: 160, y: 250, time: 1000, scroll: 600 };
  assert.equal(isSnowTapGesture(start, { id: 3, x: 164, y: 254 }, 600, 1110), true);
  assert.equal(isSnowTapGesture(start, { id: 3, x: 169, y: 252 }, 602, 1480), true);
});

test('swipes, long presses, scrolling and second fingers are ignored', () => {
  const start = { id: 3, x: 160, y: 250, time: 1000, scroll: 600 };
  assert.equal(isSnowTapGesture(start, { id: 3, x: 200, y: 250 }, 600, 1050), false);
  assert.equal(isSnowTapGesture(start, { id: 3, x: 160, y: 250 }, 610, 1050), false);
  assert.equal(isSnowTapGesture(start, { id: 4, x: 160, y: 250 }, 600, 1050), false);
  assert.equal(isSnowTapGesture(start, { id: 3, x: 160, y: 250 }, 600, 2000), false);
  assert.equal(isSnowTapGesture(null, { id: 3, x: 160, y: 250 }, 600, 1050), false);
  assert.equal(isSnowTapGesture(start, { id: 3, x: 160, y: 250 }, 600, NaN), false);
});

test('touching a thick snowcap removes most snow and emits falling particles', () => {
  const first = cap();
  const second = cap(1300, 20);
  const originalSecond = Array.from(second.depths);
  const chunks = [], crumbs = [];
  const done = burstSnowbankAt([first, second], 170, 838, chunks, crumbs);
  assert.equal(done, true);
  assert.ok(Math.max(...first.depths) < 3);
  assert.deepEqual(Array.from(second.depths), originalSecond);
  assert.ok(chunks.length > 0, 'large snowpieces must fall');
  assert.ok(crumbs.length > 0, 'small loose crystals must fall');
  assert.ok(chunks.every(p => p.onEdge === false && p.vy < 0));
  assert.ok(crumbs.every(p => p.vy < 0 && p.life > 0));
  assert.ok(first.cooldown >= 2);
});

test('tapping the wrong place or a small snowcap does nothing', () => {
  const bank = cap(850, 5);
  const before = Array.from(bank.depths);
  const chunks = [], crumbs = [];
  assert.equal(burstSnowbankAt([bank], 170, 846, chunks, crumbs), false);
  assert.deepEqual(Array.from(bank.depths), before);
  const big = cap();
  assert.equal(burstSnowbankAt([big], 18, 842, chunks, crumbs), false);
  assert.equal(burstSnowbankAt([big], 170, 900, chunks, crumbs), false);
  assert.equal(burstSnowbankAt([big], 170, 600, chunks, crumbs), false);
  assert.equal(burstSnowbankAt([big], Infinity, 845, chunks, crumbs), false);
  assert.equal(chunks.length, 0);
  assert.equal(crumbs.length, 0);
  assert.ok(Math.max(...big.depths) > 15);
});

test('a freshly burst snowcap can rebuild, and new tap cannot endlessly explode it', () => {
  const bank = cap();
  const chunks = [], crumbs = [];
  assert.equal(burstSnowbankAt([bank], 170, 840, chunks, crumbs), true);
  const once = chunks.length;
  assert.equal(burstSnowbankAt([bank], 170, 840, chunks, crumbs), false);
  assert.equal(chunks.length, once);
  for (let i = 0; i < bank.depths.length; i++) bank.depths[i] = 18;
  assert.equal(burstSnowbankAt([bank], 170, 840, chunks, crumbs), true);
});

test('the burst respects existing particle limits', () => {
  const bank = cap(850, 25);
  const chunks = Array.from({ length: 12 }, () => ({ existing: true }));
  const crumbs = Array.from({ length: 48 }, () => ({ existing: true }));
  assert.equal(burstSnowbankAt([bank], 180, 840, chunks, crumbs), true);
  assert.equal(chunks.length, 12);
  assert.equal(crumbs.length, 48);
});

test('the document snow layer observes pointers without stealing clicks or scrolls', () => {
  const names = ['window', 'document', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const originals = new Map(names.map(name => [name, globalThis[name]]));
  const windowEvents = new Map(), documentEvents = new Map(), frames = new Map();
  let nextFrame = 0, clickTargetCalls = 0, scrollPosition = 0, topmostSnow = Infinity;
  try {
    globalThis.window = {
      get scrollY() { return scrollPosition; },
      innerWidth: 390, innerHeight: 810, devicePixelRatio: 2,
      matchMedia: () => ({ matches: false }),
      performance: { now: () => 1000 },
      getComputedStyle: () => ({ borderTopLeftRadius: '20px', position: 'static' }),
      addEventListener(name, fn) { windowEvents.set(name, fn); },
      removeEventListener(name) { windowEvents.delete(name); }
    };
    const button = {
      offsetTop: 420, offsetLeft: 20, offsetParent: null,
      getBoundingClientRect() {
        return { top: 420 - scrollPosition, bottom: 485 - scrollPosition,
          left: 20, right: 360, width: 340, height: 65 };
      },
      closest: () => null
    };
    const ctx = () => ({
      setTransform() {}, clearRect() {}, save() {}, restore() {},
      beginPath() {}, closePath() {}, rect() {}, clip() {}, lineTo() {}, moveTo() {},
      quadraticCurveTo(a, b, c, d) { topmostSnow = Math.min(topmostSnow, d); },
      arc() {}, fill() {}, stroke() {},
      createLinearGradient() { return { addColorStop() {} }; }
    });
    const layer = { style: {}, children: [], append(canvas) { this.children.push(canvas); } };
    globalThis.document = {
      hidden: false,
      documentElement: { clientWidth: 390, clientHeight: 810 },
      querySelector: selector => selector === 'main'
        ? { offsetTop: 0, offsetLeft: 0, offsetParent: null,
          getBoundingClientRect: () => ({ top: 0, left: 0, right: 390,
            bottom: 6000, width: 390, height: 6000 }) }
        : null,
      querySelectorAll: selector => selector.includes('.hero-book') ? [button] : [],
      addEventListener(name, fn, opts) {
        assert.equal(opts.capture, true);
        assert.equal(opts.passive, true);
        documentEvents.set(name, fn);
      },
      removeEventListener(name) { documentEvents.delete(name); },
      createElement: () => {
        const canvas = { style: {}, width: 0, height: 0, setAttribute() {},
          getContext: () => ctx(), remove() {
            layer.children = layer.children.filter(item => item !== canvas);
          } };
        return canvas;
      }
    };
    globalThis.ResizeObserver = class { observe() {} disconnect() {} };
    globalThis.requestAnimationFrame = fn => {
      const id = ++nextFrame; frames.set(id, fn); return id;
    };
    globalThis.cancelAnimationFrame = id => frames.delete(id);
    const stage = createDocumentSnowfallStage(layer, {
      ...DEFAULT_SNOWFALL_SETTINGS, count: 160, size: 6, speed: 2.4
    }, { collide: true });
    for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      assert.equal(typeof documentEvents.get(name), 'function');
    }

    // No preventDefault, stopPropagation, DOM mutation or pointer capture.
    // Underlying buttons still receive their normal click event.
    const tapEvent = (x, y) => ({
      pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y,
      preventDefault() { assert.fail('must never cancel the click'); },
      stopPropagation() { assert.fail('must never stop event propagation'); }
    });
    // Grow a real snowcap in the simulated Canvas stage, then check its
    // rendered silhouette jumps downward when we break it with a finger.
    for (let n = 1; n <= 320; n++) {
      const scheduled = frames.entries().next().value;
      assert.ok(scheduled, 'animation should keep running');
      frames.delete(scheduled[0]);
      scheduled[1](n * 38);
    }
    const beforeTouch = topmostSnow;
    assert.ok(beforeTouch < 409, 'snow should build up above the button');

    documentEvents.get('pointerdown')(tapEvent(180, 416));
    documentEvents.get('pointerup')(tapEvent(180, 416));
    clickTargetCalls++; // Native site handlers would proceed unmodified.
    assert.equal(clickTargetCalls, 1);

    topmostSnow = Infinity;
    const next = frames.entries().next().value;
    frames.delete(next[0]);
    next[1](321 * 38);
    assert.ok(topmostSnow > beforeTouch + 8, 'the tapped snowcap visibly collapses');

    // A drag is rejected and a fast page scroll cancels any pending tap.
    documentEvents.get('pointerdown')(tapEvent(180, 416));
    documentEvents.get('pointermove')(tapEvent(180, 470));
    documentEvents.get('pointerup')(tapEvent(180, 416));
    documentEvents.get('pointerdown')(tapEvent(180, 416));
    scrollPosition = 250;
    windowEvents.get('scroll')();
    documentEvents.get('pointerup')(tapEvent(180, 416));

    stage.destroy();
    assert.equal(documentEvents.size, 0, 'all pointer listeners removed');
    assert.equal(windowEvents.size, 0, 'all scroll listeners removed');
    assert.equal(layer.children.length, 0, 'all overlay canvases removed');
    assert.equal(frames.size, 0, 'animation cancelled');
  } finally {
    for (const [name, value] of originals) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
});
