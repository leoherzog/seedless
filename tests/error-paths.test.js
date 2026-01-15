/**
 * Error Path Tests
 * Tests for invalid input handling, malformed payloads, and error recovery
 */

import { assertEquals, assert, assertFalse, assertThrows } from 'jsr:@std/assert';
import { Store } from '../js/state/store.js';
import {
  isValidName,
  isValidMatchId,
  isValidScores,
  isValidState,
  shouldUpdateMatch,
  isValidMatchResultPayload,
  isValidParticipantJoinPayload,
} from '../js/network/sync-validators.js';
import { generateSingleEliminationBracket, recordMatchResult } from '../js/tournament/single-elimination.js';
import { createParticipants } from './fixtures.js';

// =============================================================================
// Invalid Payload Handling
// =============================================================================

Deno.test('Invalid Payload Handling - Null and Undefined', async (t) => {
  await t.step('isValidMatchResultPayload handles null', () => {
    assertFalse(isValidMatchResultPayload(null));
  });

  await t.step('isValidMatchResultPayload handles undefined', () => {
    assertFalse(isValidMatchResultPayload(undefined));
  });

  await t.step('isValidParticipantJoinPayload handles null', () => {
    assertFalse(isValidParticipantJoinPayload(null));
  });

  await t.step('isValidParticipantJoinPayload handles undefined', () => {
    assertFalse(isValidParticipantJoinPayload(undefined));
  });

  await t.step('isValidState handles null', () => {
    assertFalse(isValidState(null));
  });

  await t.step('isValidState handles undefined', () => {
    assertFalse(isValidState(undefined));
  });
});

Deno.test('Invalid Payload Handling - Wrong Types', async (t) => {
  await t.step('isValidMatchResultPayload rejects empty object', () => {
    assertFalse(isValidMatchResultPayload({}));
  });

  await t.step('isValidMatchResultPayload rejects array instead of object', () => {
    assertFalse(isValidMatchResultPayload(['r1m0', [2, 1], 'player-1']));
  });

  await t.step('isValidMatchResultPayload rejects string instead of object', () => {
    assertFalse(isValidMatchResultPayload('{"matchId":"r1m0"}'));
  });

  await t.step('isValidParticipantJoinPayload rejects empty object', () => {
    assertFalse(isValidParticipantJoinPayload({}));
  });

  await t.step('isValidParticipantJoinPayload rejects array', () => {
    assertFalse(isValidParticipantJoinPayload(['Player 1']));
  });

  await t.step('isValidState rejects primitive types', () => {
    assertFalse(isValidState('string'));
    assertFalse(isValidState(123));
    assertFalse(isValidState(true));
  });
});

// =============================================================================
// Invalid Field Values
// =============================================================================

Deno.test('Invalid Field Values - Scores', async (t) => {
  await t.step('negative scores are rejected', () => {
    // Security improvement: scores must be non-negative
    assertFalse(isValidScores([-1, -2]));
    assertFalse(isValidScores([-1, 2]));
    assertFalse(isValidScores([2, -1]));
  });

  await t.step('NaN in scores is rejected', () => {
    // Security improvement: scores must be finite
    assertFalse(isValidScores([NaN, 1]));
    assertFalse(isValidScores([1, NaN]));
  });

  await t.step('Infinity in scores is rejected', () => {
    // Security improvement: scores must be finite
    assertFalse(isValidScores([Infinity, 1]));
    assertFalse(isValidScores([1, -Infinity]));
  });

  await t.step('scores with more than 2 elements rejected', () => {
    assertFalse(isValidScores([1, 2, 3]));
  });

  await t.step('scores with less than 2 elements rejected', () => {
    assertFalse(isValidScores([1]));
    assertFalse(isValidScores([]));
  });

  await t.step('non-numeric scores rejected', () => {
    assertFalse(isValidScores(['1', '2']));
    assertFalse(isValidScores([null, null]));
    assertFalse(isValidScores([undefined, undefined]));
  });
});

Deno.test('Invalid Field Values - Names', async (t) => {
  await t.step('empty string name rejected', () => {
    assertFalse(isValidName(''));
  });

  await t.step('whitespace-only name accepted (no trim in validator)', () => {
    // Validator doesn't trim, so spaces pass
    assert(isValidName('   '));
  });

  await t.step('name exceeding max length rejected', () => {
    assertFalse(isValidName('a'.repeat(101)));
  });

  await t.step('numeric name rejected', () => {
    assertFalse(isValidName(123));
  });

  await t.step('null name rejected', () => {
    assertFalse(isValidName(null));
  });

  await t.step('undefined name rejected', () => {
    assertFalse(isValidName(undefined));
  });

  await t.step('array name rejected', () => {
    assertFalse(isValidName(['Player 1']));
  });

  await t.step('object name rejected', () => {
    assertFalse(isValidName({ name: 'Player 1' }));
  });
});

Deno.test('Invalid Field Values - Match IDs', async (t) => {
  await t.step('empty string matchId rejected', () => {
    assertFalse(isValidMatchId(''));
  });

  await t.step('matchId exceeding max length rejected', () => {
    assertFalse(isValidMatchId('m'.repeat(51)));
  });

  await t.step('numeric matchId rejected', () => {
    assertFalse(isValidMatchId(123));
  });

  await t.step('null matchId rejected', () => {
    assertFalse(isValidMatchId(null));
  });

  await t.step('object matchId rejected', () => {
    assertFalse(isValidMatchId({ id: 'r1m0' }));
  });
});

Deno.test('Invalid Field Values - Timestamps', async (t) => {
  await t.step('match result with non-numeric reportedAt rejected', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      winnerId: 'player-1',
      reportedAt: '2024-01-01',
    }));
  });

  await t.step('match result with null reportedAt rejected', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      winnerId: 'player-1',
      reportedAt: null,
    }));
  });

  await t.step('Infinity timestamp in shouldUpdateMatch handled', () => {
    const incoming = { version: 1, reportedAt: Infinity };
    const existing = { version: 1, reportedAt: 1000 };
    assert(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('NaN timestamp in shouldUpdateMatch handled', () => {
    const incoming = { version: 1, reportedAt: NaN };
    const existing = { version: 1, reportedAt: 1000 };
    // NaN > 1000 is false, so incoming loses
    assertFalse(shouldUpdateMatch(incoming, existing, false));
  });
});

Deno.test('Invalid Field Values - Winner ID', async (t) => {
  await t.step('match result with non-string winnerId rejected', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      winnerId: 123,
      reportedAt: Date.now(),
    }));
  });

  await t.step('match result with null winnerId rejected', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      winnerId: null,
      reportedAt: Date.now(),
    }));
  });

  await t.step('match result with empty winnerId accepted', () => {
    // Empty string is technically a string
    assert(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      winnerId: '',
      reportedAt: Date.now(),
    }));
  });
});

// =============================================================================
// Missing Required Fields
// =============================================================================

Deno.test('Missing Required Fields', async (t) => {
  await t.step('match result without matchId rejected', () => {
    assertFalse(isValidMatchResultPayload({
      scores: [2, 1],
      winnerId: 'player-1',
      reportedAt: Date.now(),
    }));
  });

  await t.step('match result without scores rejected', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      winnerId: 'player-1',
      reportedAt: Date.now(),
    }));
  });

  await t.step('match result without winnerId rejected', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      reportedAt: Date.now(),
    }));
  });

  await t.step('match result without reportedAt rejected', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      winnerId: 'player-1',
    }));
  });

  await t.step('participant join without name rejected', () => {
    assertFalse(isValidParticipantJoinPayload({}));
    assertFalse(isValidParticipantJoinPayload({ id: 'player-1' }));
  });
});

// =============================================================================
// State Structure Validation
// =============================================================================

Deno.test('State Structure Validation', async (t) => {
  await t.step('participants as object instead of array rejected', () => {
    assertFalse(isValidState({
      participants: { 'p1': { name: 'Player 1' } },
    }));
  });

  await t.step('participants with invalid entry format rejected', () => {
    // Entry must be [id, object] tuple
    assertFalse(isValidState({
      participants: [{ id: 'p1', name: 'Player 1' }], // Not a tuple
    }));
  });

  await t.step('participants with wrong tuple length rejected', () => {
    assertFalse(isValidState({
      participants: [['p1']], // Missing second element
    }));
    assertFalse(isValidState({
      participants: [['p1', {}, 'extra']], // Too many elements
    }));
  });

  await t.step('matches as object instead of array rejected', () => {
    assertFalse(isValidState({
      matches: { 'r1m0': { id: 'r1m0' } },
    }));
  });

  await t.step('matches with non-string ID rejected', () => {
    assertFalse(isValidState({
      matches: [[123, { id: 'r1m0' }]],
    }));
  });

  await t.step('meta as non-object rejected', () => {
    assertFalse(isValidState({ meta: 'lobby' }));
    assertFalse(isValidState({ meta: null }));
  });
});

// =============================================================================
// Store Deserialization Error Handling
// =============================================================================

Deno.test('Store Deserialization', async (t) => {
  await t.step('deserialize handles missing participants field', () => {
    const store = new Store();
    store.reset();

    // Should not throw
    store.deserialize({ meta: { status: 'lobby' } });
    assertEquals(store.getParticipantList().length, 0);
  });

  await t.step('deserialize handles missing matches field', () => {
    const store = new Store();
    store.reset();

    // Should not throw
    store.deserialize({ meta: { status: 'lobby' } });
    assertEquals(store.getMatch('any'), undefined);
  });

  await t.step('deserialize handles missing bracket field', () => {
    const store = new Store();
    store.reset();

    store.deserialize({ meta: { status: 'active' } });
    assertEquals(store.get('bracket'), null);
  });

  await t.step('deserialize handles empty data object', () => {
    const store = new Store();
    store.reset();

    // Should not throw
    store.deserialize({});
    // State should remain as initialized
    assertEquals(store.get('meta.status'), 'lobby');
  });

  await t.step('deserialize handles null bracket in data', () => {
    const store = new Store();
    store.reset();

    store.deserialize({ bracket: null });
    assertEquals(store.get('bracket'), null);
  });
});

// =============================================================================
// Tournament Operations Error Handling
// =============================================================================

Deno.test('Tournament Operations Error Handling', async (t) => {
  await t.step('recordMatchResult throws for non-existent match', () => {
    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    assertThrows(
      () => recordMatchResult(bracket, 'nonexistent', [2, 1], 'player-1', 'player-1'),
      Error,
      'Match not found'
    );
  });

  await t.step('recordMatchResult throws for invalid match ID format', () => {
    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    assertThrows(
      () => recordMatchResult(bracket, 'invalid-id', [2, 1], 'player-1', 'player-1'),
      Error,
      'Match not found'
    );
  });

  await t.step('generateSingleEliminationBracket throws for empty array', () => {
    assertThrows(
      () => generateSingleEliminationBracket([]),
      Error
    );
  });

  await t.step('generateSingleEliminationBracket throws for single participant', () => {
    assertThrows(
      () => generateSingleEliminationBracket(createParticipants(1)),
      Error,
      'Need at least 2 participants'
    );
  });
});

// =============================================================================
// Store Operations Error Handling
// =============================================================================

Deno.test('Store Operations Error Handling', async (t) => {
  await t.step('getParticipant returns undefined for non-existent ID', () => {
    const store = new Store();
    store.reset();

    assertEquals(store.getParticipant('nonexistent'), undefined);
  });

  await t.step('getMatch returns undefined for non-existent ID', () => {
    const store = new Store();
    store.reset();

    assertEquals(store.getMatch('nonexistent'), undefined);
  });

  await t.step('updateParticipant does nothing for non-existent ID', () => {
    const store = new Store();
    store.reset();

    // Should not throw
    store.updateParticipant('nonexistent', { name: 'Updated' });
    assertEquals(store.getParticipant('nonexistent'), undefined);
  });

  await t.step('removeParticipant does nothing for non-existent ID', () => {
    const store = new Store();
    store.reset();

    // Should not throw
    store.removeParticipant('nonexistent');
    assertEquals(store.getParticipantList().length, 0);
  });

  await t.step('get with nested path handles missing intermediate', () => {
    const store = new Store();
    store.reset();

    assertEquals(store.get('nonexistent.deep.path'), undefined);
  });
});

// =============================================================================
// shouldUpdateMatch Edge Cases
// =============================================================================

Deno.test('shouldUpdateMatch - Conflict Resolution Edge Cases', async (t) => {
  await t.step('handles missing version (defaults to 0)', () => {
    const incoming = { reportedAt: 2000 };
    const existing = { reportedAt: 1000 };

    // Both versions are 0, newer timestamp wins
    assert(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('handles missing reportedAt (defaults to 0)', () => {
    const incoming = { version: 1 };
    const existing = { version: 1 };

    // Equal versions, both reportedAt are 0
    assertFalse(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('handles completely empty objects', () => {
    const incoming = {};
    const existing = {};

    // All values default to 0, timestamps are equal
    assertFalse(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('admin wins with completely empty incoming', () => {
    const incoming = {};
    const existing = { version: 100, reportedAt: 999999 };

    // Admin always wins
    assert(shouldUpdateMatch(incoming, existing, true));
  });

  await t.step('handles both version and timestamp being equal', () => {
    const incoming = { version: 5, reportedAt: 1000 };
    const existing = { version: 5, reportedAt: 1000 };

    // Neither wins (no condition met)
    assertFalse(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('handles version 0 comparison correctly', () => {
    const incoming = { version: 0, reportedAt: 2000 };
    const existing = { version: 0, reportedAt: 1000 };

    // Same version, newer timestamp wins
    assert(shouldUpdateMatch(incoming, existing, false));
  });
});

// =============================================================================
// Participant Entry Validation in State
// =============================================================================

Deno.test('Participant Entry Validation', async (t) => {
  await t.step('rejects participant with null as value', () => {
    assertFalse(isValidState({
      participants: [['p1', null]],
    }));
  });

  await t.step('rejects participant with primitive as value', () => {
    assertFalse(isValidState({
      participants: [['p1', 'Player 1']],
    }));
    assertFalse(isValidState({
      participants: [['p1', 123]],
    }));
  });

  await t.step('accepts participant with empty object as value', () => {
    // Empty object is still a valid object
    assert(isValidState({
      participants: [['p1', {}]],
    }));
  });

  await t.step('accepts participant with extra fields', () => {
    assert(isValidState({
      participants: [['p1', { name: 'Player 1', extraField: 'ignored' }]],
    }));
  });
});

// =============================================================================
// Match Entry Validation in State
// =============================================================================

Deno.test('Match Entry Validation', async (t) => {
  await t.step('accepts match with null as value', () => {
    // Note: validator only checks entry structure, not value contents
    // Match value can technically be null (not fully validated)
    assert(isValidState({
      matches: [['r1m0', null]],
    }));
  });

  await t.step('accepts match with empty object as value', () => {
    assert(isValidState({
      matches: [['r1m0', {}]],
    }));
  });

  await t.step('rejects match with non-string key', () => {
    assertFalse(isValidState({
      matches: [[123, { id: 'r1m0' }]],
    }));
  });

  await t.step('rejects match entry that is not a tuple', () => {
    assertFalse(isValidState({
      matches: [{ id: 'r1m0' }],
    }));
  });
});

// =============================================================================
// Extra Field Handling (shouldn't affect validation)
// =============================================================================

Deno.test('Extra Field Handling', async (t) => {
  await t.step('valid match result payload with extra fields passes', () => {
    assert(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      winnerId: 'player-1',
      reportedAt: Date.now(),
      extraField: 'ignored',
      anotherExtra: { nested: true },
    }));
  });

  await t.step('valid participant join payload with extra fields passes', () => {
    assert(isValidParticipantJoinPayload({
      name: 'Player 1',
      extraField: 'ignored',
    }));
  });

  await t.step('valid state with extra top-level fields passes', () => {
    assert(isValidState({
      meta: { status: 'lobby' },
      participants: [],
      extraField: 'ignored',
    }));
  });
});
