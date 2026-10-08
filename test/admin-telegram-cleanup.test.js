import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

class Element {
  constructor(tagName = 'div', textContent = '') {
    this.tagName = tagName;
    this.textContent = textContent;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    this.parentElement = null;
    this.hidden = false;
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  after(node) {
    const index = this.parentElement.children.indexOf(this);
    node.parentElement = this.parentElement;
    this.parentElement.children.splice(index + 1, 0, node);
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  matches(selector) {
    return selector === 'h2' && this.tagName === 'h2';
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    if (selector === '[data-telegram-cleanup-tools]') {
      return all.filter(element => element.dataset.telegramCleanupTools !== undefined);
    }
    if (selector.startsWith('[data-admin-enhancement-key=')) {
      const key = selector.slice('[data-admin-enhancement-key="'.length, -2);
      return all.filter(element => element.dataset.adminEnhancementKey === key);
    }
    if (selector === 'h2') return all.filter(element => element.tagName === 'h2');
    return [];
  }
}

async function loadEnhancement(fetch) {
  const heading = new Element('h2', 'Цены на проживание');
  const calendar = new Element('section');
  calendar.className = 'owner-calendar';
  calendar.append(heading);
  const membersHeading = new Element('h2', 'Кабинет владельца');
  const memberSection = new Element('section');
  memberSection.className = 'member-section';
  memberSection.append(membersHeading);
  const head = new Element('head');
  const html = new Element('html');
  const document = {
    head,
    documentElement: html,
    getElementById: () => null,
    createElement: tag => new Element(tag),
    querySelector: selector => selector === '.member-section' ? memberSection : null,
    querySelectorAll: selector => selector === '.owner-calendar' ? [calendar] : []
  };
  const observers = [];
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
  }
  vm.runInNewContext(await readFile(new URL('../public/admin-enhancements.js', import.meta.url), 'utf8'), {
    document,
    MutationObserver,
    localStorage: { getItem: () => null, setItem() {} },
    fetch
  });
  return {
    calendar,
    observeAgain: () => observers.forEach(observer => observer.callback()),
    tools: () => calendar.querySelector('[data-telegram-cleanup-tools]')
  };
}

test('admin cleanup button invokes protected action and reports success', async () => {
  let request;
  const page = await loadEnhancement(async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ ok: true, preservedCommands: ['help'] }) };
  });
  const tools = page.tools();
  assert.ok(tools);
  const [button, result] = tools.children;
  assert.equal(button.textContent, 'Очистить старое меню Telegram');
  await button.listeners.click();
  assert.equal(request.url, '/api/telegram');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { action: 'cleanup' });
  assert.match(result.textContent, /сохранены \(1\)/);
  assert.equal(result.dataset.state, 'success');
});

test('admin cleanup button displays API errors and is not duplicated after rerender', async () => {
  const page = await loadEnhancement(async () => ({
    ok: false, status: 503, json: async () => ({ error: 'Не удалось выполнить действие Telegram' })
  }));
  const tools = page.tools();
  page.observeAgain();
  assert.equal(page.calendar.querySelectorAll('[data-telegram-cleanup-tools]').length, 1);
  const [button, result] = tools.children;
  await button.listeners.click();
  assert.equal(result.textContent, 'Не удалось выполнить действие Telegram');
  assert.equal(result.dataset.state, 'error');
  assert.equal(button.disabled, false);
});
