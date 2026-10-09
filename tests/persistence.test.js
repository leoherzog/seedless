/**
 * Tests for persistence.js. Every step shares one localStorage, so steps use
 * unique room ids and clear every prefixed key first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { CONFIG } from '../config.js';

const STORAGE_PREFIX = CONFIG.storage.prefix;

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

const daysAgo = (days) => Date.now() - (days * 24 * 60 * 60 * 1000);

let testCounter = 0;
const uniqueRoom = () => `test-room-${Date.now()}-${testCounter++}`;

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

test('persistence', async (t) => {
  await t.test('saveTournament saves state with savedAt timestamp', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    const state = { meta: { id: roomId }, foo: 'bar' };
    const before = Date.now();
    saveTournament(roomId, state);
    const after = Date.now();

    const stored = JSON.parse(localStorage.getItem(STORAGE_PREFIX + roomId));
    assert.deepStrictEqual(stored.foo, 'bar');
    assert.deepStrictEqual(stored.meta.id, roomId);
    assert.ok(stored.savedAt != null);
    assert.deepStrictEqual(stored.savedAt >= before && stored.savedAt <= after, true);
  });

  await t.test('saveTournament returns undefined for missing roomId', () => {
    assert.deepStrictEqual(saveTournament(null, {}), undefined);
    assert.deepStrictEqual(saveTournament('', {}), undefined);
    assert.deepStrictEqual(saveTournament(undefined, {}), undefined);
  });

  await t.test('loadTournament returns null for missing roomId', () => {
    assert.deepStrictEqual(loadTournament(null), null);
    assert.deepStrictEqual(loadTournament(''), null);
    assert.deepStrictEqual(loadTournament(undefined), null);
  });

  await t.test('loadTournament returns null for non-existent data', () => {
    clearSeedlessStorage();
    assert.deepStrictEqual(loadTournament('nonexistent-room-xyz-123'), null);
  });

  await t.test('loadTournament handles corrupted JSON gracefully', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    localStorage.setItem(STORAGE_PREFIX + roomId, 'not valid json {{{');

    const loaded = loadTournament(roomId);
    assert.deepStrictEqual(loaded, null, 'Should return null for corrupted data');
    assert.deepStrictEqual(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Should delete corrupted data');
  });

  await t.test('loadTournament handles data without savedAt', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    const noTimestamp = { meta: { id: roomId } };
    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(noTimestamp));

    const loaded = loadTournament(roomId);
    assert.deepStrictEqual(loaded, null, 'Data without savedAt should be treated as expired by loadTournament');
    assert.deepStrictEqual(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Should delete data without savedAt');
  });

  await t.test('cleanupOldTournaments removes corrupted data', () => {
    clearSeedlessStorage();
    const corrupt = uniqueRoom();
    const valid = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + corrupt, 'invalid json');
    localStorage.setItem(STORAGE_PREFIX + valid, JSON.stringify({ savedAt: Date.now() }));

    cleanupOldTournaments();

    assert.deepStrictEqual(localStorage.getItem(STORAGE_PREFIX + corrupt), null, 'corrupt should be removed');
    assert.ok(localStorage.getItem(STORAGE_PREFIX + valid) != null, 'valid should remain');
  });

  await t.test('cleanupOldTournaments ignores non-prefixed keys', () => {
    const otherKey = 'other_key_' + Date.now();
    localStorage.setItem(otherKey, JSON.stringify({ savedAt: daysAgo(60) }));

    cleanupOldTournaments();

    assert.ok(localStorage.getItem(otherKey) != null, 'non-prefixed keys should not be touched');
    localStorage.removeItem(otherKey);
  });

  await t.test('savePreferences merges with existing', () => {
    clearSeedlessStorage();

    savePreferences({ theme: 'dark' });
    savePreferences({ volume: 50 });

    const prefs = loadPreferences();
    assert.deepStrictEqual(prefs.theme, 'dark');
    assert.deepStrictEqual(prefs.volume, 50);
  });

  await t.test('savePreferences overwrites duplicate keys', () => {
    clearSeedlessStorage();

    savePreferences({ theme: 'dark' });
    savePreferences({ theme: 'light' });

    const prefs = loadPreferences();
    assert.deepStrictEqual(prefs.theme, 'light');
  });

  await t.test('loadPreferences returns empty object when no data', () => {
    clearSeedlessStorage();

    const prefs = loadPreferences();
    assert.deepStrictEqual(prefs, {});
  });

  await t.test('loadPreferences handles parse error gracefully', () => {
    clearSeedlessStorage();
    localStorage.setItem(STORAGE_PREFIX + '_preferences', 'invalid json');

    const prefs = loadPreferences();
    assert.deepStrictEqual(prefs, {});
  });

  await t.test('getLastDisplayName returns empty string if not set', () => {
    clearSeedlessStorage();

    const name = getLastDisplayName();
    assert.deepStrictEqual(name, '');
  });

  await t.test('saveDisplayName / getLastDisplayName roundtrip', () => {
    clearSeedlessStorage();

    saveDisplayName('Player One');
    assert.deepStrictEqual(getLastDisplayName(), 'Player One');

    saveDisplayName('New Name');
    assert.deepStrictEqual(getLastDisplayName(), 'New Name');
  });

  await t.test('getLocalUserId generates user_ plus a UUID', () => {
    clearSeedlessStorage();

    const userId = getLocalUserId();

    assert.match(userId, /^user_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  await t.test('getLocalUserId returns same ID on subsequent calls', () => {
    clearSeedlessStorage();

    const userId1 = getLocalUserId();
    const userId2 = getLocalUserId();
    const userId3 = getLocalUserId();

    assert.deepStrictEqual(userId1, userId2);
    assert.deepStrictEqual(userId2, userId3);
  });

  await t.test('getLocalUserId persists ID in preferences', () => {
    clearSeedlessStorage();

    const userId = getLocalUserId();

    const prefs = loadPreferences();
    assert.deepStrictEqual(prefs.localUserId, userId);
  });

  await t.test('loadTournament keeps data at the 30 day boundary', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    // loadTournament takes its cutoff a few ms after daysAgo(30), so exactly 30 days would read as expired.
    const atBoundary = {
      meta: { id: roomId },
      savedAt: daysAgo(30) + 1000
    };
    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(atBoundary));

    const loaded = loadTournament(roomId);
    assert.ok(loaded != null, 'Data within the 30 day window should be kept');
  });

  await t.test('loadTournament removes data at 30 days + 1 ms', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();
    const justOverBoundary = {
      meta: { id: roomId },
      savedAt: daysAgo(30) - 1
    };
    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify(justOverBoundary));

    const loaded = loadTournament(roomId);
    assert.deepStrictEqual(loaded, null, 'Data just over 30 days should be removed');
    assert.deepStrictEqual(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Should delete expired data');
  });

  await t.test('cleanupOldTournaments skips preferences key', () => {
    clearSeedlessStorage();
    const prefsKey = STORAGE_PREFIX + '_preferences';

    localStorage.setItem(prefsKey, JSON.stringify({ theme: 'dark' }));

    cleanupOldTournaments();

    assert.ok(localStorage.getItem(prefsKey) != null, '_preferences key should not be removed');
  });

  await t.test('cleanupOldTournaments removes entries with null savedAt', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify({ meta: {}, savedAt: null }));

    cleanupOldTournaments();

    assert.deepStrictEqual(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Entry with null savedAt should be removed');
  });

  await t.test('cleanupOldTournaments removes non-object data', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + roomId, JSON.stringify('string data'));

    cleanupOldTournaments();

    assert.deepStrictEqual(localStorage.getItem(STORAGE_PREFIX + roomId), null, 'Non-object data should be removed');
  });

  await t.test('cleanupOldTournaments removes expired and corrupted entries and keeps recent ones', () => {
    clearSeedlessStorage();
    const room1 = uniqueRoom();
    const room2 = uniqueRoom();
    const room3 = uniqueRoom();

    localStorage.setItem(STORAGE_PREFIX + room1, JSON.stringify({ savedAt: daysAgo(60) }));
    localStorage.setItem(STORAGE_PREFIX + room2, 'invalid json');
    localStorage.setItem(STORAGE_PREFIX + room3, JSON.stringify({ savedAt: Date.now() }));

    cleanupOldTournaments();

    assert.deepStrictEqual(localStorage.getItem(STORAGE_PREFIX + room1), null, 'Expired data should be removed');
    assert.deepStrictEqual(localStorage.getItem(STORAGE_PREFIX + room2), null, 'Corrupted data should be removed');
    assert.ok(localStorage.getItem(STORAGE_PREFIX + room3) != null, 'Recent data should remain');
  });

  await t.test('saveTournament preserves existing data properties', () => {
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

    assert.deepStrictEqual(loaded.meta.name, 'Test');
    assert.deepStrictEqual(loaded.meta.type, 'single');
    assert.deepStrictEqual(loaded.participants[0][0], 'p1');
    assert.deepStrictEqual(loaded.bracket.rounds.length, 0);
    assert.deepStrictEqual(loaded.customField, 'custom');
  });

  await t.test('saveTournament overwrites previous save', () => {
    clearSeedlessStorage();
    const roomId = uniqueRoom();

    saveTournament(roomId, { meta: { name: 'First' } });
    saveTournament(roomId, { meta: { name: 'Second' } });

    const loaded = loadTournament(roomId);
    assert.deepStrictEqual(loaded.meta.name, 'Second');
  });

  await t.test('saveTournament retries after cleanup and logs only a final failure', () => {
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
      assert.deepStrictEqual(errors.length, 0, 'a quota error fixed by cleanup is not an error');
      assert.deepStrictEqual(localStorage.getItem(STORAGE_PREFIX + expired), null, 'cleanup ran before the retry');

      Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
      saveTournament(roomId, { meta: { name: 'Lost' } });
      assert.deepStrictEqual(errors.length, 1, 'a failed retry logs once');
    } finally {
      Storage.prototype.setItem = setItem;
      console.error = consoleError;
    }
    assert.deepStrictEqual(loadTournament(roomId).meta.name, 'Retried');
  });

  await t.test('cleanup', () => {
    clearSeedlessStorage();
  });
});
