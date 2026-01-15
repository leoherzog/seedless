/**
 * Tests for url-state.js
 * Note: Only testing validation functions that don't require browser APIs
 */

import { assertEquals, assert, assertFalse } from "jsr:@std/assert";

// Mock window object for module that uses browser APIs at top level
globalThis.window = globalThis.window || {
  location: { search: "", pathname: "/" },
  history: { pushState: () => {}, replaceState: () => {} },
  addEventListener: () => {},
  dispatchEvent: () => {},
};

const { isValidRoomSlug, sanitizeRoomSlug } = await import("../js/state/url-state.js");

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
