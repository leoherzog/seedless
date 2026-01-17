/**
 * Tests for sync.js action handlers
 * Tests the actual setupStateSync handlers with proper simulation
 */

import { assertEquals, assert, assertNotEquals } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import {
  setupStateSync,
  resetSyncState,
  advanceWinner,
  announceJoin,
  reportMatchResult,
  startTournament,
  reportRaceResult,
  markStateInitialized,
} from '../js/network/sync.js';
import { ActionTypes } from '../js/network/room.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { generateDoubleEliminationBracket } from '../js/tournament/double-elimination.js';
import { createParticipants } from './fixtures.js';

// Disable sanitizers for tests that use setupStateSync (creates heartbeat interval)
const testOpts = { sanitizeOps: false, sanitizeResources: false };

/**
 * Create a mock room that captures handlers from setupStateSync
 */
function createMockRoom(selfId = 'local-peer') {
  const handlers = new Map();
  const peerJoinHandlers = [];
  const peerLeaveHandlers = [];
  const broadcasts = [];
  const sentMessages = [];
  let peers = [];

  return {
    selfId,
    handlers,
    peerJoinHandlers,
    peerLeaveHandlers,

    onAction(actionType, handler) {
      handlers.set(actionType, handler);
    },

    onPeerJoin(handler) {
      peerJoinHandlers.push(handler);
    },

    onPeerLeave(handler) {
      peerLeaveHandlers.push(handler);
    },

    broadcast(actionType, payload) {
      broadcasts.push({ actionType, payload });
    },

    sendTo(actionType, payload, peerId) {
      sentMessages.push({ actionType, payload, peerId });
    },

    getPeers() {
      return peers;
    },

    leave() {
      peers = [];
    },

    // Test helpers
    _broadcasts: broadcasts,
    _sentMessages: sentMessages,
    _setPeers(p) { peers = p; },
    _clearMessages() {
      broadcasts.length = 0;
      sentMessages.length = 0;
    },

    simulateAction(actionType, payload, fromPeerId) {
      const handler = handlers.get(actionType);
      if (handler) {
        return handler(payload, fromPeerId);
      }
    },

    simulatePeerJoin(peerId) {
      peers.push(peerId);
      peerJoinHandlers.forEach(h => h(peerId));
    },

    simulatePeerLeave(peerId) {
      peers = peers.filter(p => p !== peerId);
      peerLeaveHandlers.forEach(h => h(peerId));
    },
  };
}

/**
 * Setup store for admin
 */
function setupAsAdmin(adminId) {
  store.reset();
  store.set('meta.adminId', adminId);
  store.set('local.localUserId', adminId);
  store.set('local.name', 'Admin');
  store.setAdmin(true);
}

/**
 * Setup store for participant (non-admin)
 */
function setupAsParticipant(userId, adminId) {
  store.reset();
  store.set('meta.adminId', adminId);
  store.set('local.localUserId', userId);
  store.set('local.name', 'Participant');
  store.setAdmin(false);
}

// =============================================================================
// STATE_REQUEST / STATE_RESPONSE Tests
// =============================================================================

Deno.test('STATE_REQUEST handler', testOpts, async (t) => {
  await t.step('responds with current state to requester', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsAdmin(adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Add some state
    store.addParticipant({ id: adminId, name: 'Admin', seed: 1 });

    // Simulate state request from peer
    mockRoom.simulateAction(ActionTypes.STATE_REQUEST, {}, 'peer-1');

    // Should send state response to that peer
    assertEquals(mockRoom._sentMessages.length, 1);
    assertEquals(mockRoom._sentMessages[0].actionType, ActionTypes.STATE_RESPONSE);
    assertEquals(mockRoom._sentMessages[0].peerId, 'peer-1');
    assert(mockRoom._sentMessages[0].payload.state !== undefined);
    assertEquals(mockRoom._sentMessages[0].payload.isAdmin, true);
  });
});

Deno.test('STATE_RESPONSE handler', testOpts, async (t) => {
  await t.step('merges valid state from admin', () => {
    resetSyncState();
    const adminId = 'admin-123';
    const participantId = 'participant-456';
    setupAsParticipant(participantId, adminId);

    const mockRoom = createMockRoom();
    mockRoom._setPeers(['admin-peer']);
    setupStateSync(mockRoom);

    // Simulate receiving state from admin
    const remoteState = {
      meta: { adminId, status: 'lobby', version: 1 },
      participants: [[adminId, { id: adminId, name: 'Admin', seed: 1, isConnected: true }]],
    };

    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: remoteState,
      isAdmin: true,
    }, 'admin-peer');

    // State should be merged
    assertEquals(store.get('meta.adminId'), adminId);
    assert(store.getParticipant(adminId) !== undefined);
  });

  await t.step('rejects invalid state structure', () => {
    resetSyncState();
    setupAsParticipant('user-1', 'admin-1');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Simulate receiving invalid state
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: null,
      isAdmin: true,
    }, 'admin-peer');

    // Should not crash, state unchanged
    assertEquals(store.get('meta.adminId'), 'admin-1');
  });

  await t.step('reconciles connection status with actual peers', () => {
    resetSyncState();
    const adminId = 'admin-123';
    const participantId = 'participant-456';
    setupAsParticipant(participantId, adminId);

    const mockRoom = createMockRoom();
    mockRoom._setPeers(['admin-peer', 'other-peer']);
    setupStateSync(mockRoom);

    // Add self to participants
    store.addParticipant({ id: participantId, name: 'Me', seed: 1, isConnected: false });
    store.addParticipant({ id: 'other-user', name: 'Other', seed: 2, peerId: 'other-peer', isConnected: false });
    store.addParticipant({ id: 'disconnected-user', name: 'Disconnected', seed: 3, peerId: 'gone-peer', isConnected: true });

    const remoteState = {
      meta: { adminId, status: 'lobby', version: 1 },
      participants: [],
    };

    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: remoteState,
      isAdmin: true,
    }, 'admin-peer');

    // Self should be marked connected
    assertEquals(store.getParticipant(participantId).isConnected, true);
    // Other with active peer should be connected
    assertEquals(store.getParticipant('other-user').isConnected, true);
    // User with missing peer should be disconnected
    assertEquals(store.getParticipant('disconnected-user').isConnected, false);
  });

  await t.step('re-announces self to admin after receiving admin state', () => {
    resetSyncState();
    const adminId = 'admin-123';
    const participantId = 'participant-456';
    setupAsParticipant(participantId, adminId);
    store.set('local.name', 'TestUser');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);
    mockRoom._clearMessages();

    const remoteState = {
      meta: { adminId, status: 'lobby', version: 1 },
      participants: [],
    };

    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: remoteState,
      isAdmin: true,
    }, 'admin-peer');

    // Should broadcast participant join
    const joinBroadcast = mockRoom._broadcasts.find(b => b.actionType === ActionTypes.PARTICIPANT_JOIN);
    assert(joinBroadcast !== undefined, 'Should broadcast PARTICIPANT_JOIN');
    assertEquals(joinBroadcast.payload.name, 'TestUser');
    assertEquals(joinBroadcast.payload.localUserId, participantId);
  });
});

// =============================================================================
// PARTICIPANT_JOIN Tests
// =============================================================================

Deno.test('PARTICIPANT_JOIN handler', testOpts, async (t) => {
  await t.step('adds new participant', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
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
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    const initialCount = store.getParticipantList().length;

    // Missing name
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      localUserId: 'bad-player',
    }, 'peer-1');

    assertEquals(store.getParticipantList().length, initialCount);
  });

  await t.step('handles manual participant additions', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'ManualPlayer',
      localUserId: 'manual-id',
      isManual: true,
      joinedAt: Date.now(),
    }, 'admin-peer');

    const participant = store.getParticipant('manual-id');
    assert(participant !== undefined);
    assertEquals(participant.name, 'ManualPlayer');
    assertEquals(participant.isManual, true);
    assertEquals(participant.peerId, null);
  });

  await t.step('rejects admin impersonation attempt', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('participant-1', adminId);
    store.addParticipant({ id: adminId, name: 'Admin', seed: 1 });

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    const initialAdminParticipant = store.getParticipant(adminId);

    // Try to claim admin's ID
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Impersonator',
      localUserId: adminId,
      joinedAt: Date.now(),
    }, 'malicious-peer');

    // Admin participant should be unchanged
    const adminParticipant = store.getParticipant(adminId);
    assertEquals(adminParticipant.name, initialAdminParticipant.name);
  });

  await t.step('rejects duplicate ID claim from different connected peer', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Add an existing connected participant
    store.addParticipant({
      id: 'existing-user',
      name: 'ExistingUser',
      peerId: 'peer-1',
      isConnected: true,
      seed: 1,
    });

    // Try to claim same ID from different peer
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Hijacker',
      localUserId: 'existing-user',
      joinedAt: Date.now(),
    }, 'peer-2');

    // Should still have original data
    const participant = store.getParticipant('existing-user');
    assertEquals(participant.name, 'ExistingUser');
    assertEquals(participant.peerId, 'peer-1');
  });

  await t.step('auto-claims unclaimed manual participant with matching name', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Add an unclaimed manual participant
    store.addParticipant({
      id: 'manual-slot',
      name: 'TestPlayer',
      isManual: true,
      claimedBy: null,
      isConnected: false,
      seed: 1,
    });

    // New player joins with matching name (case-insensitive)
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'testplayer',
      localUserId: 'real-player-id',
      joinedAt: Date.now(),
    }, 'peer-1');

    // Manual slot should be claimed
    const manualSlot = store.getParticipant('manual-slot');
    assertEquals(manualSlot.claimedBy, 'real-player-id');
    assertEquals(manualSlot.isConnected, true);
    assertEquals(manualSlot.peerId, 'peer-1');
  });

  await t.step('updates existing disconnected participant on rejoin', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Add existing disconnected participant (peerId must be null or different)
    store.addParticipant({
      id: 'returning-user',
      name: 'OldName',
      peerId: null, // No active peer connection
      isConnected: false,
      seed: 1,
    });

    // Same user rejoins with new peer
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
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

// =============================================================================
// PARTICIPANT_UPDATE Tests
// =============================================================================

Deno.test('PARTICIPANT_UPDATE handler', testOpts, async (t) => {
  await t.step('updates participant data', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    store.addParticipant({ id: 'user-1', name: 'OldName', seed: 1, peerId: 'peer-1' });

    // First establish the peerId mapping via JOIN
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'OldName',
      localUserId: 'user-1',
    }, 'peer-1');

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      name: 'NewName',
    }, 'peer-1');

    assertEquals(store.getParticipant('user-1').name, 'NewName');
  });

  await t.step('admin can update any participant by ID', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsAdmin(adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    store.addParticipant({ id: adminId, name: 'Admin', seed: 1, peerId: 'admin-peer' });
    store.addParticipant({ id: 'user-1', name: 'Player1', seed: 2 });

    // Establish admin mapping
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Admin',
      localUserId: adminId,
    }, 'admin-peer');

    // Admin updates another participant
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      id: 'user-1',
      name: 'UpdatedByAdmin',
    }, 'admin-peer');

    assertEquals(store.getParticipant('user-1').name, 'UpdatedByAdmin');
  });

  await t.step('creates participant if not exists with name in payload', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Update for non-existent user with name
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      name: 'NewPlayer',
      localUserId: 'new-user',
    }, 'peer-1');

    const participant = store.getParticipant('new-user');
    assert(participant !== undefined);
    assertEquals(participant.name, 'NewPlayer');
  });

  await t.step('rejects invalid payload', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    store.addParticipant({ id: 'user-1', name: 'Player', seed: 1, peerId: 'peer-1' });

    // Establish mapping
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player',
      localUserId: 'user-1',
    }, 'peer-1');

    // Try to update with invalid field (but validator might still allow valid fields)
    // The validator rejects payloads that don't have valid structure
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      name: '', // Empty name is invalid
    }, 'peer-1');

    // Name should still be 'Player' since empty name is rejected
    assertEquals(store.getParticipant('user-1').name, 'Player');
  });
});

// =============================================================================
// PARTICIPANT_LEAVE Tests
// =============================================================================

Deno.test('PARTICIPANT_LEAVE handler', testOpts, async (t) => {
  await t.step('marks participant as disconnected on voluntary leave', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    store.addParticipant({ id: 'user-1', name: 'Player', seed: 1, peerId: 'peer-1', isConnected: true });

    // Establish mapping
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player',
      localUserId: 'user-1',
    }, 'peer-1');

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_LEAVE, {}, 'peer-1');

    assertEquals(store.getParticipant('user-1').isConnected, false);
  });

  await t.step('admin can remove other participants', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('participant-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    store.addParticipant({ id: 'user-1', name: 'ToRemove', seed: 2 });

    // Establish admin mapping via STATE_RESPONSE
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId } },
      isAdmin: true,
    }, 'admin-peer');

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_LEAVE, {
      removedId: 'user-1',
    }, 'admin-peer');

    assertEquals(store.getParticipant('user-1'), undefined);
  });

  await t.step('rejects non-admin removal attempt', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    store.addParticipant({ id: 'user-2', name: 'Target', seed: 1 });

    // Establish non-admin mapping
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'User1',
      localUserId: 'user-1',
    }, 'peer-1');

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_LEAVE, {
      removedId: 'user-2',
    }, 'peer-1');

    // Target should still exist
    assert(store.getParticipant('user-2') !== undefined);
  });
});

// =============================================================================
// TOURNAMENT_START Tests
// =============================================================================

Deno.test('TOURNAMENT_START handler', testOpts, async (t) => {
  await t.step('rejects tournament start from non-admin', async () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Establish non-admin mapping
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'User1',
      localUserId: 'user-1',
    }, 'peer-1');

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    await mockRoom.simulateAction(ActionTypes.TOURNAMENT_START, {
      bracket,
      matches: Array.from(bracket.matches.entries()),
    }, 'peer-1');

    // Status should remain lobby
    assertNotEquals(store.get('meta.status'), 'active');
  });

  await t.step('accepts tournament start from admin', async () => {
    resetSyncState();
    const adminId = 'admin-123';
    // Set up as admin so we don't trigger the navigation (which requires window)
    setupAsAdmin(adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Establish admin mapping via STATE_RESPONSE
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId } },
      isAdmin: true,
    }, 'admin-peer');

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    await mockRoom.simulateAction(ActionTypes.TOURNAMENT_START, {
      bracket,
      matches: Array.from(bracket.matches.entries()),
    }, 'admin-peer');

    assertEquals(store.get('meta.status'), 'active');
    assertEquals(store.get('meta.type'), 'single');
    assert(store.get('bracket') !== null);
  });
});

// =============================================================================
// TOURNAMENT_RESET Tests
// =============================================================================

Deno.test('TOURNAMENT_RESET handler', testOpts, async (t) => {
  await t.step('resets tournament state when called by admin', async () => {
    resetSyncState();
    const adminId = 'admin-123';
    // Set up as admin so we don't trigger the navigation (which requires window)
    setupAsAdmin(adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Establish admin mapping via STATE_RESPONSE
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId } },
      isAdmin: true,
    }, 'admin-peer');

    // Set up active tournament
    store.set('meta.status', 'active');
    store.set('bracket', { type: 'single', rounds: [] });

    await mockRoom.simulateAction(ActionTypes.TOURNAMENT_RESET, {}, 'admin-peer');

    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.get('bracket'), null);
  });

  await t.step('rejects reset from non-admin', async () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Establish non-admin mapping
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'User1',
      localUserId: 'user-1',
    }, 'peer-1');

    store.set('meta.status', 'active');

    await mockRoom.simulateAction(ActionTypes.TOURNAMENT_RESET, {}, 'peer-1');

    // Should still be active
    assertEquals(store.get('meta.status'), 'active');
  });
});

// =============================================================================
// MATCH_RESULT Tests
// =============================================================================

Deno.test('MATCH_RESULT handler', testOpts, async (t) => {
  await t.step('accepts valid result from participant', () => {
    resetSyncState();
    markStateInitialized();
    const adminId = 'admin-123';
    setupAsAdmin(adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });
    store.set('meta.status', 'active');
    store.set('meta.type', 'single');

    // Establish mapping for participant
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player 1',
      localUserId: 'player-1',
    }, 'peer-1');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);
    const winnerId = match.participants[0];

    mockRoom.simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [2, 1],
      winnerId,
      reportedAt: Date.now(),
      version: 1,
    }, 'peer-1');

    assertEquals(store.getMatch(matchId).winnerId, winnerId);
  });

  await t.step('rejects result with invalid winnerId', () => {
    resetSyncState();
    markStateInitialized();
    const adminId = 'admin-123';
    setupAsAdmin(adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });
    store.set('meta.status', 'active');

    // Establish mapping
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player 1',
      localUserId: 'player-1',
    }, 'peer-1');

    const matchId = 'r1m0';

    mockRoom.simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [2, 1],
      winnerId: 'not-in-match',
      reportedAt: Date.now(),
    }, 'peer-1');

    // Should not be updated
    assertEquals(store.getMatch(matchId).winnerId, null);
  });

  await t.step('rejects result from non-participant non-admin', () => {
    resetSyncState();
    markStateInitialized();
    const adminId = 'admin-123';
    setupAsAdmin(adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });
    store.set('meta.status', 'active');

    // Establish mapping for an outsider
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Outsider',
      localUserId: 'outsider',
    }, 'peer-outsider');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);

    mockRoom.simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [2, 1],
      winnerId: match.participants[0],
      reportedAt: Date.now(),
    }, 'peer-outsider');

    // Should not be updated
    assertEquals(store.getMatch(matchId).winnerId, null);
  });

  await t.step('ignores result before state initialized for non-admin', () => {
    resetSyncState();
    // Don't call markStateInitialized()
    const adminId = 'admin-123';
    setupAsParticipant('player-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player 1',
      localUserId: 'player-1',
    }, 'peer-1');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);

    mockRoom.simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [2, 1],
      winnerId: match.participants[0],
      reportedAt: Date.now(),
    }, 'peer-1');

    // Should be ignored
    assertEquals(store.getMatch(matchId).winnerId, null);
  });

  await t.step('protects verified match from non-admin overwrite', () => {
    resetSyncState();
    markStateInitialized();
    const adminId = 'admin-123';
    setupAsAdmin(adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });
    store.set('meta.status', 'active');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);
    const originalWinner = match.participants[0];

    // Admin verifies the match
    store.updateMatch(matchId, {
      winnerId: originalWinner,
      scores: [2, 0],
      verifiedBy: adminId,
    });

    // Participant tries to change it
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player 2',
      localUserId: match.participants[1],
    }, 'peer-2');

    mockRoom.simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [0, 2],
      winnerId: match.participants[1],
      reportedAt: Date.now() + 1000,
      version: 2,
    }, 'peer-2');

    // Should still have original winner
    assertEquals(store.getMatch(matchId).winnerId, originalWinner);
  });
});

// =============================================================================
// MATCH_VERIFY Tests
// =============================================================================

Deno.test('MATCH_VERIFY handler', testOpts, async (t) => {
  await t.step('admin can verify match', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('participant-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });

    // Establish admin mapping via STATE_RESPONSE
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId } },
      isAdmin: true,
    }, 'admin-peer');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);
    const winnerId = match.participants[0];

    mockRoom.simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId,
      scores: [2, 0],
      winnerId,
    }, 'admin-peer');

    assertEquals(store.getMatch(matchId).winnerId, winnerId);
    assertEquals(store.getMatch(matchId).verifiedBy, adminId);
  });

  await t.step('rejects verify from non-admin', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'User1',
      localUserId: 'user-1',
    }, 'peer-1');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);

    mockRoom.simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId,
      scores: [2, 0],
      winnerId: match.participants[0],
    }, 'peer-1');

    // Should not be verified
    assertEquals(store.getMatch(matchId).verifiedBy, null);
  });
});

// =============================================================================
// STANDINGS_UPDATE Tests
// =============================================================================

Deno.test('STANDINGS_UPDATE handler', testOpts, async (t) => {
  await t.step('admin can update standings', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('participant-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Establish admin mapping via STATE_RESPONSE
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId } },
      isAdmin: true,
    }, 'admin-peer');

    const standings = [
      ['player-1', { name: 'P1', points: 15, wins: 1, gamesCompleted: 1 }],
      ['player-2', { name: 'P2', points: 12, wins: 0, gamesCompleted: 1 }],
    ];

    mockRoom.simulateAction(ActionTypes.STANDINGS_UPDATE, { standings }, 'admin-peer');

    assertEquals(store.get('standings').size, 2);
    assertEquals(store.get('standings').get('player-1').points, 15);
  });

  await t.step('rejects standings update from non-admin', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'User1',
      localUserId: 'user-1',
    }, 'peer-1');

    mockRoom.simulateAction(ActionTypes.STANDINGS_UPDATE, {
      standings: [['player-1', { points: 100 }]],
    }, 'peer-1');

    // Should not be updated
    assertEquals(store.get('standings').size, 0);
  });
});

// =============================================================================
// VERSION_CHECK Tests
// =============================================================================

Deno.test('VERSION_CHECK handler', testOpts, async (t) => {
  await t.step('requests sync when behind on version', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);
    store.set('meta.version', 5);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);
    mockRoom._clearMessages();

    mockRoom.simulateAction(ActionTypes.VERSION_CHECK, { version: 10 }, 'admin-peer');

    // Should send state request
    const stateRequest = mockRoom._sentMessages.find(m => m.actionType === ActionTypes.STATE_REQUEST);
    assert(stateRequest !== undefined);
    assertEquals(stateRequest.peerId, 'admin-peer');
  });

  await t.step('does not request sync when version is current', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);
    store.set('meta.version', 10);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);
    mockRoom._clearMessages();

    mockRoom.simulateAction(ActionTypes.VERSION_CHECK, { version: 10 }, 'admin-peer');

    // Should not send state request
    const stateRequest = mockRoom._sentMessages.find(m => m.actionType === ActionTypes.STATE_REQUEST);
    assertEquals(stateRequest, undefined);
  });
});

// =============================================================================
// Peer Join/Leave Tests
// =============================================================================

Deno.test('Peer join/leave handlers', testOpts, async (t) => {
  await t.step('marks participant connected on peer join', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Establish mapping first
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player',
      localUserId: 'player-1',
    }, 'peer-1');

    // Set disconnected
    store.updateParticipant('player-1', { isConnected: false });

    // Peer rejoins
    mockRoom.simulatePeerJoin('peer-1');

    assertEquals(store.getParticipant('player-1').isConnected, true);
  });

  await t.step('marks participant disconnected on peer leave', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Establish mapping
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player',
      localUserId: 'player-1',
    }, 'peer-1');
    mockRoom._setPeers(['peer-1']);

    assertEquals(store.getParticipant('player-1').isConnected, true);

    mockRoom.simulatePeerLeave('peer-1');

    assertEquals(store.getParticipant('player-1').isConnected, false);
  });

  await t.step('requests state from new peer', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);
    mockRoom._clearMessages();

    mockRoom.simulatePeerJoin('new-peer');

    const stateRequest = mockRoom._sentMessages.find(m => m.actionType === ActionTypes.STATE_REQUEST);
    assert(stateRequest !== undefined);
    assertEquals(stateRequest.peerId, 'new-peer');
  });

  await t.step('re-announces self on peer join', () => {
    resetSyncState();
    setupAsAdmin('admin-123');
    store.set('local.name', 'Admin');

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);
    mockRoom._clearMessages();

    mockRoom.simulatePeerJoin('new-peer');

    const joinBroadcast = mockRoom._broadcasts.find(b => b.actionType === ActionTypes.PARTICIPANT_JOIN);
    assert(joinBroadcast !== undefined);
    assertEquals(joinBroadcast.payload.localUserId, 'admin-123');
  });
});

// =============================================================================
// advanceWinner Tests
// =============================================================================

Deno.test('advanceWinner - Single Elimination', testOpts, async (t) => {
  await t.step('advances winner to next round', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);
    const winnerId = match.participants[0];

    advanceWinner(matchId, winnerId);

    // Finals should have the winner in slot 0
    const finals = store.getMatch('r2m0');
    assertEquals(finals.participants[0], winnerId);
  });

  await t.step('sets tournament complete after finals', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const participants = createParticipants(2);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });
    store.set('meta.status', 'active');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);
    const winnerId = match.participants[0];

    advanceWinner(matchId, winnerId);

    assertEquals(store.get('meta.status'), 'complete');
  });

  await t.step('handles missing bracket gracefully', () => {
    resetSyncState();
    setupAsAdmin('admin-123');
    store.set('bracket', null);

    // Should not throw
    advanceWinner('r1m0', 'player-1');
  });
});

Deno.test('advanceWinner - Double Elimination', testOpts, async (t) => {
  await t.step('advances winner in winners bracket', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const participants = createParticipants(4);
    const bracket = generateDoubleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });

    // Find first winners bracket match
    const winnersMatch = bracket.winners.rounds[0].matches[0];
    const winnerId = winnersMatch.participants[0];

    advanceWinner(winnersMatch.id, winnerId);

    // Winner should advance in winners bracket
    const nextWinnersMatch = store.get('bracket').winners.rounds[1].matches[0];
    assert(nextWinnersMatch.participants.includes(winnerId) || store.getMatch(nextWinnersMatch.id).participants.includes(winnerId));
  });

  await t.step('drops loser to losers bracket', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const participants = createParticipants(4);
    const bracket = generateDoubleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });

    const winnersMatch = bracket.winners.rounds[0].matches[0];
    const winnerId = winnersMatch.participants[0];
    const loserId = winnersMatch.participants[1];

    advanceWinner(winnersMatch.id, winnerId);

    // Loser should be in losers bracket
    const losersMatches = store.get('bracket').losers.rounds.flatMap(r => r.matches);
    const loserInLosers = losersMatches.some(m => {
      const matchData = store.getMatch(m.id);
      return matchData?.participants?.includes(loserId) || m.participants?.includes(loserId);
    });
    assert(loserInLosers, 'Loser should be dropped to losers bracket');
  });
});

// =============================================================================
// Exported Helper Functions Tests
// =============================================================================

Deno.test('announceJoin', testOpts, async (t) => {
  await t.step('broadcasts participant join', () => {
    const mockRoom = createMockRoom();
    mockRoom._clearMessages();

    announceJoin(mockRoom, 'TestPlayer', 'user-123');

    assertEquals(mockRoom._broadcasts.length, 1);
    assertEquals(mockRoom._broadcasts[0].actionType, ActionTypes.PARTICIPANT_JOIN);
    assertEquals(mockRoom._broadcasts[0].payload.name, 'TestPlayer');
    assertEquals(mockRoom._broadcasts[0].payload.localUserId, 'user-123');
    assert(mockRoom._broadcasts[0].payload.joinedAt !== undefined);
  });
});

Deno.test('reportMatchResult', testOpts, async (t) => {
  await t.step('broadcasts match result', () => {
    resetSyncState();
    setupAsAdmin('admin-123');
    store.set('meta.version', 5);

    const mockRoom = createMockRoom();
    mockRoom._clearMessages();

    reportMatchResult(mockRoom, 'match-1', [2, 1], 'player-1');

    assertEquals(mockRoom._broadcasts.length, 1);
    assertEquals(mockRoom._broadcasts[0].actionType, ActionTypes.MATCH_RESULT);
    assertEquals(mockRoom._broadcasts[0].payload.matchId, 'match-1');
    assertEquals(mockRoom._broadcasts[0].payload.winnerId, 'player-1');
    assertEquals(mockRoom._broadcasts[0].payload.version, 5);
  });
});

Deno.test('startTournament', testOpts, async (t) => {
  await t.step('broadcasts tournament start when admin', () => {
    resetSyncState();
    setupAsAdmin('admin-123');

    const mockRoom = createMockRoom();
    mockRoom._clearMessages();

    const bracket = { type: 'single', rounds: [] };
    const matches = new Map([['m1', { id: 'm1', participants: [] }]]);

    startTournament(mockRoom, bracket, matches);

    assertEquals(mockRoom._broadcasts.length, 1);
    assertEquals(mockRoom._broadcasts[0].actionType, ActionTypes.TOURNAMENT_START);
    assertEquals(mockRoom._broadcasts[0].payload.bracket, bracket);
  });

  await t.step('does not broadcast when not admin', () => {
    resetSyncState();
    setupAsParticipant('user-1', 'admin-123');

    const mockRoom = createMockRoom();
    mockRoom._clearMessages();

    startTournament(mockRoom, {}, new Map());

    assertEquals(mockRoom._broadcasts.length, 0);
  });
});

Deno.test('reportRaceResult', testOpts, async (t) => {
  await t.step('broadcasts race result', () => {
    const mockRoom = createMockRoom();
    mockRoom._clearMessages();

    const results = [
      { participantId: 'p1', position: 1 },
      { participantId: 'p2', position: 2 },
    ];

    reportRaceResult(mockRoom, 'game-1', results);

    assertEquals(mockRoom._broadcasts.length, 1);
    assertEquals(mockRoom._broadcasts[0].actionType, ActionTypes.RACE_RESULT);
    assertEquals(mockRoom._broadcasts[0].payload.gameId, 'game-1');
    assertEquals(mockRoom._broadcasts[0].payload.results, results);
  });
});

Deno.test('markStateInitialized and resetSyncState', testOpts, async (t) => {
  await t.step('markStateInitialized allows match results to be processed', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('player-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });
    store.set('meta.status', 'active');

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_JOIN, {
      name: 'Player 1',
      localUserId: 'player-1',
    }, 'peer-1');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);

    // Before initialization - should be ignored
    mockRoom.simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [2, 1],
      winnerId: match.participants[0],
      reportedAt: Date.now(),
    }, 'peer-1');

    assertEquals(store.getMatch(matchId).winnerId, null);

    // After initialization - should be processed
    markStateInitialized();

    mockRoom.simulateAction(ActionTypes.MATCH_RESULT, {
      matchId,
      scores: [2, 1],
      winnerId: match.participants[0],
      reportedAt: Date.now(),
    }, 'peer-1');

    assertEquals(store.getMatch(matchId).winnerId, match.participants[0]);
  });
});
