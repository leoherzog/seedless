/**
 * Regression tests: XSS escaping in the bracket renderer.
 *
 * bracket-view.js does not export its render helpers (renderMatchCard,
 * renderTeamMatchCard) directly, so these tests drive them the same way the
 * real app does: initBracketView() wires store subscriptions, and flipping
 * store state (participants/bracket/meta) through the public Store API
 * triggers updateBracketUI() -> renderBracket() -> renderRounds() ->
 * renderMatchCard()/renderTeamMatchCard(), which write into a mocked
 * container's innerHTML. We then assert on that HTML string directly.
 *
 * A minimal DOM/document shim (built from tests/fixtures.js's
 * createMockElement/createMockDocument, the same helpers used elsewhere in
 * this suite) is installed on globalThis so the module's document.* calls
 * resolve without a browser.
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { initBracketView, cleanupBracketView } from '../js/components/bracket-view.js';
import { escapeHtml } from '../js/utils/html.js';
import { createMockElement, createMockDocument } from './fixtures.js';

const XSS_IMG = '<img src=x onerror=alert(1)>';
const XSS_SCRIPT = '<script>alert(1)</script>';

/**
 * Build and install the minimal document shim bracket-view.js needs in order
 * to run initBracketView() + a full render pass without throwing.
 * Returns the mock document (with the bracket-container element reachable
 * via mockDoc._elements.get('bracket-container')) so tests can inspect
 * innerHTML after triggering a render.
 */
function installMockDocument() {
  const mockDoc = createMockDocument();

  // Elements touched unconditionally by setupScoreModal() / setupBracketTabs()
  // / updateBracketUI(), even when we never open the score modal in these tests.
  mockDoc._addElement('score-modal', createMockElement('dialog'));
  mockDoc._addElement('submit-score-btn', createMockElement('button'));
  mockDoc._addElement('score1', createMockElement('input'));
  mockDoc._addElement('score2', createMockElement('input'));
  mockDoc._addElement('bracket-tabs', createMockElement('div'));
  mockDoc._addElement('bracket-title', createMockElement('h2'));
  mockDoc._addElement('bracket-status', createMockElement('span'));
  mockDoc._addElement('standings-panel', createMockElement('div'));
  mockDoc._addElement('bracket-view', createMockElement('section', { hidden: false }));
  mockDoc._addElement('bracket-container', createMockElement('div'));
  // race-result-modal is null-checked by setupRaceResultModal(), so it's
  // intentionally omitted here.

  globalThis.document = mockDoc;
  return mockDoc;
}

/**
 * Reset the singleton store, re-install the DOM shim, and (re)initialize
 * bracket view subscriptions for a clean test.
 */
function setup() {
  store.reset();
  const mockDoc = installMockDocument();
  initBracketView();
  return mockDoc;
}

function teardown() {
  cleanupBracketView();
}

Deno.test('Bracket View XSS Escaping - Single Elimination match card', async (t) => {
  await t.step('participant name with <img onerror> is escaped, not raw, in rendered HTML', () => {
    const mockDoc = setup();
    try {
      store.set('participants', new Map([
        ['p1', { id: 'p1', name: XSS_IMG }],
        ['p2', { id: 'p2', name: 'Bob' }],
      ]));

      const bracket = {
        rounds: [{
          number: 1,
          name: 'Round 1',
          matches: [{
            id: 'm1',
            position: 0,
            participants: ['p1', 'p2'],
            scores: [0, 0],
            winnerId: null,
            isBye: false,
          }],
        }],
      };
      store.set('bracket', bracket);
      store.set('meta.type', 'single');

      // Flip status to 'active' last: this is the change that makes
      // updateBracketUI() actually render (it no-ops while status is 'lobby').
      store.set('meta.status', 'active');

      const html = mockDoc._elements.get('bracket-container').innerHTML;

      assert(!html.includes(XSS_IMG), 'raw <img onerror> tag must not appear unescaped in rendered HTML');
      assert(!html.includes('<img src=x onerror=alert(1)>'), 'raw tag must not survive rendering');
      assert(html.includes(escapeHtml(XSS_IMG)), 'escaped form of the participant name must appear');
      assert(html.includes('&lt;img'), 'escaped "<" must appear as &lt;');
      assert(html.includes('onerror=alert(1)&gt;'), 'escaped ">" must appear as &gt;');
    } finally {
      teardown();
    }
  });

  await t.step('participant name with <script> tag is escaped, not raw, in rendered HTML', () => {
    const mockDoc = setup();
    try {
      store.set('participants', new Map([
        ['p1', { id: 'p1', name: XSS_SCRIPT }],
        ['p2', { id: 'p2', name: 'Alice' }],
      ]));

      const bracket = {
        rounds: [{
          number: 1,
          name: 'Round 1',
          matches: [{
            id: 'm1',
            position: 0,
            participants: ['p1', 'p2'],
            scores: [0, 0],
            winnerId: null,
            isBye: false,
          }],
        }],
      };
      store.set('bracket', bracket);
      store.set('meta.type', 'single');
      store.set('meta.status', 'active');

      const html = mockDoc._elements.get('bracket-container').innerHTML;

      assert(!html.includes('<script>alert(1)</script>'), 'raw <script> tag must not appear unescaped');
      assert(html.includes('&lt;script&gt;'), 'escaped opening script tag must appear');
      assert(html.includes('&lt;/script&gt;'), 'escaped closing script tag must appear');
    } finally {
      teardown();
    }
  });

  await t.step('control: a normal participant name renders intact, unescaped-looking', () => {
    const mockDoc = setup();
    try {
      store.set('participants', new Map([
        ['p1', { id: 'p1', name: 'Alice' }],
        ['p2', { id: 'p2', name: 'Bob' }],
      ]));

      const bracket = {
        rounds: [{
          number: 1,
          name: 'Round 1',
          matches: [{
            id: 'm1',
            position: 0,
            participants: ['p1', 'p2'],
            scores: [0, 0],
            winnerId: null,
            isBye: false,
          }],
        }],
      };
      store.set('bracket', bracket);
      store.set('meta.type', 'single');
      store.set('meta.status', 'active');

      const html = mockDoc._elements.get('bracket-container').innerHTML;

      assert(html.includes('>Alice<'), 'plain name "Alice" should render intact inside its span');
      assert(html.includes('>Bob<'), 'plain name "Bob" should render intact inside its span');
      assert(!html.includes('&amp;'), 'no escaping artifacts expected for a plain alphabetic name');
    } finally {
      teardown();
    }
  });
});

Deno.test('Bracket View XSS Escaping - Doubles team match card', async (t) => {
  await t.step('team name with <img onerror> is escaped, not raw, in rendered HTML', () => {
    const mockDoc = setup();
    try {
      store.set('participants', new Map([
        ['u1', { id: 'u1', name: 'Alice' }],
        ['u2', { id: 'u2', name: 'Carol' }],
      ]));

      const bracket = {
        bracketType: 'single',
        teams: [
          { id: 'team1', name: XSS_IMG, members: [{ id: 'u1', name: 'Alice' }] },
          { id: 'team2', name: 'Team B', members: [{ id: 'u2', name: 'Carol' }] },
        ],
        rounds: [{
          number: 1,
          name: 'Round 1',
          matches: [{
            id: 'm1',
            position: 0,
            participants: ['team1', 'team2'],
            scores: [0, 0],
            winnerId: null,
            isBye: false,
          }],
        }],
      };
      store.set('bracket', bracket);
      store.set('meta.type', 'doubles');
      store.set('meta.status', 'active');

      const html = mockDoc._elements.get('bracket-container').innerHTML;

      assert(!html.includes(XSS_IMG), 'raw <img onerror> team name must not appear unescaped');
      assert(html.includes(escapeHtml(XSS_IMG)), 'escaped form of the team name must appear');
      assert(html.includes('&lt;img'), 'escaped "<" must appear as &lt;');
    } finally {
      teardown();
    }
  });

  await t.step('team member name with <script> tag is escaped in the team-members line', () => {
    const mockDoc = setup();
    try {
      store.set('participants', new Map([
        ['u1', { id: 'u1', name: XSS_SCRIPT }],
        ['u2', { id: 'u2', name: 'Carol' }],
      ]));

      const bracket = {
        bracketType: 'single',
        teams: [
          { id: 'team1', name: 'Team A', members: [{ id: 'u1', name: XSS_SCRIPT }] },
          { id: 'team2', name: 'Team B', members: [{ id: 'u2', name: 'Carol' }] },
        ],
        rounds: [{
          number: 1,
          name: 'Round 1',
          matches: [{
            id: 'm1',
            position: 0,
            participants: ['team1', 'team2'],
            scores: [0, 0],
            winnerId: null,
            isBye: false,
          }],
        }],
      };
      store.set('bracket', bracket);
      store.set('meta.type', 'doubles');
      store.set('meta.status', 'active');

      const html = mockDoc._elements.get('bracket-container').innerHTML;

      assert(!html.includes('<script>alert(1)</script>'), 'raw <script> team member name must not appear unescaped');
      assert(html.includes('&lt;script&gt;'), 'escaped opening script tag must appear for the team member name');
    } finally {
      teardown();
    }
  });

  await t.step('control: normal team and member names render intact', () => {
    const mockDoc = setup();
    try {
      store.set('participants', new Map([
        ['u1', { id: 'u1', name: 'Alice' }],
        ['u2', { id: 'u2', name: 'Carol' }],
      ]));

      const bracket = {
        bracketType: 'single',
        teams: [
          { id: 'team1', name: 'Team Rocket', members: [{ id: 'u1', name: 'Alice' }] },
          { id: 'team2', name: 'Team B', members: [{ id: 'u2', name: 'Carol' }] },
        ],
        rounds: [{
          number: 1,
          name: 'Round 1',
          matches: [{
            id: 'm1',
            position: 0,
            participants: ['team1', 'team2'],
            scores: [0, 0],
            winnerId: null,
            isBye: false,
          }],
        }],
      };
      store.set('bracket', bracket);
      store.set('meta.type', 'doubles');
      store.set('meta.status', 'active');

      const html = mockDoc._elements.get('bracket-container').innerHTML;

      assert(html.includes('>Team Rocket<'), 'plain team name should render intact');
      assert(html.includes('>Alice<'), 'plain team member name should render intact');
    } finally {
      teardown();
    }
  });
});

Deno.test('escapeHtml direct control (utility used by both render paths)', async (t) => {
  await t.step('escapes angle brackets so tags cannot execute', () => {
    const escaped = escapeHtml(XSS_IMG);
    assertEquals(escaped, '&lt;img src=x onerror=alert(1)&gt;');
    assert(!escaped.includes('<'));
    assert(!escaped.includes('>'));
  });

  await t.step('leaves a plain name unchanged', () => {
    assertEquals(escapeHtml('Alice'), 'Alice');
  });
});
