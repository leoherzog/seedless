/**
 * Doubles (Team-Based) Tournament Adapter
 * Wraps other bracket types to work with teams
 */

import { generateSingleEliminationBracket, getStandings as getSingleStandings } from './single-elimination.js';
import { generateDoubleEliminationBracket, getStandings as getDoubleStandings } from './double-elimination.js';

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
 * @returns {{bracket: Object, matches: Map}} Team bracket of round match ids, and the matches by id
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
  const generate = bracketType === 'double' ? generateDoubleEliminationBracket : generateSingleEliminationBracket;
  const { bracket, matches } = generate(teams, config);

  return {
    bracket: {
      ...bracket,
      type: 'doubles',
      bracketType,
      teams,
      teamSize,
      teamAssignments: Array.from(teamAssignments.entries()),
      participants,
    },
    matches,
  };
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
 * Get team standings from the underlying single- or double-elimination bracket.
 * @param {Object} bracket - Doubles bracket with teams and bracketType
 * @param {Map} matches - Matches by id
 * @returns {Object[]} Standings, each with its team attached
 */
export function getStandings(bracket, matches) {
  const teamMap = new Map(bracket.teams.map(t => [t.id, t]));

  const getUnderlyingStandings = bracket.bracketType === 'double'
    ? getDoubleStandings
    : getSingleStandings;
  const teamStandings = getUnderlyingStandings(bracket, matches, teamMap);

  return teamStandings.map(s => ({
    ...s,
    team: teamMap.get(s.participantId),
  }));
}
