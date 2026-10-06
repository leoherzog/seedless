/**
 * seedParticipants orders by manual seed, not join order, and random mode keeps everyone once.
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { seedParticipants, shuffle } from '../js/utils/tournament-helpers.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';

/** Participants A-D in join order, with drag-drop seeds D=1, A=2, B=3, C=4. */
function manuallySeeded() {
  return [
    { id: 'p-a', name: 'A', seed: 2 },
    { id: 'p-b', name: 'B', seed: 3 },
    { id: 'p-c', name: 'C', seed: 4 },
    { id: 'p-d', name: 'D', seed: 1 },
  ];
}

Deno.test('Manual seeding', async (t) => {
  await t.step('drag-drop seed order overrides join order', () => {
    const seeded = seedParticipants(manuallySeeded(), 'manual');
    assertEquals(seeded.map(p => p.id), ['p-d', 'p-a', 'p-b', 'p-c']);
  });

  await t.step('returns a new array and leaves the input in join order', () => {
    const participants = manuallySeeded();
    const seeded = seedParticipants(participants, 'manual');
    assert(seeded !== participants);
    assertEquals(participants.map(p => p.id), ['p-a', 'p-b', 'p-c', 'p-d']);
  });

  await t.step('unseeded participants sort last', () => {
    const seeded = seedParticipants([{ id: 'late' }, { id: 'first', seed: 1 }], 'manual');
    assertEquals(seeded.map(p => p.id), ['first', 'late']);
  });

  await t.step('the bracket pairs manual seeds, not join order', () => {
    const seeded = seedParticipants(manuallySeeded(), 'manual');
    seeded.forEach((p, i) => { p.seed = i + 1; });
    const { bracket, matches } = generateSingleEliminationBracket(seeded);

    // 4-bracket seeding pairs 1v4 and 2v3: D vs C, then A vs B.
    const round1 = bracket.rounds[0].matchIds.map(id => matches.get(id).participants);
    assertEquals(round1, [['p-d', 'p-c'], ['p-a', 'p-b']]);
  });
});

Deno.test('Random seeding', async (t) => {
  await t.step('keeps every participant exactly once', () => {
    const participants = Array.from({ length: 8 }, (_, i) => ({ id: `p-${i + 1}`, seed: i + 1 }));
    const seeded = seedParticipants(participants, 'random');

    assertEquals(seeded.length, 8);
    assertEquals(new Set(seeded).size, 8);
    assertEquals(participants.map(p => p.id), participants.map((_, i) => `p-${i + 1}`));
  });

  await t.step('shuffle permutes in place and returns the same array', () => {
    const items = [1, 2, 3, 4, 5];
    assert(shuffle(items) === items);
    assertEquals(items.toSorted(), [1, 2, 3, 4, 5]);
  });

  await t.step('shuffle reaches every ordering', () => {
    const seen = new Set();
    for (let i = 0; i < 500 && seen.size < 6; i++) {
      seen.add(shuffle(['a', 'b', 'c']).join(''));
    }
    assertEquals(seen.size, 6);
  });
});
