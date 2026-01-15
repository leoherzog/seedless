/**
 * Tests for single-elimination.js
 */

import { assertEquals, assert, assertThrows } from "jsr:@std/assert";
import {
  generateSingleEliminationBracket,
  recordMatchResult,
  getStandings,
} from "../js/tournament/single-elimination.js";
import {
  createParticipants,
  createParticipantMap,
  participants2,
  participants3,
  participants4,
  participants8,
} from "./fixtures.js";

Deno.test("generateSingleEliminationBracket", async (t) => {
  await t.step("throws for less than 2 participants", () => {
    assertThrows(
      () => generateSingleEliminationBracket([{ id: "1", name: "Solo", seed: 1 }]),
      Error,
      "Need at least 2 participants"
    );
  });

  await t.step("throws for empty array", () => {
    assertThrows(
      () => generateSingleEliminationBracket([]),
      Error,
      "Need at least 2 participants"
    );
  });

  await t.step("generates 2-player bracket correctly", () => {
    const bracket = generateSingleEliminationBracket(participants2);

    assertEquals(bracket.type, "single");
    assertEquals(bracket.bracketSize, 2);
    assertEquals(bracket.numRounds, 1);
    assertEquals(bracket.participantCount, 2);
    assertEquals(bracket.rounds.length, 1);
    // Note: Round 1 is always named "Round 1" even if it's also the finals
    assertEquals(bracket.rounds[0].name, "Round 1");
    assertEquals(bracket.rounds[0].matches.length, 1);

    const finals = bracket.rounds[0].matches[0];
    assertEquals(finals.id, "r1m0");
    assertEquals(finals.participants[0], "player-1");
    assertEquals(finals.participants[1], "player-2");
    assertEquals(finals.isBye, false);
  });

  await t.step("generates 3-player bracket with bye", () => {
    const bracket = generateSingleEliminationBracket(participants3);

    assertEquals(bracket.bracketSize, 4);
    assertEquals(bracket.numRounds, 2);
    assertEquals(bracket.participantCount, 3);
    assertEquals(bracket.rounds.length, 2);

    // Round 1 should have 2 matches, one being a bye
    const round1 = bracket.rounds[0];
    assertEquals(round1.matches.length, 2);

    // One match should be a bye with seed 1 auto-advanced
    const byeMatch = round1.matches.find(m => m.isBye);
    assert(byeMatch !== undefined, "Should have a bye match");
    assert(byeMatch.winnerId !== null, "Bye should auto-advance winner");

    // Seed 1 should get the bye (faces weakest seed which is missing)
    const nonByeMatch = round1.matches.find(m => !m.isBye);
    assert(nonByeMatch !== undefined, "Should have a non-bye match");
    assertEquals(nonByeMatch.winnerId, null, "Non-bye match should not be decided");
  });

  await t.step("generates 4-player bracket with correct seeding", () => {
    const bracket = generateSingleEliminationBracket(participants4);

    assertEquals(bracket.bracketSize, 4);
    assertEquals(bracket.numRounds, 2);
    assertEquals(bracket.rounds[0].matches.length, 2);
    assertEquals(bracket.rounds[1].matches.length, 1);
    assertEquals(bracket.rounds[1].name, "Finals");

    // Standard seeding: 1v4, 2v3
    const r1 = bracket.rounds[0].matches;
    // Match 0: seed 1 vs seed 4
    assert(
      r1[0].participants.includes("player-1") && r1[0].participants.includes("player-4"),
      "Match 0 should be seed 1 vs seed 4"
    );
    // Match 1: seed 2 vs seed 3
    assert(
      r1[1].participants.includes("player-2") && r1[1].participants.includes("player-3"),
      "Match 1 should be seed 2 vs seed 3"
    );
  });

  await t.step("generates 8-player bracket with 3 rounds", () => {
    const bracket = generateSingleEliminationBracket(participants8);

    assertEquals(bracket.bracketSize, 8);
    assertEquals(bracket.numRounds, 3);
    assertEquals(bracket.rounds.length, 3);
    assertEquals(bracket.rounds[0].matches.length, 4);
    assertEquals(bracket.rounds[1].matches.length, 2);
    assertEquals(bracket.rounds[2].matches.length, 1);
    assertEquals(bracket.rounds[2].name, "Finals");

    // Seed 1 should be at position 0 (first match, first slot)
    assertEquals(bracket.rounds[0].matches[0].participants[0], "player-1");
  });

  await t.step("all matches have required properties", () => {
    const bracket = generateSingleEliminationBracket(participants4);

    for (const round of bracket.rounds) {
      for (const match of round.matches) {
        assert(typeof match.id === "string", "Match should have string id");
        assert(typeof match.round === "number", "Match should have round number");
        assert(typeof match.position === "number", "Match should have position");
        assert(Array.isArray(match.participants), "Match should have participants array");
        assert(Array.isArray(match.scores), "Match should have scores array");
        assertEquals(match.scores.length, 2, "Scores should have 2 elements");
        assert("winnerId" in match, "Match should have winnerId property");
        assert("reportedBy" in match, "Match should have reportedBy property");
        assert("isBye" in match, "Match should have isBye property");
      }
    }
  });

  await t.step("matches map contains all matches", () => {
    const bracket = generateSingleEliminationBracket(participants8);

    let totalMatches = 0;
    for (const round of bracket.rounds) {
      totalMatches += round.matches.length;
    }

    assertEquals(bracket.matches.size, totalMatches);
  });
});

Deno.test("recordMatchResult", async (t) => {
  await t.step("throws for non-existent match", () => {
    const bracket = generateSingleEliminationBracket(participants4);

    assertThrows(
      () => recordMatchResult(bracket, "invalid-match", [2, 0], "player-1", "player-1"),
      Error,
      "Match not found"
    );
  });

  await t.step("records scores and winner", () => {
    const bracket = generateSingleEliminationBracket(participants4);

    recordMatchResult(bracket, "r1m0", [2, 1], "player-1", "player-1");

    const match = bracket.matches.get("r1m0");
    assertEquals(match.scores, [2, 1]);
    assertEquals(match.winnerId, "player-1");
    assertEquals(match.reportedBy, "player-1");
    assert(match.reportedAt !== null, "Should set reportedAt timestamp");
  });

  await t.step("advances winner to next round slot 0 (even position)", () => {
    const bracket = generateSingleEliminationBracket(participants4);

    // Match at position 0 - winner goes to slot 0 of next match
    recordMatchResult(bracket, "r1m0", [2, 0], "player-1", "player-1");

    const finals = bracket.matches.get("r2m0");
    assertEquals(finals.participants[0], "player-1", "Winner of position 0 should go to slot 0");
  });

  await t.step("advances winner to next round slot 1 (odd position)", () => {
    const bracket = generateSingleEliminationBracket(participants4);

    // Match at position 1 - winner goes to slot 1 of next match
    recordMatchResult(bracket, "r1m1", [2, 0], "player-2", "player-2");

    const finals = bracket.matches.get("r2m0");
    assertEquals(finals.participants[1], "player-2", "Winner of position 1 should go to slot 1");
  });

  await t.step("marks tournament complete when finals decided", () => {
    const bracket = generateSingleEliminationBracket(participants2);

    assertEquals(bracket.isComplete, undefined, "Should not be complete initially");

    recordMatchResult(bracket, "r1m0", [2, 1], "player-1", "player-1");

    assertEquals(bracket.isComplete, true, "Should be complete after finals");
  });

  await t.step("does not mark complete until finals", () => {
    const bracket = generateSingleEliminationBracket(participants4);

    recordMatchResult(bracket, "r1m0", [2, 0], "player-1", "player-1");
    assertEquals(bracket.isComplete, false, "Should not be complete after semi");

    recordMatchResult(bracket, "r1m1", [2, 0], "player-2", "player-2");
    assertEquals(bracket.isComplete, false, "Should not be complete after both semis");

    recordMatchResult(bracket, "r2m0", [2, 1], "player-1", "player-1");
    assertEquals(bracket.isComplete, true, "Should be complete after finals");
  });

  await t.step("full 4-player tournament flow", () => {
    const bracket = generateSingleEliminationBracket(participants4);

    // Semi 1: Player 1 beats Player 4
    recordMatchResult(bracket, "r1m0", [2, 0], "player-1", "player-1");
    // Semi 2: Player 3 upsets Player 2
    recordMatchResult(bracket, "r1m1", [2, 1], "player-3", "player-3");

    // Finals should have correct participants
    const finals = bracket.matches.get("r2m0");
    assertEquals(finals.participants[0], "player-1");
    assertEquals(finals.participants[1], "player-3");

    // Finals: Player 1 wins
    recordMatchResult(bracket, "r2m0", [2, 0], "player-1", "player-1");

    assertEquals(bracket.isComplete, true);
    assertEquals(finals.winnerId, "player-1");
  });
});

Deno.test("getStandings", async (t) => {
  await t.step("returns empty array if tournament not complete", () => {
    const bracket = generateSingleEliminationBracket(participants4);
    const participantMap = createParticipantMap(participants4);

    const standings = getStandings(bracket, participantMap);
    assertEquals(standings, []);
  });

  await t.step("returns correct standings for 2-player tournament", () => {
    const bracket = generateSingleEliminationBracket(participants2);
    const participantMap = createParticipantMap(participants2);

    recordMatchResult(bracket, "r1m0", [2, 1], "player-1", "player-1");

    const standings = getStandings(bracket, participantMap);

    assertEquals(standings.length, 2);
    assertEquals(standings[0].place, 1);
    assertEquals(standings[0].participantId, "player-1");
    assertEquals(standings[0].name, "Player 1");
    assertEquals(standings[1].place, 2);
    assertEquals(standings[1].participantId, "player-2");
  });

  await t.step("returns correct standings for 4-player tournament", () => {
    const bracket = generateSingleEliminationBracket(participants4);
    const participantMap = createParticipantMap(participants4);

    // Semi 1: Player 1 beats Player 4
    recordMatchResult(bracket, "r1m0", [2, 0], "player-1", "player-1");
    // Semi 2: Player 2 beats Player 3
    recordMatchResult(bracket, "r1m1", [2, 0], "player-2", "player-2");
    // Finals: Player 1 beats Player 2
    recordMatchResult(bracket, "r2m0", [2, 1], "player-1", "player-1");

    const standings = getStandings(bracket, participantMap);

    assertEquals(standings.length, 4);
    assertEquals(standings[0].place, 1);
    assertEquals(standings[0].participantId, "player-1");
    assertEquals(standings[1].place, 2);
    assertEquals(standings[1].participantId, "player-2");
    // Places 3-4 should be the semi-final losers (same round)
    assert(
      standings[2].participantId === "player-3" || standings[2].participantId === "player-4",
      "3rd place should be a semi-final loser"
    );
  });

  await t.step("handles missing participants gracefully", () => {
    const bracket = generateSingleEliminationBracket(participants2);
    const emptyMap = new Map();

    recordMatchResult(bracket, "r1m0", [2, 1], "player-1", "player-1");

    const standings = getStandings(bracket, emptyMap);

    assertEquals(standings.length, 2);
    assertEquals(standings[0].name, "Unknown");
  });
});

Deno.test("bye handling", async (t) => {
  await t.step("5 participants - 3 byes, correct advancement", () => {
    const participants5 = createParticipants(5);
    const bracket = generateSingleEliminationBracket(participants5);

    assertEquals(bracket.bracketSize, 8);
    assertEquals(bracket.numRounds, 3);

    // Count byes in round 1
    const byes = bracket.rounds[0].matches.filter(m => m.isBye);
    assertEquals(byes.length, 3, "Should have 3 bye matches");

    // All bye winners should be auto-advanced
    for (const bye of byes) {
      assert(bye.winnerId !== null, "Bye should have winner set");
    }

    // Check that bye winners are properly placed in round 2
    const round2 = bracket.rounds[1];
    for (const match of round2.matches) {
      // At least one participant should be filled from bye advancement
      const filledSlots = match.participants.filter(p => p !== null).length;
      assert(filledSlots > 0, "Round 2 matches should have some participants from byes");
    }
  });
});
