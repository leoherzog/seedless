/**
 * Team formation and run-to-completion for doubles brackets.
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  formTeams,
  generateDoublesTournament,
  recordMatchResult,
  getStandings,
} from "../js/tournament/doubles.js";
import { nextPowerOf2 } from "../js/tournament/bracket-utils.js";
import { createParticipants, createTeamAssignments, playToCompletion } from "./fixtures.js";

/**
 * Assert that a set of formed teams is internally consistent:
 * every team has exactly `teamSize` members, and no participant appears on
 * more than one team (or twice on the same team).
 */
function assertTeamsWellFormed(teams, teamSize) {
  const seen = new Set();
  for (const team of teams) {
    assertEquals(team.members.length, teamSize, `team ${team.id} should have ${teamSize} members`);
    for (const member of team.members) {
      assert(!seen.has(member.id), `${member.id} should not appear on more than one team`);
      seen.add(member.id);
    }
  }
  return seen;
}

/**
 * Standings invariants shared by both bracket types: complete coverage of
 * every team, sequential places with no gaps/duplicates, and the champion
 * matching the recorded finals winner.
 */
function assertStandingsInvariants(standings, teams, championId) {
  assertEquals(standings.length, teams.length, "standings should cover every team");
  assertEquals(standings[0].place, 1, "first standing should be place 1");
  assertEquals(standings[0].participantId, championId, "place 1 should be the champion team");
  assert(standings[0].team, "champion standing should include team info");
  assertEquals(standings[0].team.id, championId, "champion standing's team should match winner id");

  for (let i = 0; i < standings.length; i++) {
    assertEquals(standings[i].place, i + 1, `place at index ${i} should be ${i + 1}`);
  }

  const ids = standings.map((s) => s.participantId);
  assertEquals(new Set(ids).size, ids.length, "no duplicate teams in standings");

  const expectedIds = new Set(teams.map((t) => t.id));
  assertEquals(new Set(ids), expectedIds, "standings should be exactly the formed team set");
}

const EVEN_COUNTS = [4, 6, 8, 16];
const ODD_COUNTS = [5, 7, 9];

Deno.test("Doubles - team formation is correct for even participant counts", async (t) => {
  for (const n of EVEN_COUNTS) {
    await t.step(`N=${n}: forms ${n / 2} complete teams of 2, everyone assigned exactly once`, () => {
      const participants = createParticipants(n);
      const assignments = createTeamAssignments(participants, 2);

      const teams = formTeams(participants, assignments, 2);

      assertEquals(teams.length, n / 2, "expected number of complete teams");
      const seen = assertTeamsWellFormed(teams, 2);
      assertEquals(seen.size, n, "every participant should be assigned to exactly one team");

      const expectedIds = new Set(participants.map((p) => p.id));
      assertEquals(seen, expectedIds, "formed teams should cover the entire participant set");
    });
  }
});

Deno.test("Doubles - odd participant counts leave the leftover player unassigned", async (t) => {
  for (const n of ODD_COUNTS) {
    await t.step(`N=${n}: forms ${Math.floor(n / 2)} complete teams, leftover player excluded`, () => {
      const participants = createParticipants(n);
      const assignments = createTeamAssignments(participants, 2);

      const teams = formTeams(participants, assignments, 2);
      const expectedCompleteTeams = Math.floor(n / 2);

      assertEquals(teams.length, expectedCompleteTeams, "expected number of complete teams");
      const seen = assertTeamsWellFormed(teams, 2);
      assertEquals(seen.size, expectedCompleteTeams * 2, "only fully-paired participants should be assigned");

      // The last-created participant is the one left without a partner
      // (createTeamAssignments pairs sequentially, so an odd remainder is
      // always the final participant).
      const leftoverId = `player-${n}`;
      assert(!seen.has(leftoverId), `leftover participant ${leftoverId} should not be on any team`);
    });
  }
});

Deno.test("Doubles - single elimination run to completion (even participant counts)", async (t) => {
  for (const n of EVEN_COUNTS) {
    await t.step(`N=${n}: bracket generates and completes with one champion team`, () => {
      const participants = createParticipants(n);
      const assignments = createTeamAssignments(participants, 2);

      const tournament = generateDoublesTournament(participants, assignments, {
        teamSize: 2,
        bracketType: "single",
      });

      const expectedTeamCount = n / 2;
      const expectedBracketSize = nextPowerOf2(expectedTeamCount);
      const expectedNumRounds = Math.log2(expectedBracketSize);

      assertEquals(tournament.type, "doubles");
      assertEquals(tournament.bracketType, "single");
      assertEquals(tournament.teams.length, expectedTeamCount, "team bracket should use every complete team");
      assertEquals(tournament.bracketSize, expectedBracketSize, "team bracket size");
      assertEquals(tournament.numRounds, expectedNumRounds, "team bracket rounds");
      assertEquals(tournament.rounds.length, expectedNumRounds);

      const finalRound = tournament.rounds[tournament.rounds.length - 1];
      assertEquals(finalRound.matches.length, 1, "final round should have exactly one match");

      playToCompletion(tournament, recordMatchResult);

      assert(tournament.isComplete, "doubles tournament should report complete");
      const finals = finalRound.matches[0];
      assert(finals.winnerId, "finals match must have a winning team");

      const teamIds = new Set(tournament.teams.map((t) => t.id));
      assert(teamIds.has(finals.winnerId), "champion must be one of the formed teams");

      const standings = getStandings(tournament);
      assertStandingsInvariants(standings, tournament.teams, finals.winnerId);
    });
  }
});

Deno.test("Doubles - single elimination run to completion (odd participant counts)", async (t) => {
  for (const n of ODD_COUNTS) {
    await t.step(`N=${n}: leftover player excluded, remaining teams complete the bracket`, () => {
      const participants = createParticipants(n);
      const assignments = createTeamAssignments(participants, 2);
      const expectedTeamCount = Math.floor(n / 2);

      const tournament = generateDoublesTournament(participants, assignments, {
        teamSize: 2,
        bracketType: "single",
      });

      assertEquals(tournament.teams.length, expectedTeamCount);

      const leftoverId = `player-${n}`;
      for (const team of tournament.teams) {
        assert(
          !team.members.some((m) => m.id === leftoverId),
          `leftover participant ${leftoverId} should not appear in the generated bracket`
        );
      }

      playToCompletion(tournament, recordMatchResult);

      assert(tournament.isComplete, "doubles tournament should complete despite the excluded leftover player");
      const finalRound = tournament.rounds[tournament.rounds.length - 1];
      const finals = finalRound.matches[0];

      const standings = getStandings(tournament);
      assertStandingsInvariants(standings, tournament.teams, finals.winnerId);
    });
  }
});

Deno.test("Doubles - double elimination run to completion", async (t) => {
  const DOUBLE_ELIM_COUNTS = [6, 8]; // 3 teams (needs a bye) and 4 teams (clean power of 2)

  for (const n of DOUBLE_ELIM_COUNTS) {
    await t.step(`N=${n}: double-elimination team bracket completes with one champion`, () => {
      const participants = createParticipants(n);
      const assignments = createTeamAssignments(participants, 2);

      const tournament = generateDoublesTournament(participants, assignments, {
        teamSize: 2,
        bracketType: "double",
      });

      assertEquals(tournament.type, "doubles");
      assertEquals(tournament.bracketType, "double");
      assertEquals(tournament.teams.length, n / 2);
      assert(tournament.winners, "should have winners bracket");
      assert(tournament.losers, "should have losers bracket");
      assert(tournament.grandFinals, "should have grand finals");

      playToCompletion(tournament, recordMatchResult);

      assert(tournament.isComplete, "double-elimination doubles tournament should complete");

      const championId = tournament.grandFinals.match.winnerId;
      assert(championId, "grand finals should have produced a champion team");
      const teamIds = new Set(tournament.teams.map((t) => t.id));
      assert(teamIds.has(championId), "champion must be one of the formed teams");

      const standings = getStandings(tournament);
      assertStandingsInvariants(standings, tournament.teams, championId);
    });
  }
});
