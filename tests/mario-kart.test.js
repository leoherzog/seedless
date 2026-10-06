/**
 * Tests for mario-kart.js (Points Race Tournament)
 */

import { assertEquals, assert, assertThrows } from "jsr:@std/assert";
import {
  generateMarioKartTournament,
  recordRaceResult,
} from "../js/tournament/mario-kart.js";
import { CONFIG } from "../config.js";
import { createParticipants } from "./fixtures.js";

Deno.test("generateMarioKartTournament", async (t) => {
  await t.step("throws for less than 2 participants", () => {
    assertThrows(
      () => generateMarioKartTournament([{ id: "1", name: "Solo", seed: 1 }]),
      Error,
      "Need at least 2 participants"
    );
  });

  await t.step("generates tournament with type 'mariokart'", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assertEquals(tournament.type, "mariokart");
  });

  await t.step("creates matches map", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assert(tournament.matches instanceof Map, "Should have matches Map");
    assert(tournament.matches.size > 0, "Should have at least one game");
  });

  await t.step("initializes standings for all participants", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assertEquals(tournament.standings.size, 4);
    for (const p of participants) {
      const standing = tournament.standings.get(p.id);
      assert(standing !== undefined, `Should have standing for ${p.id}`);
      assertEquals(standing.points, 0);
      assertEquals(standing.gamesCompleted, 0);
      assertEquals(standing.wins, 0);
    }
  });

  await t.step("configures players per game", () => {
    const participants = createParticipants(8);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
    });

    assertEquals(tournament.playersPerGame, 4);

    // Each game should have up to 4 participants
    for (const [_, game] of tournament.matches) {
      assert(game.participants.length <= 4, "Game should have at most 4 players");
    }
  });

  await t.step("configures games per player", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      gamesPerPlayer: 3,
    });

    assertEquals(tournament.gamesPerPlayer, 3);
  });

  await t.step("calculates total games correctly", () => {
    const participants = createParticipants(8);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 5,
    });

    // totalSlots = 8 * 5 = 40, games = ceil(40 / 4) = 10
    assertEquals(tournament.matches.size, 10);
  });

  await t.step("includes points table", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assert(Array.isArray(tournament.pointsTable), "Should have points table");
    assert(tournament.pointsTable.length > 0, "Points table should have values");
    // First place should get more points than second
    assert(tournament.pointsTable[0] > tournament.pointsTable[1]);
  });

  await t.step("starts with no game complete", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assert([...tournament.matches.values()].every((m) => !m.complete));
  });

  await t.step("game matches have correct structure", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    for (const [id, game] of tournament.matches) {
      assert(typeof game.id === "string", "Should have string id");
      assert(typeof game.gameNumber === "number", "Should have game number");
      assert(Array.isArray(game.participants), "Should have participants array");
      assertEquals(game.results, null, "Results should be null initially");
      assertEquals(game.winnerId, null, "Winner should be null initially");
      assertEquals(game.complete, false, "Should not be complete");
    }
  });
});

/** Results for a game with finishers in participant order. */
function inOrder(game) {
  return game.participants.map((pId, idx) => ({ participantId: pId, position: idx + 1 }));
}

Deno.test("recordRaceResult", async (t) => {
  await t.step("throws for non-existent game", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assertThrows(
      () => recordRaceResult(tournament, "invalid-game", [], "player-1"),
      Error,
      "Game not found"
    );
  });

  await t.step("throws for participant not in game", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    const gameId = tournament.matches.keys().next().value;

    assertThrows(
      () => recordRaceResult(tournament, gameId, [
        { participantId: "non-existent", position: 1 },
      ], "player-1"),
      Error,
      "not in this game"
    );
  });

  await t.step("records results, points and wins, and reports completion", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: [15, 12, 10, 8],
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);

    assertEquals(recordRaceResult(tournament, gameId, inOrder(game), "player-1"), true);

    assertEquals(game.results.length, game.participants.length);
    assertEquals(game.complete, true);

    const winner = tournament.standings.get(game.participants[0]);
    assertEquals(winner.points, 15);
    assertEquals(winner.wins, 1);
    assertEquals(winner.gamesCompleted, 1);
    assertEquals(game.results[0].position, 1);
  });

  await t.step("sets winnerId to first place finisher", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);

    // Put player-2 in first place
    const results = [
      { participantId: game.participants[1] },
      { participantId: game.participants[0] },
      { participantId: game.participants[2] },
      { participantId: game.participants[3] },
    ];

    recordRaceResult(tournament, gameId, results, "player-1");

    assertEquals(game.winnerId, game.participants[1]);
  });
});

Deno.test("scoring systems", async (t) => {
  await t.step("each configured points table scores the first four placings", () => {
    const tables = Object.entries(CONFIG.pointsTables).filter(([, table]) => Array.isArray(table));
    for (const [name, table] of tables) {
      const tournament = generateMarioKartTournament(createParticipants(4), {
        playersPerGame: 4,
        gamesPerPlayer: 1,
        pointsTable: table,
      });

      const gameId = tournament.matches.keys().next().value;
      const game = tournament.matches.get(gameId);
      recordRaceResult(tournament, gameId, inOrder(game), "player-1");

      const points = game.participants.map((pId) => tournament.standings.get(pId).points);
      assertEquals(points, table.slice(0, 4), `${name} table`);
    }
  });

  await t.step("sequential scoring gives N, N-1, ..., 1 points", () => {
    for (const n of [2, 4, 6]) {
      const tournament = generateMarioKartTournament(createParticipants(n), {
        playersPerGame: n,
        gamesPerPlayer: 1,
        pointsTable: 'sequential',
      });

      const gameId = tournament.matches.keys().next().value;
      const game = tournament.matches.get(gameId);
      recordRaceResult(tournament, gameId, inOrder(game), "player-1");

      const points = game.participants.map((pId) => tournament.standings.get(pId).points);
      assertEquals(points, Array.from({ length: n }, (_, i) => n - i), `${n}-player game`);
    }
  });

  await t.step("sequential scoring: handles varying game sizes dynamically", () => {
    const participants = createParticipants(5);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,  // Target 4 players, but last game might have fewer
      gamesPerPlayer: 1,
      pointsTable: 'sequential',
    });

    for (const game of tournament.matches.values()) {
      if (game.complete) continue;

      const playerCount = game.participants.length;
      recordRaceResult(tournament, game.id, inOrder(game), "player-1");

      const firstHistory = game.results[0];
      const lastHistory = game.results[playerCount - 1];

      assertEquals(firstHistory.points, playerCount, `1st place should get ${playerCount} points in ${playerCount}-player game`);
      assertEquals(lastHistory.points, 1, `Last place should get 1 point in ${playerCount}-player game`);
    }
  });
});
