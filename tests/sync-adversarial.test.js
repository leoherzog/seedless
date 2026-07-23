/**
 * Adversarial / security regression tests for the sync layer.
 *
 * These tests exercise malicious or malformed network input that the
 * happy-path handler tests (sync-handlers.test.js) never reach:
 *   - admin impersonation via a self-declared `isAdmin` flag
 *   - admin identity theft via a forged `payload.localUserId`
 *   - malformed/garbage payloads sent to hardened handlers
 *   - invalid-shape MATCH_VERIFY payloads
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import {
  setupStateSync,
  resetSyncState,
  markStateInitialized,
} from '../js/network/sync.js';
import { ActionTypes } from '../js/network/room.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { createParticipants } from './fixtures.js';

// setupStateSync registers a heartbeat interval; disable op/resource sanitizers
// the same way sync-handlers.test.js does.
const testOpts = { sanitizeOps: false, sanitizeResources: false };

/**
 * Mock room mirroring the one in sync-handlers.test.js: captures handlers
 * registered by setupStateSync and lets tests simulate inbound actions from
 * arbitrary (including malicious) peerIds.
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
  };
}

function setupAsAdmin(adminId) {
  store.reset();
  store.set('meta.adminId', adminId);
  store.set('local.localUserId', adminId);
  store.set('local.name', 'Admin');
  store.setAdmin(true);
}

function setupAsParticipant(userId, adminId) {
  store.reset();
  store.set('meta.adminId', adminId);
  store.set('local.localUserId', userId);
  store.set('local.name', 'Participant');
  store.setAdmin(false);
}

// =============================================================================
// (1) IMPERSONATION via STATE_RESPONSE isAdmin:true
// =============================================================================

Deno.test('STATE_RESPONSE admin impersonation', testOpts, async (t) => {
  await t.step('does not grant admin authority to a peer merely echoing adminId while the real admin peer is active', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);

    const mockRoom = createMockRoom();
    mockRoom._setPeers(['admin-peer']);
    setupStateSync(mockRoom);

    store.set('bracket', { type: 'known-good' });

    // First, the REAL admin peer establishes its mapping (trust-on-first-use,
    // no active admin peer yet).
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby', version: 1 } },
      isAdmin: true,
    }, 'admin-peer');

    // Now a DIFFERENT peer (malicious) sends a STATE_RESPONSE that echoes the
    // same adminId and sets isAdmin:true, along with a forged bracket that
    // would only apply if the sender were trusted as admin.
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: {
        meta: { adminId, status: 'lobby', version: 1 },
        bracket: { type: 'evil-forged-bracket' },
      },
      isAdmin: true,
    }, 'malicious-peer');

    // The forged bracket must NOT have been applied - the malicious peer was
    // never granted admin authority because 'admin-peer' is still the active
    // admin peer.
    assertEquals(store.get('bracket').type, 'known-good');
  });

  await t.step('admin-gated action from the impersonating peer is still rejected', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);

    const mockRoom = createMockRoom();
    mockRoom._setPeers(['admin-peer']);
    setupStateSync(mockRoom);

    // Establish the real admin mapping.
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby', version: 1 } },
      isAdmin: true,
    }, 'admin-peer');

    // Malicious peer tries to claim admin via a self-declared isAdmin flag.
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby', version: 1 } },
      isAdmin: true,
    }, 'malicious-peer');

    // If the impersonation had succeeded, the peerId -> adminId mapping would
    // let this TOURNAMENT_START (admin-only) succeed from 'malicious-peer'.
    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    mockRoom.simulateAction(ActionTypes.TOURNAMENT_START, {
      bracket,
      matches: Array.from(bracket.matches.entries()),
    }, 'malicious-peer');

    assertEquals(store.get('meta.status'), 'lobby');
  });

  await t.step('trust-on-first-use still works when no admin peer is active yet', () => {
    // Sanity check: the fix should not break legitimate first-sync bootstrap.
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby', version: 1 }, bracket: { type: 'real' } },
      isAdmin: true,
    }, 'admin-peer');

    assertEquals(store.get('bracket').type, 'real');
  });
});

// =============================================================================
// (2) PARTICIPANT_UPDATE forged admin identity claim
// =============================================================================

Deno.test('PARTICIPANT_UPDATE admin identity theft', testOpts, async (t) => {
  await t.step('rejects payload.localUserId claiming the admin id from an unmapped peer', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);
    store.addParticipant({ id: adminId, name: 'RealAdmin', seed: 1 });

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Attacker peer has no established mapping and claims to BE the admin.
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      localUserId: adminId,
      name: 'Hijacked',
    }, 'attacker-peer');

    // The real admin's participant record must be untouched.
    assertEquals(store.getParticipant(adminId).name, 'RealAdmin');
  });

  await t.step('does not cache the attacker peer as the admin mapping', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    // Attempted identity theft.
    mockRoom.simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      localUserId: adminId,
      name: 'Hijacked',
    }, 'attacker-peer');

    // If the attacker's peerId had been cached as mapping to adminId, this
    // admin-gated TOURNAMENT_START would succeed from 'attacker-peer'.
    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    mockRoom.simulateAction(ActionTypes.TOURNAMENT_START, {
      bracket,
      matches: Array.from(bracket.matches.entries()),
    }, 'attacker-peer');

    assertEquals(store.get('meta.status'), 'lobby');
  });

  await t.step('still allows a genuine unmapped peer to establish a non-admin identity via localUserId', () => {
    // Sanity check: the fix should only block claims of the admin id, not the
    // general "establish mapping from payload.localUserId" fallback.
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('user-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    mockRoom.simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      localUserId: 'honest-user',
      name: 'Honest',
    }, 'honest-peer');

    const participant = store.getParticipant('honest-user');
    assert(participant !== undefined);
    assertEquals(participant.name, 'Honest');
  });
});

// =============================================================================
// (3) MALFORMED PAYLOADS must not throw
// =============================================================================

Deno.test('Malformed payloads do not throw', testOpts, async (t) => {
  const malformedPayloads = [null, 'just-a-string', {}, 42, [], undefined];

  const hardenedActions = [
    ActionTypes.PARTICIPANT_LEAVE,
    ActionTypes.TOURNAMENT_START,
    ActionTypes.MATCH_VERIFY,
    ActionTypes.STANDINGS_UPDATE,
    ActionTypes.RACE_RESULT,
    ActionTypes.VERSION_CHECK,
  ];

  for (const actionType of hardenedActions) {
    await t.step(`${actionType} handler survives all malformed payload shapes`, async () => {
      resetSyncState();
      const adminId = 'admin-123';
      setupAsAdmin(adminId);

      const mockRoom = createMockRoom();
      setupStateSync(mockRoom);

      for (const bad of malformedPayloads) {
        let threw = false;
        try {
          // Handlers may be async (PARTICIPANT_LEAVE, TOURNAMENT_START,
          // RACE_RESULT); await the result so rejections surface too.
          await mockRoom.simulateAction(actionType, bad, 'some-peer');
        } catch (_e) {
          threw = true;
        }
        assert(!threw, `${actionType} threw on malformed payload: ${JSON.stringify(bad)}`);
      }
    });
  }

  await t.step('store remains in a sane state after a barrage of malformed input', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsAdmin(adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);

    for (const actionType of hardenedActions) {
      for (const bad of malformedPayloads) {
        mockRoom.simulateAction(actionType, bad, 'some-peer');
      }
    }

    // Nothing should have been mutated into an unusable state.
    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.get('meta.adminId'), adminId);
  });
});

// =============================================================================
// (4) MATCH_VERIFY invalid shape is ignored, not applied
// =============================================================================

Deno.test('MATCH_VERIFY invalid shape', testOpts, async (t) => {
  function setupActiveBracket(adminId) {
    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });
    store.set('meta.status', 'active');
    return bracket;
  }

  await t.step('ignores non-numeric scores from admin', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('participant-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);
    const bracket = setupActiveBracket(adminId);

    // Establish admin mapping.
    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId } },
      isAdmin: true,
    }, 'admin-peer');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);
    const winnerId = match.participants[0];

    mockRoom.simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId,
      scores: ['not', 'numbers'],
      winnerId,
    }, 'admin-peer');

    const after = store.getMatch(matchId);
    assertEquals(after.winnerId, null);
    assertEquals(after.verifiedBy, null);
  });

  await t.step('ignores non-string winnerId from admin', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('participant-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);
    setupActiveBracket(adminId);

    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId } },
      isAdmin: true,
    }, 'admin-peer');

    const matchId = 'r1m0';

    mockRoom.simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId,
      scores: [2, 0],
      winnerId: 12345, // not a string
    }, 'admin-peer');

    const after = store.getMatch(matchId);
    assertEquals(after.winnerId, null);
    assertEquals(after.verifiedBy, null);
  });

  await t.step('ignores an invalid matchId shape from admin', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('participant-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);
    setupActiveBracket(adminId);

    mockRoom.simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId } },
      isAdmin: true,
    }, 'admin-peer');

    const matchId = 'r1m0';
    const match = store.getMatch(matchId);
    const winnerId = match.participants[0];

    mockRoom.simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId: 12345, // not a string
      scores: [2, 0],
      winnerId,
    }, 'admin-peer');

    const after = store.getMatch(matchId);
    assertEquals(after.winnerId, null);
    assertEquals(after.verifiedBy, null);
  });

  await t.step('a well-formed MATCH_VERIFY from admin is still applied (sanity check)', () => {
    resetSyncState();
    const adminId = 'admin-123';
    setupAsParticipant('participant-1', adminId);

    const mockRoom = createMockRoom();
    setupStateSync(mockRoom);
    setupActiveBracket(adminId);

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

    const after = store.getMatch(matchId);
    assertEquals(after.winnerId, winnerId);
    assertEquals(after.verifiedBy, adminId);
  });
});
