/**
 * Regression tests for lobby manual/random seeding order
 *
 * Bug context: `onStartTournament` in js/components/lobby.js must order
 * participants by their (possibly drag-drop re-assigned) `seed` field when
 * seedingMode is 'manual' -- NOT by join/insertion order. Previously the
 * join order could leak through and silently override the admin's manual
 * arrangement.
 *
 * lobby.js does not export `onStartTournament` (it's a private DOM event
 * handler) and the function itself doesn't touch the DOM beyond dynamic
 * imports of tournament generators, so per the assignment we exercise the
 * exact seeding branch (mirrored from lobby.js lines ~580-597) against a
 * real Store, then feed the result into the real bracket generator to
 * confirm the manual arrangement -- not the join order -- drives the
 * resulting bracket.
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { Store } from '../js/state/store.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';

/**
 * Mirrors the seeding branch of onStartTournament (js/components/lobby.js):
 *   - 'random': Fisher-Yates shuffle
 *   - 'manual': sort by existing seed (the admin's drag-drop order)
 *   - otherwise: leave as-is
 * Then reassigns seeds 1..n based on the resulting order and writes them
 * back to the store, exactly like the real handler does.
 */
function applySeedingAndReassign(store, seedingMode) {
  const participants = store.getParticipantList();
  let seeded = [...participants];

  if (seedingMode === 'random') {
    for (let i = seeded.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seeded[i], seeded[j]] = [seeded[j], seeded[i]];
    }
  } else if (seedingMode === 'manual') {
    seeded.sort((a, b) => (a.seed || 999) - (b.seed || 999));
  }

  seeded.forEach((p, i) => {
    p.seed = i + 1;
    store.updateParticipant(p.id, { seed: i + 1 });
  });

  return seeded;
}

Deno.test('Manual seeding - drag-drop order overrides join order', async (t) => {
  await t.step('participants join in order A, B, C, D', () => {
    const store = new Store();
    store.addParticipant({ id: 'p-a', name: 'A', joinedAt: 1000 });
    store.addParticipant({ id: 'p-b', name: 'B', joinedAt: 2000 });
    store.addParticipant({ id: 'p-c', name: 'C', joinedAt: 3000 });
    store.addParticipant({ id: 'p-d', name: 'D', joinedAt: 4000 });

    const joinOrder = store.getParticipantList().map(p => p.id);
    assertEquals(joinOrder, ['p-a', 'p-b', 'p-c', 'p-d']);
    // Default seeds mirror join order until the admin re-seeds manually
    assertEquals(store.getParticipant('p-a').seed, 1);
    assertEquals(store.getParticipant('p-d').seed, 4);
  });

  await t.step('admin drag-drop re-seeds to D, A, B, C', () => {
    const store = new Store();
    store.addParticipant({ id: 'p-a', name: 'A', joinedAt: 1000 });
    store.addParticipant({ id: 'p-b', name: 'B', joinedAt: 2000 });
    store.addParticipant({ id: 'p-c', name: 'C', joinedAt: 3000 });
    store.addParticipant({ id: 'p-d', name: 'D', joinedAt: 4000 });
    store.set('meta.config.seedingMode', 'manual');

    // Simulate the drag-drop handler (onDrop in lobby.js) writing new seeds
    // in the admin's chosen visual order: D=1, A=2, B=3, C=4
    store.updateParticipant('p-d', { seed: 1 });
    store.updateParticipant('p-a', { seed: 2 });
    store.updateParticipant('p-b', { seed: 3 });
    store.updateParticipant('p-c', { seed: 4 });

    // getParticipantList still returns join/insertion order -- the manual
    // seeds must be what reorders the field, not this insertion order.
    assertEquals(store.getParticipantList().map(p => p.id), ['p-a', 'p-b', 'p-c', 'p-d']);

    const seeded = applySeedingAndReassign(store, 'manual');

    // The seeding branch must produce D, A, B, C -- the manual arrangement --
    // not A, B, C, D (join order).
    assertEquals(seeded.map(p => p.id), ['p-d', 'p-a', 'p-b', 'p-c']);
    assertEquals(seeded.map(p => p.seed), [1, 2, 3, 4]);
  });

  await t.step('reassigned seeds are persisted back to the store', () => {
    const store = new Store();
    store.addParticipant({ id: 'p-a', name: 'A', joinedAt: 1000 });
    store.addParticipant({ id: 'p-b', name: 'B', joinedAt: 2000 });
    store.addParticipant({ id: 'p-c', name: 'C', joinedAt: 3000 });
    store.addParticipant({ id: 'p-d', name: 'D', joinedAt: 4000 });
    store.set('meta.config.seedingMode', 'manual');

    store.updateParticipant('p-d', { seed: 1 });
    store.updateParticipant('p-a', { seed: 2 });
    store.updateParticipant('p-b', { seed: 3 });
    store.updateParticipant('p-c', { seed: 4 });

    applySeedingAndReassign(store, 'manual');

    assertEquals(store.getParticipant('p-d').seed, 1);
    assertEquals(store.getParticipant('p-a').seed, 2);
    assertEquals(store.getParticipant('p-b').seed, 3);
    assertEquals(store.getParticipant('p-c').seed, 4);
  });

  await t.step('resulting bracket reflects manual seed order, not join order', () => {
    const store = new Store();
    store.addParticipant({ id: 'p-a', name: 'A', joinedAt: 1000 });
    store.addParticipant({ id: 'p-b', name: 'B', joinedAt: 2000 });
    store.addParticipant({ id: 'p-c', name: 'C', joinedAt: 3000 });
    store.addParticipant({ id: 'p-d', name: 'D', joinedAt: 4000 });
    store.set('meta.config.seedingMode', 'manual');

    // Manual re-seed: D=1, A=2, B=3, C=4
    store.updateParticipant('p-d', { seed: 1 });
    store.updateParticipant('p-a', { seed: 2 });
    store.updateParticipant('p-b', { seed: 3 });
    store.updateParticipant('p-c', { seed: 4 });

    const seeded = applySeedingAndReassign(store, 'manual');
    const bracket = generateSingleEliminationBracket(seeded, {});

    // Standard 4-bracket seeding order is [1, 4, 2, 3]: seed1 vs seed4 in the
    // first slot, seed2 vs seed3 in the second. With the manual arrangement
    // seed1=D, seed2=A, seed3=B, seed4=C, so round 1 must pair D vs C and
    // A vs B -- never the join-order pairing of A vs B / C vs D would be a
    // coincidence here only because it's the same as the manual grouping for
    // the second match, so also assert match 0 explicitly excludes A vs D
    // (the join-order-seeded pairing) to catch a regression to join order.
    const round1 = bracket.rounds[0].matches;
    assertEquals(round1.length, 2);

    const match0 = round1.find(m => m.position === 0);
    const match1 = round1.find(m => m.position === 1);

    // seed1 (D) vs seed4 (C)
    assert(match0.participants.includes('p-d'));
    assert(match0.participants.includes('p-c'));
    // seed2 (A) vs seed3 (B)
    assert(match1.participants.includes('p-a'));
    assert(match1.participants.includes('p-b'));

    // Explicitly rule out the join-order seeding (A=1,B=2,C=3,D=4 would pair
    // A vs D in match 0) -- guards against a regression back to join order.
    assert(!(match0.participants.includes('p-a') && match0.participants.includes('p-d')));
  });
});

Deno.test('Random seeding - shuffle branch still runs and preserves participants', async (t) => {
  await t.step('all participants remain present after shuffle', () => {
    const store = new Store();
    store.addParticipant({ id: 'p-a', name: 'A', joinedAt: 1000 });
    store.addParticipant({ id: 'p-b', name: 'B', joinedAt: 2000 });
    store.addParticipant({ id: 'p-c', name: 'C', joinedAt: 3000 });
    store.addParticipant({ id: 'p-d', name: 'D', joinedAt: 4000 });
    store.set('meta.config.seedingMode', 'random');

    const seeded = applySeedingAndReassign(store, 'random');

    assertEquals(seeded.length, 4);
    const ids = seeded.map(p => p.id).sort();
    assertEquals(ids, ['p-a', 'p-b', 'p-c', 'p-d']);
  });

  await t.step('seeds 1..n are assigned exactly once each', () => {
    const store = new Store();
    for (let i = 1; i <= 8; i++) {
      store.addParticipant({ id: `p-${i}`, name: `Player ${i}`, joinedAt: i * 1000 });
    }
    store.set('meta.config.seedingMode', 'random');

    const seeded = applySeedingAndReassign(store, 'random');
    const seeds = seeded.map(p => p.seed).sort((a, b) => a - b);
    assertEquals(seeds, [1, 2, 3, 4, 5, 6, 7, 8]);

    // Persisted seeds in the store must match 1..n with no duplicates/gaps
    const storeSeeds = store.getParticipantList().map(p => p.seed).sort((a, b) => a - b);
    assertEquals(storeSeeds, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  await t.step('random mode produces a fully generatable bracket', () => {
    const store = new Store();
    for (let i = 1; i <= 5; i++) {
      store.addParticipant({ id: `p-${i}`, name: `Player ${i}`, joinedAt: i * 1000 });
    }
    store.set('meta.config.seedingMode', 'random');

    const seeded = applySeedingAndReassign(store, 'random');
    const bracket = generateSingleEliminationBracket(seeded, {});

    // 5 participants -> padded to bracket size 8, 3 rounds
    assertEquals(bracket.bracketSize, 8);
    assertEquals(bracket.numRounds, 3);
    assertEquals(bracket.participantCount, 5);

    // Every seeded participant appears exactly once across round 1 slots
    const round1ParticipantIds = bracket.rounds[0].matches
      .flatMap(m => m.participants)
      .filter(id => id !== null);
    assertEquals(round1ParticipantIds.length, 5);
    assertEquals(new Set(round1ParticipantIds).size, 5);
  });
});
