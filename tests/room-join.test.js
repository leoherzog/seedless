/**
 * Tests for room.js against the Trystero mock that deno.json maps in.
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { joinRoom, leaveRoom, getRoom, ActionTypes } from '../js/network/room.js';
import { _getLastRoom } from './mocks/trystero-mock.js';

Deno.test('ActionTypes', async (t) => {
  await t.step('names fit the 32-byte Trystero limit', () => {
    const encoder = new TextEncoder();
    for (const [name, value] of Object.entries(ActionTypes)) {
      const bytes = encoder.encode(value).length;
      assert(bytes <= 32, `Action type ${name} ("${value}") exceeds 32 bytes: ${bytes} bytes`);
    }
  });

  await t.step('values are unique', () => {
    const values = Object.values(ActionTypes);
    assertEquals(values.length, new Set(values).size);
  });
});

Deno.test('joinRoom/leaveRoom with mock Trystero', async (t) => {
  try {
    await t.step('joins the named Trystero room and tracks the connection', async () => {
      const connection = await joinRoom('room-1');
      assertEquals(_getLastRoom().roomId, 'room-1');
      assertEquals(connection.selfId, 'mock-self-id');
      assertEquals(getRoom(), connection);

      await leaveRoom();
      assertEquals(getRoom(), null);
    });

    await t.step('broadcast and sendTo wrap the payload on every channel', async () => {
      const connection = await joinRoom('room-1');
      const room = _getLastRoom();

      for (const type of Object.values(ActionTypes)) {
        connection.broadcast(type, { type });
        assertEquals(room._getSentMessages(type), [{ data: { payload: { type } }, targets: undefined }]);
      }

      connection.sendTo(ActionTypes.STATE_RESPONSE, { ok: true }, ['peer-1', 'peer-2']);
      const [, targeted] = room._getSentMessages(ActionTypes.STATE_RESPONSE);
      assertEquals(targeted, { data: { payload: { ok: true } }, targets: ['peer-1', 'peer-2'] });

      await leaveRoom();
    });

    await t.step('onPeerJoin and onPeerLeave fan out to every handler', async () => {
      const connection = await joinRoom('room-1');
      const room = _getLastRoom();
      const joined = [];
      const left = [];
      connection.onPeerJoin((peerId) => joined.push(['a', peerId]));
      connection.onPeerJoin((peerId) => joined.push(['b', peerId]));
      connection.onPeerLeave((peerId) => left.push(peerId));

      room._simulatePeerJoin('peer-1');
      assertEquals(joined, [['a', 'peer-1'], ['b', 'peer-1']]);
      assertEquals(connection.getPeers(), ['peer-1']);

      room._simulatePeerLeave('peer-1');
      assertEquals(left, ['peer-1']);
      assertEquals(connection.getPeers(), []);

      await leaveRoom();
    });

    await t.step('onAction passes the unwrapped payload and sender peerId', async () => {
      const connection = await joinRoom('room-1');
      const calls = [];
      connection.onAction(ActionTypes.MATCH_RESULT, (...args) => calls.push(args));

      _getLastRoom()._simulateMessage(ActionTypes.MATCH_RESULT, { payload: { matchId: 'm1' } }, 'peer-1');
      assertEquals(calls, [[{ matchId: 'm1' }, 'peer-1']]);

      await leaveRoom();
    });

    await t.step('joinRoom leaves existing room before joining new one', async () => {
      await joinRoom('room-1');
      const room1 = _getLastRoom();
      const originalLeave = room1.leave;
      room1.leave = () => {
        room1._left = true;
        return originalLeave();
      };

      await joinRoom('room-2');
      assertEquals(room1._left, true);

      await leaveRoom();
    });

    await t.step('leaveRoom is safe to call when not connected', async () => {
      await leaveRoom();
      await leaveRoom();
    });
  } finally {
    await leaveRoom();
  }
});
