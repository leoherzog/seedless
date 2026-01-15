/**
 * Shared test fixtures and helper functions
 */

/**
 * Create an array of participants with sequential IDs and seeds
 * @param {number} count - Number of participants to create
 * @returns {Object[]} Array of participant objects
 */
export function createParticipants(count) {
  const baseTime = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    id: `player-${i + 1}`,
    name: `Player ${i + 1}`,
    seed: i + 1,
    joinedAt: baseTime - (count - i) * 1000,
    isConnected: true,
  }));
}

/**
 * Create a Map of participants keyed by ID
 * @param {Object[]} participants - Array of participants
 * @returns {Map} Map of participantId -> participant
 */
export function createParticipantMap(participants) {
  return new Map(participants.map(p => [p.id, p]));
}

// Pre-built participant sets for common test scenarios
export const participants2 = createParticipants(2);
export const participants3 = createParticipants(3);
export const participants4 = createParticipants(4);
export const participants5 = createParticipants(5);
export const participants8 = createParticipants(8);
export const participants16 = createParticipants(16);

/**
 * Create team assignments for doubles tournaments
 * @param {Object[]} participants - Array of participants
 * @param {number} teamSize - Number of players per team
 * @returns {Map} Map of participantId -> teamId
 */
export function createTeamAssignments(participants, teamSize = 2) {
  const assignments = new Map();
  let teamNum = 1;
  for (let i = 0; i < participants.length; i += teamSize) {
    const teamId = `team-${teamNum}`;
    for (let j = 0; j < teamSize && i + j < participants.length; j++) {
      assignments.set(participants[i + j].id, teamId);
    }
    teamNum++;
  }
  return assignments;
}

/**
 * Create incomplete team assignments (some participants unassigned)
 * @param {Object[]} participants - Array of participants
 * @param {number} assignCount - Number of participants to assign
 * @returns {Map} Map of participantId -> teamId
 */
export function createPartialTeamAssignments(participants, assignCount) {
  const assignments = new Map();
  let teamNum = 1;
  for (let i = 0; i < Math.min(assignCount, participants.length); i += 2) {
    const teamId = `team-${teamNum}`;
    assignments.set(participants[i].id, teamId);
    if (i + 1 < assignCount) {
      assignments.set(participants[i + 1].id, teamId);
    }
    teamNum++;
  }
  return assignments;
}

/**
 * Standard points table for mario kart tests
 */
export const standardPointsTable = [15, 12, 10, 8, 6, 4, 2, 1];

/**
 * Simulate playing a match and returning result
 * @param {string} winnerId - ID of the winner
 * @param {string[]} participants - Array of participant IDs in the match
 * @returns {Object} Match result object
 */
export function createMatchResult(winnerId, participants) {
  return {
    winnerId,
    scores: participants[0] === winnerId ? [2, 0] : [0, 2],
    reportedBy: winnerId,
  };
}
