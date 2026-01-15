/**
 * Sync Validation and Conflict Resolution
 * Pure functions for validating sync payloads and resolving conflicts
 */

import { CONFIG } from '../../config.js';

const MAX_NAME_LENGTH = CONFIG.validation.maxNameLength;
const MAX_MATCH_ID_LENGTH = CONFIG.validation.maxMatchIdLength;

/**
 * Validate a participant name
 * @param {*} name - Value to validate
 * @returns {boolean} True if valid
 */
export function isValidName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH;
}

/**
 * Validate a match ID
 * @param {*} matchId - Value to validate
 * @returns {boolean} True if valid
 */
export function isValidMatchId(matchId) {
  return typeof matchId === 'string' && matchId.length > 0 && matchId.length <= MAX_MATCH_ID_LENGTH;
}

/**
 * Validate a scores array
 * @param {*} scores - Value to validate
 * @returns {boolean} True if valid
 */
export function isValidScores(scores) {
  return Array.isArray(scores) &&
    scores.length === 2 &&
    typeof scores[0] === 'number' &&
    typeof scores[1] === 'number';
}

/**
 * Validate incoming state object structure
 * @param {Object} state - State object to validate
 * @returns {boolean} True if valid
 */
export function isValidState(state) {
  if (!state || typeof state !== 'object') return false;

  // Meta must be an object if present
  if (state.meta !== undefined && (typeof state.meta !== 'object' || state.meta === null)) {
    return false;
  }

  // Participants must be an array of [id, participant] entries if present
  if (state.participants !== undefined) {
    if (!Array.isArray(state.participants)) return false;
    for (const entry of state.participants) {
      if (!Array.isArray(entry) || entry.length !== 2) return false;
      if (typeof entry[0] !== 'string') return false;
      if (typeof entry[1] !== 'object' || entry[1] === null) return false;
    }
  }

  // Matches must be an array of [id, match] entries if present
  if (state.matches !== undefined) {
    if (!Array.isArray(state.matches)) return false;
    for (const entry of state.matches) {
      if (!Array.isArray(entry) || entry.length !== 2) return false;
      if (typeof entry[0] !== 'string') return false;
    }
  }

  return true;
}

/**
 * Determine if an incoming match result should update the existing match.
 * Uses Last-Writer-Wins (LWW) with logical clock for conflict resolution.
 *
 * @param {Object} incoming - Incoming match result
 * @param {number} incoming.version - Logical clock version
 * @param {number} incoming.reportedAt - Timestamp when reported
 * @param {Object} existing - Existing match state
 * @param {number} [existing.version] - Existing version (default 0)
 * @param {number} [existing.reportedAt] - Existing timestamp (default 0)
 * @param {string} [existing.verifiedBy] - User ID who verified the match
 * @param {boolean} isAdmin - Whether the reporter is admin
 * @returns {boolean} True if incoming should replace existing
 */
export function shouldUpdateMatch(incoming, existing, isAdmin) {
  const incomingVersion = incoming.version || 0;
  const existingVersion = existing.version || 0;
  const incomingReportedAt = incoming.reportedAt || 0;
  const existingReportedAt = existing.reportedAt || 0;

  // Accept update if:
  // 1. Higher version (logical clock)
  if (incomingVersion > existingVersion) {
    return true;
  }

  // 2. Same version but newer timestamp
  if (incomingVersion === existingVersion && incomingReportedAt > existingReportedAt) {
    return true;
  }

  // 3. Admin can always override (even verified matches)
  if (isAdmin) {
    return true;
  }

  return false;
}

/**
 * Validate a match result payload structure
 * @param {Object} payload - Payload to validate
 * @returns {boolean} True if valid
 */
export function isValidMatchResultPayload(payload) {
  return payload &&
    isValidMatchId(payload.matchId) &&
    isValidScores(payload.scores) &&
    typeof payload.winnerId === 'string' &&
    typeof payload.reportedAt === 'number';
}

/**
 * Validate a participant join payload
 * @param {Object} payload - Payload to validate
 * @returns {boolean} True if valid
 */
export function isValidParticipantJoinPayload(payload) {
  return payload && isValidName(payload.name);
}
