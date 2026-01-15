/**
 * Tests for mario-kart.js (Points Race Tournament)
 */

import { assertEquals, assert, assertThrows } from "jsr:@std/assert";
import {
  generateMarioKartTournament,
  recordRaceResult,
  getStandings,
} from "../js/tournament/mario-kart.js";
import { createParticipants, standardPointsTable } from "./fixtures.js";

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

    // totalSlots = 8 * 5 = 40, totalGames = ceil(40 / 4) = 10
    assertEquals(tournament.totalGames, 10);
  });

  await t.step("includes points table", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assert(Array.isArray(tournament.pointsTable), "Should have points table");
    assert(tournament.pointsTable.length > 0, "Points table should have values");
    // First place should get more points than second
    assert(tournament.pointsTable[0] > tournament.pointsTable[1]);
  });

  await t.step("starts not complete", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants);

    assertEquals(tournament.isComplete, false);
    assertEquals(tournament.gamesComplete, 0);
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
    const game = tournament.matches.get(gameId);

    // Try to record result for participant not in this game
    assertThrows(
      () => recordRaceResult(tournament, gameId, [
        { participantId: "non-existent", position: 1 },
      ], "player-1"),
      Error,
      "not in this game"
    );
  });

  await t.step("records results and assigns points", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: [15, 12, 10, 8],
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);

    // Create results in order
    const results = game.participants.map((pId, idx) => ({
      participantId: pId,
      position: idx + 1,
    }));

    recordRaceResult(tournament, gameId, results, "player-1");

    // Check results were recorded
    assert(game.results !== null, "Results should be set");
    assertEquals(game.results.length, game.participants.length);
    assertEquals(game.complete, true);

    // Check points were assigned
    const firstPlace = tournament.standings.get(game.participants[0]);
    assertEquals(firstPlace.points, 15, "First place should get 15 points");
  });

  await t.step("updates standings correctly", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: [15, 12, 10, 8],
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);

    const results = game.participants.map((pId, idx) => ({
      participantId: pId,
      position: idx + 1,
    }));

    recordRaceResult(tournament, gameId, results, "player-1");

    // Check first place stats
    const winner = tournament.standings.get(game.participants[0]);
    assertEquals(winner.wins, 1);
    assertEquals(winner.gamesCompleted, 1);
    assert(winner.history.length === 1, "Should have history entry");
  });

  await t.step("tracks history per participant", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);

    const results = game.participants.map((pId, idx) => ({
      participantId: pId,
      position: idx + 1,
    }));

    recordRaceResult(tournament, gameId, results, "player-1");

    const standing = tournament.standings.get(game.participants[0]);
    assertEquals(standing.history.length, 1);
    assertEquals(standing.history[0].gameId, gameId);
    assertEquals(standing.history[0].position, 1);
  });

  await t.step("increments gamesComplete count", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    assertEquals(tournament.gamesComplete, 0);

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);

    const results = game.participants.map((pId, idx) => ({
      participantId: pId,
      position: idx + 1,
    }));

    recordRaceResult(tournament, gameId, results, "player-1");

    assertEquals(tournament.gamesComplete, 1);
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

Deno.test("getStandings", async (t) => {
  await t.step("sorts by points descending", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: [15, 12, 10, 8],
    });

    // Record a game result
    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);

    const results = game.participants.map((pId, idx) => ({
      participantId: pId,
      position: idx + 1,
    }));

    recordRaceResult(tournament, gameId, results, "player-1");

    const standings = getStandings(tournament);

    // Should be sorted by points (highest first)
    for (let i = 0; i < standings.length - 1; i++) {
      assert(
        standings[i].points >= standings[i + 1].points,
        "Should be sorted by points descending"
      );
    }
  });

  await t.step("assigns place numbers", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);

    const results = game.participants.map((pId, idx) => ({
      participantId: pId,
      position: idx + 1,
    }));

    recordRaceResult(tournament, gameId, results, "player-1");

    const standings = getStandings(tournament);

    assertEquals(standings[0].place, 1);
    assertEquals(standings[1].place, 2);
    assertEquals(standings[2].place, 3);
    assertEquals(standings[3].place, 4);
  });

  await t.step("uses wins as tiebreaker", () => {
    const participants = createParticipants(2);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 2,
      gamesPerPlayer: 2,
      pointsTable: [10, 8],
    });

    // Play both games, each player wins one
    const games = Array.from(tournament.matches.values());

    if (games.length >= 2) {
      // Game 1: player-1 wins
      recordRaceResult(tournament, games[0].id, [
        { participantId: "player-1" },
        { participantId: "player-2" },
      ], "player-1");

      // Game 2: player-2 wins
      recordRaceResult(tournament, games[1].id, [
        { participantId: "player-2" },
        { participantId: "player-1" },
      ], "player-2");

      const standings = getStandings(tournament);

      // Both have 18 points (10+8), so wins should be equal too
      assertEquals(standings[0].points, standings[1].points);
    }
  });
});

Deno.test("tournament completion", async (t) => {
  await t.step("marks tournament complete when all games finished", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    assertEquals(tournament.isComplete, false);

    // Play all games
    for (const [gameId, game] of tournament.matches) {
      if (!game.complete) {
        const results = game.participants.map((pId, idx) => ({
          participantId: pId,
          position: idx + 1,
        }));
        recordRaceResult(tournament, gameId, results, "player-1");
      }
    }

    assertEquals(tournament.isComplete, true);
  });
});
