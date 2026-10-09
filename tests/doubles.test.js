/**
 * Tests for doubles.js (Team-Based Tournament)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formTeams,
  generateDoublesTournament,
  validateTeamAssignments,
  autoAssignTeams,
} from "../js/tournament/doubles.js";
import { createParticipants, createTeamAssignments } from "./fixtures.js";

test("formTeams", async (t) => {
  await t.test("sets team name from member names", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const teams = formTeams(participants, assignments, 2);

    assert(teams[0].name.includes(" & "), "Team name should contain ' & '");
    assert(teams[0].name.includes("Player"), "Team name should include player names");
  });

  await t.test("calculates seed as average of member seeds", () => {
    const participants = createParticipants(4);
    // Seeds 1+4 and 2+3 both average 2.5.
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-4", "team-1"],
      ["player-2", "team-2"],
      ["player-3", "team-2"],
    ]);

    const teams = formTeams(participants, assignments, 2);

    assert.deepStrictEqual(teams[0].seed, 2.5);
    assert.deepStrictEqual(teams[1].seed, 2.5);
  });

  await t.test("sorts teams by seed", () => {
    const participants = createParticipants(4);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
      ["player-3", "team-2"],
      ["player-4", "team-2"],
    ]);

    const teams = formTeams(participants, assignments, 2);

    assert.deepStrictEqual(teams[0].seed, 1.5, "Lower seed should be first");
    assert.deepStrictEqual(teams[1].seed, 3.5, "Higher seed should be second");
  });

  await t.test("skips participants without team assignment", () => {
    const participants = createParticipants(4);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
    ]);

    const teams = formTeams(participants, assignments, 2);

    assert.deepStrictEqual(teams.length, 1);
    assert.deepStrictEqual(teams[0].id, "team-1");
  });
});

test("validateTeamAssignments", async (t) => {
  await t.test("returns valid for complete teams", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const result = validateTeamAssignments(participants, assignments, 2);

    assert.deepStrictEqual(result.valid, true);
    assert.deepStrictEqual(result.errors.length, 0);
    assert.deepStrictEqual(result.teamCount, 2);
    assert.deepStrictEqual(result.completeTeams, 2);
  });

  await t.test("returns errors for unassigned participants", () => {
    const participants = createParticipants(4);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
    ]);

    const result = validateTeamAssignments(participants, assignments, 2);

    assert.deepStrictEqual(result.valid, false);
    assert(result.errors.length >= 2, "Should have errors for unassigned participants");
    assert(result.errors.some(e => e.includes("Player 3")), "Should mention Player 3");
  });

  await t.test("returns errors for wrong team size", () => {
    const participants = createParticipants(3);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
      ["player-3", "team-2"],
    ]);

    const result = validateTeamAssignments(participants, assignments, 2);

    assert.deepStrictEqual(result.valid, false);
    assert(result.errors.some(e => e.includes("team-2")), "Should mention incomplete team");
    assert.deepStrictEqual(result.completeTeams, 1);
  });

  await t.test("handles teams of size 3", () => {
    const participants = createParticipants(6);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
      ["player-3", "team-1"],
      ["player-4", "team-2"],
      ["player-5", "team-2"],
      ["player-6", "team-2"],
    ]);

    const result = validateTeamAssignments(participants, assignments, 3);

    assert.deepStrictEqual(result.valid, true);
    assert.deepStrictEqual(result.completeTeams, 2);
  });
});

test("autoAssignTeams", async (t) => {
  await t.test("assigns all participants to teams", () => {
    const participants = createParticipants(4);

    const assignments = autoAssignTeams(participants, 2);

    assert.deepStrictEqual(assignments.size, 4);
    for (const p of participants) {
      assert(assignments.has(p.id), `${p.id} should have assignment`);
    }
  });

  await t.test("creates teams of correct size", () => {
    const participants = createParticipants(4);

    const assignments = autoAssignTeams(participants, 2);

    const teamCounts = new Map();
    for (const teamId of assignments.values()) {
      teamCounts.set(teamId, (teamCounts.get(teamId) || 0) + 1);
    }

    for (const [teamId, count] of teamCounts) {
      assert.deepStrictEqual(count, 2, `${teamId} should have 2 members`);
    }
  });

  await t.test("returns Map of participantId to teamId", () => {
    const participants = createParticipants(4);

    const assignments = autoAssignTeams(participants, 2);

    assert(assignments instanceof Map, "Should return Map");
    const firstValue = assignments.values().next().value;
    assert(typeof firstValue === "string", "Values should be team IDs (strings)");
    assert(firstValue.startsWith("team-"), "Team IDs should start with 'team-'");
  });

  await t.test("handles odd number of participants", () => {
    const participants = createParticipants(5);

    const assignments = autoAssignTeams(participants, 2);

    assert.deepStrictEqual(assignments.size, 5);
  });

  await t.test("deals every order with equal probability", () => {
    // A comparator shuffle lands near 1500 on two of the six orders; uniform is 1000 each.
    const participants = createParticipants(3);
    const counts = new Map();
    for (let i = 0; i < 6000; i++) {
      const assignments = autoAssignTeams(participants, 1);
      const order = participants.toSorted((a, b) => assignments.get(a.id).localeCompare(assignments.get(b.id)));
      const key = order.map((p) => p.id).join();
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    assert.deepStrictEqual(counts.size, 6);
    for (const [order, count] of counts) {
      assert(count > 800 && count < 1200, `${order} dealt ${count} times`);
    }
  });
});

test("generateDoublesTournament", async (t) => {
  await t.test("throws for less than 2 complete teams", () => {
    const participants = createParticipants(2);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
    ]);

    assert.throws(
      () => generateDoublesTournament(participants, assignments),
      (err) => err instanceof Error && err.message.includes("Need at least 2 complete teams")
    );
  });

  await t.test("generates tournament with type 'doubles'", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const { bracket } = generateDoublesTournament(participants, assignments);

    assert.deepStrictEqual(bracket.type, "doubles");
  });

  await t.test("includes teams array", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const { bracket } = generateDoublesTournament(participants, assignments);

    assert(Array.isArray(bracket.teams), "Should have teams array");
    assert.deepStrictEqual(bracket.teams.length, 2);
  });

  await t.test("uses single elimination by default", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const { bracket } = generateDoublesTournament(participants, assignments);

    assert.deepStrictEqual(bracket.bracketType, "single");
  });

  await t.test("can use double elimination", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const { bracket } = generateDoublesTournament(participants, assignments, {
      bracketType: "double",
    });

    assert.deepStrictEqual(bracket.bracketType, "double");
    assert(bracket.winners !== undefined, "Should have winners bracket");
    assert(bracket.losers !== undefined, "Should have losers bracket");
  });

  await t.test("configurable team size", () => {
    const participants = createParticipants(6);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
      ["player-3", "team-1"],
      ["player-4", "team-2"],
      ["player-5", "team-2"],
      ["player-6", "team-2"],
    ]);

    const { bracket } = generateDoublesTournament(participants, assignments, {
      teamSize: 3,
    });

    assert.deepStrictEqual(bracket.teams.length, 2);
    assert.deepStrictEqual(bracket.teams[0].members.length, 3);
  });
});
