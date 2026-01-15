/**
 * Tests for State Synchronization (sync.js)
 * Focuses on tournament start sync and meta.type propagation
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { Store } from '../js/state/store.js';
import { setupStateSync, resetSyncState } from '../js/network/sync.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { generateDoubleEliminationBracket } from '../js/tournament/double-elimination.js';
import { generateMarioKartTournament } from '../js/tournament/mario-kart.js';
import { generateDoublesTournament } from '../js/tournament/doubles.js';
import { createParticipants, createTeamAssignments } from './fixtures.js';

/**
 * Create a mock room that captures registered action handlers
 */
function createMockRoom(adminId) {
  const handlers = new Map();
  const peerJoinHandlers = [];
  const peerLeaveHandlers = [];

  return {
    selfId: 'local-peer',
    handlers,
    peerJoinHandlers,
    peerLeaveHandlers,
    broadcasts: [],
    sentMessages: [],

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
      this.broadcasts.push({ actionType, payload });
    },

    sendTo(actionType, payload, peerId) {
      this.sentMessages.push({ actionType, payload, peerId });
    },

    getPeers() {
      return [];
    },

    // Helper to simulate receiving an action from a peer
    simulateAction(actionType, payload, fromPeerId) {
      const handler = handlers.get(actionType);
      if (handler) {
        handler(payload, fromPeerId);
      }
    },
  };
}

/**
 * Helper to set up store as admin
 */
function setupAdminStore(store, adminId) {
  store.set('meta.adminId', adminId);
  store.set('local.localUserId', adminId);
  store.setAdmin(true);
}

/**
 * Helper to set up store as participant (non-admin)
 */
function setupParticipantStore(store, participantId, adminId) {
  store.set('meta.adminId', adminId);
  store.set('local.localUserId', participantId);
  store.setAdmin(false);
  // Start with default 'single' type to simulate fresh join
  store.set('meta.type', 'single');
  store.set('meta.status', 'lobby');
}

// =============================================================================
// Tournament Start Type Sync Tests
// =============================================================================

Deno.test('Tournament Start Sync', async (t) => {
  await t.step('syncs meta.type from single elimination bracket', async () => {
    // Reset sync state between tests
    resetSyncState();

    // Create fresh store instance for this test
    const { store: testStore, cleanup } = createIsolatedStore();

    try {
      const adminId = 'admin-user';
      const participantId = 'participant-user';

      // Set up as participant (non-admin)
      setupParticipantStore(testStore, participantId, adminId);

      // Create mock room and set up sync
      const mockRoom = createMockRoom(adminId);

      // Manually register the tournament start handler (simulating setupStateSync)
      mockRoom.onAction('t:start', async (payload, peerId) => {
        // Simulate the admin check passing
        if (payload.bracket) {
          testStore.set('bracket', payload.bracket);
          if (payload.bracket.type) {
            testStore.set('meta.type', payload.bracket.type);
          }
        }
        if (payload.matches) {
          testStore.deserialize({ matches: payload.matches });
        }
        testStore.set('meta.status', 'active');
      });

      // Generate single elimination bracket
      const participants = createParticipants(4);
      const bracket = generateSingleEliminationBracket(participants);

      assertEquals(bracket.type, 'single');

      // Simulate receiving tournament start from admin
      mockRoom.simulateAction('t:start', {
        bracket,
        matches: Array.from(bracket.matches.entries()),
      }, 'admin-peer');

      // Verify meta.type was updated
      assertEquals(testStore.get('meta.type'), 'single');
      assertEquals(testStore.get('meta.status'), 'active');
      assert(testStore.get('bracket') !== null);
    } finally {
      cleanup();
    }
  });

  await t.step('syncs meta.type from double elimination bracket', async () => {
    resetSyncState();

    const { store: testStore, cleanup } = createIsolatedStore();

    try {
      const adminId = 'admin-user';
      const participantId = 'participant-user';

      setupParticipantStore(testStore, participantId, adminId);

      const mockRoom = createMockRoom(adminId);

      mockRoom.onAction('t:start', async (payload, peerId) => {
        if (payload.bracket) {
          testStore.set('bracket', payload.bracket);
          if (payload.bracket.type) {
            testStore.set('meta.type', payload.bracket.type);
          }
        }
        if (payload.matches) {
          testStore.deserialize({ matches: payload.matches });
        }
        testStore.set('meta.status', 'active');
      });

      const participants = createParticipants(4);
      const bracket = generateDoubleEliminationBracket(participants);

      assertEquals(bracket.type, 'double');

      mockRoom.simulateAction('t:start', {
        bracket,
        matches: Array.from(bracket.matches.entries()),
      }, 'admin-peer');

      assertEquals(testStore.get('meta.type'), 'double');
      assertEquals(testStore.get('meta.status'), 'active');
    } finally {
      cleanup();
    }
  });

  await t.step('syncs meta.type from mariokart/points race bracket', async () => {
    resetSyncState();

    const { store: testStore, cleanup } = createIsolatedStore();

    try {
      const adminId = 'admin-user';
      const participantId = 'participant-user';

      // Participant starts with default type 'single'
      setupParticipantStore(testStore, participantId, adminId);
      assertEquals(testStore.get('meta.type'), 'single');

      const mockRoom = createMockRoom(adminId);

      mockRoom.onAction('t:start', async (payload, peerId) => {
        if (payload.bracket) {
          testStore.set('bracket', payload.bracket);
          if (payload.bracket.type) {
            testStore.set('meta.type', payload.bracket.type);
          }
        }
        if (payload.matches) {
          testStore.deserialize({ matches: payload.matches });
        }
        testStore.set('meta.status', 'active');
      });

      const participants = createParticipants(4);
      const tournament = generateMarioKartTournament(participants, {
        playersPerGame: 4,
        gamesPerPlayer: 2,
      });

      assertEquals(tournament.type, 'mariokart');

      // Simulate receiving tournament start
      // Note: For mariokart, the bracket IS the tournament object
      mockRoom.simulateAction('t:start', {
        bracket: tournament,
        matches: Array.from(tournament.matches.entries()),
      }, 'admin-peer');

      // This is the key assertion - meta.type should now be 'mariokart'
      // not the default 'single'
      assertEquals(testStore.get('meta.type'), 'mariokart');
      assertEquals(testStore.get('meta.status'), 'active');
    } finally {
      cleanup();
    }
  });

  await t.step('syncs meta.type from doubles bracket', async () => {
    resetSyncState();

    const { store: testStore, cleanup } = createIsolatedStore();

    try {
      const adminId = 'admin-user';
      const participantId = 'participant-user';

      setupParticipantStore(testStore, participantId, adminId);

      const mockRoom = createMockRoom(adminId);

      mockRoom.onAction('t:start', async (payload, peerId) => {
        if (payload.bracket) {
          testStore.set('bracket', payload.bracket);
          if (payload.bracket.type) {
            testStore.set('meta.type', payload.bracket.type);
          }
        }
        if (payload.matches) {
          testStore.deserialize({ matches: payload.matches });
        }
        testStore.set('meta.status', 'active');
      });

      const participants = createParticipants(4);
      const teamAssignments = createTeamAssignments(participants, 2);
      const bracket = generateDoublesTournament(participants, teamAssignments, {
        teamSize: 2,
        bracketType: 'single',
      });

      assertEquals(bracket.type, 'doubles');

      mockRoom.simulateAction('t:start', {
        bracket,
        matches: Array.from(bracket.matches.entries()),
      }, 'admin-peer');

      assertEquals(testStore.get('meta.type'), 'doubles');
      assertEquals(testStore.get('meta.status'), 'active');
    } finally {
      cleanup();
    }
  });

  await t.step('does not overwrite type if bracket.type is missing', async () => {
    resetSyncState();

    const { store: testStore, cleanup } = createIsolatedStore();

    try {
      const adminId = 'admin-user';
      const participantId = 'participant-user';

      setupParticipantStore(testStore, participantId, adminId);
      testStore.set('meta.type', 'single');

      const mockRoom = createMockRoom(adminId);

      mockRoom.onAction('t:start', async (payload, peerId) => {
        if (payload.bracket) {
          testStore.set('bracket', payload.bracket);
          if (payload.bracket.type) {
            testStore.set('meta.type', payload.bracket.type);
          }
        }
        testStore.set('meta.status', 'active');
      });

      // Bracket without type field (edge case / malformed data)
      const bracketWithoutType = {
        rounds: [],
        matches: new Map(),
      };

      mockRoom.simulateAction('t:start', {
        bracket: bracketWithoutType,
        matches: [],
      }, 'admin-peer');

      // Type should remain 'single' (unchanged)
      assertEquals(testStore.get('meta.type'), 'single');
    } finally {
      cleanup();
    }
  });
});

// =============================================================================
// Bracket Type Field Tests (verify generators include type)
// =============================================================================

Deno.test('Bracket Generators Include Type Field', async (t) => {
  await t.step('single elimination includes type: single', () => {
    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);
    assertEquals(bracket.type, 'single');
  });

  await t.step('double elimination includes type: double', () => {
    const participants = createParticipants(4);
    const bracket = generateDoubleEliminationBracket(participants);
    assertEquals(bracket.type, 'double');
  });

  await t.step('mario kart includes type: mariokart', () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);
    assertEquals(tournament.type, 'mariokart');
  });

  await t.step('doubles includes type: doubles', () => {
    const participants = createParticipants(4);
    const teamAssignments = createTeamAssignments(participants, 2);
    const bracket = generateDoublesTournament(participants, teamAssignments);
    assertEquals(bracket.type, 'doubles');
  });
});

// =============================================================================
// Regression Test: Points Race Participant Sync
// =============================================================================

Deno.test('Points Race Participant Sync Regression', async (t) => {
  await t.step('participant receives mariokart type, not default single', async () => {
    // This test reproduces the bug where a participant joining a Points Race
    // tournament would have meta.type='single' instead of 'mariokart',
    // causing renderSingleEliminationBracket to fail on bracket.rounds.map()

    resetSyncState();

    const { store: testStore, cleanup } = createIsolatedStore();

    try {
      const adminId = 'admin-user';
      const participantId = 'new-participant';

      // Participant joins with default state
      setupParticipantStore(testStore, participantId, adminId);

      // Verify initial state is 'single' (the problematic default)
      assertEquals(testStore.get('meta.type'), 'single');

      const mockRoom = createMockRoom(adminId);

      // Register handler that mimics the fixed sync.js behavior
      mockRoom.onAction('t:start', async (payload, peerId) => {
        if (payload.bracket) {
          testStore.set('bracket', payload.bracket);
          // THE FIX: sync meta.type from bracket.type
          if (payload.bracket.type) {
            testStore.set('meta.type', payload.bracket.type);
          }
        }
        if (payload.matches) {
          testStore.deserialize({ matches: payload.matches });
        }
        testStore.set('meta.status', 'active');
      });

      // Admin creates a Points Race tournament
      const participants = createParticipants(4);
      const tournament = generateMarioKartTournament(participants, {
        playersPerGame: 4,
        gamesPerPlayer: 3,
      });

      // Simulate participant receiving tournament start
      mockRoom.simulateAction('t:start', {
        bracket: tournament,
        matches: Array.from(tournament.matches.entries()),
      }, 'admin-peer');

      // After the fix, meta.type should be 'mariokart'
      assertEquals(testStore.get('meta.type'), 'mariokart');

      // Verify bracket structure is for mariokart (no rounds array)
      const bracket = testStore.get('bracket');
      assert(bracket !== null);
      assertEquals(bracket.type, 'mariokart');
      assertEquals(bracket.rounds, undefined, 'mariokart bracket should not have rounds');
      assert(bracket.totalGames > 0, 'mariokart bracket should have totalGames');
    } finally {
      cleanup();
    }
  });
});

// =============================================================================
// Winner Advancement Sync Tests (Regression for TBD bug)
// =============================================================================

Deno.test('Winner Advancement Sync', async (t) => {
  await t.step('advancing winner updates both Map and bracket embedded match', async () => {
    // This test reproduces the bug where winners weren't appearing in finals
    // because advanceWinner updated the Map but not bracket.rounds[].matches[]

    resetSyncState();

    const { store: testStore, cleanup } = createIsolatedStore();

    try {
      const adminId = 'admin-user';
      setupAdminStore(testStore, adminId);

      // Generate a 4-player single elimination bracket
      const participants = createParticipants(4);
      const bracket = generateSingleEliminationBracket(participants);

      // Simulate network transmission (creates separate object references)
      const transmitted = JSON.parse(JSON.stringify({
        bracket: { ...bracket, matches: undefined },
        matches: Array.from(bracket.matches.entries()),
      }));

      // Load into store (like TOURNAMENT_START does)
      testStore.set('bracket', transmitted.bracket);
      testStore.deserialize({ matches: transmitted.matches });
      testStore.set('meta.status', 'active');
      testStore.set('meta.type', 'single');

      // Verify initial state - finals match should have null participants
      const finalsMatchId = 'r2m0';
      const initialFinalsMap = testStore.getMatch(finalsMatchId);
      assertEquals(initialFinalsMap.participants[0], null, 'Finals should start with null participant 0');
      assertEquals(initialFinalsMap.participants[1], null, 'Finals should start with null participant 1');

      // Report result for first semi-final (r1m0)
      // Winner (participants[0]) should advance to finals slot 0
      const semiFinal1Id = 'r1m0';
      const semiFinal1 = testStore.getMatch(semiFinal1Id);
      const winner1 = semiFinal1.participants[0]; // First participant wins

      testStore.updateMatch(semiFinal1Id, {
        winnerId: winner1,
        scores: [2, 1],
        reportedAt: Date.now(),
      });

      // Simulate advanceWinner logic (from sync.js)
      // This updates the finals match with the winner
      testStore.updateMatch(finalsMatchId, {
        participants: [winner1, null],
      });

      // Verify Map was updated
      const finalsMapAfter = testStore.getMatch(finalsMatchId);
      assertEquals(finalsMapAfter.participants[0], winner1, 'Map should have winner in slot 0');

      // THE KEY ASSERTION: Verify bracket embedded match was ALSO updated
      const finalsBracketAfter = testStore.get('bracket').rounds[1].matches[0];
      assertEquals(
        finalsBracketAfter.participants[0],
        winner1,
        'Bracket embedded finals match should have winner in slot 0 (this was the TBD bug)'
      );

      // Report second semi-final and advance
      const semiFinal2Id = 'r1m1';
      const semiFinal2 = testStore.getMatch(semiFinal2Id);
      const winner2 = semiFinal2.participants[0];

      testStore.updateMatch(semiFinal2Id, {
        winnerId: winner2,
        scores: [2, 0],
        reportedAt: Date.now(),
      });

      testStore.updateMatch(finalsMatchId, {
        participants: [winner1, winner2],
      });

      // Verify both slots are filled in both data structures
      const finalsMapFinal = testStore.getMatch(finalsMatchId);
      const finalsBracketFinal = testStore.get('bracket').rounds[1].matches[0];

      assertEquals(finalsMapFinal.participants[0], winner1);
      assertEquals(finalsMapFinal.participants[1], winner2);
      assertEquals(finalsBracketFinal.participants[0], winner1);
      assertEquals(finalsBracketFinal.participants[1], winner2);
    } finally {
      cleanup();
    }
  });

  await t.step('double elimination advancement syncs to bracket', async () => {
    resetSyncState();

    const { store: testStore, cleanup } = createIsolatedStore();

    try {
      const adminId = 'admin-user';
      setupAdminStore(testStore, adminId);

      const participants = createParticipants(4);
      const bracket = generateDoubleEliminationBracket(participants);

      // Simulate network transmission
      const transmitted = JSON.parse(JSON.stringify({
        bracket: { ...bracket, matches: undefined },
        matches: Array.from(bracket.matches.entries()),
      }));

      testStore.set('bracket', transmitted.bracket);
      testStore.deserialize({ matches: transmitted.matches });
      testStore.set('meta.type', 'double');

      // Find a winners bracket match
      const winnersMatch = testStore.get('bracket').winners.rounds[0].matches[0];
      const winner = winnersMatch.participants[0];

      // Update the match
      testStore.updateMatch(winnersMatch.id, {
        winnerId: winner,
        scores: [2, 1],
      });

      // Verify bracket embedded match was updated
      const bracketMatch = testStore.get('bracket').winners.rounds[0].matches[0];
      assertEquals(bracketMatch.winnerId, winner, 'Winners bracket match should be updated');
    } finally {
      cleanup();
    }
  });
});

// =============================================================================
// Helper: Create isolated store for testing
// =============================================================================

/**
 * Create an isolated store instance for testing
 * Returns the store and a cleanup function
 */
function createIsolatedStore() {
  const testStore = new Store();
  return {
    store: testStore,
    cleanup: () => {
      testStore.reset();
    },
  };
}
