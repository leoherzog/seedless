/**
 * Tournament Helper Functions
 * Pure helpers shared by the tournament modules and the UI: match status, ordinals,
 * standings order, seeding and shuffling.
 */

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 * @param {number} n - Number to get suffix for
 * @returns {string} Ordinal suffix ('st', 'nd', 'rd', or 'th')
 */
export function getOrdinalSuffix(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Format a number with its ordinal suffix
 * @param {number} n - Number to format
 * @returns {string} Number with suffix (e.g., "1st", "2nd", "3rd")
 */
export function formatOrdinal(n) {
  return n + getOrdinalSuffix(n);
}

/**
 * Determine the status of a match
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
 * Get points for a position based on points table configuration
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
 * Sort standings by points, then wins, then games completed
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
 * Fisher-Yates shuffle in place
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
