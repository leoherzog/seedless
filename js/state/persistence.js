/**
 * localStorage persistence for tournament snapshots, preferences and the persistent user ID.
 * Importing this module prunes expired tournaments.
 */

import { CONFIG } from '../../config.js';

const STORAGE_PREFIX = CONFIG.storage.prefix;
const RETENTION_MS = CONFIG.storage.retentionDays * 24 * 60 * 60 * 1000;

/**
 * Save a tournament snapshot stamped with savedAt, which drives retention.
 * @param {string} roomId - Room identifier
 * @param {Object} state - State to save
 */
export function saveTournament(roomId, state) {
  if (!roomId) return;

  const key = STORAGE_PREFIX + roomId;
  const data = {
    ...state,
    savedAt: Date.now(),
  };

  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Likely over quota: prune expired tournaments, then retry once.
    cleanupOldTournaments();
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.error('Failed to save tournament state:', e);
    }
  }
}

/** Return the stored tournament under key if it is fresh; otherwise remove it and return null. */
function readTournament(key) {
  try {
    const data = JSON.parse(localStorage.getItem(key));
    if (data?.savedAt >= Date.now() - RETENTION_MS) return data;
  } catch {
    // Unparseable entries are removed below.
  }
  localStorage.removeItem(key);
  return null;
}

/**
 * Load a tournament snapshot, discarding it if expired or corrupt.
 * @param {string} roomId - Room identifier
 * @returns {Object|null} Stored state or null
 */
export function loadTournament(roomId) {
  return roomId ? readTournament(STORAGE_PREFIX + roomId) : null;
}

/** Remove expired, corrupted and undated tournaments. Preserves the preferences key. */
export function cleanupOldTournaments() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX) && !key.endsWith('_preferences')) {
      readTournament(key);
    }
  }
}

/**
 * Merge into stored preferences (displayName, localUserId).
 * @param {Object} prefs - Preferences to save
 */
export function savePreferences(prefs) {
  const key = STORAGE_PREFIX + '_preferences';
  try {
    const existing = loadPreferences();
    localStorage.setItem(key, JSON.stringify({ ...existing, ...prefs }));
  } catch (e) {
    console.error('Failed to save preferences:', e);
  }
}

/**
 * Load local preferences.
 * @returns {Object} Stored preferences, or {} if absent or corrupt
 */
export function loadPreferences() {
  const key = STORAGE_PREFIX + '_preferences';
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Get the last used display name.
 * @returns {string} Display name or empty string
 */
export function getLastDisplayName() {
  const prefs = loadPreferences();
  return prefs.displayName || '';
}

/**
 * Save the last used display name.
 * @param {string} name - Display name
 */
export function saveDisplayName(name) {
  savePreferences({ displayName: name });
}

/**
 * Get or create the local user ID, which survives page refreshes unlike the Trystero peerId.
 * @returns {string} Persistent user ID
 */
export function getLocalUserId() {
  const prefs = loadPreferences();
  if (prefs.localUserId) {
    return prefs.localUserId;
  }
  const localUserId = `user_${crypto.randomUUID()}`;
  savePreferences({ localUserId });
  return localUserId;
}

cleanupOldTournaments();
