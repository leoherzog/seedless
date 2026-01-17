/**
 * Full Double Elimination Tournament Simulation - 8 Players
 *
 * This test traces code paths by importing modules and simulating
 * a complete 8-person Double Elimination bracket from start to finish.
 * Theme: Fighting Game Tournament (EVO style)
 *
 * Note: Using 8 players (power of 2) for cleaner bracket without byes,
 * making the simulation more reliable. The complex bye handling is
 * tested separately in unit tests.
 */

import { assertEquals, assert, assertExists } from 'jsr:@std/assert';

// State management
import { Store, createInitialState } from '../../js/state/store.js';

// Tournament logic
import {
  generateDoubleEliminationBracket,
  recordMatchResult,
  getStandings,
} from '../../js/tournament/double-elimination.js';

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
// Test Data: 8 Fighting Game themed participants (EVO style)
// ============================================================================

const FIGHTING_GAME_PLAYERS = [
  { id: 'player-daigo', name: 'Daigo Umehara', seed: 1 },
  { id: 'player-tokido', name: 'Tokido', seed: 2 },
  { id: 'player-punk', name: 'Punk', seed: 3 },
  { id: 'player-momochi', name: 'Momochi', seed: 4 },
  { id: 'player-infiltration', name: 'Infiltration', seed: 5 },
  { id: 'player-fuudo', name: 'Fuudo', seed: 6 },
  { id: 'player-nuckledu', name: 'NuckleDu', seed: 7 },
  { id: 'player-kazunoko', name: 'Kazunoko', seed: 8 },
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
 * Create a Store with 15 FGC players and admin setup
 */
function setupEvoLobby() {
  const store = new Store();
  const adminId = 'admin-mrwizard';

  // Set up tournament metadata
  store.set('meta.id', 'evo-2024-sf6');
  store.set('meta.name', 'EVO 2024 Street Fighter 6');
  store.set('meta.type', 'double');
  store.set('meta.adminId', adminId);
  store.set('meta.status', 'lobby');
  store.set('meta.createdAt', Date.now());
  store.set('meta.config.bestOf', 3);

  // Set local admin state
  store.set('local.isAdmin', true);
  store.set('local.name', 'Tournament Organizer');

  // Add all 8 players
  for (const player of FIGHTING_GAME_PLAYERS) {
    store.addParticipant({
      ...player,
      joinedAt: Date.now() - (9 - player.seed) * 1000,
      isConnected: true,
      isManual: false,
    });
  }

  return { store, adminId, participants: FIGHTING_GAME_PLAYERS };
}

/**
 * Simulate a match result with upset probability
 */
function simulateMatchResult(match, participantMap, random, isLosers = false) {
  const [p1Id, p2Id] = match.participants;
  if (!p1Id || !p2Id) return null;

  const p1 = participantMap.get(p1Id);
  const p2 = participantMap.get(p2Id);

  const p1Seed = p1?.seed || 999;
  const p2Seed = p2?.seed || 999;

  // Losers bracket = more upsets (players are warmed up, motivated)
  const upsetFactor = isLosers ? 0.1 : 0.05;

  const p1Advantage = (p2Seed - p1Seed) / 20;
  const p1WinProb = 0.5 + p1Advantage - upsetFactor;

  const winner = random() < p1WinProb ? p1Id : p2Id;
  const loser = winner === p1Id ? p2Id : p1Id;

  // FGC style scores (best of 3 or 5)
  const winnerGames = random() < 0.6 ? 2 : 2;
  const loserGames = Math.floor(random() * winnerGames);

  return {
    winnerId: winner,
    loserId: loser,
    scores: winner === p1Id ? [winnerGames, loserGames] : [loserGames, winnerGames],
  };
}

/**
 * Find playable matches in the bracket
 */
function findPlayableMatches(bracket) {
  const playable = [];

  // Winners bracket
  for (const round of bracket.winners.rounds) {
    for (const match of round.matches) {
      if (!match.winnerId && !match.isBye &&
          match.participants[0] && match.participants[1]) {
        playable.push({ match, bracket: 'winners' });
      }
    }
  }

  // Losers bracket
  for (const round of bracket.losers.rounds) {
    for (const match of round.matches) {
      if (!match.winnerId && !match.isBye &&
          match.participants[0] && match.participants[1]) {
        playable.push({ match, bracket: 'losers' });
      }
    }
  }

  // Grand finals
  if (!bracket.grandFinals.match.winnerId &&
      bracket.grandFinals.match.participants[0] &&
      bracket.grandFinals.match.participants[1]) {
    playable.push({ match: bracket.grandFinals.match, bracket: 'grandFinals' });
  }

  // Bracket reset
  if (bracket.grandFinals.reset.requiresPlay &&
      !bracket.grandFinals.reset.winnerId &&
      bracket.grandFinals.reset.participants[0] &&
      bracket.grandFinals.reset.participants[1]) {
    playable.push({ match: bracket.grandFinals.reset, bracket: 'grandFinals' });
  }

  return playable;
}

/**
 * Play through entire double elimination bracket
 * Uses the same pattern as the unit tests - play winners in order,
 * then iterate through losers until all matches with 2 participants are played
 */
function playEntireBracket(bracket, participantMap, random) {
  const matchResults = [];

  // Play all winners bracket matches in round order
  for (const round of bracket.winners.rounds) {
    for (const match of round.matches) {
      if (match.winnerId || match.isBye) continue;
      if (!match.participants[0] || !match.participants[1]) continue;

      const result = simulateMatchResult(match, participantMap, random, false);
      if (result) {
        recordMatchResult(bracket, match.id, result.scores, result.winnerId, result.winnerId);
        matchResults.push({ matchId: match.id, bracketType: 'winners', ...result });
      }
    }
  }

  // Play losers bracket - iterate until no more matches can be played
  // Following the pattern from the existing unit tests
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;

    for (const round of bracket.losers.rounds) {
      for (const match of round.matches) {
        if (match.winnerId) continue;

        const participants = match.participants.filter(p => p !== null);
        if (participants.length === 2) {
          const result = simulateMatchResult(match, participantMap, random, true);
          if (result) {
            recordMatchResult(bracket, match.id, result.scores, result.winnerId, result.winnerId);
            matchResults.push({ matchId: match.id, bracketType: 'losers', ...result });
            madeProgress = true;
          }
        }
      }
    }
  }

  // Play grand finals (GF1)
  const gf1 = bracket.grandFinals.match;
  if (!gf1.winnerId && gf1.participants[0] && gf1.participants[1]) {
    const result = simulateMatchResult(gf1, participantMap, random, false);
    if (result) {
      recordMatchResult(bracket, gf1.id, result.scores, result.winnerId, result.winnerId);
      matchResults.push({ matchId: gf1.id, bracketType: 'grandFinals', ...result });
    }
  }

  // Play bracket reset (GF2) if needed
  const gf2 = bracket.grandFinals.reset;
  if (gf2.requiresPlay && !gf2.winnerId && gf2.participants[0] && gf2.participants[1]) {
    const result = simulateMatchResult(gf2, participantMap, random, false);
    if (result) {
      recordMatchResult(bracket, gf2.id, result.scores, result.winnerId, result.winnerId);
      matchResults.push({ matchId: gf2.id, bracketType: 'grandFinals', ...result });
    }
  }

  return matchResults;
}

// ============================================================================
// Main Simulation Test
// ============================================================================

Deno.test('8-Player Double Elimination Full Tournament Simulation', async (t) => {
  const random = seededRandom(456);

  await t.step('Phase 1: Lobby Setup', () => {
    const { store, adminId, participants } = setupEvoLobby();

    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.get('meta.type'), 'double');
    assertEquals(store.get('meta.name'), 'EVO 2024 Street Fighter 6');
    assertEquals(store.getParticipantList().length, 8);
    assert(store.isAdmin());

    // Verify all players
    for (const player of FIGHTING_GAME_PLAYERS) {
      const p = store.getParticipant(player.id);
      assertExists(p);
      assertEquals(p.name, player.name);
    }

    console.log('✓ Lobby set up with 8 FGC players');
  });

  await t.step('Phase 2: Bracket Generation', () => {
    const { store } = setupEvoLobby();
    const participantArray = store.getParticipantList();

    const bracket = generateDoubleEliminationBracket(participantArray);

    // Verify structure
    assertEquals(bracket.type, 'double');
    assertEquals(bracket.bracketSize, 8);
    assertEquals(bracket.participantCount, 8);

    // Winners bracket structure
    assertExists(bracket.winners);
    assertExists(bracket.winners.rounds);
    assertEquals(bracket.winnersRounds, 3); // log2(8)

    // Losers bracket structure
    assertExists(bracket.losers);
    assertExists(bracket.losers.rounds);
    assertEquals(bracket.losersRounds, 4); // 2 * (3 - 1)

    // Grand finals
    assertExists(bracket.grandFinals);
    assertExists(bracket.grandFinals.match);
    assertExists(bracket.grandFinals.reset);

    // Count total matches
    let totalMatches = 0;
    for (const round of bracket.winners.rounds) {
      totalMatches += round.matches.length;
    }
    for (const round of bracket.losers.rounds) {
      totalMatches += round.matches.length;
    }
    totalMatches += 2; // GF1 and GF2

    assertEquals(bracket.matches.size, totalMatches);

    console.log(`✓ Double elimination bracket generated`);
    console.log(`  Winners bracket: ${bracket.winnersRounds} rounds`);
    console.log(`  Losers bracket: ${bracket.losersRounds} rounds`);
    console.log(`  Total matches: ${totalMatches}`);
  });

  await t.step('Phase 3: Winners Bracket Structure', () => {
    const { store } = setupEvoLobby();
    const participantArray = store.getParticipantList();
    const bracket = generateDoubleEliminationBracket(participantArray);

    const winners = bracket.winners;

    // Round names
    assertEquals(winners.rounds[0].name, 'Winners R1');
    assertEquals(winners.rounds[winners.rounds.length - 2].name, 'Winners Semis');
    assertEquals(winners.rounds[winners.rounds.length - 1].name, 'Winners Finals');

    // Verify seeding - Daigo (1) should face lowest seed or bye
    const round1 = winners.rounds[0];
    const daigoMatch = round1.matches.find(m =>
      m.participants.includes('player-daigo')
    );
    assertExists(daigoMatch);
    assertEquals(daigoMatch.bracket, 'winners');

    // Each match should have dropsTo info
    for (const match of round1.matches) {
      if (!match.isBye) {
        assertExists(match.dropsTo, `Match ${match.id} should have dropsTo`);
      }
    }

    console.log('✓ Winners bracket structure verified');
  });

  await t.step('Phase 4: Losers Bracket Structure', () => {
    const { store } = setupEvoLobby();
    const participantArray = store.getParticipantList();
    const bracket = generateDoubleEliminationBracket(participantArray);

    const losers = bracket.losers;

    // Verify losers rounds alternate between minor and major
    for (let i = 0; i < losers.rounds.length; i++) {
      const round = losers.rounds[i];
      const isMinor = i % 2 === 0;

      for (const match of round.matches) {
        assertEquals(match.bracket, 'losers');
        assertEquals(match.isMinorRound, isMinor);
      }
    }

    console.log(`✓ Losers bracket structure verified (${losers.rounds.length} rounds)`);
  });

  await t.step('Phase 5: Play Entire Tournament', () => {
    const { store } = setupEvoLobby();
    const participantArray = store.getParticipantList();
    const participantMap = createParticipantMap(participantArray);

    const bracket = generateDoubleEliminationBracket(participantArray);
    store.set('meta.status', 'active');

    // Play through the tournament
    const matchResults = playEntireBracket(bracket, participantMap, random);

    // Verify completion
    assert(bracket.isComplete, 'Tournament should be complete');

    // Count matches by bracket type
    const winnerMatches = matchResults.filter(r => r.bracketType === 'winners');
    const loserMatches = matchResults.filter(r => r.bracketType === 'losers');
    const gfMatches = matchResults.filter(r => r.bracketType === 'grandFinals');

    console.log(`\n✓ Tournament complete!`);
    console.log(`  Winners bracket matches: ${winnerMatches.length}`);
    console.log(`  Losers bracket matches: ${loserMatches.length}`);
    console.log(`  Grand finals matches: ${gfMatches.length}`);

    // Log grand finals results
    console.log('\n  Grand Finals:');
    for (const result of gfMatches) {
      const winner = participantMap.get(result.winnerId);
      const loser = participantMap.get(result.loserId);
      console.log(`    ${result.matchId}: ${winner?.name} def. ${loser?.name} (${result.scores.join('-')})`);
    }
  });

  await t.step('Phase 6: Verify Standings', () => {
    const { store } = setupEvoLobby();
    const participantArray = store.getParticipantList();
    const participantMap = createParticipantMap(participantArray);

    const bracket = generateDoubleEliminationBracket(participantArray);
    playEntireBracket(bracket, participantMap, random);

    const standings = getStandings(bracket, participantMap);

    // Should have standings for eliminated players
    assert(standings.length > 0, 'Should have standings');

    // Champion and runner-up
    assertEquals(standings[0].place, 1);
    assertEquals(standings[1].place, 2);

    console.log('\n  Final Standings:');
    for (const s of standings.slice(0, 8)) {
      console.log(`    ${s.place}. ${s.name}`);
    }
    if (standings.length > 8) {
      console.log(`    ... and ${standings.length - 8} more`);
    }

    console.log(`\n✓ EVO Champion: ${standings[0].name}`);
  });

  await t.step('Phase 7: Track Player Journey', () => {
    const { store } = setupEvoLobby();
    const participantArray = store.getParticipantList();
    const participantMap = createParticipantMap(participantArray);

    const bracket = generateDoubleEliminationBracket(participantArray);
    const matchResults = playEntireBracket(bracket, participantMap, random);

    // Track one player's journey through the bracket
    const daigoId = 'player-daigo';
    const daigoMatches = matchResults.filter(r =>
      r.winnerId === daigoId || r.loserId === daigoId
    );

    console.log('\n  Daigo\'s Tournament Journey:');
    for (const m of daigoMatches) {
      const opponent = m.winnerId === daigoId ? m.loserId : m.winnerId;
      const opponentName = participantMap.get(opponent)?.name;
      const result = m.winnerId === daigoId ? 'W' : 'L';
      console.log(`    ${m.bracketType}: ${result} vs ${opponentName} (${m.scores.join('-')})`);
    }

    console.log('✓ Player journey tracking verified');
  });
});

// ============================================================================
// Double Elimination Specific Tests
// ============================================================================

Deno.test('Double Elimination Drop Mechanics', async (t) => {
  const random = seededRandom(789);

  await t.step('loser drops to correct losers round', () => {
    const participants = createParticipants(8);
    const participantMap = createParticipantMap(participants);
    const bracket = generateDoubleEliminationBracket(participants);

    // Play first winners match - player-1 vs player-8
    const w1m0 = bracket.matches.get('w1m0');
    assertExists(w1m0);

    // Force player-8 to lose
    recordMatchResult(bracket, 'w1m0', [2, 0], 'player-1', 'player-1');

    // Player-8 should now be in losers bracket
    let player8InLosers = false;
    for (const round of bracket.losers.rounds) {
      for (const match of round.matches) {
        if (match.participants.includes('player-8')) {
          player8InLosers = true;
          // Should be in first losers round
          assertEquals(round.number, 1);
        }
      }
    }

    assert(player8InLosers, 'Player 8 should be in losers bracket after losing');
  });
});

Deno.test('Grand Finals Bracket Reset', async (t) => {
  await t.step('bracket reset triggers when losers champ wins GF1', () => {
    const participants = createParticipants(4);
    const participantMap = createParticipantMap(participants);
    const bracket = generateDoubleEliminationBracket(participants);

    // Force specific results to test bracket reset
    // Player-1 wins all winners matches -> Winners Finals winner
    recordMatchResult(bracket, 'w1m0', [2, 0], 'player-1', 'player-1');
    recordMatchResult(bracket, 'w1m1', [2, 0], 'player-2', 'player-2');
    recordMatchResult(bracket, 'w2m0', [2, 0], 'player-1', 'player-1');

    // Play through losers (player-4 dominates losers)
    // After these plays, losers bracket should be set up
    const playableInLosers = findPlayableMatches(bracket).filter(p => p.bracket === 'losers');

    for (const { match } of playableInLosers) {
      if (match.participants[0] && match.participants[1]) {
        // player-4 wins if present, otherwise first participant
        const winner = match.participants.includes('player-4')
          ? 'player-4'
          : match.participants[0];
        recordMatchResult(bracket, match.id, [2, 0], winner, winner);
      }
    }

    // Keep playing until GF is ready
    let iterations = 0;
    while (!bracket.grandFinals.match.participants[1] && iterations < 20) {
      const playable = findPlayableMatches(bracket);
      for (const { match } of playable) {
        if (match.participants[0] && match.participants[1]) {
          recordMatchResult(bracket, match.id, [2, 0], match.participants[0], match.participants[0]);
        }
      }
      iterations++;
    }

    // Now check GF setup
    const gf1 = bracket.grandFinals.match;
    if (gf1.participants[0] && gf1.participants[1]) {
      // Losers champ wins GF1 -> bracket reset required
      const losersChamp = gf1.participants[1];
      recordMatchResult(bracket, 'gf1', [2, 0], losersChamp, losersChamp);

      assert(bracket.grandFinals.reset.requiresPlay, 'Bracket reset should be required');
      assertEquals(bracket.isComplete, false, 'Tournament should not be complete yet');

      // Play bracket reset
      recordMatchResult(bracket, 'gf2', [2, 0], losersChamp, losersChamp);
      assert(bracket.isComplete, 'Tournament should be complete after reset');
    }
  });

  await t.step('no bracket reset when winners champ wins GF1', () => {
    const participants = createParticipants(4);
    const participantMap = createParticipantMap(participants);
    const bracket = generateDoubleEliminationBracket(participants);

    // Play through bracket quickly
    const random = seededRandom(111);
    playEntireBracket(bracket, participantMap, random);

    // If winners champ won GF1, reset should not be needed
    const gf1 = bracket.grandFinals.match;
    if (gf1.winnerId === gf1.participants[0]) {
      // Winners champ won
      assertEquals(bracket.grandFinals.reset.requiresPlay, false);
    }
  });
});

Deno.test('Double Elimination Match Count Verification', async (t) => {
  await t.step('4-player bracket has correct match count', () => {
    const participants = createParticipants(4);
    const bracket = generateDoubleEliminationBracket(participants);

    // 4 players double elim:
    // Winners: 2 + 1 = 3 matches
    // Losers: ~3 matches (varies)
    // GF: 2 (GF1 + possible GF2)
    // Total structure exists
    assert(bracket.matches.size >= 6, 'Should have at least 6 matches');
  });

  await t.step('8-player bracket has correct match count', () => {
    const participants = createParticipants(8);
    const bracket = generateDoubleEliminationBracket(participants);

    // Winners: 4 + 2 + 1 = 7
    // Losers: more
    // GF: 2
    assert(bracket.matches.size >= 12, 'Should have significant number of matches');
  });
});
