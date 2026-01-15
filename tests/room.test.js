/**
 * Tests for Room Management (room.js)
 * Tests the P2P room lifecycle, action channels, and peer management
 */

import { assertEquals, assert, assertExists } from 'jsr:@std/assert';
import { ActionTypes } from '../js/network/room.js';
import { createMockTrysteroRoom, _resetAll } from './mocks/trystero-mock.js';

// =============================================================================
// ActionTypes Constants Tests
// =============================================================================

Deno.test('ActionTypes Constants', async (t) => {
  await t.step('exports all required action types', () => {
    assertExists(ActionTypes.STATE_REQUEST);
    assertExists(ActionTypes.STATE_RESPONSE);
    assertExists(ActionTypes.PARTICIPANT_JOIN);
    assertExists(ActionTypes.PARTICIPANT_UPDATE);
    assertExists(ActionTypes.PARTICIPANT_LEAVE);
    assertExists(ActionTypes.TOURNAMENT_START);
    assertExists(ActionTypes.TOURNAMENT_RESET);
    assertExists(ActionTypes.MATCH_RESULT);
    assertExists(ActionTypes.MATCH_VERIFY);
    assertExists(ActionTypes.STANDINGS_UPDATE);
    assertExists(ActionTypes.RACE_RESULT);
  });

  await t.step('action type names do not exceed 12 bytes (Trystero limit)', () => {
    const encoder = new TextEncoder();
    for (const [name, value] of Object.entries(ActionTypes)) {
      const bytes = encoder.encode(value).length;
      assert(
        bytes <= 12,
        `Action type ${name} ("${value}") exceeds 12 bytes: ${bytes} bytes`
      );
    }
  });

  await t.step('action type values are unique', () => {
    const values = Object.values(ActionTypes);
    const uniqueValues = new Set(values);
    assertEquals(
      values.length,
      uniqueValues.size,
      'Action types should have unique values'
    );
  });

  await t.step('action type values match expected format', () => {
    assertEquals(ActionTypes.STATE_REQUEST, 'st:req');
    assertEquals(ActionTypes.STATE_RESPONSE, 'st:res');
    assertEquals(ActionTypes.PARTICIPANT_JOIN, 'p:join');
    assertEquals(ActionTypes.PARTICIPANT_UPDATE, 'p:upd');
    assertEquals(ActionTypes.PARTICIPANT_LEAVE, 'p:leave');
    assertEquals(ActionTypes.TOURNAMENT_START, 't:start');
    assertEquals(ActionTypes.TOURNAMENT_RESET, 't:reset');
    assertEquals(ActionTypes.MATCH_RESULT, 'm:result');
    assertEquals(ActionTypes.MATCH_VERIFY, 'm:verify');
    assertEquals(ActionTypes.STANDINGS_UPDATE, 's:upd');
    assertEquals(ActionTypes.RACE_RESULT, 'r:result');
  });
});

// =============================================================================
// Trystero Mock Tests (validates our mock follows Trystero API)
// =============================================================================

Deno.test('Trystero Mock', async (t) => {
  await t.step('setup and teardown', () => {
    _resetAll();
  });

  await t.step('createMockTrysteroRoom creates room with correct properties', () => {
    const config = { appId: 'test-app' };
    const roomId = 'test-room';
    const room = createMockTrysteroRoom(config, roomId);

    assertEquals(room.roomId, roomId);
    assertEquals(room.config, config);
    assertExists(room.makeAction);
    assertExists(room.onPeerJoin);
    assertExists(room.onPeerLeave);
    assertExists(room.getPeers);
    assertExists(room.leave);
  });

  await t.step('makeAction returns [send, receive] tuple', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const result = room.makeAction('test-action');

    assert(Array.isArray(result));
    assertEquals(result.length, 2);
    assertEquals(typeof result[0], 'function'); // send
    assertEquals(typeof result[1], 'function'); // receive
  });

  await t.step('send captures messages for inspection', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const [send, receive] = room.makeAction('test-action');
    receive(() => {}); // Register receiver

    const testData = { payload: 'test', timestamp: 123 };
    send(testData);
    send(testData, ['peer-1']);
    send(testData, ['peer-1', 'peer-2']);

    const sent = room._getSentMessages('test-action');
    assertEquals(sent.length, 3);
    assertEquals(sent[0].data, testData);
    assertEquals(sent[0].targets, undefined);
    assertEquals(sent[1].targets, ['peer-1']);
    assertEquals(sent[2].targets, ['peer-1', 'peer-2']);
  });

  await t.step('receive callback is invoked by _simulateMessage', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const [send, receive] = room.makeAction('test-action');

    let receivedData = null;
    let receivedPeerId = null;

    receive((data, peerId) => {
      receivedData = data;
      receivedPeerId = peerId;
    });

    const testData = { payload: 'hello' };
    room._simulateMessage('test-action', testData, 'peer-123');

    assertEquals(receivedData, testData);
    assertEquals(receivedPeerId, 'peer-123');
  });

  await t.step('peer join callbacks are invoked', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const joinedPeers = [];

    room.onPeerJoin((peerId) => {
      joinedPeers.push(peerId);
    });

    room._simulatePeerJoin('peer-1');
    room._simulatePeerJoin('peer-2');

    assertEquals(joinedPeers, ['peer-1', 'peer-2']);
    assertEquals(Object.keys(room.getPeers()).length, 2);
  });

  await t.step('peer leave callbacks are invoked', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const leftPeers = [];

    room.onPeerLeave((peerId) => {
      leftPeers.push(peerId);
    });

    room._simulatePeerJoin('peer-1');
    room._simulatePeerJoin('peer-2');
    room._simulatePeerLeave('peer-1');

    assertEquals(leftPeers, ['peer-1']);
    assertEquals(Object.keys(room.getPeers()).length, 1);
  });

  await t.step('getPeers returns connected peers', () => {
    const room = createMockTrysteroRoom({}, 'test');

    assertEquals(Object.keys(room.getPeers()).length, 0);

    room._simulatePeerJoin('peer-1');
    room._simulatePeerJoin('peer-2');
    room._simulatePeerJoin('peer-3');

    const peers = room.getPeers();
    assertEquals(Object.keys(peers).length, 3);
    assert('peer-1' in peers);
    assert('peer-2' in peers);
    assert('peer-3' in peers);
  });

  await t.step('leave clears peers and actions', () => {
    const room = createMockTrysteroRoom({}, 'test');

    room._simulatePeerJoin('peer-1');
    room.makeAction('action-1');

    assertEquals(Object.keys(room.getPeers()).length, 1);
    assert(room._hasAction('action-1'));

    room.leave();

    assertEquals(Object.keys(room.getPeers()).length, 0);
  });

  await t.step('_clearSentMessages clears specific action', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const [send1, receive1] = room.makeAction('action-1');
    const [send2, receive2] = room.makeAction('action-2');
    receive1(() => {});
    receive2(() => {});

    send1({ data: 1 });
    send2({ data: 2 });

    assertEquals(room._getSentMessages('action-1').length, 1);
    assertEquals(room._getSentMessages('action-2').length, 1);

    room._clearSentMessages('action-1');

    assertEquals(room._getSentMessages('action-1').length, 0);
    assertEquals(room._getSentMessages('action-2').length, 1);
  });

  await t.step('_clearSentMessages without arg clears all', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const [send1, receive1] = room.makeAction('action-1');
    const [send2, receive2] = room.makeAction('action-2');
    receive1(() => {});
    receive2(() => {});

    send1({ data: 1 });
    send2({ data: 2 });

    room._clearSentMessages();

    assertEquals(room._getSentMessages('action-1').length, 0);
    assertEquals(room._getSentMessages('action-2').length, 0);
  });

  await t.step('_getActionTypes returns registered action types', () => {
    const room = createMockTrysteroRoom({}, 'test');

    room.makeAction('action-1');
    room.makeAction('action-2');
    room.makeAction('action-3');

    const types = room._getActionTypes();
    assertEquals(types.length, 3);
    assert(types.includes('action-1'));
    assert(types.includes('action-2'));
    assert(types.includes('action-3'));
  });

  await t.step('multiple peer join/leave handlers supported', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const handler1Calls = [];
    const handler2Calls = [];

    room.onPeerJoin((id) => handler1Calls.push(`join:${id}`));
    room.onPeerJoin((id) => handler2Calls.push(`join:${id}`));
    room.onPeerLeave((id) => handler1Calls.push(`leave:${id}`));
    room.onPeerLeave((id) => handler2Calls.push(`leave:${id}`));

    room._simulatePeerJoin('peer-1');
    room._simulatePeerLeave('peer-1');

    assertEquals(handler1Calls, ['join:peer-1', 'leave:peer-1']);
    assertEquals(handler2Calls, ['join:peer-1', 'leave:peer-1']);
  });
});

// =============================================================================
// Room Connection Interface Tests
// =============================================================================

Deno.test('Room Connection Interface', async (t) => {
  // These tests verify the interface contract that room.js implements
  // They use createMockTrysteroRoom to test the expected behaviors

  await t.step('connection should support broadcast to all peers', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const actions = {};

    // Create action channels like room.js does
    const actionTypes = ['st:req', 'st:res', 'm:result'];
    for (const actionType of actionTypes) {
      const [send, receive] = room.makeAction(actionType);
      actions[actionType] = { send, receive };
    }

    // Simulate broadcast behavior
    const broadcast = (actionType, payload) => {
      if (!actions[actionType]) return;
      actions[actionType].send({
        payload,
        senderId: 'self-id',
        timestamp: Date.now(),
      });
    };

    broadcast('st:req', { type: 'request' });

    const sent = room._getSentMessages('st:req');
    assertEquals(sent.length, 1);
    assertEquals(sent[0].data.payload.type, 'request');
    assertEquals(sent[0].data.senderId, 'self-id');
    assertExists(sent[0].data.timestamp);
  });

  await t.step('connection should support sendTo specific peers', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const [send, receive] = room.makeAction('st:res');
    receive(() => {});

    // Simulate sendTo behavior
    const sendTo = (payload, targetPeers) => {
      const targets = Array.isArray(targetPeers) ? targetPeers : [targetPeers];
      send({
        payload,
        senderId: 'self-id',
        timestamp: Date.now(),
      }, targets);
    };

    sendTo({ state: 'data' }, 'peer-1');
    sendTo({ state: 'data' }, ['peer-2', 'peer-3']);

    const sent = room._getSentMessages('st:res');
    assertEquals(sent.length, 2);
    assertEquals(sent[0].targets, ['peer-1']);
    assertEquals(sent[1].targets, ['peer-2', 'peer-3']);
  });

  await t.step('connection should handle action message callbacks', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const [send, receive] = room.makeAction('m:result');

    const receivedMessages = [];

    // Simulate onAction behavior
    receive((data, peerId) => {
      receivedMessages.push({
        payload: data.payload,
        peerId,
        timestamp: data.timestamp,
      });
    });

    // Simulate incoming messages
    room._simulateMessage('m:result', {
      payload: { matchId: 'm1', scores: [2, 1] },
      senderId: 'peer-1',
      timestamp: 12345,
    }, 'peer-1');

    assertEquals(receivedMessages.length, 1);
    assertEquals(receivedMessages[0].payload.matchId, 'm1');
    assertEquals(receivedMessages[0].peerId, 'peer-1');
  });

  await t.step('connection should track peer count', () => {
    const room = createMockTrysteroRoom({}, 'test');

    assertEquals(Object.keys(room.getPeers()).length, 0);

    room._simulatePeerJoin('peer-1');
    assertEquals(Object.keys(room.getPeers()).length, 1);

    room._simulatePeerJoin('peer-2');
    room._simulatePeerJoin('peer-3');
    assertEquals(Object.keys(room.getPeers()).length, 3);

    room._simulatePeerLeave('peer-2');
    assertEquals(Object.keys(room.getPeers()).length, 2);
  });
});

// =============================================================================
// Action Channel Creation Tests
// =============================================================================

Deno.test('Action Channel Creation', async (t) => {
  await t.step('creates channels for all action types', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const actionTypes = Object.values(ActionTypes);

    for (const actionType of actionTypes) {
      const result = room.makeAction(actionType);
      assert(Array.isArray(result));
      assertEquals(result.length, 2);
    }

    assertEquals(room._getActionTypes().length, actionTypes.length);
  });

  await t.step('each action channel is independent', () => {
    const room = createMockTrysteroRoom({}, 'test');

    const [sendReq, receiveReq] = room.makeAction('st:req');
    const [sendRes, receiveRes] = room.makeAction('st:res');

    const reqMessages = [];
    const resMessages = [];

    receiveReq((data) => reqMessages.push(data));
    receiveRes((data) => resMessages.push(data));

    room._simulateMessage('st:req', { type: 'request' }, 'peer-1');
    room._simulateMessage('st:res', { type: 'response' }, 'peer-1');

    assertEquals(reqMessages.length, 1);
    assertEquals(resMessages.length, 1);
    assertEquals(reqMessages[0].type, 'request');
    assertEquals(resMessages[0].type, 'response');
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

Deno.test('Room Edge Cases', async (t) => {
  await t.step('handles message to unregistered action type gracefully', () => {
    const room = createMockTrysteroRoom({}, 'test');

    // Should not throw
    room._simulateMessage('nonexistent-action', { data: 'test' }, 'peer-1');
  });

  await t.step('handles duplicate peer join events', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const joins = [];

    room.onPeerJoin((id) => joins.push(id));

    room._simulatePeerJoin('peer-1');
    room._simulatePeerJoin('peer-1'); // Duplicate

    // Both events fire (actual Trystero behavior may vary)
    assertEquals(joins.length, 2);
    // But peers map should only have one entry
    assertEquals(Object.keys(room.getPeers()).length, 1);
  });

  await t.step('handles leave for non-existent peer', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const leaves = [];

    room.onPeerLeave((id) => leaves.push(id));

    // Should not throw
    room._simulatePeerLeave('nonexistent-peer');

    assertEquals(leaves.length, 1);
  });

  await t.step('handles empty payload', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const [send, receive] = room.makeAction('test');

    const received = [];
    receive((data, peerId) => received.push({ data, peerId }));

    room._simulateMessage('test', null, 'peer-1');
    room._simulateMessage('test', undefined, 'peer-2');
    room._simulateMessage('test', {}, 'peer-3');

    assertEquals(received.length, 3);
    assertEquals(received[0].data, null);
    assertEquals(received[1].data, undefined);
    assertEquals(received[2].data, {});
  });

  await t.step('_getSentMessages returns empty array for unregistered action', () => {
    const room = createMockTrysteroRoom({}, 'test');
    const messages = room._getSentMessages('nonexistent');
    assertEquals(messages, []);
  });
});
