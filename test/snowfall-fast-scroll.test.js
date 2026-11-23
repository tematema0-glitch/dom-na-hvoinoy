import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySnowScroll, shedSnowbanks } from '../public/snowfall-engine.js';

function trace(steps) {
  let state = null;
  return steps.map(([position, time]) => {
    const result = classifySnowScroll(state, position, time);
    state = result.state;
    return result;
  });
}

function bank(top, peak = 14, left = 20, right = 360) {
  return {
    geometry: { left, right, top },
    depths: new Float32Array(19).fill(peak),
    cooldown: 0
  };
}

test('gentle reading scroll does not disturb snow even after long travel', () => {
  const steps = Array.from({ length: 30 }, (_, i) => [i * 55, 1000 + i * 120]);
  const results = trace(steps);
  assert.equal(results.filter(result => result.shake).length, 0);
  assert.ok(results.slice(1).every(result => result.speed < 750));
});

test('one sustained fast swipe shakes once, not for every scroll event', () => {
  const results = trace([
    [0, 1000], [55, 1020], [122, 1040],
    [195, 1060], [280, 1080], [355, 1100]
  ]);
  assert.deepEqual(results.map(result => result.shake), [false, false, true, false, false, false]);
});

test('fast swipes work in either direction and can be repeated after slowing', () => {
  const results = trace([
    [600, 1000], [530, 1020], [450, 1040], [370, 1060],
    [370, 1100], // Stop and re-arm.
    [370, 1800], [450, 1820], [530, 1840]
  ]);
  assert.deepEqual(results.map(result => result.shake),
    [false, false, true, false, false, false, false, true]);
});

test('elastic iPhone overscroll and address-bar resize do not shake snow', () => {
  const results = trace([
    [0, 1000], [0, 1016], [0, 1032], [0, 1048],
    [0, 1200], [0, 1216], [0, 1232]
  ]);
  assert.ok(results.every(result => !result.shake));
  const invalid = classifySnowScroll(results.at(-1).state, 1200, 1234);
  assert.equal(invalid.shake, false, 'timestamp glitches should be ignored');
});

test('one unusually large event does not trigger until real travel is fast', () => {
  const results = trace([
    [0, 1000], [400, 1600], [475, 1620], [550, 1640]
  ]);
  assert.deepEqual(results.map(result => result.shake), [false, false, false, true]);
});

test('fast swipe sheds ONLY visible snow into falling chunks and crystals', () => {
  const visible = bank(430);
  const hidden = bank(2500);
  const before = Array.from(hidden.depths);
  const chunks = [], crystals = [];
  const affected = shedSnowbanks([visible, hidden], 100, 800, 130, chunks, crystals, 1);
  assert.equal(affected, 1);
  assert.ok(Math.max(...visible.depths) < 3, 'most of the visible snow falls');
  assert.deepEqual(Array.from(hidden.depths), before, 'off-screen snow remains');
  assert.ok(chunks.length >= 1, 'snow falls as visible clumps');
  assert.ok(crystals.length >= 1, 'fine snow falls as crystals');
  assert.ok(chunks.every(chunk => !chunk.onEdge && chunk.vy < 0));
  assert.ok(crystals.every(crystal => crystal.life > 0));
});

test('snow slide respects existing particle budget and very thin snow', () => {
  const thin = bank(320, 0.3);
  const normal = bank(320, 16);
  const chunks = Array.from({ length: 12 }, () => ({}));
  const crystals = Array.from({ length: 48 }, () => ({}));
  const affected = shedSnowbanks([thin, normal], 0, 700, -120, chunks, crystals);
  assert.equal(affected, 1);
  assert.equal(chunks.length, 12);
  assert.equal(crystals.length, 48);
  assert.equal(thin.depths[0] > 0, true);
  assert.ok(Math.max(...normal.depths) < 5);
});
