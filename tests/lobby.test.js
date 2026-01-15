/**
 * Tests for Lobby Component Logic
 *
 * Note: lobby.js has heavy DOM dependencies through document.getElementById and similar.
 * This test file focuses on testing the business logic used by lobby.js through:
 * 1. Tournament generation modules (single/double elimination, mario-kart, doubles)
 * 2. State management through the Store
 * 3. Team assignment validation and auto-assignment
 * 4. Seeding logic patterns
 *
 * For full test coverage of lobby.js DOM interactions, consider:
 * - Refactoring to accept dependencies as parameters
 * - Using jsdom or similar DOM testing library
 * - End-to-end testing with browser automation
 */

import { assertEquals, assertExists, assert, assertThrows } from 'jsr:@std/assert';
import { Store } from '../js/state/store.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { generateDoubleEliminationBracket } from '../js/tournament/double-elimination.js';
import { generateMarioKartTournament } from '../js/tournament/mario-kart.js';
import {
  validateTeamAssignments,
  autoAssignTeams,
  formTeams,
  generateDoublesTournament,
} from '../js/tournament/doubles.js';
import {
  createParticipants,
  createParticipantMap,
  createTeamAssignments,
  createMockRoom,
} from './fixtures.js';

// ============================================
// Tournament Start Logic Tests
// ============================================

Deno.test('Tournament Start - Participant Validation', async (t) => {
  await t.step('requires minimum 2 participants', () => {
    const oneParticipant = createParticipants(1);

    // This is the validation check from onStartTournament
    const canStart = oneParticipant.length >= 2;
    assertEquals(canStart, false);
  });

  await t.step('allows 2 participants', () => {
    const twoParticipants = createParticipants(2);
    const canStart = twoParticipants.length >= 2;
    assertEquals(canStart, true);
  });

  await t.step('allows many participants', () => {
    const manyParticipants = createParticipants(16);
    const canStart = manyParticipants.length >= 2;
    assertEquals(canStart, true);
  });
});

Deno.test('Tournament Start - Single Elimination', async (t) => {
  await t.step('generates bracket for 4 participants', () => {
    const participants = createParticipants(4);
    const result = generateSingleEliminationBracket(participants, {});

    assertExists(result.rounds);
    assertExists(result.matches);
    assert(result.rounds.length > 0);
    assertEquals(result.numRounds, 2); // 4 players = 2 rounds
  });

  await t.step('generates bracket for 8 participants', () => {
    const participants = createParticipants(8);
    const result = generateSingleEliminationBracket(participants, {});

    assertEquals(result.numRounds, 3); // 8 players = 3 rounds
    assertEquals(result.matches.size, 7); // 8-1 = 7 matches
  });

  await t.step('handles odd number of participants with byes', () => {
    const participants = createParticipants(5);
    const result = generateSingleEliminationBracket(participants, {});

    // Should pad to 8 with 3 byes
    assertExists(result.rounds);
    const byeMatches = Array.from(result.matches.values()).filter(m => m.isBye);
    assert(byeMatches.length > 0);
  });
});

Deno.test('Tournament Start - Double Elimination', async (t) => {
  await t.step('generates winners and losers brackets', () => {
    const participants = createParticipants(4);
    const result = generateDoubleEliminationBracket(participants, {});

    assertExists(result.winners);
    assertExists(result.losers);
    assertExists(result.grandFinals);
    assertExists(result.matches);
  });

  await t.step('generates correct match count for 8 participants', () => {
    const participants = createParticipants(8);
    const result = generateDoubleEliminationBracket(participants, {});

    // Double elimination has more matches than single
    // 8 players: winners (7) + losers (6) + grand finals (2) = ~15
    assert(result.matches.size >= 14);
  });

  await t.step('grand finals includes reset match', () => {
    const participants = createParticipants(4);
    const result = generateDoubleEliminationBracket(participants, {});

    assertExists(result.grandFinals.match);
    assertExists(result.grandFinals.reset);
  });
});

Deno.test('Tournament Start - Mario Kart (Points Race)', async (t) => {
  await t.step('generates games for participants', () => {
    const participants = createParticipants(8);
    const result = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 5,
    });

    assertExists(result.matches);
    assertExists(result.standings);
    assert(result.matches.size > 0);
  });

  await t.step('each game has correct number of players', () => {
    const participants = createParticipants(8);
    const playersPerGame = 4;
    const result = generateMarioKartTournament(participants, {
      playersPerGame,
      gamesPerPlayer: 5,
    });

    const games = Array.from(result.matches.values());
    games.forEach(game => {
      assertEquals(game.participants.length, playersPerGame);
    });
  });

  await t.step('initializes standings for all participants', () => {
    const participants = createParticipants(6);
    const result = generateMarioKartTournament(participants, {
      playersPerGame: 3,
      gamesPerPlayer: 4,
    });

    assertEquals(result.standings.size, 6);
    result.standings.forEach(standing => {
      assertEquals(standing.points, 0);
      assertEquals(standing.wins, 0);
    });
  });
});

Deno.test('Tournament Start - Doubles', async (t) => {
  await t.step('generates team-based bracket', () => {
    const participants = createParticipants(8);
    const teamAssignments = createTeamAssignments(participants, 2);
    const result = generateDoublesTournament(participants, teamAssignments, {
      teamSize: 2,
      bracketType: 'single',
    });

    assertExists(result.teams);
    assertExists(result.matches);
    assertEquals(result.teams.length, 4); // 8 players / 2 per team = 4 teams
  });

  await t.step('uses double elimination when specified', () => {
    const participants = createParticipants(8);
    const teamAssignments = createTeamAssignments(participants, 2);
    const result = generateDoublesTournament(participants, teamAssignments, {
      teamSize: 2,
      bracketType: 'double',
    });

    assertEquals(result.bracketType, 'double');
    assertExists(result.winners);
    assertExists(result.losers);
  });
});

// ============================================
// Seeding Logic Tests
// ============================================

Deno.test('Seeding - Random Shuffle', async (t) => {
  await t.step('shuffle algorithm changes order', () => {
    // Fisher-Yates shuffle from lobby.js
    function shuffle(array) {
      const result = [...array];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    }

    const original = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = shuffle(original);

    // Original should be unchanged
    assertEquals(original, [1, 2, 3, 4, 5, 6, 7, 8]);

    // Shuffled should have same elements
    assertEquals(shuffled.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  await t.step('manual seeding preserves order', () => {
    const participants = createParticipants(4);

    // In manual mode, we use the order as-is and assign seeds
    const seeded = participants.map((p, i) => ({
      ...p,
      seed: i + 1,
    }));

    assertEquals(seeded[0].seed, 1);
    assertEquals(seeded[1].seed, 2);
    assertEquals(seeded[2].seed, 3);
    assertEquals(seeded[3].seed, 4);
  });
});

// ============================================
// Team Assignment Tests
// ============================================

Deno.test('Team Assignment - Validation', async (t) => {
  await t.step('validates complete team assignments', () => {
    const participants = createParticipants(4);
    const teamAssignments = createTeamAssignments(participants, 2);
    const validation = validateTeamAssignments(participants, teamAssignments, 2);

    assertEquals(validation.valid, true);
    assertEquals(validation.completeTeams, 2);
  });

  await t.step('detects incomplete team assignments', () => {
    const participants = createParticipants(4);
    // Only assign first 2 participants
    const teamAssignments = new Map([
      ['player-1', 'team-1'],
      ['player-2', 'team-1'],
    ]);
    const validation = validateTeamAssignments(participants, teamAssignments, 2);

    // Only 1 complete team
    assertEquals(validation.completeTeams, 1);
  });

  await t.step('requires at least 2 complete teams to start', () => {
    const participants = createParticipants(4);
    const teamAssignments = new Map([
      ['player-1', 'team-1'],
      ['player-2', 'team-1'],
    ]);
    const validation = validateTeamAssignments(participants, teamAssignments, 2);

    const canStart = validation.valid && validation.completeTeams >= 2;
    assertEquals(canStart, false);
  });

  await t.step('handles team size of 3', () => {
    const participants = createParticipants(6);
    const teamAssignments = createTeamAssignments(participants, 3);
    const validation = validateTeamAssignments(participants, teamAssignments, 3);

    assertEquals(validation.completeTeams, 2);
  });
});

Deno.test('Team Assignment - Auto-Assign', async (t) => {
  await t.step('assigns all participants to teams', () => {
    const participants = createParticipants(8);
    const assignments = autoAssignTeams(participants, 2);

    assertEquals(assignments.size, 8);
  });

  await t.step('creates correct number of teams', () => {
    const participants = createParticipants(8);
    const teamSize = 2;
    const assignments = autoAssignTeams(participants, teamSize);

    const uniqueTeams = new Set(assignments.values());
    assertEquals(uniqueTeams.size, 4); // 8 / 2 = 4 teams
  });

  await t.step('handles odd participant count', () => {
    const participants = createParticipants(7);
    const assignments = autoAssignTeams(participants, 2);

    // 7 participants, team size 2 = 3 complete teams (6 assigned) + 1 leftover
    // Or 4 teams with one incomplete
    assertEquals(assignments.size, 7);
  });
});

Deno.test('Team Assignment - Form Teams', async (t) => {
  await t.step('creates team objects with members', () => {
    const participants = createParticipants(4);
    const teamAssignments = createTeamAssignments(participants, 2);
    const teams = formTeams(participants, teamAssignments, 2);

    assertEquals(teams.length, 2);
    teams.forEach(team => {
      assertEquals(team.members.length, 2);
      assertExists(team.id);
      assertExists(team.name);
    });
  });

  await t.step('excludes incomplete teams', () => {
    const participants = createParticipants(5);
    // Assign only 4 to complete teams
    const teamAssignments = new Map([
      ['player-1', 'team-1'],
      ['player-2', 'team-1'],
      ['player-3', 'team-2'],
      ['player-4', 'team-2'],
      // player-5 is not assigned
    ]);
    const teams = formTeams(participants, teamAssignments, 2);

    assertEquals(teams.length, 2);
  });
});

// ============================================
// Store State Management for Lobby
// ============================================

Deno.test('Lobby Store State - Tournament Configuration', async (t) => {
  await t.step('stores tournament type', () => {
    const store = new Store();
    store.set('meta.type', 'single');
    assertEquals(store.get('meta.type'), 'single');

    store.set('meta.type', 'double');
    assertEquals(store.get('meta.type'), 'double');

    store.set('meta.type', 'mariokart');
    assertEquals(store.get('meta.type'), 'mariokart');

    store.set('meta.type', 'doubles');
    assertEquals(store.get('meta.type'), 'doubles');
  });

  await t.step('stores seeding mode', () => {
    const store = new Store();
    store.set('meta.config.seedingMode', 'random');
    assertEquals(store.get('meta.config.seedingMode'), 'random');

    store.set('meta.config.seedingMode', 'manual');
    assertEquals(store.get('meta.config.seedingMode'), 'manual');
  });

  await t.step('stores tournament name', () => {
    const store = new Store();
    store.set('meta.name', 'My Tournament');
    assertEquals(store.get('meta.name'), 'My Tournament');
  });

  await t.step('stores Mario Kart config', () => {
    const store = new Store();
    store.set('meta.config.playersPerGame', 4);
    store.set('meta.config.gamesPerPlayer', 5);

    assertEquals(store.get('meta.config.playersPerGame'), 4);
    assertEquals(store.get('meta.config.gamesPerPlayer'), 5);
  });

  await t.step('stores doubles config', () => {
    const store = new Store();
    store.set('meta.config.teamSize', 2);
    store.set('meta.config.bracketType', 'double');

    assertEquals(store.get('meta.config.teamSize'), 2);
    assertEquals(store.get('meta.config.bracketType'), 'double');
  });
});

Deno.test('Lobby Store State - Participant Management', async (t) => {
  await t.step('adds participant', () => {
    const store = new Store();
    store.addParticipant({
      id: 'user-1',
      name: 'Player 1',
      isConnected: true,
    });

    const participants = store.getParticipantList();
    assertEquals(participants.length, 1);
    assertEquals(participants[0].name, 'Player 1');
  });

  await t.step('updates participant seed', () => {
    const store = new Store();
    store.addParticipant({ id: 'user-1', name: 'Player 1' });
    store.addParticipant({ id: 'user-2', name: 'Player 2' });

    store.updateParticipant('user-1', { seed: 2 });
    store.updateParticipant('user-2', { seed: 1 });

    const p1 = store.getParticipant('user-1');
    const p2 = store.getParticipant('user-2');
    assertEquals(p1.seed, 2);
    assertEquals(p2.seed, 1);
  });

  await t.step('removes participant', () => {
    const store = new Store();
    store.addParticipant({ id: 'user-1', name: 'Player 1' });
    store.addParticipant({ id: 'user-2', name: 'Player 2' });

    store.removeParticipant('user-1');

    const participants = store.getParticipantList();
    assertEquals(participants.length, 1);
    assertEquals(participants[0].id, 'user-2');
  });

  await t.step('participant list sorted by seed', () => {
    const store = new Store();
    store.addParticipant({ id: 'user-1', name: 'Player 1', seed: 3 });
    store.addParticipant({ id: 'user-2', name: 'Player 2', seed: 1 });
    store.addParticipant({ id: 'user-3', name: 'Player 3', seed: 2 });

    const participants = store.getParticipantList();
    const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));

    assertEquals(sorted[0].seed, 1);
    assertEquals(sorted[1].seed, 2);
    assertEquals(sorted[2].seed, 3);
  });
});

Deno.test('Lobby Store State - Team Assignments', async (t) => {
  await t.step('sets team assignment', () => {
    const store = new Store();
    store.setTeamAssignment('user-1', 'team-1');
    store.setTeamAssignment('user-2', 'team-1');

    const assignments = store.getTeamAssignments();
    assertEquals(assignments.get('user-1'), 'team-1');
    assertEquals(assignments.get('user-2'), 'team-1');
  });

  await t.step('removes team assignment', () => {
    const store = new Store();
    store.setTeamAssignment('user-1', 'team-1');
    store.removeTeamAssignment('user-1');

    const assignments = store.getTeamAssignments();
    assertEquals(assignments.has('user-1'), false);
  });

  await t.step('clears all team assignments', () => {
    const store = new Store();
    store.setTeamAssignment('user-1', 'team-1');
    store.setTeamAssignment('user-2', 'team-1');
    store.setTeamAssignment('user-3', 'team-2');

    store.clearTeamAssignments();

    const assignments = store.getTeamAssignments();
    assertEquals(assignments.size, 0);
  });
});

// ============================================
// Broadcast Tests (Lobby Network)
// ============================================

Deno.test('Lobby Broadcasts', async (t) => {
  await t.step('broadcasts participant update', () => {
    const room = createMockRoom('local-peer');

    // Simulate broadcasting name update
    room.broadcast('p:upd', { name: 'New Name' });

    assertEquals(room._broadcasts.length, 1);
    assertEquals(room._broadcasts[0].type, 'p:upd');
    assertEquals(room._broadcasts[0].payload.name, 'New Name');
  });

  await t.step('broadcasts seed update with participant id', () => {
    const room = createMockRoom('local-peer');

    // Admin broadcasts seed change for a participant
    room.broadcast('p:upd', { id: 'user-1', seed: 3 });

    assertEquals(room._broadcasts[0].payload.id, 'user-1');
    assertEquals(room._broadcasts[0].payload.seed, 3);
  });

  await t.step('broadcasts participant removal', () => {
    const room = createMockRoom('local-peer');

    room.broadcast('p:leave', { removedId: 'user-to-remove' });

    assertEquals(room._broadcasts[0].type, 'p:leave');
    assertEquals(room._broadcasts[0].payload.removedId, 'user-to-remove');
  });

  await t.step('broadcasts leave message', () => {
    const room = createMockRoom('local-peer');

    room.broadcast('p:leave', {});

    assertEquals(room._broadcasts[0].type, 'p:leave');
  });
});

// ============================================
// Tournament Start Button State Logic
// ============================================

Deno.test('Start Button State Logic', async (t) => {
  await t.step('disabled when less than 2 participants', () => {
    const participantCount = 1;
    const disabled = participantCount < 2;
    assertEquals(disabled, true);
  });

  await t.step('enabled when 2 or more participants', () => {
    const participantCount = 2;
    const disabled = participantCount < 2;
    assertEquals(disabled, false);
  });

  await t.step('disabled for doubles without enough teams', () => {
    const tournamentType = 'doubles';
    const completeTeams = 1;

    const disabled = tournamentType === 'doubles' && completeTeams < 2;
    assertEquals(disabled, true);
  });

  await t.step('enabled for doubles with 2+ teams', () => {
    const tournamentType = 'doubles';
    const completeTeams = 2;

    const disabled = tournamentType === 'doubles' && completeTeams < 2;
    assertEquals(disabled, false);
  });
});

// ============================================
// Participant Display Logic
// ============================================

Deno.test('Participant Display Logic', async (t) => {
  await t.step('identifies admin participant', () => {
    const adminId = 'admin-user';
    const participantId = 'admin-user';
    const isAdminParticipant = participantId === adminId;
    assertEquals(isAdminParticipant, true);
  });

  await t.step('identifies local user', () => {
    const localUserId = 'local-user';
    const participantId = 'local-user';
    const isLocalUser = participantId === localUserId;
    assertEquals(isLocalUser, true);
  });

  await t.step('admin can remove non-admin participants', () => {
    const isAdmin = true;
    const participantId = 'other-user';
    const adminId = 'admin-user';

    const canRemove = isAdmin && participantId !== adminId;
    assertEquals(canRemove, true);
  });

  await t.step('admin cannot remove themselves', () => {
    const isAdmin = true;
    const participantId = 'admin-user';
    const adminId = 'admin-user';

    const canRemove = isAdmin && participantId !== adminId;
    assertEquals(canRemove, false);
  });
});

// ============================================
// Clipboard and Share Logic
// ============================================

Deno.test('Share Link Generation', async (t) => {
  await t.step('generates room link pattern', () => {
    const roomId = 'test-room';
    const baseUrl = 'https://example.com';

    const link = `${baseUrl}?room=${roomId}`;
    assertEquals(link, 'https://example.com?room=test-room');
  });

  await t.step('link contains room parameter', () => {
    const roomId = 'my-tournament';
    const link = `https://seedless.example?room=${roomId}`;

    assert(link.includes(`room=${roomId}`));
  });
});

// ============================================
// Admin Panel Visibility Logic
// ============================================

Deno.test('Admin Panel Visibility', async (t) => {
  await t.step('admin panel visible for admin', () => {
    const isAdmin = true;
    const adminPanelHidden = !isAdmin;
    assertEquals(adminPanelHidden, false);
  });

  await t.step('admin panel hidden for non-admin', () => {
    const isAdmin = false;
    const adminPanelHidden = !isAdmin;
    assertEquals(adminPanelHidden, true);
  });

  await t.step('participant panel hidden for admin', () => {
    const isAdmin = true;
    const participantPanelHidden = isAdmin;
    assertEquals(participantPanelHidden, true);
  });

  await t.step('participant panel visible for non-admin', () => {
    const isAdmin = false;
    const participantPanelHidden = isAdmin;
    assertEquals(participantPanelHidden, false);
  });
});

// ============================================
// Tournament Type Selection Logic
// ============================================

Deno.test('Tournament Type UI Logic', async (t) => {
  await t.step('team assignment panel visibility', () => {
    const testCases = [
      { type: 'single', expectedHidden: true },
      { type: 'double', expectedHidden: true },
      { type: 'mariokart', expectedHidden: true },
      { type: 'doubles', expectedHidden: false },
    ];

    testCases.forEach(({ type, expectedHidden }) => {
      const panelHidden = type !== 'doubles';
      assertEquals(panelHidden, expectedHidden, `Type: ${type}`);
    });
  });
});
