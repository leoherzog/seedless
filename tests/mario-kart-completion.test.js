/**
 * Recording every game completes the race; re-recording a game replaces its
 * result instead of adding to it, and a passed-in reportedAt is kept.
 */

import { assertEquals, assert } from "jsr:@std/assert";
import {
  generateMarioKartTournament,
  recordRaceResult,
  getStandings,
} from "../js/tournament/mario-kart.js";
import { createParticipants } from "./fixtures.js";

// Play every remaining game in a deterministic order: results follow the
// order participants already appear in `game.participants`, so first listed
// participant always finishes 1st, etc. This makes the run fully
// reproducible regardless of the random matchmaking. Returns the last
// recordRaceResult completion flag.
function playAllGames(tournament) {
  let complete = false;
  for (const [gameId, game] of tournament.matches) {
    if (game.complete) continue;
    const results = game.participants.map((pId) => ({ participantId: pId }));
    complete = recordRaceResult(tournament, gameId, results, results[0].participantId);
  }
  return complete;
}

Deno.test("Mario Kart parametric completion", async (t) => {
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
    await t.step(
      `players=${cfg.players} playersPerGame=${cfg.playersPerGame} gamesPerPlayer=${cfg.gamesPerPlayer}`,
      () => {
        const participants = createParticipants(cfg.players);
        const tournament = generateMarioKartTournament(participants, {
          playersPerGame: cfg.playersPerGame,
          gamesPerPlayer: cfg.gamesPerPlayer,
          pointsTable: "sequential",
        });

        assert(playAllGames(tournament), "the last result should report the race complete");

        // Every match should have been played; none left unplayable.
        for (const [gameId, game] of tournament.matches) {
          assert(game.complete, `Game ${gameId} should be complete`);
          assert(game.results !== null, `Game ${gameId} should have results`);
          assert(game.winnerId, `Game ${gameId} should have a winnerId`);
        }

        const standings = getStandings(tournament);

        // No participant duplicated or missing from standings.
        assertEquals(standings.length, cfg.players);
        const seenIds = new Set(standings.map((s) => s.participantId));
        assertEquals(seenIds.size, cfg.players, "No duplicated participant in standings");
        for (const p of participants) {
          assert(seenIds.has(p.id), `Standings should include ${p.id}`);
        }

        // Cumulative standings correctness: sum of gamesCompleted across all
        // players must equal totalSlots occupied by actual games played
        // (sum of each game's participant count).
        const totalParticipantSlots = Array.from(tournament.matches.values())
          .reduce((sum, g) => sum + g.participants.length, 0);
        const totalGamesCompleted = standings.reduce((sum, s) => sum + s.gamesCompleted, 0);
        assertEquals(totalGamesCompleted, totalParticipantSlots);

        // Standings sorted descending by points, sequential place numbers.
        for (let i = 0; i < standings.length - 1; i++) {
          assert(standings[i].points >= standings[i + 1].points);
        }
        for (let i = 0; i < standings.length; i++) {
          assertEquals(standings[i].place, i + 1);
        }

        // A single champion emerges at place 1.
        const champions = standings.filter((s) => s.place === 1);
        assertEquals(champions.length, 1);
      }
    );
  }
});

Deno.test("Mario Kart idempotency: re-recording same gameId result", async (t) => {
  await t.step("does not double-count points/gamesCompleted/wins", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: [15, 12, 10, 8],
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);
    const results = game.participants.map((pId) => ({ participantId: pId }));

    // First application.
    recordRaceResult(tournament, gameId, results, "player-1", 1000);

    const snapshotAfterFirst = Array.from(tournament.standings.values()).map((s) => ({
      participantId: s.participantId,
      points: s.points,
      gamesCompleted: s.gamesCompleted,
      wins: s.wins,
    }));

    // Re-apply the exact same result for the same gameId.
    recordRaceResult(tournament, gameId, results, "player-1", 1000);

    const snapshotAfterSecond = Array.from(tournament.standings.values()).map((s) => ({
      participantId: s.participantId,
      points: s.points,
      gamesCompleted: s.gamesCompleted,
      wins: s.wins,
    }));

    assertEquals(snapshotAfterSecond, snapshotAfterFirst, "Re-recording the same result must be a no-op");

    // Sanity: the winner's stats reflect exactly one game played, not two.
    const winner = tournament.standings.get(results[0].participantId);
    assertEquals(winner.gamesCompleted, 1);
    assertEquals(winner.wins, 1);
    assertEquals(winner.points, 15);
  });
});

Deno.test("Mario Kart correction: different result for same gameId replaces prior contribution", async (t) => {
  await t.step("swapping first and second place updates points/wins without accumulating", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      pointsTable: [15, 12, 10, 8],
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);
    const [a, b, c, d] = game.participants;

    // Original result: a wins, b second, c third, d fourth.
    recordRaceResult(tournament, gameId, [
      { participantId: a },
      { participantId: b },
      { participantId: c },
      { participantId: d },
    ], "player-1");

    assertEquals(tournament.standings.get(a).points, 15);
    assertEquals(tournament.standings.get(a).wins, 1);
    assertEquals(tournament.standings.get(b).points, 12);
    assertEquals(tournament.standings.get(b).wins, 0);

    // Correction: b actually won, a came second.
    recordRaceResult(tournament, gameId, [
      { participantId: b },
      { participantId: a },
      { participantId: c },
      { participantId: d },
    ], "player-2");

    // Points/wins should reflect ONLY the corrected result, not the sum of both.
    assertEquals(tournament.standings.get(b).points, 15, "b should now have winner's points, not 12+15");
    assertEquals(tournament.standings.get(b).wins, 1);
    assertEquals(tournament.standings.get(a).points, 12, "a should now have 2nd place points, not 15+12");
    assertEquals(tournament.standings.get(a).wins, 0, "a's win should be reversed");

    // gamesCompleted must remain 1 (not 2) for everyone in the game.
    for (const pId of game.participants) {
      const standing = tournament.standings.get(pId);
      assertEquals(standing.gamesCompleted, 1, `${pId} gamesCompleted should stay at 1 after correction`);
    }

    // The game's results reflect the corrected positions and points.
    assertEquals(game.results.slice(0, 2), [
      { participantId: b, position: 1, points: 15 },
      { participantId: a, position: 2, points: 12 },
    ]);

    // Winner id updated to reflect the new first-place finisher.
    assertEquals(game.winnerId, b);
  });

  await t.step("correction affecting fewer participants removes stale contribution for dropped participant", () => {
    // Same 4 participants, but the corrected result only reports 3 of them
    // (e.g. one participant's earlier "result" is superseded and they no
    // longer appear as a finisher in the corrected report).
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

    assertEquals(tournament.standings.get(d).points, 8);
    assertEquals(tournament.standings.get(d).gamesCompleted, 1);

    // Corrected report only includes a, b, c (d dropped out / was excluded).
    recordRaceResult(tournament, gameId, [
      { participantId: a },
      { participantId: b },
      { participantId: c },
    ], "player-1");

    // d's prior contribution must have been reversed since it's no longer part
    // of the result.
    assertEquals(tournament.standings.get(d).points, 0);
    assertEquals(tournament.standings.get(d).gamesCompleted, 0);

    // a, b, c reflect only the new (single) result.
    assertEquals(tournament.standings.get(a).points, 15);
    assertEquals(tournament.standings.get(a).gamesCompleted, 1);
    assertEquals(tournament.standings.get(c).points, 10);
    assertEquals(tournament.standings.get(c).gamesCompleted, 1);
  });
});

Deno.test("Mario Kart reportedAt", async (t) => {
  await t.step("preserves a passed-in reportedAt instead of overwriting with now", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);
    const results = game.participants.map((pId) => ({ participantId: pId }));

    const fixedTimestamp = 1_600_000_000_000; // arbitrary fixed point in the past
    recordRaceResult(tournament, gameId, results, "player-1", fixedTimestamp);

    assertEquals(game.reportedAt, fixedTimestamp);
  });

  await t.step("defaults to current time when reportedAt is omitted", () => {
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

  await t.step("re-recording preserves the newly passed reportedAt, not the original", () => {
    const participants = createParticipants(4);
    const tournament = generateMarioKartTournament(participants, {
      playersPerGame: 4,
      gamesPerPlayer: 1,
    });

    const gameId = tournament.matches.keys().next().value;
    const game = tournament.matches.get(gameId);
    const results = game.participants.map((pId) => ({ participantId: pId }));

    recordRaceResult(tournament, gameId, results, "player-1", 1000);
    assertEquals(game.reportedAt, 1000);

    recordRaceResult(tournament, gameId, results, "player-2", 2000);
    assertEquals(game.reportedAt, 2000);
    assertEquals(game.reportedBy, "player-2");
  });
});
