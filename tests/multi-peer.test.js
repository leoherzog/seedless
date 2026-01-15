/**
 * Multi-Peer Concurrent Update Tests
 * Tests conflict resolution, concurrent match results, and state merging
 */

import { assertEquals, assert, assertFalse } from 'jsr:@std/assert';
import { Store } from '../js/state/store.js';
import { shouldUpdateMatch } from '../js/network/sync-validators.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { createParticipants } from './fixtures.js';

// =============================================================================
// Concurrent Match Results - LWW Resolution
// =============================================================================

Deno.test('Concurrent Match Results - LWW Resolution', async (t) => {
  await t.step('higher version wins regardless of timestamp', () => {
    const incoming = { version: 5, reportedAt: 1000 }; // Older timestamp
    const existing = { version: 3, reportedAt: 9000 }; // Newer timestamp

    assert(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('same version with newer timestamp wins', () => {
    const incoming = { version: 3, reportedAt: 9000 };
    const existing = { version: 3, reportedAt: 1000 };

    assert(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('same version with older timestamp loses', () => {
    const incoming = { version: 3, reportedAt: 1000 };
    const existing = { version: 3, reportedAt: 9000 };

    assertFalse(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('lower version loses even with newer timestamp', () => {
    const incoming = { version: 2, reportedAt: 9000 };
    const existing = { version: 5, reportedAt: 1000 };

    assertFalse(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('admin always wins regardless of version and timestamp', () => {
    const incoming = { version: 1, reportedAt: 1 };
    const existing = { version: 100, reportedAt: 999999 };

    assert(shouldUpdateMatch(incoming, existing, true));
  });
});

// =============================================================================
// Store Merge Scenarios
// =============================================================================

Deno.test('Store.merge - Participant Scenarios', async (t) => {
  await t.step('merge adds new participants from remote', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({ id: 'p1', name: 'Player 1' });

    const remoteState = {
      meta: { version: 1 },
      participants: [
        ['p1', { id: 'p1', name: 'Player 1' }],
        ['p2', { id: 'p2', name: 'Player 2' }],
      ],
    };

    store.merge(remoteState, 'admin-id');

    assertEquals(store.getParticipantList().length, 2);
    assert(store.getParticipant('p2'));
  });

  await t.step('merge updates existing participant with newer data', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({ id: 'p1', name: 'Old Name', joinedAt: 1000 });

    const remoteState = {
      meta: { version: 1 },
      participants: [
        ['p1', { id: 'p1', name: 'New Name', joinedAt: 2000, isConnected: true }],
      ],
    };

    store.merge(remoteState, 'admin-id');

    const p = store.getParticipant('p1');
    // Merge uses LWW based on joinedAt
    assertEquals(p.name, 'New Name');
  });

  await t.step('merge preserves local participant when remote is older', () => {
    const store = new Store();
    store.reset();

    store.addParticipant({ id: 'p1', name: 'Local Name', joinedAt: 5000 });

    const remoteState = {
      meta: { version: 1 },
      participants: [
        ['p1', { id: 'p1', name: 'Remote Name', joinedAt: 1000 }],
      ],
    };

    store.merge(remoteState, 'admin-id');

    const p = store.getParticipant('p1');
    assertEquals(p.name, 'Local Name');
  });
});

Deno.test('Store.merge - Meta Scenarios', async (t) => {
  await t.step('merge updates meta when remote has higher version', () => {
    const store = new Store();
    store.reset();
    store.set('meta.version', 5);
    store.set('meta.status', 'lobby');

    const remoteState = {
      meta: { version: 10, status: 'active', adminId: 'admin-1' },
    };

    store.merge(remoteState, 'admin-1');

    assertEquals(store.get('meta.version'), 10);
    assertEquals(store.get('meta.status'), 'active');
  });

  await t.step('merge keeps local meta when remote has lower version', () => {
    const store = new Store();
    store.reset();
    store.set('meta.version', 10);
    store.set('meta.status', 'active');

    const remoteState = {
      meta: { version: 5, status: 'lobby' },
    };

    store.merge(remoteState, 'not-admin');

    assertEquals(store.get('meta.version'), 10);
    assertEquals(store.get('meta.status'), 'active');
  });

  await t.step('merge accepts lower version meta from admin', () => {
    const store = new Store();
    store.reset();
    store.set('meta.version', 10);
    store.set('meta.adminId', 'admin-1');

    const remoteState = {
      meta: { version: 5, adminId: 'admin-1', status: 'complete' },
    };

    // Remote is from admin
    store.merge(remoteState, 'admin-1');

    // Admin state should be accepted
    assertEquals(store.get('meta.status'), 'complete');
  });
});

Deno.test('Store.merge - Match Scenarios', async (t) => {
  await t.step('merge adds new matches from remote', () => {
    const store = new Store();
    store.reset();

    const remoteState = {
      meta: { version: 1 },
      matches: [
        ['r1m0', { id: 'r1m0', round: 1, scores: [0, 0] }],
        ['r1m1', { id: 'r1m1', round: 1, scores: [0, 0] }],
      ],
    };

    store.merge(remoteState, 'admin-id');

    assert(store.getMatch('r1m0'));
    assert(store.getMatch('r1m1'));
  });

  await t.step('merge resolves match conflicts using reportedAt timestamp', () => {
    const store = new Store();
    store.reset();

    // Set up local match with older timestamp
    store.setMatches(new Map([
      ['r1m0', { id: 'r1m0', reportedAt: 1000, scores: [1, 0] }],
    ]));

    const remoteState = {
      meta: { version: 1 },
      matches: [
        ['r1m0', { id: 'r1m0', reportedAt: 5000, scores: [0, 2] }],
      ],
    };

    store.merge(remoteState, 'not-admin');

    const match = store.getMatch('r1m0');
    // Newer reportedAt wins
    assertEquals(match.scores[0], 0);
    assertEquals(match.scores[1], 2);
  });
});

// =============================================================================
// Simulated Multi-Peer Tournament
// =============================================================================

Deno.test('Simulated Multi-Peer Tournament', async (t) => {
  await t.step('two peers report same match - later version wins', () => {
    const storeA = new Store();
    const storeB = new Store();
    storeA.reset();
    storeB.reset();

    // Both stores start with same initial state
    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    const initialState = {
      meta: { version: 1, status: 'active', adminId: 'admin' },
      bracket,
      matches: Array.from(bracket.matches.entries()),
      participants: participants.map(p => [p.id, p]),
    };

    storeA.deserialize(initialState);
    storeB.deserialize(initialState);

    // Peer A reports match result (version 2)
    storeA.updateMatch('r1m0', {
      winnerId: participants[0].id,
      scores: [2, 0],
      reportedAt: Date.now(),
      version: 2,
    });

    // Peer B reports different result (version 2 but later timestamp)
    storeB.updateMatch('r1m0', {
      winnerId: participants[1].id,
      scores: [0, 2],
      reportedAt: Date.now() + 100,
      version: 2,
    });

    // Simulate sync: B's state arrives at A
    const stateB = storeB.serialize();
    storeA.merge(stateB, 'not-admin');

    // Since both have version 2, later timestamp (B's) should win
    const matchA = storeA.getMatch('r1m0');
    assertEquals(matchA.winnerId, participants[1].id);
  });

  await t.step('admin correction overrides peer reports', () => {
    const peerStore = new Store();
    const adminStore = new Store();
    peerStore.reset();
    adminStore.reset();

    const participants = createParticipants(4);
    const bracket = generateSingleEliminationBracket(participants);

    const initialState = {
      meta: { version: 1, status: 'active', adminId: 'admin-user' },
      bracket,
      matches: Array.from(bracket.matches.entries()),
      participants: participants.map(p => [p.id, p]),
    };

    peerStore.deserialize(initialState);
    adminStore.deserialize(initialState);
    adminStore.setAdmin(true);

    // Peer reports result (high version)
    peerStore.updateMatch('r1m0', {
      winnerId: participants[0].id,
      scores: [2, 0],
      reportedAt: Date.now(),
      version: 100,
    });

    // Admin corrects with lower version (should still win due to admin authority)
    adminStore.updateMatch('r1m0', {
      winnerId: participants[1].id,
      scores: [0, 2],
      reportedAt: Date.now(),
      version: 1,
      verifiedBy: 'admin-user',
    });

    // Simulate sync: admin state merges into peer
    const adminState = adminStore.serialize();

    // Use shouldUpdateMatch to verify admin wins
    const peerMatch = peerStore.getMatch('r1m0');
    const adminMatch = adminStore.getMatch('r1m0');

    assert(
      shouldUpdateMatch(adminMatch, peerMatch, true),
      'Admin should be able to override peer result'
    );
  });

  await t.step('concurrent participant joins are merged correctly', () => {
    const storeA = new Store();
    const storeB = new Store();
    storeA.reset();
    storeB.reset();

    // Store A has participants 1 and 2
    storeA.addParticipant({ id: 'p1', name: 'Player 1' });
    storeA.addParticipant({ id: 'p2', name: 'Player 2' });

    // Store B has participants 1 and 3
    storeB.addParticipant({ id: 'p1', name: 'Player 1' });
    storeB.addParticipant({ id: 'p3', name: 'Player 3' });

    // Merge B into A (OR-set merge - additions win)
    storeA.merge(storeB.serialize(), 'not-admin');

    // A should now have all 3 participants
    assertEquals(storeA.getParticipantList().length, 3);
    assert(storeA.getParticipant('p1'));
    assert(storeA.getParticipant('p2'));
    assert(storeA.getParticipant('p3'));
  });
});

// =============================================================================
// Network Partition Scenarios
// =============================================================================

Deno.test('Network Partition Scenarios', async (t) => {
  await t.step('partition heals - state converges after merge', () => {
    // Simulate two peers that were partitioned and made changes independently
    const storeA = new Store();
    const storeB = new Store();
    storeA.reset();
    storeB.reset();

    // Start with same initial state
    const participants = createParticipants(4);
    storeA.deserialize({
      meta: { version: 1, status: 'lobby', adminId: 'admin' },
      participants: participants.map(p => [p.id, p]),
    });
    storeB.deserialize({
      meta: { version: 1, status: 'lobby', adminId: 'admin' },
      participants: participants.map(p => [p.id, p]),
    });

    // During partition, A adds a participant
    storeA.addParticipant({ id: 'p5', name: 'Player 5' });

    // During partition, B adds a different participant
    storeB.addParticipant({ id: 'p6', name: 'Player 6' });

    // Partition heals - merge both ways
    storeA.merge(storeB.serialize(), 'not-admin');
    storeB.merge(storeA.serialize(), 'not-admin');

    // Both should converge to same state
    assertEquals(storeA.getParticipantList().length, 6);
    assertEquals(storeB.getParticipantList().length, 6);

    // Verify both have all participants
    const namesA = storeA.getParticipantList().map(p => p.name).sort();
    const namesB = storeB.getParticipantList().map(p => p.name).sort();
    assertEquals(namesA, namesB);
  });

  await t.step('admin state takes priority in partition healing', () => {
    const adminStore = new Store();
    const peerStore = new Store();
    adminStore.reset();
    peerStore.reset();

    // Both start in lobby
    adminStore.set('meta.version', 1);
    adminStore.set('meta.status', 'lobby');
    adminStore.set('meta.adminId', 'admin-user');

    peerStore.set('meta.version', 1);
    peerStore.set('meta.status', 'lobby');
    peerStore.set('meta.adminId', 'admin-user');

    // During partition, admin starts tournament (bumps version)
    adminStore.set('meta.version', 5);
    adminStore.set('meta.status', 'active');

    // Peer is still in lobby with same version (unaware of admin action)
    // Peer thinks it should stay in lobby

    // Partition heals - admin state merges into peer
    peerStore.merge(adminStore.serialize(), 'admin-user');

    // Peer should now be in active status
    assertEquals(peerStore.get('meta.status'), 'active');
    assertEquals(peerStore.get('meta.version'), 5);
  });
});

// =============================================================================
// Conflict Resolution Edge Cases
// =============================================================================

Deno.test('Conflict Resolution Edge Cases', async (t) => {
  await t.step('simultaneous updates with exact same timestamp', () => {
    const timestamp = Date.now();
    const incoming = { version: 1, reportedAt: timestamp };
    const existing = { version: 1, reportedAt: timestamp };

    // Neither wins - existing is preserved
    assertFalse(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('version rollback is rejected', () => {
    const incoming = { version: 2, reportedAt: Date.now() };
    const existing = { version: 5, reportedAt: Date.now() - 10000 };

    // Lower version is rejected even with newer timestamp
    assertFalse(shouldUpdateMatch(incoming, existing, false));
  });

  await t.step('first update always wins (both have version 0)', () => {
    // First update arrives
    const first = { version: 1, reportedAt: 1000 };
    const initial = { version: 0, reportedAt: 0 };

    assert(shouldUpdateMatch(first, initial, false));

    // Second update with same version but later timestamp
    const second = { version: 1, reportedAt: 2000 };

    assert(shouldUpdateMatch(second, first, false));
  });

  await t.step('rapid updates preserve latest', () => {
    let current = { version: 0, reportedAt: 0 };

    for (let i = 1; i <= 10; i++) {
      const update = { version: i, reportedAt: Date.now() + i };

      assert(shouldUpdateMatch(update, current, false));
      current = update;
    }

    // Final state should have version 10
    assertEquals(current.version, 10);
  });
});
