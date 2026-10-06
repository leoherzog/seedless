/**
 * Double Elimination Bracket
 * Winners bracket + losers bracket + grand finals
 */

import { nextPowerOf2, getSeedPositions, toMatchIds } from './bracket-utils.js';

/**
 * Generate a double elimination bracket
 * @param {Object[]} participants - Array of participants
 * @param {Object} config - Tournament configuration
 * @returns {{bracket: Object, matches: Map}} Bracket of round match ids, and the matches by id
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
  const losers = generateLosersBracket(bracketSize, losersRounds);
  const grandFinals = generateGrandFinals();

  // Process winners bracket byes
  processWinnersByes(winners);

  // Mark losers-bracket slots that can never be filled because their feeding
  // winners match was a bye (a bye produces no loser to drop down).
  markDeadLosersSlots(winners, losers);

  const matches = [...winners.rounds, ...losers.rounds].flatMap(r => r.matches).concat(grandFinals);

  return {
    bracket: {
      type: 'double',
      winners: { rounds: toMatchIds(winners.rounds) },
      losers: { rounds: toMatchIds(losers.rounds) },
      grandFinals: grandFinals.map(m => m.id),
      bracketSize,
      winnersRounds,
      losersRounds,
      participantCount: seeded.length,
    },
    matches: new Map(matches.map(m => [m.id, m])),
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
      isBye: !p1 || !p2,
      dropsTo: calculateDropTarget(1, i, numRounds),
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
        isBye: false,
        dropsTo: calculateDropTarget(r + 1, m, numRounds),
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
function generateLosersBracket(bracketSize, losersRounds) {
  const rounds = [];

  let currentSize = bracketSize / 2;

  for (let r = 0; r < losersRounds; r++) {
    const isMinorRound = r % 2 === 0; // Minor = receives dropdowns
    const roundNum = r + 1;

    if (isMinorRound && r > 0) {
      currentSize = currentSize / 2;
    }

    const matchCount = currentSize / 2;
    const roundMatches = [];

    for (let m = 0; m < matchCount; m++) {
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
 * Generate grand finals and the bracket reset
 */
function generateGrandFinals() {
  return [
    {
      id: 'gf1',
      bracket: 'grandFinals',
      round: 1,
      position: 0,
      participants: [null, null], // [winners champ, losers champ]
      scores: [0, 0],
      winnerId: null,
      isBye: false,
    },
    {
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
  ];
}

/**
 * Calculate where a loser drops to in losers bracket
 */
function calculateDropTarget(winnersRound, position, winnersRounds) {
  // Winners Finals loser goes to Losers Finals
  if (winnersRound === winnersRounds) {
    return { round: 2 * (winnersRounds - 1), position: 0, slot: 1 };
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
function processWinnersByes(winners) {
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
  for (const match of winners.rounds[0].matches) {
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
 * Apply a decided match: advance its winner, drop its loser, open the reset when
 * the losers champion takes gf1, and walk over losers matches left without an opponent.
 * @param {{bracket: Object, matches: Map}} tournament
 * @param {string} matchId - Match whose winnerId is set
 * @param {Function} [update] - (id, fields) writer for a match; defaults to the Map entry
 * @returns {boolean} True once the champion is decided
 */
export function advance({ bracket, matches }, matchId, update = (id, fields) => Object.assign(matches.get(id), fields)) {
  const ctx = { bracket, matches, update };
  const [gf1, gf2] = bracket.grandFinals;
  const match = matches.get(matchId);

  if (match.bracket === 'winners') {
    const nextId = bracket.winners.rounds[match.round]?.matchIds[Math.floor(match.position / 2)];
    if (nextId) {
      fillSlot(ctx, nextId, match.position % 2, match.winnerId);
    } else {
      fillSlot(ctx, gf1, 0, match.winnerId);
    }

    const loserId = match.participants.find(p => p && p !== match.winnerId);
    if (loserId) {
      const { round, position, slot } = match.dropsTo;
      // With two players there is no losers bracket, so the loser goes straight to grand finals.
      if (round < 1) {
        fillSlot(ctx, gf1, 1, loserId);
      } else {
        fillSlot(ctx, bracket.losers.rounds[round - 1].matchIds[position], slot, loserId);
      }
    }
  } else if (match.bracket === 'losers') {
    advanceInLosers(ctx, match);
  } else if (matchId === gf1 && match.winnerId === match.participants[1]) {
    update(gf2, { participants: [...match.participants], requiresPlay: true });
  }

  resolveLosersByes(ctx);
  return championId(bracket, matches) !== null;
}

/**
 * Write a participant into one slot of a match.
 */
function fillSlot({ matches, update }, id, slot, participantId) {
  update(id, { participants: matches.get(id).participants.with(slot, participantId) });
}

/**
 * Advance a losers-bracket winner, or send the losers champion to grand finals.
 */
function advanceInLosers(ctx, match) {
  const round = ctx.bracket.losers.rounds[match.round];
  if (round) {
    const nextId = round.matchIds[match.isMinorRound ? match.position : Math.floor(match.position / 2)];
    fillSlot(ctx, nextId, match.isMinorRound ? 0 : match.position % 2, match.winnerId);
  } else {
    fillSlot(ctx, ctx.bracket.grandFinals[0], 1, match.winnerId);
  }
}

/**
 * Auto-advance each unresolved losers match whose only participant faces a dead slot.
 * Walkovers only feed later rounds, so one pass in round order resolves every cascade.
 */
function resolveLosersByes(ctx) {
  for (const id of ctx.bracket.losers.rounds.flatMap(r => r.matchIds)) {
    const match = ctx.matches.get(id);
    const present = match.participants.filter(Boolean);
    if (match.winnerId || !match.deadSlots?.length || present.length !== 1) continue;
    ctx.update(id, { winnerId: present[0] });
    advanceInLosers(ctx, ctx.matches.get(id));
  }
}

/**
 * The champion: the reset winner when the reset was played, else the winners champion if they took gf1.
 * @returns {string|null} Champion id, or null while grand finals are undecided
 */
function championId(bracket, matches) {
  const [gf1, gf2] = bracket.grandFinals.map(id => matches.get(id));
  if (gf2.requiresPlay && gf2.winnerId) return gf2.winnerId;
  if (gf1.winnerId && gf1.winnerId === gf1.participants[0]) return gf1.winnerId;
  return null;
}

/**
 * Get final standings
 * @param {Object} bracket - Bracket structure
 * @param {Map} matches - Matches by id
 * @param {Map} participants - Participants map
 * @returns {Object[]} Standings array; empty until the champion is decided
 */
export function getStandings(bracket, matches, participants) {
  const champion = championId(bracket, matches);
  if (!champion) return [];

  const standings = [];
  const p = participants.get(champion);
  standings.push({ place: 1, participantId: champion, name: p?.name || 'Unknown' });

  // Runner-up
  const runnerUp = matches.get(bracket.grandFinals[0]).participants.find(id => id !== champion);
  if (runnerUp) {
    const p2 = participants.get(runnerUp);
    standings.push({ place: 2, participantId: runnerUp, name: p2?.name || 'Unknown' });
  }

  // Everyone else is eliminated by a losers-bracket loss; walkovers have no loser.
  const eliminated = new Map();
  for (const id of bracket.losers.rounds.flatMap(r => r.matchIds)) {
    const match = matches.get(id);
    const loserId = match.winnerId && match.participants.find(p => p && p !== match.winnerId);
    if (loserId && !eliminated.has(loserId)) eliminated.set(loserId, match.round);
  }

  // Sort by elimination round
  const remaining = Array.from(eliminated.entries())
    .filter(([id]) => !standings.find(s => s.participantId === id))
    .sort((a, b) => b[1] - a[1]);

  let place = 3;
  for (const [participantId] of remaining) {
    const p = participants.get(participantId);
    standings.push({ place: place++, participantId, name: p?.name || 'Unknown' });
  }

  return standings;
}
