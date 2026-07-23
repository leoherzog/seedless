/**
 * Double Elimination Bracket
 * Winners bracket + losers bracket + grand finals
 */

import { nextPowerOf2, getSeedPositions } from './bracket-utils.js';

/**
 * Generate a double elimination bracket
 * @param {Object[]} participants - Array of participants
 * @param {Object} config - Tournament configuration
 * @returns {Object} Bracket structure
 */
export function generateDoubleEliminationBracket(participants, config = {}) {
  if (participants.length < 2) {
    throw new Error('Need at least 2 participants');
  }

  const seeded = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));
  const bracketSize = nextPowerOf2(seeded.length);
  const winnersRounds = Math.log2(bracketSize);
  const losersRounds = 2 * (winnersRounds - 1);

  const winners = generateWinnersBracket(seeded, bracketSize);
  const losers = generateLosersBracket(bracketSize, winnersRounds);
  const grandFinals = generateGrandFinals();

  // Combine all matches into one map
  const matches = new Map();

  // Winners bracket matches
  for (const round of winners.rounds) {
    for (const match of round.matches) {
      matches.set(match.id, match);
    }
  }

  // Losers bracket matches
  for (const round of losers.rounds) {
    for (const match of round.matches) {
      matches.set(match.id, match);
    }
  }

  // Grand finals
  matches.set(grandFinals.match.id, grandFinals.match);
  if (grandFinals.reset) {
    matches.set(grandFinals.reset.id, grandFinals.reset);
  }

  // Process winners bracket byes
  processWinnersByes(winners, losers, matches);

  // Mark losers-bracket slots that can never be filled because their feeding
  // winners match was a bye (a bye produces no loser to drop down).
  markDeadLosersSlots(winners, losers);

  return {
    type: 'double',
    winners,
    losers,
    grandFinals,
    matches,
    bracketSize,
    winnersRounds,
    losersRounds,
    participantCount: seeded.length,
    isComplete: false,
  };
}

/**
 * Generate winners bracket (same as single elimination)
 */
function generateWinnersBracket(seeded, bracketSize) {
  const numRounds = Math.log2(bracketSize);
  const rounds = [];

  // Round 1
  const positions = getSeedPositions(bracketSize);
  const slots = new Array(bracketSize).fill(null);
  seeded.forEach((p, i) => {
    slots[positions[i]] = p;
  });

  const round1Matches = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    const p1 = slots[i * 2];
    const p2 = slots[i * 2 + 1];

    round1Matches.push({
      id: `w1m${i}`,
      bracket: 'winners',
      round: 1,
      position: i,
      participants: [p1?.id || null, p2?.id || null],
      scores: [0, 0],
      winnerId: null,
      loserId: null,
      isBye: !p1 || !p2,
      dropsTo: calculateDropTarget(1, i, bracketSize),
    });
  }

  rounds.push({ number: 1, name: 'Winners R1', matches: round1Matches });

  // Subsequent rounds
  let matchesInRound = bracketSize / 2;
  for (let r = 1; r < numRounds; r++) {
    matchesInRound = matchesInRound / 2;
    const roundMatches = [];

    for (let m = 0; m < matchesInRound; m++) {
      roundMatches.push({
        id: `w${r + 1}m${m}`,
        bracket: 'winners',
        round: r + 1,
        position: m,
        participants: [null, null],
        scores: [0, 0],
        winnerId: null,
        loserId: null,
        isBye: false,
        dropsTo: calculateDropTarget(r + 1, m, bracketSize),
      });
    }

    rounds.push({
      number: r + 1,
      name: getWinnersRoundName(r + 1, numRounds),
      matches: roundMatches,
    });
  }

  return { rounds };
}

/**
 * Generate losers bracket
 */
function generateLosersBracket(bracketSize, winnersRounds) {
  const rounds = [];
  const losersRounds = 2 * (winnersRounds - 1);

  let currentSize = bracketSize / 2;

  for (let r = 0; r < losersRounds; r++) {
    const isMinorRound = r % 2 === 0; // Minor = receives dropdowns
    const roundNum = r + 1;

    if (isMinorRound && r > 0) {
      currentSize = currentSize / 2;
    }

    const matchCount = currentSize / 2;
    const roundMatches = [];

    for (let m = 0; m < Math.max(1, matchCount); m++) {
      roundMatches.push({
        id: `l${roundNum}m${m}`,
        bracket: 'losers',
        round: roundNum,
        position: m,
        participants: [null, null],
        scores: [0, 0],
        winnerId: null,
        isBye: false,
        isMinorRound,
      });
    }

    rounds.push({
      number: roundNum,
      name: `Losers R${roundNum}`,
      matches: roundMatches,
    });
  }

  return { rounds };
}

/**
 * Generate grand finals (and bracket reset)
 */
function generateGrandFinals() {
  return {
    match: {
      id: 'gf1',
      bracket: 'grandFinals',
      round: 1,
      position: 0,
      participants: [null, null], // [winners champ, losers champ]
      scores: [0, 0],
      winnerId: null,
      isBye: false,
    },
    reset: {
      id: 'gf2',
      bracket: 'grandFinals',
      round: 2,
      position: 0,
      participants: [null, null],
      scores: [0, 0],
      winnerId: null,
      isBye: false,
      requiresPlay: false, // Only if losers champ wins GF1
    },
  };
}

/**
 * Calculate where a loser drops to in losers bracket
 */
function calculateDropTarget(winnersRound, position, bracketSize) {
  const numWinnersRounds = Math.log2(bracketSize);
  const numLosersRounds = 2 * (numWinnersRounds - 1);

  // Winners Finals loser goes to Losers Finals
  if (winnersRound === numWinnersRounds) {
    return { round: numLosersRounds, position: 0, slot: 1 };
  }

  // W1 losers pair up in L1, W2 losers mix in L2, etc.
  // Formula: losersRound = winnersRound for early rounds
  // For L1: W1 losers pair up (slot determined by position % 2)
  // For L2+: losers go to slot 1 to mix with previous losers winners
  if (winnersRound === 1) {
    // W1 losers pair up in L1
    const losersPosition = Math.floor(position / 2);
    const slot = position % 2;
    return { round: 1, position: losersPosition, slot };
  } else {
    // W2+ losers go to slot 1, mixing with previous round winners.
    // Standard double-elimination routing drops a winners-round-r loser into
    // the major losers round 2*(r-1). (For r === 2 this equals 2, matching the
    // old formula; for r >= 3 the old `round: winnersRound` dropped into an
    // already-filled minor round and corrupted the bracket.)
    return { round: 2 * (winnersRound - 1), position: position, slot: 1 };
  }
}

/**
 * Process byes in winners bracket
 */
function processWinnersByes(winners, losers, matches) {
  for (let r = 0; r < winners.rounds.length - 1; r++) {
    const round = winners.rounds[r];

    for (const match of round.matches) {
      if (match.isBye) {
        const winnerId = match.participants.find(p => p !== null);
        if (winnerId) {
          match.winnerId = winnerId;

          // Advance in winners
          const nextMatchIdx = Math.floor(match.position / 2);
          const nextRound = winners.rounds[r + 1];
          const nextMatch = nextRound?.matches[nextMatchIdx];
          if (nextMatch) {
            const slot = match.position % 2;
            nextMatch.participants[slot] = winnerId;
          }

          // No loser drops (bye match)
        }
      }
    }
  }
}

/**
 * Mark losers-bracket slots that will never receive a participant.
 *
 * Only round-1 winners matches can be byes (with participantCount > bracketSize/2
 * every later winners round is full), so dead losers slots originate from R1 bye
 * drop targets and then cascade: a losers match with both slots dead produces no
 * winner, so the slot it would have advanced into is dead too.
 */
function markDeadLosersSlots(winners, losers) {
  const round1 = winners.rounds[0];
  if (!round1) return;

  for (const match of round1.matches) {
    if (match.isBye && match.dropsTo) {
      const losersRound = losers.rounds[match.dropsTo.round - 1];
      const targetMatch = losersRound?.matches[match.dropsTo.position];
      if (targetMatch) {
        addDeadSlot(targetMatch, match.dropsTo.slot);
      }
    }
  }

  // Cascade fully-dead matches downstream (rounds processed in order).
  for (let r = 0; r < losers.rounds.length; r++) {
    for (const match of losers.rounds[r].matches) {
      if ((match.deadSlots?.length || 0) < 2) continue;

      // Fully dead: nobody advances, so mark the slot it would have fed.
      const nextRound = losers.rounds[r + 1];
      if (!nextRound) continue;
      const nextMatchIdx = match.isMinorRound ? match.position : Math.floor(match.position / 2);
      const nextMatch = nextRound.matches[nextMatchIdx];
      if (nextMatch) {
        const slot = match.isMinorRound ? 0 : match.position % 2;
        addDeadSlot(nextMatch, slot);
      }
    }
  }
}

function addDeadSlot(match, slot) {
  if (!match.deadSlots) match.deadSlots = [];
  if (!match.deadSlots.includes(slot)) match.deadSlots.push(slot);
}

/**
 * Resolve losers-bracket byes: any unresolved losers match that has exactly one
 * real participant and a permanently-dead slot auto-advances its lone participant.
 * Runs to a fixed point so cascading walkovers keep the bracket progressing.
 */
function resolveLosersByes(bracket) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const round of bracket.losers.rounds) {
      for (const match of round.matches) {
        if (match.winnerId) continue;
        if (!match.deadSlots || match.deadSlots.length === 0) continue;

        const realIds = match.participants.filter(p => p !== null);
        if (realIds.length === 1) {
          match.winnerId = realIds[0];
          match.loserId = null;
          advanceInLosers(bracket, match);
          changed = true;
        }
      }
    }
  }
}

/**
 * Get winners round name
 */
function getWinnersRoundName(roundNumber, totalRounds) {
  const fromFinals = totalRounds - roundNumber;
  switch (fromFinals) {
    case 0: return 'Winners Finals';
    case 1: return 'Winners Semis';
    default: return `Winners R${roundNumber}`;
  }
}

/**
 * Record match result in double elimination
 */
export function recordMatchResult(bracket, matchId, scores, winnerId, reportedBy) {
  const match = bracket.matches.get(matchId);
  if (!match) {
    throw new Error(`Match not found: ${matchId}`);
  }

  match.scores = scores;
  match.winnerId = winnerId;
  match.reportedBy = reportedBy;
  match.reportedAt = Date.now();

  const loserId = match.participants.find(p => p !== winnerId);
  match.loserId = loserId;

  if (match.bracket === 'winners') {
    // Advance winner in winners bracket
    advanceInWinners(bracket, match);
    // Drop loser to losers bracket
    if (loserId && !match.isBye) {
      dropToLosers(bracket, match, loserId);
    }
  } else if (match.bracket === 'losers') {
    // Advance winner in losers bracket (loser is eliminated)
    advanceInLosers(bracket, match);
  } else if (match.bracket === 'grandFinals') {
    handleGrandFinals(bracket, match, winnerId);
  }

  // Auto-advance any losers matches whose opponent slot is permanently empty
  // (byes from non-power-of-2 fields) so the losers bracket keeps progressing.
  resolveLosersByes(bracket);

  checkTournamentComplete(bracket);
  return bracket;
}

/**
 * Advance winner in winners bracket
 */
function advanceInWinners(bracket, match) {
  const currentRoundIdx = match.round - 1;
  const nextRound = bracket.winners.rounds[currentRoundIdx + 1];

  if (nextRound) {
    const nextMatchIdx = Math.floor(match.position / 2);
    const nextMatch = nextRound.matches[nextMatchIdx];
    if (nextMatch) {
      const slot = match.position % 2;
      nextMatch.participants[slot] = match.winnerId;
    }
  } else {
    // Winners finals - advance to grand finals
    bracket.grandFinals.match.participants[0] = match.winnerId;
  }
}

/**
 * Drop loser to losers bracket
 */
function dropToLosers(bracket, match, loserId) {
  if (!match.dropsTo) return;

  // Degenerate case (e.g. 2-player: losersRounds === 0): there is no losers
  // bracket, so the winners-final loser is the de-facto losers champion and
  // drops straight into grand finals slot 1. Without this, grandFinals never
  // fills and the tournament can never complete.
  if (match.dropsTo.round < 1 || bracket.losers.rounds.length === 0) {
    bracket.grandFinals.match.participants[1] = loserId;
    return;
  }

  const losersRound = bracket.losers.rounds[match.dropsTo.round - 1];
  if (losersRound) {
    const targetMatch = losersRound.matches[match.dropsTo.position];
    if (targetMatch) {
      // Use the slot from dropsTo (0 or 1)
      const slot = match.dropsTo.slot !== undefined ? match.dropsTo.slot : 1;
      targetMatch.participants[slot] = loserId;
    }
  }
}

/**
 * Advance winner in losers bracket
 */
function advanceInLosers(bracket, match) {
  const currentRoundIdx = match.round - 1;
  const nextRound = bracket.losers.rounds[currentRoundIdx + 1];

  if (nextRound) {
    const nextMatchIdx = match.isMinorRound ? match.position : Math.floor(match.position / 2);
    const nextMatch = nextRound.matches[nextMatchIdx];
    if (nextMatch) {
      const slot = match.isMinorRound ? 0 : match.position % 2;
      nextMatch.participants[slot] = match.winnerId;
    }
  } else {
    // Losers finals - advance to grand finals
    bracket.grandFinals.match.participants[1] = match.winnerId;
  }
}

/**
 * Handle grand finals result
 */
function handleGrandFinals(bracket, match, winnerId) {
  if (match.id === 'gf1') {
    // First grand finals
    if (winnerId === bracket.grandFinals.match.participants[1]) {
      // Losers champ won - need bracket reset
      bracket.grandFinals.reset.requiresPlay = true;
      bracket.grandFinals.reset.participants = [...match.participants];
    } else {
      // Winners champ won - tournament over
      bracket.isComplete = true;
    }
  } else if (match.id === 'gf2') {
    // Bracket reset - whoever wins is champion
    bracket.isComplete = true;
  }
}

/**
 * Check if tournament is complete
 */
function checkTournamentComplete(bracket) {
  const gf1 = bracket.grandFinals.match;
  const gf2 = bracket.grandFinals.reset;

  if (gf1.winnerId) {
    if (gf1.winnerId === gf1.participants[0]) {
      // Winners champ won GF1
      bracket.isComplete = true;
    } else if (gf2.requiresPlay && gf2.winnerId) {
      // Bracket reset completed
      bracket.isComplete = true;
    }
  }

  return bracket.isComplete;
}

/**
 * Get final standings
 */
export function getStandings(bracket, participants) {
  if (!bracket.isComplete) return [];

  const standings = [];

  // Champion
  let champion;
  if (bracket.grandFinals.reset.requiresPlay && bracket.grandFinals.reset.winnerId) {
    champion = bracket.grandFinals.reset.winnerId;
  } else {
    champion = bracket.grandFinals.match.winnerId;
  }

  if (champion) {
    const p = participants.get(champion);
    standings.push({ place: 1, participantId: champion, name: p?.name || 'Unknown' });

    // Runner-up
    const runnerUp = bracket.grandFinals.match.participants.find(id => id !== champion);
    if (runnerUp) {
      const p2 = participants.get(runnerUp);
      standings.push({ place: 2, participantId: runnerUp, name: p2?.name || 'Unknown' });
    }
  }

  // Track elimination for others
  const eliminated = new Map();

  for (const round of bracket.losers.rounds) {
    for (const match of round.matches) {
      if (match.winnerId && match.loserId) {
        if (!eliminated.has(match.loserId)) {
          eliminated.set(match.loserId, { round: match.round, bracket: 'losers' });
        }
      }
    }
  }

  // Sort by elimination round
  const remaining = Array.from(eliminated.entries())
    .filter(([id]) => !standings.find(s => s.participantId === id))
    .sort((a, b) => b[1].round - a[1].round);

  let place = 3;
  for (const [participantId] of remaining) {
    const p = participants.get(participantId);
    standings.push({ place: place++, participantId, name: p?.name || 'Unknown' });
  }

  return standings;
}
