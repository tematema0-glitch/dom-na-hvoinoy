import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SNOWFALL_SETTINGS,
  SNOWFLAKE_SHAPES,
  normalizeSnowfallSettings
} from '../public/snowfall-config.js';
import {
  gravityFromOrientation,
  windFromOrientation
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
