/**
 * Merge trust rules: which senders may change meta, bracket, standings and matches.
 */

import { assertEquals, assert } from "jsr:@std/assert";
import { Store } from "../js/state/store.js";

Deno.test("Store.merge - fresh joiner bootstrap", async (t) => {
  await t.step("adopts bracket, standings, and teamAssignments from admin snapshot, not just meta", () => {
    const store = new Store();
    // Fresh joiner: no known admin yet.
    assertEquals(store.get("meta.adminId"), null);
    assertEquals(store.get("bracket"), null);

    const remoteBracket = {
      type: "single",
      startedAt: 1,
      rounds: [{ number: 1, matchIds: ["r1m0"] }],
    };

    const remoteState = {
      meta: { id: "room-1", adminId: "admin-1", status: "active", version: 3 },
      bracket: remoteBracket,
      matches: [["r1m0", { id: "r1m0", participants: ["p1", "p2"], winnerId: null }]],
      standings: [
        ["p1", { participantId: "p1", name: "Alice", points: 10 }],
      ],
      teamAssignments: [
        ["p1", "team-a"],
        ["p2", "team-b"],
      ],
    };

    // Note: senderIsAdmin is false here (identity unverified on first contact) -
    // authority must still be granted because we are a fresh joiner bootstrapping
    // from the first state we've ever seen.
    store.merge(remoteState, false);

    assertEquals(store.get("meta.adminId"), "admin-1");
    assertEquals(store.get("meta.status"), "active");

    const bracket = store.get("bracket");
    assert(bracket !== null, "bracket should be adopted, not left null");
    assertEquals(bracket.rounds[0].matchIds[0], "r1m0");
    assertEquals(store.getMatch("r1m0").participants, ["p1", "p2"]);

    const standings = store.get("standings");
    assert(standings.has("p1"), "standings should be adopted");
    assertEquals(standings.get("p1").points, 10);

    const teamAssignments = store.get("teamAssignments");
    assertEquals(teamAssignments.get("p1"), "team-a");
    assertEquals(teamAssignments.get("p2"), "team-b");
  });
});

Deno.test("Store.merge - boolean senderIsAdmin contract", async (t) => {
  await t.step("merge(remote, true) grants admin authority over bracket/standings", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store.set("meta.version", 10);
    store._state.bracket = { type: "single", rounds: [{ number: 1, matchIds: [] }] };
    store._state.standings = new Map([["old", { participantId: "old", points: 1 }]]);

    const remoteState = {
      meta: { adminId: "admin-1", status: "complete", version: 1 },
      bracket: { type: "single", rounds: [{ number: 2, matchIds: [] }] },
      standings: [["new", { participantId: "new", points: 99 }]],
    };

    store.merge(remoteState, true);

    assertEquals(store.get("meta.status"), "complete");
    assertEquals(store.get("meta.version"), 1, "admin authority overrides even a lower version");
    assertEquals(store.get("bracket").rounds[0].number, 2);
    const standings = store.get("standings");
    assert(standings.has("new"));
    assert(!standings.has("old"));
  });

  await t.step("merge(remote, false) from a stale peer with lower version does not clobber meta/bracket/standings", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store.set("meta.version", 10);
    store.set("meta.status", "active");
    store._state.bracket = { type: "single", rounds: [{ number: 1, matchIds: [] }], marker: "local" };
    store._state.standings = new Map([["local", { participantId: "local", points: 5 }]]);

    const remoteState = {
      meta: { adminId: "admin-1", status: "lobby", version: 2 },
      bracket: { type: "single", rounds: [], marker: "stale" },
      standings: [["stale", { participantId: "stale", points: 0 }]],
    };

    store.merge(remoteState, false);

    assertEquals(store.get("meta.status"), "active", "stale peer must not regress status");
    assertEquals(store.get("meta.version"), 10, "stale peer must not regress version");
    assertEquals(store.get("bracket").marker, "local", "stale peer must not clobber bracket");
    const standings = store.get("standings");
    assert(standings.has("local"));
    assert(!standings.has("stale"), "stale non-admin standings must be rejected");
  });

  await t.step("non-admin meta is ignored even when its version is higher", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store.set("meta.version", 5);
    store.set("meta.status", "lobby");

    store.merge({ meta: { adminId: "attacker", status: "active", type: "double", version: 999 } }, false);

    assertEquals(store.get("meta.adminId"), "admin-1", "a non-admin peer must not rewrite adminId");
    assertEquals(store.get("meta.status"), "lobby", "a non-admin peer must not change status");
    assertEquals(store.get("meta.type"), "single");
    assertEquals(store.get("meta.version"), 5);
  });
});

Deno.test("Store.merge - adminId protection", async (t) => {
  const foreignMeta = { meta: { adminId: "other-admin", status: "active", version: 999 } };

  await t.step("the admin keeps its own adminId against any sender", () => {
    const store = new Store();
    store.setAdmin(true);
    store.set("meta.adminId", "admin-1");

    store.merge(structuredClone(foreignMeta), false);
    assertEquals(store.get("meta.adminId"), "admin-1");

    store.merge(structuredClone(foreignMeta), true);
    assertEquals(store.get("meta.adminId"), "admin-1", "a trusted snapshot must not change the admin's own adminId");
    assertEquals(store.get("meta.status"), "active", "the rest of a trusted meta is adopted");
  });

  await t.step("a non-admin keeps its known adminId unless a trusted snapshot corrects it", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");

    store.merge(structuredClone(foreignMeta), false);
    assertEquals(store.get("meta.adminId"), "admin-1");

    store.merge(structuredClone(foreignMeta), true);
    assertEquals(store.get("meta.adminId"), "other-admin");
  });
});

Deno.test("Store.merge - matches belong to one tournament", async (t) => {
  const result = (id, winnerId, reportedAt) => ({ id, participants: ["a", "d"], winnerId, reportedAt });

  /** A store holding a single-elimination bracket started at startedAt. */
  function storeWith(startedAt, matches) {
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store._state.bracket = { type: "single", startedAt, rounds: [] };
    store.setMatches(new Map(matches));
    return store;
  }

  await t.step("the admin's new tournament replaces a stale matches Map", () => {
    const store = storeWith(1, [
      ["r1m0", result("r1m0", "a", 500)],
      ["r2m0", { id: "r2m0", participants: ["a", null], winnerId: null }],
    ]);

    store.merge({
      bracket: { type: "single", startedAt: 2, rounds: [] },
      matches: [["r1m0", result("r1m0", null, null)]],
    }, true);

    assertEquals(store.get("bracket").startedAt, 2);
    assertEquals(store.getMatch("r1m0").winnerId, null, "an old result must not survive into the new tournament");
    assertEquals(store.getMatch("r2m0"), undefined);
  });

  await t.step("a non-admin peer's matches from another tournament are ignored", () => {
    const store = storeWith(2, [["r1m0", result("r1m0", null, null)]]);

    store.merge({
      bracket: { type: "single", startedAt: 1, rounds: [] },
      matches: [["r1m0", result("r1m0", "a", 500)]],
    }, false);

    assertEquals(store.getMatch("r1m0").winnerId, null);
  });

  await t.step("within a tournament a reportedAt tie goes to the admin only", () => {
    const empty = [["r2m0", { id: "r2m0", participants: [null, null], reportedAt: null }]];
    const remote = {
      bracket: { type: "single", startedAt: 1, rounds: [] },
      matches: [["r2m0", { id: "r2m0", participants: ["a", "b"], reportedAt: null }]],
    };

    const fromPeer = storeWith(1, empty);
    fromPeer.merge(remote, false);
    assertEquals(fromPeer.getMatch("r2m0").participants, [null, null]);

    const fromAdmin = storeWith(1, structuredClone(empty));
    fromAdmin.merge(remote, true);
    assertEquals(fromAdmin.getMatch("r2m0").participants, ["a", "b"], "the admin's slot fill arrives");
  });
});
