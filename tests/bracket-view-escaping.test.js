/**
 * Peer-supplied fields are HTML-escaped in rendered match cards, game cards and tournament history.
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { initBracketView, cleanupBracketView } from '../js/components/bracket-view.js';
import { escapeHtml } from '../js/utils/html.js';
import { createMockElement, installBracketViewDom } from './fixtures.js';

const XSS_IMG = '<img src=x onerror=alert(1)>';
const XSS_SCRIPT = '<script>alert(1)</script>';

/**
 * Render a one-match bracket through initBracketView and return the container HTML.
 * @param {Map} participants - Store participants
 * @param {string[]} slotIds - The match's two participant or team IDs
 * @param {Object} [options] - type, teams for a doubles bracket, match field overrides, and round name
 * @returns {string} bracket-container innerHTML
 */
function renderOneMatch(participants, slotIds, { type = 'single', teams, match = {}, roundName = 'Round 1' } = {}) {
  store.reset();
  const doc = installBracketViewDom();
  initBracketView();

  store.set('participants', participants);
  store.setAdmin(true);
  store.setMatches(new Map([
    ['m1', { id: 'm1', position: 0, participants: slotIds, scores: [0, 0], winnerId: null, isBye: false, ...match }],
  ]));
  store.set('bracket', {
    ...(teams && { bracketType: 'single', teams }),
    rounds: [{ number: 1, name: roundName, matchIds: ['m1'] }],
  });
  store.set('meta.type', type);
  // Rendering starts when status leaves 'lobby', so this goes last.
  store.set('meta.status', 'active');

  return doc._elements.get('bracket-container').innerHTML;
}

Deno.test('Bracket View XSS Escaping - Single Elimination match card', async (t) => {
  await t.step('participant name with <img onerror> is escaped, not raw, in rendered HTML', () => {
    try {
      const html = renderOneMatch(new Map([
        ['p1', { id: 'p1', name: XSS_IMG }],
        ['p2', { id: 'p2', name: 'Bob' }],
      ]), ['p1', 'p2']);

      assert(!html.includes(XSS_IMG), 'raw <img onerror> tag must not appear unescaped in rendered HTML');
      assert(html.includes(escapeHtml(XSS_IMG)), 'escaped form of the participant name must appear');
      assert(html.includes('&lt;img'), 'escaped "<" must appear as &lt;');
      assert(html.includes('onerror=alert(1)&gt;'), 'escaped ">" must appear as &gt;');
    } finally {
      cleanupBracketView();
    }
  });

  await t.step('participant name with <script> tag is escaped, not raw, in rendered HTML', () => {
    try {
      const html = renderOneMatch(new Map([
        ['p1', { id: 'p1', name: XSS_SCRIPT }],
        ['p2', { id: 'p2', name: 'Alice' }],
      ]), ['p1', 'p2']);

      assert(!html.includes(XSS_SCRIPT), 'raw <script> tag must not appear unescaped');
      assert(html.includes('&lt;script&gt;'), 'escaped opening script tag must appear');
      assert(html.includes('&lt;/script&gt;'), 'escaped closing script tag must appear');
    } finally {
      cleanupBracketView();
    }
  });

  await t.step('match fields a peer can merge into the Map are escaped', () => {
    try {
      const html = renderOneMatch(new Map([
        ['p1', { id: 'p1', name: 'Alice' }],
        ['p2', { id: 'p2', name: 'Bob' }],
      ]), ['p1', 'p2'], {
        match: { id: XSS_IMG, position: XSS_SCRIPT, scores: [XSS_IMG, XSS_SCRIPT] },
        roundName: XSS_SCRIPT,
      });

      assert(html.includes(`data-match="${escapeHtml(XSS_IMG)}"`), 'the report button must carry the escaped id');
      assert(!html.includes(XSS_IMG), 'raw <img onerror> must not appear in any match field');
      assert(!html.includes(XSS_SCRIPT), 'raw <script> must not appear in any match field');
    } finally {
      cleanupBracketView();
    }
  });

  await t.step('control: a normal participant name renders intact, unescaped-looking', () => {
    try {
      const html = renderOneMatch(new Map([
        ['p1', { id: 'p1', name: 'Alice' }],
        ['p2', { id: 'p2', name: 'Bob' }],
      ]), ['p1', 'p2']);

      assert(html.includes('>Alice<'), 'plain name "Alice" should render intact inside its span');
      assert(html.includes('>Bob<'), 'plain name "Bob" should render intact inside its span');
      assert(!html.includes('&amp;'), 'no escaping artifacts expected for a plain alphabetic name');
    } finally {
      cleanupBracketView();
    }
  });
});

Deno.test('Bracket View XSS Escaping - Doubles team match card', async (t) => {
  await t.step('team name with <img onerror> is escaped, not raw, in rendered HTML', () => {
    try {
      const html = renderOneMatch(new Map([
        ['u1', { id: 'u1', name: 'Alice' }],
        ['u2', { id: 'u2', name: 'Carol' }],
      ]), ['team1', 'team2'], {
        type: 'doubles',
        teams: [
          { id: 'team1', name: XSS_IMG, members: [{ id: 'u1', name: 'Alice' }] },
          { id: 'team2', name: 'Team B', members: [{ id: 'u2', name: 'Carol' }] },
        ],
      });

      assert(!html.includes(XSS_IMG), 'raw <img onerror> team name must not appear unescaped');
      assert(html.includes(escapeHtml(XSS_IMG)), 'escaped form of the team name must appear');
      assert(html.includes('&lt;img'), 'escaped "<" must appear as &lt;');
    } finally {
      cleanupBracketView();
    }
  });

  await t.step('team member name with <script> tag is escaped in the team-members line', () => {
    try {
      const html = renderOneMatch(new Map([
        ['u1', { id: 'u1', name: XSS_SCRIPT }],
        ['u2', { id: 'u2', name: 'Carol' }],
      ]), ['team1', 'team2'], {
        type: 'doubles',
        teams: [
          { id: 'team1', name: 'Team A', members: [{ id: 'u1', name: XSS_SCRIPT }] },
          { id: 'team2', name: 'Team B', members: [{ id: 'u2', name: 'Carol' }] },
        ],
      });

      assert(!html.includes(XSS_SCRIPT), 'raw <script> team member name must not appear unescaped');
      assert(html.includes('&lt;script&gt;'), 'escaped opening script tag must appear for the team member name');
    } finally {
      cleanupBracketView();
    }
  });

  await t.step('control: normal team and member names render intact', () => {
    try {
      const html = renderOneMatch(new Map([
        ['u1', { id: 'u1', name: 'Alice' }],
        ['u2', { id: 'u2', name: 'Carol' }],
      ]), ['team1', 'team2'], {
        type: 'doubles',
        teams: [
          { id: 'team1', name: 'Team Rocket', members: [{ id: 'u1', name: 'Alice' }] },
          { id: 'team2', name: 'Team B', members: [{ id: 'u2', name: 'Carol' }] },
        ],
      });

      assert(html.includes('>Team Rocket<'), 'plain team name should render intact');
      assert(html.includes('>Alice<'), 'plain team member name should render intact');
    } finally {
      cleanupBracketView();
    }
  });
});

Deno.test('Bracket View XSS Escaping - Points Race game card', async (t) => {
  await t.step('game id, number and result fields are escaped', () => {
    try {
      store.reset();
      const doc = installBracketViewDom();
      // The mock document resolves '#standings-table tbody' by this key.
      doc._addElement('standings-table tbody', createMockElement());
      initBracketView();

      store.set('participants', new Map([['p1', { id: 'p1', name: 'Alice' }], ['p2', { id: 'p2', name: 'Bob' }]]));
      store.setAdmin(true);
      store.setMatches(new Map([
        ['g1', { id: XSS_IMG, gameNumber: XSS_SCRIPT, participants: ['p1', 'p2'], complete: false }],
        ['g2', {
          id: 'g2', gameNumber: 2, participants: ['p1', 'p2'], complete: true,
          results: [{ participantId: 'p1', position: XSS_IMG, points: XSS_SCRIPT }, { participantId: 'p2', position: 2, points: 0 }],
        }],
      ]));
      store.set('bracket', { type: 'mariokart', pointsTable: [3, 2, 1] });
      store.set('meta.type', 'mariokart');
      store.set('meta.status', 'active');

      const html = doc._elements.get('bracket-container').innerHTML;
      assert(html.includes(`data-race="${escapeHtml(XSS_IMG)}"`), 'the report button must carry the escaped id');
      assert(!html.includes(XSS_IMG), 'raw <img onerror> must not appear in any game field');
      assert(!html.includes(XSS_SCRIPT), 'raw <script> must not appear in any game field');
    } finally {
      cleanupBracketView();
    }
  });
});

Deno.test('Bracket View XSS Escaping - tournament history', async (t) => {
  /** Complete a two-player bracket holding the given history entries from the admin. */
  function completeWithHistory(history) {
    store.reset();
    store.merge({ history }, true);
    store.set('participants', new Map([['p1', { id: 'p1', name: 'Alice' }], ['p2', { id: 'p2', name: 'Bob' }]]));
    store.setMatches(new Map([
      ['m1', { id: 'm1', position: 0, participants: ['p1', 'p2'], scores: [2, 0], winnerId: 'p1', isBye: false }],
    ]));
    store.set('bracket', { rounds: [{ number: 1, name: 'Final', matchIds: ['m1'] }] });
    store.set('meta.type', 'single');
    store.set('meta.status', 'complete');
  }

  /** Render a completed bracket with the given history on a fresh DOM, and return #tournament-history. */
  function renderHistory(history) {
    const doc = installBracketViewDom();
    initBracketView();
    completeWithHistory(history);
    return doc._elements.get('tournament-history');
  }

  await t.step('peer-supplied entry fields are escaped and the type is never echoed', () => {
    try {
      const section = renderHistory([{
        id: 'h1',
        type: XSS_IMG,
        completedAt: 1,
        participantCount: XSS_SCRIPT,
        winner: { name: 'Alice' },
        standings: [{ place: XSS_SCRIPT, name: 'Alice', points: XSS_SCRIPT }],
      }]);

      assertEquals(section.hidden, false);
      assert(!section.innerHTML.includes(XSS_SCRIPT), 'raw <script> must not appear in any history field');
      assert(section.innerHTML.includes('&lt;script&gt;'), 'escaped history fields must appear');
      assert(!section.innerHTML.includes(XSS_IMG), 'raw type must not appear');
      assert(!section.innerHTML.includes(escapeHtml(XSS_IMG)), 'an unknown type is replaced, not echoed');
      assert(section.innerHTML.includes('Tournament'), 'an unknown type falls back to a fixed label');
    } finally {
      cleanupBracketView();
    }
  });

  await t.step('a type naming an Object.prototype key falls back to the fixed label', () => {
    try {
      const section = renderHistory([{ id: 'h1', type: 'constructor', completedAt: 1, participantCount: 2 }]);
      assert(section.innerHTML.includes('<strong>Type:</strong> Tournament'));
    } finally {
      cleanupBracketView();
    }
  });

  await t.step('the shown section hides when a later tournament has no history', () => {
    try {
      const section = renderHistory([{ id: 'h1', type: 'single', completedAt: 1, participantCount: 2 }]);
      assertEquals(section.hidden, false);

      completeWithHistory([]);
      assertEquals(section.hidden, true);
    } finally {
      cleanupBracketView();
    }
  });
});
