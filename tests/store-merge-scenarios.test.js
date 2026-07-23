/**
 * Regression tests for state merge + serialization scenarios.
 *
 * Covers:
 *  1. Fresh joiner bootstrap - a store with no known admin (meta.adminId === null)
 *     merging an admin's authoritative snapshot must adopt bracket, standings,
 *     AND teamAssignments (not just meta), so it doesn't end up "active" with
 *     an empty bracket.
 *  2. The boolean `senderIsAdmin` contract on merge(): true grants admin
 *     authority; false from a stale peer with a lower version must not
 *     clobber meta/bracket/standings; a strictly-higher-version non-admin
 *     meta is still let through by the monotonic version guard (but does NOT
 *     grant authority over bracket/standings/teamAssignments).
 *  3. serialize() includes meta.adminToken (local persistence secret);
 *     serializeForNetwork() strips it so it is never leaked to peers.
 *  4. merge() preserves the local adminToken across a meta replacement that
 *     doesn't carry one (e.g. a peer's serializeForNetwork() snapshot).
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
      rounds: [
        { number: 1, matches: [{ id: "r1m0", participants: ["p1", "p2"], winnerId: null }] },
      ],
    };

    const remoteState = {
      meta: { id: "room-1", adminId: "admin-1", status: "active", version: 3 },
      bracket: remoteBracket,
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
    assertEquals(bracket.rounds[0].matches[0].id, "r1m0");

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
    store._state.bracket = { type: "single", rounds: [{ number: 1, matches: [] }] };
    store._state.standings = new Map([["old", { participantId: "old", points: 1 }]]);

    const remoteState = {
      meta: { adminId: "admin-1", status: "complete", version: 1 },
      bracket: { type: "single", rounds: [{ number: 2, matches: [] }] },
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
    store._state.bracket = { type: "single", rounds: [{ number: 1, matches: [] }], marker: "local" };
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

  await t.step("monotonic version guard lets strictly-higher-version non-admin meta through", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store.set("meta.version", 5);
    store.set("meta.status", "lobby");
    store._state.bracket = { type: "single", rounds: [], marker: "local" };
    store._state.standings = new Map([["local", { participantId: "local", points: 5 }]]);

    const remoteState = {
      // Same known adminId, but sender is NOT verified as the admin (e.g. a
      // regular peer merely echoing the adminId it knows about).
      meta: { adminId: "admin-1", status: "active", version: 6 },
      bracket: { type: "single", rounds: [], marker: "remote" },
      standings: [["remote", { participantId: "remote", points: 1 }]],
    };

    store.merge(remoteState, false);

    // Meta is let through because its version (6) is strictly higher than
    // local (5) - the monotonic guard, independent of admin authority.
    assertEquals(store.get("meta.version"), 6);
    assertEquals(store.get("meta.status"), "active");

    // But bracket/standings are admin-authoritative only, and this sender was
    // never verified as admin, so they must remain untouched.
    assertEquals(store.get("bracket").marker, "local", "non-admin sender must not adopt bracket even with higher meta version");
    const standings = store.get("standings");
    assert(standings.has("local"));
    assert(!standings.has("remote"), "non-admin sender must not adopt standings even with higher meta version");
  });
});

Deno.test("Store.serialize / serializeForNetwork - adminToken handling", async (t) => {
  await t.step("serialize() includes meta.adminToken for local persistence", () => {
    const store = new Store();
    store.set("meta.id", "room-1");
    store.set("meta.adminToken", "super-secret-reclaim-token");

    const snapshot = store.serialize();
    assertEquals(snapshot.meta.adminToken, "super-secret-reclaim-token");
  });

  await t.step("serializeForNetwork() strips meta.adminToken before broadcasting to peers", () => {
    const store = new Store();
    store.set("meta.id", "room-1");
    store.set("meta.adminToken", "super-secret-reclaim-token");

    const networkSnapshot = store.serializeForNetwork();
    assertEquals(networkSnapshot.meta.adminToken, undefined);
    assert(!("adminToken" in networkSnapshot.meta), "adminToken key must not be present at all");

    // Sanity: the local store's own state is untouched by taking a network snapshot.
    assertEquals(store.get("meta.adminToken"), "super-secret-reclaim-token");
  });

  await t.step("serializeForNetwork() does not mutate the underlying serialize() output shape otherwise", () => {
    const store = new Store();
    store.set("meta.id", "room-1");
    store.set("meta.name", "Friday Night Bracket");
    store.set("meta.adminToken", "secret");

    const networkSnapshot = store.serializeForNetwork();
    assertEquals(networkSnapshot.meta.id, "room-1");
    assertEquals(networkSnapshot.meta.name, "Friday Night Bracket");
  });
});

Deno.test("Store.merge - preserves local adminToken across meta replacement", async (t) => {
  await t.step("keeps local adminToken when remote meta (from serializeForNetwork) lacks one", () => {
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store.set("meta.adminToken", "local-reclaim-secret");
    store.set("meta.version", 1);

    // Simulate a peer's network snapshot: adminToken stripped by serializeForNetwork().
    const remoteState = {
      meta: { adminId: "admin-1", status: "active", version: 5 },
    };
    assert(!("adminToken" in remoteState.meta));

    store.merge(remoteState, true);

    assertEquals(store.get("meta.status"), "active", "meta replacement should still occur");
    assertEquals(
      store.get("meta.adminToken"),
      "local-reclaim-secret",
      "local adminToken must survive a meta replacement that carries none"
    );
  });

  await t.step("never adopts an attacker-supplied adminToken via the version guard", () => {
    // A non-admin peer (senderIsAdmin=false) can still get meta accepted by
    // sending a strictly-higher version. Its crafted meta must NOT be able to
    // overwrite the real admin's local reclaim token.
    const store = new Store();
    store.set("meta.adminId", "admin-1");
    store.set("meta.adminToken", "real-admin-secret");
    store.set("meta.version", 1);

    const attackerState = {
      meta: {
        adminId: "admin-1",
        status: "active",
        version: 999, // bumped to pass the monotonic guard
        adminToken: "attacker-planted-token",
      },
    };

    store.merge(attackerState, false); // NOT the verified admin

    assertEquals(store.get("meta.version"), 999, "higher-version meta is still accepted");
    assertEquals(
      store.get("meta.adminToken"),
      "real-admin-secret",
      "the real admin's local token must never be overwritten by remote meta"
    );
  });

  await t.step("drops a remote adminToken when we have no local token", () => {
    // A non-admin peer with no local token must not end up holding a
    // remote-supplied secret.
    const store = new Store();
    store.set("meta.version", 1);

    const remoteState = {
      meta: { adminId: "admin-1", status: "active", version: 5, adminToken: "leaked-or-forged" },
    };

    store.merge(remoteState, false);

    assertEquals(store.get("meta.adminToken"), undefined);
  });

});
