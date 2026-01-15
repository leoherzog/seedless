/**
 * Points Race Tournament
 * Pool-based scoring with random matchups and minimized repeats
 */

import { CONFIG } from '../../config.js';

/**
 * Generate a Points Race tournament
 * @param {Object[]} participants - Array of participants
 * @param {Object} config - Tournament configuration
 * @returns {Object} Tournament structure
 */
export function generateMarioKartTournament(participants, config = {}) {
  if (participants.length < 2) {
    throw new Error('Need at least 2 participants');
  }

  const playersPerGame = config.playersPerGame || 4;
  const gamesPerPlayer = config.gamesPerPlayer || 5;
  const pointsTable = config.pointsTable || CONFIG.pointsTables.standard;

  // Calculate total games needed
  const playerCount = participants.length;
  const totalSlots = playerCount * gamesPerPlayer;
  const totalGames = Math.ceil(totalSlots / playersPerGame);

  // Generate games with balanced scheduling
  const games = generateBalancedGames(participants, playersPerGame, gamesPerPlayer);

  // Initialize standings
  const standings = new Map();
  for (const p of participants) {
    standings.set(p.id, {
      participantId: p.id,
      name: p.name,
      points: 0,
      gamesCompleted: 0,
      wins: 0,
      history: [],
    });
  }

  // Create matches map
  const matches = new Map();
  games.forEach((game, idx) => {
    const id = `game${idx + 1}`;
    matches.set(id, {
      id,
      gameNumber: idx + 1,
      participants: game.participants,
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
    totalGames,
    gamesComplete: 0,
    participantCount: playerCount,
    isComplete: false,
  };
}

/**
 * Generate games with balanced player assignments
 * Ensures each player plays the specified number of games
 * while minimizing repeat matchups
 */
function generateBalancedGames(participants, playersPerGame, gamesPerPlayer) {
  const playerIds = participants.map(p => p.id);
  const playerCount = playerIds.length;
  const totalSlots = playerCount * gamesPerPlayer;
  const totalGames = Math.ceil(totalSlots / playersPerGame);

  // Track how many games each player is assigned to
  const gamesAssigned = new Map(playerIds.map(id => [id, 0]));

  // Track opponent counts for each player pair (to minimize repeats)
  const opponentCounts = new Map();
  playerIds.forEach(p1 => {
    playerIds.forEach(p2 => {
      if (p1 < p2) opponentCounts.set(`${p1}:${p2}`, 0);
    });
  });

  const games = [];

  for (let g = 0; g < totalGames; g++) {
    // Get players who still need games, sorted by fewest games assigned
    const available = playerIds
      .filter(id => gamesAssigned.get(id) < gamesPerPlayer)
      .sort((a, b) => gamesAssigned.get(a) - gamesAssigned.get(b));

    if (available.length === 0) break;

    // Select players for this game, minimizing repeat matchups
    const gameParticipants = selectPlayersMinimizingRepeats(
      available,
      Math.min(playersPerGame, available.length),
      opponentCounts
    );

    // Update tracking
    gameParticipants.forEach(id => {
      gamesAssigned.set(id, gamesAssigned.get(id) + 1);

      // Update opponent counts
      gameParticipants.forEach(otherId => {
        if (id < otherId) {
          const key = `${id}:${otherId}`;
          opponentCounts.set(key, opponentCounts.get(key) + 1);
        }
      });
    });

    games.push({ participants: gameParticipants });
  }

  return games;
}

/**
 * Select players for a game while minimizing repeat matchups
 * Uses a greedy algorithm to pick players with lowest total
 * overlap with already selected players
 */
function selectPlayersMinimizingRepeats(available, count, opponentCounts) {
  if (available.length <= count) return [...available];

  // Shuffle available to avoid deterministic bias
  const shuffled = [...available];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  // Start with player who needs most games (first after shuffle)
  const selected = [shuffled[0]];

  while (selected.length < count) {
    let bestCandidate = null;
    let bestScore = Infinity;

    for (const candidate of shuffled) {
      if (selected.includes(candidate)) continue;

      // Score = sum of times this candidate has faced selected players
      let score = 0;
      for (const s of selected) {
        const key = candidate < s ? `${candidate}:${s}` : `${s}:${candidate}`;
        score += opponentCounts.get(key) || 0;
      }

      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (bestCandidate) {
      selected.push(bestCandidate);
    } else {
      break;
    }
  }

  return selected;
}

/**
 * Record game result
 * @param {Object} tournament - Tournament structure
 * @param {string} gameId - Game ID
 * @param {Object[]} results - Array of { participantId, position }
 * @param {string} reportedBy - Reporter ID
 * @returns {Object} Updated tournament
 */
export function recordRaceResult(tournament, gameId, results, reportedBy) {
  const game = tournament.matches.get(gameId);
  if (!game) {
    throw new Error(`Game not found: ${gameId}`);
  }

  // Validate results
  const participantSet = new Set(game.participants);
  for (const r of results) {
    if (!participantSet.has(r.participantId)) {
      throw new Error(`Participant ${r.participantId} not in this game`);
    }
  }

  // Calculate points based on position
  // Sequential mode: N players = N, N-1, ..., 1 points (dynamic per-game)
  const getPoints = (position, totalPlayers) => {
    if (tournament.pointsTable === 'sequential') {
      return totalPlayers - position + 1;
    }
    return tournament.pointsTable[position - 1] || 0;
  };

  game.results = results.map((r, idx) => ({
    participantId: r.participantId,
    position: idx + 1,
    points: getPoints(idx + 1, results.length),
  }));

  game.winnerId = results[0]?.participantId;
  game.reportedBy = reportedBy;
  game.reportedAt = Date.now();
  game.complete = true;

  // Update standings
  for (const result of game.results) {
    const standing = tournament.standings.get(result.participantId);
    if (standing) {
      standing.points += result.points;
      standing.gamesCompleted++;
      if (result.position === 1) {
        standing.wins++;
      }
      standing.history.push({
        gameId,
        gameNumber: game.gameNumber,
        position: result.position,
        points: result.points,
      });
    }
  }

  // Update games complete count
  tournament.gamesComplete = Array.from(tournament.matches.values())
    .filter(m => m.complete).length;

  // Check if tournament is complete
  if (tournament.gamesComplete >= tournament.totalGames) {
    tournament.isComplete = true;
  }

  return tournament;
}

/**
 * Get sorted standings
 */
export function getStandings(tournament) {
  const standings = Array.from(tournament.standings.values());

  // Sort by points, then wins, then games completed
  standings.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.gamesCompleted - a.gamesCompleted;
  });

  return standings.map((s, i) => ({
    place: i + 1,
    ...s,
  }));
}
