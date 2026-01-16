/**
 * Tests for advanceWinner double-elimination behavior using the singleton store.
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { advanceWinner, resetSyncState } from '../js/network/sync.js';
import { generateDoubleEliminationBracket } from '../js/tournament/double-elimination.js';
import { createParticipants } from './fixtures.js';

Deno.test('advanceWinner uses store matches when bracket.matches is missing', () => {
  resetSyncState();
  store.reset();

  try {
    const participants = createParticipants(4);
    const bracket = generateDoubleEliminationBracket(participants);

    // Simulate network transmission: bracket without matches map
    const bracketForStore = { ...bracket, matches: undefined };
    store.set('bracket', bracketForStore);
    store.setMatches(bracket.matches);
    store.set('meta.type', 'double');

    const winnersMatch = bracket.winners.rounds[0].matches[0];
    const winnerId = winnersMatch.participants[0];
    const loserId = winnersMatch.participants[1];

    advanceWinner(winnersMatch.id, winnerId);

    // Winner should advance to winners finals slot 0
    const winnersFinals = store.getMatch('w2m0');
    assertEquals(winnersFinals.participants[0], winnerId);

    // Loser should be dropped into losers bracket
    const losersHasLoser = store.get('bracket').losers.rounds
      .some(round => round.matches.some(match => match.participants.includes(loserId)));
    assert(losersHasLoser, 'Loser should be placed into losers bracket');

    // Bracket should still not contain matches map
    assertEquals(store.get('bracket').matches, undefined);
  } finally {
    store.reset();
    resetSyncState();
  }
});
