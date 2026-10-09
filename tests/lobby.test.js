/**
 * Lobby rendering and controls against a mock DOM: peer-supplied ids are escaped,
 * the team panel, Start button and settings form follow the store, drops respect
 * full teams, and the admin's settings reach peers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../config.js';
import { store } from '../js/state/store.js';
import { joinRoom, leaveRoom, ActionTypes } from '../js/network/room.js';
import { initLobby } from '../js/components/lobby.js';
import { escapeHtml } from '../js/utils/html.js';
import { createMockElement, installLobbyDom } from './fixtures.js';
import { _getLastRoom } from './mocks/trystero-mock.js';

const XSS_ID = '"><img src=x onerror=alert(1)>';

const doc = installLobbyDom();
initLobby();
globalThis.confirm = () => true;

const $ = (id) => doc._elements.get(id);
const toasts = () => $('toast-container').children.map((toast) => toast.innerHTML);

/**
 * Reset the store to an admin's lobby.
 * @param {Object[]} participants - Participants to hold
 * @param {Object} [options] - Tournament type and participantId -> teamId assignments
 */
function adminLobby(participants, { type = 'single', teams = {} } = {}) {
  store.reset();
  $('toast-container').children.length = 0;
  $('team-assignment-grid').children.length = 0;
  store.set('local.localUserId', 'admin');
  store.set('meta.adminId', 'admin');
  store.set('meta.type', type);
  store.set('teamAssignments', new Map(Object.entries(teams)));
  store.set('participants', new Map(participants.map((p) => [p.id, { isConnected: true, ...p }])));
  store.setAdmin(true);
}

/** An event target whose closest(selector) returns the given element for that selector only. */
const targetWithin = (selector, element) => ({ closest: (s) => (s === selector ? element : null) });

/** Drag a participant's li within the team panel and drop it on a team box. */
function dragToTeam(participantId, box) {
  const fieldset = $('team-assignment-fieldset');
  const li = createMockElement({ dataset: { participantId } });
  fieldset.dispatchEvent({ type: 'dragstart', target: targetWithin('li[data-participant-id]', li), dataTransfer: {} });
  fieldset.dispatchEvent({ type: 'drop', target: targetWithin('.team-box', box), preventDefault() {} });
}

/** A team box mock; a complete box holds none of the dragged items. */
function teamBox(teamId, { complete = false } = {}) {
  const box = createMockElement({ dataset: { teamId }, classList: complete ? ['team-box', 'complete'] : ['team-box'] });
  box.contains = () => false;
  return box;
}

test('Lobby', async (t) => {
  await t.test('participant ids and seeds from peers are escaped in the participant list', () => {
    adminLobby([
      { id: XSS_ID, name: 'Mallory', seed: 1 },
      { id: 'p2', name: 'Bob', seed: '<script>alert(1)</script>' },
    ]);
    store.set('meta.config.seedingMode', 'manual');

    const html = $('participant-list').innerHTML;
    assert(!html.includes(XSS_ID), 'raw id must not reach the list markup');
    assert(!html.includes('<script>'), 'raw seed must not reach the seed badge');
    assert(html.includes(`data-participant-id="${escapeHtml(XSS_ID)}"`));
  });

  await t.test('participant ids from peers are escaped in the team panel', () => {
    adminLobby([
      { id: XSS_ID, name: 'Mallory' },
      { id: `${XSS_ID}2`, name: 'Eve' },
    ], { type: 'doubles', teams: { [XSS_ID]: 'team-1' } });

    const teamsHtml = $('team-assignment-grid').children.map((box) => box.innerHTML).join('');
    const unassignedHtml = $('unassigned-list').innerHTML;
    for (const html of [teamsHtml, unassignedHtml]) {
      assert(!html.includes(XSS_ID), 'raw id must not reach the team panel markup');
      assert(html.includes(`data-participant-id="${escapeHtml(XSS_ID)}`));
    }
  });

  await t.test('the team panel lists a player who joins after it rendered', () => {
    adminLobby([{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }], { type: 'doubles' });
    store.addParticipant({ id: 'p3', name: 'Carol' });

    assert($('unassigned-list').innerHTML.includes('Carol'));
    assert.deepStrictEqual($('team-assignment-fieldset').hidden, false);
  });

  await t.test('in doubles, Start needs two complete teams and stays disabled across unrelated changes', () => {
    adminLobby([
      { id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }, { id: 'p3', name: 'Carol' },
    ], { type: 'doubles', teams: { p1: 'team-1', p2: 'team-1' } });
    assert.deepStrictEqual($('start-tournament-btn').disabled, true);

    store.set('meta.name', 'Friday Doubles');
    assert.deepStrictEqual($('start-tournament-btn').disabled, true);
  });

  await t.test('in doubles, two complete teams start even with a player unassigned', () => {
    adminLobby([
      { id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }, { id: 'p3', name: 'Carol' },
      { id: 'p4', name: 'Dan' }, { id: 'p5', name: 'Erin' },
    ], { type: 'doubles', teams: { p1: 'team-1', p2: 'team-1', p3: 'team-2', p4: 'team-2' } });
    assert.deepStrictEqual($('start-tournament-btn').disabled, false);

    $('start-tournament-btn').dispatchEvent({ type: 'click' });

    assert.deepStrictEqual(store.get('meta.status'), 'active');
    assert.deepStrictEqual(store.get('bracket').teams.length, 2);
  });

  await t.test('a full team rejects a dropped player, and an open team accepts one', () => {
    adminLobby([
      { id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }, { id: 'p3', name: 'Carol' },
    ], { type: 'doubles', teams: { p1: 'team-1', p2: 'team-1' } });

    dragToTeam('p3', teamBox('team-1', { complete: true }));
    assert.deepStrictEqual(store.getTeamAssignments().get('p3'), undefined);

    dragToTeam('p3', teamBox('team-2'));
    assert.deepStrictEqual(store.getTeamAssignments().get('p3'), 'team-2');
  });

  await t.test('a drop with no drag from the panel assigns nobody', () => {
    adminLobby([
      { id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' },
    ], { type: 'doubles' });
    dragToTeam('p1', teamBox('team-1'));

    // The accepted drop re-rendered the panel, so no dragend reaches the fieldset.
    $('team-assignment-fieldset').dispatchEvent({
      type: 'drop',
      target: targetWithin('.team-box', teamBox('team-2')),
      preventDefault() {},
    });
    assert.deepStrictEqual(store.getTeamAssignments().get('p1'), 'team-1');
  });

  await t.test('removing a player shows one "removed" toast', () => {
    adminLobby([{ id: 'admin', name: 'Admin' }, { id: 'p2', name: 'Bob' }]);

    $('participant-list').dispatchEvent({
      type: 'click',
      target: targetWithin('.remove-participant-btn', { dataset: { participantId: 'p2' } }),
    });

    assert.deepStrictEqual(store.getParticipant('p2'), undefined);
    assert.deepStrictEqual(toasts().filter((html) => html.includes('Bob')).length, 1);
    assert(toasts().some((html) => html.includes('Bob removed')));
  });

  await t.test('adding an offline player shows one toast and clears the input', () => {
    adminLobby([{ id: 'admin', name: 'Admin' }]);
    $('manual-participant-name').value = ' Carol ';

    $('add-manual-participant-form').dispatchEvent({ type: 'submit', preventDefault() {} });

    assert(store.getParticipantList().some((p) => p.name === 'Carol' && p.isManual));
    assert.deepStrictEqual(toasts().filter((html) => html.includes('Carol')).length, 1);
    assert.deepStrictEqual($('manual-participant-name').value, '');
  });

  await t.test('number settings clamp to the input bounds and fall back to its default', () => {
    adminLobby([]);
    const form = $('tournament-config');
    const playersPerGame = (value) => ({ name: 'players-per-game', value, min: '2', max: '12', defaultValue: '4' });

    form.dispatchEvent({ type: 'input', target: playersPerGame('30') });
    assert.deepStrictEqual(store.get('meta.config.playersPerGame'), 12);

    form.dispatchEvent({ type: 'input', target: playersPerGame('') });
    assert.deepStrictEqual(store.get('meta.config.playersPerGame'), 4);
  });

  await t.test('choosing a type opens its details and shows the team panel for doubles', () => {
    adminLobby([]);
    const details = { open: false };

    $('tournament-config').dispatchEvent({
      type: 'input',
      target: { name: 'type', value: 'doubles', closest: () => details },
    });

    assert.deepStrictEqual(store.get('meta.type'), 'doubles');
    assert.deepStrictEqual(details.open, true);
    assert.deepStrictEqual($('team-assignment-fieldset').hidden, false);
  });

  await t.test('the settings form shows the stored settings, and its defaults in a new room', () => {
    adminLobby([], { type: 'mariokart' });
    store.set('meta.name', 'Kart Cup');
    store.set('meta.config.playersPerGame', 6);
    store.set('meta.config.pointsTable', CONFIG.pointsTables.f1);

    const { elements } = $('tournament-config');
    assert.deepStrictEqual(elements.type.value, 'mariokart');
    assert.deepStrictEqual(elements.type.find((radio) => radio.checked).closest('details').open, true);
    assert.deepStrictEqual(elements['tournament-name'].value, 'Kart Cup');
    assert.deepStrictEqual(elements['players-per-game'].value, 6);
    assert.deepStrictEqual(elements['points-table'].value, 'f1');

    adminLobby([]);
    assert.deepStrictEqual(elements.type.value, 'single');
    assert.deepStrictEqual(elements['tournament-name'].value, '');
    assert.deepStrictEqual(elements['players-per-game'].value, '4');
    assert.deepStrictEqual(elements['points-table'].value, 'standard');
  });

  await t.test('fields being edited keep what the user typed', () => {
    adminLobby([]);
    const tournamentName = $('tournament-config').elements['tournament-name'];
    const myName = $('my-name');
    // Locking the name field relabels its submit button, which the mock reaches by this selector.
    doc._addElement('update-name-form button[type="submit"]', Object.assign(createMockElement(), { setAttribute() {} }));
    store.set('local.name', 'Ada');
    assert.deepStrictEqual([myName.value, myName.disabled], ['Ada', true]);

    try {
      tournamentName.value = 'Half-typ';
      doc.activeElement = tournamentName;
      store.set('meta.config.teamSize', 3);
      assert.deepStrictEqual(tournamentName.value, 'Half-typ');

      // Clearing the unlocked name field to retype it must not refill or lock it.
      Object.assign(myName, { value: '', disabled: false });
      doc.activeElement = myName;
      store.set('meta.config.teamSize', 2);
      assert.deepStrictEqual(myName.value, '');
      assert.deepStrictEqual(myName.disabled, false);
    } finally {
      delete doc.activeElement;
    }
  });

  await t.test("the admin's settings reach peers once edits settle", async () => {
    const previousTurnUrl = CONFIG.network.turnCredentialsUrl;
    CONFIG.network.turnCredentialsUrl = '';
    try {
      await joinRoom('lobby-settings');
      const sent = () => _getLastRoom()._getSentMessages(ActionTypes.STATE_RESPONSE);
      adminLobby([]);
      const rename = (value) => $('tournament-config').dispatchEvent({ type: 'input', target: { name: 'tournament-name', value } });

      rename('Cup');
      rename('Cup Final');
      assert.deepStrictEqual(sent().length, 0);

      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.deepStrictEqual(sent().length, 1);
      assert.deepStrictEqual(sent()[0].targets, undefined, 'broadcast to every peer');
      assert.deepStrictEqual(sent()[0].data.payload.isAdmin, true);
      assert.deepStrictEqual(sent()[0].data.payload.state.meta.name, 'Cup Final');
    } finally {
      await leaveRoom();
      CONFIG.network.turnCredentialsUrl = previousTurnUrl;
    }
  });
});
