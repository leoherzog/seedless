/**
 * Tests for the setupStateSync action handlers and the exported sync helpers.
 */

import { assertEquals, assert, assertNotEquals } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { reportMatchResult, startTournament, reportRaceResult } from '../js/network/sync.js';
import { ActionTypes } from '../js/network/room.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { generateMarioKartTournament } from '../js/tournament/mario-kart.js';
import { createParticipants, installLobbyDom } from './fixtures.js';
import { connectAs, mapAdmin } from './sync-fixtures.js';

/** Load a 4-player single-elimination bracket into the store. */
function loadSingleBracket() {
  const { bracket, matches } = generateSingleEliminationBracket(createParticipants(4));
  store.setMatches(matches);
  store.set('bracket', bracket);
}

Deno.test('STATE_REQUEST handler', async (t) => {
  await t.step('responds with current state to requester', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: adminId, adminId });

    store.set('meta.id', 'room-1');
    store.addParticipant({ id: adminId, name: 'Admin', seed: 1 });

    mockRoom._simulateAction(ActionTypes.STATE_REQUEST, {}, 'peer-1');

    assertEquals(mockRoom._sentMessages.length, 1);
    assertEquals(mockRoom._sentMessages[0].type, ActionTypes.STATE_RESPONSE);
    assertEquals(mockRoom._sentMessages[0].peerId, 'peer-1');
    assertEquals(mockRoom._sentMessages[0].payload.state.meta.id, 'room-1');
    assertEquals(mockRoom._sentMessages[0].payload.isAdmin, true);
  });
});

Deno.test('STATE_RESPONSE handler', async (t) => {
  await t.step('merges valid state from admin', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'participant-456', adminId, peers: ['admin-peer'] });

    const remoteState = {
      meta: { adminId, status: 'lobby' },
      participants: [[adminId, { id: adminId, name: 'Admin', seed: 1, isConnected: true }]],
    };

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: remoteState,
      isAdmin: true,
    }, 'admin-peer');

    assertEquals(store.get('meta.adminId'), adminId);
    assert(store.getParticipant(adminId) !== undefined);
  });

  await t.step('rejects invalid state structure', () => {
    const mockRoom = connectAs({ userId: 'user-1', adminId: 'admin-1' });

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: null,
      isAdmin: true,
    }, 'admin-peer');

    assertEquals(store.get('meta.adminId'), 'admin-1');
  });

  await t.step('reconciles connection status with actual peers', () => {
    const adminId = 'admin-123';
    const participantId = 'participant-456';
    const mockRoom = connectAs({ userId: participantId, adminId, peers: ['admin-peer', 'other-peer'] });

    store.addParticipant({ id: participantId, name: 'Me', seed: 1, isConnected: false });
    store.addParticipant({ id: 'other-user', name: 'Other', seed: 2, peerId: 'other-peer', isConnected: false });
    store.addParticipant({ id: 'disconnected-user', name: 'Disconnected', seed: 3, peerId: 'gone-peer', isConnected: true });

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby' }, participants: [] },
      isAdmin: true,
    }, 'admin-peer');

    assertEquals(store.getParticipant(participantId).isConnected, true);
    assertEquals(store.getParticipant('other-user').isConnected, true);
    assertEquals(store.getParticipant('disconnected-user').isConnected, false);
  });

  await t.step('re-announces self to admin after receiving admin state', () => {
    const adminId = 'admin-123';
    const participantId = 'participant-456';
    const mockRoom = connectAs({ userId: participantId, adminId, name: 'TestUser' });
    mockRoom._clearMessages();

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby' }, participants: [] },
      isAdmin: true,
    }, 'admin-peer');

    const join = mockRoom._sentMessages.find(m => m.type === ActionTypes.PARTICIPANT_JOIN);
    assert(join !== undefined, 'Should send PARTICIPANT_JOIN');
    assertEquals(join.peerId, 'admin-peer');
    assertEquals(join.payload.name, 'TestUser');
    assertEquals(join.payload.localUserId, participantId);
  });
});

Deno.test('PARTICIPANT_JOIN handler', async (t) => {
  await t.step('adds new participant', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'NewPlayer',
      localUserId: 'new-player-id',
      joinedAt: Date.now(),
    }, 'peer-1');

    const participant = store.getParticipant('new-player-id');
    assert(participant !== undefined);
    assertEquals(participant.name, 'NewPlayer');
    assertEquals(participant.peerId, 'peer-1');
  });

  await t.step('rejects invalid payload', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

    const initialCount = store.getParticipantList().length;

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      localUserId: 'bad-player',
    }, 'peer-1');
    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, { name: 'NoId' }, 'peer-2');

    assertEquals(store.getParticipantList().length, initialCount);
    assertEquals(store.getParticipant('peer-2'), undefined);
  });

  await t.step('handles manual participant additions from admin', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId });
    mapAdmin(mockRoom, adminId);

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'ManualPlayer',
      localUserId: 'manual-id',
      isManual: true,
      joinedAt: Date.now(),
    }, 'admin-peer');

    const participant = store.getParticipant('manual-id');
    assert(participant !== undefined);
    assertEquals(participant.name, 'ManualPlayer');
    assertEquals(participant.isManual, true);
    assertEquals(participant.isConnected, false, 'manual players stay offline on peers');
  });

  await t.step('rejects manual participant injection from non-admin', () => {
    const mockRoom = connectAs({ userId: 'user-1', adminId: 'admin-123' });

    const initialCount = store.getParticipantList().length;

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'InjectedPlayer',
      localUserId: 'injected-id',
      isManual: true,
      joinedAt: Date.now(),
    }, 'malicious-peer');

    assertEquals(store.getParticipant('injected-id'), undefined);
    assertEquals(store.getParticipantList().length, initialCount);
  });

  await t.step('rejects admin impersonation attempt', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'participant-1', adminId });
    store.addParticipant({ id: adminId, name: 'Admin', seed: 1 });

    const initialAdminParticipant = store.getParticipant(adminId);

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Impersonator',
      localUserId: adminId,
      joinedAt: Date.now(),
    }, 'malicious-peer');

    assertEquals(store.getParticipant(adminId).name, initialAdminParticipant.name);
  });

  await t.step('rejects duplicate ID claim from different connected peer', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

    store.addParticipant({
      id: 'existing-user',
      name: 'ExistingUser',
      peerId: 'peer-1',
      isConnected: true,
      seed: 1,
    });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Hijacker',
      localUserId: 'existing-user',
      joinedAt: Date.now(),
    }, 'peer-2');

    const participant = store.getParticipant('existing-user');
    assertEquals(participant.name, 'ExistingUser');
    assertEquals(participant.peerId, 'peer-1');
  });

  await t.step('auto-claims unclaimed manual participant with matching name', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

    store.addParticipant({
      id: 'manual-slot',
      name: 'TestPlayer',
      isManual: true,
      claimedBy: null,
      isConnected: false,
      seed: 1,
    });

    // Name match is case-insensitive.
    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'testplayer',
      localUserId: 'real-player-id',
      joinedAt: Date.now(),
    }, 'peer-1');

    const manualSlot = store.getParticipant('manual-slot');
    assertEquals(manualSlot.claimedBy, 'real-player-id');
    assertEquals(manualSlot.isConnected, true);
    assertEquals(manualSlot.peerId, 'peer-1');
  });

  await t.step('updates existing disconnected participant on rejoin', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

    store.addParticipant({
      id: 'returning-user',
      name: 'OldName',
      peerId: null,
      isConnected: false,
      seed: 1,
    });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'NewName',
      localUserId: 'returning-user',
      joinedAt: Date.now(),
    }, 'new-peer');

    const participant = store.getParticipant('returning-user');
    assertEquals(participant.name, 'NewName');
    assertEquals(participant.peerId, 'new-peer');
    assertEquals(participant.isConnected, true);
  });
});

Deno.test('PARTICIPANT_UPDATE handler', async (t) => {
  await t.step('updates participant data', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

    store.addParticipant({ id: 'user-1', name: 'OldName', seed: 1, peerId: 'peer-1' });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'OldName',
      localUserId: 'user-1',
    }, 'peer-1');

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      name: 'NewName',
    }, 'peer-1');

    assertEquals(store.getParticipant('user-1').name, 'NewName');
  });

  await t.step('admin can update any participant by ID', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-2', adminId });
    mapAdmin(mockRoom, adminId);

    store.addParticipant({ id: 'user-1', name: 'Player1', seed: 2 });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      id: 'user-1',
      name: 'UpdatedByAdmin',
    }, 'admin-peer');

    assertEquals(store.getParticipant('user-1').name, 'UpdatedByAdmin');
  });

  await t.step('updates apply only to the mapped sender, and never add participants', () => {
    const mockRoom = connectAs({ userId: 'local-user', adminId: 'admin-1' });

    store.addParticipant({ id: 'user-1', peerId: 'peer-1', name: 'Alice' });
    store.addParticipant({ id: 'user-2', name: 'Bob' });

    // A synced peerId alone does not identify the sender.
    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, { name: 'Alicia' }, 'peer-1');
    assertEquals(store.getParticipant('user-1').name, 'Alice');

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, { name: 'Alice', localUserId: 'user-1' }, 'peer-1');
    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, { name: 'Alicia' }, 'peer-1');
    assertEquals(store.getParticipant('user-1').name, 'Alicia');

    // A non-admin's id is ignored.
    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, { id: 'user-2', name: 'Carol' }, 'peer-1');
    assertEquals(store.getParticipant('user-2').name, 'Bob');
    assertEquals(store.getParticipant('user-1').name, 'Carol');

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, { name: 'Dave' }, 'peer-3');
    assertEquals(store.getParticipant('peer-3'), undefined);
  });

  await t.step('rejects invalid payload', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

    store.addParticipant({ id: 'user-1', name: 'Player', seed: 1, peerId: 'peer-1' });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player',
      localUserId: 'user-1',
    }, 'peer-1');

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      name: '',
    }, 'peer-1');

    assertEquals(store.getParticipant('user-1').name, 'Player');
  });
});

Deno.test('PARTICIPANT_LEAVE handler', async (t) => {
  await t.step('ignores a leave without removedId, which onPeerLeave handles', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player',
      localUserId: 'user-1',
    }, 'peer-1');

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_LEAVE, {}, 'peer-1');

    assertEquals(store.getParticipant('user-1').isConnected, true);
  });

  await t.step('admin can remove other participants', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'participant-1', adminId });

    store.addParticipant({ id: 'user-1', name: 'ToRemove', seed: 2 });
    mapAdmin(mockRoom, adminId);

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_LEAVE, {
      removedId: 'user-1',
    }, 'admin-peer');

    assertEquals(store.getParticipant('user-1'), undefined);
  });

  await t.step('rejects non-admin removal attempt', () => {
    const mockRoom = connectAs({ userId: 'user-1', adminId: 'admin-123' });

    store.addParticipant({ id: 'user-2', name: 'Target', seed: 1 });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'User1',
      localUserId: 'user-1',
    }, 'peer-1');

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_LEAVE, {
      removedId: 'user-2',
    }, 'peer-1');

    assert(store.getParticipant('user-2') !== undefined);
  });
});

Deno.test('TOURNAMENT_START handler', async (t) => {
  await t.step('rejects tournament start from non-admin', () => {
    const mockRoom = connectAs({ userId: 'user-1', adminId: 'admin-123' });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'User1',
      localUserId: 'user-1',
    }, 'peer-1');

    const { bracket, matches } = generateSingleEliminationBracket(createParticipants(4));

    mockRoom._simulateAction(ActionTypes.TOURNAMENT_START, {
      bracket,
      matches: Array.from(matches.entries()),
    }, 'peer-1');

    assertNotEquals(store.get('meta.status'), 'active');
  });

  await t.step('accepts tournament start from admin', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'participant-1', adminId });
    mapAdmin(mockRoom, adminId);

    const { bracket, matches } = generateSingleEliminationBracket(createParticipants(4));

    mockRoom._simulateAction(ActionTypes.TOURNAMENT_START, {
      bracket,
      matches: Array.from(matches.entries()),
    }, 'admin-peer');

    assertEquals(store.get('meta.status'), 'active');
    assertEquals(store.get('meta.type'), 'single');
    assert(store.get('bracket') !== null);
    assertEquals(store.get('matches').size, matches.size);
  });

  await t.step('tournament start deserializes standings for mario kart', () => {
    const adminId = 'admin-1';
    const mockRoom = connectAs({ userId: 'participant-1', adminId });
    mapAdmin(mockRoom, adminId);

    const { matches, standings, ...race } = generateMarioKartTournament(createParticipants(4), { playersPerGame: 4, gamesPerPlayer: 1 });

    mockRoom._simulateAction(ActionTypes.TOURNAMENT_START, {
      bracket: race,
      matches: Array.from(matches.entries()),
      standings: Array.from(standings.entries()),
    }, 'admin-peer');

    assertEquals(store.get('standings').size, 4);
    assertEquals(store.get('meta.type'), 'mariokart');
  });
});

// The reset toast needs a DOM and leaves its removal timer running.
Deno.test({
  name: 'TOURNAMENT_RESET handler',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    installLobbyDom();

    await t.step('resets tournament state when called by admin', () => {
      const adminId = 'admin-123';
      const mockRoom = connectAs({ userId: 'participant-1', adminId });
      mapAdmin(mockRoom, adminId);

      store.set('meta.status', 'active');
      store.set('bracket', { type: 'single', rounds: [] });
      store.setMatches(new Map([['m1', { id: 'm1' }]]));
      store.deserialize({ standings: [['p1', { points: 5, gamesCompleted: 1, wins: 1, name: 'P1' }]] });
      store.setTeamAssignment('p1', 'team-1');

      mockRoom._simulateAction(ActionTypes.TOURNAMENT_RESET, {}, 'admin-peer');

      assertEquals(store.get('meta.status'), 'lobby');
      assertEquals(store.get('bracket'), null);
      assertEquals(store.get('matches').size, 0);
      assertEquals(store.get('standings').size, 0);
      assertEquals(store.getTeamAssignments().size, 0);
    });

    await t.step('adds the carried archive to history once', () => {
      const adminId = 'admin-123';
      const mockRoom = connectAs({ userId: 'participant-1', adminId });
      mapAdmin(mockRoom, adminId);

      store.set('meta.status', 'complete');
      const archive = { id: 'archive-1', name: 'Cup', winner: null, standings: [] };

      mockRoom._simulateAction(ActionTypes.TOURNAMENT_RESET, { archive }, 'admin-peer');
      mockRoom._simulateAction(ActionTypes.TOURNAMENT_RESET, { archive }, 'admin-peer');

      assertEquals(store.getHistory().map(h => h.id), ['archive-1']);
      assertEquals(store.get('meta.status'), 'lobby');
    });

    await t.step('rejects reset from non-admin', () => {
      const mockRoom = connectAs({ userId: 'user-1', adminId: 'admin-123' });

      mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
        name: 'User1',
        localUserId: 'user-1',
      }, 'peer-1');

      store.set('meta.status', 'active');

      mockRoom._simulateAction(ActionTypes.TOURNAMENT_RESET, { archive: { id: 'forged' } }, 'peer-1');

      assertEquals(store.get('meta.status'), 'active');
      assertEquals(store.getHistory(), []);
    });
  },
});

Deno.test('MATCH_RESULT handler', async (t) => {
  await t.step('accepts valid result from participant', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });
    loadSingleBracket();
    store.set('meta.status', 'active');
    store.set('meta.type', 'single');

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player 1',
      localUserId: 'player-1',
    }, 'peer-1');

    const matchId = 'r1m0';
    const winnerId = store.getMatch(matchId).participants[0];
    const reportedAt = Date.now() - 5000;

    mockRoom._simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [2, 1],
      winnerId,
      reportedAt,
      version: 1,
    }, 'peer-1');

    assertEquals(store.getMatch(matchId).winnerId, winnerId);
    assertEquals(store.getMatch(matchId).reportedBy, 'player-1');
    assertEquals(store.getMatch(matchId).reportedAt, reportedAt, 'the sender\'s reportedAt survives advancement');
    assertEquals(store.getMatch('r2m0').participants[0], winnerId, 'the winner advances');
  });

  await t.step('rejects result with invalid winnerId', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });
    loadSingleBracket();
    store.set('meta.status', 'active');

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player 1',
      localUserId: 'player-1',
    }, 'peer-1');

    const matchId = 'r1m0';

    mockRoom._simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [2, 1],
      winnerId: 'not-in-match',
      reportedAt: Date.now(),
    }, 'peer-1');

    assertEquals(store.getMatch(matchId).winnerId, null);
  });

  await t.step('rejects result from non-participant non-admin', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });
    loadSingleBracket();
    store.set('meta.status', 'active');

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Outsider',
      localUserId: 'outsider',
    }, 'peer-outsider');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);

    mockRoom._simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [2, 1],
      winnerId: match.participants[0],
      reportedAt: Date.now(),
    }, 'peer-outsider');

    assertEquals(store.getMatch(matchId).winnerId, null);
  });

  await t.step('ignores result before state initialized for non-admin', () => {
    const mockRoom = connectAs({ userId: 'player-1', adminId: 'admin-123' });

    loadSingleBracket();

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player 1',
      localUserId: 'player-1',
    }, 'peer-1');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);
    const result = {
      matchId,
      scores: [2, 1],
      winnerId: match.participants[0],
      reportedAt: Date.now(),
    };

    mockRoom._simulateAction(ActionTypes.MATCH_RESULT, result, 'peer-1');
    assertEquals(store.getMatch(matchId).winnerId, null);

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, { state: {}, isAdmin: false }, 'peer-x');

    mockRoom._simulateAction(ActionTypes.MATCH_RESULT, result, 'peer-1');
    assertEquals(store.getMatch(matchId).winnerId, match.participants[0]);
  });

  await t.step('protects verified match from non-admin overwrite', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: adminId, adminId });
    loadSingleBracket();
    store.set('meta.status', 'active');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);
    const originalWinner = match.participants[0];

    store.updateMatch(matchId, {
      winnerId: originalWinner,
      scores: [2, 0],
      verifiedBy: adminId,
    });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player 2',
      localUserId: match.participants[1],
    }, 'peer-2');

    mockRoom._simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [0, 2],
      winnerId: match.participants[1],
      reportedAt: Date.now() + 1000,
      version: 2,
    }, 'peer-2');

    assertEquals(store.getMatch(matchId).winnerId, originalWinner);
  });
});

Deno.test('MATCH_VERIFY handler', async (t) => {
  await t.step('admin can verify match', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'participant-1', adminId });

    loadSingleBracket();
    mapAdmin(mockRoom, adminId);

    const matchId = 'r1m0';
    const winnerId = store.getMatch(matchId).participants[0];
    store.updateMatch(matchId, { reportedBy: winnerId, reportedAt: 1234 });

    mockRoom._simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId,
      scores: [2, 0],
      winnerId,
    }, 'admin-peer');

    assertEquals(store.getMatch(matchId).winnerId, winnerId);
    assertEquals(store.getMatch(matchId).verifiedBy, adminId);
    assertEquals(store.getMatch(matchId).reportedBy, winnerId, 'verify keeps the reporter');
    assertEquals(store.getMatch(matchId).reportedAt, 1234, 'verify keeps the reported time');
    assertEquals(store.getMatch('r2m0').participants[0], winnerId, 'the winner advances');
  });

  await t.step('rejects verify from non-admin', () => {
    const mockRoom = connectAs({ userId: 'user-1', adminId: 'admin-123' });

    loadSingleBracket();

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'User1',
      localUserId: 'user-1',
    }, 'peer-1');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);

    mockRoom._simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId,
      scores: [2, 0],
      winnerId: match.participants[0],
    }, 'peer-1');

    assertEquals(store.getMatch(matchId).verifiedBy, null);
  });
});

Deno.test('RACE_RESULT handler', async (t) => {
  await t.step('race result enforces participant/admin and staleness', () => {
    const mockRoom = connectAs({ userId: 'local-user', adminId: 'admin-1' });
    store.set('meta.type', 'mariokart');

    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, { playersPerGame: 4, gamesPerPlayer: 1 });
    const gameId = Array.from(tournament.matches.keys())[0];
    const results = participants.map((p, i) => ({ participantId: p.id, position: i + 1 }));

    store.set('bracket', { ...tournament, matches: undefined });
    store.setMatches(tournament.matches);
    store.deserialize({ standings: Array.from(tournament.standings.entries()) });

    mockRoom._simulateAction(ActionTypes.RACE_RESULT, { gameId, results, reportedAt: Date.now() }, 'peer-outsider');
    assertEquals(store.getMatch(gameId).complete, false);

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: participants[0].name,
      localUserId: participants[0].id,
    }, 'peer-1');

    mockRoom._simulateAction(ActionTypes.RACE_RESULT, { gameId, results, reportedAt: Date.now() }, 'peer-1');
    assertEquals(store.getMatch(gameId).complete, true);

    // A non-admin result older than the stored one is ignored.
    const guardedReportedAt = Date.now() + 1000;
    store.updateMatch(gameId, { reportedAt: guardedReportedAt });
    mockRoom._simulateAction(ActionTypes.RACE_RESULT, { gameId, results, reportedAt: Date.now() }, 'peer-1');
    assertEquals(store.getMatch(gameId).reportedAt, guardedReportedAt);
  });

  await t.step('a later concurrent report of a completed game wins without double counting', () => {
    const mockRoom = connectAs({ userId: 'local-user', adminId: 'admin-1' });
    const participants = createParticipants(4);
    const { matches, standings, ...race } = generateMarioKartTournament(participants, { playersPerGame: 4, gamesPerPlayer: 1 });
    const gameId = matches.keys().next().value;
    store.set('bracket', race);
    store.setMatches(matches);
    store.set('standings', standings);

    const [a, b] = participants;
    for (const [p, peer] of [[a, 'peer-a'], [b, 'peer-b']]) {
      mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, { name: p.name, localUserId: p.id }, peer);
    }
    const order = (first) => [first, ...participants.map(p => p.id).filter(id => id !== first)]
      .map(participantId => ({ participantId }));

    mockRoom._simulateAction(ActionTypes.RACE_RESULT, { gameId, results: order(a.id), reportedAt: 1000, version: 1 }, 'peer-a');
    mockRoom._simulateAction(ActionTypes.RACE_RESULT, { gameId, results: order(b.id), reportedAt: 2000, version: 1 }, 'peer-b');

    const game = store.getMatch(gameId);
    assertEquals(game.winnerId, b.id);
    assertEquals(game.reportedBy, b.id);
    assertEquals(game.reportedAt, 2000);
    assertEquals(store.get('standings').get(b.id).wins, 1);
    assertEquals(store.get('standings').get(a.id).wins, 0);
    assertEquals(store.get('standings').get(a.id).gamesCompleted, 1);
  });

  await t.step('rejects a result without reportedAt, or one that repeats or omits a racer', () => {
    const mockRoom = connectAs({ userId: 'local-user', adminId: 'admin-1' });
    const participants = createParticipants(4);
    const { matches, standings, ...race } = generateMarioKartTournament(participants, { playersPerGame: 4, gamesPerPlayer: 1 });
    const gameId = matches.keys().next().value;
    store.set('bracket', race);
    store.setMatches(matches);
    store.set('standings', standings);

    const [a] = participants;
    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, { name: a.name, localUserId: a.id }, 'peer-a');
    const everyone = participants.map(p => ({ participantId: p.id }));
    const onlyA = participants.map(() => ({ participantId: a.id }));

    mockRoom._simulateAction(ActionTypes.RACE_RESULT, { gameId, results: everyone, version: 1 }, 'peer-a');
    mockRoom._simulateAction(ActionTypes.RACE_RESULT, { gameId, results: onlyA, reportedAt: 1000, version: 1 }, 'peer-a');
    mockRoom._simulateAction(ActionTypes.RACE_RESULT, { gameId, results: everyone.slice(1), reportedAt: 1000, version: 1 }, 'peer-a');

    assertEquals(store.getMatch(gameId).complete, false);
    assertEquals(store.get('standings').get(a.id).gamesCompleted, 0);
  });
});

Deno.test('Peer join/leave handlers', async (t) => {
  await t.step('marks participant connected on peer join', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player',
      localUserId: 'player-1',
    }, 'peer-1');

    store.updateParticipant('player-1', { isConnected: false });

    mockRoom._simulatePeerJoin('peer-1');

    assertEquals(store.getParticipant('player-1').isConnected, true);
  });

  await t.step('marks participant disconnected on peer leave', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player',
      localUserId: 'player-1',
    }, 'peer-1');
    mockRoom._setPeers(['peer-1']);

    assertEquals(store.getParticipant('player-1').isConnected, true);

    mockRoom._simulatePeerLeave('peer-1');

    assertEquals(store.getParticipant('player-1').isConnected, false);
  });

  await t.step('requests state from new peer', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });
    mockRoom._clearMessages();

    mockRoom._simulatePeerJoin('new-peer');

    const stateRequest = mockRoom._sentMessages.find(m => m.type === ActionTypes.STATE_REQUEST);
    assert(stateRequest !== undefined);
    assertEquals(stateRequest.peerId, 'new-peer');
  });

  await t.step('re-announces self on peer join', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });
    mockRoom._clearMessages();

    mockRoom._simulatePeerJoin('new-peer');

    const joinBroadcast = mockRoom._broadcasts.find(b => b.type === ActionTypes.PARTICIPANT_JOIN);
    assert(joinBroadcast !== undefined);
    assertEquals(joinBroadcast.payload.localUserId, 'admin-123');
  });
});

Deno.test('reportMatchResult', async (t) => {
  await t.step('broadcasts match result', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });
    mockRoom._clearMessages();

    reportMatchResult(mockRoom, 'match-1', [2, 1], 'player-1');

    assertEquals(mockRoom._broadcasts.length, 1);
    assertEquals(mockRoom._broadcasts[0].type, ActionTypes.MATCH_RESULT);
    assertEquals(mockRoom._broadcasts[0].payload.matchId, 'match-1');
    assertEquals(mockRoom._broadcasts[0].payload.winnerId, 'player-1');
    assertEquals(mockRoom._broadcasts[0].payload.version, 1);
  });

  await t.step('records and advances locally without a room', () => {
    connectAs({ userId: 'player-1', adminId: 'admin-123' });
    loadSingleBracket();

    reportMatchResult(null, 'r1m0', [2, 0], 'player-1');

    assertEquals(store.getMatch('r1m0').winnerId, 'player-1');
    assertEquals(store.getMatch('r1m0').reportedBy, 'player-1');
    assertEquals(store.getMatch('r1m0').version, 1);
    assertEquals(store.getMatch('r2m0').participants[0], 'player-1');
  });
});

Deno.test('startTournament', async (t) => {
  await t.step('broadcasts tournament start when admin', () => {
    const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });
    mockRoom._clearMessages();

    const bracket = { type: 'single', rounds: [] };
    const matches = new Map([['m1', { id: 'm1', participants: [] }]]);

    startTournament(mockRoom, bracket, matches);

    assertEquals(mockRoom._broadcasts.length, 1);
    assertEquals(mockRoom._broadcasts[0].type, ActionTypes.TOURNAMENT_START);
    assertEquals(mockRoom._broadcasts[0].payload.bracket, bracket);
  });
});

Deno.test('reportRaceResult', async (t) => {
  /** Load a one-game, 4-player race into the store. */
  function loadRace() {
    const participants = createParticipants(4);
    const { matches, standings, ...race } = generateMarioKartTournament(participants, { playersPerGame: 4, gamesPerPlayer: 1 });
    store.set('bracket', race);
    store.setMatches(matches);
    store.set('standings', standings);
    store.set('meta.type', 'mariokart');
    store.set('meta.status', 'active');
    const gameId = matches.keys().next().value;
    const results = matches.get(gameId).participants.map(participantId => ({ participantId }));
    return { gameId, results };
  }

  await t.step('applies locally, completes the race and broadcasts the same clock', () => {
    const mockRoom = connectAs({ userId: 'player-1', adminId: 'admin-1' });
    const { gameId, results } = loadRace();
    mockRoom._clearMessages();

    reportRaceResult(mockRoom, gameId, results);

    const game = store.getMatch(gameId);
    assertEquals(game.complete, true);
    assertEquals(game.reportedBy, 'player-1');
    assertEquals(game.version, 1);
    assertEquals(store.get('standings').get(results[0].participantId).wins, 1);
    assertEquals(store.get('meta.status'), 'complete');

    assertEquals(mockRoom._broadcasts.length, 1);
    assertEquals(mockRoom._broadcasts[0].type, ActionTypes.RACE_RESULT);
    assertEquals(mockRoom._broadcasts[0].payload, { gameId, results, reportedAt: game.reportedAt, version: 1 });
  });

  await t.step('records locally without a room', () => {
    connectAs({ userId: 'player-1', adminId: 'admin-1' });
    const { gameId, results } = loadRace();

    reportRaceResult(null, gameId, results);

    assertEquals(store.getMatch(gameId).complete, true);
  });
});
