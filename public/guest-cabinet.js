const state = { account: null, busy: false, error: '', needsName: false, phone: '' };
const filledBookingInputs = new WeakSet();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function dateRange(arrival, departure) {
  const format = value => new Date(`${value}T12:00:00`).toLocaleDateString('ru-RU');
  return `${format(arrival)} — ${format(departure)}`;
}

function bookingStatus(status) {
  return ({
    request: 'Заявка отправлена — ожидает подтверждения владельца',
    waitlist: 'Лист ожидания',
    confirmed: 'Бронирование подтверждено',
    completed: 'Проживание завершено',
    cancelled: 'Заявка отменена'
  })[status] || 'Статус уточняется';
}

function setBookingInput(input, value) {
  if (!input || input.value || filledBookingInputs.has(input)) return;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
  if (!setter) return;
  setter.call(input, value);
  filledBookingInputs.add(input);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillBookingForm() {
  if (!state.account) return;
  const form = document.querySelector('#booking');
  if (!form) return;
  setBookingInput(form.querySelector('input[autocomplete="given-name"]'), state.account.member.name);
  setBookingInput(form.querySelector('input[type="tel"]'), state.account.member.phone);
}

function appendAccountSection(container, title, entries, renderEntry, emptyText) {
  const section = element('section', 'guest-cabinet-section');
  section.append(element('h3', '', title));
  if (!entries.length) {
    section.append(element('p', 'small', emptyText));
  } else {
    const list = element('div', 'guest-cabinet-list');
    entries.forEach(entry => list.append(renderEntry(entry)));
    section.append(list);
  }
  container.append(section);
}

function renderAccount(card) {
  const member = state.account.member;
  card.append(element('h2', '', 'Мой кабинет'));
  const summary = element('div', 'guest-cabinet-summary');
  summary.append(element('strong', '', member.name));
  summary.append(element('span', '', `Реферальный код: ${member.code}`));
  summary.append(element('span', '', `Баланс: ${member.balance} баллов`));
  card.append(summary);

  appendAccountSection(card, 'Мои заявки', state.account.bookings, booking => {
    const row = element('article', 'guest-cabinet-row');
    row.append(element('strong', '', dateRange(booking.arrival, booking.departure)));
    row.append(element('span', '', `${booking.guests} гостей · ${new Intl.NumberFormat('ru-RU').format(booking.total)} ₽`));
    row.append(element('span', 'guest-cabinet-status', bookingStatus(booking.status)));
    if (booking.dates_released) row.append(element('small', '', 'Даты освобождены'));
    return row;
  }, 'Заявок пока нет.');

  appendAccountSection(card, 'Приглашённые', state.account.invitedGuests, guest => {
    const row = element('article', 'guest-cabinet-row');
    row.append(element('strong', '', guest.name));
    row.append(element('span', '', `${dateRange(guest.arrival, guest.departure)} · ${guest.nights} ночей`));
    row.append(element('span', 'guest-cabinet-status', guest.statusLabel));
    row.append(element('small', '', guest.earned_points ? `Начислено баллов: ${guest.earned_points}` : 'Баллы: 0'));
    if (guest.dates_released) row.append(element('small', '', 'Даты освобождены'));
    return row;
  }, 'Приглашённых бронирований пока нет.');
}

async function submitPhone(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  state.phone = String(formData.get('phone') || '').trim();
  const name = String(formData.get('name') || '').trim();
  state.error = '';
  state.busy = true;
  render();
  try {
    const action = state.needsName ? 'join' : 'lookup';
    const payload = { action, phone: state.phone };
    if (state.needsName) payload.name = name;
    const response = await fetch('/api/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (response.status === 404 && !state.needsName) {
      state.needsName = true;
      state.error = 'Участник не найден. Укажите имя, чтобы создать кабинет.';
      return;
    }
    if (!response.ok) throw new Error(result.error || 'Не удалось открыть кабинет');
    state.account = {
      member: { id: result.id, name: result.name, phone: result.phone, code: result.code, balance: result.balance },
      bookings: result.bookings || [],
      invitedGuests: result.referralBookings || result.invitedGuests || []
    };
    state.needsName = false;
    fillBookingForm();
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Не удалось открыть кабинет';
  } finally {
    state.busy = false;
    render();
  }
}

function renderAnonymous(card) {
  card.append(element('h2', '', 'Гостевой кабинет'));
  card.append(element('p', '', 'Введите номер телефона'));
  const form = element('form', 'guest-cabinet-form');
  const fields = element('div', 'guest-cabinet-fields');
  const phoneLabel = element('label', '', 'Номер телефона');
  const phoneInput = element('input');
  phoneInput.name = 'phone';
  phoneInput.type = 'tel';
  phoneInput.autocomplete = 'tel';
  phoneInput.inputMode = 'tel';
  phoneInput.required = true;
  phoneInput.placeholder = '+7 900 000-00-00';
  phoneInput.value = state.phone;
  phoneLabel.append(phoneInput);
  fields.append(phoneLabel);
  if (state.needsName) {
    const nameLabel = element('label', '', 'Имя');
    const nameInput = element('input');
    nameInput.name = 'name';
    nameInput.autocomplete = 'given-name';
    nameInput.required = true;
    nameInput.maxLength = 80;
    nameInput.placeholder = 'Как к вам обращаться';
    nameLabel.append(nameInput);
    fields.append(nameLabel);
  }
  form.append(fields);
  const submit = element('button', 'primary', state.busy ? 'Проверяем…' : state.needsName ? 'Создать кабинет' : 'Продолжить');
  submit.type = 'submit';
  submit.disabled = state.busy;
  form.append(submit);
  form.addEventListener('submit', submitPhone);
  card.append(form);
  if (state.error) card.append(element('p', 'small', state.error));
}

function render() {
  fillBookingForm();
  const tab = [...document.querySelectorAll('[role="tab"]')].find(item => item.textContent.trim() === 'Пригласить друзей');
  const panel = tab && document.getElementById(tab.getAttribute('aria-controls'));
  if (!panel) return;
  let card = panel.querySelector('.guest-cabinet');
  if (!card) {
    const intro = panel.querySelector('.club-intro');
    if (!intro) return;
    card = element('section', 'booking-card guest-cabinet');
    card.setAttribute('aria-label', 'Гостевой кабинет');
    intro.after(card);
  }
  card.replaceChildren();
  if (state.account) renderAccount(card);
  else renderAnonymous(card);
  fillBookingForm();
}

const styles = document.createElement('style');
styles.textContent = `
.guest-cabinet{max-width:900px;margin:24px auto;scroll-margin-top:24px}
.guest-cabinet-summary,.guest-cabinet-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:12px 20px;margin:16px 0}
.guest-cabinet-summary span{font-size:14px}
.guest-cabinet-form{max-width:620px}
.guest-cabinet-form input{width:100%;margin-top:6px;padding:11px 12px;border:1px solid #b3ca43;border-radius:8px;background:#ffffffb8;color:#111}
.guest-cabinet-form .primary{margin-top:8px}
.guest-cabinet-section{margin-top:22px}
.guest-cabinet-section h3{margin-bottom:8px}
.guest-cabinet-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:0 20px}
.guest-cabinet-row{display:grid;gap:5px;padding:12px 0;border-top:1px solid #10111030;font-size:14px;overflow-wrap:anywhere}
.guest-cabinet-status{font-weight:600}
@media(max-width:600px){.guest-cabinet{padding:20px;border-radius:18px}.guest-cabinet-summary{grid-template-columns:1fr 1fr}.guest-cabinet-form .primary{width:100%}}
`;
document.head.append(styles);

const observer = new MutationObserver(() => {
  const tab = [...document.querySelectorAll('[role="tab"]')].find(item => item.textContent.trim() === 'Пригласить друзей');
  const panel = tab && document.getElementById(tab.getAttribute('aria-controls'));
  if (panel && !panel.querySelector('.guest-cabinet')) render();
  else fillBookingForm();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
render();

function restoreMember() {
  fetch('/api/me').then(response => response.ok ? response.json() : null).then(account => {
    if (!account?.loggedIn) return;
    state.account = account;
    state.phone = account.member.phone;
    render();
  }).catch(() => {});
}

if (document.readyState === 'complete') restoreMember();
else window.addEventListener('load', restoreMember, { once: true });