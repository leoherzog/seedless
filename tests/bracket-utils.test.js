/**
 * Tests for bracket-utils.js
 */

import { assertEquals, assert, assertThrows } from "jsr:@std/assert";
import { nextPowerOf2, seedOrder, buildKnockout, getRoundName } from "../js/tournament/bracket-utils.js";

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

Deno.test("seedOrder", async (t) => {
  await t.step("returns [1, 2] for bracket of 2", () => {
    assertEquals(seedOrder(2), [1, 2]);
  });

  await t.step("pairs 1v4 and 2v3 for bracket of 4", () => {
    assertEquals(seedOrder(4), [1, 4, 2, 3]);
  });

  await t.step("returns standard order for bracket of 8", () => {
    assertEquals(seedOrder(8), [1, 8, 4, 5, 3, 6, 2, 7]);
  });

  await t.step("bracket of 16 pairs seeds summing to 17, with 1 and 2 in opposite halves", () => {
    const order = seedOrder(16);
    assertEquals(order.length, 16);
    for (let i = 0; i < 16; i += 2) {
      assertEquals(order[i] + order[i + 1], 17);
    }
    assert(order.indexOf(1) < 8, "Seed 1 should be in the top half");
    assert(order.indexOf(2) >= 8, "Seed 2 should be in the bottom half");
  });
});

Deno.test("buildKnockout", async (t) => {
  const makeMatch = (round, position) => ({ id: `r${round}m${position}`, participants: [null, null], winnerId: null, isBye: false });
  const players = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, seed: i + 1 }));

  await t.step("throws with fewer than 2 participants", () => {
    assertThrows(() => buildKnockout(players(1), makeMatch, () => ""), Error, "Need at least 2 participants");
  });

  await t.step("sorts by seed with unseeded participants last", () => {
    const { rounds } = buildKnockout(
      [{ id: "late" }, { id: "second", seed: 2 }, { id: "first", seed: 1 }, { id: "third", seed: 3 }],
      makeMatch,
      () => "",
    );
    assertEquals(rounds[0].matches.map((m) => m.participants), [["first", "late"], ["second", "third"]]);
  });

  await t.step("advances each round-1 bye into slot 0 or 1 of the next round", () => {
    const { bracketSize, numRounds, rounds } = buildKnockout(players(5), makeMatch, (r, n) => `${r}/${n}`);
    assertEquals(bracketSize, 8);
    assertEquals(numRounds, 3);
    assertEquals(rounds.map((r) => r.name), ["1/3", "2/3", "3/3"]);

    const byes = rounds[0].matches.filter((m) => m.isBye);
    assertEquals(byes.map((m) => m.winnerId), ["p1", "p3", "p2"]);
    assertEquals(rounds[1].matches.map((m) => m.participants), [["p1", null], ["p3", "p2"]]);
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
