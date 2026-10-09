/**
 * Single elimination run-to-completion for a range of player counts. Each bracket
 * must have the expected rounds and byes, leave no match undecided, and finish
 * with one champion and complete standings.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateSingleEliminationBracket,
  advance,
  getStandings,
} from "../js/tournament/single-elimination.js";
import { nextPowerOf2 } from "../js/tournament/bracket-utils.js";
import { createParticipants, createParticipantMap, playToCompletion } from "./fixtures.js";

/** Assert every match has a winner, by bye or by play. */
function assertAllMatchesResolved(matches) {
  for (const [id, match] of matches) {
    assert(match.winnerId, `Match ${id} (round ${match.round}) should have a winner`);
  }
}

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 15, 16, 17];

test("Single Elimination - parametric run to completion", async (t) => {
  for (const n of PLAYER_COUNTS) {
    await t.test(`N=${n}: completes with a single champion and sane structure`, () => {
      const participants = createParticipants(n);
      const participantMap = createParticipantMap(participants);
      const tournament = generateSingleEliminationBracket(participants);
      const { bracket, matches } = tournament;
      const roundMatches = (round) => round.matchIds.map((id) => matches.get(id));

      const expectedBracketSize = nextPowerOf2(n);
      const expectedNumRounds = Math.log2(expectedBracketSize);
      const expectedTotalMatches = expectedBracketSize - 1;
      const expectedByes = expectedBracketSize - n;

      assert.deepStrictEqual(bracket.rounds[0].matchIds.length * 2, expectedBracketSize, "bracket size");
      assert.deepStrictEqual(bracket.rounds.length, expectedNumRounds, "rounds array length");
      assert.deepStrictEqual(matches.size, expectedTotalMatches, "total match count");
      assert.deepStrictEqual(
        roundMatches(bracket.rounds[0]).flatMap((m) => m.participants).filter(Boolean).length,
        n,
        "every participant is seeded into round 1",
      );

      const byeMatches = roundMatches(bracket.rounds[0]).filter((m) => m.isBye);
      assert.deepStrictEqual(byeMatches.length, expectedByes, "round 1 bye count");

      for (const bye of byeMatches) {
        assert(bye.winnerId, `Bye match ${bye.id} should have auto-advanced a winner`);
      }

      const finalRound = bracket.rounds[bracket.rounds.length - 1];
      assert.deepStrictEqual(finalRound.matchIds.length, 1, "final round should have exactly one match");

      let played = 0;
      const complete = playToCompletion(tournament, advance, undefined, () => played++);

      assert.deepStrictEqual(played, expectedTotalMatches - expectedByes, "matches played");

      assertAllMatchesResolved(matches);

      assert(complete, "tournament should report complete");

      const finals = matches.get(finalRound.matchIds[0]);
      assert(finals.winnerId, "finals match must have a winner");

      assert(
        participantMap.has(finals.winnerId),
        "champion must be a real participant from this tournament"
      );

      const standings = getStandings(bracket, matches, participantMap);
      assert.deepStrictEqual(standings.length, n, "standings should cover every participant");
      assert.deepStrictEqual(standings[0].place, 1, "first standing should be place 1");
      assert.deepStrictEqual(standings[0].participantId, finals.winnerId, "place 1 should be the champion");

      for (let i = 0; i < standings.length; i++) {
        assert.deepStrictEqual(standings[i].place, i + 1, `place at index ${i} should be ${i + 1}`);
      }

      const standingIds = standings.map((s) => s.participantId);
      const uniqueIds = new Set(standingIds);
      assert.deepStrictEqual(uniqueIds.size, standingIds.length, "no duplicate participants in standings");
      const expectedIds = new Set(participants.map((p) => p.id));
      assert.deepStrictEqual(uniqueIds, expectedIds, "standings should be exactly the input participant set");
    });
  }
});
