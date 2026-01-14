/**
 * Single Elimination Bracket
 * Standard knockout tournament format
 */

import { nextPowerOf2, getSeedPositions, getRoundName } from './bracket-utils.js';

/**
 * Generate a single elimination bracket
 * @param {Object[]} participants - Array of participants with id, name, seed
 * @param {Object} config - Tournament configuration
 * @returns {Object} Bracket structure with rounds and matches
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
  const numByes = bracketSize - seeded.length;

  const rounds = [];
  const matches = new Map();

  // Generate Round 1 with proper seeding
  const round1 = generateRound1(seeded, bracketSize, numByes);
  rounds.push(round1);

  // Add round 1 matches to map
  for (const match of round1.matches) {
    matches.set(match.id, match);
  }

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
        feedsFrom: [
          `r${r}m${m * 2}`,
          `r${r}m${m * 2 + 1}`,
        ],
      };
      round.matches.push(match);
      matches.set(match.id, match);
    }

    rounds.push(round);
  }

  // Process byes - advance winners automatically
  processByes(rounds, matches);

  return {
    type: 'single',
    rounds,
    matches,
    bracketSize,
    numRounds,
    participantCount: seeded.length,
  };
}

/**
 * Generate Round 1 with proper seeding positions
 */
function generateRound1(seeded, bracketSize, numByes) {
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
function processByes(rounds, matches) {
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
 * Record match result and advance winner
 * @param {Object} bracket - Bracket structure
 * @param {string} matchId - Match ID
 * @param {number[]} scores - Match scores [p1Score, p2Score]
 * @param {string} winnerId - Winner's participant ID
 * @param {string} reportedBy - Reporter's participant ID
 * @returns {Object} Updated bracket
 */
export function recordMatchResult(bracket, matchId, scores, winnerId, reportedBy) {
  const match = bracket.matches.get(matchId);
  if (!match) {
    throw new Error(`Match not found: ${matchId}`);
  }

  // Update match
  match.scores = scores;
  match.winnerId = winnerId;
  match.reportedBy = reportedBy;
  match.reportedAt = Date.now();

  // Advance winner to next round
  advanceWinner(bracket, match);

  // Check if tournament is complete
  checkTournamentComplete(bracket);

  return bracket;
}

/**
 * Advance winner to next match
 */
function advanceWinner(bracket, match) {
  if (match.round >= bracket.numRounds) {
    // This was the finals
    return;
  }

  const nextRound = bracket.rounds[match.round];
  const nextMatchIdx = Math.floor(match.position / 2);
  const nextMatch = nextRound?.matches[nextMatchIdx];

  if (nextMatch) {
    const slot = match.position % 2;
    nextMatch.participants[slot] = match.winnerId;
  }
}

/**
 * Check if tournament is complete
 */
function checkTournamentComplete(bracket) {
  const finals = bracket.rounds[bracket.rounds.length - 1]?.matches[0];
  bracket.isComplete = finals?.winnerId !== null;
  return bracket.isComplete;
}

/**
 * Get active matches (can be played now)
 * @param {Object} bracket - Bracket structure
 * @returns {Object[]} Array of playable matches
 */
export function getActiveMatches(bracket) {
  const active = [];

  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      // Match is active if:
      // 1. No winner yet
      // 2. Both participants are set
      // 3. Not a bye
      if (
        !match.winnerId &&
        !match.isBye &&
        match.participants[0] &&
        match.participants[1]
      ) {
        active.push(match);
      }
    }
  }

  return active;
}

/**
 * Get final standings
 * @param {Object} bracket - Bracket structure
 * @param {Map} participants - Participants map
 * @returns {Object[]} Standings array
 */
export function getStandings(bracket, participants) {
  if (!bracket.isComplete) {
    return [];
  }

  const standings = [];
  const eliminated = new Map(); // participantId -> round eliminated

  // Track when each participant was eliminated
  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      if (match.winnerId && !match.isBye) {
        const loserId = match.participants.find(p => p !== match.winnerId);
        if (loserId && !eliminated.has(loserId)) {
          eliminated.set(loserId, match.round);
        }
      }
    }
  }

  // Winner
  const finals = bracket.rounds[bracket.rounds.length - 1].matches[0];
  if (finals.winnerId) {
    const winner = participants.get(finals.winnerId);
    standings.push({
      place: 1,
      participantId: finals.winnerId,
      name: winner?.name || 'Unknown',
    });

    // Runner-up
    const loserId = finals.participants.find(p => p !== finals.winnerId);
    if (loserId) {
      const loser = participants.get(loserId);
      standings.push({
        place: 2,
        participantId: loserId,
        name: loser?.name || 'Unknown',
      });
    }
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

/**
 * Check if a participant can report a match
 * @param {Object} match - Match object
 * @param {string} participantId - Participant's ID
 * @returns {boolean}
 */
export function canReportMatch(match, participantId) {
  return match.participants.includes(participantId);
}
