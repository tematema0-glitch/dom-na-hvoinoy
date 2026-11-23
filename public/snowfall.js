import { normalizeSnowfallSettings } from './snowfall-config.js';
import { createSnowfallStage, windFromOrientation } from './snowfall-engine.js';

// Public seasonal effect. If the settings API is unavailable, nothing is shown.
// Never intercept booking, calendar, or navigation events.
const OVERLAY_ID = 'seasonal-snow-overlay';
const TILT_CHIP_ID = 'seasonal-snow-tilt';
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
let settings = null;
let stage = null;
let tiltChip = null;
let orientationListening = false;
let tiltPermissionGranted = false;
let orientationPermissionDismissed = false;

function onOrientation(event) {
  if (!stage || !settings?.tilt) return;
  const angle = screen.orientation?.angle || window.orientation || 0;
  stage.setWind(windFromOrientation(event.beta, event.gamma, angle));
}

function startOrientation() {
  if (orientationListening || !window.DeviceOrientationEvent) return;
  window.addEventListener('deviceorientation', onOrientation, { passive: true });
  orientationListening = true;
}

function stopOrientation() {
  if (orientationListening) window.removeEventListener('deviceorientation', onOrientation);
  orientationListening = false;
  stage?.setWind(0);
}

function hideTiltChip() {
  tiltChip?.remove();
  tiltChip = null;
}

function offerTiltPermission() {
  hideTiltChip();
  if (!settings?.tilt || !stage || orientationPermissionDismissed ||
      !window.matchMedia?.('(pointer: coarse)').matches ||
      typeof window.DeviceOrientationEvent?.requestPermission !== 'function' ||
      tiltPermissionGranted) return;

  try {
    if (sessionStorage.getItem('seasonal-snow-tilt-dismissed') === '1') return;
  } catch {}

  const chip = document.createElement('div');
  chip.id = TILT_CHIP_ID;
  chip.setAttribute('role', 'group');
  chip.setAttribute('aria-label', 'Настройка наклона снежинок');
  Object.assign(chip.style, {
    position: 'fixed', right: '14px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14px)',
    zIndex: '45', display: 'flex', gap: '3px', alignItems: 'center',
    padding: '4px', background: 'rgba(25, 38, 48, 0.89)', border: '1px solid rgba(255,255,255,.26)',
    borderRadius: '999px', color: '#fff', boxShadow: '0 6px 20px rgba(0,0,0,.16)',
    fontFamily: 'Manrope, system-ui, sans-serif', fontSize: '12px'
  });

  const allow = document.createElement('button');
  allow.type = 'button';
  allow.textContent = '❄ Наклон снега';
  allow.setAttribute('aria-label', 'Разрешить снежинкам реагировать на наклон телефона');
  Object.assign(allow.style, {
    border: '0', color: '#fff', background: 'transparent',
    padding: '7px 9px', font: 'inherit', fontWeight: '650', cursor: 'pointer'
  });
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Закрыть настройку наклона');
  Object.assign(close.style, {
    width: '28px', height: '28px', border: '0', borderRadius: '50%',
    color: '#fff', background: 'rgba(255,255,255,.12)', font: 'inherit', fontSize: '18px',
    cursor: 'pointer'
  });
  const dismiss = () => {
    orientationPermissionDismissed = true;
    try { sessionStorage.setItem('seasonal-snow-tilt-dismissed', '1'); } catch {}
    hideTiltChip();
  };
  close.addEventListener('click', dismiss);
  allow.addEventListener('click', () => {
    // requestPermission must be invoked directly inside a user gesture on iOS.
    let permission;
    try { permission = window.DeviceOrientationEvent.requestPermission(); }
    catch { dismiss(); return; }
    allow.disabled = true;
    Promise.resolve(permission).then(result => {
      if (result === 'granted') {
        tiltPermissionGranted = true;
        startOrientation();
        hideTiltChip();
      } else {
        dismiss();
      }
    }).catch(dismiss);
  });
  chip.append(allow, close);
  document.body.append(chip);
  tiltChip = chip;
}

function apply(next) {
  settings = normalizeSnowfallSettings(next);
  if (!settings.enabled || reducedMotion?.matches) {
    stopOrientation();
    stage?.destroy();
    stage = null;
    document.getElementById(OVERLAY_ID)?.remove();
    hideTiltChip();
    return;
  }

  let canvas = document.getElementById(OVERLAY_ID);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = OVERLAY_ID;
    canvas.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, {
      position: 'fixed', inset: '0', width: '100vw', height: '100vh',
      pointerEvents: 'none', zIndex: '35', contain: 'strict'
    });
    document.body.append(canvas);
  }
  if (!stage) stage = createSnowfallStage(canvas, settings, { collide: true });
  else stage.update(settings);

  stopOrientation();
  if (settings.tilt) {
    if (typeof window.DeviceOrientationEvent?.requestPermission !== 'function' ||
        tiltPermissionGranted) startOrientation();
    else offerTiltPermission();
  } else hideTiltChip();
}

async function loadSettings() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const response = await fetch('/api/snowfall', {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal
    });
    if (!response.ok) return;
    const json = await response.json();
    apply(json.settings);
  } catch {
    // Seasonal decoration must never affect the functionality of the site.
  } finally {
    clearTimeout(timer);
  }
}

window.addEventListener('snowfall:changed', event => {
  try { apply(event.detail); } catch {}
});
window.addEventListener('pagehide', () => {
  stopOrientation();
  hideTiltChip();
  stage?.destroy();
  stage = null;
});
if (reducedMotion) {
  const update = () => {
    if (settings) {
      try { apply(settings); } catch {}
    }
  };
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', update);
  else reducedMotion.addListener?.(update);
}

void loadSettings();
