/**
 * Tests for localStorage Persistence
 *
 * Uses Deno's built-in localStorage (which persists to disk).
 * Each test clears localStorage to ensure isolation.
 */

import { assertEquals, assertExists, assertMatch } from 'jsr:@std/assert';

// Storage prefix must match config.js
const STORAGE_PREFIX = 'seedless_';

// Import persistence module
const {
  saveTournament,
  loadTournament,
  cleanupOldTournaments,
  savePreferences,
  loadPreferences,
  getLastDisplayName,
  saveDisplayName,
  getLocalUserId,
  saveAdminToken,
  loadAdminToken,
  generateAdminToken
} = await import('../js/state/persistence.js');

// Helper to create timestamps
const daysAgo = (days) => Date.now() - (days * 24 * 60 * 60 * 1000);

// Use unique room IDs to prevent test interference
let testCounter = 0;
const uniqueRoom = () => `test-room-${Date.now()}-${testCounter++}`;

// Helper to clear all seedless keys from localStorage
function clearSeedlessStorage() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key));
}

Deno.test('persistence', async (t) => {
  // saveTournament / loadTournament tests
  await t.step('saveTournament saves state with savedAt timestamp', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    const state = { meta: { id: roomId }, foo: 'bar' };
    const before = Date.now();
    saveTournament(roomId, state);
    const after = Date.now();

    const stored = JSON.parse(localStorage.getItem(STORAGE_PREFIX + roomId));
    assertEquals(stored.foo, 'bar');
    assertEquals(stored.meta.id, roomId);
    assertExists(stored.savedAt);
    assertEquals(stored.savedAt >= before && stored.savedAt <= after, true);
  });

  await t.step('loadTournament loads saved state correctly', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    const state = { meta: { name: 'Test Tournament' }, players: [1, 2, 3] };
    saveTournament(roomId, state);

    const loaded = loadTournament(roomId);
    assertEquals(loaded.meta.name, 'Test Tournament');
    assertEquals(loaded.players, [1, 2, 3]);
    assertExists(loaded.savedAt);
  });

  await t.step('saveTournament returns undefined for missing roomId', () => {
    assertEquals(saveTournament(null, {}), undefined);
    assertEquals(saveTournament('', {}), undefined);
    assertEquals(saveTournament(undefined, {}), undefined);
  });

  await t.step('loadTournament returns null for missing roomId', () => {
    assertEquals(loadTournament(null), null);
    assertEquals(loadTournament(''), null);
    assertEquals(loadTournament(undefined), null);
  });

  await t.step('loadTournament returns null for non-existent data', () => {
    clearSeedlessStorage();
    assertEquals(loadTournament('nonexistent-room-xyz-123'), null);
  });

  await t.step('loadTournament auto-deletes expired data (>30 days)', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    const oldData = {
      meta: { id: roomId },
      savedAt: daysAgo(31)
    };
    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(oldData));

    const loaded = loadTournament(roomId);
    assertEquals(loaded, null, 'Should return null for expired data');
    assertEquals(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Should delete expired data');
  });

  await t.step('loadTournament keeps data within retention period', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    const recentData = {
      meta: { id: roomId },
      savedAt: daysAgo(29)
    };
    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(recentData));

    const loaded = loadTournament(roomId);
    assertExists(loaded, 'Should return data within retention period');
    assertEquals(loaded.meta.id, roomId);
  });

  await t.step('loadTournament handles corrupted JSON gracefully', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    localStorage.setItem(STORAGE_PREFIX + roomId, 'not valid json {{{');

    const loaded = loadTournament(roomId);
    assertEquals(loaded, null, 'Should return null for corrupted data');
    assertEquals(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Should delete corrupted data');
  });

  await t.step('loadTournament handles data without savedAt', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    const noTimestamp = { meta: { id: roomId } };
    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(noTimestamp));

    // loadTournament checks: if (data.savedAt && data.savedAt < cutoff)
    // When savedAt is missing/falsy, this evaluates to false, so data is kept
    const loaded = loadTournament(roomId);
    assertExists(loaded, 'Data without savedAt should be kept by loadTournament');
  });

  // cleanupOldTournaments tests
  await t.step('cleanupOldTournaments removes old tournaments', () => {
    clearSeedlessStorage();
    const old1 = uniqueRoom();
    const old2 = uniqueRoom();
    const recent = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + old1, JSON.stringify({ savedAt: daysAgo(31) }));
    localStorage.setItem(STORAGE_PREFIX + old2, JSON.stringify({ savedAt: daysAgo(60) }));
    localStorage.setItem(STORAGE_PREFIX + recent, JSON.stringify({ savedAt: Date.now() }));

    cleanupOldTournaments();

    assertEquals(localStorage.getItem(STORAGE_PREFIX + old1), null, 'old1 should be removed');
    assertEquals(localStorage.getItem(STORAGE_PREFIX + old2), null, 'old2 should be removed');
    assertExists(localStorage.getItem(STORAGE_PREFIX + recent), 'recent should remain');
  });

  await t.step('cleanupOldTournaments keeps recent tournaments', () => {
    clearSeedlessStorage();
    const new1 = uniqueRoom();
    const new2 = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + new1, JSON.stringify({ savedAt: Date.now() }));
    localStorage.setItem(STORAGE_PREFIX + new2, JSON.stringify({ savedAt: daysAgo(15) }));

    cleanupOldTournaments();

    assertExists(localStorage.getItem(STORAGE_PREFIX + new1));
    assertExists(localStorage.getItem(STORAGE_PREFIX + new2));
  });

  await t.step('cleanupOldTournaments removes corrupted data', () => {
    clearSeedlessStorage();
    const corrupt = uniqueRoom();
    const valid = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + corrupt, 'invalid json');
    localStorage.setItem(STORAGE_PREFIX + valid, JSON.stringify({ savedAt: Date.now() }));

    cleanupOldTournaments();

    assertEquals(localStorage.getItem(STORAGE_PREFIX + corrupt), null, 'corrupt should be removed');
    assertExists(localStorage.getItem(STORAGE_PREFIX + valid), 'valid should remain');
  });

  await t.step('cleanupOldTournaments removes data without savedAt', () => {
    clearSeedlessStorage();
    const noTs = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + noTs, JSON.stringify({ meta: {} }));

    cleanupOldTournaments();

    assertEquals(localStorage.getItem(STORAGE_PREFIX + noTs), null, 'data without savedAt should be removed');
  });

  await t.step('cleanupOldTournaments ignores non-prefixed keys', () => {
    const otherKey = 'other_key_' + Date.now();
    localStorage.setItem(otherKey, JSON.stringify({ savedAt: daysAgo(60) }));

    cleanupOldTournaments();

    assertExists(localStorage.getItem(otherKey), 'non-prefixed keys should not be touched');
    localStorage.removeItem(otherKey); // cleanup
  });

  // Preferences tests
  await t.step('savePreferences merges with existing', () => {
    clearSeedlessStorage();

    savePreferences({ theme: 'dark' });
    savePreferences({ volume: 50 });

    const prefs = loadPreferences();
    assertEquals(prefs.theme, 'dark');
    assertEquals(prefs.volume, 50);
  });

  await t.step('savePreferences overwrites duplicate keys', () => {
    clearSeedlessStorage();

    savePreferences({ theme: 'dark' });
    savePreferences({ theme: 'light' });

    const prefs = loadPreferences();
    assertEquals(prefs.theme, 'light');
  });

  await t.step('loadPreferences returns empty object when no data', () => {
    clearSeedlessStorage();

    const prefs = loadPreferences();
    assertEquals(prefs, {});
  });

  await t.step('loadPreferences handles parse error gracefully', () => {
    clearSeedlessStorage();
    localStorage.setItem(STORAGE_PREFIX + '_preferences', 'invalid json');

    const prefs = loadPreferences();
    assertEquals(prefs, {});
  });

  // Display name tests
  await t.step('getLastDisplayName returns empty string if not set', () => {
    clearSeedlessStorage();

    const name = getLastDisplayName();
    assertEquals(name, '');
  });

  await t.step('saveDisplayName / getLastDisplayName roundtrip', () => {
    clearSeedlessStorage();

    saveDisplayName('Player One');
    assertEquals(getLastDisplayName(), 'Player One');

    saveDisplayName('New Name');
    assertEquals(getLastDisplayName(), 'New Name');
  });

  // Admin token tests
  await t.step('saveAdminToken / loadAdminToken roundtrip', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    saveAdminToken(roomId, 'secret-token-abc');
    assertEquals(loadAdminToken(roomId), 'secret-token-abc');
  });

  await t.step('loadAdminToken returns null for missing token', () => {
    clearSeedlessStorage();
    assertEquals(loadAdminToken('nonexistent-room-' + Date.now()), null);
  });

  await t.step('saveAdminToken skips if roomId is falsy', () => {
    clearSeedlessStorage();
    const before = localStorage.length;
    saveAdminToken(null, 'token');
    saveAdminToken('', 'token');
    assertEquals(localStorage.length, before);
  });

  await t.step('saveAdminToken skips if token is falsy', () => {
    clearSeedlessStorage();
    const before = localStorage.length;
    saveAdminToken('room-' + Date.now(), null);
    saveAdminToken('room2-' + Date.now(), '');
    assertEquals(localStorage.length, before);
  });

  await t.step('loadAdminToken returns null if roomId is falsy', () => {
    assertEquals(loadAdminToken(null), null);
    assertEquals(loadAdminToken(''), null);
  });

  // generateAdminToken tests
  await t.step('generateAdminToken returns 48-character hex string', () => {
    const token = generateAdminToken();

    assertEquals(token.length, 48, 'Token should be 48 characters (24 bytes * 2 hex chars)');
    assertMatch(token, /^[0-9a-f]+$/, 'Token should contain only hex characters');
  });

  await t.step('generateAdminToken generates different tokens on each call', () => {
    const token1 = generateAdminToken();
    const token2 = generateAdminToken();

    assertEquals(token1 !== token2, true, 'Tokens should be different');
  });

  await t.step('generateAdminToken tokens are cryptographically random', () => {
    const tokens = new Set();
    for (let i = 0; i < 10; i++) {
      tokens.add(generateAdminToken());
    }
    assertEquals(tokens.size, 10, 'All 10 tokens should be unique');
  });

  // getLocalUserId tests
  await t.step('getLocalUserId generates new ID on first call', () => {
    clearSeedlessStorage();

    const userId = getLocalUserId();

    assertExists(userId);
    assertEquals(userId.startsWith('user_'), true, 'Should start with user_ prefix');
    assertEquals(userId.length, 5 + 16, 'Should be user_ + 16 hex chars');
  });

  await t.step('getLocalUserId returns same ID on subsequent calls', () => {
    clearSeedlessStorage();

    const userId1 = getLocalUserId();
    const userId2 = getLocalUserId();
    const userId3 = getLocalUserId();

    assertEquals(userId1, userId2);
    assertEquals(userId2, userId3);
  });

  await t.step('getLocalUserId persists ID in preferences', () => {
    clearSeedlessStorage();

    const userId = getLocalUserId();

    const prefs = loadPreferences();
    assertEquals(prefs.localUserId, userId);
  });

  await t.step('getLocalUserId format uses hex characters', () => {
    clearSeedlessStorage();

    const userId = getLocalUserId();
    const hexPart = userId.slice(5);

    assertMatch(hexPart, /^[0-9a-f]+$/, 'Should contain only hex characters');
  });

  // Final cleanup
  await t.step('cleanup', () => {
    clearSeedlessStorage();
  });
});
