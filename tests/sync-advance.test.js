/**
 * Bracket advancement through the production path: a tournament loaded into the
 * store as a peer receives it, with every result reported through sync.
 */

import { assertEquals } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { advanceWinner, reportMatchResult } from '../js/network/sync.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { generateDoubleEliminationBracket, getStandings } from '../js/tournament/double-elimination.js';
import { generateDoublesTournament } from '../js/tournament/doubles.js';
import { createParticipants, createParticipantMap, createTeamAssignments } from './fixtures.js';

/** Reset the store and load a generated tournament through a JSON round trip. */
function loadFromNetwork({ bracket, matches }) {
  store.reset();
  store.deserialize(JSON.parse(JSON.stringify({ matches: [...matches], bracket })));
  store.set('meta.status', 'active');
}

/**
 * Report a 2-0 result for every playable match until none remain.
 * @param {Function} [pick] - Chooses the winner of a match
 * @param {string} [holdId] - A match to leave unplayed
 */
function playAll(pick = (m) => m.participants[0], holdId = null) {
  for (let progressed = true; progressed;) {
    progressed = false;
    for (const m of store.get('matches').values()) {
      if (m.id === holdId || m.isBye || m.winnerId || !m.participants[0] || !m.participants[1]) continue;
      reportMatchResult(null, m.id, [2, 0], pick(m));
      progressed = true;
    }
  }
}

Deno.test('Double elimination through sync completes and places everyone', async (t) => {
  for (const n of [2, 3, 5, 6, 7]) {
    await t.step(`N=${n}`, () => {
      const participants = createParticipants(n);
      loadFromNetwork(generateDoubleEliminationBracket(participants));

      playAll();

      assertEquals(store.get('meta.status'), 'complete');
      const standings = getStandings(store.get('bracket'), store.get('matches'), createParticipantMap(participants));
      assertEquals(standings.map((s) => s.place), participants.map((_, i) => i + 1));
      assertEquals(new Set(standings.map((s) => s.participantId)).size, n);
    });
  }
});

Deno.test('Double elimination through sync plays the reset after a gf1 loss by the winners champion', () => {
  loadFromNetwork(generateDoubleEliminationBracket(createParticipants(4)));

  playAll((m) => (m.id === 'gf1' ? m.participants[1] : m.participants[0]), 'gf2');

  const gf1 = store.getMatch('gf1');
  const gf2 = store.getMatch('gf2');
  assertEquals(gf1.winnerId, gf1.participants[1]);
  assertEquals(gf2.requiresPlay, true);
  assertEquals(gf2.participants, gf1.participants);
  assertEquals(store.get('meta.status'), 'active', 'the reset is still to play');

  reportMatchResult(null, 'gf2', [2, 0], gf2.participants[0]);
  assertEquals(store.get('meta.status'), 'complete');
});

Deno.test('Single elimination through sync completes', () => {
  loadFromNetwork(generateSingleEliminationBracket(createParticipants(5)));
  playAll();
  assertEquals(store.get('meta.status'), 'complete');
});

Deno.test('Double-elimination doubles through sync completes', () => {
  const participants = createParticipants(6);
  loadFromNetwork(generateDoublesTournament(participants, createTeamAssignments(participants), { bracketType: 'double' }));
  playAll();
  assertEquals(store.get('meta.status'), 'complete');
});

Deno.test('advanceWinner ignores an undecided match and a missing bracket', () => {
  loadFromNetwork(generateSingleEliminationBracket(createParticipants(4)));
  advanceWinner('r1m0');
  assertEquals(store.getMatch('r2m0').participants, [null, null]);

  store.set('bracket', null);
  advanceWinner('r1m0');
  assertEquals(store.get('meta.status'), 'active');
});
