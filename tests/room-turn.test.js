/**
 * Tests for TURN credential fetching in joinRoom (turn-worker integration).
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { joinRoom, leaveRoom } from '../js/network/room.js';
import { CONFIG } from '../config.js';
import { createMockTrysteroRoom, _resetAll } from './mocks/trystero-mock.js';

const MOCK_ICE_SERVERS = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  {
    urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
    username: 'mock-user',
    credential: 'mock-credential',
  },
];

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

function installMockFetch(handler) {
  const previousFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (...args) => {
    calls += 1;
    return handler(...args);
  };
  return {
    restore: () => {
      globalThis.fetch = previousFetch;
    },
    getCalls: () => calls,
  };
}

Deno.test('joinRoom TURN credential fetching', async (t) => {
  _resetAll();
  const restoreTrystero = installMockTrystero();
  const previousUrl = CONFIG.network.turnCredentialsUrl;

  try {
    await t.step('passes fetched iceServers as turnConfig', async () => {
      CONFIG.network.turnCredentialsUrl = 'https://turn.example.workers.dev';
      const mockFetch = installMockFetch(() =>
        Promise.resolve(new Response(JSON.stringify({ iceServers: MOCK_ICE_SERVERS }), {
          headers: { 'Content-Type': 'application/json' },
        }))
      );

      try {
        const connection = await joinRoom('room-turn');
        assertEquals(mockFetch.getCalls(), 1);
        assertEquals(connection.room.config.turnConfig, MOCK_ICE_SERVERS);
        await leaveRoom();
      } finally {
        mockFetch.restore();
      }
    });

    await t.step('joins without turnConfig when fetch fails', async () => {
      CONFIG.network.turnCredentialsUrl = 'https://turn.example.workers.dev';
      const mockFetch = installMockFetch(() => Promise.reject(new Error('network down')));

      try {
        const connection = await joinRoom('room-turn');
        assertEquals(connection.room.config.turnConfig, undefined);
        assertEquals(connection.roomId, 'room-turn');
        await leaveRoom();
      } finally {
        mockFetch.restore();
      }
    });

    await t.step('joins without turnConfig on non-OK response', async () => {
      CONFIG.network.turnCredentialsUrl = 'https://turn.example.workers.dev';
      const mockFetch = installMockFetch(() =>
        Promise.resolve(new Response('Forbidden', { status: 403 }))
      );

      try {
        const connection = await joinRoom('room-turn');
        assertEquals(connection.room.config.turnConfig, undefined);
        await leaveRoom();
      } finally {
        mockFetch.restore();
      }
    });

    await t.step('joins without turnConfig on malformed response', async () => {
      CONFIG.network.turnCredentialsUrl = 'https://turn.example.workers.dev';
      const mockFetch = installMockFetch(() =>
        Promise.resolve(new Response(JSON.stringify({ iceServers: [] }), {
          headers: { 'Content-Type': 'application/json' },
        }))
      );

      try {
        const connection = await joinRoom('room-turn');
        assertEquals(connection.room.config.turnConfig, undefined);
        await leaveRoom();
      } finally {
        mockFetch.restore();
      }
    });

    await t.step('does not fetch when turnCredentialsUrl is empty', async () => {
      CONFIG.network.turnCredentialsUrl = '';
      const mockFetch = installMockFetch(() => {
        throw new Error('fetch should not be called');
      });

      try {
        const connection = await joinRoom('room-turn');
        assertEquals(mockFetch.getCalls(), 0);
        assert(!('turnConfig' in connection.room.config));
        await leaveRoom();
      } finally {
        mockFetch.restore();
      }
    });
  } finally {
    CONFIG.network.turnCredentialsUrl = previousUrl;
    restoreTrystero();
    await leaveRoom();
  }
});
