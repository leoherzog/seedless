/**
 * Tests for main.js view routing and room lifecycle. main.js runs init() on import,
 * so one module instance drives every step against a DOM that creates elements on demand.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('main.js shell', async (t) => {
  const previousTurnUrl = CONFIG.network.turnCredentialsUrl;
  CONFIG.network.turnCredentialsUrl = '';
  const startedRoom = `main-test-started-${Date.now()}`;
  const freshRoom = `main-test-fresh-${Date.now()}`;

  // A two-player final, unplayed.
  const finalRound = { type: 'single', rounds: [{ number: 1, name: 'Finals', matchIds: ['r1m0'] }] };
  const finalMatch = [['r1m0', { id: 'r1m0', round: 1, position: 0, participants: ['admin-user', 'bob'], scores: [0, 0], winnerId: null }]];

  saveTournament(startedRoom, {
    meta: { id: startedRoom, status: 'active', type: 'single', adminId: 'other-admin', config: {} },
    participants: [],
    bracket: { ...finalRound, startedAt: 1 },
    matches: finalMatch,
  });

  try {
    await t.test('a ?room= load shows the connected status and the saved bracket', async () => {
      location.search = `?room=${startedRoom}`;
      await import('../js/main.js');
      await settle();

      assert(getRoom());
      assert.deepStrictEqual($('connection-status').hidden, false);
      assert.deepStrictEqual($('status-icon').getAttribute('class'), 'fa-solid fa-circle connected');
      assert.deepStrictEqual(visibleViews(), ['bracket']);
    });

    await t.test('leaving clears the room code, Share button and status', async () => {
      click('home-link');
      await settle();

      assert.deepStrictEqual(getRoom(), null);
      assert.deepStrictEqual(location.search, '');
      assert.deepStrictEqual(visibleViews(), ['home']);
      assert.deepStrictEqual($('room-display').hidden, true);
      assert.deepStrictEqual($('room-code').textContent, '');
      assert.deepStrictEqual($('share-btn').hidden, true);
      assert.deepStrictEqual($('connection-status').hidden, true);
    });

    await t.test('a saved started room shows its bracket while the connection is pending', async () => {
      const realFetch = globalThis.fetch;
      let release;
      globalThis.fetch = () => new Promise((resolve) => { release = () => resolve(new Response('', { status: 503 })); });
      CONFIG.network.turnCredentialsUrl = 'https://turn.test';
      try {
        setUrl(`/?room=${startedRoom}`);
        window.dispatchEvent(new Event('popstate'));
        assert.deepStrictEqual(getRoom(), null);
        assert.deepStrictEqual(visibleViews(), ['bracket']);
      } finally {
        release();
        await settle();
        globalThis.fetch = realFetch;
        CONFIG.network.turnCredentialsUrl = '';
        click('home-link');
        await settle();
      }
    });

    await t.test('joining a started room through the Join form lands on its bracket', async () => {
      $('join-slug').value = startedRoom;
      $('join-name').value = 'Bob';
      submit('join-room-form');
      await settle();

      assert.deepStrictEqual(location.search, `?room=${startedRoom}`);
      assert.deepStrictEqual(visibleViews(), ['bracket']);
      assert.deepStrictEqual($('room-code').textContent, startedRoom);
      assert.deepStrictEqual($('share-btn').hidden, false);
    });

    await t.test('a late joiner follows the admin state from the lobby to the bracket', async () => {
      click('home-link');
      await settle();
      setUrl(`/?room=${freshRoom}`);
      window.dispatchEvent(new Event('popstate'));
      await settle();
      assert.deepStrictEqual(visibleViews(), ['lobby']);

      const room = _getLastRoom();
      room._simulatePeerJoin('admin-peer');
      room._simulateMessage('st:res', {
        payload: {
          isAdmin: true,
          state: {
            meta: { id: freshRoom, status: 'active', type: 'single', adminId: 'admin-user', config: {} },
            participants: [['admin-user', { id: 'admin-user', name: 'Ada', peerId: 'admin-peer' }]],
            bracket: { ...finalRound, startedAt: 2 },
            matches: finalMatch,
          },
        },
      }, 'admin-peer');

      assert.deepStrictEqual(visibleViews(), ['bracket']);
      assert.deepStrictEqual($('peer-count').textContent, 2);
    });

    await t.test("the admin's reset returns a participant to the lobby", () => {
      _getLastRoom()._simulateMessage('t:reset', { payload: {} }, 'admin-peer');

      assert.deepStrictEqual(store.get('meta.status'), 'lobby');
      assert.deepStrictEqual(visibleViews(), ['lobby']);
    });

    await t.test('the room-exists dialog joins only when Join closes it', async () => {
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
      assert.deepStrictEqual(getRoom(), null);
      assert.deepStrictEqual(visibleViews(), ['home']);

      submit('create-room-form');
      modal.returnValue = 'join';
      modal.close();
      await settle();
      assert(getRoom());
      assert.deepStrictEqual(store.isAdmin(), false);
      assert.deepStrictEqual(location.search, `?room=${startedRoom}`);
    });
  } finally {
    CONFIG.network.turnCredentialsUrl = previousTurnUrl;
    localStorage.removeItem(CONFIG.storage.prefix + startedRoom);
    localStorage.removeItem(CONFIG.storage.prefix + freshRoom);
  }
});
