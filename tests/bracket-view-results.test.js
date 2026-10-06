/**
 * The results card appears as soon as a tournament completes, without a reload.
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { initBracketView, cleanupBracketView } from '../js/components/bracket-view.js';
import { installBracketViewDom } from './fixtures.js';

function setup() {
  store.reset();
  const resultsView = installBracketViewDom()._elements.get('results-view');
  resultsView.scrollCount = 0;
  resultsView.scrollIntoView = () => { resultsView.scrollCount++; };
  initBracketView();

  store.set('participants', new Map([
    ['p1', { id: 'p1', name: 'Alice' }],
    ['p2', { id: 'p2', name: 'Bob' }],
  ]));
  store.setMatches(new Map([
    ['m1', { id: 'm1', position: 0, participants: ['p1', 'p2'], scores: [0, 0], winnerId: null, isBye: false }],
  ]));
  store.set('bracket', {
    rounds: [{ number: 1, name: 'Final', matchIds: ['m1'] }],
  });
  store.set('meta.type', 'single');
  store.set('meta.status', 'active');
  return resultsView;
}

Deno.test('Results card visibility', async (t) => {
  await t.step('stays hidden while the tournament is active', () => {
    const resultsView = setup();
    try {
      assertEquals(resultsView.hidden, true);
    } finally {
      cleanupBracketView();
    }
  });

  await t.step('appears and scrolls into view when the tournament completes', () => {
    const resultsView = setup();
    try {
      store.set('meta.status', 'complete');
      assertEquals(resultsView.hidden, false);
      assertEquals(resultsView.scrollCount, 1);

      // Later changes re-render without yanking the page back up.
      store.set('meta.name', 'Renamed');
      assert(!resultsView.hidden);
      assertEquals(resultsView.scrollCount, 1);
    } finally {
      cleanupBracketView();
    }
  });
});
