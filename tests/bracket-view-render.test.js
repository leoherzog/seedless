/**
 * Bracket rendering: the selected double-elimination tab survives re-renders and
 * resets between tournaments, and undecided slots carry no winner or loser class.
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { initBracketView, cleanupBracketView } from '../js/components/bracket-view.js';
import { createMockElement, installBracketViewDom } from './fixtures.js';

const match = (id, participants, winnerId = null) =>
  [id, { id, position: 0, participants, scores: [0, 0], winnerId, isBye: false }];

/**
 * Install the bracket DOM with three #bracket-tabs buttons the mock document can query.
 * @returns {{doc: Object, buttons: Object[]}} The mock document and the Winners, Losers and Finals buttons
 */
function installTabbedDom() {
  const doc = installBracketViewDom();
  const buttons = ['winners', 'losers', 'finals'].map((bracket) => {
    const btn = createMockElement({ dataset: { bracket } });
    const attributes = new Set();
    btn.setAttribute = (name) => attributes.add(name);
    btn.removeAttribute = (name) => attributes.delete(name);
    btn.isCurrent = () => attributes.has('aria-current');
    return btn;
  });
  buttons[0].setAttribute('aria-current', 'true');

  const querySelector = doc.querySelector;
  doc.querySelectorAll = (selector) => (selector === '#bracket-tabs button' ? buttons : []);
  doc.querySelector = (selector) => (selector === '#bracket-tabs [aria-current]'
    ? buttons.find((b) => b.isCurrent()) ?? null
    : querySelector(selector));
  return { doc, buttons };
}

function startDoubleElimination() {
  store.set('participants', new Map([
    ['p1', { id: 'p1', name: 'Alice' }],
    ['p2', { id: 'p2', name: 'Bob' }],
  ]));
  store.setMatches(new Map([
    match('w1', ['p1', 'p2']),
    match('l1', [null, null]),
    match('gf1', [null, null]),
    match('gf2', [null, null]),
  ]));
  store.set('bracket', {
    winners: { rounds: [{ name: 'Winners Round', matchIds: ['w1'] }] },
    losers: { rounds: [{ name: 'Losers Round', matchIds: ['l1'] }] },
    grandFinals: ['gf1', 'gf2'],
  });
  store.set('meta.type', 'double');
  store.set('meta.status', 'active');
}

Deno.test('Double-elimination tabs', async (t) => {
  await t.step('the selected tab survives an unrelated store change', () => {
    store.reset();
    const { doc, buttons } = installTabbedDom();
    initBracketView();
    try {
      startDoubleElimination();
      const container = doc._elements.get('bracket-container');
      assert(container.innerHTML.includes('Winners Round'));
      assertEquals(doc._elements.get('bracket-tabs').hidden, false);

      doc._elements.get('bracket-tabs').dispatchEvent({ type: 'click', target: { closest: () => buttons[1] } });
      assert(container.innerHTML.includes('Losers Round'));

      store.set('meta.name', 'Renamed');
      assert(container.innerHTML.includes('Losers Round'), 'a re-render keeps the Losers tab');
      assert(buttons[1].isCurrent());
    } finally {
      cleanupBracketView();
    }
  });

  await t.step('a new tournament opens on Winners', () => {
    store.reset();
    const { doc, buttons } = installTabbedDom();
    initBracketView();
    try {
      startDoubleElimination();
      doc._elements.get('bracket-tabs').dispatchEvent({ type: 'click', target: { closest: () => buttons[2] } });
      assert(doc._elements.get('bracket-container').innerHTML.includes('Grand Finals'));

      store.set('meta.status', 'lobby');
      startDoubleElimination();
      assert(buttons[0].isCurrent());
      assert(doc._elements.get('bracket-container').innerHTML.includes('Winners Round'));
    } finally {
      cleanupBracketView();
    }
  });
});

Deno.test('Match card result classes', async (t) => {
  await t.step('only a decided match marks a winner and a loser', () => {
    store.reset();
    const doc = installBracketViewDom();
    initBracketView();
    try {
      store.set('participants', new Map([
        ['p1', { id: 'p1', name: 'Alice' }],
        ['p2', { id: 'p2', name: 'Bob' }],
      ]));
      store.setMatches(new Map([match('m1', ['p1', 'p2'], 'p1'), match('m2', [null, null])]));
      store.set('bracket', { rounds: [{ name: 'Round 1', matchIds: ['m1'] }, { name: 'Final', matchIds: ['m2'] }] });
      store.set('meta.type', 'single');
      store.set('meta.status', 'active');

      const [decided, undecided] = doc._elements.get('bracket-container').innerHTML.split('Final');
      assertEquals(decided.match(/class="participant\s+winner"/g)?.length, 1);
      assertEquals(decided.match(/class="participant\s+loser"/g)?.length, 1);
      assert(!/participant\s+(winner|loser)/.test(undecided), 'TBD slots must not be styled as a result');
      assertEquals(doc._elements.get('bracket-tabs').hidden, true);
    } finally {
      cleanupBracketView();
    }
  });
});
