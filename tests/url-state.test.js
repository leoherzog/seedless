/**
 * Tests for url-state.js against a mock window installed before the module loads.
 */

import { assertEquals, assert, assertFalse } from "jsr:@std/assert";

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
  isValidRoomSlug,
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

Deno.test("isValidRoomSlug", async (t) => {
  // Valid slugs
  await t.step("accepts lowercase letters", () => {
    assert(isValidRoomSlug("myroom"));
    assert(isValidRoomSlug("abc"));
  });

  await t.step("accepts numbers", () => {
    assert(isValidRoomSlug("room123"));
    assert(isValidRoomSlug("123room"));
    assert(isValidRoomSlug("123"));
  });

  await t.step("accepts hyphens in middle", () => {
    assert(isValidRoomSlug("my-room"));
    assert(isValidRoomSlug("room-123"));
    assert(isValidRoomSlug("a-b-c"));
    assert(isValidRoomSlug("my-awesome-room"));
  });

  await t.step("accepts minimum length (3 chars)", () => {
    assert(isValidRoomSlug("abc"));
    assert(isValidRoomSlug("a1b"));
  });

  await t.step("accepts maximum length (50 chars)", () => {
    const slug50 = "a".repeat(50);
    assert(isValidRoomSlug(slug50));
  });

  // Invalid slugs
  await t.step("rejects too short (< 3 chars)", () => {
    assertFalse(isValidRoomSlug("ab"));
    assertFalse(isValidRoomSlug("a"));
    assertFalse(isValidRoomSlug(""));
  });

  await t.step("rejects too long (> 50 chars)", () => {
    const slug51 = "a".repeat(51);
    assertFalse(isValidRoomSlug(slug51));
  });

  await t.step("rejects uppercase letters", () => {
    assertFalse(isValidRoomSlug("MyRoom"));
    assertFalse(isValidRoomSlug("ROOM"));
    assertFalse(isValidRoomSlug("roomA"));
  });

  await t.step("rejects starting with hyphen", () => {
    assertFalse(isValidRoomSlug("-room"));
    assertFalse(isValidRoomSlug("-abc"));
  });

  await t.step("rejects ending with hyphen", () => {
    assertFalse(isValidRoomSlug("room-"));
    assertFalse(isValidRoomSlug("abc-"));
  });

  await t.step("rejects special characters", () => {
    assertFalse(isValidRoomSlug("room_name"));
    assertFalse(isValidRoomSlug("room.name"));
    assertFalse(isValidRoomSlug("room@name"));
    assertFalse(isValidRoomSlug("room name"));
    assertFalse(isValidRoomSlug("room!name"));
  });

  await t.step("handles null and undefined (coerced to string)", () => {
    // Note: regex .test() coerces null/undefined to strings
    // "null" and "undefined" pass the pattern, this is expected JS behavior
    // In practice, validation should check for truthy input before calling
    assert(isValidRoomSlug("null") === isValidRoomSlug(null));
  });
});

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

Deno.test("isValidRoomSlug after sanitizeRoomSlug", async (t) => {
  await t.step("sanitized slug is usually valid", () => {
    const testCases = [
      "My Room",
      "UPPERCASE",
      "with_underscores",
      "multiple   spaces",
    ];

    for (const input of testCases) {
      const sanitized = sanitizeRoomSlug(input);
      if (sanitized.length >= 3) {
        assert(
          isValidRoomSlug(sanitized),
          `Sanitized "${input}" => "${sanitized}" should be valid`
        );
      }
    }
  });
});

Deno.test('url-state behaviors', async (t) => {
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
});
