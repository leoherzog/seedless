/**
 * Doubles (Team-Based) Tournament Adapter
 * Wraps other bracket types to work with teams
 */

import { shuffle } from '../utils/tournament-helpers.js';
import { generateSingleEliminationBracket, getStandings as getSingleStandings } from './single-elimination.js';
import { generateDoubleEliminationBracket, getStandings as getDoubleStandings } from './double-elimination.js';

/**
 * Form full teams from participants; incomplete teams are left out.
 * @param {Object[]} participants - All participants
 * @param {Map} teamAssignments - Map of participantId -> teamId
 * @param {number} teamSize - Required team size
 * @returns {Object[]} Teams named after their members, best average seed first
 */
export function formTeams(participants, teamAssignments, teamSize) {
  const groups = Map.groupBy(participants, p => teamAssignments.get(p.id));
  return [...groups]
    .filter(([id, members]) => id && members.length === teamSize)
    .map(([id, members]) => ({
      id,
      name: members.map(m => m.name).join(' & '),
      members,
      seed: members.reduce((sum, m) => sum + (m.seed || 999), 0) / teamSize,
    }))
    .sort((a, b) => a.seed - b.seed);
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

  const teams = formTeams(participants, teamAssignments, teamSize);

  if (teams.length < 2) {
    throw new Error('Need at least 2 complete teams');
  }

  const generate = bracketType === 'double' ? generateDoubleEliminationBracket : generateSingleEliminationBracket;
  const { bracket, matches } = generate(teams);

  return {
    bracket: { ...bracket, type: 'doubles', bracketType, teams },
    matches,
  };
}

/**
 * Check that every participant is on a team of exactly teamSize.
 * @param {Object[]} participants - All participants
 * @param {Map} teamAssignments - Map of participantId -> teamId
 * @param {number} teamSize - Required team size
 * @returns {{valid: boolean, errors: string[], teamCount: number, completeTeams: number}}
 */
export function validateTeamAssignments(participants, teamAssignments, teamSize) {
  const teams = Map.groupBy(participants, p => teamAssignments.get(p.id));
  const errors = (teams.get(undefined) ?? []).map(p => `${p.name} is not assigned to a team`);
  teams.delete(undefined);

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
 * Randomly split participants into teams of teamSize; the last team may be short.
 * @param {Object[]} participants - All participants
 * @param {number} teamSize - Players per team
 * @returns {Map} participantId -> teamId
 */
export function autoAssignTeams(participants, teamSize) {
  const shuffled = shuffle([...participants]);
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
