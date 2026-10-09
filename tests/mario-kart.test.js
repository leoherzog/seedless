/**
 * Tests for mario-kart.js (Points Race Tournament)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateMarioKartTournament,
  recordRaceResult,
} from "../js/tournament/mario-kart.js";
import { CONFIG } from "../config.js";
import { createParticipants } from "./fixtures.js";

test("generateMarioKartTournament", async (t) => {
  await t.test("throws for less than 2 participants", () => {
    assert.throws(
      () => generateMarioKartTournament([{ id: "1", name: "Solo", seed: 1 }]),
      (err) => err instanceof Error && err.message.includes("Need at least 2 participants")
    );
  });

  await t.test("generates tournament with type 'mariokart'", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assert.deepStrictEqual(tournament.type, "mariokart");
  });

  await t.test("creates matches map", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assert(tournament.matches instanceof Map, "Should have matches Map");
    assert(tournament.matches.size > 0, "Should have at least one game");
  });

  await t.test("initializes standings for all participants", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assert.deepStrictEqual(tournament.standings.size, 4);
    for (const p of participants) {
      const standing = tournament.standings.get(p.id);
      assert(standing !== undefined, `Should have standing for ${p.id}`);
      assert.deepStrictEqual(standing.points, 0);
      assert.deepStrictEqual(standing.gamesCompleted, 0);
      assert.deepStrictEqual(standing.wins, 0);
    }
  });

  await t.test("configures players per game", () => {
    const participants = createParticipants(8);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
    });

    assert.deepStrictEqual(tournament.playersPerGame, 4);

    for (const [_, game] of tournament.matches) {
      assert(game.participants.length <= 4, "Game should have at most 4 players");
    }
  });

  await t.test("configures games per player", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      gamesPerPlayer: 3,
    });

    assert.deepStrictEqual(tournament.gamesPerPlayer, 3);
  });

  await t.test("calculates total games correctly", () => {
    const participants = createParticipants(8);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 5,
    });

    // 8 players × 5 games = 40 seats, at 4 per game.
    assert.deepStrictEqual(tournament.matches.size, 10);
  });

  await t.test("includes points table", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assert(Array.isArray(tournament.pointsTable), "Should have points table");
    assert(tournament.pointsTable.length > 0, "Points table should have values");
    assert(tournament.pointsTable[0] > tournament.pointsTable[1]);
  });

  await t.test("starts with no game complete", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assert([...tournament.matches.values()].every((m) => !m.complete));
  });

  await t.test("game matches have correct structure", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    for (const [id, game] of tournament.matches) {
      assert(typeof game.id === "string", "Should have string id");
      assert(typeof game.gameNumber === "number", "Should have game number");
      assert(Array.isArray(game.participants), "Should have participants array");
      assert.deepStrictEqual(game.results, null, "Results should be null initially");
      assert.deepStrictEqual(game.winnerId, null, "Winner should be null initially");
      assert.deepStrictEqual(game.complete, false, "Should not be complete");
    }
  });
});

/** Results for a game with finishers in participant order. */
function inOrder(game) {
  return game.participants.map((pId, idx) => ({ participantId: pId, position: idx + 1 }));
}

test("recordRaceResult", async (t) => {
  await t.test("throws for non-existent game", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assert.throws(
      () => recordRaceResult(tournament, "invalid-game", [], "player-1"),
      (err) => err instanceof Error && err.message.includes("Game not found")
    );
  });

  await t.test("throws for participant not in game", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    const gameId = tournament.matches.keys().next().value;

    assert.throws(
      () => recordRaceResult(tournament, gameId, [
        { participantId: "non-existent", position: 1 },
      ], "player-1"),
      (err) => err instanceof Error && err.message.includes("exactly once")
    );
  });

  await t.test("records results, points and wins, and reports completion", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: [15, 12, 10, 8],
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);

    assert.deepStrictEqual(recordRaceResult(tournament, gameId, inOrder(game), "player-1"), true);

    assert.deepStrictEqual(game.results.length, game.participants.length);
    assert.deepStrictEqual(game.complete, true);

    const winner = tournament.standings.get(game.participants[0]);
    assert.deepStrictEqual(winner.points, 15);
    assert.deepStrictEqual(winner.wins, 1);
    assert.deepStrictEqual(winner.gamesCompleted, 1);
    assert.deepStrictEqual(game.results[0].position, 1);
  });

  await t.test("sets winnerId to first place finisher", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);

    const results = [
      { participantId: game.participants[1] },
      { participantId: game.participants[0] },
      { participantId: game.participants[2] },
      { participantId: game.participants[3] },
    ];

    recordRaceResult(tournament, gameId, results, "player-1");

    assert.deepStrictEqual(game.winnerId, game.participants[1]);
  });
});

test("scoring systems", async (t) => {
  await t.test("each configured points table scores the first four placings", () => {
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
      assert.deepStrictEqual(points, table.slice(0, 4), `${name} table`);
    }
  });

  await t.test("sequential scoring gives N, N-1, ..., 1 points", () => {
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
      assert.deepStrictEqual(points, Array.from({ length: n }, (_, i) => n - i), `${n}-player game`);
    }
  });

  await t.test("sequential scoring: handles varying game sizes dynamically", () => {
    const participants = createParticipants(5);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4, // 5 seats split into games of 3 and 2
      gamesPerPlayer: 1,
      pointsTable: 'sequential',
    });

    for (const game of tournament.matches.values()) {
      if (game.complete) continue;

      const playerCount = game.participants.length;
      recordRaceResult(tournament, game.id, inOrder(game), "player-1");

      const firstHistory = game.results[0];
      const lastHistory = game.results[playerCount - 1];

      assert.deepStrictEqual(firstHistory.points, playerCount, `1st place should get ${playerCount} points in ${playerCount}-player game`);
      assert.deepStrictEqual(lastHistory.points, 1, `Last place should get 1 point in ${playerCount}-player game`);
    }
  });
});
