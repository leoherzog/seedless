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
  const positions = new Array(bracketSize);

  // Recursive placement for proper bracket distribution
  function placeSeeds(seeds, start, end) {
    if (seeds.length === 1) {
      positions[seeds[0] - 1] = start;
      return;
    }

    const mid = Math.floor((start + end) / 2) + 1;
    const top = [];
    const bottom = [];

    // Split seeds - first goes top, second goes bottom
    for (let i = 0; i < seeds.length; i += 2) {
      top.push(seeds[i]);
      if (i + 1 < seeds.length) {
        bottom.push(seeds[i + 1]);
      }
    }

    placeSeeds(top, start, mid - 1);
    placeSeeds(bottom, mid, end);
  }

  // Generate standard seed matchups
  // For 8 teams: [1,8], [4,5], [3,6], [2,7]
  const matchups = [];
  for (let i = 0; i < bracketSize / 2; i++) {
    matchups.push(i + 1);
    matchups.push(bracketSize - i);
  }

  placeSeeds(matchups, 0, bracketSize - 1);

  return positions;
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
    case 1: return 'Semifinals';
    case 2: return 'Quarterfinals';
    default: return `Round ${roundNumber}`;
  }
}
