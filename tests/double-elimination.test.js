/**
 * Tests for double-elimination.js
 */

import { assertEquals, assert, assertThrows } from "jsr:@std/assert";
import {
  generateDoubleEliminationBracket,
  advance,
  getStandings,
} from "../js/tournament/double-elimination.js";
import {
  createParticipants,
  createParticipantMap,
  participants4,
  participants8,
  report,
} from "./fixtures.js";

/** The match objects of a winners or losers round. */
const roundMatches = (matches, round) => round.matchIds.map((id) => matches.get(id));

Deno.test("generateDoubleEliminationBracket", async (t) => {
  await t.step("throws for less than 2 participants", () => {
    assertThrows(
      () => generateDoubleEliminationBracket([{ id: "1", name: "Solo", seed: 1 }]),
      Error,
      "Need at least 2 participants"
    );
  });

  await t.step("generates correct bracket type", () => {
    const { bracket } = generateDoubleEliminationBracket(participants4);
    assertEquals(bracket.type, "double");
  });

  await t.step("generates winners bracket with w prefix", () => {
    const { bracket, matches } = generateDoubleEliminationBracket(participants4);

    for (const round of bracket.winners.rounds) {
      for (const match of roundMatches(matches, round)) {
        assert(match.id.startsWith("w"), `Winners match should start with 'w': ${match.id}`);
        assertEquals(match.bracket, "winners");
      }
    }
  });

  await t.step("generates losers bracket with l prefix", () => {
    const { bracket, matches } = generateDoubleEliminationBracket(participants4);

    for (const round of bracket.losers.rounds) {
      for (const match of roundMatches(matches, round)) {
        assert(match.id.startsWith("l"), `Losers match should start with 'l': ${match.id}`);
        assertEquals(match.bracket, "losers");
      }
    }
  });

  await t.step("generates grand finals matches", () => {
    const { bracket, matches } = generateDoubleEliminationBracket(participants4);

    assertEquals(bracket.grandFinals, ["gf1", "gf2"]);
    assertEquals(matches.get("gf1").bracket, "grandFinals");
    assertEquals(matches.get("gf2").requiresPlay, false);
  });

  await t.step("4-player bracket has correct structure", () => {
    const { bracket } = generateDoubleEliminationBracket(participants4);

    assertEquals(bracket.winners.rounds.map((r) => r.matchIds.length), [2, 1]);
    // Losers: 2 * (2-1) = 2 rounds
    assertEquals(bracket.losers.rounds.length, 2);
  });

  await t.step("8-player bracket has correct structure", () => {
    const { bracket } = generateDoubleEliminationBracket(participants8);

    assertEquals(bracket.winners.rounds.map((r) => r.matchIds.length), [4, 2, 1]);
    // Losers: 2 * (3-1) = 4 rounds
    assertEquals(bracket.losers.rounds.length, 4);
  });

  await t.step("every bracket id is in the matches map exactly once", () => {
    const { bracket, matches } = generateDoubleEliminationBracket(participants8);

    const ids = [...bracket.winners.rounds, ...bracket.losers.rounds]
      .flatMap((r) => r.matchIds)
      .concat(bracket.grandFinals);

    assertEquals(ids.length, matches.size);
    assertEquals(new Set(ids), new Set(matches.keys()));
  });

  await t.step("winners matches have dropsTo property", () => {
    const { bracket, matches } = generateDoubleEliminationBracket(participants4);

    for (const round of bracket.winners.rounds) {
      for (const match of roundMatches(matches, round)) {
        assert(match.dropsTo !== undefined, `Match ${match.id} should have dropsTo`);
      }
    }
  });
});

Deno.test("advance - winners bracket", async (t) => {
  await t.step("advances winner in winners bracket", () => {
    const tournament = generateDoubleEliminationBracket(participants4);

    report(tournament, advance, "w1m0", "player-1");

    assertEquals(tournament.matches.get("w2m0").participants[0], "player-1");
  });

  await t.step("drops loser to losers bracket", () => {
    const tournament = generateDoubleEliminationBracket(participants4);

    // player-4 loses w1m0.
    report(tournament, advance, "w1m0", "player-1");

    const losers = tournament.bracket.losers.rounds.flatMap((r) => roundMatches(tournament.matches, r));
    assert(losers.some((m) => m.participants.includes("player-4")), "Loser should be placed in losers bracket");
  });

  await t.step("winners finals winner goes to grand finals", () => {
    const tournament = generateDoubleEliminationBracket(participants4);

    report(tournament, advance, "w1m0", "player-1");
    report(tournament, advance, "w1m1", "player-2");
    report(tournament, advance, "w2m0", "player-1");

    // GF slot 0 holds the winners champion.
    assertEquals(tournament.matches.get("gf1").participants[0], "player-1");
  });

  await t.step("writes new participants arrays through the update callback", () => {
    const tournament = generateDoubleEliminationBracket(participants4);
    const before = tournament.matches.get("w2m0").participants;
    const written = [];

    tournament.matches.get("w1m0").winnerId = "player-1";
    advance(tournament, "w1m0", (id, fields) => {
      written.push(id);
      Object.assign(tournament.matches.get(id), fields);
    });

    assertEquals(written, ["w2m0", "l1m0"]);
    assertEquals(before, [null, null], "the existing array is never mutated");
  });
});

Deno.test("advance - losers bracket", async (t) => {
  await t.step("minor round winner advances to next round slot 0", () => {
    const tournament = generateDoubleEliminationBracket(participants4);
    const minorMatch = roundMatches(tournament.matches, tournament.bracket.losers.rounds[0])[0];

    minorMatch.participants = ["player-1", "player-2"];
    report(tournament, advance, minorMatch.id, "player-1");

    const nextMatch = roundMatches(tournament.matches, tournament.bracket.losers.rounds[1])[0];
    assertEquals(nextMatch.participants[0], "player-1");
  });

  await t.step("losers finals winner advances to grand finals slot 1", () => {
    const tournament = generateDoubleEliminationBracket(participants4);
    const finalMatch = roundMatches(tournament.matches, tournament.bracket.losers.rounds.at(-1))[0];

    finalMatch.participants = ["player-1", "player-2"];
    report(tournament, advance, finalMatch.id, "player-1");

    assertEquals(tournament.matches.get("gf1").participants[1], "player-1");
  });
});

Deno.test("advance - grand finals", async (t) => {
  function setupToGrandFinals() {
    const tournament = generateDoubleEliminationBracket(participants4);

    report(tournament, advance, "w1m0", "player-1");
    report(tournament, advance, "w1m1", "player-2");
    report(tournament, advance, "w2m0", "player-1");

    for (const round of tournament.bracket.losers.rounds) {
      for (const match of roundMatches(tournament.matches, round)) {
        const [a, b] = match.participants;
        if (a && b && !match.winnerId) report(tournament, advance, match.id, a);
      }
    }

    return tournament;
  }

  await t.step("winners champ winning GF1 completes tournament", () => {
    const tournament = setupToGrandFinals();
    const winnersChamp = tournament.matches.get("gf1").participants[0];

    assert(report(tournament, advance, "gf1", winnersChamp), "Tournament should be complete");
    assertEquals(tournament.matches.get("gf2").requiresPlay, false, "No bracket reset needed");
  });

  await t.step("losers champ winning GF1 triggers bracket reset", () => {
    const tournament = setupToGrandFinals();
    const [winnersChamp, losersChamp] = tournament.matches.get("gf1").participants;

    assertEquals(report(tournament, advance, "gf1", losersChamp), false, "Tournament should not be complete yet");

    const reset = tournament.matches.get("gf2");
    assertEquals(reset.requiresPlay, true, "Bracket reset should be required");
    assertEquals(reset.participants, [winnersChamp, losersChamp]);
  });

  await t.step("GF2 (bracket reset) winner is champion", () => {
    const tournament = setupToGrandFinals();
    const [winnersChamp, losersChamp] = tournament.matches.get("gf1").participants;

    report(tournament, advance, "gf1", losersChamp);

    assert(report(tournament, advance, "gf2", winnersChamp), "Tournament should be complete after reset");
  });
});

Deno.test("getStandings", async (t) => {
  await t.step("returns empty array if not complete", () => {
    const { bracket, matches } = generateDoubleEliminationBracket(participants4);
    const participantMap = createParticipantMap(participants4);

    assertEquals(getStandings(bracket, matches, participantMap), []);
  });

  await t.step("places losers-bracket eliminations below the finalists", () => {
    const tournament = generateDoubleEliminationBracket(participants4);
    const participantMap = createParticipantMap(participants4);

    report(tournament, advance, "w1m0", "player-1");
    report(tournament, advance, "w1m1", "player-2");
    report(tournament, advance, "w2m0", "player-1");
    report(tournament, advance, "l1m0", "player-3"); // player-4 out
    report(tournament, advance, "l2m0", "player-2"); // player-3 out
    report(tournament, advance, "gf1", "player-1");

    const standings = getStandings(tournament.bracket, tournament.matches, participantMap);
    assertEquals(standings.map((s) => [s.place, s.participantId]), [
      [1, "player-1"],
      [2, "player-2"],
      [3, "player-3"],
      [4, "player-4"],
    ]);
  });
});

Deno.test("bye handling in double elimination", async (t) => {
  await t.step("3-player bracket handles byes correctly", () => {
    const { bracket, matches } = generateDoubleEliminationBracket(createParticipants(3));

    const byeMatch = roundMatches(matches, bracket.winners.rounds[0]).find((m) => m.isBye);

    assert(byeMatch !== undefined, "Should have a bye match");
    assert(byeMatch.winnerId !== null, "Bye winner should be set");

    const hasAdvanced = roundMatches(matches, bracket.winners.rounds[1])
      .some((m) => m.participants.includes(byeMatch.winnerId));
    assert(hasAdvanced, "Bye winner should advance to next round");
  });
});
