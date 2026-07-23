/**
 * Regression tests: Single Elimination - parametric run-to-completion
 *
 * For a range of player counts, generate a bracket, play every match to
 * completion via a deterministic advancement rule, and assert structural
 * invariants: exactly one champion, tournament reports complete, byes are
 * handled so no match is ever left with an unresolvable null opponent, and
 * round/match counts are sane for the bracket size.
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  generateSingleEliminationBracket,
  recordMatchResult,
  getStandings,
} from "../js/tournament/single-elimination.js";
import { nextPowerOf2 } from "../js/tournament/bracket-utils.js";
import { createParticipants, createParticipantMap } from "./fixtures.js";

/**
 * Play every resolvable match in the bracket to completion.
 * Deterministically advances whichever participant occupies slot 0 of each
 * match. Byes are already auto-resolved at generation time and are skipped.
 *
 * Because single-elimination rounds only ever depend on earlier rounds, one
 * forward pass through `bracket.rounds` is sufficient: by the time a given
 * round is reached, all of its matches must already have both slots filled
 * (either by a real result recorded earlier in this pass, or by bye
 * auto-advancement done at generation time).
 *
 * @param {Object} bracket
 * @returns {string[]} ids of matches actually played (excludes byes)
 */
function playToCompletion(bracket) {
  const played = [];

  for (const round of bracket.rounds) {
    for (const match of round.matches) {
      if (match.isBye) continue;
      if (match.winnerId) continue;

      const [p1, p2] = match.participants;
      if (!p1 || !p2) {
        throw new Error(
          `Match ${match.id} (round ${match.round}) has an unresolved null ` +
            `opponent and cannot be played: participants=${JSON.stringify(match.participants)}`
        );
      }

      const winnerId = p1; // deterministic: slot 0 always advances
      recordMatchResult(bracket, match.id, [1, 0], winnerId, winnerId);
      played.push(match.id);
    }
  }

  return played;
}

/**
 * Assert every match in the bracket ended up decided (bye or played).
 */
function assertAllMatchesResolved(bracket) {
  for (const [id, match] of bracket.matches) {
    assert(match.winnerId, `Match ${id} (round ${match.round}) should have a winner`);
  }
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17];

Deno.test("Single Elimination - parametric run to completion", async (t) => {
  for (const n of PLAYER_COUNTS) {
    await t.step(`N=${n}: completes with a single champion and sane structure`, () => {
      const participants = createParticipants(n);
      const participantMap = createParticipantMap(participants);
      const bracket = generateSingleEliminationBracket(participants);

      const expectedBracketSize = nextPowerOf2(n);
      const expectedNumRounds = Math.log2(expectedBracketSize);
      const expectedTotalMatches = expectedBracketSize - 1;
      const expectedByes = expectedBracketSize - n;

      // --- Structural sanity of the freshly generated bracket ---
      assertEquals(bracket.bracketSize, expectedBracketSize, "bracket size");
      assertEquals(bracket.numRounds, expectedNumRounds, "number of rounds");
      assertEquals(bracket.rounds.length, expectedNumRounds, "rounds array length");
      assertEquals(bracket.matches.size, expectedTotalMatches, "total match count");
      assertEquals(bracket.participantCount, n, "participant count");

      const byeMatches = bracket.rounds[0].matches.filter((m) => m.isBye);
      assertEquals(byeMatches.length, expectedByes, "round 1 bye count");

      // Every bye must already have auto-advanced a winner at generation time.
      for (const bye of byeMatches) {
        assert(bye.winnerId, `Bye match ${bye.id} should have auto-advanced a winner`);
      }

      // Final round must be a single match (the championship match).
      const finalRound = bracket.rounds[bracket.rounds.length - 1];
      assertEquals(finalRound.matches.length, 1, "final round should have exactly one match");

      // --- Play every remaining match to completion ---
      const played = playToCompletion(bracket);

      // Number of matches actually played should be total matches minus byes.
      assertEquals(played.length, expectedTotalMatches - expectedByes, "matches played");

      // No match anywhere should still be missing a winner.
      assertAllMatchesResolved(bracket);

      // --- Tournament completion invariants ---
      assert(bracket.isComplete, "tournament should report complete");

      const finals = finalRound.matches[0];
      assert(finals.winnerId, "finals match must have a winner");

      // Exactly one champion: the finals winner, and it must be one of our participants.
      assert(
        participantMap.has(finals.winnerId),
        "champion must be a real participant from this tournament"
      );

      // --- Standings invariants ---
      const standings = getStandings(bracket, participantMap);
      assertEquals(standings.length, n, "standings should cover every participant");
      assertEquals(standings[0].place, 1, "first standing should be place 1");
      assertEquals(standings[0].participantId, finals.winnerId, "place 1 should be the champion");

      // Places must be sequential 1..n with no gaps or duplicates.
      for (let i = 0; i < standings.length; i++) {
        assertEquals(standings[i].place, i + 1, `place at index ${i} should be ${i + 1}`);
      }

      // No participant should be duplicated or missing from standings.
      const standingIds = standings.map((s) => s.participantId);
      const uniqueIds = new Set(standingIds);
      assertEquals(uniqueIds.size, standingIds.length, "no duplicate participants in standings");
      const expectedIds = new Set(participants.map((p) => p.id));
      assertEquals(uniqueIds, expectedIds, "standings should be exactly the input participant set");
    });
  }
});

Deno.test("Single Elimination - edge case: N=2 minimal bracket", async (t) => {
  await t.step("generates a single match with no byes", () => {
    const participants = createParticipants(2);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 2);
    assertEquals(bracket.numRounds, 1);
    assertEquals(bracket.matches.size, 1);
    assertEquals(bracket.rounds[0].matches.filter((m) => m.isBye).length, 0);

    const match = bracket.rounds[0].matches[0];
    assertEquals(match.participants[0], "player-1");
    assertEquals(match.participants[1], "player-2");
    assertEquals(match.isBye, false);
    assertEquals(bracket.isComplete, undefined);
  });

  await t.step("one recorded result completes the entire tournament", () => {
    const participants = createParticipants(2);
    const participantMap = createParticipantMap(participants);
    const bracket = generateSingleEliminationBracket(participants);

    recordMatchResult(bracket, "r1m0", [2, 0], "player-1", "player-1");

    assert(bracket.isComplete, "tournament should be complete after the only match is played");
    const standings = getStandings(bracket, participantMap);
    assertEquals(standings.length, 2);
    assertEquals(standings[0].participantId, "player-1");
    assertEquals(standings[1].participantId, "player-2");
  });
});

Deno.test("Single Elimination - edge case: N=3 odd bracket with a bye", async (t) => {
  await t.step("exactly one bye is created and auto-advances its player", () => {
    const participants = createParticipants(3);
    const bracket = generateSingleEliminationBracket(participants);

    assertEquals(bracket.bracketSize, 4);
    assertEquals(bracket.numRounds, 2);

    const byeMatches = bracket.rounds[0].matches.filter((m) => m.isBye);
    assertEquals(byeMatches.length, 1);
    assert(byeMatches[0].winnerId, "bye should have auto-advanced a winner");

    const nonByeMatch = bracket.rounds[0].matches.find((m) => !m.isBye);
    assertEquals(nonByeMatch.winnerId, null, "the real round-1 match should not be pre-decided");

    // The bye winner should already be seated in the final's participant slots
    // (advanced automatically at generation time via processByes).
    const finals = bracket.rounds[1].matches[0];
    assert(
      finals.participants.includes(byeMatches[0].winnerId),
      "bye winner should be pre-seeded into the final"
    );
  });

  await t.step("playing the remaining match completes the tournament with 3 standings", () => {
    const participants = createParticipants(3);
    const participantMap = createParticipantMap(participants);
    const bracket = generateSingleEliminationBracket(participants);

    const played = playToCompletion(bracket);

    // Only the real round-1 match plus the final need to be played (bye is free).
    assertEquals(played.length, 2);
    assert(bracket.isComplete);

    const standings = getStandings(bracket, participantMap);
    assertEquals(standings.length, 3);
    assertEquals(standings[0].place, 1);
    assertEquals(standings[1].place, 2);
    assertEquals(standings[2].place, 3);

    const ids = new Set(standings.map((s) => s.participantId));
    assertEquals(ids, new Set(["player-1", "player-2", "player-3"]));
  });
});
