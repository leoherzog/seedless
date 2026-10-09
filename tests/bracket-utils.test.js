/**
 * Tests for bracket-utils.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { nextPowerOf2, seedOrder, buildKnockout, getRoundName } from "../js/tournament/bracket-utils.js";

test("nextPowerOf2", async (t) => {
  await t.test("returns 2 for 1", () => {
    assert.deepStrictEqual(nextPowerOf2(1), 2);
  });

  await t.test("returns 2 for 2", () => {
    assert.deepStrictEqual(nextPowerOf2(2), 2);
  });

  await t.test("returns 4 for 3", () => {
    assert.deepStrictEqual(nextPowerOf2(3), 4);
  });

  await t.test("returns 4 for 4", () => {
    assert.deepStrictEqual(nextPowerOf2(4), 4);
  });

  await t.test("returns 8 for 5", () => {
    assert.deepStrictEqual(nextPowerOf2(5), 8);
  });

  await t.test("returns 8 for 8", () => {
    assert.deepStrictEqual(nextPowerOf2(8), 8);
  });

  await t.test("returns 16 for 9", () => {
    assert.deepStrictEqual(nextPowerOf2(9), 16);
  });

  await t.test("returns 16 for 16", () => {
    assert.deepStrictEqual(nextPowerOf2(16), 16);
  });

  await t.test("returns 32 for 17", () => {
    assert.deepStrictEqual(nextPowerOf2(17), 32);
  });

  await t.test("returns 2 for 0", () => {
    assert.deepStrictEqual(nextPowerOf2(0), 2);
  });

  await t.test("returns 2 for negative numbers", () => {
    assert.deepStrictEqual(nextPowerOf2(-1), 2);
    assert.deepStrictEqual(nextPowerOf2(-100), 2);
  });

  await t.test("handles large numbers", () => {
    assert.deepStrictEqual(nextPowerOf2(1000), 1024);
    assert.deepStrictEqual(nextPowerOf2(1024), 1024);
    assert.deepStrictEqual(nextPowerOf2(1025), 2048);
  });
});

test("seedOrder", async (t) => {
  await t.test("returns [1, 2] for bracket of 2", () => {
    assert.deepStrictEqual(seedOrder(2), [1, 2]);
  });

  await t.test("pairs 1v4 and 2v3 for bracket of 4", () => {
    assert.deepStrictEqual(seedOrder(4), [1, 4, 2, 3]);
  });

  await t.test("returns standard order for bracket of 8", () => {
    assert.deepStrictEqual(seedOrder(8), [1, 8, 4, 5, 3, 6, 2, 7]);
  });

  await t.test("bracket of 16 pairs seeds summing to 17, with 1 and 2 in opposite halves", () => {
    const order = seedOrder(16);
    assert.deepStrictEqual(order.length, 16);
    for (let i = 0; i < 16; i += 2) {
      assert.deepStrictEqual(order[i] + order[i + 1], 17);
    }
    assert(order.indexOf(1) < 8, "Seed 1 should be in the top half");
    assert(order.indexOf(2) >= 8, "Seed 2 should be in the bottom half");
  });
});

test("buildKnockout", async (t) => {
  const makeMatch = (round, position) => ({ id: `r${round}m${position}`, participants: [null, null], winnerId: null, isBye: false });
  const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, seed: i + 1 }));

  await t.test("throws with fewer than 2 participants", () => {
    assert.throws(
      () => buildKnockout(players(1), makeMatch, () => ""),
      (err) => err instanceof Error && err.message.includes("Need at least 2 participants")
    );
  });

  await t.test("sorts by seed with unseeded participants last", () => {
    const { rounds } = buildKnockout(
      [{ id: "late" }, { id: "second", seed: 2 }, { id: "first", seed: 1 }, { id: "third", seed: 3 }],
      makeMatch,
      () => "",
    );
    assert.deepStrictEqual(rounds[0].matches.map((m) => m.participants), [["first", "late"], ["second", "third"]]);
  });

  await t.test("advances each round-1 bye into slot 0 or 1 of the next round", () => {
    const { bracketSize, numRounds, rounds } = buildKnockout(players(5), makeMatch, (r, n) => `${r}/${n}`);
    assert.deepStrictEqual(bracketSize, 8);
    assert.deepStrictEqual(numRounds, 3);
    assert.deepStrictEqual(rounds.map((r) => r.name), ["1/3", "2/3", "3/3"]);

    const byes = rounds[0].matches.filter((m) => m.isBye);
    assert.deepStrictEqual(byes.map((m) => m.winnerId), ["p1", "p3", "p2"]);
    assert.deepStrictEqual(rounds[1].matches.map((m) => m.participants), [["p1", null], ["p3", "p2"]]);
  });
});

test("getRoundName", async (t) => {
  await t.test("returns Finals for final round of 2", () => {
    assert.deepStrictEqual(getRoundName(1, 1), "Finals");
  });

  await t.test("returns Finals for final round of 4", () => {
    assert.deepStrictEqual(getRoundName(2, 2), "Finals");
  });

  await t.test("returns Semi-Finals for semi-final round", () => {
    assert.deepStrictEqual(getRoundName(1, 2), "Semi-Finals");
  });

  await t.test("returns Quarter-Finals for quarter-final round", () => {
    assert.deepStrictEqual(getRoundName(1, 3), "Quarter-Finals");
  });

  await t.test("returns Round 1 for first round of 4 rounds", () => {
    assert.deepStrictEqual(getRoundName(1, 4), "Round 1");
  });

  await t.test("returns Round 2 for second round of 5 rounds", () => {
    assert.deepStrictEqual(getRoundName(2, 5), "Round 2");
  });
});
