/**
 * Full Single Elimination Tournament Simulation - 15 Players
 *
 * This test traces code paths by importing modules and simulating
 * a complete 15-person Single Elimination bracket from start to finish.
 * Theme: Tennis Grand Slam Tournament
 */

import { assertEquals, assert, assertExists } from 'jsr:@std/assert';

// State management
import { Store, createInitialState } from '../../js/state/store.js';

// Tournament logic
import {
  generateSingleEliminationBracket,
  recordMatchResult,
  getStandings,
} from '../../js/tournament/single-elimination.js';

// Bracket utilities
import {
  getSeedPositions,
  nextPowerOf2,
  getRoundName,
} from '../../js/tournament/bracket-utils.js';

// Configuration
import { CONFIG } from '../../config.js';

// Fixtures
import {
  createParticipants,
  createParticipantMap,
  createMockRoom,
  createMockLocalStorage,
} from '../fixtures.js';

// ============================================================================
// Test Data: 15 Tennis-themed participants (Grand Slam style)
// ============================================================================

const TENNIS_PLAYERS = [
  { id: 'player-federer', name: 'Roger Federer', seed: 1 },
  { id: 'player-nadal', name: 'Rafael Nadal', seed: 2 },
  { id: 'player-djokovic', name: 'Novak Djokovic', seed: 3 },
  { id: 'player-murray', name: 'Andy Murray', seed: 4 },
  { id: 'player-wawrinka', name: 'Stan Wawrinka', seed: 5 },
  { id: 'player-delpo', name: 'Juan Martin del Potro', seed: 6 },
  { id: 'player-tsitsipas', name: 'Stefanos Tsitsipas', seed: 7 },
  { id: 'player-zverev', name: 'Alexander Zverev', seed: 8 },
  { id: 'player-thiem', name: 'Dominic Thiem', seed: 9 },
  { id: 'player-medvedev', name: 'Daniil Medvedev', seed: 10 },
  { id: 'player-rublev', name: 'Andrey Rublev', seed: 11 },
  { id: 'player-sinner', name: 'Jannik Sinner', seed: 12 },
  { id: 'player-alcaraz', name: 'Carlos Alcaraz', seed: 13 },
  { id: 'player-ruud', name: 'Casper Ruud', seed: 14 },
  { id: 'player-fritz', name: 'Taylor Fritz', seed: 15 },
];

// Seeded random for reproducible results
function seededRandom(seed) {
  let value = seed;
  return function() {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return value / 0x7fffffff;
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a Store with 15 tennis players and admin setup
 */
function setupTennisLobby() {
  const store = new Store();
  const adminId = 'admin-umpire';

  // Set up tournament metadata
  store.set('meta.id', 'wimbledon-2024');
  store.set('meta.name', 'Wimbledon Championship 2024');
  store.set('meta.type', 'single');
  store.set('meta.adminId', adminId);
  store.set('meta.status', 'lobby');
  store.set('meta.createdAt', Date.now());
  store.set('meta.config.bestOf', 5);

  // Set local admin state
  store.set('local.isAdmin', true);
  store.set('local.name', 'Chair Umpire');

  // Add all 15 players
  for (const player of TENNIS_PLAYERS) {
    store.addParticipant({
      ...player,
      joinedAt: Date.now() - (16 - player.seed) * 1000,
      isConnected: true,
      isManual: false,
    });
  }

  return { store, adminId, participants: TENNIS_PLAYERS };
}

/**
 * Simulate a match result with upset probability based on seeds
 */
function simulateMatchResult(match, participantMap, random) {
  const [p1Id, p2Id] = match.participants;
  if (!p1Id || !p2Id) return null;

  const p1 = participantMap.get(p1Id);
  const p2 = participantMap.get(p2Id);

  // Higher seed (lower number) has advantage
  const p1Seed = p1?.seed || 999;
  const p2Seed = p2?.seed || 999;

  // Probability favors lower seed number
  const p1Advantage = (p2Seed - p1Seed) / 20; // Seed diff / 20
  const p1WinProb = 0.5 + p1Advantage;

  const winner = random() < p1WinProb ? p1Id : p2Id;
  const loser = winner === p1Id ? p2Id : p1Id;

  // Generate tennis-like scores (best of 5 or 3)
  const winnerSets = random() < 0.7 ? 3 : 2; // 3-0 or 3-1 or 3-2
  const loserSets = winnerSets === 3 ? Math.floor(random() * 3) : Math.floor(random() * 2);

  return {
    winnerId: winner,
    loserId: loser,
    scores: winner === p1Id ? [winnerSets, loserSets] : [loserSets, winnerSets],
  };
}

/**
 * Play through entire bracket
 */
function playEntireBracket(bracket, participantMap, random) {
  const matchResults = [];

  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      // Skip bye matches and already completed matches
      if (match.isBye || match.winnerId) continue;

      // Wait for participants to be set (from previous round advancement)
      if (!match.participants[0] || !match.participants[1]) continue;

      const result = simulateMatchResult(match, participantMap, random);
      if (result) {
        recordMatchResult(bracket, match.id, result.scores, result.winnerId, result.winnerId);
        matchResults.push({
          matchId: match.id,
          round: match.round,
          ...result,
        });
      }
    }
  }

  return matchResults;
}

// ============================================================================
// Main Simulation Test
// ============================================================================

Deno.test('15-Player Single Elimination Full Tournament Simulation', async (t) => {
  const random = seededRandom(123);

  await t.step('Phase 1: Lobby Setup', () => {
    const { store, adminId, participants } = setupTennisLobby();

    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.get('meta.type'), 'single');
    assertEquals(store.get('meta.name'), 'Wimbledon Championship 2024');
    assertEquals(store.getParticipantList().length, 15);
    assert(store.isAdmin());

    // Verify all players
    for (const player of TENNIS_PLAYERS) {
      const p = store.getParticipant(player.id);
      assertExists(p);
      assertEquals(p.name, player.name);
      assertEquals(p.seed, player.seed);
    }

    console.log('✓ Lobby set up with 15 tennis players');
  });

  await t.step('Phase 2: Bracket Generation', () => {
    const { store } = setupTennisLobby();
    const participantArray = store.getParticipantList();

    const bracket = generateSingleEliminationBracket(participantArray);

    // 15 players -> 16-slot bracket
    assertEquals(bracket.type, 'single');
    assertEquals(bracket.bracketSize, 16);
    assertEquals(bracket.numRounds, 4);
    assertEquals(bracket.participantCount, 15);

    // Should have 15 matches total (16 - 1 = 15, but with byes)
    // Round 1: 8 matches, Round 2: 4, Round 3: 2, Round 4: 1
    assertEquals(bracket.rounds.length, 4);
    assertEquals(bracket.rounds[0].matches.length, 8);
    assertEquals(bracket.rounds[1].matches.length, 4);
    assertEquals(bracket.rounds[2].matches.length, 2);
    assertEquals(bracket.rounds[3].matches.length, 1);

    // Total matches
    assertEquals(bracket.matches.size, 15);

    // Verify round names
    assertEquals(bracket.rounds[0].name, 'Round 1');
    assertEquals(bracket.rounds[1].name, 'Quarter-Finals');
    assertEquals(bracket.rounds[2].name, 'Semi-Finals');
    assertEquals(bracket.rounds[3].name, 'Finals');

    // With 15 players in 16-slot bracket, there's 1 bye
    const byeMatches = bracket.rounds[0].matches.filter(m => m.isBye);
    assertEquals(byeMatches.length, 1);

    // Bye should auto-advance the player
    assert(byeMatches[0].winnerId !== null);

    console.log(`✓ Bracket generated: ${bracket.bracketSize}-slot with ${bracket.numRounds} rounds`);
    console.log(`  Bye matches: ${byeMatches.length}`);
  });

  await t.step('Phase 3: Seeding Verification', () => {
    const { store } = setupTennisLobby();
    const participantArray = store.getParticipantList();
    const bracket = generateSingleEliminationBracket(participantArray);

    // Federer (seed 1) should be on opposite side from Nadal (seed 2)
    // They should only meet in the finals
    const round1 = bracket.rounds[0];

    // Find where top seeds are placed
    const federerMatch = round1.matches.find(m =>
      m.participants.includes('player-federer')
    );
    const nadalMatch = round1.matches.find(m =>
      m.participants.includes('player-nadal')
    );

    assertExists(federerMatch);
    assertExists(nadalMatch);

    // Seeds 1 and 2 should be in different halves of the bracket
    // One should be in matches 0-3, the other in 4-7
    const federerInTopHalf = federerMatch.position < 4;
    const nadalInTopHalf = nadalMatch.position < 4;
    assert(federerInTopHalf !== nadalInTopHalf, 'Seeds 1 and 2 should be in opposite halves');

    // Seed 1 plays lowest seed (or bye)
    // With 15 players, seed 16 is a bye, so seed 1 might get a favorable draw
    console.log(`✓ Seeding verified: Federer vs ${federerMatch.participants[1] || 'BYE'}`);
  });

  await t.step('Phase 4: Play All Matches', () => {
    const { store } = setupTennisLobby();
    const participantArray = store.getParticipantList();
    const participantMap = createParticipantMap(participantArray);

    const bracket = generateSingleEliminationBracket(participantArray);

    // Transition to active
    store.set('meta.status', 'active');

    // Play through the tournament
    const matchResults = playEntireBracket(bracket, participantMap, random);

    // Verify tournament completion
    assert(bracket.isComplete, 'Tournament should be complete');

    // Count actual played matches (excluding byes)
    const playedMatches = matchResults.length;
    console.log(`✓ Played ${playedMatches} matches`);

    // Log round-by-round results
    console.log('\n  Tournament Results:');
    for (const round of bracket.rounds) {
      console.log(`    ${round.name}:`);
      for (const match of round.matches) {
        if (match.isBye) {
          const advancer = participantMap.get(match.winnerId);
          console.log(`      ${advancer?.name || 'Unknown'} (BYE)`);
        } else if (match.winnerId) {
          const winner = participantMap.get(match.winnerId);
          const loser = participantMap.get(match.participants.find(p => p !== match.winnerId));
          console.log(`      ${winner?.name} def. ${loser?.name} (${match.scores.join('-')})`);
        }
      }
    }
  });

  await t.step('Phase 5: Verify Final Standings', () => {
    const { store } = setupTennisLobby();
    const participantArray = store.getParticipantList();
    const participantMap = createParticipantMap(participantArray);

    const bracket = generateSingleEliminationBracket(participantArray);
    playEntireBracket(bracket, participantMap, random);

    // Get standings
    const standings = getStandings(bracket, participantMap);

    assertEquals(standings.length, 15);

    // Verify champion and runner-up
    assertEquals(standings[0].place, 1);
    assertEquals(standings[1].place, 2);

    // Places should be sequential
    for (let i = 0; i < standings.length; i++) {
      assertEquals(standings[i].place, i + 1);
    }

    console.log('\n  Final Standings:');
    for (const s of standings.slice(0, 8)) {
      console.log(`    ${s.place}. ${s.name}`);
    }
    console.log(`    ... and ${standings.length - 8} more`);

    console.log(`\n✓ Tournament Champion: ${standings[0].name}`);
    console.log(`  Runner-up: ${standings[1].name}`);
  });

  await t.step('Phase 6: State Management Integration', () => {
    const { store } = setupTennisLobby();
    const participantArray = store.getParticipantList();
    const participantMap = createParticipantMap(participantArray);

    const bracket = generateSingleEliminationBracket(participantArray);

    // Load matches into store
    for (const [id, match] of bracket.matches) {
      store.getState().matches.set(id, { ...match });
    }

    // Play some matches and sync to store
    const round1 = bracket.rounds[0];
    for (const match of round1.matches) {
      if (match.isBye || match.winnerId) continue;
      if (!match.participants[0] || !match.participants[1]) continue;

      const result = simulateMatchResult(match, participantMap, random);
      if (result) {
        recordMatchResult(bracket, match.id, result.scores, result.winnerId, result.winnerId);
        // Update store
        store.updateMatch(match.id, {
          scores: result.scores,
          winnerId: result.winnerId,
          reportedAt: Date.now(),
        });
      }
    }

    // Verify store has updated matches
    const storedMatch = store.getMatch('r1m0');
    assertExists(storedMatch);

    // Serialize and deserialize
    const serialized = store.serialize();
    const newStore = new Store();
    newStore.deserialize(serialized);

    assertEquals(newStore.get('meta.type'), 'single');
    assertEquals(newStore.getParticipantList().length, 15);
    assert(newStore.getState().matches.size > 0);

    console.log('✓ State management integration verified');
  });
});

// ============================================================================
// Additional Single Elimination Tests
// ============================================================================

Deno.test('Single Elimination Bracket Sizes', async (t) => {
  await t.step('2-player bracket', () => {
    const participants = createParticipants(2);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 2);
    assertEquals(bracket.numRounds, 1);
    assertEquals(bracket.matches.size, 1);
    // Round 1 is always named "Round 1" in the generator
    assertEquals(bracket.rounds[0].name, 'Round 1');
  });

  await t.step('3-player bracket (with 1 bye)', () => {
    const participants = createParticipants(3);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 4);
    assertEquals(bracket.numRounds, 2);

    const byeMatches = bracket.rounds[0].matches.filter(m => m.isBye);
    assertEquals(byeMatches.length, 1);
  });

  await t.step('8-player perfect bracket', () => {
    const participants = createParticipants(8);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 8);
    assertEquals(bracket.numRounds, 3);
    assertEquals(bracket.matches.size, 7); // 8-1 = 7

    const byeMatches = bracket.rounds[0].matches.filter(m => m.isBye);
    assertEquals(byeMatches.length, 0); // No byes needed
  });

  await t.step('16-player perfect bracket', () => {
    const participants = createParticipants(16);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 16);
    assertEquals(bracket.numRounds, 4);
    assertEquals(bracket.matches.size, 15);
  });
});

Deno.test('Single Elimination Upset Scenarios', async (t) => {
  await t.step('lowest seed wins entire tournament', () => {
    const participants = createParticipants(4);
    const participantMap = createParticipantMap(participants);
    const bracket = generateSingleEliminationBracket(participants);

    // Play through with seed 4 winning everything
    for (const round of bracket.rounds) {
      for (const match of round.matches) {
        if (match.isBye || match.winnerId) continue;
        if (!match.participants[0] || !match.participants[1]) continue;

        // Force player-4 to win if present, otherwise higher seed loses
        const winnerId = match.participants.includes('player-4')
          ? 'player-4'
          : match.participants[1]; // Second participant is usually lower seed

        recordMatchResult(bracket, match.id, [2, 0], winnerId, winnerId);
      }
    }

    assert(bracket.isComplete);
    const standings = getStandings(bracket, participantMap);

    // player-4 should be champion (massive upset)
    assertEquals(standings[0].participantId, 'player-4');
    assertEquals(standings[0].place, 1);
  });
});

Deno.test('Event Tracking During Single Elimination', async (t) => {
  await t.step('match update events fire correctly', () => {
    const store = new Store();
    const matchEvents = [];

    store.on('match:update', (data) => matchEvents.push(data));

    // Add a match
    store.getState().matches.set('r1m0', {
      id: 'r1m0',
      participants: ['p1', 'p2'],
      scores: [0, 0],
      winnerId: null,
    });

    // Update the match
    store.updateMatch('r1m0', {
      scores: [3, 1],
      winnerId: 'p1',
      reportedAt: Date.now(),
    });

    assertEquals(matchEvents.length, 1);
    assertEquals(matchEvents[0].id, 'r1m0');
    assertEquals(matchEvents[0].match.winnerId, 'p1');
  });
});
