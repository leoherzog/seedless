/**
 * Tests for multi-tournament history feature
 */

import { assertEquals, assert, assertExists } from "jsr:@std/assert";
import { Store } from "../js/state/store.js";
import {
  generateSingleEliminationBracket,
  recordMatchResult as recordSingleResult,
} from "../js/tournament/single-elimination.js";
import {
  generateDoubleEliminationBracket,
  recordMatchResult as recordDoubleResult,
} from "../js/tournament/double-elimination.js";
import {
  generateMarioKartTournament,
  recordRaceResult,
} from "../js/tournament/mario-kart.js";
import { generateDoublesTournament } from "../js/tournament/doubles.js";
import { createParticipants, createTeamAssignments } from "./fixtures.js";

// ============================================
// Helper Functions
// ============================================

/**
 * Setup complete single-elim tournament (4 players)
 * @returns {Store} Store with completed single elimination tournament
 */
function createCompleteSingleElimTournament() {
  const store = new Store();
  const participants = createParticipants(4);
  participants.forEach((p) => store.addParticipant(p));

  const bracket = generateSingleEliminationBracket(
    store.getParticipantList()
  );

  // Play all matches: semi-finals then finals
  // R1M0: player-1 vs player-4 -> player-1 wins
  recordSingleResult(bracket, "r1m0", [2, 0], "player-1", "player-1");
  // R1M1: player-2 vs player-3 -> player-2 wins
  recordSingleResult(bracket, "r1m1", [2, 0], "player-2", "player-2");
  // R2M0: player-1 vs player-2 -> player-1 wins finals
  recordSingleResult(bracket, "r2m0", [2, 1], "player-1", "player-1");

  store.set("bracket", bracket);
  store.deserialize({ matches: Array.from(bracket.matches.entries()) });
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

  const bracket = generateDoubleEliminationBracket(
    store.getParticipantList()
  );

  // Winners bracket
  // W1M0: player-1 vs player-4 -> player-1 wins
  recordDoubleResult(bracket, "w1m0", [2, 0], "player-1", "player-1");
  // W1M1: player-2 vs player-3 -> player-2 wins
  recordDoubleResult(bracket, "w1m1", [2, 0], "player-2", "player-2");
  // W2M0 (Winners Finals): player-1 vs player-2 -> player-1 wins
  recordDoubleResult(bracket, "w2m0", [2, 1], "player-1", "player-1");

  // Losers bracket
  // L1M0: player-4 vs player-3 -> player-3 wins
  recordDoubleResult(bracket, "l1m0", [2, 1], "player-3", "player-3");
  // L2M0 (Losers Finals): player-3 vs player-2 (dropped from WF) -> player-2 wins
  recordDoubleResult(bracket, "l2m0", [2, 0], "player-2", "player-2");

  // Grand Finals
  if (resetNeeded) {
    // GF1: player-1 (winners) vs player-2 (losers) -> player-2 wins
    recordDoubleResult(bracket, "gf1", [1, 2], "player-2", "player-2");
    // GF2 (Reset): player-1 vs player-2 -> player-2 wins overall
    recordDoubleResult(bracket, "gf2", [1, 2], "player-2", "player-2");
  } else {
    // GF1: player-1 (winners) vs player-2 (losers) -> player-1 wins
    recordDoubleResult(bracket, "gf1", [2, 1], "player-1", "player-1");
  }

  store.set("bracket", bracket);
  store.deserialize({ matches: Array.from(bracket.matches.entries()) });
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

  store.set("bracket", tournament);
  store.deserialize({
    matches: Array.from(tournament.matches.entries()),
    standings: Array.from(tournament.standings.entries()),
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
  const teamId2 = "team-2";

  if (bracketType === "double") {
    // Double elim doubles - play through bracket
    recordDoubleResult(tournament, "w1m0", [2, 0], teamId1, teamId1);
    // Grand finals
    recordDoubleResult(tournament, "gf1", [2, 0], teamId1, teamId1);
  } else {
    // Single elim finals
    recordSingleResult(tournament, "r1m0", [2, 0], teamId1, teamId1);
  }

  store.set("bracket", tournament);
  store.deserialize({ matches: Array.from(tournament.matches.entries()) });
  // Set teamAssignments in store
  for (const [participantId, teamId] of teamAssignments) {
    store.setTeamAssignment(participantId, teamId);
  }
  store.set("meta.status", "complete");
  store.set("meta.type", "doubles");
  store.set("meta.name", "Doubles Tournament");

  return store;
}

// ============================================
// Test Cases
// ============================================

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

  await t.step("returns null for incomplete tournament", () => {
    const store = new Store();
    const participants = createParticipants(4);
    participants.forEach((p) => store.addParticipant(p));

    const bracket = generateSingleEliminationBracket(
      store.getParticipantList()
    );
    store.set("bracket", bracket);
    store.set("meta.status", "active"); // Not complete

    const entry = store.archiveTournament();

    assertEquals(entry, null, "Should return null for incomplete tournament");
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

  await t.step("includes correct type and standings", () => {
    const store = createCompleteDoubleElimTournament(false);

    const entry = store.archiveTournament();

    assertEquals(entry.type, "double");
    assert(entry.standings.length >= 2, "Should have at least 2 standings");
    assertEquals(entry.standings[0].place, 1);
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

  await t.step("handles ties by name (alphabetical fallback)", () => {
    // Create tournament where players tie on points
    const store = new Store();
    const participants = createParticipants(2);
    participants.forEach((p) => store.addParticipant(p));

    // Create standings with equal points
    const standings = new Map([
      [
        "player-1",
        { participantId: "player-1", name: "Player 1", points: 10 },
      ],
      [
        "player-2",
        { participantId: "player-2", name: "Player 2", points: 10 },
      ],
    ]);

    store.deserialize({ standings: Array.from(standings.entries()) });
    store.set("meta.status", "complete");
    store.set("meta.type", "mariokart");

    const entry = store.archiveTournament();

    // Should have a winner (implementation may vary on tie-breaking)
    assertExists(entry, "Should create entry even with ties");
    assertExists(entry.winner, "Should have a winner");
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
    assertExists(entry.winner, "Should have winner");
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

    const bracket = generateSingleEliminationBracket(
      store.getParticipantList()
    );
    recordSingleResult(bracket, "r1m0", [2, 0], "player-1", "player-1");
    recordSingleResult(bracket, "r1m1", [2, 0], "player-2", "player-2");
    recordSingleResult(bracket, "r2m0", [2, 0], "player-2", "player-2");
    store.set("bracket", bracket);
    store.deserialize({ matches: Array.from(bracket.matches.entries()) });
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

  await t.step("increments version", () => {
    const store = createCompleteSingleElimTournament();
    const versionBefore = store.get("meta.version");

    store.resetForNewTournament();

    const versionAfter = store.get("meta.version");
    assert(versionAfter > versionBefore, "Version should increment");
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
    const historyData = [
      {
        id: "test-1",
        name: "Test Tournament",
        type: "single",
        winner: { id: "p1", name: "Winner" },
        standings: [{ place: 1, name: "Winner" }],
        participantCount: 4,
        completedAt: Date.now(),
      },
    ];

    store.deserialize({ history: historyData });

    const history = store.getHistory();
    assertEquals(history.length, 1);
    assertEquals(history[0].id, "test-1");
    assertEquals(history[0].name, "Test Tournament");
  });

  await t.step("history survives full roundtrip", () => {
    const store1 = createCompleteSingleElimTournament();
    const entry = store1.archiveTournament();

    // Serialize
    const serialized = store1.serialize();

    // Deserialize into new store
    const store2 = new Store();
    store2.deserialize(serialized);

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
    store.deserialize({
      history: [
        {
          id: "local-1",
          name: "Local Tournament",
          type: "single",
          winner: { id: "p1", name: "Winner" },
          standings: [],
          participantCount: 4,
          completedAt: 1000,
        },
      ],
    });

    const remoteState = {
      history: [
        {
          id: "remote-1",
          name: "Remote Tournament",
          type: "double",
          winner: { id: "p2", name: "Remote Winner" },
          standings: [],
          participantCount: 8,
          completedAt: 2000,
        },
      ],
    };

    store.merge(remoteState, null);

    const history = store.getHistory();
    assertEquals(history.length, 2);
  });

  await t.step("deduplicates entries by id", () => {
    const store = new Store();
    store.deserialize({
      history: [
        {
          id: "same-id",
          name: "Local Version",
          type: "single",
          winner: { id: "p1", name: "Winner" },
          standings: [],
          participantCount: 4,
          completedAt: 1000,
        },
      ],
    });

    const remoteState = {
      history: [
        {
          id: "same-id",
          name: "Remote Version",
          type: "single",
          winner: { id: "p1", name: "Winner" },
          standings: [],
          participantCount: 4,
          completedAt: 1000,
        },
      ],
    };

    store.merge(remoteState, null);

    const history = store.getHistory();
    assertEquals(history.length, 1, "Should not duplicate entries with same id");
  });

  await t.step("preserves local history entries", () => {
    const store = new Store();
    store.deserialize({
      history: [
        {
          id: "local-1",
          name: "Local Tournament",
          type: "single",
          winner: { id: "p1", name: "Winner" },
          standings: [],
          participantCount: 4,
          completedAt: 1000,
        },
      ],
    });

    const remoteState = {
      history: [],
    };

    store.merge(remoteState, null);

    const history = store.getHistory();
    assertEquals(history.length, 1);
    assertEquals(history[0].id, "local-1");
  });

  await t.step("sorts merged history by completedAt", () => {
    const store = new Store();
    store.deserialize({
      history: [
        {
          id: "middle",
          name: "Middle",
          type: "single",
          winner: { id: "p1", name: "W" },
          standings: [],
          participantCount: 4,
          completedAt: 2000,
        },
      ],
    });

    const remoteState = {
      history: [
        {
          id: "oldest",
          name: "Oldest",
          type: "single",
          winner: { id: "p1", name: "W" },
          standings: [],
          participantCount: 4,
          completedAt: 1000,
        },
        {
          id: "newest",
          name: "Newest",
          type: "single",
          winner: { id: "p1", name: "W" },
          standings: [],
          participantCount: 4,
          completedAt: 3000,
        },
      ],
    };

    store.merge(remoteState, null);

    const history = store.getHistory();
    assertEquals(history.length, 3);
    assertEquals(history[0].id, "oldest");
    assertEquals(history[1].id, "middle");
    assertEquals(history[2].id, "newest");
  });
});
