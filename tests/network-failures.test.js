/**
 * Network Failure Scenario Tests
 * Tests peer disconnect, rejoin, and state recovery behaviors
 */

import { assertEquals, assert, assertFalse, assertExists } from 'jsr:@std/assert';
import { Store } from '../js/state/store.js';
import { createParticipants, createMockRoom } from './fixtures.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';

// =============================================================================
// Peer Disconnect Scenarios
// =============================================================================

Deno.test('Peer Disconnect Scenarios', async (t) => {
  await t.step('participant marked disconnected on peer leave', () => {
    const store = new Store();
    store.reset();

    // Add a connected participant
    store.addParticipant({
      id: 'peer-1',
      name: 'Player 1',
      isConnected: true,
    });

    assertEquals(store.getParticipant('peer-1').isConnected, true);

    // Simulate peer leave by updating connection status
    store.updateParticipant('peer-1', { isConnected: false });

    assertEquals(store.getParticipant('peer-1').isConnected, false);
    assertEquals(store.getParticipant('peer-1').name, 'Player 1'); // Name preserved
  });

  await t.step('multiple peers can disconnect independently', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({ id: 'p1', name: 'Player 1', isConnected: true });
    store.addParticipant({ id: 'p2', name: 'Player 2', isConnected: true });
    store.addParticipant({ id: 'p3', name: 'Player 3', isConnected: true });

    // P1 disconnects
    store.updateParticipant('p1', { isConnected: false });

    assertEquals(store.getParticipant('p1').isConnected, false);
    assertEquals(store.getParticipant('p2').isConnected, true);
    assertEquals(store.getParticipant('p3').isConnected, true);

    // P2 disconnects
    store.updateParticipant('p2', { isConnected: false });

    assertEquals(store.getParticipant('p1').isConnected, false);
    assertEquals(store.getParticipant('p2').isConnected, false);
    assertEquals(store.getParticipant('p3').isConnected, true);
  });

  await t.step('disconnected participant data preserved', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({
      id: 'p1',
      name: 'Player 1',
      seed: 1,
      teamId: 'team-1',
      isConnected: true,
    });

    store.updateParticipant('p1', { isConnected: false });

    const p = store.getParticipant('p1');
    assertEquals(p.name, 'Player 1');
    assertEquals(p.seed, 1);
    assertEquals(p.teamId, 'team-1');
  });
});

// =============================================================================
// Peer Rejoin Scenarios
// =============================================================================

Deno.test('Peer Rejoin Scenarios', async (t) => {
  await t.step('reconnecting peer is marked connected again', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({ id: 'p1', name: 'Player 1', isConnected: true });
    store.updateParticipant('p1', { isConnected: false });
    assertEquals(store.getParticipant('p1').isConnected, false);

    // Peer rejoins
    store.addParticipant({ id: 'p1', name: 'Player 1', isConnected: true });

    assertEquals(store.getParticipant('p1').isConnected, true);
  });

  await t.step('rejoin preserves original seed', () => {
    const store = new Store();
    store.reset();

    // Original join with seed 3
    store.addParticipant({ id: 'p1', name: 'Player 1', seed: 3, isConnected: true });
    store.updateParticipant('p1', { isConnected: false });

    // Rejoin without specifying seed
    store.addParticipant({ id: 'p1', name: 'Player 1', isConnected: true });

    // Seed should be preserved from original
    assertEquals(store.getParticipant('p1').seed, 3);
  });

  await t.step('rejoin allows name change', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({ id: 'p1', name: 'Old Name', isConnected: true });
    store.updateParticipant('p1', { isConnected: false });

    // Rejoin with new name
    store.addParticipant({ id: 'p1', name: 'New Name', isConnected: true });

    assertEquals(store.getParticipant('p1').name, 'New Name');
  });
});

// =============================================================================
// State Recovery Scenarios
// =============================================================================

Deno.test('State Recovery Scenarios', async (t) => {
  await t.step('serialized state can be restored after disconnect', () => {
    const store = new Store();
    store.reset();

    // Set up initial state
    store.set('meta.status', 'active');
    store.set('meta.type', 'single');
    store.addParticipant({ id: 'p1', name: 'Player 1' });
    store.addParticipant({ id: 'p2', name: 'Player 2' });

    // Serialize state (as would be done for persistence/sync)
    const serialized = store.serialize();

    // Simulate fresh store after reconnect
    const recoveredStore = new Store();
    recoveredStore.reset();
    recoveredStore.deserialize(serialized);

    assertEquals(recoveredStore.get('meta.status'), 'active');
    assertEquals(recoveredStore.get('meta.type'), 'single');
    assertEquals(recoveredStore.getParticipantList().length, 2);
  });

  await t.step('bracket state preserved across recovery', () => {
    const store = new Store();
    store.reset();

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    store.set('bracket', bracket);
    store.deserialize({
      matches: Array.from(bracket.matches.entries()),
      participants: participants.map(p => [p.id, p]),
    });

    const serialized = store.serialize();

    // Recover in new store
    const recoveredStore = new Store();
    recoveredStore.reset();
    recoveredStore.deserialize(serialized);

    assertExists(recoveredStore.get('bracket'));
    assertEquals(recoveredStore.get('bracket').type, 'single');
    assertEquals(recoveredStore.get('bracket').numRounds, bracket.numRounds);
  });

  await t.step('match results preserved across recovery', () => {
    const store = new Store();
    store.reset();

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    store.set('bracket', bracket);
    store.deserialize({
      matches: Array.from(bracket.matches.entries()),
    });

    // Record a match result
    store.updateMatch('r1m0', {
      winnerId: participants[0].id,
      scores: [2, 1],
      reportedAt: Date.now(),
    });

    const serialized = store.serialize();

    // Recover in new store
    const recoveredStore = new Store();
    recoveredStore.reset();
    recoveredStore.deserialize(serialized);

    const match = recoveredStore.getMatch('r1m0');
    assertEquals(match.winnerId, participants[0].id);
    assertEquals(match.scores[0], 2);
    assertEquals(match.scores[1], 1);
  });
});

// =============================================================================
// Message Timing Edge Cases
// =============================================================================

Deno.test('Message Timing Edge Cases', async (t) => {
  await t.step('delayed messages handled via merge', () => {
    const store = new Store();
    store.reset();

    // Current state has newer data
    store.addParticipant({ id: 'p1', name: 'Current Name', joinedAt: 5000 });

    // Delayed message arrives with older data
    const delayedState = {
      meta: { version: 1 },
      participants: [
        ['p1', { id: 'p1', name: 'Old Name', joinedAt: 1000 }],
      ],
    };

    store.merge(delayedState, 'not-admin');

    // Current (newer) data should be preserved
    assertEquals(store.getParticipant('p1').name, 'Current Name');
  });

  await t.step('out-of-order messages resolve correctly', () => {
    const store = new Store();
    store.reset();

    // Messages arrive out of order: 3, 1, 2
    const msg3 = {
      meta: { version: 3 },
      participants: [['p1', { id: 'p1', name: 'Name v3', joinedAt: 3000 }]],
    };
    const msg1 = {
      meta: { version: 1 },
      participants: [['p1', { id: 'p1', name: 'Name v1', joinedAt: 1000 }]],
    };
    const msg2 = {
      meta: { version: 2 },
      participants: [['p1', { id: 'p1', name: 'Name v2', joinedAt: 2000 }]],
    };

    // Receive msg3 first
    store.merge(msg3, 'not-admin');
    assertEquals(store.getParticipant('p1').name, 'Name v3');

    // Receive msg1 (should be ignored - older)
    store.merge(msg1, 'not-admin');
    assertEquals(store.getParticipant('p1').name, 'Name v3');

    // Receive msg2 (should be ignored - still older)
    store.merge(msg2, 'not-admin');
    assertEquals(store.getParticipant('p1').name, 'Name v3');
  });

  await t.step('admin messages take priority regardless of timing', () => {
    const store = new Store();
    store.reset();
    store.set('meta.adminId', 'admin-user');

    // Peer sends newer update
    store.addParticipant({ id: 'p1', name: 'Peer Update', joinedAt: 9999 });

    // Admin sends older update (should still win for admin-controlled fields)
    const adminState = {
      meta: { version: 1, adminId: 'admin-user', status: 'active' },
    };

    store.merge(adminState, 'admin-user');

    // Admin's meta update should be accepted
    assertEquals(store.get('meta.status'), 'active');
  });
});

// =============================================================================
// MockRoom Event Tests
// =============================================================================

Deno.test('MockRoom Event Handling', async (t) => {
  await t.step('room captures peer join events', () => {
    const room = createMockRoom('self-id');
    const joinedPeers = [];

    room.onPeerJoin((peerId) => {
      joinedPeers.push(peerId);
    });

    room._simulatePeerJoin('peer-1');
    room._simulatePeerJoin('peer-2');

    assertEquals(joinedPeers.length, 2);
    assertEquals(joinedPeers, ['peer-1', 'peer-2']);
  });

  await t.step('room captures peer leave events', () => {
    const room = createMockRoom('self-id');
    const leftPeers = [];

    room.onPeerLeave((peerId) => {
      leftPeers.push(peerId);
    });

    room._simulatePeerJoin('peer-1');
    room._simulatePeerJoin('peer-2');
    room._simulatePeerLeave('peer-1');

    assertEquals(leftPeers.length, 1);
    assertEquals(leftPeers[0], 'peer-1');
  });

  await t.step('room action handlers receive messages correctly', () => {
    const room = createMockRoom('self-id');
    const receivedMessages = [];

    room.onAction('test-action', (payload, peerId) => {
      receivedMessages.push({ payload, peerId });
    });

    room._simulateAction('test-action', { data: 'hello' }, 'peer-1');
    room._simulateAction('test-action', { data: 'world' }, 'peer-2');

    assertEquals(receivedMessages.length, 2);
    assertEquals(receivedMessages[0].payload.data, 'hello');
    assertEquals(receivedMessages[0].peerId, 'peer-1');
    assertEquals(receivedMessages[1].payload.data, 'world');
    assertEquals(receivedMessages[1].peerId, 'peer-2');
  });

  await t.step('room broadcasts are captured', () => {
    const room = createMockRoom('self-id');

    room.broadcast('st:req', { type: 'request' });
    room.broadcast('m:result', { matchId: 'r1m0' });

    assertEquals(room._broadcasts.length, 2);
    assertEquals(room._broadcasts[0].type, 'st:req');
    assertEquals(room._broadcasts[1].type, 'm:result');
  });

  await t.step('room sendTo targets specific peers', () => {
    const room = createMockRoom('self-id');

    room.sendTo('st:res', { state: 'data' }, 'peer-1');
    room.sendTo('st:res', { state: 'data2' }, ['peer-2', 'peer-3']);

    assertEquals(room._sentMessages.length, 3);
    assertEquals(room._sentMessages[0].peerId, 'peer-1');
    assertEquals(room._sentMessages[1].peerId, 'peer-2');
    assertEquals(room._sentMessages[2].peerId, 'peer-3');
  });

  await t.step('room getPeers reflects current connections', () => {
    const room = createMockRoom('self-id');

    assertEquals(room.getPeerCount(), 0);

    room._simulatePeerJoin('peer-1');
    room._simulatePeerJoin('peer-2');

    assertEquals(room.getPeerCount(), 2);
    assert('peer-1' in room.getPeers());
    assert('peer-2' in room.getPeers());

    room._simulatePeerLeave('peer-1');

    assertEquals(room.getPeerCount(), 1);
    assertFalse('peer-1' in room.getPeers());
  });
});

// =============================================================================
// Connection State Tracking
// =============================================================================

Deno.test('Connection State Tracking', async (t) => {
  await t.step('participant count vs connected count', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({ id: 'p1', name: 'P1', isConnected: true });
    store.addParticipant({ id: 'p2', name: 'P2', isConnected: true });
    store.addParticipant({ id: 'p3', name: 'P3', isConnected: true });

    const total = store.getParticipantList().length;
    const connected = store.getParticipantList().filter(p => p.isConnected).length;

    assertEquals(total, 3);
    assertEquals(connected, 3);

    // Disconnect one
    store.updateParticipant('p2', { isConnected: false });

    const connectedAfter = store.getParticipantList().filter(p => p.isConnected).length;
    assertEquals(store.getParticipantList().length, 3); // Total unchanged
    assertEquals(connectedAfter, 2); // Connected decreased
  });

  await t.step('all participants disconnected does not clear data', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({ id: 'p1', name: 'P1', isConnected: true });
    store.addParticipant({ id: 'p2', name: 'P2', isConnected: true });

    store.updateParticipant('p1', { isConnected: false });
    store.updateParticipant('p2', { isConnected: false });

    // Data should still exist
    assertEquals(store.getParticipantList().length, 2);
    assertExists(store.getParticipant('p1'));
    assertExists(store.getParticipant('p2'));
  });
});
