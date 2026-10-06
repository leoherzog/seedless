/**
 * Malicious and malformed network input against the sync handlers: admin
 * impersonation through isAdmin or a forged localUserId, garbage payloads,
 * and invalid MATCH_VERIFY shapes.
 */

import { assertEquals } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { ActionTypes } from '../js/network/room.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { createParticipants } from './fixtures.js';
import { connectAs, mapAdmin } from './sync-fixtures.js';

// setupStateSync starts a heartbeat interval.
const testOpts = { sanitizeOps: false, sanitizeResources: false };

Deno.test('STATE_RESPONSE admin impersonation', testOpts, async (t) => {
  await t.step('does not grant admin authority to a peer merely echoing adminId while the real admin peer is active', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId, peers: ['admin-peer'] });

    store.set('bracket', { type: 'known-good' });

    // The real admin peer maps first: no admin peer is active yet.
    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby', version: 1 } },
      isAdmin: true,
    }, 'admin-peer');

    // A different peer echoes adminId with isAdmin:true and a bracket that
    // only applies if the sender is trusted as admin.
    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: {
        meta: { adminId, status: 'lobby', version: 1 },
        bracket: { type: 'evil-forged-bracket' },
      },
      isAdmin: true,
    }, 'malicious-peer');

    assertEquals(store.get('bracket').type, 'known-good');
  });

  await t.step('admin-gated action from the impersonating peer is still rejected', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId, peers: ['admin-peer'] });

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby', version: 1 } },
      isAdmin: true,
    }, 'admin-peer');

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby', version: 1 } },
      isAdmin: true,
    }, 'malicious-peer');

    // A peerId -> adminId mapping for malicious-peer would let this admin-only start through.
    const bracket = generateSingleEliminationBracket(createParticipants(4));

    mockRoom._simulateAction(ActionTypes.TOURNAMENT_START, {
      bracket,
      matches: Array.from(bracket.matches.entries()),
    }, 'malicious-peer');

    assertEquals(store.get('meta.status'), 'lobby');
  });

  await t.step('trust-on-first-use still works when no admin peer is active yet', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId });

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby', version: 1 }, bracket: { type: 'real' } },
      isAdmin: true,
    }, 'admin-peer');

    assertEquals(store.get('bracket').type, 'real');
  });
});

Deno.test('PARTICIPANT_UPDATE admin identity theft', testOpts, async (t) => {
  await t.step('rejects payload.localUserId claiming the admin id from an unmapped peer', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId });
    store.addParticipant({ id: adminId, name: 'RealAdmin', seed: 1 });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      localUserId: adminId,
      name: 'Hijacked',
    }, 'attacker-peer');

    assertEquals(store.getParticipant(adminId).name, 'RealAdmin');
  });

  await t.step('does not cache the attacker peer as the admin mapping', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, {
      localUserId: adminId,
      name: 'Hijacked',
    }, 'attacker-peer');

    // A cached attacker-peer -> adminId mapping would let this admin-only start through.
    const bracket = generateSingleEliminationBracket(createParticipants(4));

    mockRoom._simulateAction(ActionTypes.TOURNAMENT_START, {
      bracket,
      matches: Array.from(bracket.matches.entries()),
    }, 'attacker-peer');

    assertEquals(store.get('meta.status'), 'lobby');
  });
});

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
      const mockRoom = connectAs({ userId: 'admin-123', adminId: 'admin-123' });

      for (const bad of malformedPayloads) {
        await mockRoom._simulateAction(actionType, bad, 'some-peer');
      }
    });
  }

  await t.step('store remains in a sane state after a barrage of malformed input', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: adminId, adminId });

    for (const actionType of hardenedActions) {
      for (const bad of malformedPayloads) {
        mockRoom._simulateAction(actionType, bad, 'some-peer');
      }
    }

    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.get('meta.adminId'), adminId);
  });
});

Deno.test('MATCH_VERIFY invalid shape', testOpts, async (t) => {
  const adminId = 'admin-123';

  /** Connect as a participant with an active 4-player bracket and the admin mapped. */
  function setupActiveBracket() {
    const mockRoom = connectAs({ userId: 'participant-1', adminId });
    const bracket = generateSingleEliminationBracket(createParticipants(4));
    store.set('bracket', bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });
    store.set('meta.status', 'active');
    mapAdmin(mockRoom, adminId);
    return mockRoom;
  }

  await t.step('ignores non-numeric scores from admin', () => {
    const mockRoom = setupActiveBracket();

    const matchId = 'r1m0';
    const winnerId = store.getMatch(matchId).participants[0];

    mockRoom._simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId,
      scores: ['not', 'numbers'],
      winnerId,
    }, 'admin-peer');

    const after = store.getMatch(matchId);
    assertEquals(after.winnerId, null);
    assertEquals(after.verifiedBy, null);
  });

  await t.step('ignores non-string winnerId from admin', () => {
    const mockRoom = setupActiveBracket();

    const matchId = 'r1m0';

    mockRoom._simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId,
      scores: [2, 0],
      winnerId: 12345,
    }, 'admin-peer');

    const after = store.getMatch(matchId);
    assertEquals(after.winnerId, null);
    assertEquals(after.verifiedBy, null);
  });

  await t.step('ignores an invalid matchId shape from admin', () => {
    const mockRoom = setupActiveBracket();

    const matchId = 'r1m0';
    const winnerId = store.getMatch(matchId).participants[0];

    mockRoom._simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId: 12345,
      scores: [2, 0],
      winnerId,
    }, 'admin-peer');

    const after = store.getMatch(matchId);
    assertEquals(after.winnerId, null);
    assertEquals(after.verifiedBy, null);
  });
});
