/**
 * Tests for Sync Validation Functions
 */

import { assertEquals } from 'jsr:@std/assert';
import {
  isValidName,
  isValidMatchId,
  isValidScores,
  isValidState,
  shouldUpdateMatch,
  isValidMatchResultPayload,
  isValidParticipantJoinPayload
} from '../js/network/sync-validators.js';

Deno.test('isValidName', async (t) => {
  await t.step('accepts valid names', () => {
    assertEquals(isValidName('Alice'), true);
    assertEquals(isValidName('Bob'), true);
    assertEquals(isValidName('Player 1'), true);
    assertEquals(isValidName('a'), true); // single char
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
    assertEquals(isValidMatchId('a'), true); // single char
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
    assertEquals(isValidScores([-1, 1]), true); // negative is technically valid
    assertEquals(isValidScores([1.5, 2.5]), true); // floats are valid
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
    // Note: Arrays are technically objects in JS, but empty arrays pass
    // since they have no invalid participants/matches/meta
  });

  await t.step('rejects invalid meta', () => {
    assertEquals(isValidState({ meta: null }), false);
    assertEquals(isValidState({ meta: 'invalid' }), false);
    assertEquals(isValidState({ meta: 123 }), false);
  });

  await t.step('rejects invalid participants format', () => {
    // Not an array
    assertEquals(isValidState({ participants: 'invalid' }), false);
    assertEquals(isValidState({ participants: {} }), false);

    // Entries not arrays
    assertEquals(isValidState({ participants: ['user1', 'user2'] }), false);

    // Entries wrong length
    assertEquals(isValidState({ participants: [['user1']] }), false);
    assertEquals(isValidState({ participants: [['user1', {}, 'extra']] }), false);

    // ID not string
    assertEquals(isValidState({ participants: [[123, {}]] }), false);

    // Participant not object
    assertEquals(isValidState({ participants: [['user1', 'invalid']] }), false);
    assertEquals(isValidState({ participants: [['user1', null]] }), false);
  });

  await t.step('rejects invalid matches format', () => {
    // Not an array
    assertEquals(isValidState({ matches: 'invalid' }), false);

    // Entries not arrays
    assertEquals(isValidState({ matches: ['match1'] }), false);

    // Entries wrong length
    assertEquals(isValidState({ matches: [['match1']] }), false);

    // ID not string
    assertEquals(isValidState({ matches: [[123, {}]] }), false);
  });
});

Deno.test('shouldUpdateMatch', async (t) => {
  await t.step('accepts higher version', () => {
    const incoming = { version: 2, reportedAt: 1000 };
    const existing = { version: 1, reportedAt: 2000 };
    assertEquals(shouldUpdateMatch(incoming, existing, false), true);
  });

  await t.step('accepts same version with newer timestamp', () => {
    const incoming = { version: 1, reportedAt: 2000 };
    const existing = { version: 1, reportedAt: 1000 };
    assertEquals(shouldUpdateMatch(incoming, existing, false), true);
  });

  await t.step('accepts admin update on unverified match', () => {
    const incoming = { version: 0, reportedAt: 1000 };
    const existing = { version: 1, reportedAt: 2000 }; // higher version!
    assertEquals(shouldUpdateMatch(incoming, existing, true), true);
  });

  await t.step('accepts admin update on verified match (admin can override)', () => {
    const incoming = { version: 0, reportedAt: 1000 };
    const existing = { version: 1, reportedAt: 2000, verifiedBy: 'admin1' };
    // Admin can always override, even verified matches
    assertEquals(shouldUpdateMatch(incoming, existing, true), true);
  });

  await t.step('rejects lower version', () => {
    const incoming = { version: 1, reportedAt: 2000 };
    const existing = { version: 2, reportedAt: 1000 };
    assertEquals(shouldUpdateMatch(incoming, existing, false), false);
  });

  await t.step('rejects same version with older timestamp', () => {
    const incoming = { version: 1, reportedAt: 1000 };
    const existing = { version: 1, reportedAt: 2000 };
    assertEquals(shouldUpdateMatch(incoming, existing, false), false);
  });

  await t.step('rejects equal version and timestamp', () => {
    const incoming = { version: 1, reportedAt: 1000 };
    const existing = { version: 1, reportedAt: 1000 };
    assertEquals(shouldUpdateMatch(incoming, existing, false), false);
  });

  await t.step('handles missing version (defaults to 0)', () => {
    const incoming = { reportedAt: 2000 }; // no version
    const existing = { reportedAt: 1000 }; // no version
    // Same version (0), but newer timestamp
    assertEquals(shouldUpdateMatch(incoming, existing, false), true);
  });

  await t.step('handles missing reportedAt (defaults to 0)', () => {
    const incoming = { version: 1 }; // no timestamp
    const existing = { version: 1, reportedAt: 1000 };
    // Same version, but 0 < 1000, so rejected
    assertEquals(shouldUpdateMatch(incoming, existing, false), false);
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

  await t.step('rejects null payload', () => {
    // Returns falsy (null/undefined) rather than explicit false
    assertEquals(!!isValidMatchResultPayload(null), false);
    assertEquals(!!isValidMatchResultPayload(undefined), false);
  });
});

Deno.test('isValidParticipantJoinPayload', async (t) => {
  await t.step('accepts valid payload', () => {
    assertEquals(isValidParticipantJoinPayload({ name: 'Alice' }), true);
    assertEquals(isValidParticipantJoinPayload({
      name: 'Bob',
      localUserId: 'user_abc123',
      joinedAt: Date.now()
    }), true);
  });

  await t.step('rejects missing name', () => {
    assertEquals(isValidParticipantJoinPayload({}), false);
    assertEquals(isValidParticipantJoinPayload({ localUserId: 'user1' }), false);
  });

  await t.step('rejects invalid name', () => {
    assertEquals(isValidParticipantJoinPayload({ name: '' }), false);
    assertEquals(isValidParticipantJoinPayload({ name: 123 }), false);
  });

  await t.step('rejects null payload', () => {
    // Returns falsy (null/undefined) rather than explicit false
    assertEquals(!!isValidParticipantJoinPayload(null), false);
    assertEquals(!!isValidParticipantJoinPayload(undefined), false);
  });
});
