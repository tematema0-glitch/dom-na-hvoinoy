import { DEFAULT_SNOWFALL_SETTINGS, normalizeSnowfallSettings } from './snowfall-config.js';
import { createSnowfallStage } from './snowfall-engine.js';

const PANEL_ID = 'owner-seasonal-snow';
const STYLES_ID = 'owner-seasonal-snow-styles';
const SHAPES = [
  ['mixed', 'Смешанные — живой снегопад'],
  ['soft', 'Мягкие хлопья'],
  ['crystal', 'Ледяные кристаллы'],
  ['star', 'Звёздочки']
];

const styleText = [
  '#owner-seasonal-snow{margin:28px 0 18px;padding:0;min-width:0;color:#fff;font-family:Manrope,system-ui,sans-serif}',
  '#owner-seasonal-snow *{box-sizing:border-box}',
  '#owner-seasonal-snow .snow-admin-shell{padding:22px;background:#303339;border:1px solid #ffffff36;border-radius:22px;box-shadow:0 10px 28px #00000019}',
  '#owner-seasonal-snow .snow-admin-eyebrow{color:#d9fc72;font-size:11px;font-weight:800;letter-spacing:.14em;margin:0 0 8px}',
  '#owner-seasonal-snow .snow-admin-head{display:flex;gap:16px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;margin-bottom:18px}',
  '#owner-seasonal-snow h2{font-size:clamp(21px,3vw,28px);line-height:1.22;margin:0 0 7px;color:#fff}',
  '#owner-seasonal-snow .snow-admin-desc{font-size:13px;line-height:1.6;color:#d5d8dc;margin:0;max-width:650px}',
  '#owner-seasonal-snow .snow-admin-switch{display:flex;align-items:center;gap:10px;background:#212b30;border:1px solid #6a737a;border-radius:14px;padding:12px 14px;cursor:pointer;font-weight:750;font-size:14px}',
  '#owner-seasonal-snow .snow-admin-switch input{appearance:none;width:43px;height:25px;border-radius:16px;position:relative;background:#687078;border:1px solid #9ba2a8;cursor:pointer;transition:background .2s}',
  '#owner-seasonal-snow .snow-admin-switch input:checked{background:#dfff39;border-color:#dfff39}',
  '#owner-seasonal-snow .snow-admin-switch input::after{content:"";position:absolute;top:3px;left:3px;width:17px;height:17px;border-radius:50%;background:#fff;transition:transform .2s}',
  '#owner-seasonal-snow .snow-admin-switch input:checked::after{transform:translateX(18px);background:#23282d}',
  '#owner-seasonal-snow input:focus-visible,#owner-seasonal-snow button:focus-visible,#owner-seasonal-snow select:focus-visible{outline:3px solid #dfff39;outline-offset:3px}',
  '#owner-seasonal-snow .snow-admin-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(270px,.85fr);gap:20px}',
  '#owner-seasonal-snow .snow-admin-controls{display:grid;gap:17px}',
  '#owner-seasonal-snow .snow-admin-range{display:grid;gap:7px;font-size:13px;color:#f5f6f5}',
  '#owner-seasonal-snow .snow-admin-range-label{display:flex;align-items:center;justify-content:space-between;gap:14px}',
  '#owner-seasonal-snow .snow-admin-range output{font-variant-numeric:tabular-nums;color:#dfff39;font-weight:750}',
  '#owner-seasonal-snow input[type=range]{display:block;width:100%;accent-color:#dfff39;cursor:pointer;min-height:26px}',
  '#owner-seasonal-snow .snow-admin-select{display:grid;gap:8px;font-size:13px}',
  '#owner-seasonal-snow .snow-admin-select select{width:100%;font:inherit;font-size:14px;border:1px solid #a0a6ae;border-radius:12px;background:#f9f9f9;color:#222;padding:11px}',
  '#owner-seasonal-snow .snow-admin-checks{display:grid;gap:11px;margin-top:2px}',
  '#owner-seasonal-snow .snow-admin-checks label{display:flex;align-items:center;gap:10px;font-size:13px;line-height:1.45;cursor:pointer;color:#e6e8e8}',
  '#owner-seasonal-snow .snow-admin-checks input{accent-color:#dfff39;width:17px;height:17px;flex-shrink:0}',
  '#owner-seasonal-snow .snow-admin-preview-wrap{display:grid;gap:8px;align-content:start}',
  '#owner-seasonal-snow .snow-admin-preview{overflow:hidden;height:238px;position:relative;border-radius:18px;border:1px solid #91b0bb66;background:radial-gradient(ellipse at 75% 24%,#4f7183aa,transparent 48%),linear-gradient(145deg,#203b4d,#121c2b 75%)}',
  '#owner-seasonal-snow .snow-admin-preview::after{content:"";position:absolute;pointer-events:none;left:0;right:0;bottom:0;height:55px;background:linear-gradient(0deg,#163040c0,transparent)}',
  '#owner-seasonal-snow .snow-admin-preview canvas{display:block;width:100%;height:100%;pointer-events:none}',
  '#owner-seasonal-snow .snow-admin-preview-label{position:absolute;left:14px;top:12px;color:#ebfaffd8;font-size:11px;font-weight:800;letter-spacing:.08em;pointer-events:none}',
  '#owner-seasonal-snow .snow-admin-preview-title{position:absolute;left:16px;bottom:17px;z-index:1;color:white;font-size:18px;font-weight:750;letter-spacing:.02em;pointer-events:none}',
  '#owner-seasonal-snow .snow-admin-note{margin:0;color:#c5cbd0;line-height:1.55;font-size:12px}',
  '#owner-seasonal-snow .snow-admin-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:18px}',
  '#owner-seasonal-snow button{cursor:pointer}',
  '#owner-seasonal-snow .snow-admin-save{border:0;border-radius:13px;background:#dfff39;color:#15191c;padding:13px 19px;font-size:14px;font-weight:800;min-height:46px}',
  '#owner-seasonal-snow .snow-admin-reset{border:1px solid #8a949c;border-radius:13px;background:transparent;color:#fff;padding:12px 17px;font-size:14px;min-height:46px}',
  '#owner-seasonal-snow button:disabled{opacity:.48;cursor:not-allowed}',
  '#owner-seasonal-snow .snow-admin-status{font-size:13px;line-height:1.5;flex:1 1 250px;margin:0;color:#d4dce2}',
  '#owner-seasonal-snow .snow-admin-status[data-kind=error]{color:#ffb3a9}',
  '#owner-seasonal-snow .snow-admin-status[data-kind=success]{color:#dfff39}',
  '@media(max-width:760px){#owner-seasonal-snow .snow-admin-layout{grid-template-columns:1fr}#owner-seasonal-snow .snow-admin-shell{padding:15px}#owner-seasonal-snow .snow-admin-preview{height:210px}#owner-seasonal-snow .snow-admin-switch{width:100%;justify-content:center}}'
].join('\n');

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function mountStyles() {
  if (document.getElementById(STYLES_ID)) return;
  const style = el('style');
  style.id = STYLES_ID;
  style.textContent = styleText;
  document.head.append(style);
}

function createRange(label, key, min, max, step, format) {
  const wrapper = el('label', 'snow-admin-range');
  const heading = el('span', 'snow-admin-range-label');
  const name = el('span', '', label);
  const output = el('output');
  const input = el('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.name = key;
  input.setAttribute('aria-label', label);
  heading.append(name, output);
  wrapper.append(heading, input);
  return { wrapper, input, output, format };
}

function setup(panel) {
  mountStyles();
  const shell = el('div', 'snow-admin-shell');
  const header = el('div', 'snow-admin-head');
  const left = el('div');
  left.append(
    el('p', 'snow-admin-eyebrow', 'СЕЗОННОЕ ОФОРМЛЕНИЕ'),
    el('h2', '', '❄ Снег на сайте'),
    el('p', 'snow-admin-desc', 'Снежинки движутся вместе с прокруткой, не закрывают фотографии и постепенно собираются в сугробы на верхних краях объектов. Кнопки и бронирование работают как прежде.')
  );
  const switcher = el('label', 'snow-admin-switch');
  const enabled = el('input');
  enabled.type = 'checkbox';
  enabled.setAttribute('role', 'switch');
  enabled.setAttribute('aria-label', 'Включить падающий снег на сайте');
  const switchLabel = el('span', '', 'Снег выключен');
  switcher.append(enabled, switchLabel);
  header.append(left, switcher);
  const layout = el('div', 'snow-admin-layout');
  const controls = el('div', 'snow-admin-controls');
  const size = createRange('Размер снежинок', 'size', 1, 6, 1, value => String(value) + ' / 6');
  const speed = createRange('Скорость падения', 'speed', 0.4, 2.4, 0.1, value => Number(value).toFixed(1) + '×');
  const count = createRange('Количество', 'count', 20, 160, 10, value => String(value));
  controls.append(size.wrapper, speed.wrapper, count.wrapper);
  const selectLabel = el('label', 'snow-admin-select', 'Форма снежинок');
  const select = el('select');
  select.setAttribute('aria-label', 'Форма снежинок');
  for (const [value, text] of SHAPES) {
    const option = el('option', '', text);
    option.value = value;
    select.append(option);
  }
  selectLabel.append(select);
  controls.append(selectLabel);

  const checks = el('div', 'snow-admin-checks');
  const tiltLabel = el('label');
  const tilt = el('input');
  tilt.type = 'checkbox';
  tiltLabel.append(tilt, document.createTextNode('Реагировать на наклон телефона (если поддерживается)'));
  const edgeLabel = el('label');
  const interaction = el('input');
  interaction.type = 'checkbox';
  edgeLabel.append(interaction, document.createTextNode('Сугробы на верхних кромках кнопок и фотографий, со сходом снега'));
  checks.append(tiltLabel, edgeLabel);
  controls.append(checks);

  const previewWrap = el('div', 'snow-admin-preview-wrap');
  const preview = el('div', 'snow-admin-preview');
  const canvas = el('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  preview.append(canvas, el('span', 'snow-admin-preview-label', 'ПРЕДПРОСМОТР'));
  preview.append(el('span', 'snow-admin-preview-title', 'Новый год на Хвойной'));
  previewWrap.append(
    preview,
    el('p', 'snow-admin-note', 'Предпросмотр показывает снежинки. На сайте сугробы медленно растут на кромках объектов, а затем частично осыпаются. Фотографии остаются чистыми.')
  );
  layout.append(controls, previewWrap);

  const footer = el('div', 'snow-admin-actions');
  const save = el('button', 'snow-admin-save', 'Сохранить настройки');
  save.type = 'button';
  const cancel = el('button', 'snow-admin-reset', 'Отменить изменения');
  cancel.type = 'button';
  const status = el('p', 'snow-admin-status', 'Загружаем настройки…');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  footer.append(save, cancel, status);
  shell.append(header, layout, footer);
  panel.append(shell);

  let saved = null;
  let draft = { ...DEFAULT_SNOWFALL_SETTINGS };
  let busy = false;
  let stage = createSnowfallStage(canvas, { ...draft, enabled: true }, { preview: true });

  function notify(message, kind = 'info') {
    status.textContent = message;
    status.setAttribute('data-kind', kind);
  }

  function refresh() {
    enabled.checked = draft.enabled;
    switchLabel.textContent = draft.enabled ? 'Снег включён' : 'Снег выключен';
    size.input.value = String(draft.size);
    speed.input.value = String(draft.speed);
    count.input.value = String(draft.count);
    select.value = draft.shape;
    tilt.checked = draft.tilt;
    interaction.checked = draft.interaction;
    for (const control of [size, speed, count]) {
      control.output.value = control.format(control.input.value);
      control.output.textContent = control.output.value;
    }
    const dirty = saved && JSON.stringify(saved) !== JSON.stringify(draft);
    save.disabled = busy || !saved || !dirty;
    cancel.disabled = busy || !saved || !dirty;
    stage?.update({ ...draft, enabled: true });
  }

  function edit(next) {
    draft = { ...draft, ...next };
    try { draft = normalizeSnowfallSettings(draft); }
    catch { return; }
    refresh();
    notify('Изменения видны в предпросмотре. Чтобы применить их на сайте, нажми «Сохранить».');
  }

  enabled.addEventListener('change', () => edit({ enabled: enabled.checked }));
  size.input.addEventListener('input', () => edit({ size: Number(size.input.value) }));
  speed.input.addEventListener('input', () => edit({ speed: Number(speed.input.value) }));
  count.input.addEventListener('input', () => edit({ count: Number(count.input.value) }));
  select.addEventListener('change', () => edit({ shape: select.value }));
  tilt.addEventListener('change', () => edit({ tilt: tilt.checked }));
  interaction.addEventListener('change', () => edit({ interaction: interaction.checked }));

  cancel.addEventListener('click', () => {
    if (!saved || busy) return;
    draft = { ...saved };
    refresh();
    notify('Несохранённые изменения отменены.');
  });

  async function load() {
    try {
      const response = await fetch('/api/snowfall', {
        credentials: 'same-origin', cache: 'no-store'
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Не удалось получить настройки.');
      saved = normalizeSnowfallSettings(data.settings);
      draft = { ...saved };
      refresh();
      notify(saved.enabled ? 'Снег сейчас включён на сайте.' : 'Снег сейчас выключен на сайте.', 'success');
    } catch (error) {
      notify(error.message || 'Не удалось загрузить настройки снега.', 'error');
      save.disabled = true;
    }
  }

  save.addEventListener('click', async () => {
    if (busy || !saved) return;
    busy = true;
    refresh();
    notify('Сохраняем снегопад…');
    try {
      const response = await fetch('/api/admin/snowfall', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ settings: draft })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Не удалось сохранить настройки.');
      saved = normalizeSnowfallSettings(data.settings);
      draft = { ...saved };
      window.dispatchEvent(new CustomEvent('snowfall:changed', { detail: saved }));
      notify(saved.enabled ? 'Сохранено: снег включён. Посетители увидят его после открытия или обновления сайта.' :
        'Сохранено: снег выключен для посетителей.', 'success');
    } catch (error) {
      notify(error.message || 'Сохранить не удалось. Старые настройки остались.', 'error');
    } finally {
      busy = false;
      refresh();
    }
  });

  refresh();
  void load();

  const onGone = () => {
    if (!panel.isConnected) {
      stage?.destroy();
      stage = null;
      observer.disconnect();
    }
  };
  const observer = new MutationObserver(onGone);
  observer.observe(document.body, { childList: true, subtree: true });
}

function mount() {
  const calendar = document.querySelector('.owner-calendar');
  if (!calendar) return;
  const destination = calendar.closest('[data-slot="tabs-content"]') || calendar.parentElement;
  if (!destination || destination.querySelector('#' + PANEL_ID)) return;
  const panel = el('section');
  panel.id = PANEL_ID;
  panel.setAttribute('aria-label', 'Сезонный снегопад');
  destination.append(panel);
  setup(panel);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true });
} else {
  mount();
}
new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
