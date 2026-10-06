/**
 * Recovery after missed or reordered messages: snapshots re-advance the bracket and
 * rescore races on every peer, concurrent reports converge, results that outrun their
 * seats fetch state, and identity claims that lost to a stale peer are retried.
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import { store } from '../js/state/store.js';
import { ActionTypes } from '../js/network/room.js';
import { reportMatchResult, reportRaceResult } from '../js/network/sync.js';
import { generateSingleEliminationBracket } from '../js/tournament/single-elimination.js';
import { generateMarioKartTournament } from '../js/tournament/mario-kart.js';
import { createParticipants } from './fixtures.js';
import { connectAs, mapAdmin } from './sync-fixtures.js';

const ADMIN = 'admin-1';

/** Load an active 4-player single-elimination bracket. */
function loadBracket() {
  const { bracket, matches } = generateSingleEliminationBracket(createParticipants(4));
  store.setMatches(matches);
  store.set('bracket', { ...bracket, startedAt: 1 });
  store.set('meta.status', 'active');
}

/** A serialized snapshot of the store's current tournament, with meta overrides. */
function snapshot(meta = {}) {
  const state = structuredClone(store.serialize());
  state.meta = { ...state.meta, adminId: ADMIN, ...meta };
  return state;
}

/** Deliver a result as the given player. */
function resultFrom(room, peerId, matchId, winnerId, reportedAt, version = 1) {
  room._simulateAction(ActionTypes.MATCH_RESULT, { matchId, scores: [2, 0], winnerId, reportedAt, version }, peerId);
}

/** Map peerId to a player through p:join. */
function join(room, peerId, playerId) {
  room._simulateAction(ActionTypes.PARTICIPANT_JOIN, { name: playerId, localUserId: playerId }, peerId);
}

Deno.test('An admin that missed results catches up from a peer snapshot', async (t) => {
  await t.step('a missed early result is advanced, and a missed final completes the tournament', () => {
    const room = connectAs({ userId: ADMIN, adminId: ADMIN, peers: ['peer-b'] });
    loadBracket();
    const missed = structuredClone(store.serialize());

    // What peer B holds: every match decided while the admin was away.
    reportMatchResult(null, 'r1m0', [2, 0], 'player-1');
    reportMatchResult(null, 'r1m1', [2, 0], 'player-2');
    const afterSemis = snapshot();
    reportMatchResult(null, 'r2m0', [2, 0], 'player-1');
    const afterFinal = snapshot();

    store.deserialize(missed);
    room._simulateAction(ActionTypes.STATE_RESPONSE, { state: afterSemis, isAdmin: false }, 'peer-b');
    assertEquals(store.getMatch('r2m0').participants, ['player-1', 'player-2']);
    assertEquals(store.get('meta.status'), 'active');

    room._simulateAction(ActionTypes.STATE_RESPONSE, { state: afterFinal, isAdmin: false }, 'peer-b');
    assertEquals(store.getMatch('r2m0').winnerId, 'player-1');
    assertEquals(store.get('meta.status'), 'complete');
  });
});

Deno.test("A peer keeps its results against the admin's stale snapshot", async (t) => {
  await t.step('an empty admin slot never unseats a winner, and completion is recomputed', () => {
    const room = connectAs({ userId: 'player-1', adminId: ADMIN, peers: ['admin-peer'] });
    mapAdmin(room, ADMIN);
    loadBracket();
    const adminView = snapshot({ status: 'active' });

    reportMatchResult(null, 'r1m0', [2, 0], 'player-1');
    reportMatchResult(null, 'r1m1', [2, 0], 'player-2');
    reportMatchResult(null, 'r2m0', [2, 0], 'player-1');
    assertEquals(store.get('meta.status'), 'complete');

    room._simulateAction(ActionTypes.STATE_RESPONSE, { state: adminView, isAdmin: true }, 'admin-peer');

    assertEquals(store.getMatch('r2m0').participants, ['player-1', 'player-2']);
    assertEquals(store.getMatch('r2m0').winnerId, 'player-1');
    assertEquals(store.get('meta.status'), 'complete');
  });
});

Deno.test('Points Race standings follow the merged game results', async (t) => {
  /** Load an active two-game, four-player race; returns its game ids and players. */
  function loadRace() {
    const { matches, standings, ...race } = generateMarioKartTournament(createParticipants(4), { playersPerGame: 4, gamesPerPlayer: 2 });
    race.startedAt = 1;
    store.set('bracket', race);
    store.setMatches(matches);
    store.set('standings', standings);
    store.set('meta.type', 'mariokart');
    store.set('meta.status', 'active');
    return [...matches.values()].map((game) => ({ id: game.id, order: game.participants.map((participantId) => ({ participantId })) }));
  }

  const totals = () => [...store.get('standings').values()].map(({ points, gamesCompleted }) => [points, gamesCompleted]);

  await t.step("an admin that missed a game rescores from a peer's snapshot", () => {
    const room = connectAs({ userId: ADMIN, adminId: ADMIN, peers: ['peer-b'] });
    const [game1, game2] = loadRace();
    reportRaceResult(null, game1.id, game1.order);
    const beforeGame2 = structuredClone(store.serialize());

    reportRaceResult(null, game2.id, game2.order);
    const expected = totals();
    const peerView = snapshot({ status: 'complete' });

    store.deserialize(beforeGame2);
    room._simulateAction(ActionTypes.STATE_RESPONSE, { state: peerView, isAdmin: false }, 'peer-b');

    assertEquals(totals(), expected);
    assertEquals(store.get('meta.status'), 'complete');
  });

  await t.step("a peer keeps its standings against the admin's stale snapshot", () => {
    const room = connectAs({ userId: 'player-1', adminId: ADMIN, peers: ['admin-peer'] });
    mapAdmin(room, ADMIN);
    const [game1, game2] = loadRace();
    reportRaceResult(null, game1.id, game1.order);
    const adminView = snapshot({ status: 'active' });

    reportRaceResult(null, game2.id, game2.order);
    const expected = totals();

    room._simulateAction(ActionTypes.STATE_RESPONSE, { state: adminView, isAdmin: true }, 'admin-peer');

    assertEquals(totals(), expected);
    assertEquals(store.get('meta.status'), 'complete');
  });
});

Deno.test('Concurrent reports by the admin and a player converge', () => {
  const adminReport = { reportedAt: 1000, winnerId: 'player-3' };
  const playerReport = { reportedAt: 2000, winnerId: 'player-2' };

  for (const order of [[adminReport, playerReport], [playerReport, adminReport]]) {
    const room = connectAs({ userId: 'player-4', adminId: ADMIN });
    mapAdmin(room, ADMIN);
    loadBracket();
    join(room, 'peer-2', 'player-2');

    for (const report of order) {
      const peerId = report === adminReport ? 'admin-peer' : 'peer-2';
      resultFrom(room, peerId, 'r1m1', report.winnerId, report.reportedAt);
    }
    assertEquals(store.getMatch('r1m1').winnerId, 'player-2', 'the later report wins, whoever sent it');
  }

  // The admin's own copy lands on the same result.
  const room = connectAs({ userId: ADMIN, adminId: ADMIN });
  loadBracket();
  store.updateMatch('r1m1', { scores: [2, 0], winnerId: 'player-3', reportedBy: ADMIN, reportedAt: 1000, version: 1 });
  join(room, 'peer-2', 'player-2');
  resultFrom(room, 'peer-2', 'r1m1', 'player-2', 2000);
  assertEquals(store.getMatch('r1m1').winnerId, 'player-2');
});

Deno.test('A result for a seat not yet filled here asks its sender for state', async (t) => {
  /** Deliver player-1's r2m0 win and return the state requests it caused. */
  function reportFinal(room) {
    room._clearMessages();
    resultFrom(room, 'peer-1', 'r2m0', 'player-1', 3000);
    return room._sentMessages.filter((m) => m.type === ActionTypes.STATE_REQUEST).map((m) => m.peerId);
  }

  await t.step('when the winner is not seated', () => {
    const room = connectAs({ userId: 'player-4', adminId: ADMIN });
    mapAdmin(room, ADMIN);
    loadBracket();
    join(room, 'peer-1', 'player-1');

    // r1m0's result never arrived, so player-1 is not seated in r2m0 here.
    assertEquals(reportFinal(room), ['peer-1']);
    assertEquals(store.getMatch('r2m0').winnerId, null);
  });

  await t.step('when the winner is seated but the opponent is not', () => {
    const room = connectAs({ userId: 'player-4', adminId: ADMIN });
    mapAdmin(room, ADMIN);
    loadBracket();
    join(room, 'peer-1', 'player-1');
    reportMatchResult(null, 'r1m0', [2, 0], 'player-1');

    // r1m1's result never arrived; storing the final now would be cleared by replay and lost.
    assertEquals(reportFinal(room), ['peer-1']);
    assertEquals(store.getMatch('r2m0').winnerId, null);
    assertEquals(store.getMatch('r2m0').reportedAt, null);
  });
});

Deno.test('A claim that lost to a stale peer is retried when that peer leaves', async (t) => {
  await t.step("the admin's new peer is mapped after its old peer leaves", () => {
    const room = connectAs({ userId: 'player-1', adminId: ADMIN, peers: ['admin-old', 'admin-new'] });
    mapAdmin(room, ADMIN, 'admin-old');
    mapAdmin(room, ADMIN, 'admin-new');
    room._clearMessages();

    room._simulatePeerLeave('admin-old');
    const request = room._sentMessages.find((m) => m.type === ActionTypes.STATE_REQUEST);
    assertEquals(request?.peerId, 'admin-new');

    mapAdmin(room, ADMIN, 'admin-new');
    const { bracket, matches } = generateSingleEliminationBracket(createParticipants(4));
    room._simulateAction(ActionTypes.TOURNAMENT_START, { bracket, matches: [...matches] }, 'admin-new');
    assertEquals(store.get('meta.status'), 'active');
  });

  await t.step("a player's new peer is mapped after its old peer leaves", () => {
    const room = connectAs({ userId: ADMIN, adminId: ADMIN, peers: ['old-peer', 'new-peer'] });
    join(room, 'old-peer', 'player-1');
    join(room, 'new-peer', 'player-1');
    assertEquals(store.getParticipant('player-1').peerId, 'old-peer');

    room._simulatePeerLeave('old-peer');

    const participant = store.getParticipant('player-1');
    assertEquals(participant.peerId, 'new-peer');
    assert(participant.isConnected);
  });
});
