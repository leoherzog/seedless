/**
 * Pure validators for peer payloads and the last-writer-wins rule for match
 * results. sync.js runs them before a payload reaches the store.
 */

import { CONFIG } from '../../config.js';

const MAX_NAME_LENGTH = CONFIG.validation.maxNameLength;
const MAX_MATCH_ID_LENGTH = CONFIG.validation.maxMatchIdLength;

/** Non-empty string no longer than CONFIG.validation.maxNameLength. */
export function isValidName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH;
}

/** Non-empty string no longer than CONFIG.validation.maxMatchIdLength. */
export function isValidMatchId(matchId) {
  return typeof matchId === 'string' && matchId.length > 0 && matchId.length <= MAX_MATCH_ID_LENGTH;
}

/** Two finite, non-negative numbers. */
export function isValidScores(scores) {
  return Array.isArray(scores) &&
    scores.length === 2 &&
    typeof scores[0] === 'number' &&
    typeof scores[1] === 'number' &&
    Number.isFinite(scores[0]) && scores[0] >= 0 &&
    Number.isFinite(scores[1]) && scores[1] >= 0;
}

/** Serialized state shape. meta, participants and matches may be absent; when present, meta is an object and the others are [id, value] entry arrays. */
export function isValidState(state) {
  if (!state || typeof state !== 'object') return false;

  if (state.meta !== undefined && (typeof state.meta !== 'object' || state.meta === null)) {
    return false;
  }

  if (state.participants !== undefined) {
    if (!Array.isArray(state.participants)) return false;
    for (const entry of state.participants) {
      if (!Array.isArray(entry) || entry.length !== 2) return false;
      if (typeof entry[0] !== 'string') return false;
      if (typeof entry[1] !== 'object' || entry[1] === null) return false;
    }
  }

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
 * Last-writer-wins on a per-match logical clock, then on reportedAt; the admin always wins.
 * @param {{version?: number, reportedAt?: number}} incoming - Incoming result
 * @param {{version?: number, reportedAt?: number}} existing - Stored match
 * @param {boolean} isAdmin - Whether the reporter is admin
 * @returns {boolean} True if incoming should replace existing
 */
export function shouldUpdateMatch(incoming, existing, isAdmin) {
  const incomingVersion = incoming.version || 0;
  const existingVersion = existing.version || 0;
  const incomingReportedAt = incoming.reportedAt || 0;
  const existingReportedAt = existing.reportedAt || 0;

  return isAdmin ||
    incomingVersion > existingVersion ||
    (incomingVersion === existingVersion && incomingReportedAt > existingReportedAt);
}

/** m:verify payload: matchId, scores and a string winnerId. */
export function isValidMatchVerifyPayload(payload) {
  return !!payload &&
    isValidMatchId(payload.matchId) &&
    isValidScores(payload.scores) &&
    typeof payload.winnerId === 'string';
}

/** m:result payload: a verify payload plus a numeric reportedAt. */
export function isValidMatchResultPayload(payload) {
  return isValidMatchVerifyPayload(payload) && typeof payload.reportedAt === 'number';
}

/** p:join payload: a valid name and a non-empty string localUserId. */
export function isValidParticipantJoinPayload(payload) {
  return !!payload &&
    isValidName(payload.name) &&
    typeof payload.localUserId === 'string' &&
    payload.localUserId.length > 0;
}

/** Allowlisted participant-update fields with type checks; unknown keys are rejected. */
export function isValidParticipantUpdatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;

  const allowedFields = ['name', 'seed', 'id', 'peerId', 'isConnected', 'claimedBy'];
  for (const key of Object.keys(payload)) {
    if (!allowedFields.includes(key)) return false;
  }

  if (payload.name !== undefined && !isValidName(payload.name)) return false;
  if (payload.seed !== undefined && typeof payload.seed !== 'number') return false;
  if (payload.id !== undefined && typeof payload.id !== 'string') return false;
  if (payload.peerId !== undefined && payload.peerId !== null && typeof payload.peerId !== 'string') return false;
  if (payload.isConnected !== undefined && typeof payload.isConnected !== 'boolean') return false;
  if (payload.claimedBy !== undefined && payload.claimedBy !== null && typeof payload.claimedBy !== 'string') return false;

  return true;
}
