/**
 * Behavioral tests for url-state.js using a mock window.
 */

import { assertEquals, assert } from 'jsr:@std/assert';

function createMockWindow() {
  const listeners = new Map();
  const dispatched = [];

  const window = {
    location: {
      search: '',
      pathname: '/index.html',
      origin: 'http://localhost',
    },
    history: {
      _pushes: [],
      _replaces: [],
      pushState(state, _title, url) {
        this._pushes.push({ state, url });
        const u = new URL(url, window.location.origin);
        window.location.search = u.search;
        window.location.pathname = u.pathname;
      },
      replaceState(state, _title, url) {
        this._replaces.push({ state, url });
        const u = new URL(url, window.location.origin);
        window.location.search = u.search;
        window.location.pathname = u.pathname;
      },
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push(handler);
    },
    dispatchEvent(event) {
      dispatched.push(event);
      const handlers = listeners.get(event.type) || [];
      handlers.forEach(h => h(event));
    },
    _listeners: listeners,
    _dispatched: dispatched,
  };

  return window;
}

function getQuery(url) {
  const u = new URL(url, 'http://localhost');
  return u.searchParams;
}

Deno.test('url-state behaviors', async (t) => {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;

  const windowMock = createMockWindow();
  globalThis.window = windowMock;
  if (!globalThis.CustomEvent) {
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    };
  }

  const urlState = await import(`../js/state/url-state.js?test=${Date.now()}`);
  const {
    parseUrlState,
    updateUrlState,
    navigateToRoom,
    navigateToBracket,
    navigateToHome,
    getRoomLink,
    URL_PARAMS,
    VIEWS,
  } = urlState;

  try {
    await t.step('parseUrlState reads params and defaults view', () => {
      windowMock.location.search = '';
      assertEquals(parseUrlState(), {
        roomId: null,
        view: VIEWS.HOME,
        bracketType: null,
      });

      windowMock.location.search = '?room=abc&view=bracket&bracket=losers';
      assertEquals(parseUrlState(), {
        roomId: 'abc',
        view: 'bracket',
        bracketType: 'losers',
      });
    });

    await t.step('updateUrlState pushes and dispatches urlstatechange', () => {
      windowMock.location.search = '?room=abc&view=lobby';
      updateUrlState({ [URL_PARAMS.VIEW]: VIEWS.BRACKET, [URL_PARAMS.BRACKET]: 'winners' });

      assertEquals(windowMock.history._pushes.length, 1);
      const query = getQuery(windowMock.history._pushes[0].url);
      assertEquals(query.get(URL_PARAMS.ROOM), 'abc');
      assertEquals(query.get(URL_PARAMS.VIEW), 'bracket');
      assertEquals(query.get(URL_PARAMS.BRACKET), 'winners');

      const lastEvent = windowMock._dispatched.at(-1);
      assertEquals(lastEvent.type, 'urlstatechange');
      assertEquals(lastEvent.detail.view, 'bracket');
    });

    await t.step('updateUrlState replace clears params', () => {
      updateUrlState({ [URL_PARAMS.ROOM]: null, [URL_PARAMS.VIEW]: VIEWS.HOME, [URL_PARAMS.BRACKET]: null }, true);
      assertEquals(windowMock.history._replaces.length, 1);
      const query = new URLSearchParams(windowMock.location.search);
      assertEquals(query.get(URL_PARAMS.ROOM), null);
      assertEquals(query.get(URL_PARAMS.BRACKET), null);
      assertEquals(query.get(URL_PARAMS.VIEW), 'home');
    });

    await t.step('navigate helpers set expected params', () => {
      navigateToRoom('room-1');
      let query = new URLSearchParams(windowMock.location.search);
      assertEquals(query.get(URL_PARAMS.ROOM), 'room-1');
      assertEquals(query.get(URL_PARAMS.VIEW), 'lobby');

      navigateToBracket('losers');
      query = new URLSearchParams(windowMock.location.search);
      assertEquals(query.get(URL_PARAMS.VIEW), 'bracket');
      assertEquals(query.get(URL_PARAMS.BRACKET), 'losers');

      navigateToHome();
      const homeQuery = new URLSearchParams(windowMock.location.search);
      assertEquals(homeQuery.get(URL_PARAMS.ROOM), null);
      assertEquals(homeQuery.get(URL_PARAMS.BRACKET), null);
      assertEquals(homeQuery.get(URL_PARAMS.VIEW), 'home');
      assertEquals(windowMock.history._replaces.length >= 1, true);
    });

    await t.step('getRoomLink builds a lobby URL', () => {
      windowMock.location.origin = 'https://example.test';
      windowMock.location.pathname = '/index.html';
      const link = getRoomLink('share-room');
      const url = new URL(link);
      assertEquals(url.searchParams.get(URL_PARAMS.ROOM), 'share-room');
      assertEquals(url.searchParams.get(URL_PARAMS.VIEW), 'lobby');
    });

    await t.step('popstate dispatches urlstatechange', () => {
      const popEvent = { type: 'popstate', state: { urlState: { roomId: 'x', view: 'lobby', bracketType: null } } };
      windowMock.dispatchEvent(popEvent);

      const lastEvent = windowMock._dispatched.at(-1);
      assertEquals(lastEvent.type, 'urlstatechange');
      assertEquals(lastEvent.detail.roomId, 'x');
    });
  } finally {
    globalThis.window = previousWindow;
    if (previousCustomEvent === undefined) {
      delete globalThis.CustomEvent;
    } else {
      globalThis.CustomEvent = previousCustomEvent;
    }
  }
});
