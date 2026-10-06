/**
 * Final standings for any tournament type, shared by the results card and the history archive.
 */

import { getStandings as getSingleStandings } from './single-elimination.js';
import { getStandings as getDoubleStandings } from './double-elimination.js';
import { getStandings as getDoublesStandings } from './doubles.js';
import { getStandings as getRaceStandings } from './mario-kart.js';

/**
 * Rank a tournament's finishers by the rules of its type.
 * @param {{meta: Object, bracket: Object|null, matches: Map, participants: Map, standings: Map}} state - Store state
 * @returns {Object[]} Standings with place, participantId and name; empty until a bracket's champion is decided
 */
export function getFinalStandings({ meta, bracket, matches, participants, standings }) {
  if (meta.type === 'mariokart') return getRaceStandings({ standings });
  if (!bracket) return [];
  if (meta.type === 'doubles') return getDoublesStandings(bracket, matches);
  if (meta.type === 'double') return getDoubleStandings(bracket, matches, participants);
  return getSingleStandings(bracket, matches, participants);
}
