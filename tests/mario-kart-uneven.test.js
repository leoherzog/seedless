/**
 * Tests for Points Race seat planning when players × games doesn't divide by game size
 */

import { assert, assertEquals } from "jsr:@std/assert";
import {
  generateMarioKartTournament,
  planGames,
  recordRaceResult,
  suggestEvenGamesPerPlayer,
} from "../js/tournament/mario-kart.js";
import { createParticipants } from "./fixtures.js";

/**
 * Assert every structural rule a generated schedule must satisfy
 */
function assertValidSchedule(tournament, { players, playersPerGame, gamesPerPlayer, leftoverSeats }) {
  const seatCap = Math.min(playersPerGame, players);
  const scoredRaces = new Map();

  for (const game of tournament.matches.values()) {
    const field = game.participants;
    assertEquals(new Set(field).size, field.length, `${game.id} seats someone twice`);
    assert(field.length >= 2, `${game.id} has fewer than 2 racers`);
    assert(field.length <= seatCap, `${game.id} exceeds ${seatCap} seats`);
    if (leftoverSeats === "standins") {
      assertEquals(field.length, seatCap, `${game.id} should be full`);
    }
    for (const id of game.standIns) {
      assert(field.includes(id), `${game.id} stand-in missing from participants`);
    }
    for (const id of field) {
      if (!game.standIns.includes(id)) {
        scoredRaces.set(id, (scoredRaces.get(id) || 0) + 1);
      }
    }
  }

  assertEquals(scoredRaces.size, players);
  for (const [id, count] of scoredRaces) {
    assertEquals(count, gamesPerPlayer, `${id} should score exactly ${gamesPerPlayer} races`);
  }
}

Deno.test("planGames", async (t) => {
  await t.step("smaller mode spreads 7 players × 3 games over 6 games of 4 and 3", () => {
    const plan = planGames(7, { playersPerGame: 4, gamesPerPlayer: 3 });
    assertEquals(plan.map(g => g.scored), [4, 4, 4, 3, 3, 3]);
    assertEquals(plan.map(g => g.standIns), [0, 0, 0, 0, 0, 0]);
  });

  await t.step("standins mode fills the short games to 4", () => {
    const plan = planGames(7, { playersPerGame: 4, gamesPerPlayer: 3, leftoverSeats: "standins" });
    assertEquals(plan.map(g => g.scored), [4, 4, 4, 3, 3, 3]);
    assertEquals(plan.map(g => g.standIns), [0, 0, 0, 1, 1, 1]);
  });

  await t.step("even split has no short games or stand-ins in either mode", () => {
    for (const leftoverSeats of ["smaller", "standins"]) {
      const plan = planGames(8, { playersPerGame: 4, gamesPerPlayer: 3, leftoverSeats });
      assertEquals(plan.length, 6);
      assert(plan.every(g => g.scored === 4 && g.standIns === 0));
    }
  });

  await t.step("smaller mode adds a stand-in rather than plan a one-player game", () => {
    const plan = planGames(3, { playersPerGame: 2, gamesPerPlayer: 1 });
    assertEquals(plan, [{ scored: 2, standIns: 0 }, { scored: 1, standIns: 1 }]);
  });

  await t.step("caps game size at the player count", () => {
    const plan = planGames(3, { playersPerGame: 12, gamesPerPlayer: 2 });
    assertEquals(plan.map(g => g.scored), [3, 3]);
  });

  await t.step("returns no games for fewer than 2 players", () => {
    assertEquals(planGames(1, {}), []);
  });
});

Deno.test("suggestEvenGamesPerPlayer", async (t) => {
  await t.step("7 players at 4 per game need a multiple of 4 games", () => {
    assertEquals(suggestEvenGamesPerPlayer(7, { playersPerGame: 4, gamesPerPlayer: 3 }), [4]);
    assertEquals(suggestEvenGamesPerPlayer(7, { playersPerGame: 4, gamesPerPlayer: 5 }), [4, 8]);
  });

  await t.step("10 players at 4 per game need an even count", () => {
    assertEquals(suggestEvenGamesPerPlayer(10, { playersPerGame: 4, gamesPerPlayer: 3 }), [2, 4]);
  });

  await t.step("suggests nothing when the split is already even", () => {
    assertEquals(suggestEvenGamesPerPlayer(8, { playersPerGame: 4, gamesPerPlayer: 3 }), []);
    assertEquals(suggestEvenGamesPerPlayer(3, { playersPerGame: 4, gamesPerPlayer: 3 }), []);
  });

  await t.step("drops suggestions above maxGames", () => {
    assertEquals(suggestEvenGamesPerPlayer(13, { playersPerGame: 12, gamesPerPlayer: 13 }, 20), [12]);
  });

  await t.step("every suggestion yields equal full games", () => {
    for (let players = 2; players <= 16; players++) {
      for (let playersPerGame = 2; playersPerGame <= 12; playersPerGame++) {
        for (let gamesPerPlayer = 1; gamesPerPlayer <= 20; gamesPerPlayer++) {
          const config = { playersPerGame, gamesPerPlayer };
          const suggestions = suggestEvenGamesPerPlayer(players, config, 20);
          const isEven = planGames(players, config).every(g => g.scored === Math.min(playersPerGame, players));
          assertEquals(suggestions.length === 0, isEven, JSON.stringify({ players, ...config }));
          for (const count of suggestions) {
            const plan = planGames(players, { playersPerGame, gamesPerPlayer: count });
            assert(plan.every(g => g.scored === Math.min(playersPerGame, players) && g.standIns === 0));
          }
        }
      }
    }
  });
});

Deno.test("generateMarioKartTournament uneven splits", async (t) => {
  await t.step("7 players × 3 games never leaves a lone racer", () => {
    for (const leftoverSeats of ["smaller", "standins"]) {
      const cfg = { players: 7, playersPerGame: 4, gamesPerPlayer: 3, leftoverSeats };
      for (let run = 0; run < 25; run++) {
        const tournament = generateMarioKartTournament(createParticipants(7), cfg);
        assertValidSchedule(tournament, cfg);
        assertEquals(tournament.matches.size, 6);
      }
    }
  });

  await t.step("every player scores exactly gamesPerPlayer races across many configs", () => {
    for (const leftoverSeats of ["smaller", "standins"]) {
      for (const players of [2, 3, 5, 7, 10, 13]) {
        for (const playersPerGame of [2, 3, 4, 6, 8]) {
          for (const gamesPerPlayer of [1, 2, 3, 5]) {
            const cfg = { players, playersPerGame, gamesPerPlayer, leftoverSeats };
            const tournament = generateMarioKartTournament(createParticipants(players), cfg);
            assertValidSchedule(tournament, cfg);
          }
        }
      }
    }
  });

  await t.step("stand-in turns rotate between players", () => {
    // 5 players × 1 game at 4 per game: 2 games, 3 stand-in seats.
    const tournament = generateMarioKartTournament(createParticipants(5), {
      playersPerGame: 4,
      gamesPerPlayer: 1,
      leftoverSeats: "standins",
    });
    const standIns = Array.from(tournament.matches.values()).flatMap(g => g.standIns);
    assertEquals(standIns.length, 3);
    assertEquals(new Set(standIns).size, 3);
  });
});

Deno.test("recordRaceResult with stand-ins", async (t) => {
  const setup = () => {
    const tournament = generateMarioKartTournament(createParticipants(7), {
      playersPerGame: 4,
      gamesPerPlayer: 3,
      leftoverSeats: "standins",
      pointsTable: "sequential",
    });
    const game = Array.from(tournament.matches.values()).find(g => g.standIns.length === 1);
    const standIn = game.standIns[0];
    // Stand-in wins the race; everyone else follows in seat order.
    const order = [standIn, ...game.participants.filter(id => id !== standIn)];
    const results = order.map(participantId => ({ participantId }));
    return { tournament, game, standIn, order, results };
  };

  await t.step("stand-in takes a position but scores nothing", () => {
    const { tournament, game, standIn, order, results } = setup();
    recordRaceResult(tournament, game.id, results, order[1]);

    const standing = tournament.standings.get(standIn);
    assertEquals(standing.points, 0);
    assertEquals(standing.wins, 0);
    assertEquals(standing.gamesCompleted, 0);

    const standInResult = game.results.find(r => r.participantId === standIn);
    assertEquals(standInResult, { participantId: standIn, position: 1, points: 0, standIn: true });
  });

  await t.step("scored racers earn points for their place behind the stand-in", () => {
    const { tournament, game, order, results } = setup();
    recordRaceResult(tournament, game.id, results, order[1]);

    // Sequential over a 4-racer field: 2nd = 3, 3rd = 2, 4th = 1.
    assertEquals(tournament.standings.get(order[1]).points, 3);
    assertEquals(tournament.standings.get(order[2]).points, 2);
    assertEquals(tournament.standings.get(order[3]).points, 1);
  });

  await t.step("re-recording leaves the stand-in at zero", () => {
    const { tournament, game, standIn, order, results } = setup();
    recordRaceResult(tournament, game.id, results, order[1]);
    recordRaceResult(tournament, game.id, [...results].reverse(), order[1]);

    const standing = tournament.standings.get(standIn);
    assertEquals(standing.points, 0);
    assertEquals(standing.gamesCompleted, 0);
    assertEquals(tournament.standings.get(order[1]).points, 2);
  });
});
