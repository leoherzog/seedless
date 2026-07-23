/**
 * Regression tests: Double Elimination - parametric run-to-completion
 *
 * A batch of 3 bugs previously lived in the double-elimination drop/advance
 * logic:
 *   1. Winners-round-3+ losers dropped into the wrong losers-bracket match,
 *      overwriting an already-placed competitor (corrupted 9-16 player
 *      brackets).
 *   2. 2-player brackets never completed (the winners-final loser had
 *      nowhere to drop to, since there is no losers bracket at all, so grand
 *      finals slot 1 never filled).
 *   3. Losers-bracket byes (non-power-of-2 fields, e.g. 5/6/7 players) left
 *      matches permanently stalled with a single participant and no winner.
 *
 * For every N in a representative range, this suite generates a bracket,
 * plays every resolvable match (winners, losers, grand finals, and any grand
 * finals reset) to completion via a deterministic advancement rule, and
 * asserts structural invariants: exactly one champion, complete standings,
 * grand-finals losers-champion slot filled, no losers match left stalled
 * with a null opponent, and full participant conservation (nobody vanishes
 * because a slot got silently overwritten).
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  generateDoubleEliminationBracket,
  recordMatchResult,
  getStandings,
} from "../js/tournament/double-elimination.js";
import { createParticipants, createParticipantMap } from "./fixtures.js";

const N_VALUES = [2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16, 17];

/**
 * Deterministic winner selector: slot 0 always wins. Combined with standard
 * seeding this never forces a grand-finals bracket reset (the winners-bracket
 * champion always occupies GF slot 0 and always wins GF1 under this rule).
 */
function slot0Wins(match) {
  return match.participants[0];
}

/**
 * Deterministic winner selector that forces a grand-finals bracket reset:
 * the losers-bracket champion (GF slot 1) wins GF1, everything else is
 * decided by slot 0.
 */
function forceGrandFinalsReset(match) {
  if (match.id === "gf1") return match.participants[1];
  return match.participants[0];
}

/**
 * Snapshot every match's participant slots so a later call can detect
 * whether any already-filled (non-null) slot got silently overwritten with
 * a *different* participant - the exact shape of the winners-round-3+
 * drop-routing bug.
 */
function snapshotParticipants(bracket) {
  const snap = new Map();
  for (const match of bracket.matches.values()) {
    snap.set(match.id, [...match.participants]);
  }
  return snap;
}

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

/**
 * Play every match that has two real participants, repeating until no more
 * progress can be made (grand-finals resets, cascading losers-bracket byes,
 * etc. all get picked up on subsequent passes). Guards against slot
 * overwrites after every single recorded result.
 */
function playToCompletion(bracket, winnerSelector = slot0Wins) {
  let progressed = true;
  let safety = 0;
  const maxIterations = 500;

  while (progressed && safety < maxIterations) {
    progressed = false;

    for (const match of bracket.matches.values()) {
      if (match.isBye || match.winnerId) continue;
      if (match.participants[0] && match.participants[1]) {
        const winnerId = winnerSelector(match);
        const before = snapshotParticipants(bracket);
        recordMatchResult(bracket, match.id, [2, 0], winnerId, winnerId);
        assertNoOverwrites(before, bracket, match.id);
        progressed = true;
      }
    }

    safety++;
  }

  return safety;
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

/**
 * No losers-bracket match may be left forever pending with exactly one real
 * participant and no winner - that is the losers-bye stall bug. (A match
 * with *zero* real participants is legitimately "dead": it was fed entirely
 * by bye slots that can never be filled, so it never needed to be played.)
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
 * Every input participant must appear in the final standings exactly once,
 * and every place from 1..N must be present with no gaps or duplicates.
 * This is the direct conservation check for the overwrite bug: if a drop
 * silently clobbered another competitor's slot, that competitor vanishes
 * from the bracket entirely and standings.length would be short.
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

  playToCompletion(bracket, winnerSelector);

  assert(bracket.isComplete, `${n}-player bracket should complete. ${describeIncomplete(bracket)}`);

  return { bracket, participants, participantMap };
}

// ============================================================================
// Parametric: every N completes cleanly, no reset forced
// ============================================================================

Deno.test("Double Elimination - parametric run to completion (no forced reset)", async (t) => {
  for (const n of N_VALUES) {
    await t.step(`N=${n}: single champion, complete standings, no stalled matches`, () => {
      const { bracket, participants, participantMap } = runFullTournament(n, slot0Wins);

      assertNoStalledLosersMatches(bracket);
      const standings = assertConservation(bracket, participants, participantMap);

      assertEquals(standings[0].place, 1);
      assertEquals(standings[1].place, 2);

      // Grand-finals losers-champion slot must be filled - previously null
      // forever for N=2, since there was no losers bracket to drop into.
      assert(
        bracket.grandFinals.match.participants[1],
        `GF participants[1] (losers champion) should be filled for N=${n}`
      );
      assert(
        bracket.grandFinals.match.participants[0],
        `GF participants[0] (winners champion) should be filled for N=${n}`
      );

      // slot0Wins never lets the losers-bracket finalist win GF1, so no
      // reset should ever be triggered by this scenario.
      assertEquals(bracket.grandFinals.reset.requiresPlay, false);
    });
  }
});

// ============================================================================
// Parametric: every N also completes when a grand-finals reset is forced
// ============================================================================

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

// ============================================================================
// Dedicated: N=2 (previously never completed - no losers bracket exists)
// ============================================================================

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

// ============================================================================
// Dedicated: N=5,6,7 (losers-bracket byes from a non-power-of-2 field)
// ============================================================================

Deno.test("Double Elimination - losers-bracket byes at N=5,6,7 do not stall", async (t) => {
  for (const n of [5, 6, 7]) {
    await t.step(`N=${n}: bracket has dead losers slots and still resolves fully`, () => {
      const { bracket, participants, participantMap } = runFullTournament(n, slot0Wins);

      const hadDeadSlot = bracket.losers.rounds.some((round) =>
        round.matches.some((m) => (m.deadSlots?.length || 0) > 0)
      );
      assert(hadDeadSlot, `N=${n} (bracketSize > participant count) should mark at least one dead losers slot`);

      assertNoStalledLosersMatches(bracket);
      assertConservation(bracket, participants, participantMap);
      assert(bracket.grandFinals.match.participants[1], "GF losers slot must be filled");
    });
  }
});

// ============================================================================
// Dedicated: N=9..16 (winners-round-3+ drop-target routing)
// ============================================================================

Deno.test("Double Elimination - winners-round-3+ drop routing for N=9..16", async (t) => {
  for (let n = 9; n <= 16; n++) {
    await t.step(`N=${n}: every dropped loser lands in an empty slot, nobody is overwritten`, () => {
      const { bracket, participants, participantMap } = runFullTournament(n, slot0Wins);

      // Winners rounds 3+ exist once bracketSize >= 16 (log2(16) = 4 winners
      // rounds); for bracketSize 16 the third winners round is the semifinal,
      // which is exactly where the old `round: winnersRound` formula dropped
      // into an already-filled minor losers round.
      assertNoStalledLosersMatches(bracket);
      assertConservation(bracket, participants, participantMap);
    });
  }
});
