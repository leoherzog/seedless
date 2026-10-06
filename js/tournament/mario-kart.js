/**
 * Points Race Tournament
 * Pool-based scoring with random matchups and minimized repeats
 */

import { CONFIG } from '../../config.js';
import { sortStandings, getPointsForPosition, shuffle } from '../utils/tournament-helpers.js';

// Randomized schedules are retried within this budget; the fewest repeat pairings wins.
const SCHEDULE_BUDGET_MS = 40;
const SCHEDULE_MAX_ATTEMPTS = 64;

/**
 * Generate a Points Race tournament
 * @param {Object[]} participants - Array of participants
 * @param {Object} config - Tournament configuration
 * @returns {Object} Race settings plus the games and zeroed standings, as Maps
 */
export function generateMarioKartTournament(participants, config = {}) {
  if (participants.length < 2) {
    throw new Error('Need at least 2 participants');
  }

  const playerCount = participants.length;
  const { playersPerGame, gamesPerPlayer } = resolveOptions(playerCount, config);
  const pointsTable = config.pointsTable || CONFIG.pointsTables.standard;

  const plan = planGames(playerCount, config);
  const games = scheduleGames(participants.map(p => p.id), plan, gamesPerPlayer);

  const standings = new Map();
  for (const p of participants) {
    standings.set(p.id, {
      participantId: p.id,
      name: p.name,
      points: 0,
      gamesCompleted: 0,
      wins: 0,
    });
  }

  const matches = new Map();
  games.forEach((game, idx) => {
    const id = `game${idx + 1}`;
    matches.set(id, {
      id,
      gameNumber: idx + 1,
      participants: game.participants,
      standIns: game.standIns,
      results: null,
      winnerId: null,
      reportedBy: null,
      reportedAt: null,
      complete: false,
    });
  });

  return {
    type: 'mariokart',
    matches,
    standings,
    pointsTable,
    playersPerGame,
    gamesPerPlayer,
  };
}

/**
 * Apply Points Race defaults; a game never holds more players than exist.
 * @param {number} playerCount - Number of participants
 * @param {Object} config - Tournament configuration
 * @returns {{playersPerGame: number, gamesPerPlayer: number, leftoverSeats: 'smaller'|'standins'}}
 */
function resolveOptions(playerCount, config) {
  return {
    playersPerGame: Math.min(config.playersPerGame || 4, playerCount),
    gamesPerPlayer: config.gamesPerPlayer || 5,
    leftoverSeats: config.leftoverSeats === 'standins' ? 'standins' : 'smaller',
  };
}

/**
 * Plan seat counts so every player gets exactly gamesPerPlayer scored races.
 * When seats don't divide evenly, 'smaller' leaves some games a player short and
 * 'standins' fills those seats with players racing an extra, unscored game.
 * A game left with one scored player always gets a stand-in so it is still a race.
 * @param {number} playerCount - Number of participants
 * @param {Object} config - Tournament configuration
 * @returns {{scored: number, standIns: number}[]} One entry per game, larger games first
 */
export function planGames(playerCount, config = {}) {
  if (playerCount < 2) return [];

  const { playersPerGame, gamesPerPlayer, leftoverSeats } = resolveOptions(playerCount, config);
  const seats = playerCount * gamesPerPlayer;
  const gameCount = Math.ceil(seats / playersPerGame);
  const base = Math.floor(seats / gameCount);
  const largerGames = seats % gameCount;

  return Array.from({ length: gameCount }, (_, idx) => {
    const scored = idx < largerGames ? base + 1 : base;
    const standIns = leftoverSeats === 'standins'
      ? playersPerGame - scored
      : Math.max(0, 2 - scored);
    return { scored, standIns };
  });
}

/**
 * Games-per-player counts nearest the configured one that leave no leftover seats
 * @param {number} playerCount - Number of participants
 * @param {Object} config - Tournament configuration
 * @param {number} maxGames - Largest games-per-player allowed
 * @returns {number[]} Nearest count below and above, ascending; empty when the split is already even
 */
export function suggestEvenGamesPerPlayer(playerCount, config = {}, maxGames = Infinity) {
  if (playerCount < 2) return [];

  const { playersPerGame, gamesPerPlayer } = resolveOptions(playerCount, config);
  // players × games divides by playersPerGame exactly when games is a multiple of this step.
  const step = playersPerGame / gcd(playerCount, playersPerGame);
  if (gamesPerPlayer % step === 0) return [];

  const below = Math.floor(gamesPerPlayer / step) * step;
  return [below, below + step].filter(n => n >= 1 && n <= maxGames);
}

/**
 * Greatest common divisor
 * @param {number} a - Non-negative integer
 * @param {number} b - Non-negative integer
 * @returns {number}
 */
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Seat players into planned games, keeping the attempt with the fewest repeat pairings
 * @param {string[]} playerIds - Participant IDs
 * @param {{scored: number, standIns: number}[]} plan - Output of planGames
 * @param {number} gamesPerPlayer - Scored races per player
 * @returns {{participants: string[], standIns: string[]}[]}
 */
function scheduleGames(playerIds, plan, gamesPerPlayer) {
  const deadline = performance.now() + SCHEDULE_BUDGET_MS;
  let best = null;
  let bestCost = Infinity;

  for (let attempt = 0; attempt < SCHEDULE_MAX_ATTEMPTS && bestCost > 0; attempt++) {
    if (best && performance.now() > deadline) break;
    const { games, cost } = buildSchedule(playerIds.length, plan, gamesPerPlayer);
    if (cost < bestCost) {
      best = games;
      bestCost = cost;
    }
  }

  return best.map(game => ({
    participants: [...game.racers, ...game.standIns].map(idx => playerIds[idx]),
    standIns: game.standIns.map(idx => playerIds[idx]),
  }));
}

/**
 * Build one randomized schedule over player indices
 * @returns {{games: {racers: number[], standIns: number[]}[], cost: number}}
 *   cost counts repeat meetings, weighted so concentrated repeats cost more
 */
function buildSchedule(playerCount, plan, gamesPerPlayer) {
  const players = Array.from({ length: playerCount }, (_, idx) => idx);
  const remaining = new Array(playerCount).fill(gamesPerPlayer);
  const standInTurns = new Array(playerCount).fill(0);
  const met = players.map(() => new Array(playerCount).fill(0));
  const games = [];
  let cost = 0;

  for (const { scored, standIns: openSeats } of plan) {
    // Seating the players with the most races left keeps every later game fillable,
    // so only ties at the cutoff are free to choose.
    const order = shuffle(players.filter(idx => remaining[idx] > 0))
      .sort((a, b) => remaining[b] - remaining[a]);
    const cutoff = remaining[order[scored - 1]];
    const racers = order.filter(idx => remaining[idx] > cutoff);
    while (racers.length < scored) {
      const tied = order.filter(idx => remaining[idx] === cutoff && !racers.includes(idx));
      racers.push(leastMet(tied, racers, met));
    }

    // Stand-in turns rotate before anyone stands in twice.
    const standIns = [];
    const bench = shuffle(players.filter(idx => !racers.includes(idx)));
    while (standIns.length < openSeats) {
      const free = bench.filter(idx => !standIns.includes(idx));
      const fewestTurns = Math.min(...free.map(idx => standInTurns[idx]));
      const rested = free.filter(idx => standInTurns[idx] === fewestTurns);
      standIns.push(leastMet(rested, [...racers, ...standIns], met));
    }

    racers.forEach(idx => remaining[idx]--);
    standIns.forEach(idx => standInTurns[idx]++);

    const field = [...racers, ...standIns];
    for (let a = 0; a < field.length; a++) {
      for (let b = a + 1; b < field.length; b++) {
        cost += met[field[a]][field[b]];
        met[field[a]][field[b]]++;
        met[field[b]][field[a]]++;
      }
    }

    games.push({ racers, standIns });
  }

  return { games, cost };
}

/**
 * Pick the candidate who has met the field least; candidates arrive shuffled so ties break randomly
 * @param {number[]} candidates - Player indices to choose from
 * @param {number[]} field - Player indices already in the game
 * @param {number[][]} met - Pairwise meeting counts
 * @returns {number} Chosen player index
 */
function leastMet(candidates, field, met) {
  let best = candidates[0];
  let bestScore = Infinity;

  for (const candidate of candidates) {
    const score = field.reduce((sum, idx) => sum + met[candidate][idx], 0);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best;
}

/**
 * Record a game result into the game and the standings, both mutated in place.
 * Re-recording a game first reverses its previous contribution, so corrections never
 * double-count. Stand-ins hold a finishing position but score nothing.
 * @param {{matches: Map, standings: Map, pointsTable: Array|string}} tournament
 * @param {string} gameId - Game ID
 * @param {Object[]} results - Array of { participantId }, in finishing order
 * @param {string} reportedBy - Reporter ID
 * @param {number} [reportedAt] - Timestamp to persist for this result; defaults to now
 * @returns {boolean} True once every game is complete
 */
export function recordRaceResult(tournament, gameId, results, reportedBy, reportedAt = Date.now()) {
  const game = tournament.matches.get(gameId);
  if (!game) {
    throw new Error(`Game not found: ${gameId}`);
  }

  const participantSet = new Set(game.participants);
  for (const r of results) {
    if (!participantSet.has(r.participantId)) {
      throw new Error(`Participant ${r.participantId} not in this game`);
    }
  }

  const previousResults = game.results;
  if (previousResults) {
    for (const prev of previousResults) {
      if (prev.standIn) continue;
      const standing = tournament.standings.get(prev.participantId);
      if (standing) {
        standing.points -= prev.points;
        standing.gamesCompleted--;
        if (prev.position === 1) {
          standing.wins--;
        }
      }
    }
  }

  const standIns = new Set(game.standIns || []);
  game.results = results.map((r, idx) => {
    if (standIns.has(r.participantId)) {
      return { participantId: r.participantId, position: idx + 1, points: 0, standIn: true };
    }
    return {
      participantId: r.participantId,
      position: idx + 1,
      points: getPointsForPosition(tournament.pointsTable, idx, results.length),
    };
  });

  game.winnerId = results[0]?.participantId;
  game.reportedBy = reportedBy;
  game.reportedAt = reportedAt;
  game.complete = true;

  for (const result of game.results) {
    if (result.standIn) continue;
    const standing = tournament.standings.get(result.participantId);
    if (standing) {
      standing.points += result.points;
      standing.gamesCompleted++;
      if (result.position === 1) {
        standing.wins++;
      }
    }
  }

  return [...tournament.matches.values()].every(m => m.complete);
}

/**
 * Rank standings by points, then wins, then games completed.
 * @param {{standings: Map}} tournament
 * @returns {Object[]} Standings with place
 */
export function getStandings(tournament) {
  const standings = sortStandings(Array.from(tournament.standings.values()));

  return standings.map((s, i) => ({
    place: i + 1,
    ...s,
  }));
}
