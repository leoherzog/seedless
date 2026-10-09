/**
 * The results card appears as soon as a tournament completes, without a reload.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('Results card visibility', async (t) => {
  await t.test('stays hidden while the tournament is active', () => {
    const resultsView = setup();
    try {
      assert.deepStrictEqual(resultsView.hidden, true);
    } finally {
      cleanupBracketView();
    }
  });

  await t.test('appears and scrolls into view when the tournament completes', () => {
    const resultsView = setup();
    try {
      store.set('meta.status', 'complete');
      assert.deepStrictEqual(resultsView.hidden, false);
      assert.deepStrictEqual(resultsView.scrollCount, 1);

      // Later changes re-render without yanking the page back up.
      store.set('meta.name', 'Renamed');
      assert(!resultsView.hidden);
      assert.deepStrictEqual(resultsView.scrollCount, 1);
    } finally {
      cleanupBracketView();
    }
  });
});
