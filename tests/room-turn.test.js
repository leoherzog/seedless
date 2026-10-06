/**
 * Tests for TURN credential fetching in joinRoom (turn-worker integration).
 */

import { assertEquals } from 'jsr:@std/assert';
import { joinRoom, leaveRoom } from '../js/network/room.js';
import { CONFIG } from '../config.js';
import { _getLastRoom } from './mocks/trystero-mock.js';

const MOCK_ICE_SERVERS = [
  { urls: ['stun:stun.cloudflare.com:3478'] },
  {
    urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'],
    username: 'mock-user',
    credential: 'mock-credential',
  },
];

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
        await joinRoom('room-turn');
        assertEquals(mockFetch.getCalls(), 1);
        assertEquals(_getLastRoom().config.turnConfig, MOCK_ICE_SERVERS);
        await leaveRoom();
      } finally {
        mockFetch.restore();
      }
    });

    await t.step('joins without turnConfig when fetch fails', async () => {
      CONFIG.network.turnCredentialsUrl = 'https://turn.example.workers.dev';
      const mockFetch = installMockFetch(() => Promise.reject(new Error('network down')));

      try {
        await joinRoom('room-turn');
        assertEquals(_getLastRoom().config.turnConfig, undefined);
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
        await joinRoom('room-turn');
        assertEquals(_getLastRoom().config.turnConfig, undefined);
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
        await joinRoom('room-turn');
        assertEquals(_getLastRoom().config.turnConfig, undefined);
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
        await joinRoom('room-turn');
        assertEquals(mockFetch.getCalls(), 0);
        assertEquals(_getLastRoom().config.turnConfig, undefined);
        await leaveRoom();
      } finally {
        mockFetch.restore();
      }
    });
  } finally {
    CONFIG.network.turnCredentialsUrl = previousUrl;
    await leaveRoom();
  }
});
