/**
 * Malicious and malformed network input against the sync handlers: admin
 * impersonation through isAdmin, a forged identity or a forged synced peerId,
 * garbage payloads, and invalid MATCH_VERIFY shapes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../js/state/store.js';
import { ActionTypes, joinRoom, leaveRoom } from '../js/network/room.js';
import { setupStateSync, resetSyncState } from '../js/network/sync.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { createParticipants } from './fixtures.js';
import { connectAs, mapAdmin } from './sync-fixtures.js';
import { _getLastRoom } from './mocks/trystero-mock.js';

test('STATE_RESPONSE admin impersonation', async (t) => {
  await t.test('does not grant admin authority to a peer merely echoing adminId while the real admin peer is active', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId, peers: ['admin-peer'] });

    store.set('bracket', { type: 'known-good', startedAt: 1 });

    // The real admin peer maps first: no admin peer is active yet.
    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby' } },
      isAdmin: true,
    }, 'admin-peer');

    // A different peer echoes adminId with isAdmin:true and a bracket that
    // only applies if the sender is trusted as admin.
    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: {
        meta: { adminId, status: 'lobby' },
        bracket: { type: 'evil-forged-bracket', startedAt: 2 },
      },
      isAdmin: true,
    }, 'malicious-peer');

    assert.deepStrictEqual(store.get('bracket').type, 'known-good');
  });

  await t.test('admin-gated action from the impersonating peer is still rejected', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId, peers: ['admin-peer'] });

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby' } },
      isAdmin: true,
    }, 'admin-peer');

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby' } },
      isAdmin: true,
    }, 'malicious-peer');

    // A peerId -> adminId mapping for malicious-peer would let this admin-only start through.
    const { bracket, matches } = generateSingleEliminationBracket(createParticipants(4));

    mockRoom._simulateAction(ActionTypes.TOURNAMENT_START, {
      bracket,
      matches: Array.from(matches.entries()),
    }, 'malicious-peer');

    assert.deepStrictEqual(store.get('meta.status'), 'lobby');
  });

  await t.test('trust-on-first-use still works when no admin peer is active yet', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId });

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId, status: 'lobby' }, bracket: { type: 'real', startedAt: 1 } },
      isAdmin: true,
    }, 'admin-peer');

    assert.deepStrictEqual(store.get('bracket').type, 'real');
  });

  await t.test('a claim naming a different adminId is rejected', () => {
    const mockRoom = connectAs({ userId: 'user-b', adminId: 'admin-a', peers: ['admin-peer', 'evil'] });
    mapAdmin(mockRoom, 'admin-a');
    store.set('meta.status', 'lobby');

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId: 'invented-admin', status: 'lobby' } },
      isAdmin: true,
    }, 'evil');
    assert.deepStrictEqual(store.get('meta.adminId'), 'admin-a');

    // The claimant gets no authority, and the real admin keeps its own.
    const { bracket, matches } = generateSingleEliminationBracket(createParticipants(4));
    const start = { bracket, matches: Array.from(matches.entries()) };
    mockRoom._simulateAction(ActionTypes.TOURNAMENT_START, start, 'evil');
    assert.deepStrictEqual(store.get('meta.status'), 'lobby');
    mockRoom._simulateAction(ActionTypes.TOURNAMENT_START, start, 'admin-peer');
    assert.deepStrictEqual(store.get('meta.status'), 'active');
  });

  await t.test("the admin trusts no peer's admin claim, even one naming the admin", () => {
    const adminId = 'admin-1';
    const mockRoom = connectAs({ userId: adminId, adminId, peers: ['evil'] });
    store.set('meta.name', 'Cup');
    const { bracket, matches } = generateSingleEliminationBracket(createParticipants(4));

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: {
        meta: { adminId, name: 'Hijacked', status: 'active' },
        bracket: { ...bracket, startedAt: 1 },
        matches: Array.from(matches.entries()),
      },
      isAdmin: true,
    }, 'evil');

    assert.deepStrictEqual(store.get('meta.name'), 'Cup');
    assert.deepStrictEqual(store.get('meta.status'), 'lobby');
    assert.deepStrictEqual(store.get('bracket'), null);

    store.set('meta.status', 'active');
    mockRoom._simulateAction(ActionTypes.TOURNAMENT_RESET, {}, 'evil');
    assert.deepStrictEqual(store.get('meta.status'), 'active');
  });

  await t.test("a snapshot naming the local user as admin plants nothing", () => {
    const mockRoom = connectAs({ userId: 'victim', adminId: 'admin-1', peers: ['evil'] });

    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { meta: { adminId: 'victim', status: 'active' } },
      isAdmin: true,
    }, 'evil');

    assert.deepStrictEqual(store.get('meta.adminId'), 'admin-1');
  });
});

test('PARTICIPANT_UPDATE from an unmapped peer gets no identity', async (t) => {
  await t.test('cannot rename the admin or any other participant', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId });
    store.addParticipant({ id: adminId, name: 'RealAdmin', seed: 1 });

    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, { localUserId: adminId, name: 'Hijacked' }, 'attacker-peer');
    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, { id: adminId, name: 'Hijacked' }, 'attacker-peer');

    assert.deepStrictEqual(store.getParticipant(adminId).name, 'RealAdmin');
    assert.deepStrictEqual(store.getParticipant('attacker-peer'), undefined);
  });

  await t.test('a forged peerId merged into synced state does not map the sender to the admin', () => {
    const adminId = 'admin-123';
    const mockRoom = connectAs({ userId: 'user-1', adminId });
    store.addParticipant({ id: adminId, name: 'RealAdmin', seed: 1 });
    store.set('meta.status', 'active');

    // A non-admin snapshot still wins participant LWW, so it can plant peerId 'evil' on the admin.
    mockRoom._simulateAction(ActionTypes.STATE_RESPONSE, {
      state: { participants: [[adminId, { id: adminId, name: 'RealAdmin', peerId: 'evil', updatedAt: 9e15 }]] },
      isAdmin: false,
    }, 'evil');
    mockRoom._simulateAction(ActionTypes.PARTICIPANT_UPDATE, { seed: 1 }, 'evil');
    mockRoom._simulateAction(ActionTypes.TOURNAMENT_RESET, {}, 'evil');

    assert.deepStrictEqual(store.get('meta.status'), 'active');
  });
});

test('Malformed payloads do not throw', async (t) => {
  const malformedData = [null, 'just-a-string', 42, [], undefined, {}];
  const malformedPayloads = [null, 'just-a-string', {}, 42, [], undefined];

  /** Run setupStateSync on a room.js connection over the Trystero mock, as admin. */
  async function connectThroughRoomJs() {
    resetSyncState();
    store.reset();
    store.set('meta.adminId', 'admin-123');
    store.set('local.localUserId', 'admin-123');
    store.setAdmin(true);
    setupStateSync(await joinRoom('malformed'));
    return _getLastRoom();
  }

  try {
    await t.test('every action survives malformed data and payload shapes', async () => {
      const trystero = await connectThroughRoomJs();

      for (const type of Object.values(ActionTypes)) {
        for (const bad of malformedData) {
          trystero._simulateMessage(type, bad, 'some-peer');
        }
        for (const bad of malformedPayloads) {
          trystero._simulateMessage(type, { payload: bad }, 'some-peer');
        }
      }

      assert.deepStrictEqual(store.get('meta.status'), 'lobby');
      assert.deepStrictEqual(store.get('meta.adminId'), 'admin-123');
    });
  } finally {
    await leaveRoom();
    resetSyncState();
  }
});

test('MATCH_VERIFY invalid shape', async (t) => {
  const adminId = 'admin-123';

  /** Connect as a participant with an active 4-player bracket and the admin mapped. */
  function setupActiveBracket() {
    const mockRoom = connectAs({ userId: 'participant-1', adminId });
    const { bracket, matches } = generateSingleEliminationBracket(createParticipants(4));
    store.setMatches(matches);
    store.set('bracket', bracket);
    mapAdmin(mockRoom, adminId);
    store.set('meta.status', 'active');
    return mockRoom;
  }

  await t.test('ignores non-numeric scores from admin', () => {
    const mockRoom = setupActiveBracket();

    const matchId = 'r1m0';
    const winnerId = store.getMatch(matchId).participants[0];

    mockRoom._simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId,
      scores: ['not', 'numbers'],
      winnerId,
    }, 'admin-peer');

    const after = store.getMatch(matchId);
    assert.deepStrictEqual(after.winnerId, null);
    assert.deepStrictEqual(after.verifiedBy, null);
  });

  await t.test('ignores non-string winnerId from admin', () => {
    const mockRoom = setupActiveBracket();

    const matchId = 'r1m0';

    mockRoom._simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId,
      scores: [2, 0],
      winnerId: 12345,
    }, 'admin-peer');

    const after = store.getMatch(matchId);
    assert.deepStrictEqual(after.winnerId, null);
    assert.deepStrictEqual(after.verifiedBy, null);
  });

  await t.test('ignores an invalid matchId shape from admin', () => {
    const mockRoom = setupActiveBracket();

    const matchId = 'r1m0';
    const winnerId = store.getMatch(matchId).participants[0];

    mockRoom._simulateAction(ActionTypes.MATCH_VERIFY, {
      matchId: 12345,
      scores: [2, 0],
      winnerId,
    }, 'admin-peer');

    const after = store.getMatch(matchId);
    assert.deepStrictEqual(after.winnerId, null);
    assert.deepStrictEqual(after.verifiedBy, null);
  });
});
