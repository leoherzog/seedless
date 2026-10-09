/**
 * Tests for tournament history: archiving each format, reset, serialization and merge.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
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

  // Seeds 1v4 and 2v3 in the semis, then player-1 beats player-2.
  report(tournament, advanceSingle, "r1m0", "player-1");
  report(tournament, advanceSingle, "r1m1", "player-2");
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

  report(tournament, advanceDouble, "w1m0", "player-1");
  report(tournament, advanceDouble, "w1m1", "player-2");
  report(tournament, advanceDouble, "w2m0", "player-1", [2, 1]);

  // player-2 drops from the winners final and beats player-3 in the losers final.
  report(tournament, advanceDouble, "l1m0", "player-3", [2, 1]);
  report(tournament, advanceDouble, "l2m0", "player-2");

  if (resetNeeded) {
    report(tournament, advanceDouble, "gf1", "player-2", [1, 2]);
    report(tournament, advanceDouble, "gf2", "player-2", [1, 2]);
  } else {
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

  // team-1 is player-1 and player-2; team-2 is player-3 and player-4.
  const teamAssignments = createTeamAssignments(participants, 2);

  const tournament = generateDoublesTournament(
    store.getParticipantList(),
    teamAssignments,
    { teamSize: 2, bracketType }
  );

  const teamId1 = "team-1";

  if (bracketType === "double") {
    report(tournament, advanceDouble, "w1m0", teamId1);
    report(tournament, advanceDouble, "gf1", teamId1);
  } else {
    report(tournament, advanceSingle, "r1m0", teamId1);
  }

  store.setMatches(tournament.matches);
  store.set("bracket", tournament.bracket);
  for (const [participantId, teamId] of teamAssignments) {
    store.setTeamAssignment(participantId, teamId);
  }
  store.set("meta.status", "complete");
  store.set("meta.type", "doubles");
  store.set("meta.name", "Doubles Tournament");

  return store;
}

test("archiveTournament - Single Elimination", async (t) => {
  await t.test("creates history entry with winner from finals", () => {
    const store = createCompleteSingleElimTournament();

    const entry = store.archiveTournament();

    assert.ok(entry != null, "Should create history entry");
    assert.deepStrictEqual(entry.winner.id, "player-1");
    assert.deepStrictEqual(entry.winner.name, "Player 1");
  });

  await t.test("extracts top 4 standings from bracket", () => {
    const store = createCompleteSingleElimTournament();

    const entry = store.archiveTournament();

    assert(entry.standings.length >= 2, "Should have at least 2 standings");
    assert.deepStrictEqual(entry.standings[0].place, 1);
    assert.deepStrictEqual(entry.standings[0].name, "Player 1");
    assert.deepStrictEqual(entry.standings[1].place, 2);
    assert.deepStrictEqual(entry.standings[1].name, "Player 2");
  });

  await t.test(
    "includes correct metadata (type, participantCount, completedAt)",
    () => {
      const store = createCompleteSingleElimTournament();
      const before = Date.now();

      const entry = store.archiveTournament();

      assert.deepStrictEqual(entry.type, "single");
      assert.deepStrictEqual(entry.participantCount, 4);
      assert.deepStrictEqual(entry.name, "Test Tournament");
      assert(entry.completedAt >= before, "completedAt should be recent");
    }
  );

  await t.test("generates unique id", () => {
    const store = createCompleteSingleElimTournament();

    const entry = store.archiveTournament();

    assert.ok(entry.id != null, "Should have an id");
    assert(entry.id.length > 0, "ID should not be empty");
  });
});

test("archiveTournament - Double Elimination", async (t) => {
  await t.test("extracts winner from grand finals (no reset needed)", () => {
    const store = createCompleteDoubleElimTournament(false);

    const entry = store.archiveTournament();

    assert.ok(entry != null, "Should create history entry");
    assert.deepStrictEqual(entry.winner.id, "player-1");
    assert.deepStrictEqual(entry.winner.name, "Player 1");
    assert.deepStrictEqual(entry.type, "double");
  });

  await t.test("extracts winner from grand finals reset when played", () => {
    const store = createCompleteDoubleElimTournament(true);

    const entry = store.archiveTournament();

    assert.ok(entry != null, "Should create history entry");
    assert.deepStrictEqual(entry.winner.id, "player-2");
    assert.deepStrictEqual(entry.winner.name, "Player 2");
  });

  await t.test("includes correct type and every place", () => {
    const store = createCompleteDoubleElimTournament(false);

    const entry = store.archiveTournament();

    assert.deepStrictEqual(entry.type, "double");
    assert.deepStrictEqual(entry.standings.map((s) => [s.place, s.name]), [
      [1, "Player 1"],
      [2, "Player 2"],
      [3, "Player 3"],
      [4, "Player 4"],
    ]);
  });
});

test("archiveTournament - Mario Kart", async (t) => {
  await t.test("extracts winner from standings (highest points)", () => {
    const store = createCompleteMarioKartTournament();

    const entry = store.archiveTournament();

    assert.ok(entry != null, "Should create history entry");
    assert.deepStrictEqual(entry.winner.id, "player-1");
    assert.deepStrictEqual(entry.winner.name, "Player 1");
    assert.deepStrictEqual(entry.type, "mariokart");
  });

  await t.test("includes top 4 standings with points", () => {
    const store = createCompleteMarioKartTournament();

    const entry = store.archiveTournament();

    assert(entry.standings.length >= 1, "Should have standings");
    assert.deepStrictEqual(entry.standings[0].place, 1);
    assert.deepStrictEqual(entry.standings[0].name, "Player 1");
    assert.ok(entry.standings[0].points != null, "Standings should include points");
  });

  await t.test("breaks a points tie on wins, like the results card", () => {
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

    assert.deepStrictEqual(entry.winner.id, "player-2");
    assert.deepStrictEqual(entry.standings.map((s) => s.name), ["Player 2", "Player 1"]);
  });
});

test("archiveTournament - Doubles", async (t) => {
  await t.test("extracts winning team from finals", () => {
    const store = createCompleteDoublesTournament("single");

    const entry = store.archiveTournament();

    assert.ok(entry != null, "Should create history entry");
    assert.ok(entry.winner != null, "Should have winner");
    assert.deepStrictEqual(entry.winner.id, "team-1");
    assert.deepStrictEqual(entry.type, "doubles");
  });

  await t.test("includes team info in winner (id, name, members)", () => {
    const store = createCompleteDoublesTournament("single");

    const entry = store.archiveTournament();

    assert.ok(entry.winner.team != null, "Winner should have team info");
    assert.deepStrictEqual(entry.winner.team.id, "team-1");
    assert.ok(entry.winner.team.name != null, "Team should have name");
    assert.ok(entry.winner.team.members != null, "Team should have members");
  });

  await t.test("handles double-elim doubles (grand finals)", () => {
    const store = createCompleteDoublesTournament("double");

    const entry = store.archiveTournament();

    assert.ok(entry != null, "Should create history entry");
    assert.deepStrictEqual(entry.type, "doubles");
    assert.deepStrictEqual(entry.winner.id, "team-1");
  });

  await t.test("archives with no winner when the bracket cannot be ranked", () => {
    const store = createCompleteDoublesTournament("single");
    store.set("bracket", { type: "doubles", rounds: [] });

    const entry = store.archiveTournament();

    assert.ok(entry != null, "A malformed bracket must not block archiving");
    assert.deepStrictEqual(entry.winner, null);
    assert.deepStrictEqual(entry.standings, []);
  });
});

test("getHistory", async (t) => {
  await t.test("returns empty array initially", () => {
    const store = new Store();

    const history = store.getHistory();

    assert.deepStrictEqual(history, []);
    assert.deepStrictEqual(history.length, 0);
  });

  await t.test("returns archived tournaments in order", () => {
    const store = createCompleteSingleElimTournament();

    const entry1 = store.archiveTournament();

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

    assert.deepStrictEqual(history.length, 2);
    assert.deepStrictEqual(history[0].id, entry1.id);
    assert.deepStrictEqual(history[1].id, entry2.id);
  });
});

test("resetForNewTournament", async (t) => {
  await t.test("sets status to lobby", () => {
    const store = createCompleteSingleElimTournament();

    store.resetForNewTournament();

    assert.deepStrictEqual(store.get("meta.status"), "lobby");
  });

  await t.test("clears bracket", () => {
    const store = createCompleteSingleElimTournament();

    store.resetForNewTournament();

    assert.deepStrictEqual(store.get("bracket"), null);
  });

  await t.test("clears matches", () => {
    const store = createCompleteSingleElimTournament();

    store.resetForNewTournament();

    const matches = store.get("matches");
    assert.deepStrictEqual(matches.size, 0);
  });

  await t.test("clears standings", () => {
    const store = createCompleteMarioKartTournament();

    store.resetForNewTournament();

    const standings = store.get("standings");
    assert.deepStrictEqual(standings.size, 0);
  });

  await t.test("clears teamAssignments", () => {
    const store = createCompleteDoublesTournament();

    store.resetForNewTournament();

    const teamAssignments = store.getTeamAssignments();
    assert.deepStrictEqual(teamAssignments.size, 0);
  });

  await t.test("preserves participants", () => {
    const store = createCompleteSingleElimTournament();
    const countBefore = store.getParticipantList().length;

    store.resetForNewTournament();

    const countAfter = store.getParticipantList().length;
    assert.deepStrictEqual(countAfter, countBefore);
    assert.deepStrictEqual(countAfter, 4);
  });

  await t.test("preserves history", () => {
    const store = createCompleteSingleElimTournament();
    store.archiveTournament();

    store.resetForNewTournament();

    const history = store.getHistory();
    assert.deepStrictEqual(history.length, 1);
  });
});

test("History Serialization", async (t) => {
  await t.test("history array included in serialize() output", () => {
    const store = createCompleteSingleElimTournament();
    store.archiveTournament();

    const serialized = store.serialize();

    assert.ok(serialized.history != null, "Serialized should have history");
    assert(Array.isArray(serialized.history), "History should be an array");
    assert.deepStrictEqual(serialized.history.length, 1);
  });

  await t.test("history array restored from deserialize()", () => {
    const store = new Store();
    store.deserialize({ history: [historyEntry("test-1")] });

    const history = store.getHistory();
    assert.deepStrictEqual(history.length, 1);
    assert.deepStrictEqual(history[0].id, "test-1");
    assert.deepStrictEqual(history[0].name, "test-1");
  });

  await t.test("history survives full roundtrip", () => {
    const store1 = createCompleteSingleElimTournament();
    const entry = store1.archiveTournament();

    const store2 = new Store();
    store2.deserialize(store1.serialize());

    const history = store2.getHistory();
    assert.deepStrictEqual(history.length, 1);
    assert.deepStrictEqual(history[0].id, entry.id);
    assert.deepStrictEqual(history[0].winner.id, entry.winner.id);
    assert.deepStrictEqual(history[0].type, entry.type);
  });
});

test("History Merge", async (t) => {
  await t.test("adds new history entries from the admin (union merge)", () => {
    const store = new Store();
    store.deserialize({ history: [historyEntry("local-1")] });

    store.merge({ history: [historyEntry("remote-1", 2000)] }, true);

    assert.deepStrictEqual(store.getHistory().length, 2);
  });

  await t.test("ignores history from a non-admin peer and entries without a string id", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");

    store.merge({ history: [historyEntry("forged")] }, false);
    store.merge({ history: [null, { name: "No id" }] }, true);

    assert.deepStrictEqual(store.getHistory(), []);
  });

  await t.test("deduplicates entries by id", () => {
    const store = new Store();
    store.deserialize({ history: [historyEntry("same-id")] });

    store.merge({ history: [historyEntry("same-id")] }, true);

    assert.deepStrictEqual(store.getHistory().length, 1, "Should not duplicate entries with same id");
  });

  await t.test("preserves local history entries", () => {
    const store = new Store();
    store.deserialize({ history: [historyEntry("local-1")] });

    store.merge({ history: [] }, true);

    const history = store.getHistory();
    assert.deepStrictEqual(history.length, 1);
    assert.deepStrictEqual(history[0].id, "local-1");
  });
});
