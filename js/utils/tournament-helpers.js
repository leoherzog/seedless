/**
 * Pure helpers shared by the tournament modules and the UI: ordinals, match status, points,
 * standings order, seeding and match membership.
 */

/**
 * Get the ordinal suffix for a number, including 'th' for 11 to 13.
 * @param {number} n - Number to get suffix for
 * @returns {string} Ordinal suffix ('st', 'nd', 'rd', or 'th')
 */
export function getOrdinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Format a number with its ordinal suffix.
 * @param {number} n - Number to format
 * @returns {string} Number with suffix (e.g., "1st", "2nd", "3rd")
 */
export function formatOrdinal(n) {
  return n + getOrdinalSuffix(n);
}

/**
 * Determine the status of a match: complete once it has a winner, live once both slots are filled.
 * @param {Object} match - Match object
 * @param {string} [match.winnerId] - Winner's ID if determined
 * @param {Array} match.participants - Array of participant IDs
 * @returns {'pending' | 'live' | 'complete'} Match status
 */
export function determineMatchStatus(match) {
  if (match.winnerId) {
    return 'complete';
  }
  if (match.participants[0] && match.participants[1]) {
    return 'live';
  }
  return 'pending';
}

/**
 * Get points for a finishing position. Positions past the end of the table score 0.
 * @param {Array|string} pointsTable - Points table array or 'sequential'
 * @param {number} position - 0-indexed position in results
 * @param {number} totalPlayers - Total number of players (for sequential scoring)
 * @returns {number} Points for this position
 */
export function getPointsForPosition(pointsTable, position, totalPlayers) {
  if (pointsTable === 'sequential') {
    return totalPlayers - position;
  }
  return Array.isArray(pointsTable) ? (pointsTable[position] || 0) : 0;
}

/**
 * Sort standings by points, then wins, then games completed, without mutating the input.
 * @param {Array} standings - Array of standing objects
 * @returns {Array} Sorted standings
 */
export function sortStandings(standings) {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.wins !== a.wins) return b.wins - a.wins;
    return b.gamesCompleted - a.gamesCompleted;
  });
}

/**
 * Fisher-Yates shuffle in place.
 * @param {any[]} items - Array to shuffle
 * @returns {any[]} The same array
 */
export function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/**
 * Comparator ordering participants by seed; unseeded participants sort last.
 */
export const bySeed = (a, b) => (a.seed || 999) - (b.seed || 999);

/**
 * Order participants for seeding: shuffled in 'random' mode, by current seed otherwise.
 * @param {Object[]} participants - Participants with optional seed
 * @param {string} mode - meta.config.seedingMode
 * @returns {Object[]} A new array, best seed first
 */
export function seedParticipants(participants, mode) {
  return mode === 'random' ? shuffle([...participants]) : participants.toSorted(bySeed);
}

/**
 * Whether one report of a result supersedes another: the higher version, then the later
 * reportedAt, then the greater reporter id. Every peer orders any two reports the same way.
 * @param {{version?: number, reportedAt?: number, reportedBy?: string}} incoming
 * @param {{version?: number, reportedAt?: number, reportedBy?: string}} existing
 * @returns {boolean}
 */
export function isNewerResult(incoming, existing) {
  const key = (r) => [r.version || 0, r.reportedAt || 0, r.reportedBy ?? ''];
  const [a, b] = [key(incoming), key(existing)];
  const i = a.findIndex((v, idx) => v !== b[idx]);
  return i >= 0 && a[i] > b[i];
}

/**
 * Whether a finishing order lists each of a game's racers exactly once.
 * @param {{participants: string[]}} game - Points Race game
 * @param {*} results - Array of { participantId }, in finishing order
 * @returns {boolean}
 */
export function isRaceOrder(game, results) {
  if (!Array.isArray(results) || results.length !== game.participants.length) return false;
  const ids = new Set(results.map((r) => r?.participantId));
  return ids.size === results.length && game.participants.every((id) => ids.has(id));
}

/**
 * Whether a user plays in a match, directly or as a member of one of its teams.
 * @param {Object} match - Match whose participants are player or team ids
 * @param {string} userId - Persistent user id
 * @param {Object[]} [teams] - Bracket teams; pass an array for doubles, omit otherwise
 * @returns {boolean}
 */
export function isInMatch(match, userId, teams) {
  return teams
    ? teams.some(t => match.participants.includes(t.id) && t.members.some(m => m.id === userId))
    : match.participants.includes(userId);
}
