/**
 * Tests for setupStateSync handlers in sync.js
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { ActionTypes } from '../js/network/room.js';
import { setupStateSync, resetSyncState, markStateInitialized } from '../js/network/sync.js';
import { createMockRoom, createParticipants } from './fixtures.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { generateMarioKartTournament } from '../js/tournament/mario-kart.js';

function resetStore() {
  resetSyncState();
  store.reset();
  store.setAdmin(false);
}

function setupRoom() {
  const room = createMockRoom('local-peer');
  setupStateSync(room);
  return room;
}

function mapAdmin(room, adminId = 'admin-1', peerId = 'peer-admin') {
  const remoteState = {
    meta: { adminId, version: 1 },
  };
  room._simulateAction(ActionTypes.STATE_RESPONSE, { state: remoteState, isAdmin: true }, peerId);
}

Deno.test('setupStateSync handlers', async (t) => {
  await t.step('responds to state requests with serialized state', () => {
    resetStore();
    store.set('meta.id', 'room-1');
    store.setAdmin(true);

    const room = setupRoom();
    room._simulateAction(ActionTypes.STATE_REQUEST, {}, 'peer-1');

    const response = room._sentMessages.find(m => m.type === ActionTypes.STATE_RESPONSE);
    assert(response, 'should send state response');
    assertEquals(response.peerId, 'peer-1');
    assertEquals(response.payload.isAdmin, true);
    assertEquals(response.payload.state.meta.id, 'room-1');
  });

  await t.step('merges state response and allows admin routing via mapping', () => {
    resetStore();
    const room = setupRoom();

    const remoteState = {
      meta: { adminId: 'admin-1', version: 1 },
      participants: [['admin-1', { id: 'admin-1', name: 'Admin' }]],
      matches: [],
    };

    room._simulateAction(ActionTypes.STATE_RESPONSE, { state: remoteState, isAdmin: true }, 'peer-admin');

    assertEquals(store.get('meta.adminId'), 'admin-1');

    // Admin update should be routed to explicit target id
    room._simulateAction(
      ActionTypes.PARTICIPANT_UPDATE,
      { id: 'target-1', name: 'Target' },
      'peer-admin'
    );

    assert(store.getParticipant('target-1'), 'admin should update target participant');
    assertEquals(store.getParticipant('peer-admin'), undefined);
  });

  await t.step('handles participant join and update', () => {
    resetStore();
    const room = setupRoom();

    room._simulateAction(
      ActionTypes.PARTICIPANT_JOIN,
      { name: 'Alice', localUserId: 'user-1' },
      'peer-1'
    );

    const participant = store.getParticipant('user-1');
    assert(participant, 'participant should be added');
    assertEquals(participant.name, 'Alice');
    assertEquals(participant.peerId, 'peer-1');

    room._simulateAction(
      ActionTypes.PARTICIPANT_JOIN,
      { name: 'Alice Updated', localUserId: 'user-1' },
      'peer-1'
    );

    assertEquals(store.getParticipant('user-1').name, 'Alice Updated');
  });

  await t.step('participant update uses peerId fallback and ignores id for non-admin', () => {
    resetStore();
    const room = setupRoom();

    store.addParticipant({ id: 'user-1', peerId: 'peer-1', name: 'Alice' });

    room._simulateAction(ActionTypes.PARTICIPANT_UPDATE, { name: 'Alicia' }, 'peer-1');
    assertEquals(store.getParticipant('user-1').name, 'Alicia');

    room._simulateAction(ActionTypes.PARTICIPANT_UPDATE, { name: 'Bob' }, 'peer-2');
    assert(store.getParticipant('peer-2'), 'unknown peer should be added when name is provided');

    store.set('meta.adminId', 'admin-1');
    room._simulateAction(
      ActionTypes.PARTICIPANT_UPDATE,
      { id: 'target-2', name: 'Carol' },
      'peer-2'
    );
    assertEquals(store.getParticipant('target-2'), undefined);
  });

  await t.step('participant leave marks disconnected', () => {
    resetStore();
    const room = setupRoom();

    room._simulateAction(
      ActionTypes.PARTICIPANT_JOIN,
      { name: 'Alice', localUserId: 'user-1' },
      'peer-1'
    );

    room._simulateAction(ActionTypes.PARTICIPANT_LEAVE, {}, 'peer-1');
    assertEquals(store.getParticipant('user-1').isConnected, false);
  });

  await t.step('tournament start applies bracket and matches for admin', () => {
    resetStore();
    store.set('meta.adminId', 'admin-1');
    store.setAdmin(true);

    const room = setupRoom();
    mapAdmin(room);

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    room._simulateAction(
      ActionTypes.TOURNAMENT_START,
      { bracket: { ...bracket, matches: undefined }, matches: Array.from(bracket.matches.entries()) },
      'peer-admin'
    );

    assertEquals(store.get('meta.status'), 'active');
    assertEquals(store.get('meta.type'), 'single');
    assertEquals(store.get('matches').size, bracket.matches.size);
  });

  await t.step('tournament start deserializes standings for mario kart', () => {
    resetStore();
    store.set('meta.adminId', 'admin-1');
    store.setAdmin(true);

    const room = setupRoom();
    mapAdmin(room);

    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, { playersPerGame: 4, gamesPerPlayer: 1 });

    room._simulateAction(
      ActionTypes.TOURNAMENT_START,
      {
        bracket: {
          ...tournament,
          matches: undefined,
          standings: Array.from(tournament.standings.entries()),
        },
        matches: Array.from(tournament.matches.entries()),
      },
      'peer-admin'
    );

    assertEquals(store.get('standings').size, 4);
    assertEquals(store.get('meta.type'), 'mariokart');
  });

  await t.step('tournament reset clears mode-specific state for admin', () => {
    resetStore();
    store.set('meta.adminId', 'admin-1');
    store.setAdmin(true);

    const room = setupRoom();
    mapAdmin(room);

    store.set('meta.status', 'active');
    store.set('bracket', { rounds: [] });
    store.setMatches(new Map([['m1', { id: 'm1' }]]));
    store.deserialize({ standings: [['p1', { points: 5, gamesCompleted: 1, wins: 1, name: 'P1', history: [] }]] });
    store.setTeamAssignment('p1', 'team-1');

    room._simulateAction(ActionTypes.TOURNAMENT_RESET, {}, 'peer-admin');

    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.get('bracket'), null);
    assertEquals(store.get('matches').size, 0);
    assertEquals(store.get('standings').size, 0);
    assertEquals(store.getTeamAssignments().size, 0);
  });

  await t.step('match result respects initialization, validation, and verification rules', () => {
    resetStore();
    store.set('meta.type', 'single');
    store.set('meta.adminId', 'admin-1');

    const matchId = 'r1m0';
    store.setMatches(new Map([
      [matchId, { id: matchId, participants: ['user-1', 'user-2'], scores: [0, 0], winnerId: null }],
    ]));

    const room = setupRoom();
    room._simulateAction(
      ActionTypes.PARTICIPANT_JOIN,
      { name: 'Alice', localUserId: 'user-1' },
      'peer-1'
    );

    room._simulateAction(
      ActionTypes.MATCH_RESULT,
      { matchId, scores: [2, 1], winnerId: 'user-1', reportedAt: Date.now(), version: 1 },
      'peer-1'
    );
    assertEquals(store.getMatch(matchId).winnerId, null, 'should ignore before init');

    markStateInitialized();

    room._simulateAction(
      ActionTypes.MATCH_RESULT,
      { matchId, scores: [2, 1], winnerId: 'intruder', reportedAt: Date.now(), version: 1 },
      'peer-1'
    );
    assertEquals(store.getMatch(matchId).winnerId, null, 'should reject invalid winner');

    room._simulateAction(
      ActionTypes.MATCH_RESULT,
      { matchId, scores: [2, 1], winnerId: 'user-1', reportedAt: Date.now(), version: 2 },
      'peer-1'
    );
    assertEquals(store.getMatch(matchId).winnerId, 'user-1');
    assertEquals(store.getMatch(matchId).reportedBy, 'user-1');

    store.updateMatch(matchId, { verifiedBy: 'admin-1' });
    room._simulateAction(
      ActionTypes.MATCH_RESULT,
      { matchId, scores: [0, 2], winnerId: 'user-2', reportedAt: Date.now(), version: 3 },
      'peer-1'
    );
    assertEquals(store.getMatch(matchId).winnerId, 'user-1', 'non-admin should not override verified match');
  });

  await t.step('match verification only accepted from admin', () => {
    resetStore();
    store.set('meta.adminId', 'admin-1');

    const matchId = 'r1m0';
    store.setMatches(new Map([
      [matchId, { id: matchId, participants: ['user-1', 'user-2'], scores: [2, 1], winnerId: 'user-1' }],
    ]));

    const room = setupRoom();

    room._simulateAction(
      ActionTypes.PARTICIPANT_JOIN,
      { name: 'User', localUserId: 'user-1' },
      'peer-1'
    );

    room._simulateAction(
      ActionTypes.MATCH_VERIFY,
      { matchId, scores: [2, 1], winnerId: 'user-1' },
      'peer-1'
    );
    assertEquals(store.getMatch(matchId).verifiedBy, undefined);

    mapAdmin(room);

    room._simulateAction(
      ActionTypes.MATCH_VERIFY,
      { matchId, scores: [2, 1], winnerId: 'user-1' },
      'peer-admin'
    );
    assertEquals(store.getMatch(matchId).verifiedBy, 'admin-1');
  });

  await t.step('standings update only accepted from admin', () => {
    resetStore();
    store.set('meta.adminId', 'admin-1');

    const room = setupRoom();
    room._simulateAction(
      ActionTypes.PARTICIPANT_JOIN,
      { name: 'User', localUserId: 'user-1' },
      'peer-1'
    );

    room._simulateAction(
      ActionTypes.STANDINGS_UPDATE,
      { standings: [['user-1', { points: 10, wins: 1, gamesCompleted: 1, name: 'User', history: [] }]] },
      'peer-1'
    );
    assertEquals(store.get('standings').size, 0);

    mapAdmin(room);

    room._simulateAction(
      ActionTypes.STANDINGS_UPDATE,
      { standings: [['user-1', { points: 10, wins: 1, gamesCompleted: 1, name: 'User', history: [] }]] },
      'peer-admin'
    );
    assertEquals(store.get('standings').size, 1);
  });

  await t.step('race result enforces participant/admin and staleness', async () => {
    resetStore();
    store.set('meta.type', 'mariokart');
    store.set('meta.adminId', 'admin-1');

    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, { playersPerGame: 4, gamesPerPlayer: 1 });
    const gameId = Array.from(tournament.matches.keys())[0];

    store.set('bracket', { ...tournament, matches: undefined });
    store.setMatches(tournament.matches);
    store.deserialize({ standings: Array.from(tournament.standings.entries()) });

    const room = setupRoom();

    // Non-participant should be rejected
    room._simulateAction(
      ActionTypes.RACE_RESULT,
      { gameId, results: participants.map((p, i) => ({ participantId: p.id, position: i + 1 })), reportedAt: Date.now() },
      'peer-outsider'
    );
    assertEquals(store.getMatch(gameId).complete, false);

    // Participant accepted
    room._simulateAction(
      ActionTypes.PARTICIPANT_JOIN,
      { name: participants[0].name, localUserId: participants[0].id },
      'peer-1'
    );

    room._simulateAction(
      ActionTypes.RACE_RESULT,
      { gameId, results: participants.map((p, i) => ({ participantId: p.id, position: i + 1 })), reportedAt: Date.now() },
      'peer-1'
    );
    await new Promise(resolve => setTimeout(resolve, 0));
    assertEquals(store.getMatch(gameId).complete, true);

    // Stale result should be ignored for non-admin
    const guardedReportedAt = Date.now() + 1000;
    store.updateMatch(gameId, { reportedAt: guardedReportedAt });
    room._simulateAction(
      ActionTypes.RACE_RESULT,
      { gameId, results: participants.map((p, i) => ({ participantId: p.id, position: i + 1 })), reportedAt: Date.now() },
      'peer-1'
    );
    assertEquals(store.getMatch(gameId).reportedAt, guardedReportedAt);
  });

  // Cleanup heartbeat interval after all steps
  resetStore();
});
