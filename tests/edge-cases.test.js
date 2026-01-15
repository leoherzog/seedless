/**
 * Edge Cases and Boundary Conditions Tests
 * Tests edge cases that might not be covered in normal test flows
 */

import { assertEquals, assert, assertThrows, assertFalse } from 'jsr:@std/assert';
import { Store } from '../js/state/store.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { generateDoubleEliminationBracket } from '../js/tournament/double-elimination.js';
import { generateMarioKartTournament } from '../js/tournament/mario-kart.js';
import { generateDoublesTournament } from '../js/tournament/doubles.js';
import { nextPowerOf2, getSeedPositions, getRoundName } from '../js/tournament/bracket-utils.js';
import {
  isValidName,
  isValidMatchId,
  isValidScores,
  isValidState,
  shouldUpdateMatch,
  isValidMatchResultPayload,
  isValidParticipantJoinPayload,
} from '../js/network/sync-validators.js';
import { createParticipants, createTeamAssignments } from './fixtures.js';

// =============================================================================
// Single Participant Edge Cases
// =============================================================================

Deno.test('Single Participant Edge Cases', async (t) => {
  await t.step('single elimination rejects single participant', () => {
    const participants = createParticipants(1);

    assertThrows(
      () => generateSingleEliminationBracket(participants),
      Error,
      'Need at least 2 participants'
    );
  });

  await t.step('double elimination rejects single participant', () => {
    const participants = createParticipants(1);

    assertThrows(
      () => generateDoubleEliminationBracket(participants),
      Error,
      'Need at least 2 participants'
    );
  });

  await t.step('mario kart rejects single participant', () => {
    const participants = createParticipants(1);

    assertThrows(
      () => generateMarioKartTournament(participants),
      Error
    );
  });

  await t.step('doubles rejects single participant', () => {
    const participants = createParticipants(1);
    const teamAssignments = new Map();

    assertThrows(
      () => generateDoublesTournament(participants, teamAssignments),
      Error
    );
  });

  await t.step('empty participant array throws', () => {
    assertThrows(
      () => generateSingleEliminationBracket([]),
      Error
    );
  });

  await t.step('two participants creates valid bracket', () => {
    const participants = createParticipants(2);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.participantCount, 2);
    assertEquals(bracket.bracketSize, 2);
    assertEquals(bracket.numRounds, 1);
    assertEquals(bracket.rounds.length, 1);
    assertEquals(bracket.rounds[0].matches.length, 1);

    // Finals match should have both participants
    const finals = bracket.rounds[0].matches[0];
    assertEquals(finals.participants[0], participants[0].id);
    assertEquals(finals.participants[1], participants[1].id);
    assertFalse(finals.isBye);
  });
});

// =============================================================================
// Maximum Bye Handling
// =============================================================================

Deno.test('Maximum Bye Handling', async (t) => {
  await t.step('3 participants in 4-slot bracket (1 bye)', () => {
    const participants = createParticipants(3);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 4);
    assertEquals(bracket.participantCount, 3);

    // Count bye matches
    const byeMatches = bracket.rounds[0].matches.filter(m => m.isBye);
    assertEquals(byeMatches.length, 1);

    // Bye winner should be auto-advanced
    const byeMatch = byeMatches[0];
    assert(byeMatch.winnerId !== null);
  });

  await t.step('5 participants in 8-slot bracket (3 byes)', () => {
    const participants = createParticipants(5);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 8);
    assertEquals(bracket.participantCount, 5);

    const byeMatches = bracket.rounds[0].matches.filter(m => m.isBye);
    assertEquals(byeMatches.length, 3);

    // All bye winners should be auto-advanced
    for (const match of byeMatches) {
      assert(match.winnerId !== null, 'Bye match should have auto-advanced winner');
    }
  });

  await t.step('9 participants in 16-slot bracket (7 byes)', () => {
    const participants = createParticipants(9);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 16);
    assertEquals(bracket.participantCount, 9);

    const byeMatches = bracket.rounds[0].matches.filter(m => m.isBye);
    assertEquals(byeMatches.length, 7);
  });

  await t.step('17 participants in 32-slot bracket (15 byes)', () => {
    const participants = createParticipants(17);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 32);
    assertEquals(bracket.participantCount, 17);

    const byeMatches = bracket.rounds[0].matches.filter(m => m.isBye);
    assertEquals(byeMatches.length, 15);
  });

  await t.step('bye winners are placed in correct next-round positions', () => {
    const participants = createParticipants(3);
    const bracket = generateSingleEliminationBracket(participants);

    // With 3 participants, one match is a bye
    // The bye winner should appear in round 2
    const round2 = bracket.rounds[1];
    const finalsMatch = round2.matches[0];

    // One slot should be filled by bye winner
    const filledSlots = finalsMatch.participants.filter(p => p !== null);
    assertEquals(filledSlots.length, 1, 'One slot should be filled by bye winner');
  });
});

// =============================================================================
// Empty State Serialization
// =============================================================================

Deno.test('Empty State Serialization', async (t) => {
  await t.step('store serializes empty state correctly', () => {
    const store = new Store();
    store.reset();

    const serialized = store.serialize();

    assert(serialized !== null);
    assertEquals(serialized.participants, []);
    assertEquals(serialized.matches, []);
  });

  await t.step('store deserializes empty participants array', () => {
    const store = new Store();
    store.reset();

    store.deserialize({ participants: [] });

    assertEquals(store.getParticipantList().length, 0);
  });

  await t.step('store deserializes empty matches array', () => {
    const store = new Store();
    store.reset();

    store.deserialize({ matches: [] });

    // Check via getMatch returning undefined for any key
    assertEquals(store.getMatch('any'), undefined);
  });

  await t.step('store handles null bracket serialization', () => {
    const store = new Store();
    store.reset();
    store.set('bracket', null);

    // Should not throw
    const bracket = store.get('bracket');
    assertEquals(bracket, null);
  });

  await t.step('isValidState accepts empty participants array', () => {
    assert(isValidState({ participants: [] }));
  });

  await t.step('isValidState accepts empty matches array', () => {
    assert(isValidState({ matches: [] }));
  });

  await t.step('isValidState accepts state with only meta', () => {
    assert(isValidState({ meta: { status: 'lobby' } }));
  });

  await t.step('isValidState accepts minimal valid state', () => {
    assert(isValidState({}));
  });
});

// =============================================================================
// Boundary Conditions
// =============================================================================

Deno.test('Boundary Conditions - Bracket Sizes', async (t) => {
  await t.step('32-player bracket structure is correct', () => {
    const participants = createParticipants(32);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 32);
    assertEquals(bracket.numRounds, 5);
    assertEquals(bracket.rounds.length, 5);

    // Round match counts: 16, 8, 4, 2, 1
    assertEquals(bracket.rounds[0].matches.length, 16);
    assertEquals(bracket.rounds[1].matches.length, 8);
    assertEquals(bracket.rounds[2].matches.length, 4);
    assertEquals(bracket.rounds[3].matches.length, 2);
    assertEquals(bracket.rounds[4].matches.length, 1);
  });

  await t.step('64-player bracket structure is correct', () => {
    const participants = createParticipants(64);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 64);
    assertEquals(bracket.numRounds, 6);
    assertEquals(bracket.rounds.length, 6);

    // Total matches: 32 + 16 + 8 + 4 + 2 + 1 = 63
    const totalMatches = bracket.rounds.reduce((sum, r) => sum + r.matches.length, 0);
    assertEquals(totalMatches, 63);
  });

  await t.step('seeding is correct for 64 players', () => {
    const participants = createParticipants(64);
    const bracket = generateSingleEliminationBracket(participants);

    // First seed vs 64th seed in first match they could meet (finals)
    // Second seed vs 63rd seed in opposite side
    // Verify top seeds are properly distributed

    // Seed 1 should be in first match
    const round1 = bracket.rounds[0];
    const seed1Match = round1.matches.find(m =>
      m.participants.includes(participants[0].id)
    );
    assert(seed1Match, 'Seed 1 should be in round 1');

    // Seed 1 should face seed 64 if they both win
    assertEquals(seed1Match.participants[0], participants[0].id);
  });
});

Deno.test('Boundary Conditions - Validation Limits', async (t) => {
  await t.step('name at exactly MAX_NAME_LENGTH (100) is valid', () => {
    const maxName = 'a'.repeat(100);
    assert(isValidName(maxName));
  });

  await t.step('name at MAX_NAME_LENGTH + 1 (101) is invalid', () => {
    const tooLong = 'a'.repeat(101);
    assertFalse(isValidName(tooLong));
  });

  await t.step('name of 1 character is valid', () => {
    assert(isValidName('a'));
  });

  await t.step('empty name is invalid', () => {
    assertFalse(isValidName(''));
  });

  await t.step('match ID at exactly MAX_MATCH_ID_LENGTH (50) is valid', () => {
    const maxMatchId = 'm'.repeat(50);
    assert(isValidMatchId(maxMatchId));
  });

  await t.step('match ID at MAX_MATCH_ID_LENGTH + 1 (51) is invalid', () => {
    const tooLong = 'm'.repeat(51);
    assertFalse(isValidMatchId(tooLong));
  });

  await t.step('match ID of 1 character is valid', () => {
    assert(isValidMatchId('r'));
  });

  await t.step('empty match ID is invalid', () => {
    assertFalse(isValidMatchId(''));
  });
});

// =============================================================================
// Bracket Utils Edge Cases
// =============================================================================

Deno.test('Bracket Utils Edge Cases', async (t) => {
  await t.step('nextPowerOf2 handles exact powers of 2', () => {
    assertEquals(nextPowerOf2(2), 2);
    assertEquals(nextPowerOf2(4), 4);
    assertEquals(nextPowerOf2(8), 8);
    assertEquals(nextPowerOf2(16), 16);
    assertEquals(nextPowerOf2(32), 32);
    assertEquals(nextPowerOf2(64), 64);
  });

  await t.step('nextPowerOf2 rounds up non-powers', () => {
    assertEquals(nextPowerOf2(3), 4);
    assertEquals(nextPowerOf2(5), 8);
    assertEquals(nextPowerOf2(7), 8);
    assertEquals(nextPowerOf2(9), 16);
    assertEquals(nextPowerOf2(17), 32);
    assertEquals(nextPowerOf2(33), 64);
  });

  await t.step('nextPowerOf2 handles edge cases', () => {
    // Implementation returns 2 for n <= 1
    assertEquals(nextPowerOf2(1), 2);
    assertEquals(nextPowerOf2(0), 2);
  });

  await t.step('getSeedPositions returns correct positions for size 2', () => {
    const positions = getSeedPositions(2);
    assertEquals(positions.length, 2);
    assertEquals(positions[0], 0); // Seed 1
    assertEquals(positions[1], 1); // Seed 2
  });

  await t.step('getSeedPositions returns correct positions for size 4', () => {
    const positions = getSeedPositions(4);
    assertEquals(positions.length, 4);
    // Matchup order for 4 teams: [1, 4, 2, 3]
    // positions[seed-1] = bracket_position
    // Seed 1 at position 0, Seed 4 at position 1, Seed 2 at position 2, Seed 3 at position 3
    assertEquals(positions[0], 0); // Seed 1 -> position 0
    assertEquals(positions[1], 2); // Seed 2 -> position 2 (opposite half from seed 1)
    assertEquals(positions[2], 3); // Seed 3 -> position 3
    assertEquals(positions[3], 1); // Seed 4 -> position 1 (faces seed 1)
  });

  await t.step('getSeedPositions returns correct positions for size 8', () => {
    const positions = getSeedPositions(8);
    assertEquals(positions.length, 8);
    // Verify 1 and 2 are in opposite halves
    const seed1Half = positions[0] < 4 ? 'left' : 'right';
    const seed2Half = positions[1] < 4 ? 'left' : 'right';
    assert(seed1Half !== seed2Half, 'Seeds 1 and 2 should be in opposite halves');
  });

  await t.step('getRoundName returns Finals for last round', () => {
    assertEquals(getRoundName(3, 3), 'Finals');
    assertEquals(getRoundName(5, 5), 'Finals');
  });

  await t.step('getRoundName returns Semi-Finals for second-to-last round', () => {
    assertEquals(getRoundName(2, 3), 'Semi-Finals');
    assertEquals(getRoundName(4, 5), 'Semi-Finals');
  });

  await t.step('getRoundName returns Round N for early rounds', () => {
    assertEquals(getRoundName(1, 5), 'Round 1');
    assertEquals(getRoundName(2, 5), 'Round 2');
  });
});

// =============================================================================
// Score Validation Edge Cases
// =============================================================================

Deno.test('Score Validation Edge Cases', async (t) => {
  await t.step('valid scores array accepted', () => {
    assert(isValidScores([2, 1]));
    assert(isValidScores([0, 0]));
    assert(isValidScores([100, 99]));
  });

  await t.step('negative scores are rejected for security', () => {
    // Security improvement: scores must be non-negative
    assertFalse(isValidScores([-1, 2]));
    assertFalse(isValidScores([2, -1]));
    assertFalse(isValidScores([-1, -1]));
  });

  await t.step('non-array rejected', () => {
    assertFalse(isValidScores(null));
    assertFalse(isValidScores(undefined));
    assertFalse(isValidScores('2-1'));
    assertFalse(isValidScores({ 0: 2, 1: 1 }));
  });

  await t.step('wrong length array rejected', () => {
    assertFalse(isValidScores([2]));
    assertFalse(isValidScores([2, 1, 0]));
    assertFalse(isValidScores([]));
  });

  await t.step('non-number elements rejected', () => {
    assertFalse(isValidScores(['2', '1']));
    assertFalse(isValidScores([2, '1']));
    assertFalse(isValidScores([null, 1]));
  });

  await t.step('NaN scores are rejected', () => {
    // Security improvement: scores must be finite numbers
    assertFalse(isValidScores([NaN, 1]));
    assertFalse(isValidScores([2, NaN]));
  });

  await t.step('Infinity scores are rejected', () => {
    // Security improvement: scores must be finite numbers
    assertFalse(isValidScores([Infinity, 1]));
    assertFalse(isValidScores([2, -Infinity]));
  });
});

// =============================================================================
// shouldUpdateMatch Edge Cases
// =============================================================================

Deno.test('shouldUpdateMatch Edge Cases', async (t) => {
  await t.step('handles undefined version fields', () => {
    const incoming = { reportedAt: 1000 };
    const existing = { reportedAt: 500 };

    // Both versions default to 0, so timestamp decides
    assert(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('handles null version fields', () => {
    const incoming = { version: null, reportedAt: 1000 };
    const existing = { version: null, reportedAt: 500 };

    // null || 0 = 0, so both versions are 0
    assert(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('handles negative versions (treated as valid)', () => {
    const incoming = { version: -1, reportedAt: 1000 };
    const existing = { version: 0, reportedAt: 500 };

    // -1 < 0, so existing wins
    assertFalse(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('handles very large version numbers', () => {
    const incoming = { version: Number.MAX_SAFE_INTEGER, reportedAt: 1000 };
    const existing = { version: 1, reportedAt: 500 };

    assert(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('equal version and timestamp - incoming loses', () => {
    const incoming = { version: 1, reportedAt: 1000 };
    const existing = { version: 1, reportedAt: 1000 };

    // Neither condition met, and not admin
    assertFalse(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('admin always wins regardless of version', () => {
    const incoming = { version: 0, reportedAt: 0 };
    const existing = { version: 100, reportedAt: 999999 };

    // Admin should win even with lower version
    assert(shouldUpdateMatch(incoming, existing, true));
  });

  await t.step('higher version wins over newer timestamp', () => {
    const incoming = { version: 2, reportedAt: 100 }; // Higher version, older timestamp
    const existing = { version: 1, reportedAt: 999 }; // Lower version, newer timestamp

    assert(shouldUpdateMatch(incoming, existing, false));
  });
});

// =============================================================================
// Participant Validation Edge Cases
// =============================================================================

Deno.test('Participant Validation Edge Cases', async (t) => {
  await t.step('isValidParticipantJoinPayload accepts valid payload', () => {
    assert(isValidParticipantJoinPayload({ name: 'Player 1' }));
  });

  await t.step('isValidParticipantJoinPayload rejects null', () => {
    assertFalse(isValidParticipantJoinPayload(null));
  });

  await t.step('isValidParticipantJoinPayload rejects undefined', () => {
    assertFalse(isValidParticipantJoinPayload(undefined));
  });

  await t.step('isValidParticipantJoinPayload rejects empty name', () => {
    assertFalse(isValidParticipantJoinPayload({ name: '' }));
  });

  await t.step('isValidParticipantJoinPayload rejects missing name', () => {
    assertFalse(isValidParticipantJoinPayload({}));
  });

  await t.step('isValidParticipantJoinPayload rejects non-string name', () => {
    assertFalse(isValidParticipantJoinPayload({ name: 123 }));
    assertFalse(isValidParticipantJoinPayload({ name: null }));
    assertFalse(isValidParticipantJoinPayload({ name: ['Player 1'] }));
  });
});

// =============================================================================
// Match Result Payload Validation
// =============================================================================

Deno.test('Match Result Payload Validation', async (t) => {
  await t.step('accepts valid payload', () => {
    assert(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      winnerId: 'player-1',
      reportedAt: Date.now(),
    }));
  });

  await t.step('rejects missing matchId', () => {
    assertFalse(isValidMatchResultPayload({
      scores: [2, 1],
      winnerId: 'player-1',
      reportedAt: Date.now(),
    }));
  });

  await t.step('rejects missing scores', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      winnerId: 'player-1',
      reportedAt: Date.now(),
    }));
  });

  await t.step('rejects missing winnerId', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      reportedAt: Date.now(),
    }));
  });

  await t.step('rejects missing reportedAt', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2, 1],
      winnerId: 'player-1',
    }));
  });

  await t.step('rejects invalid scores format', () => {
    assertFalse(isValidMatchResultPayload({
      matchId: 'r1m0',
      scores: [2], // Wrong length
      winnerId: 'player-1',
      reportedAt: Date.now(),
    }));
  });

  await t.step('rejects null payload', () => {
    assertFalse(isValidMatchResultPayload(null));
  });
});

// =============================================================================
// isValidState Edge Cases
// =============================================================================

Deno.test('isValidState Edge Cases', async (t) => {
  await t.step('rejects null', () => {
    assertFalse(isValidState(null));
  });

  await t.step('rejects primitives', () => {
    assertFalse(isValidState('string'));
    assertFalse(isValidState(123));
  });

  await t.step('arrays pass base object check (typeof [] === object)', () => {
    // Note: Arrays are objects in JavaScript, so empty array passes base check
    // This is a limitation of the structural validation
    assert(isValidState([]));
  });

  await t.step('rejects null meta', () => {
    assertFalse(isValidState({ meta: null }));
  });

  await t.step('rejects non-array participants', () => {
    assertFalse(isValidState({ participants: {} }));
    assertFalse(isValidState({ participants: 'invalid' }));
  });

  await t.step('rejects invalid participant entry format', () => {
    // Entry is not an array
    assertFalse(isValidState({ participants: [{ id: 'p1', name: 'Player' }] }));

    // Entry has wrong length
    assertFalse(isValidState({ participants: [['p1']] }));
    assertFalse(isValidState({ participants: [['p1', {}, 'extra']] }));
  });

  await t.step('rejects non-string participant ID', () => {
    assertFalse(isValidState({ participants: [[123, { name: 'Player' }]] }));
  });

  await t.step('rejects null participant object', () => {
    assertFalse(isValidState({ participants: [['p1', null]] }));
  });

  await t.step('rejects non-array matches', () => {
    assertFalse(isValidState({ matches: {} }));
  });

  await t.step('rejects invalid match entry format', () => {
    assertFalse(isValidState({ matches: [['m1']] })); // Wrong length
    assertFalse(isValidState({ matches: [[123, {}]] })); // Non-string ID
  });

  await t.step('accepts valid complex state', () => {
    assert(isValidState({
      meta: { status: 'active', type: 'single' },
      participants: [
        ['p1', { id: 'p1', name: 'Player 1' }],
        ['p2', { id: 'p2', name: 'Player 2' }],
      ],
      matches: [
        ['r1m0', { id: 'r1m0', participants: ['p1', 'p2'] }],
      ],
    }));
  });
});

// =============================================================================
// Store Participant Edge Cases
// =============================================================================

Deno.test('Store Participant Edge Cases', async (t) => {
  await t.step('auto-assigns seed when null provided', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({
      id: 'p1',
      name: 'Player 1',
      seed: null,
    });

    const p = store.getParticipant('p1');
    // null || size + 1 = 0 + 1 = 1
    assertEquals(p.seed, 1);
  });

  await t.step('auto-assigns seed when not provided', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({
      id: 'p1',
      name: 'Player 1',
      // seed not specified
    });

    const p = store.getParticipant('p1');
    // undefined || size + 1 = 0 + 1 = 1
    assertEquals(p.seed, 1);
  });

  await t.step('preserves explicit seed value', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({
      id: 'p1',
      name: 'Player 1',
      seed: 5,
    });

    const p = store.getParticipant('p1');
    assertEquals(p.seed, 5);
  });

  await t.step('handles unicode names', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({
      id: 'p1',
      name: '选手一',
    });

    const p = store.getParticipant('p1');
    assertEquals(p.name, '选手一');
  });

  await t.step('handles emoji in names', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({
      id: 'p1',
      name: '🎮 Gamer',
    });

    const p = store.getParticipant('p1');
    assertEquals(p.name, '🎮 Gamer');
  });
});
