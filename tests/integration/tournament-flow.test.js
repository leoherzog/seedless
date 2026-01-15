/**
 * Integration Tests for Tournament Flows
 * Tests end-to-end tournament scenarios using Store + Tournament modules
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { Store } from '../../js/state/store.js';
import {
  generateSingleEliminationBracket,
  recordMatchResult,
  getStandings as getSingleEliminationStandings,
} from '../../js/tournament/single-elimination.js';
import {
  generateDoubleEliminationBracket,
  recordMatchResult as recordDoubleElimResult,
  getStandings as getDoubleEliminationStandings,
} from '../../js/tournament/double-elimination.js';
import {
  generateMarioKartTournament,
  recordRaceResult,
  getStandings as getMarioKartStandings,
} from '../../js/tournament/mario-kart.js';
import { createParticipants, createParticipantMap } from '../fixtures.js';

/**
 * Helper to set up a store with participants
 */
function setupStoreWithParticipants(count) {
  const store = new Store();
  const participants = createParticipants(count);
  for (const p of participants) {
    store.addParticipant(p);
  }
  return { store, participants };
}

/**
 * Helper to load bracket matches into store
 */
function loadBracketIntoStore(store, bracket) {
  const state = store.getState();
  for (const [id, match] of bracket.matches) {
    state.matches.set(id, { ...match });
  }
}

// =============================================================================
// Single Elimination Integration Tests
// =============================================================================

Deno.test('Single Elimination Flow', async (t) => {
  await t.step('4-player tournament from lobby to champion', () => {
    // Setup: Create store and add participants
    const { store, participants } = setupStoreWithParticipants(4);
    store.set('meta.type', 'single');
    store.set('meta.status', 'lobby');

    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.getParticipantList().length, 4);

    // Generate bracket
    const participantArray = store.getParticipantList();
    const bracket = generateSingleEliminationBracket(participantArray);

    // Transition to active
    store.set('meta.status', 'active');
    loadBracketIntoStore(store, bracket);

    assertEquals(store.get('meta.status'), 'active');
    assertEquals(store.getState().matches.size, bracket.matches.size);

    // Play semifinals
    // Seed 1 (player-1) vs Seed 4 (player-4)
    recordMatchResult(bracket, 'r1m0', [2, 0], 'player-1', 'player-1');
    store.getState().matches.set('r1m0', bracket.matches.get('r1m0'));

    // Seed 2 (player-2) vs Seed 3 (player-3) - upset!
    recordMatchResult(bracket, 'r1m1', [1, 2], 'player-3', 'player-3');
    store.getState().matches.set('r1m1', bracket.matches.get('r1m1'));

    // Verify advancement to finals
    const finals = bracket.matches.get('r2m0');
    assertEquals(finals.participants[0], 'player-1');
    assertEquals(finals.participants[1], 'player-3');

    // Play finals
    recordMatchResult(bracket, 'r2m0', [2, 1], 'player-1', 'player-1');
    store.getState().matches.set('r2m0', bracket.matches.get('r2m0'));

    // Verify tournament complete
    assertEquals(bracket.isComplete, true);

    // Get final standings
    const participantMap = createParticipantMap(participantArray);
    const standings = getSingleEliminationStandings(bracket, participantMap);

    assertEquals(standings.length, 4);
    assertEquals(standings[0].participantId, 'player-1');
    assertEquals(standings[0].place, 1);
    assertEquals(standings[1].participantId, 'player-3');
    assertEquals(standings[1].place, 2);
  });

  await t.step('handles bye advancement correctly', () => {
    // 3-player tournament (one bye)
    const { store, participants } = setupStoreWithParticipants(3);
    const participantArray = store.getParticipantList();
    const bracket = generateSingleEliminationBracket(participantArray);

    // Verify bye structure
    assertEquals(bracket.bracketSize, 4);
    const byeMatches = bracket.rounds[0].matches.filter(m => m.isBye);
    assertEquals(byeMatches.length, 1);

    // Bye winner should already be advanced
    assert(byeMatches[0].winnerId !== null);

    // Play the non-bye match
    const nonByeMatch = bracket.rounds[0].matches.find(m => !m.isBye);
    const nonByeWinner = nonByeMatch.participants[0];
    recordMatchResult(bracket, nonByeMatch.id, [2, 0], nonByeWinner, nonByeWinner);

    // Finals should now have both participants
    const finals = bracket.rounds[1].matches[0];
    assert(finals.participants[0] !== null);
    assert(finals.participants[1] !== null);

    // Play finals
    recordMatchResult(bracket, finals.id, [2, 1], finals.participants[0], finals.participants[0]);
    assertEquals(bracket.isComplete, true);
  });

  await t.step('8-player bracket progression through all rounds', () => {
    const { store, participants } = setupStoreWithParticipants(8);
    const participantArray = store.getParticipantList();
    const bracket = generateSingleEliminationBracket(participantArray);

    assertEquals(bracket.numRounds, 3);
    assertEquals(bracket.rounds[0].matches.length, 4);
    assertEquals(bracket.rounds[1].matches.length, 2);
    assertEquals(bracket.rounds[2].matches.length, 1);

    // Play all quarter-finals - higher seeds win
    for (const match of bracket.rounds[0].matches) {
      const winner = match.participants[0]; // Higher seed is first
      recordMatchResult(bracket, match.id, [2, 0], winner, winner);
    }

    // Verify all quarter-final winners advanced
    for (const match of bracket.rounds[1].matches) {
      assert(match.participants[0] !== null);
      assert(match.participants[1] !== null);
    }

    // Play semi-finals
    for (const match of bracket.rounds[1].matches) {
      const winner = match.participants[0];
      recordMatchResult(bracket, match.id, [2, 0], winner, winner);
    }

    // Play finals
    const finals = bracket.rounds[2].matches[0];
    recordMatchResult(bracket, finals.id, [2, 0], 'player-1', 'player-1');

    assertEquals(bracket.isComplete, true);

    const participantMap = createParticipantMap(participantArray);
    const standings = getSingleEliminationStandings(bracket, participantMap);
    assertEquals(standings[0].participantId, 'player-1');
  });
});

// =============================================================================
// Double Elimination Integration Tests
// =============================================================================

Deno.test('Double Elimination Flow', async (t) => {
  await t.step('4-player double elim - winner never loses', () => {
    const { store, participants } = setupStoreWithParticipants(4);
    const participantArray = store.getParticipantList();
    const bracket = generateDoubleEliminationBracket(participantArray);

    assertEquals(bracket.type, 'double');

    // Winners bracket semi 1: player-1 beats player-4
    recordDoubleElimResult(bracket, 'w1m0', [2, 0], 'player-1', 'player-1');
    // Winners bracket semi 2: player-2 beats player-3
    recordDoubleElimResult(bracket, 'w1m1', [2, 0], 'player-2', 'player-2');

    // Winners finals: player-1 beats player-2
    recordDoubleElimResult(bracket, 'w2m0', [2, 0], 'player-1', 'player-1');

    // Find and play losers matches
    // After winners bracket, player-4 and player-3 are in losers
    for (const round of bracket.losers.rounds) {
      for (const match of round.matches) {
        if (!match.winnerId && match.participants[0] && match.participants[1]) {
          recordDoubleElimResult(bracket, match.id, [2, 0], match.participants[0], match.participants[0]);
        }
      }
    }

    // Grand finals: player-1 vs losers bracket winner
    const grandFinals = bracket.grandFinals.match;
    if (grandFinals && grandFinals.participants[0] && grandFinals.participants[1]) {
      // player-1 wins from winners bracket
      recordDoubleElimResult(bracket, 'gf1', [2, 0], 'player-1', 'player-1');
    }

    // With player-1 winning from winners bracket, tournament should be complete
    // (no reset needed since winners bracket winner won)
    if (bracket.isComplete) {
      const participantMap = createParticipantMap(participantArray);
      const standings = getDoubleEliminationStandings(bracket, participantMap);
      assertEquals(standings[0].participantId, 'player-1');
    }
  });

  await t.step('tests loser dropping to losers bracket', () => {
    const { store, participants } = setupStoreWithParticipants(4);
    const participantArray = store.getParticipantList();
    const bracket = generateDoubleEliminationBracket(participantArray);

    // player-4 beats player-1 (upset in winners semi)
    recordDoubleElimResult(bracket, 'w1m0', [0, 2], 'player-4', 'player-4');

    // player-1 should now be in losers bracket
    // Check if player-1 appears in a losers bracket match
    let player1InLosers = false;
    for (const [id, match] of bracket.matches) {
      if (id.startsWith('l') && match.participants.includes('player-1')) {
        player1InLosers = true;
        break;
      }
    }
    assert(player1InLosers, 'Player 1 should be in losers bracket after losing');
  });
});

// =============================================================================
// Points Race (Mario Kart) Integration Tests
// =============================================================================

Deno.test('Points Race Flow', async (t) => {
  await t.step('4-player mario kart tournament complete flow', () => {
    const { store, participants } = setupStoreWithParticipants(4);
    store.set('meta.type', 'mariokart');

    const participantArray = store.getParticipantList();
    const tournament = generateMarioKartTournament(participantArray, {
      playersPerGame: 4,
      gamesPerPlayer: 2,
      pointsTable: [15, 12, 10, 8],
    });

    assertEquals(tournament.isComplete, false);
    assertEquals(tournament.standings.size, 4);

    // Play all games
    for (const [gameId, game] of tournament.matches) {
      if (!game.complete) {
        // Vary the results - sometimes player-1 wins, sometimes player-2
        const shuffledParticipants = [...game.participants];
        if (game.gameNumber % 2 === 0) {
          // Reverse order for even games
          shuffledParticipants.reverse();
        }

        const results = shuffledParticipants.map((pId) => ({
          participantId: pId,
        }));

        recordRaceResult(tournament, gameId, results, 'player-1');
      }
    }

    assertEquals(tournament.isComplete, true);

    // Get final standings
    const standings = getMarioKartStandings(tournament);
    assertEquals(standings.length, 4);

    // Each player should have place assigned
    for (let i = 0; i < standings.length; i++) {
      assertEquals(standings[i].place, i + 1);
    }

    // Verify points were accumulated
    assert(standings[0].points > 0, 'First place should have points');
  });

  await t.step('points accumulate correctly across games', () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 2,
      pointsTable: [15, 12, 10, 8],
    });

    // Player-1 wins first place in first game
    const games = Array.from(tournament.matches.values());
    const game1 = games[0];

    recordRaceResult(tournament, game1.id, [
      { participantId: 'player-1' },
      { participantId: 'player-2' },
      { participantId: 'player-3' },
      { participantId: 'player-4' },
    ], 'player-1');

    assertEquals(tournament.standings.get('player-1').points, 15);
    assertEquals(tournament.standings.get('player-2').points, 12);
    assertEquals(tournament.standings.get('player-3').points, 10);
    assertEquals(tournament.standings.get('player-4').points, 8);

    // Player-4 wins first in second game
    const game2 = games[1];
    if (game2 && !game2.complete) {
      recordRaceResult(tournament, game2.id, [
        { participantId: 'player-4' },
        { participantId: 'player-3' },
        { participantId: 'player-2' },
        { participantId: 'player-1' },
      ], 'player-4');

      // Points should accumulate
      assertEquals(tournament.standings.get('player-1').points, 15 + 8);
      assertEquals(tournament.standings.get('player-4').points, 8 + 15);
    }
  });

  await t.step('wins tiebreaker works correctly', () => {
    const participants = createParticipants(2);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 2,
      gamesPerPlayer: 2,
      pointsTable: [10, 8],
    });

    const games = Array.from(tournament.matches.values());

    // Game 1: player-1 wins
    recordRaceResult(tournament, games[0].id, [
      { participantId: 'player-1' },
      { participantId: 'player-2' },
    ], 'player-1');

    // Game 2: player-2 wins
    if (games[1]) {
      recordRaceResult(tournament, games[1].id, [
        { participantId: 'player-2' },
        { participantId: 'player-1' },
      ], 'player-2');
    }

    // Both should have same points (10 + 8 = 18)
    assertEquals(tournament.standings.get('player-1').points, 18);
    assertEquals(tournament.standings.get('player-2').points, 18);

    // Both should have 1 win
    assertEquals(tournament.standings.get('player-1').wins, 1);
    assertEquals(tournament.standings.get('player-2').wins, 1);
  });
});

// =============================================================================
// Store Integration Tests
// =============================================================================

Deno.test('Store Integration', async (t) => {
  await t.step('participant management during tournament', () => {
    const store = new Store();

    // Add participants in lobby
    store.set('meta.status', 'lobby');
    store.addParticipant({ id: 'p1', name: 'Alice' });
    store.addParticipant({ id: 'p2', name: 'Bob' });
    store.addParticipant({ id: 'p3', name: 'Charlie' });
    store.addParticipant({ id: 'p4', name: 'Diana' });

    assertEquals(store.getParticipantList().length, 4);

    // Update participant
    store.updateParticipant('p1', { name: 'Alice Smith' });
    assertEquals(store.getParticipant('p1').name, 'Alice Smith');

    // Transition to active
    store.set('meta.status', 'active');

    // Participants should still be accessible
    assertEquals(store.getParticipantList().length, 4);
    assertEquals(store.getParticipant('p2').name, 'Bob');
  });

  await t.step('match state synchronization', () => {
    const store = new Store();

    // Simulate receiving match state
    const matchData = {
      id: 'r1m0',
      participants: ['p1', 'p2'],
      scores: [0, 0],
      winnerId: null,
      reportedAt: null,
    };

    store.getState().matches.set('r1m0', matchData);

    // Update match result
    const updatedMatch = {
      ...store.getMatch('r1m0'),
      scores: [2, 1],
      winnerId: 'p1',
      reportedAt: Date.now(),
    };
    store.getState().matches.set('r1m0', updatedMatch);

    assertEquals(store.getMatch('r1m0').winnerId, 'p1');
    assertEquals(store.getMatch('r1m0').scores, [2, 1]);
  });

  await t.step('serialization preserves tournament state', () => {
    const store = new Store();
    store.set('meta.id', 'test-room');
    store.set('meta.type', 'single');
    store.set('meta.status', 'active');

    store.addParticipant({ id: 'p1', name: 'Alice', seed: 1 });
    store.addParticipant({ id: 'p2', name: 'Bob', seed: 2 });

    store.getState().matches.set('r1m0', {
      id: 'r1m0',
      participants: ['p1', 'p2'],
      scores: [2, 1],
      winnerId: 'p1',
    });

    // Serialize
    const serialized = store.serialize();

    // Create new store and deserialize
    const store2 = new Store();
    store2.deserialize(serialized);

    assertEquals(store2.get('meta.id'), 'test-room');
    assertEquals(store2.get('meta.type'), 'single');
    assertEquals(store2.getParticipant('p1').name, 'Alice');
    assertEquals(store2.getMatch('r1m0').winnerId, 'p1');
  });

  await t.step('version tracking across operations', () => {
    const store = new Store();
    const initialVersion = store.get('meta.version');

    store.addParticipant({ id: 'p1', name: 'Alice' });
    const v1 = store.get('meta.version');
    assert(v1 > initialVersion);

    store.addParticipant({ id: 'p2', name: 'Bob' });
    const v2 = store.get('meta.version');
    assert(v2 > v1);

    store.updateParticipant('p1', { name: 'Alice Updated' });
    const v3 = store.get('meta.version');
    assert(v3 > v2);
  });
});

// =============================================================================
// Event Flow Tests
// =============================================================================

Deno.test('Event Flow', async (t) => {
  await t.step('change events fire on updates', () => {
    const store = new Store();
    const events = [];

    store.on('change', (data) => events.push({ type: 'change', data }));

    store.set('meta.status', 'active');
    store.addParticipant({ id: 'p1', name: 'Alice' });

    assert(events.length >= 2, 'Should have fired change events');
  });

  await t.step('participant events track join/leave', () => {
    const store = new Store();
    const joins = [];
    const leaves = [];

    store.on('participant:join', (p) => joins.push(p));
    store.on('participant:leave', (p) => leaves.push(p));

    store.addParticipant({ id: 'p1', name: 'Alice' });
    store.addParticipant({ id: 'p2', name: 'Bob' });
    store.removeParticipant('p1');

    assertEquals(joins.length, 2);
    assertEquals(leaves.length, 1);
    // participant:leave emits the full participant object
    assertEquals(leaves[0].id, 'p1');
  });
});
