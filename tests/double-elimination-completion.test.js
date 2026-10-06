/**
 * Double elimination run-to-completion for every N from 2 to 17. Each bracket
 * must finish with one champion, complete standings, both grand-finals slots
 * filled, no stalled losers match, and no dropped loser landing on an occupied slot.
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  generateDoubleEliminationBracket,
  recordMatchResult,
  getStandings,
} from "../js/tournament/double-elimination.js";
import { createParticipants, createParticipantMap, playToCompletion } from "./fixtures.js";

const N_VALUES = Array.from({ length: 16 }, (_, i) => i + 2);

/**
 * Slot 0 always wins. With standard seeding the winners champion holds GF
 * slot 0 and wins GF1, so no reset is played.
 */
function slot0Wins(match) {
  return match.participants[0];
}

/** The losers champion (GF slot 1) wins GF1; slot 0 wins everything else. */
function forceGrandFinalsReset(match) {
  if (match.id === "gf1") return match.participants[1];
  return match.participants[0];
}

function snapshotParticipants(bracket) {
  const snap = new Map();
  for (const match of bracket.matches.values()) {
    snap.set(match.id, [...match.participants]);
  }
  return snap;
}

/** Throws if any filled slot changed to a different participant since `before`. */
function assertNoOverwrites(before, bracket, justPlayedMatchId) {
  for (const match of bracket.matches.values()) {
    const prev = before.get(match.id);
    if (!prev) continue;
    for (let slot = 0; slot < 2; slot++) {
      const prevVal = prev[slot];
      const curVal = match.participants[slot];
      if (prevVal !== null && curVal !== null && prevVal !== curVal) {
        throw new Error(
          `Slot overwrite detected: ${match.id}[${slot}] changed from ` +
            `${prevVal} to ${curVal} while playing ${justPlayedMatchId}. ` +
            `A dropped loser must never land on an already-occupied slot.`
        );
      }
    }
  }
}

function describeIncomplete(bracket) {
  const stuck = [];
  for (const match of bracket.matches.values()) {
    if (match.isBye || match.winnerId) continue;
    const [p1, p2] = match.participants;
    if (p1 || p2) stuck.push(`${match.id}=[${p1},${p2}]`);
  }
  const gf1 = bracket.grandFinals.match;
  const gf2 = bracket.grandFinals.reset;
  return `stuck=[${stuck.join(" ")}] gf1.participants=[${gf1.participants.join(",")}] ` +
    `gf1.winnerId=${gf1.winnerId} gf2.requiresPlay=${gf2.requiresPlay} gf2.winnerId=${gf2.winnerId}`;
}

function hasDeadSlot(bracket) {
  return bracket.losers.rounds.some((round) =>
    round.matches.some((m) => (m.deadSlots?.length || 0) > 0)
  );
}

/**
 * No losers match may wait forever with exactly one participant and no winner.
 * A match with zero participants is dead: only bye slots fed it.
 */
function assertNoStalledLosersMatches(bracket) {
  for (const round of bracket.losers.rounds) {
    for (const match of round.matches) {
      const [p1, p2] = match.participants;
      const hasExactlyOneRealParticipant = (p1 && !p2) || (!p1 && p2);
      assert(
        !hasExactlyOneRealParticipant || match.winnerId,
        `Losers match ${match.id} is stalled: single participant [${p1},${p2}] with no winner`
      );
    }
  }
}

/**
 * Every participant appears in the standings exactly once, with places 1..N.
 * A competitor whose slot was overwritten would be missing.
 */
function assertConservation(bracket, participants, participantMap) {
  const standings = getStandings(bracket, participantMap);
  const standingIds = standings.map((s) => s.participantId);
  const standingIdSet = new Set(standingIds);
  const expectedIds = new Set(participants.map((p) => p.id));

  assertEquals(standings.length, participants.length, "standings should cover every participant");
  assertEquals(standingIdSet.size, standingIds.length, "no participant duplicated in standings");
  assertEquals(standingIdSet, expectedIds, "standings should be exactly the input participant set");

  const places = standings.map((s) => s.place).sort((a, b) => a - b);
  const expectedPlaces = Array.from({ length: participants.length }, (_, i) => i + 1);
  assertEquals(places, expectedPlaces, "places should be sequential 1..N with no gaps or duplicates");

  return standings;
}

function runFullTournament(n, winnerSelector = slot0Wins) {
  const participants = createParticipants(n);
  const participantMap = createParticipantMap(participants);
  const bracket = generateDoubleEliminationBracket(participants);

  let before = snapshotParticipants(bracket);
  playToCompletion(bracket, recordMatchResult, winnerSelector, (m) => {
    assertNoOverwrites(before, bracket, m.id);
    before = snapshotParticipants(bracket);
  });

  assert(bracket.isComplete, `${n}-player bracket should complete. ${describeIncomplete(bracket)}`);

  return { bracket, participants, participantMap };
}

Deno.test("Double Elimination - parametric run to completion (no forced reset)", async (t) => {
  for (const n of N_VALUES) {
    await t.step(`N=${n}: single champion, complete standings, no stalled matches`, () => {
      const { bracket, participants, participantMap } = runFullTournament(n, slot0Wins);

      assertNoStalledLosersMatches(bracket);
      assertEquals(hasDeadSlot(bracket), (n & (n - 1)) !== 0, "dead losers slots exist exactly when N is not a power of two");
      const standings = assertConservation(bracket, participants, participantMap);

      assertEquals(standings[0].place, 1);
      assertEquals(standings[1].place, 2);

      // With N=2 there is no losers bracket; the winners-final loser fills GF slot 1 directly.
      assert(
        bracket.grandFinals.match.participants[1],
        `GF participants[1] (losers champion) should be filled for N=${n}`
      );
      assert(
        bracket.grandFinals.match.participants[0],
        `GF participants[0] (winners champion) should be filled for N=${n}`
      );

      assertEquals(bracket.grandFinals.reset.requiresPlay, false);
    });
  }
});

Deno.test("Double Elimination - parametric run to completion (forced grand-finals reset)", async (t) => {
  for (const n of N_VALUES) {
    await t.step(`N=${n}: bracket reset triggers and tournament still completes`, () => {
      const { bracket, participants, participantMap } = runFullTournament(n, forceGrandFinalsReset);

      assert(bracket.grandFinals.reset.requiresPlay, `Bracket reset should be required for N=${n}`);
      assert(bracket.grandFinals.reset.winnerId, `Bracket reset match should have been played for N=${n}`);

      assertNoStalledLosersMatches(bracket);
      assertConservation(bracket, participants, participantMap);
    });
  }
});

Deno.test("Double Elimination - N=2 minimal bracket", async (t) => {
  await t.step("has no losers-bracket rounds at all", () => {
    const participants = createParticipants(2);
    const bracket = generateDoubleEliminationBracket(participants);

    assertEquals(bracket.losersRounds, 0);
    assertEquals(bracket.losers.rounds.length, 0);
  });

  await t.step("winners-final loser drops straight into GF slot 1 and the tournament completes", () => {
    const participants = createParticipants(2);
    const participantMap = createParticipantMap(participants);
    const bracket = generateDoubleEliminationBracket(participants);

    const w1m0 = bracket.winners.rounds[0].matches[0];
    recordMatchResult(bracket, w1m0.id, [2, 0], "player-1", "player-1");

    assertEquals(bracket.grandFinals.match.participants[0], "player-1");
    assertEquals(
      bracket.grandFinals.match.participants[1],
      "player-2",
      "loser of the only winners match should drop directly into GF slot 1"
    );

    recordMatchResult(bracket, "gf1", [2, 0], "player-1", "player-1");

    assert(bracket.isComplete, "2-player tournament must be able to complete");

    const standings = getStandings(bracket, participantMap);
    assertEquals(standings.length, 2);
    assertEquals(standings[0].participantId, "player-1");
    assertEquals(standings[1].participantId, "player-2");
  });

  await t.step("losers-side finalist winning GF1 forces a reset, then the tournament completes", () => {
    const participants = createParticipants(2);
    const participantMap = createParticipantMap(participants);
    const bracket = generateDoubleEliminationBracket(participants);

    recordMatchResult(bracket, "w1m0", [2, 0], "player-1", "player-1");
    recordMatchResult(bracket, "gf1", [2, 0], "player-2", "player-2");

    assert(bracket.grandFinals.reset.requiresPlay, "Bracket reset should be required");
    assertEquals(bracket.isComplete, false, "Tournament should not be complete before the reset is played");

    recordMatchResult(bracket, "gf2", [2, 1], "player-1", "player-1");
    assert(bracket.isComplete, "Tournament should complete once the reset match is played");

    const standings = getStandings(bracket, participantMap);
    assertEquals(standings.length, 2);
    assertEquals(standings[0].participantId, "player-1");
    assertEquals(standings[1].participantId, "player-2");
  });
});
