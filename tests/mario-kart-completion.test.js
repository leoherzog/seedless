/**
 * Recording every game completes the race; re-recording a game replaces its
 * result instead of adding to it, an order that is not each racer once is
 * rejected, and a passed-in reportedAt is kept.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateMarioKartTournament,
  recordRaceResult,
  getStandings,
} from "../js/tournament/mario-kart.js";
import { createParticipants } from "./fixtures.js";

/**
 * Record every remaining game with finishers in `game.participants` order, so runs are reproducible.
 * @returns {boolean} The last recordRaceResult completion flag
 */
function playAllGames(tournament) {
  let complete = false;
  for (const [gameId, game] of tournament.matches) {
    if (game.complete) continue;
    const results = game.participants.map((pId) => ({ participantId: pId }));
    complete = recordRaceResult(tournament, gameId, results, results[0].participantId);
  }
  return complete;
}

test("Mario Kart parametric completion", async (t) => {
  const configs = [
    { players: 2, playersPerGame: 2, gamesPerPlayer: 1 },
    { players: 3, playersPerGame: 2, gamesPerPlayer: 2 },
    { players: 4, playersPerGame: 4, gamesPerPlayer: 3 },
    { players: 5, playersPerGame: 4, gamesPerPlayer: 2 },
    { players: 8, playersPerGame: 4, gamesPerPlayer: 5 },
    { players: 9, playersPerGame: 3, gamesPerPlayer: 4 },
    { players: 12, playersPerGame: 6, gamesPerPlayer: 3 },
  ];

  for (const cfg of configs) {
    await t.test(
      `players=${cfg.players} playersPerGame=${cfg.playersPerGame} gamesPerPlayer=${cfg.gamesPerPlayer}`,
      () => {
        const participants = createParticipants(cfg.players);
        const tournament = generateMarioKartTournament(participants, {
          playersPerGame: cfg.playersPerGame,
          gamesPerPlayer: cfg.gamesPerPlayer,
          pointsTable: "sequential",
        });

        assert(playAllGames(tournament), "the last result should report the race complete");

        for (const [gameId, game] of tournament.matches) {
          assert(game.complete, `Game ${gameId} should be complete`);
          assert(game.results !== null, `Game ${gameId} should have results`);
          assert(game.winnerId, `Game ${gameId} should have a winnerId`);
        }

        const standings = getStandings(tournament);

        assert.deepStrictEqual(standings.length, cfg.players);
        const seenIds = new Set(standings.map((s) => s.participantId));
        assert.deepStrictEqual(seenIds.size, cfg.players, "No duplicated participant in standings");
        for (const p of participants) {
          assert(seenIds.has(p.id), `Standings should include ${p.id}`);
        }

        // gamesCompleted summed over players equals the seats across all games.
        const totalParticipantSlots = Array.from(tournament.matches.values())
          .reduce((sum, g) => sum + g.participants.length, 0);
        const totalGamesCompleted = standings.reduce((sum, s) => sum + s.gamesCompleted, 0);
        assert.deepStrictEqual(totalGamesCompleted, totalParticipantSlots);

        for (let i = 0; i < standings.length - 1; i++) {
          assert(standings[i].points >= standings[i + 1].points);
        }
        for (let i = 0; i < standings.length; i++) {
          assert.deepStrictEqual(standings[i].place, i + 1);
        }

        const champions = standings.filter((s) => s.place === 1);
        assert.deepStrictEqual(champions.length, 1);
      }
    );
  }
});

test("Mario Kart idempotency: re-recording same gameId result", async (t) => {
  await t.test("does not double-count points/gamesCompleted/wins", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: [15, 12, 10, 8],
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);
    const results = game.participants.map((pId) => ({ participantId: pId }));

    recordRaceResult(tournament, gameId, results, "player-1", 1000);

    const snapshotAfterFirst = Array.from(tournament.standings.values()).map((s) => ({
      participantId: s.participantId,
      points: s.points,
      gamesCompleted: s.gamesCompleted,
      wins: s.wins,
    }));

    recordRaceResult(tournament, gameId, results, "player-1", 1000);

    const snapshotAfterSecond = Array.from(tournament.standings.values()).map((s) => ({
      participantId: s.participantId,
      points: s.points,
      gamesCompleted: s.gamesCompleted,
      wins: s.wins,
    }));

    assert.deepStrictEqual(snapshotAfterSecond, snapshotAfterFirst, "Re-recording the same result must be a no-op");

    const winner = tournament.standings.get(results[0].participantId);
    assert.deepStrictEqual(winner.gamesCompleted, 1);
    assert.deepStrictEqual(winner.wins, 1);
    assert.deepStrictEqual(winner.points, 15);
  });
});

test("Mario Kart correction: different result for same gameId replaces prior contribution", async (t) => {
  await t.test("swapping first and second place updates points/wins without accumulating", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: [15, 12, 10, 8],
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);
    const [a, b, c, d] = game.participants;

    recordRaceResult(tournament, gameId, [
      { participantId: a },
      { participantId: b },
      { participantId: c },
      { participantId: d },
    ], "player-1");

    assert.deepStrictEqual(tournament.standings.get(a).points, 15);
    assert.deepStrictEqual(tournament.standings.get(a).wins, 1);
    assert.deepStrictEqual(tournament.standings.get(b).points, 12);
    assert.deepStrictEqual(tournament.standings.get(b).wins, 0);

    recordRaceResult(tournament, gameId, [
      { participantId: b },
      { participantId: a },
      { participantId: c },
      { participantId: d },
    ], "player-2");

    assert.deepStrictEqual(tournament.standings.get(b).points, 15, "b should now have winner's points, not 12+15");
    assert.deepStrictEqual(tournament.standings.get(b).wins, 1);
    assert.deepStrictEqual(tournament.standings.get(a).points, 12, "a should now have 2nd place points, not 15+12");
    assert.deepStrictEqual(tournament.standings.get(a).wins, 0, "a's win should be reversed");

    for (const pId of game.participants) {
      const standing = tournament.standings.get(pId);
      assert.deepStrictEqual(standing.gamesCompleted, 1, `${pId} gamesCompleted should stay at 1 after correction`);
    }

    assert.deepStrictEqual(game.results.slice(0, 2), [
      { participantId: b, position: 1, points: 15 },
      { participantId: a, position: 2, points: 12 },
    ]);

    assert.deepStrictEqual(game.winnerId, b);
  });

  await t.test("rejects an order that repeats or omits a racer and keeps the standings", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: [15, 12, 10, 8],
    });

    const gameId = tournament.matches.keys().next().value;
    const [a, b, c, d] = tournament.matches.get(gameId).participants;
    recordRaceResult(tournament, gameId, [a, b, c, d].map((participantId) => ({ participantId })), "player-1");

    for (const order of [[a, a, a, a], [a, b, c]]) {
      assert.throws(
        () => recordRaceResult(tournament, gameId, order.map((participantId) => ({ participantId })), "player-1"),
        (err) => err instanceof Error && err.message.includes("exactly once"),
      );
    }

    assert.deepStrictEqual(tournament.standings.get(a).points, 15);
    assert.deepStrictEqual(tournament.standings.get(a).gamesCompleted, 1);
    assert.deepStrictEqual(tournament.standings.get(d).points, 8);
  });
});

test("Mario Kart reportedAt", async (t) => {
  await t.test("preserves a passed-in reportedAt instead of overwriting with now", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);
    const results = game.participants.map((pId) => ({ participantId: pId }));

    const fixedTimestamp = 1_600_000_000_000;
    recordRaceResult(tournament, gameId, results, "player-1", fixedTimestamp);

    assert.deepStrictEqual(game.reportedAt, fixedTimestamp);
  });

  await t.test("defaults to current time when reportedAt is omitted", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);
    const results = game.participants.map((pId) => ({ participantId: pId }));

    const before = Date.now();
    recordRaceResult(tournament, gameId, results, "player-1");
    const after = Date.now();

    assert(game.reportedAt >= before && game.reportedAt <= after, "reportedAt should default to now");
  });

  await t.test("re-recording preserves the newly passed reportedAt, not the original", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);
    const results = game.participants.map((pId) => ({ participantId: pId }));

    recordRaceResult(tournament, gameId, results, "player-1", 1000);
    assert.deepStrictEqual(game.reportedAt, 1000);

    recordRaceResult(tournament, gameId, results, "player-2", 2000);
    assert.deepStrictEqual(game.reportedAt, 2000);
    assert.deepStrictEqual(game.reportedBy, "player-2");
  });
});
