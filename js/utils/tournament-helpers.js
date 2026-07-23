/**
 * Tournament Helper Functions
 * Pure utility functions for tournament UI logic
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
