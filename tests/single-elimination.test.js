/**
 * Tests for single-elimination.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
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

test("generateSingleEliminationBracket", async (t) => {
  await t.test("throws for less than 2 participants", () => {
    assert.throws(
      () => generateSingleEliminationBracket([{ id: "1", name: "Solo", seed: 1 }]),
      (err) => err instanceof Error && err.message.includes("Need at least 2 participants")
    );
  });

  await t.test("throws for empty array", () => {
    assert.throws(
      () => generateSingleEliminationBracket([]),
      (err) => err instanceof Error && err.message.includes("Need at least 2 participants")
    );
  });

  await t.test("generates 2-player bracket correctly", () => {
    const tournament = generateSingleEliminationBracket(participants2);
    const { bracket } = tournament;

    assert.deepStrictEqual(bracket.type, "single");
    assert.deepStrictEqual(bracket.rounds.length, 1);
    // Round 1 keeps its name even when it is also the final.
    assert.deepStrictEqual(bracket.rounds[0].name, "Round 1");
    assert.deepStrictEqual(bracket.rounds[0].matchIds.length, 1);

    const finals = roundMatches(tournament, 0)[0];
    assert.deepStrictEqual(finals.id, "r1m0");
    assert.deepStrictEqual(finals.participants[0], "player-1");
    assert.deepStrictEqual(finals.participants[1], "player-2");
    assert.deepStrictEqual(finals.isBye, false);
  });

  await t.test("generates 3-player bracket with bye", () => {
    const tournament = generateSingleEliminationBracket(participants3);
    const { bracket } = tournament;

    assert.deepStrictEqual(bracket.rounds.length, 2);

    const round1 = roundMatches(tournament, 0);
    assert.deepStrictEqual(round1.length, 2);

    const byeMatch = round1.find(m => m.isBye);
    assert(byeMatch !== undefined, "Should have a bye match");
    assert(byeMatch.winnerId !== null, "Bye should auto-advance winner");

    const nonByeMatch = round1.find(m => !m.isBye);
    assert(nonByeMatch !== undefined, "Should have a non-bye match");
    assert.deepStrictEqual(nonByeMatch.winnerId, null, "Non-bye match should not be decided");
  });

  await t.test("generates 4-player bracket with correct seeding", () => {
    const tournament = generateSingleEliminationBracket(participants4);
    const { bracket } = tournament;

    assert.deepStrictEqual(bracket.rounds[0].matchIds.length, 2);
    assert.deepStrictEqual(bracket.rounds[1].matchIds.length, 1);
    assert.deepStrictEqual(bracket.rounds[1].name, "Finals");

    const r1 = roundMatches(tournament, 0);
    assert(
      r1[0].participants.includes("player-1") && r1[0].participants.includes("player-4"),
      "Match 0 should be seed 1 vs seed 4"
    );
    assert(
      r1[1].participants.includes("player-2") && r1[1].participants.includes("player-3"),
      "Match 1 should be seed 2 vs seed 3"
    );
  });

  await t.test("generates 8-player bracket with 3 rounds", () => {
    const tournament = generateSingleEliminationBracket(participants8);
    const { bracket } = tournament;

    assert.deepStrictEqual(bracket.rounds.map((r) => r.matchIds.length), [4, 2, 1]);
    assert.deepStrictEqual(bracket.rounds[2].name, "Finals");

    assert.deepStrictEqual(roundMatches(tournament, 0)[0].participants[0], "player-1");
  });

  await t.test("generates 32-player bracket with 5 rounds", () => {
    const { bracket } = generateSingleEliminationBracket(createParticipants(32));

    assert.deepStrictEqual(bracket.rounds.map((r) => r.matchIds.length), [16, 8, 4, 2, 1]);
  });

  await t.test("generates 64-player bracket with 6 rounds and 63 matches", () => {
    const tournament = generateSingleEliminationBracket(createParticipants(64));
    const { bracket, matches } = tournament;

    assert.deepStrictEqual(bracket.rounds.length, 6);
    assert.deepStrictEqual(matches.size, 63);
    assert.deepStrictEqual(roundMatches(tournament, 0)[0].participants[0], "player-1");
  });

  await t.test("rounds list every match id exactly once", () => {
    const { bracket, matches } = generateSingleEliminationBracket(participants8);
    const ids = bracket.rounds.flatMap((r) => r.matchIds);

    assert.deepStrictEqual(new Set(ids), new Set(matches.keys()));
    assert.deepStrictEqual(ids.length, matches.size);
  });

  await t.test("all matches have required properties", () => {
    const { matches } = generateSingleEliminationBracket(participants4);

    for (const match of matches.values()) {
      assert(typeof match.id === "string", "Match should have string id");
      assert(typeof match.round === "number", "Match should have round number");
      assert(typeof match.position === "number", "Match should have position");
      assert(Array.isArray(match.participants), "Match should have participants array");
      assert(Array.isArray(match.scores), "Match should have scores array");
      assert.deepStrictEqual(match.scores.length, 2, "Scores should have 2 elements");
      assert("winnerId" in match, "Match should have winnerId property");
      assert("reportedBy" in match, "Match should have reportedBy property");
      assert("isBye" in match, "Match should have isBye property");
    }
  });
});

test("advance", async (t) => {
  await t.test("advances winner to next round slot 0 (even position)", () => {
    const tournament = generateSingleEliminationBracket(participants4);

    report(tournament, advance, "r1m0", "player-1");

    const finals = tournament.matches.get("r2m0");
    assert.deepStrictEqual(finals.participants[0], "player-1", "Winner of position 0 should go to slot 0");
  });

  await t.test("advances winner to next round slot 1 (odd position)", () => {
    const tournament = generateSingleEliminationBracket(participants4);

    report(tournament, advance, "r1m1", "player-2");

    const finals = tournament.matches.get("r2m0");
    assert.deepStrictEqual(finals.participants[1], "player-2", "Winner of position 1 should go to slot 1");
  });

  await t.test("writes new participants arrays through the update callback", () => {
    const tournament = generateSingleEliminationBracket(participants4);
    const before = tournament.matches.get("r2m0").participants;
    const writes = [];

    tournament.matches.get("r1m0").winnerId = "player-1";
    advance(tournament, (id, fields) => writes.push([id, fields]));

    assert.deepStrictEqual(writes, [["r2m0", { participants: ["player-1", null] }]]);
    assert.deepStrictEqual(before, [null, null], "the existing array is never mutated");
  });

  await t.test("reports complete only once the final is decided", () => {
    const tournament = generateSingleEliminationBracket(participants4);

    assert.deepStrictEqual(report(tournament, advance, "r1m0", "player-1"), false);
    assert.deepStrictEqual(report(tournament, advance, "r1m1", "player-2"), false);
    assert.deepStrictEqual(report(tournament, advance, "r2m0", "player-1"), true);
  });

  await t.test("2-player final completes immediately", () => {
    const tournament = generateSingleEliminationBracket(participants2);
    assert.deepStrictEqual(report(tournament, advance, "r1m0", "player-1"), true);
  });

  await t.test("full 4-player tournament flow", () => {
    const tournament = generateSingleEliminationBracket(participants4);

    report(tournament, advance, "r1m0", "player-1");
    report(tournament, advance, "r1m1", "player-3");

    const finals = tournament.matches.get("r2m0");
    assert.deepStrictEqual(finals.participants, ["player-1", "player-3"]);

    assert(report(tournament, advance, "r2m0", "player-1"));
    assert.deepStrictEqual(finals.winnerId, "player-1");
  });
});

test("getStandings", async (t) => {
  await t.test("returns empty array if tournament not complete", () => {
    const { bracket, matches } = generateSingleEliminationBracket(participants4);
    const participantMap = createParticipantMap(participants4);

    const standings = getStandings(bracket, matches, participantMap);
    assert.deepStrictEqual(standings, []);
  });

  await t.test("returns correct standings for 2-player tournament", () => {
    const tournament = generateSingleEliminationBracket(participants2);
    const participantMap = createParticipantMap(participants2);

    report(tournament, advance, "r1m0", "player-1");

    const standings = getStandings(tournament.bracket, tournament.matches, participantMap);

    assert.deepStrictEqual(standings.length, 2);
    assert.deepStrictEqual(standings[0].place, 1);
    assert.deepStrictEqual(standings[0].participantId, "player-1");
    assert.deepStrictEqual(standings[0].name, "Player 1");
    assert.deepStrictEqual(standings[1].place, 2);
    assert.deepStrictEqual(standings[1].participantId, "player-2");
  });

  await t.test("returns correct standings for 4-player tournament", () => {
    const tournament = generateSingleEliminationBracket(participants4);
    const participantMap = createParticipantMap(participants4);

    report(tournament, advance, "r1m0", "player-1");
    report(tournament, advance, "r1m1", "player-2");
    report(tournament, advance, "r2m0", "player-1");

    const standings = getStandings(tournament.bracket, tournament.matches, participantMap);

    assert.deepStrictEqual(standings.length, 4);
    assert.deepStrictEqual(standings[0].place, 1);
    assert.deepStrictEqual(standings[0].participantId, "player-1");
    assert.deepStrictEqual(standings[1].place, 2);
    assert.deepStrictEqual(standings[1].participantId, "player-2");
    assert(
      standings[2].participantId === "player-3" || standings[2].participantId === "player-4",
      "3rd place should be a semi-final loser"
    );
  });

  await t.test("handles missing participants gracefully", () => {
    const tournament = generateSingleEliminationBracket(participants2);
    const emptyMap = new Map();

    report(tournament, advance, "r1m0", "player-1");

    const standings = getStandings(tournament.bracket, tournament.matches, emptyMap);

    assert.deepStrictEqual(standings.length, 2);
    assert.deepStrictEqual(standings[0].name, "Unknown");
  });
});
