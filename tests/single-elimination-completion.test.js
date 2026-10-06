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
  advance,
  getStandings,
} from "../js/tournament/single-elimination.js";
import { nextPowerOf2 } from "../js/tournament/bracket-utils.js";
import { createParticipants, createParticipantMap, playToCompletion } from "./fixtures.js";

/**
 * Assert every match in the bracket ended up decided (bye or played).
 */
function assertAllMatchesResolved(matches) {
  for (const [id, match] of matches) {
    assert(match.winnerId, `Match ${id} (round ${match.round}) should have a winner`);
  }
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17];

Deno.test("Single Elimination - parametric run to completion", async (t) => {
  for (const n of PLAYER_COUNTS) {
    await t.step(`N=${n}: completes with a single champion and sane structure`, () => {
      const participants = createParticipants(n);
      const participantMap = createParticipantMap(participants);
      const tournament = generateSingleEliminationBracket(participants);
      const { bracket, matches } = tournament;
      const roundMatches = (round) => round.matchIds.map((id) => matches.get(id));

      const expectedBracketSize = nextPowerOf2(n);
      const expectedNumRounds = Math.log2(expectedBracketSize);
      const expectedTotalMatches = expectedBracketSize - 1;
      const expectedByes = expectedBracketSize - n;

      // --- Structural sanity of the freshly generated bracket ---
      assertEquals(bracket.bracketSize, expectedBracketSize, "bracket size");
      assertEquals(bracket.numRounds, expectedNumRounds, "number of rounds");
      assertEquals(bracket.rounds.length, expectedNumRounds, "rounds array length");
      assertEquals(matches.size, expectedTotalMatches, "total match count");
      assertEquals(bracket.participantCount, n, "participant count");

      const byeMatches = roundMatches(bracket.rounds[0]).filter((m) => m.isBye);
      assertEquals(byeMatches.length, expectedByes, "round 1 bye count");

      // Every bye must already have auto-advanced a winner at generation time.
      for (const bye of byeMatches) {
        assert(bye.winnerId, `Bye match ${bye.id} should have auto-advanced a winner`);
      }

      // Final round must be a single match (the championship match).
      const finalRound = bracket.rounds[bracket.rounds.length - 1];
      assertEquals(finalRound.matchIds.length, 1, "final round should have exactly one match");

      // --- Play every remaining match to completion ---
      let played = 0;
      const complete = playToCompletion(tournament, advance, undefined, () => played++);

      assertEquals(played, expectedTotalMatches - expectedByes, "matches played");

      // No match anywhere should still be missing a winner.
      assertAllMatchesResolved(matches);

      // --- Tournament completion invariants ---
      assert(complete, "tournament should report complete");

      const finals = matches.get(finalRound.matchIds[0]);
      assert(finals.winnerId, "finals match must have a winner");

      // Exactly one champion: the finals winner, and it must be one of our participants.
      assert(
        participantMap.has(finals.winnerId),
        "champion must be a real participant from this tournament"
      );

      // --- Standings invariants ---
      const standings = getStandings(bracket, matches, participantMap);
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
