/**
 * Tests for url-state.js against a mock window.
 */

import { assertEquals } from "jsr:@std/assert";
import {
  sanitizeRoomSlug,
  formatRoomSlugInput,
  parseUrlState,
  updateUrlState,
  navigateToRoom,
  navigateToHome,
  getRoomLink,
  URL_PARAMS,
} from "../js/state/url-state.js";

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

const windowMock = createMockWindow();
globalThis.window = windowMock;

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
  await t.step('parseUrlState reads the room param', () => {
    windowMock.location.search = '';
    assertEquals(parseUrlState(), { roomId: null });

    windowMock.location.search = '?room=abc';
    assertEquals(parseUrlState(), { roomId: 'abc' });
  });

  await t.step('updateUrlState pushes and dispatches urlstatechange', () => {
    windowMock.location.search = '?room=abc';
    updateUrlState({ extra: 'x' });

    assertEquals(windowMock.history._pushes.length, 1);
    const query = getQuery(windowMock.history._pushes[0].url);
    assertEquals(query.get(URL_PARAMS.ROOM), 'abc');
    assertEquals(query.get('extra'), 'x');

    assertEquals(windowMock._dispatched.at(-1).type, 'urlstatechange');
  });

  await t.step('navigate helpers set only the room param', () => {
    windowMock.location.search = '';
    navigateToRoom('room-1');
    assertEquals(windowMock.location.search, '?room=room-1');

    navigateToHome();
    assertEquals(windowMock.location.search, '');
    assertEquals(windowMock.history._replaces.length >= 1, true);
  });

  await t.step('getRoomLink builds a room URL', () => {
    windowMock.location.origin = 'https://example.test';
    windowMock.location.pathname = '/index.html';
    assertEquals(getRoomLink('share-room'), 'https://example.test/index.html?room=share-room');
  });
});
