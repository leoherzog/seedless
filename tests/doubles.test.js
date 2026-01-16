/**
 * Tests for doubles.js (Team-Based Tournament)
 */

import { assertEquals, assert, assertThrows } from "jsr:@std/assert";
import {
  formTeams,
  generateDoublesTournament,
  validateTeamAssignments,
  recordMatchResult,
  autoAssignTeams,
  getStandings,
} from "../js/tournament/doubles.js";
import {
  createParticipants,
  createTeamAssignments,
  createPartialTeamAssignments,
} from "./fixtures.js";

Deno.test("formTeams", async (t) => {
  await t.step("groups participants by team assignment", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const teams = formTeams(participants, assignments, 2);

    assertEquals(teams.length, 2);
    assertEquals(teams[0].members.length, 2);
    assertEquals(teams[1].members.length, 2);
  });

  await t.step("filters incomplete teams", () => {
    const participants = createParticipants(5);
    const assignments = createTeamAssignments(participants, 2);
    // This creates 2 complete teams and 1 incomplete (1 member)

    const teams = formTeams(participants, assignments, 2);

    // Only complete teams (2 members each) should be returned
    assertEquals(teams.length, 2);
    for (const team of teams) {
      assertEquals(team.members.length, 2);
    }
  });

  await t.step("sets team name from member names", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const teams = formTeams(participants, assignments, 2);

    // Team name should be "Member1 & Member2"
    assert(teams[0].name.includes(" & "), "Team name should contain ' & '");
    assert(teams[0].name.includes("Player"), "Team name should include player names");
  });

  await t.step("calculates seed as average of member seeds", () => {
    const participants = createParticipants(4);
    // Manually create assignments: team-1 gets seeds 1,4 (avg 2.5), team-2 gets seeds 2,3 (avg 2.5)
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-4", "team-1"],
      ["player-2", "team-2"],
      ["player-3", "team-2"],
    ]);

    const teams = formTeams(participants, assignments, 2);

    // Both teams have same average seed
    assertEquals(teams[0].seed, 2.5);
    assertEquals(teams[1].seed, 2.5);
  });

  await t.step("sorts teams by seed", () => {
    const participants = createParticipants(4);
    // team-1 gets seeds 1,2 (avg 1.5), team-2 gets seeds 3,4 (avg 3.5)
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
      ["player-3", "team-2"],
      ["player-4", "team-2"],
    ]);

    const teams = formTeams(participants, assignments, 2);

    assertEquals(teams[0].seed, 1.5, "Lower seed should be first");
    assertEquals(teams[1].seed, 3.5, "Higher seed should be second");
  });

  await t.step("skips participants without team assignment", () => {
    const participants = createParticipants(4);
    // Only assign first 2 participants
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
    ]);

    const teams = formTeams(participants, assignments, 2);

    assertEquals(teams.length, 1);
    assertEquals(teams[0].id, "team-1");
  });
});

Deno.test("validateTeamAssignments", async (t) => {
  await t.step("returns valid for complete teams", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const result = validateTeamAssignments(participants, assignments, 2);

    assertEquals(result.valid, true);
    assertEquals(result.errors.length, 0);
    assertEquals(result.teamCount, 2);
    assertEquals(result.completeTeams, 2);
  });

  await t.step("returns errors for unassigned participants", () => {
    const participants = createParticipants(4);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
      // player-3 and player-4 not assigned
    ]);

    const result = validateTeamAssignments(participants, assignments, 2);

    assertEquals(result.valid, false);
    assert(result.errors.length >= 2, "Should have errors for unassigned participants");
    assert(result.errors.some(e => e.includes("Player 3")), "Should mention Player 3");
  });

  await t.step("returns errors for wrong team size", () => {
    const participants = createParticipants(3);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
      ["player-3", "team-2"], // Only 1 member, needs 2
    ]);

    const result = validateTeamAssignments(participants, assignments, 2);

    assertEquals(result.valid, false);
    assert(result.errors.some(e => e.includes("team-2")), "Should mention incomplete team");
    assertEquals(result.completeTeams, 1);
  });

  await t.step("handles teams of size 3", () => {
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

    assertEquals(result.valid, true);
    assertEquals(result.completeTeams, 2);
  });
});

Deno.test("autoAssignTeams", async (t) => {
  await t.step("assigns all participants to teams", () => {
    const participants = createParticipants(4);

    const assignments = autoAssignTeams(participants, 2);

    // All participants should be assigned
    assertEquals(assignments.size, 4);
    for (const p of participants) {
      assert(assignments.has(p.id), `${p.id} should have assignment`);
    }
  });

  await t.step("creates teams of correct size", () => {
    const participants = createParticipants(4);

    const assignments = autoAssignTeams(participants, 2);

    // Count members per team
    const teamCounts = new Map();
    for (const teamId of assignments.values()) {
      teamCounts.set(teamId, (teamCounts.get(teamId) || 0) + 1);
    }

    // Each team should have 2 members
    for (const [teamId, count] of teamCounts) {
      assertEquals(count, 2, `${teamId} should have 2 members`);
    }
  });

  await t.step("returns Map of participantId to teamId", () => {
    const participants = createParticipants(4);

    const assignments = autoAssignTeams(participants, 2);

    assert(assignments instanceof Map, "Should return Map");
    const firstValue = assignments.values().next().value;
    assert(typeof firstValue === "string", "Values should be team IDs (strings)");
    assert(firstValue.startsWith("team-"), "Team IDs should start with 'team-'");
  });

  await t.step("handles odd number of participants", () => {
    const participants = createParticipants(5);

    const assignments = autoAssignTeams(participants, 2);

    // All 5 should be assigned (one team will be incomplete)
    assertEquals(assignments.size, 5);
  });
});

Deno.test("generateDoublesTournament", async (t) => {
  await t.step("throws for less than 2 complete teams", () => {
    const participants = createParticipants(2);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"], // Only 1 team
    ]);

    assertThrows(
      () => generateDoublesTournament(participants, assignments),
      Error,
      "Need at least 2 complete teams"
    );
  });

  await t.step("generates tournament with type 'doubles'", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const tournament = generateDoublesTournament(participants, assignments);

    assertEquals(tournament.type, "doubles");
  });

  await t.step("includes teams array", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const tournament = generateDoublesTournament(participants, assignments);

    assert(Array.isArray(tournament.teams), "Should have teams array");
    assertEquals(tournament.teams.length, 2);
  });

  await t.step("uses single elimination by default", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const tournament = generateDoublesTournament(participants, assignments);

    assertEquals(tournament.bracketType, "single");
  });

  await t.step("can use double elimination", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const tournament = generateDoublesTournament(participants, assignments, {
      bracketType: "double",
    });

    assertEquals(tournament.bracketType, "double");
    assert(tournament.winners !== undefined, "Should have winners bracket");
    assert(tournament.losers !== undefined, "Should have losers bracket");
  });

  await t.step("stores team assignments in tournament", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);

    const tournament = generateDoublesTournament(participants, assignments);

    assert(Array.isArray(tournament.teamAssignments), "Should store team assignments");
    assertEquals(tournament.teamAssignments.length, 4);
  });

  await t.step("configurable team size", () => {
    const participants = createParticipants(6);
    const assignments = new Map([
      ["player-1", "team-1"],
      ["player-2", "team-1"],
      ["player-3", "team-1"],
      ["player-4", "team-2"],
      ["player-5", "team-2"],
      ["player-6", "team-2"],
    ]);

    const tournament = generateDoublesTournament(participants, assignments, {
      teamSize: 3,
    });

    assertEquals(tournament.teamSize, 3);
    assertEquals(tournament.teams.length, 2);
    assertEquals(tournament.teams[0].members.length, 3);
  });
});

Deno.test("recordMatchResult (doubles)", async (t) => {
  await t.step("delegates to single elimination logic", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);
    const tournament = generateDoublesTournament(participants, assignments, {
      bracketType: "single",
    });

    const matchId = Array.from(tournament.matches.keys())[0];
    const match = tournament.matches.get(matchId);
    const winnerId = match.participants[0];

    recordMatchResult(tournament, matchId, [2, 0], winnerId, winnerId);
    assertEquals(tournament.matches.get(matchId).winnerId, winnerId);
  });

  await t.step("delegates to double elimination logic", () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);
    const tournament = generateDoublesTournament(participants, assignments, {
      bracketType: "double",
    });

    const match = tournament.winners.rounds[0].matches[0];
    const winnerId = match.participants[0];

    recordMatchResult(tournament, match.id, [2, 1], winnerId, winnerId);
    assertEquals(tournament.matches.get(match.id).winnerId, winnerId);
  });
});

Deno.test("getStandings (doubles)", async (t) => {
  await t.step("single elimination returns team info", async () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);
    const tournament = generateDoublesTournament(participants, assignments, {
      bracketType: "single",
    });

    const matchId = Array.from(tournament.matches.keys())[0];
    const match = tournament.matches.get(matchId);
    const winnerId = match.participants[0];

    recordMatchResult(tournament, matchId, [2, 0], winnerId, winnerId);

    const standings = await getStandings(tournament);
    assert(standings.length >= 1, "should include champion");
    assert(standings[0].team, "standings should include team info");
  });

  await t.step("double elimination returns team info", async () => {
    const participants = createParticipants(4);
    const assignments = createTeamAssignments(participants, 2);
    const tournament = generateDoublesTournament(participants, assignments, {
      bracketType: "double",
    });

    const [teamA, teamB] = tournament.teams;
    tournament.grandFinals.match.participants = [teamA.id, teamB.id];
    tournament.grandFinals.match.winnerId = teamA.id;
    tournament.isComplete = true;

    const standings = await getStandings(tournament);
    assert(standings.length >= 2, "should include champion and runner-up");
    assertEquals(standings[0].participantId, teamA.id);
    assert(standings[0].team, "standings should include team info");
  });
});
