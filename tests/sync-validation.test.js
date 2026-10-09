/**
 * Tests for the payload validators in sync-validators.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidName,
  isValidMatchId,
  isValidScores,
  isValidState,
  isValidMatchResultPayload,
  isValidMatchVerifyPayload,
  isValidRaceResultPayload,
  isValidParticipantJoinPayload,
  isValidParticipantUpdatePayload
} from '../js/network/sync-validators.js';

test('isValidName', async (t) => {
  await t.test('accepts valid names', () => {
    assert.deepStrictEqual(isValidName('Alice'), true);
    assert.deepStrictEqual(isValidName('Bob'), true);
    assert.deepStrictEqual(isValidName('Player 1'), true);
    assert.deepStrictEqual(isValidName('a'), true);
    assert.deepStrictEqual(isValidName('A'.repeat(100)), true); // max length
  });

  await t.test('rejects empty strings', () => {
    assert.deepStrictEqual(isValidName(''), false);
  });

  await t.test('rejects non-strings', () => {
    assert.deepStrictEqual(isValidName(null), false);
    assert.deepStrictEqual(isValidName(undefined), false);
    assert.deepStrictEqual(isValidName(123), false);
    assert.deepStrictEqual(isValidName({}), false);
    assert.deepStrictEqual(isValidName([]), false);
  });

  await t.test('rejects names exceeding max length', () => {
    assert.deepStrictEqual(isValidName('A'.repeat(101)), false);
    assert.deepStrictEqual(isValidName('A'.repeat(200)), false);
  });
});

test('isValidMatchId', async (t) => {
  await t.test('accepts valid match IDs', () => {
    assert.deepStrictEqual(isValidMatchId('match-1'), true);
    assert.deepStrictEqual(isValidMatchId('r1m1'), true);
    assert.deepStrictEqual(isValidMatchId('gf1'), true);
    assert.deepStrictEqual(isValidMatchId('a'), true);
    assert.deepStrictEqual(isValidMatchId('A'.repeat(50)), true); // max length
  });

  await t.test('rejects empty strings', () => {
    assert.deepStrictEqual(isValidMatchId(''), false);
  });

  await t.test('rejects non-strings', () => {
    assert.deepStrictEqual(isValidMatchId(null), false);
    assert.deepStrictEqual(isValidMatchId(undefined), false);
    assert.deepStrictEqual(isValidMatchId(123), false);
    assert.deepStrictEqual(isValidMatchId({}), false);
  });

  await t.test('rejects IDs exceeding max length', () => {
    assert.deepStrictEqual(isValidMatchId('A'.repeat(51)), false);
    assert.deepStrictEqual(isValidMatchId('A'.repeat(100)), false);
  });
});

test('isValidScores', async (t) => {
  await t.test('accepts valid scores', () => {
    assert.deepStrictEqual(isValidScores([3, 2]), true);
    assert.deepStrictEqual(isValidScores([0, 0]), true);
    assert.deepStrictEqual(isValidScores([100, 50]), true);
    assert.deepStrictEqual(isValidScores([1.5, 2.5]), true);
  });

  await t.test('rejects negative scores', () => {
    assert.deepStrictEqual(isValidScores([-1, 1]), false);
    assert.deepStrictEqual(isValidScores([1, -1]), false);
    assert.deepStrictEqual(isValidScores([-1, -1]), false);
  });

  await t.test('rejects non-finite numbers', () => {
    assert.deepStrictEqual(isValidScores([Infinity, 0]), false);
    assert.deepStrictEqual(isValidScores([0, -Infinity]), false);
    assert.deepStrictEqual(isValidScores([NaN, 0]), false);
    assert.deepStrictEqual(isValidScores([0, NaN]), false);
  });

  await t.test('rejects non-arrays', () => {
    assert.deepStrictEqual(isValidScores(null), false);
    assert.deepStrictEqual(isValidScores(undefined), false);
    assert.deepStrictEqual(isValidScores('3-2'), false);
    assert.deepStrictEqual(isValidScores({ a: 3, b: 2 }), false);
  });

  await t.test('rejects arrays with wrong length', () => {
    assert.deepStrictEqual(isValidScores([]), false);
    assert.deepStrictEqual(isValidScores([3]), false);
    assert.deepStrictEqual(isValidScores([3, 2, 1]), false);
  });

  await t.test('rejects arrays with non-number elements', () => {
    assert.deepStrictEqual(isValidScores(['3', '2']), false);
    assert.deepStrictEqual(isValidScores([3, '2']), false);
    assert.deepStrictEqual(isValidScores([null, 2]), false);
    assert.deepStrictEqual(isValidScores([3, undefined]), false);
  });
});

test('isValidState', async (t) => {
  await t.test('accepts minimal valid state', () => {
    assert.deepStrictEqual(isValidState({}), true);
    assert.deepStrictEqual(isValidState({ meta: {} }), true);
    assert.deepStrictEqual(isValidState({ participants: [], matches: [] }), true);
  });

  await t.test('accepts state with valid meta', () => {
    assert.deepStrictEqual(isValidState({ meta: { id: 'room', status: 'lobby' } }), true);
    assert.deepStrictEqual(isValidState({ meta: { adminId: 'user1' } }), true);
  });

  await t.test('accepts state with valid participants', () => {
    assert.deepStrictEqual(isValidState({
      participants: [
        ['user1', { id: 'user1', name: 'Alice' }],
        ['user2', { id: 'user2', name: 'Bob' }]
      ]
    }), true);
  });

  await t.test('accepts state with valid matches', () => {
    assert.deepStrictEqual(isValidState({
      matches: [
        ['match1', { id: 'match1', participants: ['user1', 'user2'] }]
      ]
    }), true);
  });

  await t.test('accepts complete valid state', () => {
    assert.deepStrictEqual(isValidState({
      meta: { id: 'room', status: 'active' },
      participants: [['user1', { name: 'Alice' }]],
      matches: [['match1', { participants: [] }]]
    }), true);
  });

  await t.test('rejects null/undefined', () => {
    assert.deepStrictEqual(isValidState(null), false);
    assert.deepStrictEqual(isValidState(undefined), false);
  });

  await t.test('rejects non-objects', () => {
    assert.deepStrictEqual(isValidState('state'), false);
    assert.deepStrictEqual(isValidState(123), false);
    // An empty array passes: it has no invalid meta, participants or matches.
  });

  await t.test('rejects invalid meta', () => {
    assert.deepStrictEqual(isValidState({ meta: null }), false);
    assert.deepStrictEqual(isValidState({ meta: 'invalid' }), false);
    assert.deepStrictEqual(isValidState({ meta: 123 }), false);
  });

  await t.test('rejects invalid participants format', () => {
    assert.deepStrictEqual(isValidState({ participants: 'invalid' }), false);
    assert.deepStrictEqual(isValidState({ participants: {} }), false);
    assert.deepStrictEqual(isValidState({ participants: ['user1', 'user2'] }), false);
    assert.deepStrictEqual(isValidState({ participants: [['user1']] }), false);
    assert.deepStrictEqual(isValidState({ participants: [['user1', {}, 'extra']] }), false);
    assert.deepStrictEqual(isValidState({ participants: [[123, {}]] }), false);
    assert.deepStrictEqual(isValidState({ participants: [['user1', 'invalid']] }), false);
    assert.deepStrictEqual(isValidState({ participants: [['user1', null]] }), false);
  });

  await t.test('rejects invalid matches format', () => {
    assert.deepStrictEqual(isValidState({ matches: 'invalid' }), false);
    assert.deepStrictEqual(isValidState({ matches: ['match1'] }), false);
    assert.deepStrictEqual(isValidState({ matches: [['match1']] }), false);
    assert.deepStrictEqual(isValidState({ matches: [[123, {}]] }), false);
  });

  await t.test('rejects a match that is not an object with participants and typed result fields', () => {
    const match = (fields) => ({ matches: [['m1', { participants: ['a', 'b'], ...fields }]] });
    assert.deepStrictEqual(isValidState({ matches: [['m1', null]] }), false);
    assert.deepStrictEqual(isValidState({ matches: [['m1', {}]] }), false);
    assert.deepStrictEqual(isValidState(match({ winnerId: 5 })), false);
    assert.deepStrictEqual(isValidState(match({ scores: ['2', 0] })), false);
    assert.deepStrictEqual(isValidState(match({ results: 'a' })), false);
    assert.deepStrictEqual(isValidState(match({ reportedAt: '1' })), false);
    assert.deepStrictEqual(isValidState(match({ version: NaN })), false);
    assert.deepStrictEqual(isValidState(match({ verifiedBy: {} })), false);
    assert.deepStrictEqual(isValidState(match({ winnerId: null, scores: [2, 1], reportedAt: 1, version: 2 })), true);
  });
});

test('isValidRaceResultPayload', async (t) => {
  const valid = { gameId: 'game1', results: [{ participantId: 'a' }, { participantId: 'b' }], reportedAt: 1000, version: 1 };

  await t.test('accepts a valid payload, with or without version', () => {
    assert.deepStrictEqual(isValidRaceResultPayload(valid), true);
    assert.deepStrictEqual(isValidRaceResultPayload({ ...valid, version: undefined }), true);
  });

  await t.test('rejects a missing or non-finite reportedAt', () => {
    assert.deepStrictEqual(isValidRaceResultPayload({ ...valid, reportedAt: undefined }), false);
    assert.deepStrictEqual(isValidRaceResultPayload({ ...valid, reportedAt: Infinity }), false);
    assert.deepStrictEqual(isValidRaceResultPayload({ ...valid, reportedAt: '1000' }), false);
  });

  await t.test('rejects a bad gameId, results or version', () => {
    assert.deepStrictEqual(isValidRaceResultPayload({ ...valid, gameId: 7 }), false);
    assert.deepStrictEqual(isValidRaceResultPayload({ ...valid, results: 'a,b' }), false);
    assert.deepStrictEqual(isValidRaceResultPayload({ ...valid, results: [null] }), false);
    assert.deepStrictEqual(isValidRaceResultPayload({ ...valid, results: [{ participantId: 1 }] }), false);
    assert.deepStrictEqual(isValidRaceResultPayload({ ...valid, version: 'x' }), false);
    assert.deepStrictEqual(isValidRaceResultPayload(null), false);
  });
});

test('isValidMatchResultPayload', async (t) => {
  await t.test('accepts valid payload', () => {
    assert.deepStrictEqual(isValidMatchResultPayload({
      matchId: 'r1m1',
      scores: [3, 2],
      winnerId: 'user1',
      reportedAt: Date.now()
    }), true);
  });

  await t.test('rejects missing matchId', () => {
    assert.deepStrictEqual(isValidMatchResultPayload({
      scores: [3, 2],
      winnerId: 'user1',
      reportedAt: Date.now()
    }), false);
  });

  await t.test('rejects invalid scores', () => {
    assert.deepStrictEqual(isValidMatchResultPayload({
      matchId: 'r1m1',
      scores: [3], // wrong length
      winnerId: 'user1',
      reportedAt: Date.now()
    }), false);
  });

  await t.test('rejects missing winnerId', () => {
    assert.deepStrictEqual(isValidMatchResultPayload({
      matchId: 'r1m1',
      scores: [3, 2],
      reportedAt: Date.now()
    }), false);
  });

  await t.test('rejects non-string winnerId', () => {
    assert.deepStrictEqual(isValidMatchResultPayload({
      matchId: 'r1m1',
      scores: [3, 2],
      winnerId: 123,
      reportedAt: Date.now()
    }), false);
  });

  await t.test('rejects missing reportedAt', () => {
    assert.deepStrictEqual(isValidMatchResultPayload({
      matchId: 'r1m1',
      scores: [3, 2],
      winnerId: 'user1'
    }), false);
  });

  await t.test('rejects non-numeric reportedAt', () => {
    const base = { matchId: 'r1m1', scores: [3, 2], winnerId: 'user1' };
    assert.deepStrictEqual(isValidMatchResultPayload({ ...base, reportedAt: '2024-01-01' }), false);
    assert.deepStrictEqual(isValidMatchResultPayload({ ...base, reportedAt: null }), false);
  });

  await t.test('rejects null payload', () => {
    assert.deepStrictEqual(isValidMatchResultPayload(null), false);
    assert.deepStrictEqual(isValidMatchResultPayload(undefined), false);
  });
});

test('isValidMatchVerifyPayload', async (t) => {
  await t.test('accepts a payload without reportedAt', () => {
    assert.deepStrictEqual(isValidMatchVerifyPayload({ matchId: 'r1m1', scores: [3, 2], winnerId: 'user1' }), true);
  });

  await t.test('rejects invalid matchId, scores or winnerId', () => {
    const base = { matchId: 'r1m1', scores: [3, 2], winnerId: 'user1' };
    assert.deepStrictEqual(isValidMatchVerifyPayload({ ...base, matchId: 123 }), false);
    assert.deepStrictEqual(isValidMatchVerifyPayload({ ...base, scores: ['not', 'numbers'] }), false);
    assert.deepStrictEqual(isValidMatchVerifyPayload({ ...base, winnerId: 123 }), false);
    assert.deepStrictEqual(isValidMatchVerifyPayload(null), false);
  });
});

test('isValidParticipantJoinPayload', async (t) => {
  await t.test('accepts valid payload', () => {
    assert.deepStrictEqual(isValidParticipantJoinPayload({ name: 'Alice', localUserId: 'user_abc123' }), true);
    assert.deepStrictEqual(isValidParticipantJoinPayload({
      name: 'Bob',
      localUserId: 'user_abc123',
      joinedAt: Date.now()
    }), true);
  });

  await t.test('rejects a missing, empty or non-string localUserId', () => {
    assert.deepStrictEqual(isValidParticipantJoinPayload({ name: 'Alice' }), false);
    assert.deepStrictEqual(isValidParticipantJoinPayload({ name: 'Alice', localUserId: '' }), false);
    assert.deepStrictEqual(isValidParticipantJoinPayload({ name: 'Alice', localUserId: 42 }), false);
    assert.deepStrictEqual(isValidParticipantJoinPayload({ name: 'Alice', localUserId: {} }), false);
  });

  await t.test('rejects missing name', () => {
    assert.deepStrictEqual(isValidParticipantJoinPayload({}), false);
    assert.deepStrictEqual(isValidParticipantJoinPayload({ localUserId: 'user1' }), false);
  });

  await t.test('rejects invalid name', () => {
    assert.deepStrictEqual(isValidParticipantJoinPayload({ name: '', localUserId: 'user1' }), false);
    assert.deepStrictEqual(isValidParticipantJoinPayload({ name: 123, localUserId: 'user1' }), false);
  });

  await t.test('rejects null payload', () => {
    assert.deepStrictEqual(isValidParticipantJoinPayload(null), false);
    assert.deepStrictEqual(isValidParticipantJoinPayload(undefined), false);
  });
});

test('isValidParticipantUpdatePayload', async (t) => {
  await t.test('accepts valid payload with name only', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ name: 'Alice' }), true);
  });

  await t.test('accepts valid payload with seed only', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ seed: 5 }), true);
  });

  await t.test('accepts valid payload with multiple allowed fields', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({
      name: 'Bob',
      seed: 3,
      id: 'user123',
      isConnected: true
    }), true);
  });

  await t.test('accepts null peerId and claimedBy', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ peerId: null, claimedBy: null }), true);
  });

  await t.test('accepts empty payload (no fields to update)', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({}), true);
  });

  await t.test('rejects payload with disallowed fields', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ name: 'Alice', isAdmin: true }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ foo: 'bar' }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ name: 'Alice', localUserId: 'user1' }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ teamId: 'team-1' }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ isManual: true }), false);
    // JSON.parse makes __proto__ an own property as on the wire; a literal would set the prototype.
    assert.deepStrictEqual(isValidParticipantUpdatePayload(JSON.parse('{"__proto__":{}}')), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ constructor: {} }), false);
  });

  await t.test('rejects invalid name type', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ name: '' }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ name: 123 }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ name: null }), false);
  });

  await t.test('rejects invalid seed type', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ seed: '5' }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ seed: null }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ seed: [1] }), false);
  });

  await t.test('rejects invalid id type', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ id: 123 }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ id: null }), false);
  });

  await t.test('rejects invalid peerId and claimedBy types (non-null, non-string)', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ peerId: 123 }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ claimedBy: {} }), false);
  });

  await t.test('rejects invalid isConnected type', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ isConnected: 'true' }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ isConnected: 1 }), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload({ isConnected: null }), false);
  });

  await t.test('rejects null/undefined payload', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload(null), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload(undefined), false);
  });

  await t.test('rejects non-object payload', () => {
    assert.deepStrictEqual(isValidParticipantUpdatePayload('invalid'), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload(123), false);
    assert.deepStrictEqual(isValidParticipantUpdatePayload([]), false);
  });
});
