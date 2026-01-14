/**
 * Tests for bracket-utils.js
 */

import { describe, test, assertEqual, assertTrue } from './run.js';
import { nextPowerOf2, getSeedPositions, getRoundName } from '../js/tournament/bracket-utils.js';

await describe('nextPowerOf2', async () => {
  await test('returns 2 for 1', () => {
    assertEqual(nextPowerOf2(1), 2);
  });

  await test('returns 2 for 2', () => {
    assertEqual(nextPowerOf2(2), 2);
  });

  await test('returns 4 for 3', () => {
    assertEqual(nextPowerOf2(3), 4);
  });

  await test('returns 4 for 4', () => {
    assertEqual(nextPowerOf2(4), 4);
  });

  await test('returns 8 for 5', () => {
    assertEqual(nextPowerOf2(5), 8);
  });

  await test('returns 8 for 8', () => {
    assertEqual(nextPowerOf2(8), 8);
  });

  await test('returns 16 for 9', () => {
    assertEqual(nextPowerOf2(9), 16);
  });

  await test('returns 16 for 16', () => {
    assertEqual(nextPowerOf2(16), 16);
  });

  await test('returns 32 for 17', () => {
    assertEqual(nextPowerOf2(17), 32);
  });
});

await describe('getSeedPositions', async () => {
  await test('returns correct positions for bracket of 2', () => {
    const positions = getSeedPositions(2);
    assertEqual(positions.length, 2);
    assertEqual(positions[0], 0);
    assertEqual(positions[1], 1);
  });

  await test('returns correct positions for bracket of 4', () => {
    const positions = getSeedPositions(4);
    assertEqual(positions.length, 4);
    // Standard seeding: 1 vs 4, 2 vs 3
    // So seed 1 at pos 0, seed 2 at pos 2, seed 3 at pos 3, seed 4 at pos 1
    assertEqual(positions[0], 0);  // Seed 1
    assertEqual(positions[3], 1);  // Seed 4
    assertEqual(positions[1], 2);  // Seed 2
    assertEqual(positions[2], 3);  // Seed 3
  });

  await test('returns correct number of positions for bracket of 8', () => {
    const positions = getSeedPositions(8);
    assertEqual(positions.length, 8);
    // Seed 1 should be at position 0
    assertEqual(positions[0], 0);
    // Seed 2 should face seed 7 or 8 first (opposite half)
    assertTrue(positions[1] >= 4, 'Seed 2 should be in bottom half');
  });

  await test('returns correct number of positions for bracket of 16', () => {
    const positions = getSeedPositions(16);
    assertEqual(positions.length, 16);
  });
});

await describe('getRoundName', async () => {
  await test('returns Finals for final round of 2', () => {
    assertEqual(getRoundName(1, 1), 'Finals');
  });

  await test('returns Finals for final round of 4', () => {
    assertEqual(getRoundName(2, 2), 'Finals');
  });

  await test('returns Semi-Finals for semi-final round', () => {
    assertEqual(getRoundName(1, 2), 'Semi-Finals');
  });

  await test('returns Quarter-Finals for quarter-final round', () => {
    assertEqual(getRoundName(1, 3), 'Quarter-Finals');
  });

  await test('returns Round N for early rounds', () => {
    const name = getRoundName(1, 4);
    assertTrue(name.includes('Round') || name.includes('R1'), `Expected round name, got ${name}`);
  });
});
