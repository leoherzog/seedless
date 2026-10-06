/**
 * End-to-end run of each tournament format: a lobby of themed players, bracket
 * generation, seed-weighted play to completion, standings, and a store round-trip.
 */

import { assertEquals, assert } from 'jsr:@std/assert';
import { Store } from '../../js/state/store.js';
import {
  generateSingleEliminationBracket,
  advance as advanceSingle,
  getStandings as getSingleStandings,
} from '../../js/tournament/single-elimination.js';
import {
  generateDoubleEliminationBracket,
  advance as advanceDouble,
  getStandings as getDoubleStandings,
} from '../../js/tournament/double-elimination.js';
import {
  generateDoublesTournament,
  getStandings as getDoublesStandings,
} from '../../js/tournament/doubles.js';
import {
  generateMarioKartTournament,
  recordRaceResult,
  getStandings as getRaceStandings,
} from '../../js/tournament/mario-kart.js';
import { CONFIG } from '../../config.js';
import { createParticipantMap, playToCompletion } from '../fixtures.js';

const roster = (prefix, names) =>
  names.map((name, i) => ({ id: `${prefix}-${name.toLowerCase().replaceAll(' ', '-')}`, name, seed: i + 1 }));

const TENNIS_PLAYERS = roster('player', [
  'Roger Federer', 'Rafael Nadal', 'Novak Djokovic', 'Andy Murray', 'Stan Wawrinka',
  'Juan Martin del Potro', 'Stefanos Tsitsipas', 'Alexander Zverev', 'Dominic Thiem',
  'Daniil Medvedev', 'Andrey Rublev', 'Jannik Sinner', 'Carlos Alcaraz', 'Casper Ruud', 'Taylor Fritz',
]);

const FIGHTING_GAME_PLAYERS = roster('player', [
  'Daigo Umehara', 'Tokido', 'Punk', 'Momochi', 'Infiltration', 'Fuudo', 'NuckleDu', 'Kazunoko',
]);

const DOUBLES_PLAYERS = roster('player', [
  'Bob Bryan', 'Mike Bryan', 'Roger Federer', 'Rafael Nadal', 'Novak Djokovic', 'Andy Murray',
  'Stefanos Tsitsipas', 'Alexander Zverev', 'Daniil Medvedev', 'Andrey Rublev', 'Carlos Alcaraz',
  'Jannik Sinner', 'Taylor Fritz', 'Frances Tiafoe', 'Casper Ruud', 'Hubert Hurkacz',
]);
const DOUBLES_TEAM_IDS = ['bryan', 'fedal', 'djoker', 'nextgen1', 'russia', 'nextgen2', 'usa', 'euro'];
const TEAM_ASSIGNMENTS = new Map(DOUBLES_PLAYERS.map((p, i) => [p.id, `team-${DOUBLES_TEAM_IDS[i >> 1]}`]));

const MARIO_KART_RACERS = roster('racer', [
  'Mario', 'Luigi', 'Princess Peach', 'Toad', 'Yoshi', 'Bowser', 'Donkey Kong', 'Wario',
  'Waluigi', 'Princess Daisy', 'Rosalina', 'Koopa Troopa', 'Shy Guy', 'Dry Bones', 'Birdo',
]);

/** Deterministic LCG, so every run plays the same results. */
function seededRandom(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) & 0x7fffffff;
    return value / 0x7fffffff;
  };
}

/**
 * Create an admin store in the lobby holding the given players.
 * @param {Object} opts
 * @param {Object} opts.meta - meta fields to set
 * @param {Object[]} opts.players - Players to add
 * @param {Map} [opts.teamAssignments] - participantId -> teamId
 * @returns {Store}
 */
function setupLobby({ meta, players, teamAssignments = new Map() }) {
  const store = new Store();
  for (const [key, value] of Object.entries(meta)) store.set(`meta.${key}`, value);
  store.setAdmin(true);
  for (const player of players) store.addParticipant({ ...player, isConnected: true, isManual: false });
  for (const [playerId, teamId] of teamAssignments) store.setTeamAssignment(playerId, teamId);
  return store;
}

/** Order ids by a random draw weighted toward better (lower) seeds. */
function seedWeightedOrder(ids, seedOf, random) {
  return ids
    .map((id) => ({ id, draw: random() * 20 - seedOf(id) }))
    .sort((a, b) => b.draw - a.draw)
    .map(({ id }) => id);
}

function pickWinner(match, seedOf, random) {
  return seedWeightedOrder(match.participants, seedOf, random)[0];
}

function assertSequentialPlaces(standings, count) {
  assertEquals(standings.length, count);
  standings.forEach((s, i) => assertEquals(s.place, i + 1));
}

function roundTrip(store) {
  const copy = new Store();
  copy.deserialize(store.serialize());
  return copy;
}

Deno.test('Single elimination: 15 tennis players play to a champion', () => {
  const random = seededRandom(123);
  const store = setupLobby({
    meta: { id: 'wimbledon-2024', name: 'Wimbledon', type: 'single', adminId: 'admin-umpire' },
    players: TENNIS_PLAYERS,
  });
  const participants = store.getParticipantList();
  const participantMap = createParticipantMap(participants);
  const tournament = generateSingleEliminationBracket(participants);
  const { bracket, matches } = tournament;

  assertEquals(bracket.bracketSize, 16);
  assertEquals(bracket.rounds.map((r) => r.name), ['Round 1', 'Quarter-Finals', 'Semi-Finals', 'Finals']);
  // Seeds 1 and 2 start in opposite halves, so they can meet only in the final.
  const inTopHalf = (id) => bracket.rounds[0].matchIds.map((mid) => matches.get(mid))
    .find((m) => m.participants.includes(id)).position < 4;
  assert(inTopHalf('player-roger-federer') !== inTopHalf('player-rafael-nadal'));

  const seedOf = (id) => participantMap.get(id).seed;
  assert(playToCompletion(tournament, advanceSingle, (m) => pickWinner(m, seedOf, random)));

  assertSequentialPlaces(getSingleStandings(bracket, matches, participantMap), 15);

  store.setMatches(matches);
  store.set('bracket', bracket);
  store.set('meta.status', 'complete');
  const copy = roundTrip(store);
  assertEquals(copy.get('meta.type'), 'single');
  assertEquals(copy.getParticipantList().length, 15);
  assertEquals(copy.get('matches').size, matches.size);
});

Deno.test('Double elimination: 8 fighting-game players play through grand finals', () => {
  const random = seededRandom(456);
  const store = setupLobby({
    meta: { id: 'evo-2024', name: 'EVO', type: 'double', adminId: 'admin-mrwizard' },
    players: FIGHTING_GAME_PLAYERS,
  });
  const participants = store.getParticipantList();
  const participantMap = createParticipantMap(participants);
  const tournament = generateDoubleEliminationBracket(participants);
  const { bracket, matches } = tournament;

  assertEquals(bracket.winners.rounds.map((r) => r.name), ['Winners R1', 'Winners Semis', 'Winners Finals']);
  bracket.losers.rounds.forEach((round, i) => {
    for (const id of round.matchIds) assertEquals(matches.get(id).isMinorRound, i % 2 === 0);
  });

  const seedOf = (id) => participantMap.get(id).seed;
  assert(playToCompletion(tournament, advanceDouble, (m) => pickWinner(m, seedOf, random)));

  assertSequentialPlaces(getDoubleStandings(bracket, matches, participantMap), 8);

  store.setMatches(matches);
  store.set('bracket', bracket);
  store.set('meta.status', 'complete');
  const copy = roundTrip(store);
  assertEquals(copy.get('meta.type'), 'double');
  assertEquals(copy.getParticipantList().length, 8);
  assertEquals(copy.get('matches').size, matches.size);
});

Deno.test('Doubles: 16 tennis players in 8 teams play to a champion team', () => {
  const random = seededRandom(999);
  const store = setupLobby({
    meta: { id: 'atp-doubles-2024', name: 'ATP Doubles', type: 'doubles', adminId: 'admin-atp' },
    players: DOUBLES_PLAYERS,
    teamAssignments: TEAM_ASSIGNMENTS,
  });
  const tournament = generateDoublesTournament(store.getParticipantList(), store.getTeamAssignments(), {
    teamSize: 2,
    bracketType: 'single',
  });

  const { bracket, matches } = tournament;
  assertEquals(bracket.teams.length, 8);

  const teamSeeds = new Map(bracket.teams.map((t) => [t.id, t.seed]));
  assert(playToCompletion(tournament, advanceSingle, (m) => pickWinner(m, (id) => teamSeeds.get(id), random)));

  const standings = getDoublesStandings(bracket, matches);
  assertSequentialPlaces(standings, 8);
  assert(standings[0].team, 'champion standing should carry team info');

  store.setMatches(matches);
  store.set('bracket', bracket);
  store.set('meta.status', 'complete');
  const copy = roundTrip(store);
  assertEquals(copy.getParticipantList().length, 16);
  for (const [playerId, teamId] of TEAM_ASSIGNMENTS) {
    assertEquals(copy.getTeamAssignments().get(playerId), teamId);
  }
});

Deno.test('Points race: 15 racers finish every game', () => {
  const random = seededRandom(42);
  const store = setupLobby({
    meta: { id: 'mushroom-cup-2024', name: 'Mushroom Cup', type: 'mariokart', adminId: 'admin-lakitu' },
    players: MARIO_KART_RACERS,
  });
  const participants = store.getParticipantList();
  const participantMap = createParticipantMap(participants);
  const tournament = generateMarioKartTournament(participants, {
    playersPerGame: 4,
    gamesPerPlayer: 6,
    pointsTable: CONFIG.pointsTables.standard,
  });

  assertEquals(tournament.totalGames, Math.ceil((15 * 6) / 4));

  const seedOf = (id) => participantMap.get(id).seed;
  for (const [gameId, game] of tournament.matches) {
    const order = seedWeightedOrder(game.participants, seedOf, random);
    recordRaceResult(tournament, gameId, order.map((participantId) => ({ participantId })), order[0]);
  }

  assert(tournament.isComplete);
  const standings = getRaceStandings(tournament);
  assertSequentialPlaces(standings, 15);
  for (const s of standings) assertEquals(s.gamesCompleted, 6);
  for (let i = 1; i < standings.length; i++) assert(standings[i - 1].points >= standings[i].points);

  store.setMatches(tournament.matches);
  store.deserialize({ standings: Array.from(tournament.standings.entries()) });
  store.set('meta.status', 'complete');
  const copy = roundTrip(store);
  assertEquals(copy.get('meta.type'), 'mariokart');
  assertEquals(copy.getParticipantList().length, 15);
  assertEquals(copy.get('matches').size, tournament.totalGames);
  assertEquals(copy.get('standings').size, 15);
});
