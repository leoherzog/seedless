/**
 * localStorage Persistence
 * Save and load tournament state
 */

import { CONFIG } from '../../config.js';

const STORAGE_PREFIX = CONFIG.storage.prefix;
const RETENTION_DAYS = CONFIG.storage.retentionDays;

/**
 * Save tournament state to localStorage
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
  } catch (e) {
    console.error('Failed to save tournament state:', e);
    // Try to make room by cleaning up old tournaments
    cleanupOldTournaments();
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e2) {
      console.error('Still failed after cleanup:', e2);
    }
  }
}

/**
 * Load tournament state from localStorage
 * @param {string} roomId - Room identifier
 * @returns {Object|null} Stored state or null
 */
export function loadTournament(roomId) {
  if (!roomId) return null;

  const key = STORAGE_PREFIX + roomId;
  const stored = localStorage.getItem(key);

  if (!stored) return null;

  try {
    const data = JSON.parse(stored);

    // Check if data is too old
    const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    if (data.savedAt && data.savedAt < cutoff) {
      localStorage.removeItem(key);
      return null;
    }

    return data;
  } catch (e) {
    console.error('Failed to parse stored tournament:', e);
    localStorage.removeItem(key);
    return null;
  }
}

/**
 * Clean up old tournaments
 * Removes tournaments older than retention period
 */
export function cleanupOldTournaments() {
  const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
  let cleaned = 0;

  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) {
      try {
        const stored = localStorage.getItem(key);
        if (stored) {
          const data = JSON.parse(stored);
          if (!data.savedAt || data.savedAt < cutoff) {
            localStorage.removeItem(key);
            cleaned++;
          }
        }
      } catch (e) {
        // Invalid data, remove it
        localStorage.removeItem(key);
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    console.info(`[Seedless] Cleaned up ${cleaned} old tournament(s)`);
  }

  return cleaned;
}

/**
 * Save local preferences (name, settings)
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
 * Load local preferences
 * @returns {Object} Stored preferences
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
 * Get last used display name
 * @returns {string} Display name or empty string
 */
export function getLastDisplayName() {
  const prefs = loadPreferences();
  return prefs.displayName || '';
}

/**
 * Save last used display name
 * @param {string} name - Display name
 */
export function saveDisplayName(name) {
  savePreferences({ displayName: name });
}

/**
 * Get or create a persistent local user ID
 * This ID persists across page refreshes, unlike the Trystero peerId
 * @returns {string} Persistent user ID
 */
export function getLocalUserId() {
  const prefs = loadPreferences();
  if (prefs.odocalUserId) {
    return prefs.odocalUserId;
  }
  // Generate a new persistent ID
  const odocalUserId = 'user_' + generateAdminToken().slice(0, 16);
  savePreferences({ odocalUserId: odocalUserId });
  return odocalUserId;
}

/**
 * Save admin token for a room
 * Admin tokens allow the original admin to reclaim admin status after page refresh
 * @param {string} roomId - Room identifier
 * @param {string} token - Admin token (random string)
 */
export function saveAdminToken(roomId, token) {
  if (!roomId || !token) return;
  const key = STORAGE_PREFIX + roomId + '_admin';
  try {
    localStorage.setItem(key, token);
  } catch (e) {
    console.error('Failed to save admin token:', e);
  }
}

/**
 * Load admin token for a room
 * @param {string} roomId - Room identifier
 * @returns {string|null} Admin token or null
 */
export function loadAdminToken(roomId) {
  if (!roomId) return null;
  const key = STORAGE_PREFIX + roomId + '_admin';
  return localStorage.getItem(key);
}

/**
 * Delete admin token for a room
 * @param {string} roomId - Room identifier
 */
export function deleteAdminToken(roomId) {
  if (!roomId) return;
  const key = STORAGE_PREFIX + roomId + '_admin';
  localStorage.removeItem(key);
}

/**
 * Generate a random admin token
 * @returns {string} Random token
 */
export function generateAdminToken() {
  const array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// Run cleanup on module load
cleanupOldTournaments();
