/**
 * Single Elimination Bracket
 * Standard knockout tournament format
 */

import { nextPowerOf2, getSeedPositions, getRoundName, toMatchIds } from './bracket-utils.js';

/**
 * Generate a single elimination bracket
 * @param {Object[]} participants - Array of participants with id, name, seed
 * @param {Object} config - Tournament configuration
 * @returns {{bracket: Object, matches: Map}} Bracket of round match ids, and the matches by id
 */
export function generateSingleEliminationBracket(participants, config = {}) {
  if (participants.length < 2) {
    throw new Error('Need at least 2 participants');
  }

  // Sort by seed
  const seeded = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));

  // Calculate bracket size (next power of 2)
  const bracketSize = nextPowerOf2(seeded.length);
  const numRounds = Math.log2(bracketSize);

  // Generate Round 1 with proper seeding
  const rounds = [generateRound1(seeded, bracketSize)];

  // Generate subsequent rounds
  let matchesInRound = bracketSize / 2;
  for (let r = 1; r < numRounds; r++) {
    matchesInRound = matchesInRound / 2;
    const round = {
      number: r + 1,
      name: getRoundName(r + 1, numRounds),
      matches: [],
    };

    for (let m = 0; m < matchesInRound; m++) {
      const match = {
        id: `r${r + 1}m${m}`,
        round: r + 1,
        position: m,
        participants: [null, null],
        scores: [0, 0],
        winnerId: null,
        reportedBy: null,
        reportedAt: null,
        verifiedBy: null,
        isBye: false,
      };
      round.matches.push(match);
    }

    rounds.push(round);
  }

  // Process byes - advance winners automatically
  processByes(rounds);

  return {
    bracket: {
      type: 'single',
      rounds: toMatchIds(rounds),
      bracketSize,
      numRounds,
      participantCount: seeded.length,
    },
    matches: new Map(rounds.flatMap(r => r.matches).map(m => [m.id, m])),
  };
}

/**
 * Generate Round 1 with proper seeding positions
 */
function generateRound1(seeded, bracketSize) {
  const positions = getSeedPositions(bracketSize);

  // Place participants in seeded positions
  const slots = new Array(bracketSize).fill(null);
  seeded.forEach((p, i) => {
    slots[positions[i]] = p;
  });

  // Create matches from paired slots
  const matches = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    const p1 = slots[i * 2];
    const p2 = slots[i * 2 + 1];

    const match = {
      id: `r1m${i}`,
      round: 1,
      position: i,
      participants: [p1?.id || null, p2?.id || null],
      scores: [0, 0],
      winnerId: null,
      reportedBy: null,
      reportedAt: null,
      verifiedBy: null,
      isBye: !p1 || !p2,
    };

    // Auto-advance if bye
    if (match.isBye && (p1 || p2)) {
      match.winnerId = p1?.id || p2?.id;
    }

    matches.push(match);
  }

  return {
    number: 1,
    name: 'Round 1',
    matches,
  };
}

/**
 * Process byes - advance winners to next round
 */
function processByes(rounds) {
  for (let r = 0; r < rounds.length - 1; r++) {
    const round = rounds[r];

    for (const match of round.matches) {
      if (match.isBye && match.winnerId) {
        // Find next match
        const nextMatchIdx = Math.floor(match.position / 2);
        const nextRound = rounds[r + 1];
        const nextMatch = nextRound?.matches[nextMatchIdx];

        if (nextMatch) {
          const slot = match.position % 2;
          nextMatch.participants[slot] = match.winnerId;
        }
      }
    }
  }
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
 * Get final standings
 * @param {Object} bracket - Bracket structure
 * @param {Map} matches - Matches by id
 * @param {Map} participants - Participants map
 * @returns {Object[]} Standings array; empty until the final has a winner
 */
export function getStandings(bracket, matches, participants) {
  const finals = finalMatch(bracket, matches);
  if (!finals.winnerId) {
    return [];
  }

  const standings = [];
  const eliminated = new Map(); // participantId -> round eliminated

  // Track when each participant was eliminated
  for (const id of bracket.rounds.flatMap(r => r.matchIds)) {
    const match = matches.get(id);
    if (match.winnerId && !match.isBye) {
      const loserId = match.participants.find(p => p !== match.winnerId);
      if (loserId && !eliminated.has(loserId)) {
        eliminated.set(loserId, match.round);
      }
    }
  }

  // Winner
  const winner = participants.get(finals.winnerId);
  standings.push({
    place: 1,
    participantId: finals.winnerId,
    name: winner?.name || 'Unknown',
  });

  // Runner-up
  const runnerUpId = finals.participants.find(p => p !== finals.winnerId);
  if (runnerUpId) {
    const runnerUp = participants.get(runnerUpId);
    standings.push({
      place: 2,
      participantId: runnerUpId,
      name: runnerUp?.name || 'Unknown',
    });
  }

  // Sort remaining by round eliminated (later = better)
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
