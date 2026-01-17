/**
 * Full Doubles Tournament Simulation - 16 Players (8 Teams)
 *
 * This test traces code paths by importing modules and simulating
 * a complete 16-person (8 team) Doubles tournament from start to finish.
 * Theme: Tennis Doubles Championship
 */

import { assertEquals, assert, assertExists } from 'jsr:@std/assert';

// State management
import { Store, createInitialState } from '../../js/state/store.js';

// Tournament logic - Doubles
import {
  formTeams,
  generateDoublesTournament,
  recordMatchResult,
  validateTeamAssignments,
  autoAssignTeams,
  getStandings,
} from '../../js/tournament/doubles.js';

// Also import underlying bracket types for comparison
import {
  generateSingleEliminationBracket,
  recordMatchResult as recordSingleElim,
  getStandings as getSingleElimStandings,
} from '../../js/tournament/single-elimination.js';

import {
  generateDoubleEliminationBracket,
  recordMatchResult as recordDoubleElim,
  getStandings as getDoubleElimStandings,
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
  createTeamAssignments,
  createMockRoom,
  createMockLocalStorage,
} from '../fixtures.js';

// ============================================================================
// Test Data: 16 Tennis Doubles players (8 teams of 2)
// ============================================================================

const DOUBLES_PLAYERS = [
  // Team 1: Bryan Brothers (seeds 1+2)
  { id: 'player-bob-bryan', name: 'Bob Bryan', seed: 1 },
  { id: 'player-mike-bryan', name: 'Mike Bryan', seed: 2 },
  // Team 2: Federer/Nadal (seeds 3+4)
  { id: 'player-federer', name: 'Roger Federer', seed: 3 },
  { id: 'player-nadal', name: 'Rafael Nadal', seed: 4 },
  // Team 3: Djokovic/Murray (seeds 5+6)
  { id: 'player-djokovic', name: 'Novak Djokovic', seed: 5 },
  { id: 'player-murray', name: 'Andy Murray', seed: 6 },
  // Team 4: Tsitsipas/Zverev (seeds 7+8)
  { id: 'player-tsitsipas', name: 'Stefanos Tsitsipas', seed: 7 },
  { id: 'player-zverev', name: 'Alexander Zverev', seed: 8 },
  // Team 5: Medvedev/Rublev (seeds 9+10)
  { id: 'player-medvedev', name: 'Daniil Medvedev', seed: 9 },
  { id: 'player-rublev', name: 'Andrey Rublev', seed: 10 },
  // Team 6: Alcaraz/Sinner (seeds 11+12)
  { id: 'player-alcaraz', name: 'Carlos Alcaraz', seed: 11 },
  { id: 'player-sinner', name: 'Jannik Sinner', seed: 12 },
  // Team 7: Fritz/Tiafoe (seeds 13+14)
  { id: 'player-fritz', name: 'Taylor Fritz', seed: 13 },
  { id: 'player-tiafoe', name: 'Frances Tiafoe', seed: 14 },
  // Team 8: Ruud/Hurkacz (seeds 15+16)
  { id: 'player-ruud', name: 'Casper Ruud', seed: 15 },
  { id: 'player-hurkacz', name: 'Hubert Hurkacz', seed: 16 },
];

// Pre-defined team assignments
const TEAM_ASSIGNMENTS = new Map([
  ['player-bob-bryan', 'team-bryan'],
  ['player-mike-bryan', 'team-bryan'],
  ['player-federer', 'team-fedal'],
  ['player-nadal', 'team-fedal'],
  ['player-djokovic', 'team-djoker'],
  ['player-murray', 'team-djoker'],
  ['player-tsitsipas', 'team-nextgen1'],
  ['player-zverev', 'team-nextgen1'],
  ['player-medvedev', 'team-russia'],
  ['player-rublev', 'team-russia'],
  ['player-alcaraz', 'team-nextgen2'],
  ['player-sinner', 'team-nextgen2'],
  ['player-fritz', 'team-usa'],
  ['player-tiafoe', 'team-usa'],
  ['player-ruud', 'team-euro'],
  ['player-hurkacz', 'team-euro'],
]);

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
 * Create a Store with 16 doubles players and admin setup
 */
function setupDoublesLobby() {
  const store = new Store();
  const adminId = 'admin-atp';

  // Set up tournament metadata
  store.set('meta.id', 'doubles-championship-2024');
  store.set('meta.name', 'ATP Doubles Championship 2024');
  store.set('meta.type', 'doubles');
  store.set('meta.adminId', adminId);
  store.set('meta.status', 'lobby');
  store.set('meta.createdAt', Date.now());
  store.set('meta.config.teamSize', 2);
  store.set('meta.config.bestOf', 3);

  // Set local admin state
  store.set('local.isAdmin', true);
  store.set('local.name', 'Tournament Director');

  // Add all 16 players
  for (const player of DOUBLES_PLAYERS) {
    store.addParticipant({
      ...player,
      joinedAt: Date.now() - (17 - player.seed) * 1000,
      isConnected: true,
      isManual: false,
    });
  }

  // Set team assignments
  for (const [playerId, teamId] of TEAM_ASSIGNMENTS) {
    store.setTeamAssignment(playerId, teamId);
  }

  return { store, adminId, participants: DOUBLES_PLAYERS, teamAssignments: TEAM_ASSIGNMENTS };
}

/**
 * Simulate a team match result
 */
function simulateTeamMatchResult(match, teamMap, random) {
  const [team1Id, team2Id] = match.participants;
  if (!team1Id || !team2Id) return null;

  const team1 = teamMap.get(team1Id);
  const team2 = teamMap.get(team2Id);

  // Use average team seed for probability
  const team1Seed = team1?.seed || 999;
  const team2Seed = team2?.seed || 999;

  const team1Advantage = (team2Seed - team1Seed) / 20;
  const team1WinProb = 0.5 + team1Advantage;

  const winner = random() < team1WinProb ? team1Id : team2Id;
  const loser = winner === team1Id ? team2Id : team1Id;

  const winnerSets = random() < 0.7 ? 2 : 2;
  const loserSets = Math.floor(random() * winnerSets);

  return {
    winnerId: winner,
    loserId: loser,
    scores: winner === team1Id ? [winnerSets, loserSets] : [loserSets, winnerSets],
  };
}

/**
 * Play through a doubles bracket
 */
function playDoublesEntireBracket(tournament, random) {
  const teamMap = new Map(tournament.teams.map(t => [t.id, t]));
  const matchResults = [];

  for (const round of tournament.rounds) {
    for (const match of round.matches) {
      if (match.isBye || match.winnerId) continue;
      if (!match.participants[0] || !match.participants[1]) continue;

      const result = simulateTeamMatchResult(match, teamMap, random);
      if (result) {
        recordMatchResult(tournament, match.id, result.scores, result.winnerId, result.winnerId);
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

Deno.test('16-Player (8 Team) Doubles Full Tournament Simulation', async (t) => {
  const random = seededRandom(999);

  await t.step('Phase 1: Lobby and Team Setup', () => {
    const { store, adminId, participants, teamAssignments } = setupDoublesLobby();

    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.get('meta.type'), 'doubles');
    assertEquals(store.get('meta.config.teamSize'), 2);
    assertEquals(store.getParticipantList().length, 16);
    assert(store.isAdmin());

    // Verify team assignments
    const assignments = store.getTeamAssignments();
    assertEquals(assignments.size, 16);

    // Verify all players are assigned
    for (const player of DOUBLES_PLAYERS) {
      const teamId = assignments.get(player.id);
      assertExists(teamId, `${player.name} should be assigned to a team`);
    }

    console.log('✓ Lobby set up with 16 players in 8 teams');
  });

  await t.step('Phase 2: Team Formation', () => {
    const { store, teamAssignments } = setupDoublesLobby();
    const participantArray = store.getParticipantList();

    // Form teams
    const teams = formTeams(participantArray, teamAssignments, 2);

    assertEquals(teams.length, 8);

    // Verify team structure
    for (const team of teams) {
      assertEquals(team.members.length, 2);
      assertExists(team.name);
      assertExists(team.seed);

      // Team name should be "Player1 & Player2"
      assert(team.name.includes(' & '), `Team name should contain '&': ${team.name}`);
    }

    // Verify team seeding (based on average member seed)
    // Team Bryan (seeds 1+2) should have best seed
    const bryanTeam = teams.find(t => t.id === 'team-bryan');
    assertExists(bryanTeam);
    assertEquals(bryanTeam.seed, 1.5); // (1+2)/2

    // Teams should be sorted by seed
    for (let i = 0; i < teams.length - 1; i++) {
      assert(teams[i].seed <= teams[i + 1].seed, 'Teams should be sorted by seed');
    }

    console.log('✓ 8 teams formed successfully');
    console.log('\n  Teams:');
    for (const team of teams) {
      console.log(`    ${team.name} (seed avg: ${team.seed})`);
    }
  });

  await t.step('Phase 3: Team Validation', () => {
    const { store, teamAssignments } = setupDoublesLobby();
    const participantArray = store.getParticipantList();

    // Validate assignments
    const validation = validateTeamAssignments(participantArray, teamAssignments, 2);

    assertEquals(validation.valid, true);
    assertEquals(validation.errors.length, 0);
    assertEquals(validation.teamCount, 8);
    assertEquals(validation.completeTeams, 8);

    console.log('✓ Team assignments validated');
  });

  await t.step('Phase 4: Tournament Generation (Single Elimination)', () => {
    const { store, teamAssignments } = setupDoublesLobby();
    const participantArray = store.getParticipantList();

    // Generate doubles tournament with single elimination
    const tournament = generateDoublesTournament(
      participantArray,
      teamAssignments,
      { teamSize: 2, bracketType: 'single' }
    );

    assertEquals(tournament.type, 'doubles');
    assertEquals(tournament.bracketType, 'single');
    assertEquals(tournament.teamSize, 2);
    assertEquals(tournament.teams.length, 8);

    // Should have single-elim structure
    assertExists(tournament.rounds);
    assertEquals(tournament.bracketSize, 8);
    assertEquals(tournament.numRounds, 3); // log2(8) = 3

    // Round names for 8 teams (Round 1 is always "Round 1", later rounds get names)
    assertEquals(tournament.rounds[0].name, 'Round 1');
    assertEquals(tournament.rounds[1].name, 'Semi-Finals');
    assertEquals(tournament.rounds[2].name, 'Finals');

    // 7 matches total (8-1)
    assertEquals(tournament.matches.size, 7);

    console.log('✓ Doubles tournament generated (Single Elimination)');
    console.log(`  Bracket size: ${tournament.bracketSize}`);
    console.log(`  Rounds: ${tournament.numRounds}`);
    console.log(`  Total matches: ${tournament.matches.size}`);
  });

  await t.step('Phase 5: Play All Matches', () => {
    const { store, teamAssignments } = setupDoublesLobby();
    const participantArray = store.getParticipantList();

    const tournament = generateDoublesTournament(
      participantArray,
      teamAssignments,
      { teamSize: 2, bracketType: 'single' }
    );

    store.set('meta.status', 'active');

    // Play through the tournament
    const matchResults = playDoublesEntireBracket(tournament, random);

    // Verify completion
    assert(tournament.isComplete, 'Tournament should be complete');

    console.log(`\n✓ Played ${matchResults.length} matches`);

    // Log results by round
    console.log('\n  Tournament Results:');
    for (const round of tournament.rounds) {
      console.log(`    ${round.name}:`);
      for (const match of round.matches) {
        if (match.winnerId) {
          const winnerTeam = tournament.teams.find(t => t.id === match.winnerId);
          const loserTeam = tournament.teams.find(t =>
            t.id === match.participants.find(p => p !== match.winnerId)
          );
          console.log(`      ${winnerTeam?.name || 'Unknown'} def. ${loserTeam?.name || 'Unknown'} (${match.scores.join('-')})`);
        }
      }
    }
  });

  await t.step('Phase 6: Verify Team Standings', async () => {
    const { store, teamAssignments } = setupDoublesLobby();
    const participantArray = store.getParticipantList();

    const tournament = generateDoublesTournament(
      participantArray,
      teamAssignments,
      { teamSize: 2, bracketType: 'single' }
    );

    playDoublesEntireBracket(tournament, random);

    // Get standings (async because it uses dynamic import)
    const standings = await getStandings(tournament, participantArray);

    assertEquals(standings.length, 8);

    // Verify champion
    assertEquals(standings[0].place, 1);
    assertExists(standings[0].team);

    console.log('\n  Final Team Standings:');
    for (const s of standings) {
      console.log(`    ${s.place}. ${s.team?.name || s.name}`);
    }

    console.log(`\n✓ Champions: ${standings[0].team?.name}`);
  });

  await t.step('Phase 7: State Management with Teams', () => {
    const { store, teamAssignments } = setupDoublesLobby();
    const participantArray = store.getParticipantList();

    const tournament = generateDoublesTournament(
      participantArray,
      teamAssignments,
      { teamSize: 2, bracketType: 'single' }
    );

    // Serialize (includes team assignments)
    const serialized = store.serialize();

    assertExists(serialized.teamAssignments);
    assertEquals(serialized.teamAssignments.length, 16);

    // Deserialize into new store
    const newStore = new Store();
    newStore.deserialize(serialized);

    assertEquals(newStore.getParticipantList().length, 16);
    assertEquals(newStore.getTeamAssignments().size, 16);

    // Verify team assignments preserved
    const newAssignments = newStore.getTeamAssignments();
    for (const [playerId, teamId] of teamAssignments) {
      assertEquals(newAssignments.get(playerId), teamId);
    }

    console.log('✓ Team state serialization verified');
  });
});

// ============================================================================
// Additional Doubles Tests
// ============================================================================

Deno.test('Doubles Team Formation Edge Cases', async (t) => {
  await t.step('incomplete teams are excluded', () => {
    const participants = createParticipants(5); // Odd number
    const assignments = new Map([
      ['player-1', 'team-a'],
      ['player-2', 'team-a'],
      ['player-3', 'team-b'],
      ['player-4', 'team-b'],
      ['player-5', 'team-c'], // Incomplete team
    ]);

    const teams = formTeams(participants, assignments, 2);

    // Only 2 complete teams should be formed
    assertEquals(teams.length, 2);
  });

  await t.step('unassigned players are excluded', () => {
    const participants = createParticipants(6);
    const assignments = new Map([
      ['player-1', 'team-a'],
      ['player-2', 'team-a'],
      // player-3 and player-4 not assigned
      ['player-5', 'team-b'],
      ['player-6', 'team-b'],
    ]);

    const teams = formTeams(participants, assignments, 2);
    assertEquals(teams.length, 2);

    // Validate
    const validation = validateTeamAssignments(participants, assignments, 2);
    assertEquals(validation.valid, false);
    assert(validation.errors.some(e => e.includes('not assigned')));
  });

  await t.step('team of 3 (trios mode)', () => {
    const participants = createParticipants(9);
    const assignments = new Map([
      ['player-1', 'team-a'], ['player-2', 'team-a'], ['player-3', 'team-a'],
      ['player-4', 'team-b'], ['player-5', 'team-b'], ['player-6', 'team-b'],
      ['player-7', 'team-c'], ['player-8', 'team-c'], ['player-9', 'team-c'],
    ]);

    const teams = formTeams(participants, assignments, 3);
    assertEquals(teams.length, 3);

    for (const team of teams) {
      assertEquals(team.members.length, 3);
    }
  });
});

Deno.test('Auto Team Assignment', async (t) => {
  await t.step('randomly assigns players to teams', () => {
    const participants = createParticipants(8);
    const assignments = autoAssignTeams(participants, 2);

    assertEquals(assignments.size, 8);

    // Each player should have a team
    for (const p of participants) {
      assertExists(assignments.get(p.id));
    }

    // Should have 4 teams
    const teamIds = new Set(assignments.values());
    assertEquals(teamIds.size, 4);

    // Each team should have 2 players
    const teamCounts = new Map();
    for (const teamId of assignments.values()) {
      teamCounts.set(teamId, (teamCounts.get(teamId) || 0) + 1);
    }
    for (const count of teamCounts.values()) {
      assertEquals(count, 2);
    }
  });

  await t.step('handles odd number of players', () => {
    const participants = createParticipants(7);
    const assignments = autoAssignTeams(participants, 2);

    // 7 players, team size 2 -> 3 complete teams + 1 incomplete
    const teamCounts = new Map();
    for (const teamId of assignments.values()) {
      teamCounts.set(teamId, (teamCounts.get(teamId) || 0) + 1);
    }

    let completeTeams = 0;
    for (const count of teamCounts.values()) {
      if (count === 2) completeTeams++;
    }
    assertEquals(completeTeams, 3);
  });
});

Deno.test('Doubles with Double Elimination', async (t) => {
  await t.step('generates double elim bracket for teams', () => {
    const participants = createParticipants(8);
    const assignments = autoAssignTeams(participants, 2);

    const tournament = generateDoublesTournament(
      participants,
      assignments,
      { teamSize: 2, bracketType: 'double' }
    );

    assertEquals(tournament.type, 'doubles');
    assertEquals(tournament.bracketType, 'double');
    assertEquals(tournament.teams.length, 4);

    // Should have double elim structure
    assertExists(tournament.winners);
    assertExists(tournament.losers);
    assertExists(tournament.grandFinals);
  });
});

Deno.test('Team Name Generation', async (t) => {
  await t.step('team names are formed from member names', () => {
    const participants = [
      { id: 'p1', name: 'Alice', seed: 1 },
      { id: 'p2', name: 'Bob', seed: 2 },
      { id: 'p3', name: 'Charlie', seed: 3 },
      { id: 'p4', name: 'Diana', seed: 4 },
    ];
    const assignments = new Map([
      ['p1', 'team-1'], ['p2', 'team-1'],
      ['p3', 'team-2'], ['p4', 'team-2'],
    ]);

    const teams = formTeams(participants, assignments, 2);

    assertEquals(teams.length, 2);

    // Team names should be "Player1 & Player2"
    const teamNames = teams.map(t => t.name);
    assert(teamNames.some(n => n.includes('Alice') && n.includes('Bob')));
    assert(teamNames.some(n => n.includes('Charlie') && n.includes('Diana')));
  });
});

Deno.test('Team Seed Calculation', async (t) => {
  await t.step('team seed is average of member seeds', () => {
    const participants = [
      { id: 'p1', name: 'Player 1', seed: 1 },
      { id: 'p2', name: 'Player 2', seed: 4 },
      { id: 'p3', name: 'Player 3', seed: 2 },
      { id: 'p4', name: 'Player 4', seed: 3 },
    ];
    const assignments = new Map([
      ['p1', 'team-a'], ['p2', 'team-a'], // avg: (1+4)/2 = 2.5
      ['p3', 'team-b'], ['p4', 'team-b'], // avg: (2+3)/2 = 2.5
    ]);

    const teams = formTeams(participants, assignments, 2);

    assertEquals(teams.length, 2);

    for (const team of teams) {
      assertEquals(team.seed, 2.5);
    }
  });
});

Deno.test('Store Team Assignment Methods', async (t) => {
  await t.step('setTeamAssignment and getTeamAssignments', () => {
    const store = new Store();

    store.setTeamAssignment('player-1', 'team-a');
    store.setTeamAssignment('player-2', 'team-a');
    store.setTeamAssignment('player-3', 'team-b');

    const assignments = store.getTeamAssignments();
    assertEquals(assignments.size, 3);
    assertEquals(assignments.get('player-1'), 'team-a');
    assertEquals(assignments.get('player-3'), 'team-b');
  });

  await t.step('removeTeamAssignment', () => {
    const store = new Store();

    store.setTeamAssignment('player-1', 'team-a');
    store.setTeamAssignment('player-2', 'team-a');
    assertEquals(store.getTeamAssignments().size, 2);

    store.removeTeamAssignment('player-1');
    assertEquals(store.getTeamAssignments().size, 1);
    assertEquals(store.getTeamAssignments().get('player-1'), undefined);
  });

  await t.step('clearTeamAssignments', () => {
    const store = new Store();

    store.setTeamAssignment('player-1', 'team-a');
    store.setTeamAssignment('player-2', 'team-a');
    store.setTeamAssignment('player-3', 'team-b');
    assertEquals(store.getTeamAssignments().size, 3);

    store.clearTeamAssignments();
    assertEquals(store.getTeamAssignments().size, 0);
  });
});
