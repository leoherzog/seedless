/**
 * Seeding, knockout round building, replay helpers and round naming shared by the bracket modules.
 */

import { bySeed } from '../utils/tournament-helpers.js';

/**
 * Bracket size for n participants.
 * @param {number} n - Participant count
 * @returns {number} Smallest power of 2 that is >= max(n, 2)
 */
export function nextPowerOf2(n) {
  if (n <= 1) return 2;
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

/**
 * Seeds in bracket-position order for standard seeding.
 * Seeds summing to size + 1 meet in round 1, and seeds 1 and 2 can only meet in the final.
 * @param {number} size - Bracket size (power of 2)
 * @returns {number[]} Seeds in bracket position order
 */
export function seedOrder(size) {
  if (size === 2) return [1, 2];

  const pairs = seedOrder(size / 2).map(s => [s, size + 1 - s]);
  const half = pairs.length / 2;
  return [...pairs.slice(0, half).flat(), ...pairs.slice(half).reverse().flat()];
}

/**
 * Seed participants into knockout rounds and advance round-1 byes.
 * @param {Object[]} participants - At least 2, each with id and optional seed
 * @param {Function} makeMatch - (round, position, numRounds) => empty match with participants [null, null]
 * @param {Function} nameRound - (round, numRounds) => round name
 * @returns {{bracketSize: number, numRounds: number, rounds: Object[]}} Rounds holding match objects
 */
export function buildKnockout(participants, makeMatch, nameRound) {
  if (participants.length < 2) {
    throw new Error('Need at least 2 participants');
  }

  const seeded = participants.toSorted(bySeed);
  const bracketSize = nextPowerOf2(seeded.length);
  const numRounds = Math.log2(bracketSize);

  const rounds = Array.from({ length: numRounds }, (_, i) => ({
    number: i + 1,
    name: nameRound(i + 1, numRounds),
    matches: Array.from({ length: bracketSize / 2 ** (i + 1) }, (_, m) => makeMatch(i + 1, m, numRounds)),
  }));

  const order = seedOrder(bracketSize);
  rounds[0].matches.forEach((match, i) => {
    match.participants = [seeded[order[2 * i] - 1]?.id ?? null, seeded[order[2 * i + 1] - 1]?.id ?? null];
    match.isBye = match.participants.includes(null);
    // The higher seed always exists, so a bye's player sits in slot 0.
    if (match.isBye) {
      match.winnerId = match.participants[0];
      rounds[1].matches[i >> 1].participants[i % 2] = match.winnerId;
    }
  });

  return { bracketSize, numRounds, rounds };
}

/**
 * Replace each round's match objects with their ids.
 * @param {Object[]} rounds - Rounds holding a matches array
 * @returns {Object[]} Rounds holding a matchIds array
 */
export function toMatchIds(rounds) {
  return rounds.map(({ matches, ...round }) => ({ ...round, matchIds: matches.map(m => m.id) }));
}

/**
 * Copy matches so a replay can reseat them without touching the stored ones.
 * @param {Map} matches - Matches by id
 * @returns {Map} Copies with their own participants arrays
 */
export function copyMatches(matches) {
  return new Map([...matches].map(([id, m]) => [id, { ...m, participants: [...m.participants] }]));
}

/**
 * Keep a replayed match's result only while its winner is seated with an opponent, or alone in a bye.
 * A result that no longer stands, as after an earlier result changed, is cleared in place.
 * @param {Object} match - Replayed copy
 * @returns {boolean} True when the match has a standing result
 */
export function keepResult(match) {
  if (!match.winnerId) return false;
  const { participants } = match;
  if ((match.isBye || !participants.includes(null)) && participants.includes(match.winnerId)) return true;
  Object.assign(match, { winnerId: null, scores: [0, 0], verifiedBy: null });
  return false;
}

// The fields a replay rewrites.
const REPLAYED_FIELDS = ['participants', 'winnerId', 'scores', 'verifiedBy', 'requiresPlay'];

/**
 * Write each replayed field that differs from the stored match.
 * @param {Map} matches - Stored matches
 * @param {Map} replayed - Copies after the replay
 * @param {Function} update - (id, fields) writer for a stored match
 */
export function writeReplay(matches, replayed, update) {
  for (const [id, next] of replayed) {
    const prev = matches.get(id);
    const changed = REPLAYED_FIELDS.filter((key) => JSON.stringify(next[key]) !== JSON.stringify(prev[key]));
    if (changed.length > 0) {
      update(id, Object.fromEntries(changed.map((key) => [key, next[key]])));
    }
  }
}

/**
 * Name the last three rounds by their distance from the final; earlier rounds are numbered.
 * @param {number} roundNumber - Current round number (1-indexed)
 * @param {number} totalRounds - Total number of rounds
 * @returns {string} Round name
 */
export function getRoundName(roundNumber, totalRounds) {
  const fromFinals = totalRounds - roundNumber;

  switch (fromFinals) {
    case 0: return 'Finals';
    case 1: return 'Semi-Finals';
    case 2: return 'Quarter-Finals';
    default: return `Round ${roundNumber}`;
  }
}
