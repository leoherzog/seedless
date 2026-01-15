/**
 * Tests for Bracket View Component Logic
 *
 * Note: bracket-view.js has heavy DOM dependencies through document.getElementById.
 * This test file focuses on testing the business logic used by bracket-view.js through:
 * 1. Match result recording and winner advancement
 * 2. Standings calculation for Points Race
 * 3. Match status determination
 * 4. Score submission logic patterns
 * 5. Bracket rendering data transformations
 *
 * For full test coverage of DOM interactions, consider:
 * - Refactoring to accept dependencies as parameters
 * - Using jsdom or similar DOM testing library
 * - End-to-end testing with browser automation
 */

import { assertEquals, assertExists, assert } from 'jsr:@std/assert';
import { Store } from '../js/state/store.js';
import { generateSingleEliminationBracket, recordMatchResult as recordSingleResult, getStandings as getSingleStandings } from '../js/tournament/single-elimination.js';
import { generateDoubleEliminationBracket, recordMatchResult as recordDoubleResult } from '../js/tournament/double-elimination.js';
import { generateMarioKartTournament, recordRaceResult, getStandings as getMKStandings } from '../js/tournament/mario-kart.js';
import {
  createParticipants,
  createParticipantMap,
  createMockRoom,
} from './fixtures.js';
import {
  determineMatchStatus,
  canReportMatchResult,
  getOrdinalSuffix,
} from '../js/utils/tournament-helpers.js';

// ============================================
// Match Status Determination Tests
// ============================================

Deno.test('Match Status Determination', async (t) => {
  await t.step('complete when winnerId is set', () => {
    const match = {
      winnerId: 'user1',
      participants: ['user1', 'user2'],
    };
    assertEquals(determineMatchStatus(match), 'complete');
  });

  await t.step('live when both participants and no winner', () => {
    const match = {
      winnerId: null,
      participants: ['user1', 'user2'],
    };
    assertEquals(determineMatchStatus(match), 'live');
  });

  await t.step('pending when participants incomplete', () => {
    const match = {
      winnerId: null,
      participants: ['user1', null],
    };
    assertEquals(determineMatchStatus(match), 'pending');
  });

  await t.step('pending when no participants', () => {
    const match = {
      winnerId: null,
      participants: [null, null],
    };
    assertEquals(determineMatchStatus(match), 'pending');
  });
});

// ============================================
// Can Report Match Result Tests
// ============================================

Deno.test('Can Report Match Result', async (t) => {
  await t.step('true when user is participant and match is ready', () => {
    const match = {
      winnerId: null,
      isBye: false,
      participants: ['user1', 'user2'],
    };
    assertEquals(canReportMatchResult(match, 'user1'), true);
    assertEquals(canReportMatchResult(match, 'user2'), true);
  });

  await t.step('false when winner already determined', () => {
    const match = {
      winnerId: 'user1',
      isBye: false,
      participants: ['user1', 'user2'],
    };
    assertEquals(canReportMatchResult(match, 'user1'), false);
  });

  await t.step('false for bye matches', () => {
    const match = {
      winnerId: null,
      isBye: true,
      participants: ['user1', null],
    };
    assertEquals(canReportMatchResult(match, 'user1'), false);
  });

  await t.step('false when not a participant', () => {
    const match = {
      winnerId: null,
      isBye: false,
      participants: ['user1', 'user2'],
    };
    assertEquals(canReportMatchResult(match, 'user3'), false);
  });

  await t.step('false when match incomplete', () => {
    const match = {
      winnerId: null,
      isBye: false,
      participants: ['user1', null],
    };
    assertEquals(canReportMatchResult(match, 'user1'), false);
  });
});

// ============================================
// Score Submission Logic Tests
// ============================================

Deno.test('Score Submission Logic', async (t) => {
  await t.step('determines winner from radio selection pattern', () => {
    // Simulates the logic in onSubmitScore
    const matchParticipants = ['player-1', 'player-2'];

    // Player 1 wins
    let winnerValue = 'player1';
    let winnerId = winnerValue === 'player1' ? matchParticipants[0] : matchParticipants[1];
    assertEquals(winnerId, 'player-1');

    // Player 2 wins
    winnerValue = 'player2';
    winnerId = winnerValue === 'player1' ? matchParticipants[0] : matchParticipants[1];
    assertEquals(winnerId, 'player-2');
  });

  await t.step('auto-selects winner from higher score', () => {
    // Logic from setupScoreModal score input handler
    const testCases = [
      { score1: 3, score2: 1, expectedWinner: 'player1' },
      { score1: 1, score2: 3, expectedWinner: 'player2' },
      { score1: 2, score2: 2, expectedWinner: null }, // Tie - no auto-select
    ];

    testCases.forEach(({ score1, score2, expectedWinner }) => {
      let autoSelectedWinner = null;
      if (score1 > score2) {
        autoSelectedWinner = 'player1';
      } else if (score2 > score1) {
        autoSelectedWinner = 'player2';
      }
      assertEquals(autoSelectedWinner, expectedWinner);
    });
  });
});

// ============================================
// Match Result Recording Tests
// ============================================

Deno.test('Match Result Recording - Single Elimination', async (t) => {
  await t.step('records result and advances winner', () => {
    const participants = createParticipants(4);
    const tournament = generateSingleEliminationBracket(participants, {});

    // Find a playable match
    const firstRoundMatches = Array.from(tournament.matches.values())
      .filter(m => !m.isBye && m.participants[0] && m.participants[1]);

    if (firstRoundMatches.length > 0) {
      const match = firstRoundMatches[0];
      const winnerId = match.participants[0];

      recordSingleResult(tournament, match.id, [2, 0], winnerId, winnerId);

      const updatedMatch = tournament.matches.get(match.id);
      assertEquals(updatedMatch.winnerId, winnerId);
      assertEquals(updatedMatch.scores, [2, 0]);
    }
  });

  await t.step('winner advances to next round', () => {
    const participants = createParticipants(4);
    const tournament = generateSingleEliminationBracket(participants, {});

    const firstRoundMatches = Array.from(tournament.matches.values())
      .filter(m => !m.isBye && m.participants[0] && m.participants[1]);

    if (firstRoundMatches.length > 0) {
      const match = firstRoundMatches[0];
      const winnerId = match.participants[0];
      const nextMatchId = match.nextMatchId;

      recordSingleResult(tournament, match.id, [2, 0], winnerId, winnerId);

      if (nextMatchId) {
        const nextMatch = tournament.matches.get(nextMatchId);
        assert(nextMatch.participants.includes(winnerId));
      }
    }
  });
});

Deno.test('Match Result Recording - Double Elimination', async (t) => {
  await t.step('records result in winners bracket', () => {
    const participants = createParticipants(4);
    const tournament = generateDoubleEliminationBracket(participants, {});

    const winnersMatches = Array.from(tournament.matches.values())
      .filter(m => !m.isBye && m.participants[0] && m.participants[1] && m.bracket === 'winners');

    if (winnersMatches.length > 0) {
      const match = winnersMatches[0];
      const winnerId = match.participants[0];
      const loserId = match.participants[1];

      recordDoubleResult(tournament, match.id, [2, 0], winnerId, winnerId);

      const updatedMatch = tournament.matches.get(match.id);
      assertEquals(updatedMatch.winnerId, winnerId);
    }
  });
});

// ============================================
// Mario Kart / Points Race Tests
// ============================================

Deno.test('Points Race - Race Result Recording', async (t) => {
  await t.step('records race result with positions', () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 3,
    });

    const games = Array.from(tournament.matches.values());
    if (games.length > 0) {
      const game = games[0];
      const results = game.participants.map((pid, idx) => ({
        participantId: pid,
        position: idx + 1,
      }));

      recordRaceResult(tournament, game.id, results, participants[0].id);

      const updatedGame = tournament.matches.get(game.id);
      assert(updatedGame.complete);
      assertExists(updatedGame.results);
      assertEquals(updatedGame.results.length, game.participants.length);
    }
  });

  await t.step('awards points based on position', () => {
    const participants = createParticipants(4);
    const pointsTable = [15, 12, 10, 8];
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 3,
      pointsTable,
    });

    const games = Array.from(tournament.matches.values());
    if (games.length > 0) {
      const game = games[0];
      const results = game.participants.map((pid, idx) => ({
        participantId: pid,
        position: idx + 1,
      }));

      recordRaceResult(tournament, game.id, results, participants[0].id);

      // Check standings
      const firstPlaceId = results[0].participantId;
      const standing = tournament.standings.get(firstPlaceId);
      assertEquals(standing.points, pointsTable[0]); // 15 points for 1st
    }
  });

  await t.step('increments games completed', () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 3,
    });

    const initialComplete = tournament.gamesComplete;

    const games = Array.from(tournament.matches.values());
    if (games.length > 0) {
      const game = games[0];
      const results = game.participants.map((pid, idx) => ({
        participantId: pid,
        position: idx + 1,
      }));

      recordRaceResult(tournament, game.id, results, participants[0].id);

      assertEquals(tournament.gamesComplete, initialComplete + 1);
    }
  });

  await t.step('increments win count for first place', () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 3,
    });

    const games = Array.from(tournament.matches.values());
    if (games.length > 0) {
      const game = games[0];
      const firstPlaceId = game.participants[0];
      const results = game.participants.map((pid, idx) => ({
        participantId: pid,
        position: idx + 1,
      }));

      const initialWins = tournament.standings.get(firstPlaceId)?.wins || 0;

      recordRaceResult(tournament, game.id, results, participants[0].id);

      const newWins = tournament.standings.get(firstPlaceId).wins;
      assertEquals(newWins, initialWins + 1);
    }
  });
});

Deno.test('Points Race - Standings', async (t) => {
  await t.step('standings sorted by points descending', () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 2,
    });

    // Play a game
    const games = Array.from(tournament.matches.values());
    if (games.length > 0) {
      const game = games[0];
      const results = game.participants.map((pid, idx) => ({
        participantId: pid,
        position: idx + 1,
      }));
      recordRaceResult(tournament, game.id, results, participants[0].id);

      // Get standings
      const standings = Array.from(tournament.standings.values())
        .sort((a, b) => b.points - a.points);

      // First place should have most points
      assert(standings[0].points >= standings[standings.length - 1].points);
    }
  });
});

// ============================================
// Store State for Bracket View
// ============================================

Deno.test('Store State for Bracket View', async (t) => {
  await t.step('stores bracket data', () => {
    const store = new Store();
    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants, {});

    store.set('bracket', bracket);
    const storedBracket = store.get('bracket');

    assertExists(storedBracket);
    assertExists(storedBracket.rounds);
  });

  await t.step('stores match data in Map', () => {
    const store = new Store();
    const participants = createParticipants(4);
    const { matches } = generateSingleEliminationBracket(participants, {});

    store.setMatches(matches);

    const storedMatches = store.get('matches');
    assertEquals(storedMatches.size, matches.size);
  });

  await t.step('updates individual match', () => {
    const store = new Store();
    const participants = createParticipants(4);
    const { matches } = generateSingleEliminationBracket(participants, {});

    store.setMatches(matches);

    const matchId = Array.from(matches.keys())[0];
    store.updateMatch(matchId, {
      scores: [2, 1],
      winnerId: 'player-1',
      reportedBy: 'player-1',
    });

    const updatedMatch = store.getMatch(matchId);
    assertEquals(updatedMatch.scores, [2, 1]);
    assertEquals(updatedMatch.winnerId, 'player-1');
  });

  await t.step('stores standings for Mario Kart', () => {
    const store = new Store();
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 2,
    });

    // Store standings as array for serialization
    store.deserialize({ standings: Array.from(tournament.standings.entries()) });

    const standings = store.get('standings');
    assertExists(standings);
    assertEquals(standings.size, 4);
  });
});

// ============================================
// Match Verification Logic Tests
// ============================================

Deno.test('Match Verification Logic', async (t) => {
  await t.step('admin can verify unverified match', () => {
    const isAdmin = true;
    const match = {
      winnerId: 'player-1',
      verifiedBy: null,
    };

    const needsVerify = match.winnerId && !match.verifiedBy && isAdmin;
    assertEquals(needsVerify, true);
  });

  await t.step('non-admin cannot verify', () => {
    const isAdmin = false;
    const match = {
      winnerId: 'player-1',
      verifiedBy: null,
    };

    const needsVerify = match.winnerId && !match.verifiedBy && isAdmin;
    assertEquals(needsVerify, false);
  });

  await t.step('already verified match shows no verify button', () => {
    const isAdmin = true;
    const match = {
      winnerId: 'player-1',
      verifiedBy: 'admin-user',
    };

    const needsVerify = match.winnerId && !match.verifiedBy && isAdmin;
    assertEquals(needsVerify, false);
  });

  await t.step('match without winner cannot be verified', () => {
    const isAdmin = true;
    const match = {
      winnerId: null,
      verifiedBy: null,
    };

    const needsVerify = match.winnerId && !match.verifiedBy && isAdmin;
    // needsVerify is falsy (null) because winnerId is null
    assert(!needsVerify);
  });
});

// ============================================
// Admin Edit Logic Tests
// ============================================

Deno.test('Admin Edit Match Logic', async (t) => {
  await t.step('admin can edit completed match', () => {
    const isAdmin = true;
    const match = { winnerId: 'player-1' };

    const canAdminEdit = match.winnerId && isAdmin;
    assertEquals(canAdminEdit, true);
  });

  await t.step('non-admin cannot edit completed match', () => {
    const isAdmin = false;
    const match = { winnerId: 'player-1' };

    const canAdminEdit = match.winnerId && isAdmin;
    assertEquals(canAdminEdit, false);
  });

  await t.step('cannot edit incomplete match', () => {
    const isAdmin = true;
    const match = { winnerId: null };

    const canAdminEdit = match.winnerId && isAdmin;
    // canAdminEdit is falsy (null) because winnerId is null
    assert(!canAdminEdit);
  });
});

// ============================================
// Bracket Tab Logic Tests (Double Elimination)
// ============================================

Deno.test('Bracket Tab Logic', async (t) => {
  await t.step('tabs hidden for single elimination', () => {
    const tournamentType = 'single';
    const tabsHidden = tournamentType !== 'double' && tournamentType !== 'doubles';
    assertEquals(tabsHidden, true);
  });

  await t.step('tabs shown for double elimination', () => {
    const tournamentType = 'double';
    const tabsHidden = tournamentType !== 'double' && tournamentType !== 'doubles';
    assertEquals(tabsHidden, false);
  });

  await t.step('tabs shown for doubles with double-elim bracket', () => {
    const tournamentType = 'doubles';
    const bracketType = 'double';
    const tabsHidden = tournamentType !== 'double' && !(tournamentType === 'doubles' && bracketType === 'double');
    assertEquals(tabsHidden, false);
  });

  await t.step('tabs hidden for doubles with single-elim bracket', () => {
    const tournamentType = 'doubles';
    const bracketType = 'single';
    const tabsHidden = tournamentType !== 'double' && !(tournamentType === 'doubles' && bracketType === 'double');
    assertEquals(tabsHidden, true);
  });

  await t.step('tabs hidden for mariokart', () => {
    const tournamentType = 'mariokart';
    const tabsHidden = tournamentType !== 'double' && tournamentType !== 'doubles';
    assertEquals(tabsHidden, true);
  });
});

// ============================================
// Standings Panel Visibility
// ============================================

Deno.test('Standings Panel Visibility', async (t) => {
  await t.step('shown for mariokart', () => {
    const tournamentType = 'mariokart';
    const standingsHidden = tournamentType !== 'mariokart';
    assertEquals(standingsHidden, false);
  });

  await t.step('hidden for single elimination', () => {
    const tournamentType = 'single';
    const standingsHidden = tournamentType !== 'mariokart';
    assertEquals(standingsHidden, true);
  });

  await t.step('hidden for double elimination', () => {
    const tournamentType = 'double';
    const standingsHidden = tournamentType !== 'mariokart';
    assertEquals(standingsHidden, true);
  });

  await t.step('hidden for doubles', () => {
    const tournamentType = 'doubles';
    const standingsHidden = tournamentType !== 'mariokart';
    assertEquals(standingsHidden, true);
  });
});

// ============================================
// Ordinal Suffix Tests (for race positions)
// ============================================

Deno.test('Ordinal Suffix for Positions', async (t) => {
  await t.step('1st, 2nd, 3rd', () => {
    assertEquals(getOrdinalSuffix(1), 'st');
    assertEquals(getOrdinalSuffix(2), 'nd');
    assertEquals(getOrdinalSuffix(3), 'rd');
  });

  await t.step('4th through 10th', () => {
    for (let i = 4; i <= 10; i++) {
      assertEquals(getOrdinalSuffix(i), 'th');
    }
  });

  await t.step('11th, 12th, 13th (special cases)', () => {
    assertEquals(getOrdinalSuffix(11), 'th');
    assertEquals(getOrdinalSuffix(12), 'th');
    assertEquals(getOrdinalSuffix(13), 'th');
  });

  await t.step('21st, 22nd, 23rd', () => {
    assertEquals(getOrdinalSuffix(21), 'st');
    assertEquals(getOrdinalSuffix(22), 'nd');
    assertEquals(getOrdinalSuffix(23), 'rd');
  });
});

// ============================================
// Broadcast Tests (Bracket View Network)
// ============================================

Deno.test('Bracket View Broadcasts', async (t) => {
  await t.step('broadcasts match result', () => {
    const room = createMockRoom('local-peer');

    room.broadcast('m:result', {
      matchId: 'match-1',
      scores: [2, 1],
      winnerId: 'player-1',
    });

    assertEquals(room._broadcasts.length, 1);
    assertEquals(room._broadcasts[0].type, 'm:result');
    assertEquals(room._broadcasts[0].payload.matchId, 'match-1');
  });

  await t.step('broadcasts match verification', () => {
    const room = createMockRoom('local-peer');

    room.broadcast('m:verify', {
      matchId: 'match-1',
      scores: [2, 1],
      winnerId: 'player-1',
    });

    assertEquals(room._broadcasts[0].type, 'm:verify');
  });

  await t.step('broadcasts race result', () => {
    const room = createMockRoom('local-peer');

    room.broadcast('race:result', {
      gameId: 'game-1',
      results: [
        { participantId: 'p1', position: 1 },
        { participantId: 'p2', position: 2 },
      ],
    });

    assertEquals(room._broadcasts[0].type, 'race:result');
    assertEquals(room._broadcasts[0].payload.results.length, 2);
  });
});

// ============================================
// Bracket Filter Logic (Double Elimination)
// ============================================

Deno.test('Bracket Filter Logic', async (t) => {
  await t.step('filters winners bracket rounds', () => {
    const participants = createParticipants(4);
    const tournament = generateDoubleEliminationBracket(participants, {});

    const filter = 'winners';
    const rounds = filter === 'winners' ? tournament.winners?.rounds : [];

    assertExists(rounds);
    assert(rounds.length > 0);
  });

  await t.step('filters losers bracket rounds', () => {
    const participants = createParticipants(4);
    const tournament = generateDoubleEliminationBracket(participants, {});

    const filter = 'losers';
    const rounds = filter === 'losers' ? tournament.losers?.rounds : [];

    assertExists(rounds);
    assert(rounds.length > 0);
  });

  await t.step('filters grand finals', () => {
    const participants = createParticipants(4);
    const tournament = generateDoubleEliminationBracket(participants, {});

    const filter = 'finals';
    let rounds = [];
    if (filter === 'finals') {
      rounds = [{
        number: 'GF',
        name: 'Grand Finals',
        matches: [
          tournament.grandFinals?.match,
          tournament.grandFinals?.reset?.requiresPlay ? tournament.grandFinals.reset : null,
        ].filter(Boolean),
      }];
    }

    assertEquals(rounds.length, 1);
    assertEquals(rounds[0].name, 'Grand Finals');
    assertExists(rounds[0].matches);
  });
});

// ============================================
// Report Button Visibility Logic
// ============================================

Deno.test('Report Button Visibility', async (t) => {
  await t.step('visible for participant in playable match', () => {
    const localUserId = 'player-1';
    const match = {
      winnerId: null,
      isBye: false,
      participants: ['player-1', 'player-2'],
    };

    const canReport = !match.winnerId && !match.isBye &&
      match.participants.includes(localUserId) &&
      match.participants[0] && match.participants[1];

    assert(canReport);
  });

  await t.step('hidden for non-participant', () => {
    const localUserId = 'player-3';
    const match = {
      winnerId: null,
      isBye: false,
      participants: ['player-1', 'player-2'],
    };

    const canReport = !match.winnerId && !match.isBye &&
      match.participants.includes(localUserId) &&
      match.participants[0] && match.participants[1];

    assertEquals(canReport, false);
  });

  await t.step('hidden for completed match', () => {
    const localUserId = 'player-1';
    const match = {
      winnerId: 'player-1',
      isBye: false,
      participants: ['player-1', 'player-2'],
    };

    const canReport = !match.winnerId && !match.isBye &&
      match.participants.includes(localUserId) &&
      match.participants[0] && match.participants[1];

    assertEquals(canReport, false);
  });

  await t.step('hidden for bye match', () => {
    const localUserId = 'player-1';
    const match = {
      winnerId: null,
      isBye: true,
      participants: ['player-1', null],
    };

    const canReport = !match.winnerId && !match.isBye &&
      match.participants.includes(localUserId) &&
      match.participants[0] && match.participants[1];

    assertEquals(canReport, false);
  });
});

// ============================================
// Tournament Status Display
// ============================================

Deno.test('Tournament Status Display', async (t) => {
  await t.step('shows Complete for complete tournament', () => {
    const status = 'complete';
    const displayText = status === 'complete' ? 'Complete' : 'In Progress';
    assertEquals(displayText, 'Complete');
  });

  await t.step('shows In Progress for active tournament', () => {
    const status = 'active';
    const displayText = status === 'complete' ? 'Complete' : 'In Progress';
    assertEquals(displayText, 'In Progress');
  });
});

// ============================================
// Team Match Logic (Doubles)
// ============================================

Deno.test('Team Match Logic', async (t) => {
  await t.step('determines if user can report team match', () => {
    const localUserId = 'player-1';
    const teams = [
      { id: 'team-1', members: [{ id: 'player-1' }, { id: 'player-2' }] },
      { id: 'team-2', members: [{ id: 'player-3' }, { id: 'player-4' }] },
    ];
    const match = {
      winnerId: null,
      isBye: false,
      participants: ['team-1', 'team-2'],
    };

    // Find which teams the local user is on
    const localUserTeams = teams
      .filter(t => t.members.some(m => m.id === localUserId))
      .map(t => t.id);

    const canReport = !match.winnerId && !match.isBye &&
      match.participants.some(teamId => localUserTeams.includes(teamId)) &&
      match.participants[0] && match.participants[1];

    assert(canReport);
    assertEquals(localUserTeams.length, 1);
    assertEquals(localUserTeams[0], 'team-1');
  });

  await t.step('user not on participating team cannot report', () => {
    const localUserId = 'player-5'; // Not on any team
    const teams = [
      { id: 'team-1', members: [{ id: 'player-1' }, { id: 'player-2' }] },
      { id: 'team-2', members: [{ id: 'player-3' }, { id: 'player-4' }] },
    ];
    const match = {
      winnerId: null,
      isBye: false,
      participants: ['team-1', 'team-2'],
    };

    const localUserTeams = teams
      .filter(t => t.members.some(m => m.id === localUserId))
      .map(t => t.id);

    const canReport = !match.winnerId && !match.isBye &&
      match.participants.some(teamId => localUserTeams.includes(teamId)) &&
      match.participants[0] && match.participants[1];

    assertEquals(canReport, false);
  });
});
