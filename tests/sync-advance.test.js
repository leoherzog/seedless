/**
 * Bracket advancement through the production path: a tournament loaded into the
 * store as a peer receives it, with every result reported through sync, and
 * edits that invalidate later results.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { store } from '../js/state/store.js';
import { reconcile, reportMatchResult } from '../js/network/sync.js';
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

test('Double elimination through sync completes and places everyone', async (t) => {
  for (const n of [2, 3, 5, 6, 7]) {
    await t.test(`N=${n}`, () => {
      const participants = createParticipants(n);
      loadFromNetwork(generateDoubleEliminationBracket(participants));

      playAll();

      assert.deepStrictEqual(store.get('meta.status'), 'complete');
      const standings = getStandings(store.get('bracket'), store.get('matches'), createParticipantMap(participants));
      assert.deepStrictEqual(standings.map((s) => s.place), participants.map((_, i) => i + 1));
      assert.deepStrictEqual(new Set(standings.map((s) => s.participantId)).size, n);
    });
  }
});

test('Double elimination through sync plays the reset after a gf1 loss by the winners champion', () => {
  loadFromNetwork(generateDoubleEliminationBracket(createParticipants(4)));

  playAll((m) => (m.id === 'gf1' ? m.participants[1] : m.participants[0]), 'gf2');

  const gf1 = store.getMatch('gf1');
  const gf2 = store.getMatch('gf2');
  assert.deepStrictEqual(gf1.winnerId, gf1.participants[1]);
  assert.deepStrictEqual(gf2.requiresPlay, true);
  assert.deepStrictEqual(gf2.participants, gf1.participants);
  assert.deepStrictEqual(store.get('meta.status'), 'active', 'the reset is still to play');

  reportMatchResult(null, 'gf2', [2, 0], gf2.participants[0]);
  assert.deepStrictEqual(store.get('meta.status'), 'complete');
});

test('Single elimination through sync completes', () => {
  loadFromNetwork(generateSingleEliminationBracket(createParticipants(5)));
  playAll();
  assert.deepStrictEqual(store.get('meta.status'), 'complete');
});

test('Double-elimination doubles through sync completes', () => {
  const participants = createParticipants(6);
  loadFromNetwork(generateDoublesTournament(participants, createTeamAssignments(participants), { bracketType: 'double' }));
  playAll();
  assert.deepStrictEqual(store.get('meta.status'), 'complete');
});

test('reconcile leaves undecided matches alone and ignores a missing bracket', () => {
  loadFromNetwork(generateSingleEliminationBracket(createParticipants(4)));
  reconcile();
  assert.deepStrictEqual(store.getMatch('r2m0').participants, [null, null]);

  store.updateMatch('r1m0', { winnerId: store.getMatch('r1m0').participants[0] });
  store.set('bracket', null);
  reconcile();
  assert.deepStrictEqual(store.getMatch('r2m0').participants, [null, null]);
  assert.deepStrictEqual(store.get('meta.status'), 'active');
});

test('Editing a result after later matches are decided', async (t) => {
  await t.test('single elimination clears the results the old winner went on to earn', () => {
    loadFromNetwork(generateSingleEliminationBracket(createParticipants(4)));
    playAll();
    assert.deepStrictEqual(store.get('meta.status'), 'complete');
    const champion = store.getMatch('r2m0').winnerId;
    assert.deepStrictEqual(champion, 'player-1');

    // The admin corrects r1m0: player-1 lost it.
    reportMatchResult(null, 'r1m0', [0, 2], 'player-4');

    const final = store.getMatch('r2m0');
    assert.deepStrictEqual(final.participants, ['player-4', 'player-2']);
    assert.deepStrictEqual(final.winnerId, null, 'a final won by a player no longer in it is cleared');
    assert.deepStrictEqual(store.get('meta.status'), 'active', 'the tournament reopens');

    reportMatchResult(null, 'r2m0', [2, 0], 'player-4');
    assert.deepStrictEqual(store.get('meta.status'), 'complete');
  });

  await t.test('double elimination re-derives a walkover for the new loser', () => {
    const participants = createParticipants(3);
    loadFromNetwork(generateDoubleEliminationBracket(participants));
    const played = store.getMatch('w1m1');
    const [first, second] = played.participants;

    reportMatchResult(null, 'w1m1', [2, 0], first);
    reportMatchResult(null, 'w1m1', [0, 2], second);

    const seated = [...store.get('matches').values()]
      .filter((m) => m.bracket === 'losers')
      .flatMap((m) => m.participants.filter(Boolean));
    assert.deepStrictEqual(seated.includes(first), true, 'the new loser drops into the losers bracket');
    assert.deepStrictEqual(seated.includes(second), false, 'the new winner is not also in the losers bracket');

    playAll();
    assert.deepStrictEqual(store.get('meta.status'), 'complete');
    const standings = getStandings(store.get('bracket'), store.get('matches'), createParticipantMap(participants));
    assert.deepStrictEqual(new Set(standings.map((s) => s.participantId)).size, 3);
  });
});
