/**
 * Tests for localStorage Persistence
 *
 * Uses Deno's built-in localStorage (which persists to disk).
 * Each test clears localStorage to ensure isolation.
 */

import { assertEquals, assertExists, assertMatch } from 'jsr:@std/assert';

import { CONFIG } from '../config.js';

const STORAGE_PREFIX = CONFIG.storage.prefix;

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

    // Data without savedAt counts as expired
    const loaded = loadTournament(roomId);
    assertEquals(loaded, null, 'Data without savedAt should be treated as expired by loadTournament');
    assertEquals(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Should delete data without savedAt');
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

  // getLocalUserId tests
  await t.step('getLocalUserId generates user_ plus a UUID', () => {
    clearSeedlessStorage();

    const userId = getLocalUserId();

    assertMatch(userId, /^user_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
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

  // Boundary condition tests
  await t.step('loadTournament keeps data at the 30 day boundary', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    // Just inside the 30-day window. A 1s buffer keeps this deterministic:
    // loadTournament recomputes `Date.now() - 30d` a few ms after we capture
    // daysAgo(30), and the expiry check is strict (savedAt < cutoff), so a
    // record saved *exactly* 30 days ago would flake as "just expired".
    const atBoundary = {
      meta: { id: roomId },
      savedAt: daysAgo(30) + 1000
    };
    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(atBoundary));

    const loaded = loadTournament(roomId);
    assertExists(loaded, 'Data within the 30 day window should be kept');
  });

  await t.step('loadTournament removes data at 30 days + 1 ms', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    // Just over 30 days ago
    const justOverBoundary = {
      meta: { id: roomId },
      savedAt: daysAgo(30) - 1
    };
    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(justOverBoundary));

    const loaded = loadTournament(roomId);
    assertEquals(loaded, null, 'Data just over 30 days should be removed');
    assertEquals(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Should delete expired data');
  });

  // cleanupOldTournaments edge cases
  await t.step('cleanupOldTournaments skips preferences key', () => {
    clearSeedlessStorage();
    const prefsKey = STORAGE_PREFIX + '_preferences';

    localStorage.setItem(prefsKey, JSON.stringify({ theme: 'dark' }));

    cleanupOldTournaments();

    assertExists(localStorage.getItem(prefsKey), '_preferences key should not be removed');
  });

  await t.step('cleanupOldTournaments removes entries with null savedAt', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify({ meta: {}, savedAt: null }));

    cleanupOldTournaments();

    assertEquals(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Entry with null savedAt should be removed');
  });

  await t.step('cleanupOldTournaments removes non-object data', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify('string data'));

    cleanupOldTournaments();

    assertEquals(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Non-object data should be removed');
  });

  await t.step('cleanupOldTournaments removes expired and corrupted entries and keeps recent ones', () => {
    clearSeedlessStorage();
    const room1 = uniqueRoom();
    const room2 = uniqueRoom();
    const room3 = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + room1, JSON.stringify({ savedAt: daysAgo(60) }));
    localStorage.setItem(STORAGE_PREFIX + room2, 'invalid json');
    localStorage.setItem(STORAGE_PREFIX + room3, JSON.stringify({ savedAt: Date.now() }));

    cleanupOldTournaments();

    assertEquals(localStorage.getItem(STORAGE_PREFIX + room1), null, 'Expired data should be removed');
    assertEquals(localStorage.getItem(STORAGE_PREFIX + room2), null, 'Corrupted data should be removed');
    assertExists(localStorage.getItem(STORAGE_PREFIX + room3), 'Recent data should remain');
  });

  // saveTournament additional tests
  await t.step('saveTournament preserves existing data properties', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    const state = {
      meta: { name: 'Test', type: 'single' },
      participants: [['p1', { name: 'Player 1' }]],
      bracket: { rounds: [] },
      customField: 'custom'
    };

    saveTournament(roomId, state);
    const loaded = loadTournament(roomId);

    assertEquals(loaded.meta.name, 'Test');
    assertEquals(loaded.meta.type, 'single');
    assertEquals(loaded.participants[0][0], 'p1');
    assertEquals(loaded.bracket.rounds.length, 0);
    assertEquals(loaded.customField, 'custom');
  });

  await t.step('saveTournament overwrites previous save', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();

    saveTournament(roomId, { meta: { name: 'First' } });
    saveTournament(roomId, { meta: { name: 'Second' } });

    const loaded = loadTournament(roomId);
    assertEquals(loaded.meta.name, 'Second');
  });

  await t.step('saveTournament retries after cleanup and logs only a final failure', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    const expired = uniqueRoom();
    localStorage.setItem(STORAGE_PREFIX + expired, JSON.stringify({ savedAt: daysAgo(60) }));

    const setItem = Storage.prototype.setItem;
    const consoleError = console.error;
    const errors = [];
    console.error = (...args) => errors.push(args);
    let calls = 0;
    try {
      Storage.prototype.setItem = function (...args) {
        if (calls++ === 0) throw new DOMException('full', 'QuotaExceededError');
        return setItem.apply(this, args);
      };
      saveTournament(roomId, { meta: { name: 'Retried' } });
      assertEquals(errors.length, 0, 'a quota error fixed by cleanup is not an error');
      assertEquals(localStorage.getItem(STORAGE_PREFIX + expired), null, 'cleanup ran before the retry');

      Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
      saveTournament(roomId, { meta: { name: 'Lost' } });
      assertEquals(errors.length, 1, 'a failed retry logs once');
    } finally {
      Storage.prototype.setItem = setItem;
      console.error = consoleError;
    }
    assertEquals(loadTournament(roomId).meta.name, 'Retried');
  });

  // Final cleanup
  await t.step('cleanup', () => {
    clearSeedlessStorage();
  });
});
