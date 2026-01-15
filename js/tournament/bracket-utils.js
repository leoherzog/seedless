/**
 * Bracket Utility Functions
 * Shared utilities for tournament bracket generation
 */

/**
 * Calculate next power of 2
 * @param {number} n - Input number
 * @returns {number} Next power of 2 >= n
 */
export function nextPowerOf2(n) {
  if (n <= 1) return 2;
  return Math.pow(2, Math.ceil(Math.log2(n)));
}

/**
 * Get seeding positions for proper bracket distribution
 * Standard seeding: 1v16, 8v9, 5v12, 4v13, etc.
 * Seeds that sum to (bracketSize + 1) are paired together
 * @param {number} bracketSize - Size of the bracket (must be power of 2)
 * @returns {number[]} Array mapping seed index to bracket position
 */
export function getSeedPositions(bracketSize) {
  // Generate the correct matchup order for standard tournament seeding
  // For 4 teams: [1, 4, 2, 3] - so 1v4 at positions 0,1 and 2v3 at positions 2,3
  // For 8 teams: [1, 8, 4, 5, 3, 6, 2, 7]
  const order = generateMatchupOrder(bracketSize);

  // Map seed to position: positions[seed-1] = bracket_position
  const positions = new Array(bracketSize);
  for (let pos = 0; pos < bracketSize; pos++) {
    const seed = order[pos];
    positions[seed - 1] = pos;
  }

  return positions;
}

/**
 * Generate the matchup order for standard bracket seeding
 * This ensures proper bracket structure where:
 * - Seeds 1 and 2 are on opposite halves (meet only in finals)
 * - Seeds 1v(n), 2v(n-1), etc. are first round matchups
 * - Higher seeds get favorable bracket positions
 * @param {number} n - Bracket size (must be power of 2)
 * @returns {number[]} Seeds in bracket position order
 */
function generateMatchupOrder(n) {
  if (n === 2) return [1, 2];

  // Get the matchup order for half the bracket size
  const prev = generateMatchupOrder(n / 2);

  // Expand each seed s to a pair [s, n+1-s] (opponents in round 1)
  const pairs = prev.map(s => [s, n + 1 - s]);

  // Split pairs into top and bottom halves
  // Bottom half pairs are reversed to maintain proper bracket structure
  const half = pairs.length / 2;
  const top = pairs.slice(0, half);
  const bottom = pairs.slice(half).reverse();

  // Flatten and return: top half matches, then bottom half matches
  return [...top.flat(), ...bottom.flat()];
}

/**
 * Get round name based on position from finals
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
