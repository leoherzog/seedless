/**
 * Tests for bracket-utils.js
 */

import { assertEquals, assert } from "jsr:@std/assert";
import { nextPowerOf2, getSeedPositions, getRoundName } from "../js/tournament/bracket-utils.js";

Deno.test("nextPowerOf2", async (t) => {
  await t.step("returns 2 for 1", () => {
    assertEquals(nextPowerOf2(1), 2);
  });

  await t.step("returns 2 for 2", () => {
    assertEquals(nextPowerOf2(2), 2);
  });

  await t.step("returns 4 for 3", () => {
    assertEquals(nextPowerOf2(3), 4);
  });

  await t.step("returns 4 for 4", () => {
    assertEquals(nextPowerOf2(4), 4);
  });

  await t.step("returns 8 for 5", () => {
    assertEquals(nextPowerOf2(5), 8);
  });

  await t.step("returns 8 for 8", () => {
    assertEquals(nextPowerOf2(8), 8);
  });

  await t.step("returns 16 for 9", () => {
    assertEquals(nextPowerOf2(9), 16);
  });

  await t.step("returns 16 for 16", () => {
    assertEquals(nextPowerOf2(16), 16);
  });

  await t.step("returns 32 for 17", () => {
    assertEquals(nextPowerOf2(17), 32);
  });

  // Edge cases
  await t.step("returns 2 for 0", () => {
    assertEquals(nextPowerOf2(0), 2);
  });

  await t.step("returns 2 for negative numbers", () => {
    assertEquals(nextPowerOf2(-1), 2);
    assertEquals(nextPowerOf2(-100), 2);
  });

  await t.step("handles large numbers", () => {
    assertEquals(nextPowerOf2(1000), 1024);
    assertEquals(nextPowerOf2(1024), 1024);
    assertEquals(nextPowerOf2(1025), 2048);
  });
});

Deno.test("getSeedPositions", async (t) => {
  await t.step("returns correct positions for bracket of 2", () => {
    const positions = getSeedPositions(2);
    assertEquals(positions.length, 2);
    assertEquals(positions[0], 0);
    assertEquals(positions[1], 1);
  });

  await t.step("returns correct positions for bracket of 4", () => {
    const positions = getSeedPositions(4);
    assertEquals(positions.length, 4);
    // Standard seeding: 1 vs 4, 2 vs 3
    // So seed 1 at pos 0, seed 2 at pos 2, seed 3 at pos 3, seed 4 at pos 1
    assertEquals(positions[0], 0);  // Seed 1
    assertEquals(positions[3], 1);  // Seed 4
    assertEquals(positions[1], 2);  // Seed 2
    assertEquals(positions[2], 3);  // Seed 3
  });

  await t.step("returns correct positions for bracket of 8", () => {
    const positions = getSeedPositions(8);
    assertEquals(positions.length, 8);
    // Expected matchup order: [1, 8, 4, 5, 3, 6, 2, 7]
    // positions[seed-1] = bracket_position
    assertEquals(positions[0], 0);  // Seed 1 at position 0
    assertEquals(positions[7], 1);  // Seed 8 at position 1 (1v8 matchup)
    assertEquals(positions[3], 2);  // Seed 4 at position 2
    assertEquals(positions[4], 3);  // Seed 5 at position 3 (4v5 matchup)
    assertEquals(positions[2], 4);  // Seed 3 at position 4
    assertEquals(positions[5], 5);  // Seed 6 at position 5 (3v6 matchup)
    assertEquals(positions[1], 6);  // Seed 2 at position 6
    assertEquals(positions[6], 7);  // Seed 7 at position 7 (2v7 matchup)
  });

  await t.step("returns correct positions for bracket of 16", () => {
    const positions = getSeedPositions(16);
    assertEquals(positions.length, 16);
    // Verify key seeding properties:
    // Seed 1 at position 0
    assertEquals(positions[0], 0);
    // Seed 16 paired with seed 1 (1v16)
    assertEquals(positions[15], 1);
    // Seed 2 in opposite half from seed 1 (position >= 8)
    assert(positions[1] >= 8, "Seed 2 should be in opposite half");
    // Seed 2 paired with seed 15 (2v15)
    assertEquals(positions[14], positions[1] + 1);
  });
});

Deno.test("getRoundName", async (t) => {
  await t.step("returns Finals for final round of 2", () => {
    assertEquals(getRoundName(1, 1), "Finals");
  });

  await t.step("returns Finals for final round of 4", () => {
    assertEquals(getRoundName(2, 2), "Finals");
  });

  await t.step("returns Semi-Finals for semi-final round", () => {
    assertEquals(getRoundName(1, 2), "Semi-Finals");
  });

  await t.step("returns Quarter-Finals for quarter-final round", () => {
    assertEquals(getRoundName(1, 3), "Quarter-Finals");
  });

  await t.step("returns Round 1 for first round of 4 rounds", () => {
    assertEquals(getRoundName(1, 4), "Round 1");
  });

  await t.step("returns Round 2 for second round of 5 rounds", () => {
    assertEquals(getRoundName(2, 5), "Round 2");
  });
});
