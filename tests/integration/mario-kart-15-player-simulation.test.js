/**
 * Full Mario Kart Tournament Simulation - 15 Players
 *
 * This test traces code paths by importing as many modules as possible
 * and simulating a complete 15-person Mario Kart (Points Race) tournament
 * from lobby setup through final standings.
 */

import { assertEquals, assert, assertExists } from 'jsr:@std/assert';

// State management
import { Store, createInitialState } from '../../js/state/store.js';

// Tournament logic
import {
  generateMarioKartTournament,
  recordRaceResult,
  getStandings,
} from '../../js/tournament/mario-kart.js';

// Also import other tournament modules to trace their code paths
import {
  generateSingleEliminationBracket,
  recordMatchResult as recordSingleElimResult,
  getStandings as getSingleElimStandings,
} from '../../js/tournament/single-elimination.js';

import {
  generateDoubleEliminationBracket,
  recordMatchResult as recordDoubleElimResult,
  getStandings as getDoubleElimStandings,
} from '../../js/tournament/double-elimination.js';

import {
  formTeams,
  generateDoublesTournament,
  validateTeamAssignments,
  autoAssignTeams,
} from '../../js/tournament/doubles.js';

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
  standardPointsTable,
} from '../fixtures.js';

// ============================================================================
// Test Data: 15 Mario Kart themed participants
// ============================================================================

const MARIO_KART_RACERS = [
  { id: 'racer-mario', name: 'Mario', seed: 1 },
  { id: 'racer-luigi', name: 'Luigi', seed: 2 },
  { id: 'racer-peach', name: 'Princess Peach', seed: 3 },
  { id: 'racer-toad', name: 'Toad', seed: 4 },
  { id: 'racer-yoshi', name: 'Yoshi', seed: 5 },
  { id: 'racer-bowser', name: 'Bowser', seed: 6 },
  { id: 'racer-dk', name: 'Donkey Kong', seed: 7 },
  { id: 'racer-wario', name: 'Wario', seed: 8 },
  { id: 'racer-waluigi', name: 'Waluigi', seed: 9 },
  { id: 'racer-daisy', name: 'Princess Daisy', seed: 10 },
  { id: 'racer-rosalina', name: 'Rosalina', seed: 11 },
  { id: 'racer-koopa', name: 'Koopa Troopa', seed: 12 },
  { id: 'racer-shyguy', name: 'Shy Guy', seed: 13 },
  { id: 'racer-drybone', name: 'Dry Bones', seed: 14 },
  { id: 'racer-birdo', name: 'Birdo', seed: 15 },
];

// Seeded random number generator for reproducible results
function seededRandom(seed) {
  let value = seed;
  return function() {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return value / 0x7fffffff;
  };
}

// Shuffle array using seeded random
function shuffleArray(arr, random) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a Store with 15 Mario Kart participants and admin setup
 */
function setupMarioKartLobby() {
  const store = new Store();
  const adminId = 'admin-lakitu';

  // Set up tournament metadata
  store.set('meta.id', 'mushroom-cup-2024');
  store.set('meta.name', 'Mushroom Cup Championship');
  store.set('meta.type', 'mariokart');
  store.set('meta.adminId', adminId);
  store.set('meta.status', 'lobby');
  store.set('meta.createdAt', Date.now());
  store.set('meta.config.pointsTable', CONFIG.pointsTables.standard);

  // Set local admin state
  store.set('local.isAdmin', true);
  store.set('local.name', 'Lakitu (Admin)');

  // Add all 15 racers
  for (const racer of MARIO_KART_RACERS) {
    store.addParticipant({
      ...racer,
      joinedAt: Date.now() - (16 - racer.seed) * 1000, // Earlier seeds joined first
      isConnected: true,
      isManual: false,
    });
  }

  return { store, adminId, participants: MARIO_KART_RACERS };
}

/**
 * Simulate a race result with weighted randomness favoring higher seeds
 */
function simulateRaceResult(gameParticipants, random, standings) {
  // Weight results by current standing + seed (better players more likely to place well)
  const weighted = gameParticipants.map(pId => {
    const standing = standings?.get(pId);
    const racer = MARIO_KART_RACERS.find(r => r.id === pId);
    const seedBonus = racer ? (16 - racer.seed) * 2 : 0; // Higher seeds get bonus
    const pointsBonus = standing ? standing.points / 10 : 0;
    return {
      participantId: pId,
      weight: seedBonus + pointsBonus + random() * 20, // Add randomness
    };
  });

  // Sort by weight (highest weight = 1st place)
  weighted.sort((a, b) => b.weight - a.weight);

  return weighted.map(w => ({ participantId: w.participantId }));
}

// ============================================================================
// Main Simulation Test
// ============================================================================

Deno.test('15-Player Mario Kart Full Tournament Simulation', async (t) => {
  // Use seeded random for reproducible results
  const random = seededRandom(42);

  await t.step('Phase 1: Lobby Setup', () => {
    const { store, adminId, participants } = setupMarioKartLobby();

    // Verify lobby state
    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.get('meta.type'), 'mariokart');
    assertEquals(store.get('meta.adminId'), adminId);
    assertEquals(store.getParticipantList().length, 15);
    assert(store.isAdmin(), 'Should be admin');

    // Verify all participants
    for (const racer of MARIO_KART_RACERS) {
      const p = store.getParticipant(racer.id);
      assertExists(p, `Participant ${racer.name} should exist`);
      assertEquals(p.name, racer.name);
      assertEquals(p.seed, racer.seed);
      assertEquals(p.isConnected, true);
    }

    console.log('✓ Lobby set up with 15 participants');
  });

  await t.step('Phase 2: Tournament Generation', () => {
    const { store, participants } = setupMarioKartLobby();

    // Generate the tournament
    const participantArray = store.getParticipantList();
    const tournament = generateMarioKartTournament(participantArray, {
      playersPerGame: 4,    // 4 players per race (standard Mario Kart)
      gamesPerPlayer: 6,    // Each player races 6 times
      pointsTable: CONFIG.pointsTables.standard,
    });

    // Verify tournament structure
    assertEquals(tournament.type, 'mariokart');
    assertEquals(tournament.participantCount, 15);
    assertEquals(tournament.playersPerGame, 4);
    assertEquals(tournament.gamesPerPlayer, 6);
    assertEquals(tournament.isComplete, false);
    assertEquals(tournament.gamesComplete, 0);

    // Calculate expected games: 15 players * 6 games = 90 slots, / 4 per game = 23 games (ceil)
    const expectedGames = Math.ceil((15 * 6) / 4);
    assertEquals(tournament.totalGames, expectedGames);
    assertEquals(tournament.matches.size, expectedGames);

    // Verify standings initialized for all participants
    assertEquals(tournament.standings.size, 15);
    for (const racer of MARIO_KART_RACERS) {
      const standing = tournament.standings.get(racer.id);
      assertExists(standing);
      assertEquals(standing.points, 0);
      assertEquals(standing.wins, 0);
      assertEquals(standing.gamesCompleted, 0);
      assertEquals(standing.history.length, 0);
    }

    // Verify each game has valid structure
    for (const [gameId, game] of tournament.matches) {
      assert(gameId.startsWith('game'), `Game ID should start with 'game': ${gameId}`);
      assert(game.participants.length >= 2, 'Each game should have at least 2 players');
      assert(game.participants.length <= 4, 'Each game should have at most 4 players');
      assertEquals(game.complete, false);
      assertEquals(game.results, null);
      assertEquals(game.winnerId, null);
    }

    console.log(`✓ Tournament generated with ${tournament.totalGames} games`);
  });

  await t.step('Phase 3: Play All Games', () => {
    const { store } = setupMarioKartLobby();
    const participantArray = store.getParticipantList();

    const tournament = generateMarioKartTournament(participantArray, {
      playersPerGame: 4,
      gamesPerPlayer: 6,
      pointsTable: CONFIG.pointsTables.standard,
    });

    // Transition to active
    store.set('meta.status', 'active');

    // Track game results for verification
    const gameResults = [];
    let gamesPlayed = 0;

    // Play all games
    for (const [gameId, game] of tournament.matches) {
      if (game.complete) continue;

      // Simulate race result
      const results = simulateRaceResult(
        game.participants,
        random,
        tournament.standings
      );

      // Record the result
      const reporter = results[0].participantId; // Winner reports
      recordRaceResult(tournament, gameId, results, reporter);

      gamesPlayed++;
      gameResults.push({
        gameId,
        gameNumber: game.gameNumber,
        winner: results[0].participantId,
        results: results.map((r, i) => ({
          participantId: r.participantId,
          position: i + 1,
        })),
      });

      // Verify game state after recording
      assertEquals(game.complete, true);
      assertExists(game.results);
      assertExists(game.winnerId);
      assertEquals(game.winnerId, results[0].participantId);
    }

    // Verify all games played
    assertEquals(gamesPlayed, tournament.totalGames);
    assertEquals(tournament.gamesComplete, tournament.totalGames);
    assertEquals(tournament.isComplete, true);

    console.log(`✓ Played all ${gamesPlayed} games`);

    // Log some sample results
    console.log('\n  Sample Race Results:');
    for (let i = 0; i < Math.min(3, gameResults.length); i++) {
      const gr = gameResults[i];
      const winnerName = MARIO_KART_RACERS.find(r => r.id === gr.winner)?.name;
      console.log(`    Game ${gr.gameNumber}: ${winnerName} wins`);
    }
  });

  await t.step('Phase 4: Verify Final Standings', () => {
    const { store } = setupMarioKartLobby();
    const participantArray = store.getParticipantList();

    const tournament = generateMarioKartTournament(participantArray, {
      playersPerGame: 4,
      gamesPerPlayer: 6,
      pointsTable: CONFIG.pointsTables.standard,
    });

    // Play all games
    for (const [gameId, game] of tournament.matches) {
      if (!game.complete) {
        const results = simulateRaceResult(game.participants, random, tournament.standings);
        recordRaceResult(tournament, gameId, results, results[0].participantId);
      }
    }

    // Get final standings
    const standings = getStandings(tournament);

    // Verify standings structure
    assertEquals(standings.length, 15);

    // Verify each standing has required fields
    for (const standing of standings) {
      assertExists(standing.place);
      assertExists(standing.participantId);
      assertExists(standing.name);
      assertExists(standing.points);
      assertExists(standing.wins);
      assertExists(standing.gamesCompleted);
      assertExists(standing.history);

      // Each player should have completed 6 games
      assertEquals(standing.gamesCompleted, 6);
      assertEquals(standing.history.length, 6);
    }

    // Verify standings are sorted by points (descending)
    for (let i = 0; i < standings.length - 1; i++) {
      assert(
        standings[i].points >= standings[i + 1].points,
        `Standings should be sorted by points: place ${i + 1} (${standings[i].points}) >= place ${i + 2} (${standings[i + 1].points})`
      );
    }

    // Verify place numbers are sequential
    for (let i = 0; i < standings.length; i++) {
      assertEquals(standings[i].place, i + 1);
    }

    // Log final standings
    console.log('\n  Final Standings:');
    for (const s of standings) {
      console.log(`    ${s.place}. ${s.name.padEnd(16)} - ${s.points} pts (${s.wins} wins)`);
    }

    // Transition tournament to complete
    store.set('meta.status', 'complete');
    assertEquals(store.get('meta.status'), 'complete');

    console.log('\n✓ Tournament complete!');
  });

  await t.step('Phase 5: State Serialization & Deserialization', () => {
    const { store } = setupMarioKartLobby();
    const participantArray = store.getParticipantList();

    const tournament = generateMarioKartTournament(participantArray, {
      playersPerGame: 4,
      gamesPerPlayer: 6,
      pointsTable: CONFIG.pointsTables.standard,
    });

    // Play half the games
    const games = Array.from(tournament.matches.entries());
    const halfGames = Math.floor(games.length / 2);

    for (let i = 0; i < halfGames; i++) {
      const [gameId, game] = games[i];
      if (!game.complete) {
        const results = simulateRaceResult(game.participants, random, tournament.standings);
        recordRaceResult(tournament, gameId, results, results[0].participantId);
      }
    }

    // Store tournament state
    store.set('meta.status', 'active');

    // Copy matches and standings to store
    for (const [id, match] of tournament.matches) {
      store.getState().matches.set(id, { ...match });
    }
    for (const [id, standing] of tournament.standings) {
      store.getState().standings.set(id, { ...standing });
    }

    // Serialize
    const serialized = store.serialize();

    // Verify serialized structure
    assertExists(serialized.meta);
    assertExists(serialized.participants);
    assertExists(serialized.matches);
    assertExists(serialized.standings);
    assertEquals(serialized.meta.type, 'mariokart');
    assertEquals(serialized.participants.length, 15);

    // Create new store and deserialize
    const store2 = new Store();
    store2.deserialize(serialized);

    // Verify deserialized state
    assertEquals(store2.get('meta.type'), 'mariokart');
    assertEquals(store2.get('meta.status'), 'active');
    assertEquals(store2.getParticipantList().length, 15);
    assertEquals(store2.getState().matches.size, tournament.matches.size);
    assertEquals(store2.getState().standings.size, 15);

    // Verify participant data preserved
    for (const racer of MARIO_KART_RACERS) {
      const p = store2.getParticipant(racer.id);
      assertExists(p);
      assertEquals(p.name, racer.name);
    }

    // Verify match data preserved
    const originalMatch = tournament.matches.get('game1');
    const deserializedMatch = store2.getMatch('game1');
    assertExists(deserializedMatch);
    assertEquals(deserializedMatch.gameNumber, originalMatch.gameNumber);

    console.log('✓ State serialization/deserialization verified');
  });

  await t.step('Phase 6: Event System Verification', () => {
    const store = new Store();
    const events = {
      changes: [],
      participantJoins: [],
      participantUpdates: [],
      sync: [],
    };

    // Set up event listeners
    store.on('change', (data) => events.changes.push(data));
    store.on('participant:join', (p) => events.participantJoins.push(p));
    store.on('participant:update', (data) => events.participantUpdates.push(data));
    store.on('sync', (data) => events.sync.push(data));

    // Add participants (should trigger events)
    for (const racer of MARIO_KART_RACERS.slice(0, 5)) {
      store.addParticipant({ ...racer, isConnected: true });
    }

    assertEquals(events.participantJoins.length, 5);
    assert(events.changes.length >= 5);

    // Update a participant
    store.updateParticipant('racer-mario', { name: 'Super Mario' });
    assertEquals(events.participantUpdates.length, 1);
    assertEquals(events.participantUpdates[0].id, 'racer-mario');

    // Simulate sync event via deserialize
    const serialized = store.serialize();
    const store2 = new Store();
    store2.on('sync', (data) => events.sync.push(data));
    store2.deserialize(serialized);

    assertEquals(events.sync.length, 1);

    console.log('✓ Event system working correctly');
  });
});

// ============================================================================
// Additional Code Path Tests
// ============================================================================

Deno.test('Bracket Utils Code Paths', async (t) => {
  await t.step('getSeedPositions for various bracket sizes', () => {
    // getSeedPositions returns: positions[seed-1] = bracket_position
    // So positions4[0] is where seed 1 goes in the bracket
    const positions4 = getSeedPositions(4);
    assertEquals(positions4.length, 4);
    // Seed 1 (index 0) should be at position 0
    assertEquals(positions4[0], 0);

    const positions8 = getSeedPositions(8);
    assertEquals(positions8.length, 8);
    // Seed 1 at position 0, Seed 2 at position 6 (opposite half)
    assertEquals(positions8[0], 0);
    assertEquals(positions8[1], 6);

    const positions16 = getSeedPositions(16);
    assertEquals(positions16.length, 16);
    // Seed 1 at position 0
    assertEquals(positions16[0], 0);
  });

  await t.step('nextPowerOf2 calculations', () => {
    // nextPowerOf2(1) returns 2 (minimum bracket size)
    assertEquals(nextPowerOf2(1), 2);
    assertEquals(nextPowerOf2(2), 2);
    assertEquals(nextPowerOf2(3), 4);
    assertEquals(nextPowerOf2(5), 8);
    assertEquals(nextPowerOf2(15), 16);
    assertEquals(nextPowerOf2(16), 16);
    assertEquals(nextPowerOf2(17), 32);
  });

  await t.step('getRoundName for tournament rounds', () => {
    // 4-player bracket (2 rounds)
    assertEquals(getRoundName(1, 2), 'Semi-Finals');
    assertEquals(getRoundName(2, 2), 'Finals');

    // 8-player bracket (3 rounds)
    assertEquals(getRoundName(1, 3), 'Quarter-Finals');
    assertEquals(getRoundName(2, 3), 'Semi-Finals');
    assertEquals(getRoundName(3, 3), 'Finals');

    // 16-player bracket (4 rounds)
    assertEquals(getRoundName(1, 4), 'Round 1');
    assertEquals(getRoundName(2, 4), 'Quarter-Finals');
    assertEquals(getRoundName(3, 4), 'Semi-Finals');
    assertEquals(getRoundName(4, 4), 'Finals');
  });
});

Deno.test('Different Scoring Systems', async (t) => {
  const participants = MARIO_KART_RACERS.slice(0, 8);

  await t.step('Standard scoring (F1-style)', () => {
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: CONFIG.pointsTables.standard,
    });

    const game = tournament.matches.get('game1');
    recordRaceResult(tournament, 'game1',
      game.participants.map(p => ({ participantId: p })),
      game.participants[0]
    );

    // Standard scoring: 15, 12, 10, 9
    assertEquals(tournament.standings.get(game.participants[0]).points, 15);
    assertEquals(tournament.standings.get(game.participants[1]).points, 12);
    assertEquals(tournament.standings.get(game.participants[2]).points, 10);
    assertEquals(tournament.standings.get(game.participants[3]).points, 9);
  });

  await t.step('F1 scoring system', () => {
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: CONFIG.pointsTables.f1,
    });

    const game = tournament.matches.get('game1');
    recordRaceResult(tournament, 'game1',
      game.participants.map(p => ({ participantId: p })),
      game.participants[0]
    );

    // F1 scoring: 25, 18, 15, 12
    assertEquals(tournament.standings.get(game.participants[0]).points, 25);
    assertEquals(tournament.standings.get(game.participants[1]).points, 18);
  });

  await t.step('Simple scoring system', () => {
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: CONFIG.pointsTables.simple,
    });

    const game = tournament.matches.get('game1');
    recordRaceResult(tournament, 'game1',
      game.participants.map(p => ({ participantId: p })),
      game.participants[0]
    );

    // Simple scoring: 10, 8, 6, 4
    assertEquals(tournament.standings.get(game.participants[0]).points, 10);
    assertEquals(tournament.standings.get(game.participants[1]).points, 8);
  });

  await t.step('Sequential scoring (dynamic)', () => {
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: 'sequential',
    });

    const game = tournament.matches.get('game1');
    recordRaceResult(tournament, 'game1',
      game.participants.map(p => ({ participantId: p })),
      game.participants[0]
    );

    // Sequential for 4 players: 4, 3, 2, 1
    assertEquals(tournament.standings.get(game.participants[0]).points, 4);
    assertEquals(tournament.standings.get(game.participants[1]).points, 3);
    assertEquals(tournament.standings.get(game.participants[2]).points, 2);
    assertEquals(tournament.standings.get(game.participants[3]).points, 1);
  });
});

Deno.test('Manual Participant Flow', async (t) => {
  await t.step('Admin adds offline participants', () => {
    const store = new Store();
    store.set('meta.adminId', 'admin-id');
    store.setAdmin(true);

    // Add some online participants
    store.addParticipant({ id: 'online-1', name: 'Online Player 1', isConnected: true });
    store.addParticipant({ id: 'online-2', name: 'Online Player 2', isConnected: true });

    // Admin adds manual (offline) participants
    const manual1 = store.addManualParticipant('Offline Player 1');
    const manual2 = store.addManualParticipant('Offline Player 2');

    // Verify manual participant structure
    assert(manual1.id.startsWith('manual_'));
    assertEquals(manual1.name, 'Offline Player 1');
    assertEquals(manual1.isManual, true);
    assertEquals(manual1.isConnected, false);
    assertEquals(manual1.claimedBy, null);

    // Verify total participants
    assertEquals(store.getParticipantList().length, 4);

    // Verify mix of online and offline
    const participants = store.getParticipantList();
    const online = participants.filter(p => p.isConnected);
    const offline = participants.filter(p => !p.isConnected);
    assertEquals(online.length, 2);
    assertEquals(offline.length, 2);
  });
});

Deno.test('Store Merge Conflict Resolution', async (t) => {
  await t.step('LWW merge for participant updates', async () => {
    const store1 = new Store();
    const store2 = new Store();

    // Both stores have same participant
    const participant = { id: 'p1', name: 'Original', seed: 1 };
    store1.addParticipant(participant);
    store2.addParticipant(participant);

    // Store1 updates first
    store1.updateParticipant('p1', { name: 'Updated by Store1' });

    // Wait a bit, then store2 updates (will have later timestamp)
    await new Promise(r => setTimeout(r, 10));
    store2.updateParticipant('p1', { name: 'Updated by Store2' });

    // Merge store2 into store1
    store1.merge(store2.serialize(), null);

    // Store2's update should win (later timestamp)
    assertEquals(store1.getParticipant('p1').name, 'Updated by Store2');
  });

  await t.step('OR-Set merge for new participants', () => {
    const store1 = new Store();
    const store2 = new Store();

    // Store1 has participant A
    store1.addParticipant({ id: 'a', name: 'Alice' });

    // Store2 has participant B
    store2.addParticipant({ id: 'b', name: 'Bob' });

    // Merge - both should exist
    store1.merge(store2.serialize(), null);

    assertEquals(store1.getParticipantList().length, 2);
    assertExists(store1.getParticipant('a'));
    assertExists(store1.getParticipant('b'));
  });
});

Deno.test('Config Module Code Paths', () => {
  // Verify CONFIG structure
  assertExists(CONFIG.appId);
  assertExists(CONFIG.strategy);
  assertExists(CONFIG.defaults);
  assertExists(CONFIG.pointsTables);
  assertExists(CONFIG.storage);
  assertExists(CONFIG.ui);
  assertExists(CONFIG.network);
  assertExists(CONFIG.validation);

  // Verify points tables
  assertEquals(CONFIG.pointsTables.standard.length, 12);
  assertEquals(CONFIG.pointsTables.f1.length, 10);
  assertEquals(CONFIG.pointsTables.simple.length, 6);
  assertEquals(CONFIG.pointsTables.sequential, 'sequential');

  // Verify defaults
  assertEquals(CONFIG.defaults.bestOf, 1);
  assertEquals(CONFIG.defaults.teamSize, 2);
});

Deno.test('Mock Fixtures Code Paths', async (t) => {
  await t.step('createMockRoom functionality', () => {
    const room = createMockRoom('local-peer');

    assertEquals(room.selfId, 'local-peer');

    // Test action handling
    let receivedPayload = null;
    room.onAction('test', (payload) => { receivedPayload = payload; });
    room._simulateAction('test', { data: 'hello' }, 'other-peer');
    assertEquals(receivedPayload.data, 'hello');

    // Test broadcasting
    room.broadcast('message', { text: 'hi' });
    assertEquals(room._broadcasts.length, 1);
    assertEquals(room._broadcasts[0].type, 'message');

    // Test peer management
    room._simulatePeerJoin('peer-1');
    assertEquals(room.getPeerCount(), 1);
    room._simulatePeerLeave('peer-1');
    assertEquals(room.getPeerCount(), 0);
  });

  await t.step('createMockLocalStorage functionality', () => {
    const storage = createMockLocalStorage();

    storage.setItem('key1', 'value1');
    assertEquals(storage.getItem('key1'), 'value1');
    assertEquals(storage.length, 1);

    storage.setItem('key2', 'value2');
    assertEquals(storage.length, 2);

    storage.removeItem('key1');
    assertEquals(storage.getItem('key1'), null);
    assertEquals(storage.length, 1);

    storage.clear();
    assertEquals(storage.length, 0);
  });

  await t.step('createParticipants generates correct data', () => {
    const participants = createParticipants(10);

    assertEquals(participants.length, 10);

    for (let i = 0; i < 10; i++) {
      assertEquals(participants[i].id, `player-${i + 1}`);
      assertEquals(participants[i].name, `Player ${i + 1}`);
      assertEquals(participants[i].seed, i + 1);
      assertEquals(participants[i].isConnected, true);
    }
  });

  await t.step('createParticipantMap creates correct Map', () => {
    const participants = createParticipants(5);
    const map = createParticipantMap(participants);

    assert(map instanceof Map);
    assertEquals(map.size, 5);
    assertEquals(map.get('player-1').name, 'Player 1');
    assertEquals(map.get('player-5').name, 'Player 5');
  });
});

// ============================================================================
// Cross-Tournament Type Comparison
// ============================================================================

Deno.test('Compare Tournament Type Flows', async (t) => {
  const participants8 = createParticipants(8);

  await t.step('Single Elimination vs Mario Kart structure differences', () => {
    // Generate both types
    const singleElim = generateSingleEliminationBracket(participants8);
    const marioKart = generateMarioKartTournament(participants8, {
      playersPerGame: 4,
      gamesPerPlayer: 3,
    });

    // Single elim has bracket rounds, Mario Kart has flat games
    assertExists(singleElim.rounds);
    assertEquals(singleElim.type, 'single');
    assertEquals(marioKart.type, 'mariokart');

    // Single elim has fixed number of matches (n-1 for n players)
    assertEquals(singleElim.matches.size, 7); // 8-1 = 7

    // Mario Kart has more games based on gamesPerPlayer
    // 8 players * 3 games / 4 per game = 6 games
    assertEquals(marioKart.totalGames, 6);

    // Single elim isComplete is undefined until a match is recorded
    // Mario Kart initializes isComplete to false
    assertEquals(singleElim.isComplete, undefined);
    assertEquals(marioKart.isComplete, false);
  });

  await t.step('Double Elimination structure', () => {
    const doubleElim = generateDoubleEliminationBracket(participants8);

    assertEquals(doubleElim.type, 'double');
    assertExists(doubleElim.winners);
    assertExists(doubleElim.losers);
    assertExists(doubleElim.grandFinals);

    // Winners bracket has standard rounds
    assertExists(doubleElim.winners.rounds);

    // Losers bracket receives dropdowns
    assertExists(doubleElim.losers.rounds);

    // Grand finals has main match and potential reset
    assertExists(doubleElim.grandFinals.match);
    assertExists(doubleElim.grandFinals.reset);
  });
});
