/**
 * Tests for single-elimination.js
 */

import { assertEquals, assert, assertThrows } from "jsr:@std/assert";
import {
  generateSingleEliminationBracket,
  advance,
  getStandings,
} from "../js/tournament/single-elimination.js";
import {
  createParticipants,
  createParticipantMap,
  participants2,
  participants3,
  participants4,
  participants8,
  report,
} from "./fixtures.js";

/** The match objects of round i. */
const roundMatches = ({ bracket, matches }, i) => bracket.rounds[i].matchIds.map((id) => matches.get(id));

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
    const tournament = generateSingleEliminationBracket(participants2);
    const { bracket } = tournament;

    assertEquals(bracket.type, "single");
    assertEquals(bracket.rounds.length, 1);
    // Note: Round 1 is always named "Round 1" even if it's also the finals
    assertEquals(bracket.rounds[0].name, "Round 1");
    assertEquals(bracket.rounds[0].matchIds.length, 1);

    const finals = roundMatches(tournament, 0)[0];
    assertEquals(finals.id, "r1m0");
    assertEquals(finals.participants[0], "player-1");
    assertEquals(finals.participants[1], "player-2");
    assertEquals(finals.isBye, false);
  });

  await t.step("generates 3-player bracket with bye", () => {
    const tournament = generateSingleEliminationBracket(participants3);
    const { bracket } = tournament;

    assertEquals(bracket.rounds.length, 2);

    // Round 1 should have 2 matches, one being a bye
    const round1 = roundMatches(tournament, 0);
    assertEquals(round1.length, 2);

    // One match should be a bye with seed 1 auto-advanced
    const byeMatch = round1.find(m => m.isBye);
    assert(byeMatch !== undefined, "Should have a bye match");
    assert(byeMatch.winnerId !== null, "Bye should auto-advance winner");

    // Seed 1 should get the bye (faces weakest seed which is missing)
    const nonByeMatch = round1.find(m => !m.isBye);
    assert(nonByeMatch !== undefined, "Should have a non-bye match");
    assertEquals(nonByeMatch.winnerId, null, "Non-bye match should not be decided");
  });

  await t.step("generates 4-player bracket with correct seeding", () => {
    const tournament = generateSingleEliminationBracket(participants4);
    const { bracket } = tournament;

    assertEquals(bracket.rounds[0].matchIds.length, 2);
    assertEquals(bracket.rounds[1].matchIds.length, 1);
    assertEquals(bracket.rounds[1].name, "Finals");

    // Standard seeding: 1v4, 2v3
    const r1 = roundMatches(tournament, 0);
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
    const tournament = generateSingleEliminationBracket(participants8);
    const { bracket } = tournament;

    assertEquals(bracket.rounds.map((r) => r.matchIds.length), [4, 2, 1]);
    assertEquals(bracket.rounds[2].name, "Finals");

    // Seed 1 should be at position 0 (first match, first slot)
    assertEquals(roundMatches(tournament, 0)[0].participants[0], "player-1");
  });

  await t.step("generates 32-player bracket with 5 rounds", () => {
    const { bracket } = generateSingleEliminationBracket(createParticipants(32));

    assertEquals(bracket.rounds.map((r) => r.matchIds.length), [16, 8, 4, 2, 1]);
  });

  await t.step("generates 64-player bracket with 6 rounds and 63 matches", () => {
    const tournament = generateSingleEliminationBracket(createParticipants(64));
    const { bracket, matches } = tournament;

    assertEquals(bracket.rounds.length, 6);
    assertEquals(matches.size, 63);
    assertEquals(roundMatches(tournament, 0)[0].participants[0], "player-1");
  });

  await t.step("rounds list every match id exactly once", () => {
    const { bracket, matches } = generateSingleEliminationBracket(participants8);
    const ids = bracket.rounds.flatMap((r) => r.matchIds);

    assertEquals(new Set(ids), new Set(matches.keys()));
    assertEquals(ids.length, matches.size);
  });

  await t.step("all matches have required properties", () => {
    const { matches } = generateSingleEliminationBracket(participants4);

    for (const match of matches.values()) {
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
  });
});

Deno.test("advance", async (t) => {
  await t.step("advances winner to next round slot 0 (even position)", () => {
    const tournament = generateSingleEliminationBracket(participants4);

    // Match at position 0 - winner goes to slot 0 of next match
    report(tournament, advance, "r1m0", "player-1");

    const finals = tournament.matches.get("r2m0");
    assertEquals(finals.participants[0], "player-1", "Winner of position 0 should go to slot 0");
  });

  await t.step("advances winner to next round slot 1 (odd position)", () => {
    const tournament = generateSingleEliminationBracket(participants4);

    // Match at position 1 - winner goes to slot 1 of next match
    report(tournament, advance, "r1m1", "player-2");

    const finals = tournament.matches.get("r2m0");
    assertEquals(finals.participants[1], "player-2", "Winner of position 1 should go to slot 1");
  });

  await t.step("writes new participants arrays through the update callback", () => {
    const tournament = generateSingleEliminationBracket(participants4);
    const before = tournament.matches.get("r2m0").participants;
    const writes = [];

    tournament.matches.get("r1m0").winnerId = "player-1";
    advance(tournament, "r1m0", (id, fields) => writes.push([id, fields]));

    assertEquals(writes, [["r2m0", { participants: ["player-1", null] }]]);
    assertEquals(before, [null, null], "the existing array is never mutated");
  });

  await t.step("reports complete only once the final is decided", () => {
    const tournament = generateSingleEliminationBracket(participants4);

    assertEquals(report(tournament, advance, "r1m0", "player-1"), false);
    assertEquals(report(tournament, advance, "r1m1", "player-2"), false);
    assertEquals(report(tournament, advance, "r2m0", "player-1"), true);
  });

  await t.step("2-player final completes immediately", () => {
    const tournament = generateSingleEliminationBracket(participants2);
    assertEquals(report(tournament, advance, "r1m0", "player-1"), true);
  });

  await t.step("full 4-player tournament flow", () => {
    const tournament = generateSingleEliminationBracket(participants4);

    // Semi 1: Player 1 beats Player 4
    report(tournament, advance, "r1m0", "player-1");
    // Semi 2: Player 3 upsets Player 2
    report(tournament, advance, "r1m1", "player-3");

    // Finals should have correct participants
    const finals = tournament.matches.get("r2m0");
    assertEquals(finals.participants, ["player-1", "player-3"]);

    // Finals: Player 1 wins
    assert(report(tournament, advance, "r2m0", "player-1"));
    assertEquals(finals.winnerId, "player-1");
  });
});

Deno.test("getStandings", async (t) => {
  await t.step("returns empty array if tournament not complete", () => {
    const { bracket, matches } = generateSingleEliminationBracket(participants4);
    const participantMap = createParticipantMap(participants4);

    const standings = getStandings(bracket, matches, participantMap);
    assertEquals(standings, []);
  });

  await t.step("returns correct standings for 2-player tournament", () => {
    const tournament = generateSingleEliminationBracket(participants2);
    const participantMap = createParticipantMap(participants2);

    report(tournament, advance, "r1m0", "player-1");

    const standings = getStandings(tournament.bracket, tournament.matches, participantMap);

    assertEquals(standings.length, 2);
    assertEquals(standings[0].place, 1);
    assertEquals(standings[0].participantId, "player-1");
    assertEquals(standings[0].name, "Player 1");
    assertEquals(standings[1].place, 2);
    assertEquals(standings[1].participantId, "player-2");
  });

  await t.step("returns correct standings for 4-player tournament", () => {
    const tournament = generateSingleEliminationBracket(participants4);
    const participantMap = createParticipantMap(participants4);

    // Semi 1: Player 1 beats Player 4
    report(tournament, advance, "r1m0", "player-1");
    // Semi 2: Player 2 beats Player 3
    report(tournament, advance, "r1m1", "player-2");
    // Finals: Player 1 beats Player 2
    report(tournament, advance, "r2m0", "player-1");

    const standings = getStandings(tournament.bracket, tournament.matches, participantMap);

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
    const tournament = generateSingleEliminationBracket(participants2);
    const emptyMap = new Map();

    report(tournament, advance, "r1m0", "player-1");

    const standings = getStandings(tournament.bracket, tournament.matches, emptyMap);

    assertEquals(standings.length, 2);
    assertEquals(standings[0].name, "Unknown");
  });
});
