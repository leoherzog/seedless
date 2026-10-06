/**
 * Tests for main.js view routing and room lifecycle. main.js runs init() on import,
 * so one module instance drives every step against a DOM that creates elements on demand.
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import { CONFIG } from '../config.js';
import { saveTournament } from '../js/state/persistence.js';
import { getRoom } from '../js/network/room.js';
import { store } from '../js/state/store.js';
import { _getLastRoom } from './mocks/trystero-mock.js';

class MockElement extends EventTarget {
  constructor(id = '') {
    super();
    Object.assign(this, { id, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '' });
    this.dataset = {};
    this.attributes = new Map();
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  querySelector() { return new MockElement(); }
  querySelectorAll() { return []; }
  closest() { return null; }
  append() {}
  appendChild(child) { return child; }
  remove() {}
  focus() {}
  select() {}
  setSelectionRange() {}
  scrollIntoView() {}
  showModal() { this.open = true; }
  close() {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  }
}

const elements = new Map();
const $ = (id) => {
  if (!elements.has(id)) elements.set(id, new MockElement(id));
  return elements.get(id);
};
const views = ['home', 'lobby', 'results', 'bracket'].map((name) => {
  const section = $(`${name}-view`);
  section.dataset.view = name;
  return section;
});

globalThis.document = {
  body: new MockElement('body'),
  getElementById: $,
  querySelector: () => new MockElement(),
  querySelectorAll: (selector) => (selector === '[data-view]' ? views : []),
  createElement: () => new MockElement(),
};

const location = { search: '', pathname: '/', origin: 'http://localhost' };
const setUrl = (url) => {
  const parsed = new URL(url, location.origin);
  location.search = parsed.search;
  location.pathname = parsed.pathname;
};
globalThis.window = Object.assign(new EventTarget(), {
  location,
  history: {
    pushState: (_state, _title, url) => setUrl(url),
    replaceState: (_state, _title, url) => setUrl(url),
  },
});

/** Let pending joins and URL handlers finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const visibleViews = () => views.filter((view) => !view.hidden).map((view) => view.dataset.view);

const click = (id) => $(id).dispatchEvent(new Event('click', { cancelable: true }));
const submit = (id) => $(id).dispatchEvent(new Event('submit', { cancelable: true }));

// The toast and auto-save timers outlive each step.
Deno.test({
  name: 'main.js shell',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const previousTurnUrl = CONFIG.network.turnCredentialsUrl;
    CONFIG.network.turnCredentialsUrl = '';
    const startedRoom = `main-test-started-${Date.now()}`;
    const freshRoom = `main-test-fresh-${Date.now()}`;

    saveTournament(startedRoom, {
      meta: { id: startedRoom, status: 'active', type: 'single', adminId: 'other-admin', config: {} },
      participants: [],
      bracket: { type: 'single', rounds: [], startedAt: 1 },
      matches: [],
    });

    try {
      await t.step('a ?room= load shows the connected status and the saved bracket', async () => {
        location.search = `?room=${startedRoom}`;
        await import('../js/main.js');
        await settle();

        assert(getRoom());
        assertEquals($('connection-status').hidden, false);
        assertEquals($('status-icon').getAttribute('class'), 'fa-solid fa-circle connected');
        assertEquals(visibleViews(), ['bracket']);
      });

      await t.step('leaving clears the room code, Share button and status', async () => {
        click('home-link');
        await settle();

        assertEquals(getRoom(), null);
        assertEquals(location.search, '');
        assertEquals(visibleViews(), ['home']);
        assertEquals($('room-display').hidden, true);
        assertEquals($('room-code').textContent, '');
        assertEquals($('share-btn').hidden, true);
        assertEquals($('connection-status').hidden, true);
      });

      await t.step('joining a started room through the Join form lands on its bracket', async () => {
        $('join-slug').value = startedRoom;
        $('join-name').value = 'Bob';
        submit('join-room-form');
        await settle();

        assertEquals(location.search, `?room=${startedRoom}`);
        assertEquals(visibleViews(), ['bracket']);
        assertEquals($('room-code').textContent, startedRoom);
        assertEquals($('share-btn').hidden, false);
      });

      await t.step('a late joiner follows the admin state from the lobby to the bracket', async () => {
        click('home-link');
        await settle();
        setUrl(`/?room=${freshRoom}`);
        window.dispatchEvent(new Event('popstate'));
        await settle();
        assertEquals(visibleViews(), ['lobby']);

        const room = _getLastRoom();
        room._simulatePeerJoin('admin-peer');
        room._simulateMessage('st:res', {
          payload: {
            isAdmin: true,
            state: {
              meta: { id: freshRoom, status: 'active', type: 'single', adminId: 'admin-user', config: {} },
              participants: [['admin-user', { id: 'admin-user', name: 'Ada', peerId: 'admin-peer' }]],
              bracket: { type: 'single', rounds: [], startedAt: 2 },
              matches: [],
            },
          },
        }, 'admin-peer');

        assertEquals(visibleViews(), ['bracket']);
        assertEquals($('peer-count').textContent, 2);
      });

      await t.step("the admin's reset returns a participant to the lobby", () => {
        _getLastRoom()._simulateMessage('t:reset', { payload: {} }, 'admin-peer');

        assertEquals(store.get('meta.status'), 'lobby');
        assertEquals(visibleViews(), ['lobby']);
      });

      await t.step('the room-exists dialog joins only when Join closes it', async () => {
        click('home-link');
        await settle();

        const modal = $('room-exists-modal');
        $('room-slug').value = startedRoom;
        $('display-name').value = 'Host';

        submit('create-room-form');
        assert(modal.open);
        modal.returnValue = 'cancel';
        modal.close();
        await settle();
        assertEquals(getRoom(), null);
        assertEquals(visibleViews(), ['home']);

        submit('create-room-form');
        modal.returnValue = 'join';
        modal.close();
        await settle();
        assert(getRoom());
        assertEquals(store.isAdmin(), false);
        assertEquals(location.search, `?room=${startedRoom}`);
      });
    } finally {
      CONFIG.network.turnCredentialsUrl = previousTurnUrl;
      localStorage.removeItem(CONFIG.storage.prefix + startedRoom);
      localStorage.removeItem(CONFIG.storage.prefix + freshRoom);
    }
  },
});
