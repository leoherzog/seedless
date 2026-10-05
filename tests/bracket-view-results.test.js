/**
 * Tests that the results card appears as soon as a tournament completes, without a reload
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { initBracketView, cleanupBracketView } from '../js/components/bracket-view.js';
import { createMockElement, createMockDocument } from './fixtures.js';

function setup() {
  store.reset();
  const mockDoc = createMockDocument();
  mockDoc._addElement('score-modal', createMockElement('dialog'));
  mockDoc._addElement('submit-score-btn', createMockElement('button'));
  mockDoc._addElement('score1', createMockElement('input'));
  mockDoc._addElement('score2', createMockElement('input'));
  for (const id of ['bracket-tabs', 'bracket-title', 'bracket-status', 'standings-panel', 'bracket-container']) {
    mockDoc._addElement(id, createMockElement('div'));
  }
  mockDoc._addElement('bracket-view', createMockElement('section', { hidden: false }));

  const resultsView = createMockElement('section', { hidden: true });
  resultsView.scrollCount = 0;
  resultsView.scrollIntoView = () => { resultsView.scrollCount++; };
  mockDoc._addElement('results-view', resultsView);

  globalThis.document = mockDoc;
  initBracketView();

  store.set('participants', new Map([
    ['p1', { id: 'p1', name: 'Alice' }],
    ['p2', { id: 'p2', name: 'Bob' }],
  ]));
  store.set('bracket', {
    rounds: [{
      number: 1,
      name: 'Final',
      matches: [{ id: 'm1', position: 0, participants: ['p1', 'p2'], scores: [0, 0], winnerId: null, isBye: false }],
    }],
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
