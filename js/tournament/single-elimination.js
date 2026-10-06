/**
 * Single-elimination brackets: generation, winner advancement and final standings.
 */

import { buildKnockout, getRoundName, toMatchIds } from './bracket-utils.js';

/**
 * Generate a seeded single-elimination bracket with round-1 byes already advanced.
 * @param {Object[]} participants - At least 2, each with id, name and optional seed
 * @returns {{bracket: Object, matches: Map}} Bracket of round match ids, and the matches by id
 */
export function generateSingleEliminationBracket(participants) {
  const { rounds } = buildKnockout(
    participants,
    (round, position) => ({
      id: `r${round}m${position}`,
      round,
      position,
      participants: [null, null],
      scores: [0, 0],
      winnerId: null,
      reportedBy: null,
      reportedAt: null,
      verifiedBy: null,
      isBye: false,
    }),
    (round, numRounds) => round === 1 ? 'Round 1' : getRoundName(round, numRounds),
  );

  return {
    bracket: { type: 'single', rounds: toMatchIds(rounds) },
    matches: new Map(rounds.flatMap(r => r.matches).map(m => [m.id, m])),
  };
}

/**
 * Advance a decided match's winner into the next round.
 * @param {{bracket: Object, matches: Map}} tournament
 * @param {string} matchId - Match whose winnerId is set
 * @param {Function} [update] - (id, fields) writer for a match; defaults to the Map entry
 * @returns {boolean} True once the final has a winner
 */
export function advance({ bracket, matches }, matchId, update = (id, fields) => Object.assign(matches.get(id), fields)) {
  const match = matches.get(matchId);
  const nextId = bracket.rounds[match.round]?.matchIds[Math.floor(match.position / 2)];
  if (nextId) {
    update(nextId, { participants: matches.get(nextId).participants.with(match.position % 2, match.winnerId) });
  }
  return !!finalMatch(bracket, matches).winnerId;
}

/**
 * The championship match.
 */
function finalMatch(bracket, matches) {
  return matches.get(bracket.rounds.at(-1).matchIds[0]);
}

/**
 * Rank the champion, the runner-up, then everyone else by the round they lost in, latest first.
 * @param {Object} bracket - Bracket structure
 * @param {Map} matches - Matches by id
 * @param {Map} participants - Participant or team by id, for names
 * @returns {Object[]} Standings array; empty until the final has a winner
 */
export function getStandings(bracket, matches, participants) {
  const finals = finalMatch(bracket, matches);
  if (!finals.winnerId) {
    return [];
  }

  const standings = [];
  const eliminated = new Map(); // participantId -> round eliminated

  for (const id of bracket.rounds.flatMap(r => r.matchIds)) {
    const match = matches.get(id);
    if (match.winnerId && !match.isBye) {
      const loserId = match.participants.find(p => p !== match.winnerId);
      if (loserId && !eliminated.has(loserId)) {
        eliminated.set(loserId, match.round);
      }
    }
  }

  const winner = participants.get(finals.winnerId);
  standings.push({
    place: 1,
    participantId: finals.winnerId,
    name: winner?.name || 'Unknown',
  });

  const runnerUpId = finals.participants.find(p => p !== finals.winnerId);
  if (runnerUpId) {
    const runnerUp = participants.get(runnerUpId);
    standings.push({
      place: 2,
      participantId: runnerUpId,
      name: runnerUp?.name || 'Unknown',
    });
  }

  const remaining = Array.from(eliminated.entries())
    .filter(([id]) => !standings.find(s => s.participantId === id))
    .sort((a, b) => b[1] - a[1]);

  let place = 3;
  for (const [participantId] of remaining) {
    const p = participants.get(participantId);
    standings.push({
      place: place++,
      participantId,
      name: p?.name || 'Unknown',
    });
  }

  return standings;
}
