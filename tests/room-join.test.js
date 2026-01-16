/**
 * Tests for joinRoom/leaveRoom with a Trystero mock override.
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { joinRoom, leaveRoom, ActionTypes } from '../js/network/room.js';
import { createMockTrysteroRoom, _resetAll } from './mocks/trystero-mock.js';

function installMockTrystero() {
  const previousJoin = globalThis.__seedlessTrysteroJoin;
  const previousSelfId = globalThis.__seedlessTrysteroSelfId;

  globalThis.__seedlessTrysteroJoin = (config, roomId) => createMockTrysteroRoom(config, roomId);
  globalThis.__seedlessTrysteroSelfId = 'mock-self-id';

  return () => {
    if (previousJoin === undefined) {
      delete globalThis.__seedlessTrysteroJoin;
    } else {
      globalThis.__seedlessTrysteroJoin = previousJoin;
    }
    if (previousSelfId === undefined) {
      delete globalThis.__seedlessTrysteroSelfId;
    } else {
      globalThis.__seedlessTrysteroSelfId = previousSelfId;
    }
  };
}

Deno.test('joinRoom/leaveRoom with mock Trystero', async (t) => {
  _resetAll();
  const restore = installMockTrystero();

  try {
    await t.step('joinRoom creates action channels and uses mock selfId', async () => {
      const connection = await joinRoom('room-1');
      assertEquals(connection.roomId, 'room-1');
      assertEquals(connection.selfId, 'mock-self-id');

      const actionTypes = Object.values(ActionTypes);
      for (const actionType of actionTypes) {
        assert(connection.actions[actionType], `missing action ${actionType}`);
      }

      await leaveRoom();
    });

    await t.step('broadcast/sendTo include senderId and targets', async () => {
      const connection = await joinRoom('room-1');

      connection.broadcast(ActionTypes.STATE_REQUEST, { hello: 'world' });
      const reqMessages = connection.room._getSentMessages(ActionTypes.STATE_REQUEST);
      assertEquals(reqMessages.length, 1);
      assertEquals(reqMessages[0].data.payload.hello, 'world');
      assertEquals(reqMessages[0].data.senderId, 'mock-self-id');
      assert(reqMessages[0].data.timestamp);

      connection.sendTo(ActionTypes.STATE_RESPONSE, { ok: true }, ['peer-1', 'peer-2']);
      const resMessages = connection.room._getSentMessages(ActionTypes.STATE_RESPONSE);
      assertEquals(resMessages.length, 1);
      assertEquals(resMessages[0].targets, ['peer-1', 'peer-2']);
      assertEquals(resMessages[0].data.payload.ok, true);

      // Should not throw for unknown action
      connection.broadcast('unknown', { nope: true });

      await leaveRoom();
    });

    await t.step('joinRoom leaves existing room before joining new one', async () => {
      const connection1 = await joinRoom('room-1');
      const room1 = connection1.room;
      const originalLeave = room1.leave;
      room1.leave = () => {
        room1._left = true;
        originalLeave();
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
    restore();
    await leaveRoom();
  }
});
