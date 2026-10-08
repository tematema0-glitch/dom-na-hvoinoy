const storagePrefix = 'dom-na-hvoinoy:admin-collapse:';
const states = new Map();

function isCollapsed(key) {
  if (!states.has(key)) {
    let stored = null;
    try {
      stored = localStorage.getItem(`${storagePrefix}${key}`);
    } catch (error) {
      console.warn('Admin section preference could not be read', error);
    }
    states.set(key, stored === 'true');
  }
  return states.get(key);
}

function setCollapsed(key, value) {
  states.set(key, value);
  try {
    localStorage.setItem(`${storagePrefix}${key}`, String(value));
  } catch (error) {
    console.warn('Admin section preference could not be saved', error);
  }
}

function installStyles() {
  if (document.getElementById('admin-enhancements-styles')) return;
  const style = document.createElement('style');
  style.id = 'admin-enhancements-styles';
  style.textContent = `
    .admin-enhancement-toggle{display:inline-flex;align-items:center;max-width:100%;margin-inline-start:.65em;padding:.3em .65em;border:1px solid currentColor;border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:.72em;line-height:1.25;white-space:normal;vertical-align:middle;cursor:pointer}
    .manual-blocks-toggle{margin:12px 0 0}
    .telegram-cleanup-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 16px}
    .telegram-cleanup-button{padding:9px 13px;border:1px solid #73777c;border-radius:12px;background:#292c30;color:#f4f5f2;font:600 13px Manrope,sans-serif;cursor:pointer}
    .telegram-cleanup-button:hover:not(:disabled){border-color:#dbff00}
    .telegram-cleanup-button:disabled{opacity:.65;cursor:wait}
    .telegram-cleanup-result{flex-basis:100%;margin:0;color:#d4d6db;font-size:13px;line-height:1.5}
    .telegram-cleanup-result[data-state="error"]{color:#ffb4a9}
    .telegram-cleanup-result[data-state="success"]{color:#dbff00}
    @media(max-width:600px){.admin-enhancement-toggle{margin-inline-start:.35em}.manual-blocks-toggle{display:flex;margin-inline-start:0}}
  `;
  document.head.append(style);
}

function updateTelegramCleanup(calendar) {
  const heading = Array.from(calendar.querySelectorAll('h2'))
    .find(element => element.textContent.trim().startsWith('Цены на проживание'));
  if (!heading || calendar.querySelector('[data-telegram-cleanup-tools]')) return;

  const tools = document.createElement('div');
  tools.className = 'telegram-cleanup-tools';
  tools.dataset.telegramCleanupTools = '';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'telegram-cleanup-button';
  button.textContent = 'Очистить старое меню Telegram';

  const result = document.createElement('p');
  result.className = 'telegram-cleanup-result';
  result.setAttribute('role', 'status');
  result.setAttribute('aria-live', 'polite');

  button.addEventListener('click', async () => {
    button.disabled = true;
    result.dataset.state = '';
    result.textContent = 'Очищаем меню Telegram…';
    try {
      const response = await fetch('/api/telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup' })
      });
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error(`Сервер вернул некорректный ответ (${response.status})`);
      }
      if (!response.ok) throw new Error(payload.error || `Ошибка сервера (${response.status})`);
      const commandCount = payload.preservedCommands?.length ?? 0;
      result.dataset.state = 'success';
      result.textContent = `Старое меню очищено. Действующие команды сохранены (${commandCount}).`;
    } catch (error) {
      result.dataset.state = 'error';
      result.textContent = error instanceof Error ? error.message : 'Не удалось очистить меню Telegram';
    } finally {
      button.disabled = false;
    }
  });

  tools.append(button, result);
  heading.after(tools);
}

function createToggle(key) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'admin-enhancement-toggle';
  button.dataset.adminEnhancementKey = key;
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    setCollapsed(key, !isCollapsed(key));
    update();
  });
  return button;
}

function labelToggle(button, key) {
  const collapsed = isCollapsed(key);
  const label = collapsed ? 'Развернуть ↓' : 'Свернуть ↑';
  if (button.textContent !== label) button.textContent = label;
  button.setAttribute('aria-expanded', String(!collapsed));
}

function addHeadingToggle(heading, key) {
  let button = heading.querySelector(`[data-admin-enhancement-key="${key}"]`);
  if (!button) {
    button = createToggle(key);
    heading.append(button);
  }
  labelToggle(button, key);
  return button;
}

function updateMembers(section) {
  const heading = Array.from(section.children).find(child => child.matches('h2'));
  if (!heading) return;
  addHeadingToggle(heading, 'members');
  const collapsed = isCollapsed('members');
  for (const child of section.children) {
    if (child !== heading) child.hidden = collapsed;
  }
}

function updateBookings() {
  const heading = Array.from(document.querySelectorAll('h2'))
    .find(element => element.textContent.trim().startsWith('Заявки и проживания'));
  if (!heading) return;
  const button = addHeadingToggle(heading, 'bookings');
  const collapsed = isCollapsed('bookings');
  button.setAttribute('aria-expanded', String(!collapsed));
  for (let sibling = heading.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    if (sibling.matches('h2, .owner-calendar')) break;
    if (sibling.matches('.admin-card, .empty')) sibling.hidden = collapsed;
  }
}

function updateManualBlocks(calendar) {
  const list = calendar.querySelector('.manual-blocks');
  if (!list) return;
  list.id = 'admin-enhancement-manual-blocks';
  let button = calendar.querySelector('[data-admin-enhancement-key="manual-blocks"]');
  if (!button) {
    button = createToggle('manual-blocks');
    button.classList.add('manual-blocks-toggle');
    button.setAttribute('aria-controls', 'admin-enhancement-manual-blocks');
    list.before(button);
  }
  const collapsed = isCollapsed('manual-blocks');
  labelToggle(button, 'manual-blocks');
  button.setAttribute('aria-expanded', String(!collapsed));
  list.hidden = collapsed;
}

function update() {
  const memberSection = document.querySelector('.member-section');
  if (!memberSection) return;
  installStyles();
  updateMembers(memberSection);
  updateBookings();
  document.querySelectorAll('.owner-calendar').forEach(calendar => {
    updateManualBlocks(calendar);
    updateTelegramCleanup(calendar);
  });
}

const observer = new MutationObserver(update);
observer.observe(document.documentElement, { childList: true, subtree: true });
update();
