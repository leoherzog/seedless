/**
 * Double-elimination brackets: a winners bracket, a losers bracket of alternating minor and
 * major rounds, and grand finals with a reset match. Covers generation, advancement and standings.
 */

import { buildKnockout, toMatchIds } from './bracket-utils.js';

/**
 * Generate a seeded double-elimination bracket with round-1 byes advanced and dead losers slots marked.
 * @param {Object[]} participants - At least 2, each with id, name and optional seed
 * @returns {{bracket: Object, matches: Map}} Bracket of round match ids, and the matches by id
 */
export function generateDoubleEliminationBracket(participants) {
  const { bracketSize, numRounds, rounds } = buildKnockout(
    participants,
    (round, position, numRounds) => ({
      id: `w${round}m${position}`,
      bracket: 'winners',
      round,
      position,
      participants: [null, null],
      scores: [0, 0],
      winnerId: null,
      isBye: false,
      dropsTo: calculateDropTarget(round, position, numRounds),
    }),
    (round, numRounds) => round === 1 ? 'Winners R1' : getWinnersRoundName(round, numRounds),
  );
  const winners = { rounds };
  const losers = generateLosersBracket(bracketSize, 2 * (numRounds - 1));
  const grandFinals = generateGrandFinals();
  markDeadLosersSlots(winners, losers);

  const matches = [...winners.rounds, ...losers.rounds].flatMap(r => r.matches).concat(grandFinals);

  return {
    bracket: {
      type: 'double',
      winners: { rounds: toMatchIds(winners.rounds) },
      losers: { rounds: toMatchIds(losers.rounds) },
      grandFinals: grandFinals.map(m => m.id),
    },
    matches: new Map(matches.map(m => [m.id, m])),
  };
}

function generateLosersBracket(bracketSize, losersRounds) {
  const rounds = [];

  let currentSize = bracketSize / 2;

  for (let r = 0; r < losersRounds; r++) {
    // Minor rounds pair off losers-bracket players; each major round adds a
    // winners-bracket drop-in to slot 1 of every match.
    const isMinorRound = r % 2 === 0;
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
      requiresPlay: false, // Set when the losers champ wins gf1
    },
  ];
}

/**
 * Where a winners-bracket loser drops into the losers bracket.
 * @returns {{round: number, position: number, slot: number}} Losers slot; round 0 means grand finals
 */
function calculateDropTarget(winnersRound, position, winnersRounds) {
  // Checked first so a two-player bracket, whose only round is both W1 and the final, yields round 0.
  if (winnersRound === winnersRounds) {
    return { round: 2 * (winnersRounds - 1), position: 0, slot: 1 };
  }

  if (winnersRound === 1) {
    return { round: 1, position: Math.floor(position / 2), slot: position % 2 };
  }
  // A Wr loser drops into slot 1 of major round L(2r-2); using round r would land in an
  // already-filled minor round for r >= 3.
  return { round: 2 * (winnersRound - 1), position, slot: 1 };
}

/**
 * Mark losers-bracket slots that will never receive a participant.
 * Only round-1 winners matches can be byes, and a bye drops no loser. A losers match
 * with both slots dead produces no winner, so the slot it feeds is dead too.
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

  // Dead slots only feed later rounds, so one pass in round order covers the whole cascade.
  for (let r = 0; r < losers.rounds.length; r++) {
    for (const match of losers.rounds[r].matches) {
      if ((match.deadSlots?.length || 0) < 2) continue;

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
 * Rank the champion, the grand-finals runner-up, then everyone else by the losers round they lost in, latest first.
 * @param {Object} bracket - Bracket structure
 * @param {Map} matches - Matches by id
 * @param {Map} participants - Participant or team by id, for names
 * @returns {Object[]} Standings array; empty until the champion is decided
 */
export function getStandings(bracket, matches, participants) {
  const champion = championId(bracket, matches);
  if (!champion) return [];

  const standings = [];
  const p = participants.get(champion);
  standings.push({ place: 1, participantId: champion, name: p?.name || 'Unknown' });

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
