/**
 * Merge trust rules: which senders may change meta, bracket, standings and matches.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../js/state/store.js";

test("Store.merge - fresh joiner bootstrap", async (t) => {
  await t.test("adopts bracket, standings, and teamAssignments from admin snapshot, not just meta", () => {
    const store = new Store();
    // Fresh joiner: no known admin yet.
    assert.deepStrictEqual(store.get("meta.adminId"), null);
    assert.deepStrictEqual(store.get("bracket"), null);

    const remoteBracket = {
      type: "single",
      startedAt: 1,
      rounds: [{ number: 1, matchIds: ["r1m0"] }],
    };

    const remoteState = {
      meta: { id: "room-1", adminId: "admin-1", status: "active" },
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

    // senderIsAdmin is false on first contact, yet a joiner with no adminId trusts its first snapshot.
    store.merge(remoteState, false);

    assert.deepStrictEqual(store.get("meta.adminId"), "admin-1");
    assert.deepStrictEqual(store.get("meta.status"), "active");

    const bracket = store.get("bracket");
    assert(bracket !== null, "bracket should be adopted, not left null");
    assert.deepStrictEqual(bracket.rounds[0].matchIds[0], "r1m0");
    assert.deepStrictEqual(store.getMatch("r1m0").participants, ["p1", "p2"]);

    const standings = store.get("standings");
    assert(standings.has("p1"), "standings should be adopted");
    assert.deepStrictEqual(standings.get("p1").points, 10);

    const teamAssignments = store.get("teamAssignments");
    assert.deepStrictEqual(teamAssignments.get("p1"), "team-a");
    assert.deepStrictEqual(teamAssignments.get("p2"), "team-b");
  });
});

test("Store.merge - boolean senderIsAdmin contract", async (t) => {
  await t.test("merge(remote, true) grants admin authority over bracket/standings", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store._state.bracket = { type: "single", startedAt: 1, rounds: [{ number: 1, matchIds: [] }] };
    store._state.standings = new Map([["old", { participantId: "old", points: 1 }]]);

    const remoteState = {
      meta: { adminId: "admin-1", status: "complete" },
      bracket: { type: "single", startedAt: 2, rounds: [{ number: 2, matchIds: [] }] },
      standings: [["new", { participantId: "new", points: 99 }]],
    };

    store.merge(remoteState, true);

    assert.deepStrictEqual(store.get("meta.status"), "complete");
    assert.deepStrictEqual(store.get("bracket").rounds[0].number, 2);
    const standings = store.get("standings");
    assert(standings.has("new"));
    assert(!standings.has("old"));
  });

  await t.test("merge(remote, false) from a stale peer does not clobber meta/bracket/standings", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store.set("meta.status", "active");
    store._state.bracket = { type: "single", rounds: [{ number: 1, matchIds: [] }], marker: "local" };
    store._state.standings = new Map([["local", { participantId: "local", points: 5 }]]);

    const remoteState = {
      meta: { adminId: "admin-1", status: "lobby" },
      bracket: { type: "single", rounds: [], marker: "stale" },
      standings: [["stale", { participantId: "stale", points: 0 }]],
    };

    store.merge(remoteState, false);

    assert.deepStrictEqual(store.get("meta.status"), "active", "stale peer must not regress status");
    assert.deepStrictEqual(store.get("bracket").marker, "local", "stale peer must not clobber bracket");
    const standings = store.get("standings");
    assert(standings.has("local"));
    assert(!standings.has("stale"), "stale non-admin standings must be rejected");
  });

  await t.test("non-admin meta is ignored", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store.set("meta.status", "lobby");

    store.merge({ meta: { adminId: "attacker", status: "active", type: "double" } }, false);

    assert.deepStrictEqual(store.get("meta.adminId"), "admin-1", "a non-admin peer must not rewrite adminId");
    assert.deepStrictEqual(store.get("meta.status"), "lobby", "a non-admin peer must not change status");
    assert.deepStrictEqual(store.get("meta.type"), "single");
  });
});

test("Store.merge - adminId protection", async (t) => {
  const foreignMeta = { meta: { adminId: "other-admin", status: "active" } };

  await t.test("the admin keeps its own adminId against any sender", () => {
    const store = new Store();
    store.setAdmin(true);
    store.set("meta.adminId", "admin-1");

    store.merge(structuredClone(foreignMeta), false);
    assert.deepStrictEqual(store.get("meta.adminId"), "admin-1");

    store.merge(structuredClone(foreignMeta), true);
    assert.deepStrictEqual(store.get("meta.adminId"), "admin-1", "a trusted snapshot must not change the admin's own adminId");
    assert.deepStrictEqual(store.get("meta.status"), "active", "the rest of a trusted meta is adopted");
  });

  await t.test("a non-admin keeps its known adminId against any sender", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");

    store.merge(structuredClone(foreignMeta), false);
    assert.deepStrictEqual(store.get("meta.adminId"), "admin-1");

    store.merge(structuredClone(foreignMeta), true);
    assert.deepStrictEqual(store.get("meta.adminId"), "admin-1");
  });

  await t.test("a snapshot naming the local user as admin is ignored", () => {
    for (const knownAdminId of ["admin-1", null]) {
      const store = new Store();
      store.set("local.localUserId", "victim");
      store.set("meta.adminId", knownAdminId);

      store.merge({ meta: { adminId: "victim", status: "active" } }, true);

      assert.deepStrictEqual(store.get("meta.adminId"), knownAdminId);
      assert.deepStrictEqual(store.get("meta.status"), "lobby");
    }
  });
});

test("Store.merge - matches belong to one tournament", async (t) => {
  const result = (id, winnerId, reportedAt) => ({ id, participants: ["a", "d"], winnerId, reportedAt });

  /** A store holding a single-elimination bracket started at startedAt. */
  function storeWith(startedAt, matches) {
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store._state.bracket = { type: "single", startedAt, rounds: [] };
    store.setMatches(new Map(matches));
    return store;
  }

  await t.test("the admin's new tournament replaces a stale matches Map", () => {
    const store = storeWith(1, [
      ["r1m0", result("r1m0", "a", 500)],
      ["r2m0", { id: "r2m0", participants: ["a", null], winnerId: null }],
    ]);

    store.merge({
      bracket: { type: "single", startedAt: 2, rounds: [] },
      matches: [["r1m0", result("r1m0", null, null)]],
    }, true);

    assert.deepStrictEqual(store.get("bracket").startedAt, 2);
    assert.deepStrictEqual(store.getMatch("r1m0").winnerId, null, "an old result must not survive into the new tournament");
    assert.deepStrictEqual(store.getMatch("r2m0"), undefined);
  });

  await t.test("a non-admin peer's matches from another tournament are ignored", () => {
    const store = storeWith(2, [["r1m0", result("r1m0", null, null)]]);

    store.merge({
      bracket: { type: "single", startedAt: 1, rounds: [] },
      matches: [["r1m0", result("r1m0", "a", 500)]],
    }, false);

    assert.deepStrictEqual(store.getMatch("r1m0").winnerId, null);
  });

  await t.test("within a tournament only a newer result merges, never seats", () => {
    const empty = [["r2m0", { id: "r2m0", participants: [null, null], winnerId: null, reportedAt: null }]];
    const seated = { bracket: { type: "single", startedAt: 1, rounds: [] } };

    const fromAdmin = storeWith(1, empty);
    fromAdmin.merge({ ...seated, matches: [["r2m0", { id: "r2m0", participants: ["a", "b"], winnerId: null }]] }, true);
    assert.deepStrictEqual(fromAdmin.getMatch("r2m0").participants, [null, null], "a stale or empty admin slot never overwrites a seat");

    const fromPeer = storeWith(1, structuredClone(empty));
    fromPeer.merge({ ...seated, matches: [["r2m0", { ...result("r2m0", "a", 500), participants: ["x", "y"], scores: [2, 1] }]] }, false);
    const match = fromPeer.getMatch("r2m0");
    assert.deepStrictEqual([match.winnerId, match.reportedAt, match.scores], ["a", 500, [2, 1]]);
    assert.deepStrictEqual(match.participants, [null, null], "seats are re-derived, not merged");
  });

  await t.test("only the admin verifies, and unknown match ids are ignored", () => {
    const local = [["r1m0", result("r1m0", "a", 900)]];
    const verified = { bracket: { type: "single", startedAt: 1, rounds: [] }, matches: [
      ["r1m0", { ...result("r1m0", "d", 100), verifiedBy: "admin-1" }],
      ["bogus", { id: "bogus", participants: [], winnerId: "x", reportedAt: 9e15 }],
    ] };

    const fromPeer = storeWith(1, local);
    fromPeer.merge(structuredClone(verified), false);
    assert.deepStrictEqual(fromPeer.getMatch("r1m0").winnerId, "a", "a peer's verifiedBy carries no weight");
    assert.deepStrictEqual(fromPeer.getMatch("bogus"), undefined);

    const fromAdmin = storeWith(1, structuredClone(local));
    fromAdmin.merge(structuredClone(verified), true);
    assert.deepStrictEqual(fromAdmin.getMatch("r1m0").winnerId, "d", "the admin's verified result beats a newer report");
    assert.deepStrictEqual(fromAdmin.getMatch("r1m0").verifiedBy, "admin-1");
  });

  await t.test("a peer's newer result cannot replace a verified one", () => {
    const store = storeWith(1, [["r1m0", { ...result("r1m0", "a", 100), verifiedBy: "admin-1" }]]);

    store.merge({
      bracket: { type: "single", startedAt: 1, rounds: [] },
      matches: [["r1m0", { ...result("r1m0", "d", 9e15), version: 99 }]],
    }, false);

    assert.deepStrictEqual(store.getMatch("r1m0").winnerId, "a");
  });
});
