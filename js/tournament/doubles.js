/**
 * Doubles (Team-Based) Tournament Adapter
 * Wraps other bracket types to work with teams
 */

import { generateSingleEliminationBracket, recordMatchResult as recordSingleElim } from './single-elimination.js';
import { generateDoubleEliminationBracket, recordMatchResult as recordDoubleElim } from './double-elimination.js';

/**
 * Form teams from participants
 * @param {Object[]} participants - All participants
 * @param {Map} teamAssignments - Map of participantId -> teamId
 * @param {number} teamSize - Required team size
 * @returns {Object[]} Array of teams
 */
export function formTeams(participants, teamAssignments, teamSize = 2) {
  const teams = new Map();

  for (const participant of participants) {
    const teamId = teamAssignments.get(participant.id);
    if (!teamId) continue;

    if (!teams.has(teamId)) {
      teams.set(teamId, {
        id: teamId,
        name: `Team ${teamId}`,
        members: [],
        seed: null,
      });
    }

    teams.get(teamId).members.push(participant);
  }

  // Validate team sizes
  const validTeams = [];
  for (const team of teams.values()) {
    if (team.members.length === teamSize) {
      // Set team name from members
      team.name = team.members.map(m => m.name).join(' & ');
      // Set seed as average of member seeds
      const avgSeed = team.members.reduce((sum, m) => sum + (m.seed || 999), 0) / teamSize;
      team.seed = avgSeed;
      validTeams.push(team);
    }
  }

  return validTeams.sort((a, b) => a.seed - b.seed);
}

/**
 * Generate a doubles tournament
 * @param {Object[]} participants - All participants
 * @param {Map} teamAssignments - Map of participantId -> teamId
 * @param {Object} config - Tournament configuration
 * @returns {Object} Tournament structure
 */
export function generateDoublesTournament(participants, teamAssignments, config = {}) {
  const teamSize = config.teamSize || 2;
  const bracketType = config.bracketType || 'single';

  // Form teams
  const teams = formTeams(participants, teamAssignments, teamSize);

  if (teams.length < 2) {
    throw new Error('Need at least 2 complete teams');
  }

  // Generate underlying bracket using teams as "participants"
  let bracket;
  if (bracketType === 'double') {
    bracket = generateDoubleEliminationBracket(teams, config);
  } else {
    bracket = generateSingleEliminationBracket(teams, config);
  }

  return {
    ...bracket,
    type: 'doubles',
    bracketType,
    teams,
    teamSize,
    teamAssignments: Array.from(teamAssignments.entries()),
    participants,
  };
}

/**
 * Record match result for doubles
 */
export function recordMatchResult(tournament, matchId, scores, winnerId, reportedBy) {
  if (tournament.bracketType === 'double') {
    return recordDoubleElim(tournament, matchId, scores, winnerId, reportedBy);
  } else {
    return recordSingleElim(tournament, matchId, scores, winnerId, reportedBy);
  }
}

/**
 * Validate team assignments
 */
export function validateTeamAssignments(participants, teamAssignments, teamSize) {
  const teams = new Map();
  const errors = [];

  for (const participant of participants) {
    const teamId = teamAssignments.get(participant.id);
    if (!teamId) {
      errors.push(`${participant.name} is not assigned to a team`);
      continue;
    }

    if (!teams.has(teamId)) {
      teams.set(teamId, []);
    }
    teams.get(teamId).push(participant);
  }

  for (const [teamId, members] of teams) {
    if (members.length !== teamSize) {
      errors.push(`Team ${teamId} has ${members.length} members (needs ${teamSize})`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    teamCount: teams.size,
    completeTeams: Array.from(teams.values()).filter(m => m.length === teamSize).length,
  };
}

/**
 * Auto-assign teams (random pairing)
 */
export function autoAssignTeams(participants, teamSize = 2) {
  const shuffled = [...participants].sort(() => Math.random() - 0.5);
  const assignments = new Map();

  let teamNumber = 1;
  for (let i = 0; i < shuffled.length; i += teamSize) {
    const teamId = `team-${teamNumber}`;
    for (let j = 0; j < teamSize && i + j < shuffled.length; j++) {
      assignments.set(shuffled[i + j].id, teamId);
    }
    teamNumber++;
  }

  return assignments;
}

/**
 * Get standings for doubles (wraps underlying bracket type)
 */
export async function getStandings(tournament, participants) {
  const teamMap = new Map(tournament.teams.map(t => [t.id, t]));

  // Dynamic import based on bracket type
  if (tournament.bracketType === 'double') {
    const { getStandings: getDoubleStandings } = await import('./double-elimination.js');
    const teamStandings = getDoubleStandings(tournament, teamMap);
    return teamStandings.map(s => ({
      ...s,
      team: tournament.teams.find(t => t.id === s.participantId),
    }));
  } else {
    const { getStandings: getSingleStandings } = await import('./single-elimination.js');
    const teamStandings = getSingleStandings(tournament, teamMap);
    return teamStandings.map(s => ({
      ...s,
      team: tournament.teams.find(t => t.id === s.participantId),
    }));
  }
}
