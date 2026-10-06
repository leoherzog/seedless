/**
 * Pure validators for peer payloads. sync.js runs them before a payload reaches the store.
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

// A missing optional field is undefined or null.
const optional = (value, check) => value === undefined || value === null || check(value);
const isString = (value) => typeof value === 'string';

/** A match or Points Race game: a participants array and well-typed result fields. */
function isValidMatch(match) {
  return typeof match === 'object' && match !== null &&
    Array.isArray(match.participants) &&
    optional(match.winnerId, isString) &&
    optional(match.scores, isValidScores) &&
    optional(match.results, Array.isArray) &&
    optional(match.reportedBy, isString) &&
    optional(match.reportedAt, Number.isFinite) &&
    optional(match.version, Number.isFinite) &&
    optional(match.verifiedBy, isString);
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
      if (!isValidMatch(entry[1])) return false;
    }
  }

  return true;
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

/** r:result payload: a game id, a finishing order of participant ids, a finite reportedAt and an optional version. */
export function isValidRaceResultPayload(payload) {
  return !!payload &&
    isValidMatchId(payload.gameId) &&
    Array.isArray(payload.results) &&
    payload.results.every((r) => isString(r?.participantId)) &&
    Number.isFinite(payload.reportedAt) &&
    optional(payload.version, Number.isFinite);
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
