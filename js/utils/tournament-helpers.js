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
 * Check if a user can report a match result
 * @param {Object} match - Match object
 * @param {string} [match.winnerId] - Winner's ID if determined
 * @param {boolean} [match.isBye] - Whether this is a bye match
 * @param {Array} match.participants - Array of participant IDs
 * @param {string} localUserId - Current user's ID
 * @returns {boolean} True if user can report
 */
export function canReportMatchResult(match, localUserId) {
  return !match.winnerId &&
    !match.isBye &&
    match.participants.includes(localUserId) &&
    Boolean(match.participants[0]) &&
    Boolean(match.participants[1]);
}

/**
 * Count members in a team, optionally excluding one participant
 * @param {Map|Array} teamAssignments - Map of participantId → teamId, or array of [participantId, teamId] entries
 * @param {string} teamId - Team ID to count
 * @param {string} [excludeParticipantId] - Participant ID to exclude from count
 * @returns {number} Number of team members
 */
export function getTeamMemberCount(teamAssignments, teamId, excludeParticipantId = null) {
  let count = 0;

  // Handle both Map and Array
  const entries = teamAssignments instanceof Map
    ? teamAssignments.entries()
    : teamAssignments;

  for (const [participantId, assignedTeamId] of entries) {
    if (assignedTeamId === teamId && participantId !== excludeParticipantId) {
      count++;
    }
  }

  return count;
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
