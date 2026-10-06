/**
 * Tests for multi-tournament history feature
 */

import { assertEquals, assert, assertExists } from "jsr:@std/assert";
import { Store } from "../js/state/store.js";
import {
  generateSingleEliminationBracket,
  advance as advanceSingle,
} from "../js/tournament/single-elimination.js";
import {
  generateDoubleEliminationBracket,
  advance as advanceDouble,
} from "../js/tournament/double-elimination.js";
import {
  generateMarioKartTournament,
  recordRaceResult,
} from "../js/tournament/mario-kart.js";
import { generateDoublesTournament } from "../js/tournament/doubles.js";
import { createParticipants, createTeamAssignments, report } from "./fixtures.js";

const historyEntry = (id, completedAt = 1000) => ({
  id,
  name: id,
  type: "single",
  winner: { id: "p1", name: "W" },
  standings: [],
  participantCount: 4,
  completedAt,
});

/**
 * Setup complete single-elim tournament (4 players)
 * @returns {Store} Store with completed single elimination tournament
 */
function createCompleteSingleElimTournament() {
  const store = new Store();
  const participants = createParticipants(4);
  participants.forEach((p) => store.addParticipant(p));

  const tournament = generateSingleEliminationBracket(
    store.getParticipantList()
  );

  // Play all matches: semi-finals then finals
  // R1M0: player-1 vs player-4 -> player-1 wins
  report(tournament, advanceSingle, "r1m0", "player-1");
  // R1M1: player-2 vs player-3 -> player-2 wins
  report(tournament, advanceSingle, "r1m1", "player-2");
  // R2M0: player-1 vs player-2 -> player-1 wins finals
  report(tournament, advanceSingle, "r2m0", "player-1", [2, 1]);

  store.setMatches(tournament.matches);
  store.set("bracket", tournament.bracket);
  store.set("meta.status", "complete");
  store.set("meta.type", "single");
  store.set("meta.name", "Test Tournament");

  return store;
}

/**
 * Setup complete double-elim tournament (4 players)
 * @param {boolean} resetNeeded - Whether losers champ wins GF1 requiring reset
 * @returns {Store} Store with completed double elimination tournament
 */
function createCompleteDoubleElimTournament(resetNeeded = false) {
  const store = new Store();
  const participants = createParticipants(4);
  participants.forEach((p) => store.addParticipant(p));

  const tournament = generateDoubleEliminationBracket(
    store.getParticipantList()
  );

  // Winners bracket
  // W1M0: player-1 vs player-4 -> player-1 wins
  report(tournament, advanceDouble, "w1m0", "player-1");
  // W1M1: player-2 vs player-3 -> player-2 wins
  report(tournament, advanceDouble, "w1m1", "player-2");
  // W2M0 (Winners Finals): player-1 vs player-2 -> player-1 wins
  report(tournament, advanceDouble, "w2m0", "player-1", [2, 1]);

  // Losers bracket
  // L1M0: player-4 vs player-3 -> player-3 wins
  report(tournament, advanceDouble, "l1m0", "player-3", [2, 1]);
  // L2M0 (Losers Finals): player-3 vs player-2 (dropped from WF) -> player-2 wins
  report(tournament, advanceDouble, "l2m0", "player-2");

  // Grand Finals
  if (resetNeeded) {
    // GF1: player-1 (winners) vs player-2 (losers) -> player-2 wins
    report(tournament, advanceDouble, "gf1", "player-2", [1, 2]);
    // GF2 (Reset): player-1 vs player-2 -> player-2 wins overall
    report(tournament, advanceDouble, "gf2", "player-2", [1, 2]);
  } else {
    // GF1: player-1 (winners) vs player-2 (losers) -> player-1 wins
    report(tournament, advanceDouble, "gf1", "player-1", [2, 1]);
  }

  store.setMatches(tournament.matches);
  store.set("bracket", tournament.bracket);
  store.set("meta.status", "complete");
  store.set("meta.type", "double");
  store.set("meta.name", "Double Elim Tournament");

  return store;
}

/**
 * Setup complete Mario Kart tournament
 * @returns {Store} Store with completed Mario Kart tournament
 */
function createCompleteMarioKartTournament() {
  const store = new Store();
  const participants = createParticipants(4);
  participants.forEach((p) => store.addParticipant(p));

  const tournament = generateMarioKartTournament(participants, {
    playersPerGame: 4,
    gamesPerPlayer: 1,
  });

  // Record race result: player-1 wins, player-2 second, etc.
  recordRaceResult(
    tournament,
    "game1",
    [
      { participantId: "player-1" },
      { participantId: "player-2" },
      { participantId: "player-3" },
      { participantId: "player-4" },
    ],
    "player-1"
  );

  const { matches, standings, ...race } = tournament;
  store.set("bracket", race);
  store.deserialize({
    matches: Array.from(matches.entries()),
    standings: Array.from(standings.entries()),
  });
  store.set("meta.status", "complete");
  store.set("meta.type", "mariokart");
  store.set("meta.name", "Mario Kart GP");

  return store;
}

/**
 * Setup complete doubles tournament (4 players = 2 teams)
 * @param {string} bracketType - 'single' or 'double'
 * @returns {Store} Store with completed doubles tournament
 */
function createCompleteDoublesTournament(bracketType = "single") {
  const store = new Store();
  const participants = createParticipants(4);
  participants.forEach((p) => store.addParticipant(p));

  const teamAssignments = createTeamAssignments(participants, 2);
  // team-1: player-1, player-2
  // team-2: player-3, player-4

  const tournament = generateDoublesTournament(
    store.getParticipantList(),
    teamAssignments,
    { teamSize: 2, bracketType }
  );

  // Play finals: team-1 vs team-2 -> team-1 wins
  const teamId1 = "team-1";

  if (bracketType === "double") {
    // Double elim doubles - play through bracket
    report(tournament, advanceDouble, "w1m0", teamId1);
    // Grand finals
    report(tournament, advanceDouble, "gf1", teamId1);
  } else {
    // Single elim finals
    report(tournament, advanceSingle, "r1m0", teamId1);
  }

  store.setMatches(tournament.matches);
  store.set("bracket", tournament.bracket);
  // Set teamAssignments in store
  for (const [participantId, teamId] of teamAssignments) {
    store.setTeamAssignment(participantId, teamId);
  }
  store.set("meta.status", "complete");
  store.set("meta.type", "doubles");
  store.set("meta.name", "Doubles Tournament");

  return store;
}

Deno.test("archiveTournament - Single Elimination", async (t) => {
  await t.step("creates history entry with winner from finals", () => {
    const store = createCompleteSingleElimTournament();

    const entry = store.archiveTournament();

    assertExists(entry, "Should create history entry");
    assertEquals(entry.winner.id, "player-1");
    assertEquals(entry.winner.name, "Player 1");
  });

  await t.step("extracts top 4 standings from bracket", () => {
    const store = createCompleteSingleElimTournament();

    const entry = store.archiveTournament();

    assert(entry.standings.length >= 2, "Should have at least 2 standings");
    assertEquals(entry.standings[0].place, 1);
    assertEquals(entry.standings[0].name, "Player 1");
    assertEquals(entry.standings[1].place, 2);
    assertEquals(entry.standings[1].name, "Player 2");
  });

  await t.step(
    "includes correct metadata (type, participantCount, completedAt)",
    () => {
      const store = createCompleteSingleElimTournament();
      const before = Date.now();

      const entry = store.archiveTournament();

      assertEquals(entry.type, "single");
      assertEquals(entry.participantCount, 4);
      assertEquals(entry.name, "Test Tournament");
      assert(entry.completedAt >= before, "completedAt should be recent");
    }
  );

  await t.step("generates unique id", () => {
    const store = createCompleteSingleElimTournament();

    const entry = store.archiveTournament();

    assertExists(entry.id, "Should have an id");
    assert(entry.id.length > 0, "ID should not be empty");
  });
});

Deno.test("archiveTournament - Double Elimination", async (t) => {
  await t.step("extracts winner from grand finals (no reset needed)", () => {
    const store = createCompleteDoubleElimTournament(false);

    const entry = store.archiveTournament();

    assertExists(entry, "Should create history entry");
    assertEquals(entry.winner.id, "player-1");
    assertEquals(entry.winner.name, "Player 1");
    assertEquals(entry.type, "double");
  });

  await t.step("extracts winner from grand finals reset when played", () => {
    const store = createCompleteDoubleElimTournament(true);

    const entry = store.archiveTournament();

    assertExists(entry, "Should create history entry");
    // player-2 won the reset
    assertEquals(entry.winner.id, "player-2");
    assertEquals(entry.winner.name, "Player 2");
  });

  await t.step("includes correct type and every place", () => {
    const store = createCompleteDoubleElimTournament(false);

    const entry = store.archiveTournament();

    assertEquals(entry.type, "double");
    assertEquals(entry.standings.map((s) => [s.place, s.name]), [
      [1, "Player 1"],
      [2, "Player 2"],
      [3, "Player 3"],
      [4, "Player 4"],
    ]);
  });
});

Deno.test("archiveTournament - Mario Kart", async (t) => {
  await t.step("extracts winner from standings (highest points)", () => {
    const store = createCompleteMarioKartTournament();

    const entry = store.archiveTournament();

    assertExists(entry, "Should create history entry");
    assertEquals(entry.winner.id, "player-1");
    assertEquals(entry.winner.name, "Player 1");
    assertEquals(entry.type, "mariokart");
  });

  await t.step("includes top 4 standings with points", () => {
    const store = createCompleteMarioKartTournament();

    const entry = store.archiveTournament();

    assert(entry.standings.length >= 1, "Should have standings");
    assertEquals(entry.standings[0].place, 1);
    assertEquals(entry.standings[0].name, "Player 1");
    assertExists(entry.standings[0].points, "Standings should include points");
  });

  await t.step("breaks a points tie on wins, like the results card", () => {
    const store = new Store();
    const participants = createParticipants(2);
    participants.forEach((p) => store.addParticipant(p));

    const standings = new Map([
      ["player-1", { participantId: "player-1", name: "Player 1", points: 10, wins: 0, gamesCompleted: 2 }],
      ["player-2", { participantId: "player-2", name: "Player 2", points: 10, wins: 1, gamesCompleted: 2 }],
    ]);

    store.deserialize({ standings: Array.from(standings.entries()) });
    store.set("meta.status", "complete");
    store.set("meta.type", "mariokart");

    const entry = store.archiveTournament();

    assertEquals(entry.winner.id, "player-2");
    assertEquals(entry.standings.map((s) => s.name), ["Player 2", "Player 1"]);
  });
});

Deno.test("archiveTournament - Doubles", async (t) => {
  await t.step("extracts winning team from finals", () => {
    const store = createCompleteDoublesTournament("single");

    const entry = store.archiveTournament();

    assertExists(entry, "Should create history entry");
    assertExists(entry.winner, "Should have winner");
    assertEquals(entry.winner.id, "team-1");
    assertEquals(entry.type, "doubles");
  });

  await t.step("includes team info in winner (id, name, members)", () => {
    const store = createCompleteDoublesTournament("single");

    const entry = store.archiveTournament();

    assertExists(entry.winner.team, "Winner should have team info");
    assertEquals(entry.winner.team.id, "team-1");
    assertExists(entry.winner.team.name, "Team should have name");
    assertExists(entry.winner.team.members, "Team should have members");
  });

  await t.step("handles double-elim doubles (grand finals)", () => {
    const store = createCompleteDoublesTournament("double");

    const entry = store.archiveTournament();

    assertExists(entry, "Should create history entry");
    assertEquals(entry.type, "doubles");
    assertEquals(entry.winner.id, "team-1");
  });

  await t.step("archives with no winner when the bracket cannot be ranked", () => {
    const store = createCompleteDoublesTournament("single");
    store.set("bracket", { type: "doubles", rounds: [] });

    const entry = store.archiveTournament();

    assertExists(entry, "A malformed bracket must not block archiving");
    assertEquals(entry.winner, null);
    assertEquals(entry.standings, []);
  });
});

Deno.test("getHistory", async (t) => {
  await t.step("returns empty array initially", () => {
    const store = new Store();

    const history = store.getHistory();

    assertEquals(history, []);
    assertEquals(history.length, 0);
  });

  await t.step("returns archived tournaments in order", () => {
    const store = createCompleteSingleElimTournament();

    // Archive first tournament
    const entry1 = store.archiveTournament();

    // Reset and set up another complete tournament
    store.resetForNewTournament();
    store.set("meta.type", "single");
    store.set("meta.name", "Tournament 2");

    const tournament = generateSingleEliminationBracket(
      store.getParticipantList()
    );
    report(tournament, advanceSingle, "r1m0", "player-1");
    report(tournament, advanceSingle, "r1m1", "player-2");
    report(tournament, advanceSingle, "r2m0", "player-2");
    store.setMatches(tournament.matches);
    store.set("bracket", tournament.bracket);
    store.set("meta.status", "complete");

    const entry2 = store.archiveTournament();

    const history = store.getHistory();

    assertEquals(history.length, 2);
    assertEquals(history[0].id, entry1.id);
    assertEquals(history[1].id, entry2.id);
  });
});

Deno.test("resetForNewTournament", async (t) => {
  await t.step("sets status to lobby", () => {
    const store = createCompleteSingleElimTournament();

    store.resetForNewTournament();

    assertEquals(store.get("meta.status"), "lobby");
  });

  await t.step("clears bracket", () => {
    const store = createCompleteSingleElimTournament();

    store.resetForNewTournament();

    assertEquals(store.get("bracket"), null);
  });

  await t.step("clears matches", () => {
    const store = createCompleteSingleElimTournament();

    store.resetForNewTournament();

    const matches = store.get("matches");
    assertEquals(matches.size, 0);
  });

  await t.step("clears standings", () => {
    const store = createCompleteMarioKartTournament();

    store.resetForNewTournament();

    const standings = store.get("standings");
    assertEquals(standings.size, 0);
  });

  await t.step("clears teamAssignments", () => {
    const store = createCompleteDoublesTournament();

    store.resetForNewTournament();

    const teamAssignments = store.getTeamAssignments();
    assertEquals(teamAssignments.size, 0);
  });

  await t.step("preserves participants", () => {
    const store = createCompleteSingleElimTournament();
    const countBefore = store.getParticipantList().length;

    store.resetForNewTournament();

    const countAfter = store.getParticipantList().length;
    assertEquals(countAfter, countBefore);
    assertEquals(countAfter, 4);
  });

  await t.step("preserves history", () => {
    const store = createCompleteSingleElimTournament();
    store.archiveTournament();

    store.resetForNewTournament();

    const history = store.getHistory();
    assertEquals(history.length, 1);
  });
});

Deno.test("History Serialization", async (t) => {
  await t.step("history array included in serialize() output", () => {
    const store = createCompleteSingleElimTournament();
    store.archiveTournament();

    const serialized = store.serialize();

    assertExists(serialized.history, "Serialized should have history");
    assert(Array.isArray(serialized.history), "History should be an array");
    assertEquals(serialized.history.length, 1);
  });

  await t.step("history array restored from deserialize()", () => {
    const store = new Store();
    store.deserialize({ history: [historyEntry("test-1")] });

    const history = store.getHistory();
    assertEquals(history.length, 1);
    assertEquals(history[0].id, "test-1");
    assertEquals(history[0].name, "test-1");
  });

  await t.step("history survives full roundtrip", () => {
    const store1 = createCompleteSingleElimTournament();
    const entry = store1.archiveTournament();

    const store2 = new Store();
    store2.deserialize(store1.serialize());

    const history = store2.getHistory();
    assertEquals(history.length, 1);
    assertEquals(history[0].id, entry.id);
    assertEquals(history[0].winner.id, entry.winner.id);
    assertEquals(history[0].type, entry.type);
  });
});

Deno.test("History Merge", async (t) => {
  await t.step("adds new history entries from remote (union merge)", () => {
    const store = new Store();
    store.deserialize({ history: [historyEntry("local-1")] });

    store.merge({ history: [historyEntry("remote-1", 2000)] }, null);

    assertEquals(store.getHistory().length, 2);
  });

  await t.step("deduplicates entries by id", () => {
    const store = new Store();
    store.deserialize({ history: [historyEntry("same-id")] });

    store.merge({ history: [historyEntry("same-id")] }, null);

    assertEquals(store.getHistory().length, 1, "Should not duplicate entries with same id");
  });

  await t.step("preserves local history entries", () => {
    const store = new Store();
    store.deserialize({ history: [historyEntry("local-1")] });

    store.merge({ history: [] }, null);

    const history = store.getHistory();
    assertEquals(history.length, 1);
    assertEquals(history[0].id, "local-1");
  });
});
