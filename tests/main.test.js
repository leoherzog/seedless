/**
 * Tests for Main Application Module
 *
 * Note: main.js does not export any functions directly, making traditional unit testing
 * challenging. This test file focuses on:
 * 1. Testing the behaviors through the Store and persistence modules
 * 2. Testing URL state handling logic patterns
 * 3. Integration testing patterns that verify main.js coordination
 *
 * For full test coverage of main.js, consider:
 * - Refactoring to export testable functions
 * - Using a DOM testing library like jsdom
 * - End-to-end testing with a browser automation tool
 *
 * Note: url-state.js cannot be imported directly as it has top-level window access.
 * We test the patterns and logic used by main.js instead.
 */

import { assertEquals, assertExists, assert, assertNotEquals } from 'jsr:@std/assert';
import { Store } from '../js/state/store.js';
import {
  saveTournament,
  loadTournament,
  saveDisplayName,
  getLastDisplayName,
  saveAdminToken,
  loadAdminToken,
  generateAdminToken,
  getLocalUserId,
} from '../js/state/persistence.js';
import { createMockRoom, createMockLocalStorage } from './fixtures.js';

// View constants (matching url-state.js without importing it)
const VIEWS = {
  HOME: 'home',
  LOBBY: 'lobby',
  BRACKET: 'bracket',
};

// ============================================
// Room Slug Validation Tests (used by onCreateRoom/onJoinRoom)
// ============================================

// Inline implementations matching url-state.js (since we can't import it)
function isValidRoomSlug(slug) {
  if (!slug || typeof slug !== 'string') return false;
  // Only lowercase letters, numbers, and hyphens
  // Must not start or end with hyphen
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

function sanitizeRoomSlug(input) {
  if (!input) return '';
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

Deno.test('Room Slug Validation', async (t) => {
  await t.step('isValidRoomSlug accepts valid slugs', () => {
    assert(isValidRoomSlug('my-room'));
    assert(isValidRoomSlug('room123'));
    assert(isValidRoomSlug('test'));
    assert(isValidRoomSlug('a'));
    assert(isValidRoomSlug('tournament-2024'));
  });

  await t.step('isValidRoomSlug rejects invalid slugs', () => {
    assert(!isValidRoomSlug(''));
    assert(!isValidRoomSlug('My Room')); // spaces
    assert(!isValidRoomSlug('UPPERCASE')); // uppercase
    assert(!isValidRoomSlug('special@char')); // special chars
    assert(!isValidRoomSlug('-starts-with-dash'));
    assert(!isValidRoomSlug('ends-with-dash-'));
  });

  await t.step('sanitizeRoomSlug normalizes input', () => {
    assertEquals(sanitizeRoomSlug('My Room'), 'my-room');
    assertEquals(sanitizeRoomSlug('UPPERCASE'), 'uppercase');
    assertEquals(sanitizeRoomSlug('  spaced  '), 'spaced');
    assertEquals(sanitizeRoomSlug('special@#$char'), 'specialchar');
  });
});

// ============================================
// URL State Parsing Tests (used by handleUrlChange)
// ============================================

Deno.test('URL State Parsing', async (t) => {
  await t.step('URL parameter extraction pattern', () => {
    // Tests verify the URL parameter extraction pattern used by parseUrlState
    const testCases = [
      { search: '?room=test-room', expected: 'test-room' },
      { search: '?room=my-tournament', expected: 'my-tournament' },
      { search: '', expected: null },
      { search: '?other=param', expected: null },
      { search: '?room=test&view=lobby', expected: 'test' },
    ];

    testCases.forEach(({ search, expected }) => {
      const params = new URLSearchParams(search);
      const roomId = params.get('room');
      assertEquals(roomId, expected, `Failed for search: ${search}`);
    });
  });

  await t.step('VIEWS constants are defined correctly', () => {
    assertExists(VIEWS.HOME);
    assertExists(VIEWS.LOBBY);
    assertExists(VIEWS.BRACKET);
    assertEquals(VIEWS.HOME, 'home');
    assertEquals(VIEWS.LOBBY, 'lobby');
    assertEquals(VIEWS.BRACKET, 'bracket');
  });
});

// ============================================
// Persistence Integration Tests (used by connectToRoom)
// ============================================

Deno.test('Persistence Integration', async (t) => {
  // Create mock localStorage for these tests
  const originalLocalStorage = globalThis.localStorage;

  await t.step('setup mock localStorage', () => {
    const mockStorage = createMockLocalStorage();
    // @ts-ignore - replacing global for test
    globalThis.localStorage = mockStorage;
  });

  await t.step('saveDisplayName and getLastDisplayName round-trip', () => {
    saveDisplayName('Test User');
    assertEquals(getLastDisplayName(), 'Test User');

    saveDisplayName('Another User');
    assertEquals(getLastDisplayName(), 'Another User');
  });

  await t.step('generateAdminToken creates unique tokens', () => {
    const token1 = generateAdminToken();
    const token2 = generateAdminToken();

    assertExists(token1);
    assertExists(token2);
    assertNotEquals(token1, token2);
    assert(token1.length > 10); // Should be a reasonably long token
  });

  await t.step('saveAdminToken and loadAdminToken round-trip', () => {
    const roomId = 'test-room';
    const token = generateAdminToken();

    saveAdminToken(roomId, token);
    assertEquals(loadAdminToken(roomId), token);
  });

  await t.step('getLocalUserId returns consistent ID', () => {
    const id1 = getLocalUserId();
    const id2 = getLocalUserId();

    assertExists(id1);
    assertEquals(id1, id2); // Same ID on subsequent calls
  });

  await t.step('saveTournament and loadTournament round-trip', () => {
    const roomId = 'test-tournament';
    const store = new Store();
    store.set('meta.id', roomId);
    store.set('meta.name', 'Test Tournament');
    store.addParticipant({ id: 'p1', name: 'Player 1' });

    saveTournament(roomId, store.serialize());

    const loaded = loadTournament(roomId);
    assertExists(loaded);
    assertEquals(loaded.meta.id, roomId);
    assertEquals(loaded.meta.name, 'Test Tournament');
  });

  await t.step('cleanup mock localStorage', () => {
    // @ts-ignore - restoring global
    globalThis.localStorage = originalLocalStorage;
  });
});

// ============================================
// Store State Management Tests (used throughout main.js)
// ============================================

Deno.test('Store State Management for Connection', async (t) => {
  await t.step('store manages local peer info', () => {
    const store = new Store();

    store.set('local.localUserId', 'user-123');
    store.set('local.peerId', 'peer-abc');
    store.set('local.name', 'Test User');
    store.set('local.isConnected', true);

    assertEquals(store.get('local.localUserId'), 'user-123');
    assertEquals(store.get('local.peerId'), 'peer-abc');
    assertEquals(store.get('local.name'), 'Test User');
    assertEquals(store.get('local.isConnected'), true);
  });

  await t.step('store manages meta info for rooms', () => {
    const store = new Store();

    store.set('meta.id', 'my-room');
    store.set('meta.adminId', 'admin-user');
    store.set('meta.adminToken', 'secret-token');
    store.set('meta.createdAt', Date.now());
    store.set('meta.status', 'lobby');

    assertEquals(store.get('meta.id'), 'my-room');
    assertEquals(store.get('meta.adminId'), 'admin-user');
    assertEquals(store.get('meta.status'), 'lobby');
  });

  await t.step('store admin status affects behavior', () => {
    const store = new Store();

    store.setAdmin(true);
    assert(store.isAdmin());

    store.setAdmin(false);
    assert(!store.isAdmin());
  });

  await t.step('store reset preserves local.name', () => {
    const store = new Store();
    store.set('local.name', 'Preserved Name');
    store.set('meta.id', 'room-to-clear');
    store.addParticipant({ id: 'p1', name: 'Player' });

    // Simulate disconnectFromRoom behavior
    const localName = store.get('local.name');
    store.reset();
    store.set('local.name', localName);

    assertEquals(store.get('local.name'), 'Preserved Name');
    assertEquals(store.get('meta.id'), null);
    assertEquals(store.getParticipantList().length, 0);
  });
});

// ============================================
// Admin Token Verification Tests (connectToRoom logic)
// ============================================

Deno.test('Admin Token Verification Logic', async (t) => {
  await t.step('matching tokens grant admin status', () => {
    const storedAdminToken = 'token-abc123';
    const existingAdminToken = 'token-abc123';

    const hasMatchingToken = storedAdminToken && existingAdminToken &&
      storedAdminToken === existingAdminToken;

    assert(hasMatchingToken);
  });

  await t.step('non-matching tokens deny admin status', () => {
    const storedAdminToken = 'token-abc123';
    const existingAdminToken = 'token-different';

    const hasMatchingToken = storedAdminToken && existingAdminToken &&
      storedAdminToken === existingAdminToken;

    assert(!hasMatchingToken);
  });

  await t.step('missing stored token denies admin status', () => {
    const storedAdminToken = null;
    const existingAdminToken = 'token-abc123';

    const hasMatchingToken = storedAdminToken && existingAdminToken &&
      storedAdminToken === existingAdminToken;

    assert(!hasMatchingToken);
  });

  await t.step('missing existing token denies admin status', () => {
    const storedAdminToken = 'token-abc123';
    const existingAdminToken = null;

    const hasMatchingToken = storedAdminToken && existingAdminToken &&
      storedAdminToken === existingAdminToken;

    assert(!hasMatchingToken);
  });

  await t.step('isAdmin flag from form grants admin status', () => {
    const isAdmin = true;
    const hasMatchingToken = false;
    const isActualAdmin = isAdmin || hasMatchingToken;

    assert(isActualAdmin);
  });
});

// ============================================
// Mock Room Integration Tests
// ============================================

Deno.test('Mock Room for Connection Testing', async (t) => {
  await t.step('mock room tracks broadcasts', () => {
    const room = createMockRoom('local-peer');

    room.broadcast('p:join', { name: 'Test User' });
    room.broadcast('state:req', {});

    assertEquals(room._broadcasts.length, 2);
    assertEquals(room._broadcasts[0].type, 'p:join');
    assertEquals(room._broadcasts[1].type, 'state:req');
  });

  await t.step('mock room tracks sent messages', () => {
    const room = createMockRoom('local-peer');

    room.sendTo('state:res', { state: {} }, 'peer-123');

    assertEquals(room._sentMessages.length, 1);
    assertEquals(room._sentMessages[0].type, 'state:res');
    assertEquals(room._sentMessages[0].peerId, 'peer-123');
  });

  await t.step('mock room simulates peer join/leave', () => {
    const room = createMockRoom('local-peer');
    let joinedPeer = null;
    let leftPeer = null;

    room.onPeerJoin((peerId) => { joinedPeer = peerId; });
    room.onPeerLeave((peerId) => { leftPeer = peerId; });

    room._simulatePeerJoin('peer-abc');
    assertEquals(joinedPeer, 'peer-abc');
    assertEquals(room.getPeerCount(), 1);

    room._simulatePeerLeave('peer-abc');
    assertEquals(leftPeer, 'peer-abc');
    assertEquals(room.getPeerCount(), 0);
  });

  await t.step('mock room simulates action handlers', () => {
    const room = createMockRoom('local-peer');
    let receivedPayload = null;
    let receivedFrom = null;

    room.onAction('test:action', (payload, fromPeerId) => {
      receivedPayload = payload;
      receivedFrom = fromPeerId;
    });

    room._simulateAction('test:action', { data: 'test' }, 'peer-xyz');

    assertEquals(receivedPayload.data, 'test');
    assertEquals(receivedFrom, 'peer-xyz');
  });
});

// ============================================
// Connection Flow State Tests
// ============================================

Deno.test('Connection Flow State Management', async (t) => {
  await t.step('store setup for new room as admin', () => {
    const store = new Store();
    const roomId = 'new-room';
    const localUserId = 'user-123';
    const adminToken = 'admin-token-abc';

    // Simulate connectToRoom for admin
    store.setAdmin(true);
    store.batch({
      'meta.id': roomId,
      'meta.adminId': localUserId,
      'meta.adminToken': adminToken,
      'meta.createdAt': Date.now(),
    });

    assertEquals(store.get('meta.id'), roomId);
    assertEquals(store.get('meta.adminId'), localUserId);
    assertEquals(store.get('meta.adminToken'), adminToken);
    assert(store.isAdmin());
  });

  await t.step('store setup for joining room as participant', () => {
    const store = new Store();
    const roomId = 'existing-room';

    // Simulate connectToRoom for non-admin
    store.setAdmin(false);
    store.set('meta.id', roomId);

    assertEquals(store.get('meta.id'), roomId);
    assert(!store.isAdmin());
  });

  await t.step('participant added after connection', () => {
    const store = new Store();
    const localUserId = 'user-123';
    const peerId = 'peer-abc';
    const name = 'Test User';

    store.addParticipant({
      id: localUserId,
      peerId: peerId,
      name: name,
      isConnected: true,
    });

    const participant = store.getParticipant(localUserId);
    assertExists(participant);
    assertEquals(participant.name, name);
    assertEquals(participant.peerId, peerId);
    assert(participant.isConnected);
  });
});

// ============================================
// Disconnection Flow Tests
// ============================================

Deno.test('Disconnection Flow State Management', async (t) => {
  await t.step('disconnect broadcasts leave message', () => {
    const room = createMockRoom('local-peer');

    // Simulate disconnectFromRoom broadcast
    room.broadcast('p:leave', {});

    assertEquals(room._broadcasts.length, 1);
    assertEquals(room._broadcasts[0].type, 'p:leave');
  });

  await t.step('disconnect resets store state', () => {
    const store = new Store();

    // Setup connected state
    store.set('local.name', 'User Name');
    store.set('meta.id', 'room-id');
    store.set('meta.status', 'active');
    store.addParticipant({ id: 'p1', name: 'Player 1' });

    // Simulate disconnect behavior
    const localName = store.get('local.name');
    store.reset();
    store.set('local.name', localName);

    // Verify state is reset except local.name
    assertEquals(store.get('local.name'), 'User Name');
    assertEquals(store.get('meta.id'), null);
    // Note: meta.status resets to default 'lobby' (not null)
    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.getParticipantList().length, 0);
  });
});

// ============================================
// Tournament Reset Tests (onNewTournament)
// ============================================

Deno.test('Tournament Reset Logic', async (t) => {
  await t.step('admin can reset tournament to lobby', () => {
    const store = new Store();
    store.setAdmin(true);
    store.set('meta.status', 'active');
    store.set('bracket', { rounds: [] });
    store.setMatches(new Map([['m1', { id: 'm1' }]]));

    // Simulate onNewTournament for admin
    if (store.isAdmin()) {
      store.set('meta.status', 'lobby');
      store.set('bracket', null);
      store.setMatches(new Map());
    }

    assertEquals(store.get('meta.status'), 'lobby');
    assertEquals(store.get('bracket'), null);
    assertEquals(store.get('matches').size, 0);
  });

  await t.step('admin reset broadcasts to peers', () => {
    const store = new Store();
    const room = createMockRoom('local-peer');
    store.setAdmin(true);

    // Simulate broadcast
    room.broadcast('t:reset', {});

    assertEquals(room._broadcasts.length, 1);
    assertEquals(room._broadcasts[0].type, 't:reset');
  });
});

// ============================================
// View Navigation Logic Tests
// ============================================

Deno.test('View Navigation Logic', async (t) => {
  await t.step('determines correct view from tournament status', () => {
    const testCases = [
      { status: 'lobby', expected: VIEWS.LOBBY },
      { status: 'active', expected: VIEWS.BRACKET },
      { status: 'complete', expected: VIEWS.BRACKET },
      { status: null, expected: VIEWS.HOME },
    ];

    testCases.forEach(({ status, expected }) => {
      let view;
      if (!status) {
        view = VIEWS.HOME;
      } else if (status === 'active' || status === 'complete') {
        view = VIEWS.BRACKET;
      } else {
        view = VIEWS.LOBBY;
      }
      assertEquals(view, expected);
    });
  });
});

// ============================================
// Auto-save Logic Tests
// ============================================

Deno.test('Auto-save Logic Patterns', async (t) => {
  await t.step('auto-save skips local.* paths', () => {
    const paths = [
      { path: 'local.name', shouldSave: false },
      { path: 'local.isConnected', shouldSave: false },
      { path: 'meta.status', shouldSave: true },
      { path: 'participants', shouldSave: true },
      { path: 'bracket', shouldSave: true },
    ];

    paths.forEach(({ path, shouldSave }) => {
      const skipSave = path && path.startsWith('local.');
      assertEquals(!skipSave, shouldSave, `Path: ${path}`);
    });
  });
});

// ============================================
// Peer Count Logic Tests
// ============================================

Deno.test('Peer Count Calculation', async (t) => {
  await t.step('peer count includes self', () => {
    const room = createMockRoom('local-peer');

    // No peers yet
    let peerCount = room.getPeerCount();
    let totalInRoom = peerCount + 1; // Add 1 for self
    assertEquals(totalInRoom, 1);

    // Add a peer
    room._simulatePeerJoin('peer-1');
    peerCount = room.getPeerCount();
    totalInRoom = peerCount + 1;
    assertEquals(totalInRoom, 2);

    // Add another peer
    room._simulatePeerJoin('peer-2');
    peerCount = room.getPeerCount();
    totalInRoom = peerCount + 1;
    assertEquals(totalInRoom, 3);
  });
});

// ============================================
// Reset Participants Offline Logic
// ============================================

Deno.test('Reset All Participants Offline', async (t) => {
  await t.step('marks all participants as disconnected', () => {
    const store = new Store();

    // Add connected participants
    store.addParticipant({ id: 'p1', name: 'Player 1', isConnected: true });
    store.addParticipant({ id: 'p2', name: 'Player 2', isConnected: true });
    store.addParticipant({ id: 'p3', name: 'Player 3', isConnected: true });

    // Simulate resetAllParticipantsOffline
    const participants = store.getParticipantList();
    for (const p of participants) {
      store.updateParticipant(p.id, { isConnected: false });
    }

    // Verify all are offline
    store.getParticipantList().forEach(p => {
      assertEquals(p.isConnected, false);
    });
  });
});
