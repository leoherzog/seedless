/**
 * Tests for url-state.js against a mock window.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeRoomSlug,
  formatRoomSlugInput,
  parseUrlState,
  navigateToRoom,
  navigateToHome,
  getRoomLink,
} from "../js/state/url-state.js";

function createMockWindow() {
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
    dispatchEvent(event) {
      dispatched.push(event);
    },
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

test("sanitizeRoomSlug", async (t) => {
  await t.test("lowercases input", () => {
    assert.deepStrictEqual(sanitizeRoomSlug("MyRoom"), "myroom");
    assert.deepStrictEqual(sanitizeRoomSlug("ROOM"), "room");
    assert.deepStrictEqual(sanitizeRoomSlug("RooM123"), "room123");
  });

  await t.test("trims whitespace", () => {
    assert.deepStrictEqual(sanitizeRoomSlug("  room  "), "room");
    assert.deepStrictEqual(sanitizeRoomSlug("\troom\n"), "room");
  });

  await t.test("replaces invalid characters with hyphen", () => {
    assert.deepStrictEqual(sanitizeRoomSlug("room_name"), "room-name");
    assert.deepStrictEqual(sanitizeRoomSlug("room.name"), "room-name");
    assert.deepStrictEqual(sanitizeRoomSlug("room@name"), "room-name");
    assert.deepStrictEqual(sanitizeRoomSlug("room!name"), "room-name");
  });

  await t.test("replaces spaces with hyphen", () => {
    assert.deepStrictEqual(sanitizeRoomSlug("room name"), "room-name");
    assert.deepStrictEqual(sanitizeRoomSlug("my cool room"), "my-cool-room");
  });

  await t.test("collapses multiple hyphens", () => {
    assert.deepStrictEqual(sanitizeRoomSlug("room--name"), "room-name");
    assert.deepStrictEqual(sanitizeRoomSlug("room---name"), "room-name");
    assert.deepStrictEqual(sanitizeRoomSlug("a--b--c"), "a-b-c");
  });

  await t.test("removes leading hyphens", () => {
    assert.deepStrictEqual(sanitizeRoomSlug("-room"), "room");
    assert.deepStrictEqual(sanitizeRoomSlug("--room"), "room");
    assert.deepStrictEqual(sanitizeRoomSlug("---room"), "room");
  });

  await t.test("removes trailing hyphens", () => {
    assert.deepStrictEqual(sanitizeRoomSlug("room-"), "room");
    assert.deepStrictEqual(sanitizeRoomSlug("room--"), "room");
    assert.deepStrictEqual(sanitizeRoomSlug("room---"), "room");
  });

  await t.test("truncates to 50 characters", () => {
    const longInput = "a".repeat(100);
    const result = sanitizeRoomSlug(longInput);
    assert.deepStrictEqual(result.length, 50);
  });

  await t.test("handles complex input", () => {
    assert.deepStrictEqual(sanitizeRoomSlug("  My_Cool.Room!  "), "my-cool-room");
    assert.deepStrictEqual(sanitizeRoomSlug("---ROOM___NAME---"), "room-name");
    assert.deepStrictEqual(sanitizeRoomSlug("Hello World 123"), "hello-world-123");
  });

  await t.test("preserves already valid slugs", () => {
    assert.deepStrictEqual(sanitizeRoomSlug("my-valid-room"), "my-valid-room");
    assert.deepStrictEqual(sanitizeRoomSlug("room123"), "room123");
    assert.deepStrictEqual(sanitizeRoomSlug("a-b-c"), "a-b-c");
  });

  await t.test("handles empty string", () => {
    assert.deepStrictEqual(sanitizeRoomSlug(""), "");
  });

  await t.test("handles string with only invalid chars", () => {
    // Invalid chars become hyphens, which are then trimmed away.
    assert.deepStrictEqual(sanitizeRoomSlug("___"), "");
    assert.deepStrictEqual(sanitizeRoomSlug("@#$"), "");
  });
});

test("formatRoomSlugInput (live typing)", async (t) => {
  await t.test("lowercases and turns spaces into hyphens", () => {
    assert.deepStrictEqual(formatRoomSlugInput("Friday Smash"), "friday-smash");
    assert.deepStrictEqual(formatRoomSlugInput("My Cool Room"), "my-cool-room");
  });

  await t.test("strips unsupported characters", () => {
    assert.deepStrictEqual(formatRoomSlugInput("room!@#name"), "room-name");
    assert.deepStrictEqual(formatRoomSlugInput("café_night"), "caf-night");
  });

  await t.test("keeps a single trailing hyphen so typing can continue", () => {
    assert.deepStrictEqual(formatRoomSlugInput("friday "), "friday-");
    assert.deepStrictEqual(formatRoomSlugInput("friday-"), "friday-");
  });

  await t.test("collapses repeated hyphens and strips a leading hyphen", () => {
    assert.deepStrictEqual(formatRoomSlugInput("  hello"), "hello");
    assert.deepStrictEqual(formatRoomSlugInput("a---b"), "a-b");
  });

  await t.test("caps length at 50 characters", () => {
    assert.deepStrictEqual(formatRoomSlugInput("a".repeat(100)).length, 50);
  });

  await t.test("finishing the slug matches sanitizeRoomSlug", () => {
    // Submitting runs sanitizeRoomSlug on whatever the live value is.
    assert.deepStrictEqual(sanitizeRoomSlug(formatRoomSlugInput("Friday Smash ")), "friday-smash");
  });
});

test('url-state behaviors', async (t) => {
  await t.test('parseUrlState reads the room param', () => {
    windowMock.location.search = '';
    assert.deepStrictEqual(parseUrlState(), { roomId: null });

    windowMock.location.search = '?room=abc';
    assert.deepStrictEqual(parseUrlState(), { roomId: 'abc' });
  });

  await t.test('navigateToRoom pushes, keeps other params and dispatches urlstatechange', () => {
    windowMock.location.search = '?room=abc&extra=x';
    navigateToRoom('def');

    assert.deepStrictEqual(windowMock.history._pushes.length, 1);
    const query = getQuery(windowMock.history._pushes[0].url);
    assert.deepStrictEqual(query.get('room'), 'def');
    assert.deepStrictEqual(query.get('extra'), 'x');

    assert.deepStrictEqual(windowMock._dispatched.at(-1).type, 'urlstatechange');
  });

  await t.test('navigate helpers set only the room param', () => {
    windowMock.location.search = '';
    navigateToRoom('room-1');
    assert.deepStrictEqual(windowMock.location.search, '?room=room-1');

    navigateToHome();
    assert.deepStrictEqual(windowMock.location.search, '');
    assert.deepStrictEqual(windowMock.history._replaces.length >= 1, true);
  });

  await t.test('getRoomLink builds a room URL', () => {
    windowMock.location.origin = 'https://example.test';
    windowMock.location.pathname = '/index.html';
    assert.deepStrictEqual(getRoomLink('share-room'), 'https://example.test/index.html?room=share-room');
  });
});
