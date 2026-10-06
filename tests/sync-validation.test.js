/**
 * Tests for the payload validators in sync-validators.js.
 */

import { assertEquals } from 'jsr:@std/assert';
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

Deno.test('isValidName', async (t) => {
  await t.step('accepts valid names', () => {
    assertEquals(isValidName('Alice'), true);
    assertEquals(isValidName('Bob'), true);
    assertEquals(isValidName('Player 1'), true);
    assertEquals(isValidName('a'), true);
    assertEquals(isValidName('A'.repeat(100)), true); // max length
  });

  await t.step('rejects empty strings', () => {
    assertEquals(isValidName(''), false);
  });

  await t.step('rejects non-strings', () => {
    assertEquals(isValidName(null), false);
    assertEquals(isValidName(undefined), false);
    assertEquals(isValidName(123), false);
    assertEquals(isValidName({}), false);
    assertEquals(isValidName([]), false);
  });

  await t.step('rejects names exceeding max length', () => {
    assertEquals(isValidName('A'.repeat(101)), false);
    assertEquals(isValidName('A'.repeat(200)), false);
  });
});

Deno.test('isValidMatchId', async (t) => {
  await t.step('accepts valid match IDs', () => {
    assertEquals(isValidMatchId('match-1'), true);
    assertEquals(isValidMatchId('r1m1'), true);
    assertEquals(isValidMatchId('gf1'), true);
    assertEquals(isValidMatchId('a'), true);
    assertEquals(isValidMatchId('A'.repeat(50)), true); // max length
  });

  await t.step('rejects empty strings', () => {
    assertEquals(isValidMatchId(''), false);
  });

  await t.step('rejects non-strings', () => {
    assertEquals(isValidMatchId(null), false);
    assertEquals(isValidMatchId(undefined), false);
    assertEquals(isValidMatchId(123), false);
    assertEquals(isValidMatchId({}), false);
  });

  await t.step('rejects IDs exceeding max length', () => {
    assertEquals(isValidMatchId('A'.repeat(51)), false);
    assertEquals(isValidMatchId('A'.repeat(100)), false);
  });
});

Deno.test('isValidScores', async (t) => {
  await t.step('accepts valid scores', () => {
    assertEquals(isValidScores([3, 2]), true);
    assertEquals(isValidScores([0, 0]), true);
    assertEquals(isValidScores([100, 50]), true);
    assertEquals(isValidScores([1.5, 2.5]), true);
  });

  await t.step('rejects negative scores', () => {
    assertEquals(isValidScores([-1, 1]), false);
    assertEquals(isValidScores([1, -1]), false);
    assertEquals(isValidScores([-1, -1]), false);
  });

  await t.step('rejects non-finite numbers', () => {
    assertEquals(isValidScores([Infinity, 0]), false);
    assertEquals(isValidScores([0, -Infinity]), false);
    assertEquals(isValidScores([NaN, 0]), false);
    assertEquals(isValidScores([0, NaN]), false);
  });

  await t.step('rejects non-arrays', () => {
    assertEquals(isValidScores(null), false);
    assertEquals(isValidScores(undefined), false);
    assertEquals(isValidScores('3-2'), false);
    assertEquals(isValidScores({ a: 3, b: 2 }), false);
  });

  await t.step('rejects arrays with wrong length', () => {
    assertEquals(isValidScores([]), false);
    assertEquals(isValidScores([3]), false);
    assertEquals(isValidScores([3, 2, 1]), false);
  });

  await t.step('rejects arrays with non-number elements', () => {
    assertEquals(isValidScores(['3', '2']), false);
    assertEquals(isValidScores([3, '2']), false);
    assertEquals(isValidScores([null, 2]), false);
    assertEquals(isValidScores([3, undefined]), false);
  });
});

Deno.test('isValidState', async (t) => {
  await t.step('accepts minimal valid state', () => {
    assertEquals(isValidState({}), true);
    assertEquals(isValidState({ meta: {} }), true);
    assertEquals(isValidState({ participants: [], matches: [] }), true);
  });

  await t.step('accepts state with valid meta', () => {
    assertEquals(isValidState({ meta: { id: 'room', status: 'lobby' } }), true);
    assertEquals(isValidState({ meta: { adminId: 'user1' } }), true);
  });

  await t.step('accepts state with valid participants', () => {
    assertEquals(isValidState({
      participants: [
        ['user1', { id: 'user1', name: 'Alice' }],
        ['user2', { id: 'user2', name: 'Bob' }]
      ]
    }), true);
  });

  await t.step('accepts state with valid matches', () => {
    assertEquals(isValidState({
      matches: [
        ['match1', { id: 'match1', participants: ['user1', 'user2'] }]
      ]
    }), true);
  });

  await t.step('accepts complete valid state', () => {
    assertEquals(isValidState({
      meta: { id: 'room', status: 'active' },
      participants: [['user1', { name: 'Alice' }]],
      matches: [['match1', { participants: [] }]]
    }), true);
  });

  await t.step('rejects null/undefined', () => {
    assertEquals(isValidState(null), false);
    assertEquals(isValidState(undefined), false);
  });

  await t.step('rejects non-objects', () => {
    assertEquals(isValidState('state'), false);
    assertEquals(isValidState(123), false);
    // An empty array passes: it has no invalid meta, participants or matches.
  });

  await t.step('rejects invalid meta', () => {
    assertEquals(isValidState({ meta: null }), false);
    assertEquals(isValidState({ meta: 'invalid' }), false);
    assertEquals(isValidState({ meta: 123 }), false);
  });

  await t.step('rejects invalid participants format', () => {
    assertEquals(isValidState({ participants: 'invalid' }), false);
    assertEquals(isValidState({ participants: {} }), false);
    assertEquals(isValidState({ participants: ['user1', 'user2'] }), false);
    assertEquals(isValidState({ participants: [['user1']] }), false);
    assertEquals(isValidState({ participants: [['user1', {}, 'extra']] }), false);
    assertEquals(isValidState({ participants: [[123, {}]] }), false);
    assertEquals(isValidState({ participants: [['user1', 'invalid']] }), false);
    assertEquals(isValidState({ participants: [['user1', null]] }), false);
  });

  await t.step('rejects invalid matches format', () => {
    assertEquals(isValidState({ matches: 'invalid' }), false);
    assertEquals(isValidState({ matches: ['match1'] }), false);
    assertEquals(isValidState({ matches: [['match1']] }), false);
    assertEquals(isValidState({ matches: [[123, {}]] }), false);
  });

  await t.step('rejects a match that is not an object with participants and typed result fields', () => {
    const match = (fields) => ({ matches: [['m1', { participants: ['a', 'b'], ...fields }]] });
    assertEquals(isValidState({ matches: [['m1', null]] }), false);
    assertEquals(isValidState({ matches: [['m1', {}]] }), false);
    assertEquals(isValidState(match({ winnerId: 5 })), false);
    assertEquals(isValidState(match({ scores: ['2', 0] })), false);
    assertEquals(isValidState(match({ results: 'a' })), false);
    assertEquals(isValidState(match({ reportedAt: '1' })), false);
    assertEquals(isValidState(match({ version: NaN })), false);
    assertEquals(isValidState(match({ verifiedBy: {} })), false);
    assertEquals(isValidState(match({ winnerId: null, scores: [2, 1], reportedAt: 1, version: 2 })), true);
  });
});

Deno.test('isValidRaceResultPayload', async (t) => {
  const valid = { gameId: 'game1', results: [{ participantId: 'a' }, { participantId: 'b' }], reportedAt: 1000, version: 1 };

  await t.step('accepts a valid payload, with or without version', () => {
    assertEquals(isValidRaceResultPayload(valid), true);
    assertEquals(isValidRaceResultPayload({ ...valid, version: undefined }), true);
  });

  await t.step('rejects a missing or non-finite reportedAt', () => {
    assertEquals(isValidRaceResultPayload({ ...valid, reportedAt: undefined }), false);
    assertEquals(isValidRaceResultPayload({ ...valid, reportedAt: Infinity }), false);
    assertEquals(isValidRaceResultPayload({ ...valid, reportedAt: '1000' }), false);
  });

  await t.step('rejects a bad gameId, results or version', () => {
    assertEquals(isValidRaceResultPayload({ ...valid, gameId: 7 }), false);
    assertEquals(isValidRaceResultPayload({ ...valid, results: 'a,b' }), false);
    assertEquals(isValidRaceResultPayload({ ...valid, results: [null] }), false);
    assertEquals(isValidRaceResultPayload({ ...valid, results: [{ participantId: 1 }] }), false);
    assertEquals(isValidRaceResultPayload({ ...valid, version: 'x' }), false);
    assertEquals(isValidRaceResultPayload(null), false);
  });
});

Deno.test('isValidMatchResultPayload', async (t) => {
  await t.step('accepts valid payload', () => {
    assertEquals(isValidMatchResultPayload({
      matchId: 'r1m1',
      scores: [3, 2],
      winnerId: 'user1',
      reportedAt: Date.now()
    }), true);
  });

  await t.step('rejects missing matchId', () => {
    assertEquals(isValidMatchResultPayload({
      scores: [3, 2],
      winnerId: 'user1',
      reportedAt: Date.now()
    }), false);
  });

  await t.step('rejects invalid scores', () => {
    assertEquals(isValidMatchResultPayload({
      matchId: 'r1m1',
      scores: [3], // wrong length
      winnerId: 'user1',
      reportedAt: Date.now()
    }), false);
  });

  await t.step('rejects missing winnerId', () => {
    assertEquals(isValidMatchResultPayload({
      matchId: 'r1m1',
      scores: [3, 2],
      reportedAt: Date.now()
    }), false);
  });

  await t.step('rejects non-string winnerId', () => {
    assertEquals(isValidMatchResultPayload({
      matchId: 'r1m1',
      scores: [3, 2],
      winnerId: 123,
      reportedAt: Date.now()
    }), false);
  });

  await t.step('rejects missing reportedAt', () => {
    assertEquals(isValidMatchResultPayload({
      matchId: 'r1m1',
      scores: [3, 2],
      winnerId: 'user1'
    }), false);
  });

  await t.step('rejects non-numeric reportedAt', () => {
    const base = { matchId: 'r1m1', scores: [3, 2], winnerId: 'user1' };
    assertEquals(isValidMatchResultPayload({ ...base, reportedAt: '2024-01-01' }), false);
    assertEquals(isValidMatchResultPayload({ ...base, reportedAt: null }), false);
  });

  await t.step('rejects null payload', () => {
    assertEquals(isValidMatchResultPayload(null), false);
    assertEquals(isValidMatchResultPayload(undefined), false);
  });
});

Deno.test('isValidMatchVerifyPayload', async (t) => {
  await t.step('accepts a payload without reportedAt', () => {
    assertEquals(isValidMatchVerifyPayload({ matchId: 'r1m1', scores: [3, 2], winnerId: 'user1' }), true);
  });

  await t.step('rejects invalid matchId, scores or winnerId', () => {
    const base = { matchId: 'r1m1', scores: [3, 2], winnerId: 'user1' };
    assertEquals(isValidMatchVerifyPayload({ ...base, matchId: 123 }), false);
    assertEquals(isValidMatchVerifyPayload({ ...base, scores: ['not', 'numbers'] }), false);
    assertEquals(isValidMatchVerifyPayload({ ...base, winnerId: 123 }), false);
    assertEquals(isValidMatchVerifyPayload(null), false);
  });
});

Deno.test('isValidParticipantJoinPayload', async (t) => {
  await t.step('accepts valid payload', () => {
    assertEquals(isValidParticipantJoinPayload({ name: 'Alice', localUserId: 'user_abc123' }), true);
    assertEquals(isValidParticipantJoinPayload({
      name: 'Bob',
      localUserId: 'user_abc123',
      joinedAt: Date.now()
    }), true);
  });

  await t.step('rejects a missing, empty or non-string localUserId', () => {
    assertEquals(isValidParticipantJoinPayload({ name: 'Alice' }), false);
    assertEquals(isValidParticipantJoinPayload({ name: 'Alice', localUserId: '' }), false);
    assertEquals(isValidParticipantJoinPayload({ name: 'Alice', localUserId: 42 }), false);
    assertEquals(isValidParticipantJoinPayload({ name: 'Alice', localUserId: {} }), false);
  });

  await t.step('rejects missing name', () => {
    assertEquals(isValidParticipantJoinPayload({}), false);
    assertEquals(isValidParticipantJoinPayload({ localUserId: 'user1' }), false);
  });

  await t.step('rejects invalid name', () => {
    assertEquals(isValidParticipantJoinPayload({ name: '', localUserId: 'user1' }), false);
    assertEquals(isValidParticipantJoinPayload({ name: 123, localUserId: 'user1' }), false);
  });

  await t.step('rejects null payload', () => {
    assertEquals(isValidParticipantJoinPayload(null), false);
    assertEquals(isValidParticipantJoinPayload(undefined), false);
  });
});

Deno.test('isValidParticipantUpdatePayload', async (t) => {
  await t.step('accepts valid payload with name only', () => {
    assertEquals(isValidParticipantUpdatePayload({ name: 'Alice' }), true);
  });

  await t.step('accepts valid payload with seed only', () => {
    assertEquals(isValidParticipantUpdatePayload({ seed: 5 }), true);
  });

  await t.step('accepts valid payload with multiple allowed fields', () => {
    assertEquals(isValidParticipantUpdatePayload({
      name: 'Bob',
      seed: 3,
      id: 'user123',
      isConnected: true
    }), true);
  });

  await t.step('accepts null peerId and claimedBy', () => {
    assertEquals(isValidParticipantUpdatePayload({ peerId: null, claimedBy: null }), true);
  });

  await t.step('accepts empty payload (no fields to update)', () => {
    assertEquals(isValidParticipantUpdatePayload({}), true);
  });

  await t.step('rejects payload with disallowed fields', () => {
    assertEquals(isValidParticipantUpdatePayload({ name: 'Alice', isAdmin: true }), false);
    assertEquals(isValidParticipantUpdatePayload({ foo: 'bar' }), false);
    assertEquals(isValidParticipantUpdatePayload({ name: 'Alice', localUserId: 'user1' }), false);
    assertEquals(isValidParticipantUpdatePayload({ teamId: 'team-1' }), false);
    assertEquals(isValidParticipantUpdatePayload({ isManual: true }), false);
    // JSON.parse makes __proto__ an own property as on the wire; a literal would set the prototype.
    assertEquals(isValidParticipantUpdatePayload(JSON.parse('{"__proto__":{}}')), false);
    assertEquals(isValidParticipantUpdatePayload({ constructor: {} }), false);
  });

  await t.step('rejects invalid name type', () => {
    assertEquals(isValidParticipantUpdatePayload({ name: '' }), false);
    assertEquals(isValidParticipantUpdatePayload({ name: 123 }), false);
    assertEquals(isValidParticipantUpdatePayload({ name: null }), false);
  });

  await t.step('rejects invalid seed type', () => {
    assertEquals(isValidParticipantUpdatePayload({ seed: '5' }), false);
    assertEquals(isValidParticipantUpdatePayload({ seed: null }), false);
    assertEquals(isValidParticipantUpdatePayload({ seed: [1] }), false);
  });

  await t.step('rejects invalid id type', () => {
    assertEquals(isValidParticipantUpdatePayload({ id: 123 }), false);
    assertEquals(isValidParticipantUpdatePayload({ id: null }), false);
  });

  await t.step('rejects invalid peerId and claimedBy types (non-null, non-string)', () => {
    assertEquals(isValidParticipantUpdatePayload({ peerId: 123 }), false);
    assertEquals(isValidParticipantUpdatePayload({ claimedBy: {} }), false);
  });

  await t.step('rejects invalid isConnected type', () => {
    assertEquals(isValidParticipantUpdatePayload({ isConnected: 'true' }), false);
    assertEquals(isValidParticipantUpdatePayload({ isConnected: 1 }), false);
    assertEquals(isValidParticipantUpdatePayload({ isConnected: null }), false);
  });

  await t.step('rejects null/undefined payload', () => {
    assertEquals(isValidParticipantUpdatePayload(null), false);
    assertEquals(isValidParticipantUpdatePayload(undefined), false);
  });

  await t.step('rejects non-object payload', () => {
    assertEquals(isValidParticipantUpdatePayload('invalid'), false);
    assertEquals(isValidParticipantUpdatePayload(123), false);
    assertEquals(isValidParticipantUpdatePayload([]), false);
  });
});
