/**
 * Tests for url-state.js against a mock window installed before the module loads.
 */

import { assertEquals } from "jsr:@std/assert";

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

// url-state.js registers its popstate listener on window at import time.
const windowMock = createMockWindow();
globalThis.window = windowMock;

const {
  sanitizeRoomSlug,
  formatRoomSlugInput,
  parseUrlState,
  updateUrlState,
  navigateToRoom,
  navigateToBracket,
  navigateToHome,
  getRoomLink,
  URL_PARAMS,
  VIEWS,
} = await import("../js/state/url-state.js");

Deno.test("sanitizeRoomSlug", async (t) => {
  await t.step("lowercases input", () => {
    assertEquals(sanitizeRoomSlug("MyRoom"), "myroom");
    assertEquals(sanitizeRoomSlug("ROOM"), "room");
    assertEquals(sanitizeRoomSlug("RooM123"), "room123");
  });

  await t.step("trims whitespace", () => {
    assertEquals(sanitizeRoomSlug("  room  "), "room");
    assertEquals(sanitizeRoomSlug("\troom\n"), "room");
  });

  await t.step("replaces invalid characters with hyphen", () => {
    assertEquals(sanitizeRoomSlug("room_name"), "room-name");
    assertEquals(sanitizeRoomSlug("room.name"), "room-name");
    assertEquals(sanitizeRoomSlug("room@name"), "room-name");
    assertEquals(sanitizeRoomSlug("room!name"), "room-name");
  });

  await t.step("replaces spaces with hyphen", () => {
    assertEquals(sanitizeRoomSlug("room name"), "room-name");
    assertEquals(sanitizeRoomSlug("my cool room"), "my-cool-room");
  });

  await t.step("collapses multiple hyphens", () => {
    assertEquals(sanitizeRoomSlug("room--name"), "room-name");
    assertEquals(sanitizeRoomSlug("room---name"), "room-name");
    assertEquals(sanitizeRoomSlug("a--b--c"), "a-b-c");
  });

  await t.step("removes leading hyphens", () => {
    assertEquals(sanitizeRoomSlug("-room"), "room");
    assertEquals(sanitizeRoomSlug("--room"), "room");
    assertEquals(sanitizeRoomSlug("---room"), "room");
  });

  await t.step("removes trailing hyphens", () => {
    assertEquals(sanitizeRoomSlug("room-"), "room");
    assertEquals(sanitizeRoomSlug("room--"), "room");
    assertEquals(sanitizeRoomSlug("room---"), "room");
  });

  await t.step("truncates to 50 characters", () => {
    const longInput = "a".repeat(100);
    const result = sanitizeRoomSlug(longInput);
    assertEquals(result.length, 50);
  });

  await t.step("handles complex input", () => {
    assertEquals(sanitizeRoomSlug("  My_Cool.Room!  "), "my-cool-room");
    assertEquals(sanitizeRoomSlug("---ROOM___NAME---"), "room-name");
    assertEquals(sanitizeRoomSlug("Hello World 123"), "hello-world-123");
  });

  await t.step("preserves already valid slugs", () => {
    assertEquals(sanitizeRoomSlug("my-valid-room"), "my-valid-room");
    assertEquals(sanitizeRoomSlug("room123"), "room123");
    assertEquals(sanitizeRoomSlug("a-b-c"), "a-b-c");
  });

  await t.step("handles empty string", () => {
    assertEquals(sanitizeRoomSlug(""), "");
  });

  await t.step("handles string with only invalid chars", () => {
    // All invalid chars become hyphens, then get collapsed/trimmed
    assertEquals(sanitizeRoomSlug("___"), "");
    assertEquals(sanitizeRoomSlug("@#$"), "");
  });
});

Deno.test("formatRoomSlugInput (live typing)", async (t) => {
  await t.step("lowercases and turns spaces into hyphens", () => {
    assertEquals(formatRoomSlugInput("Friday Smash"), "friday-smash");
    assertEquals(formatRoomSlugInput("My Cool Room"), "my-cool-room");
  });

  await t.step("strips unsupported characters", () => {
    assertEquals(formatRoomSlugInput("room!@#name"), "room-name");
    assertEquals(formatRoomSlugInput("café_night"), "caf-night");
  });

  await t.step("keeps a single trailing hyphen so typing can continue", () => {
    // User typed "friday " and is about to type the next word
    assertEquals(formatRoomSlugInput("friday "), "friday-");
    assertEquals(formatRoomSlugInput("friday-"), "friday-");
  });

  await t.step("collapses repeated hyphens and strips a leading hyphen", () => {
    assertEquals(formatRoomSlugInput("  hello"), "hello");
    assertEquals(formatRoomSlugInput("a---b"), "a-b");
  });

  await t.step("caps length at 50 characters", () => {
    assertEquals(formatRoomSlugInput("a".repeat(100)).length, 50);
  });

  await t.step("finishing the slug matches sanitizeRoomSlug", () => {
    // Whatever the live value is, submitting runs sanitizeRoomSlug on it
    assertEquals(sanitizeRoomSlug(formatRoomSlugInput("Friday Smash ")), "friday-smash");
  });
});

Deno.test('url-state behaviors', async (t) => {
  await t.step('parseUrlState reads params and defaults view', () => {
    windowMock.location.search = '';
    assertEquals(parseUrlState(), {
      roomId: null,
      view: VIEWS.HOME,
    });

    windowMock.location.search = '?room=abc&view=bracket';
    assertEquals(parseUrlState(), {
      roomId: 'abc',
      view: 'bracket',
    });
  });

  await t.step('updateUrlState pushes and dispatches urlstatechange', () => {
    windowMock.location.search = '?room=abc&view=lobby';
    updateUrlState({ [URL_PARAMS.VIEW]: VIEWS.BRACKET });

    assertEquals(windowMock.history._pushes.length, 1);
    const query = getQuery(windowMock.history._pushes[0].url);
    assertEquals(query.get(URL_PARAMS.ROOM), 'abc');
    assertEquals(query.get(URL_PARAMS.VIEW), 'bracket');

    const lastEvent = windowMock._dispatched.at(-1);
    assertEquals(lastEvent.type, 'urlstatechange');
    assertEquals(lastEvent.detail.view, 'bracket');
  });

  await t.step('navigate helpers set expected params', () => {
    navigateToRoom('room-1');
    let query = new URLSearchParams(windowMock.location.search);
    assertEquals(query.get(URL_PARAMS.ROOM), 'room-1');
    assertEquals(query.get(URL_PARAMS.VIEW), 'lobby');

    navigateToBracket();
    query = new URLSearchParams(windowMock.location.search);
    assertEquals(query.get(URL_PARAMS.ROOM), 'room-1');
    assertEquals(query.get(URL_PARAMS.VIEW), 'bracket');

    navigateToHome();
    const homeQuery = new URLSearchParams(windowMock.location.search);
    assertEquals(homeQuery.get(URL_PARAMS.ROOM), null);
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

  await t.step('popstate dispatches urlstatechange for the restored URL', () => {
    windowMock.location.search = '?room=x&view=lobby';
    windowMock.dispatchEvent({ type: 'popstate', state: null });

    const lastEvent = windowMock._dispatched.at(-1);
    assertEquals(lastEvent.type, 'urlstatechange');
    assertEquals(lastEvent.detail.roomId, 'x');
  });
});
