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
    .telegram-reconnect-button{padding:.65em 1em;border:1px solid currentColor;border-radius:999px;background:transparent;color:inherit;font:inherit;cursor:pointer}
    .telegram-webhook-info{max-width:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}
    .mail-notification-status{margin:0}
    @media(max-width:600px){.admin-enhancement-toggle{margin-inline-start:.35em}.manual-blocks-toggle{display:flex;margin-inline-start:0}}
  `;
  document.head.append(style);
}

function updateMailSettings() {
  const telegramSection = document.querySelector('.telegram-settings');
  if (!telegramSection || document.querySelector('[data-mail-notifications]')) return;
  installStyles();

  const section = document.createElement('section');
  section.className = 'telegram-settings mail-notifications';
  section.dataset.mailNotifications = '';

  const heading = document.createElement('h2');
  heading.textContent = 'Уведомления на почту';
  const description = document.createElement('p');
  description.textContent = 'Получайте письма о новых заявках на бронирование.';
  const actions = document.createElement('div');
  actions.className = 'actions';
  const state = document.createElement('span');
  state.className = 'badge';
  state.setAttribute('aria-live', 'polite');
  state.textContent = 'Проверяем настройки…';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'telegram-reconnect-button';
  button.textContent = 'Отправить тестовое письмо';
  button.disabled = true;
  const output = document.createElement('p');
  output.className = 'mail-notification-status';
  output.setAttribute('role', 'status');
  output.setAttribute('aria-live', 'polite');
  actions.append(state, button);
  section.append(heading, description, actions, output);
  telegramSection.after(section);

  fetch('/api/mail', { credentials: 'same-origin' })
    .then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось проверить настройки почты');
      state.textContent = result.configured ? 'Настроено' : 'Не настроено на сервере';
      button.disabled = !result.configured;
    })
    .catch(error => {
      state.textContent = error instanceof Error ? error.message : 'Не удалось проверить настройки почты';
    });

  button.addEventListener('click', async () => {
    button.disabled = true;
    output.textContent = 'Отправляем тестовое письмо…';
    try {
      const response = await fetch('/api/mail', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось отправить тестовое письмо');
      output.textContent = 'Тестовое письмо отправлено.';
    } catch (error) {
      output.setAttribute('role', 'alert');
      output.textContent = error instanceof Error ? error.message : 'Не удалось отправить тестовое письмо';
    } finally {
      button.disabled = false;
    }
  });
}

function updateTelegramSettings() {
  const section = document.querySelector('.telegram-settings');
  const actions = section?.querySelector('.actions');
  if (!section || !actions) return;
  installStyles();
  if (actions.querySelector('[data-telegram-reconnect]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'telegram-reconnect-button';
  button.dataset.telegramReconnect = '';
  button.textContent = 'Переподключить Telegram';
  button.addEventListener('click', async () => {
    button.disabled = true;
    let output = section.querySelector('[data-telegram-webhook-info]');
    if (!output) {
      output = document.createElement('pre');
      output.dataset.telegramWebhookInfo = '';
      output.setAttribute('aria-live', 'polite');
      output.className = 'telegram-webhook-info';
      section.append(output);
    }
    output.setAttribute('role', 'status');
    output.textContent = 'Переподключаем Telegram…';
    try {
      const response = await fetch('/api/telegram', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconnectWebhook' })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось переподключить Telegram');
      output.textContent = JSON.stringify(result.info, null, 2);
    } catch (error) {
      output.setAttribute('role', 'alert');
      output.textContent = error instanceof Error ? error.message : 'Не удалось переподключить Telegram';
    } finally {
      button.disabled = false;
    }
  });
  actions.append(button);
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
  updateTelegramSettings();
  updateMailSettings();
  const memberSection = document.querySelector('.member-section');
  if (!memberSection) return;
  installStyles();
  updateMembers(memberSection);
  updateBookings();
  document.querySelectorAll('.owner-calendar').forEach(updateManualBlocks);
}

const observer = new MutationObserver(update);
observer.observe(document.documentElement, { childList: true, subtree: true });
update();
