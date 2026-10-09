/**
 * Tests for store.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../js/state/store.js";
import { createParticipants } from "./fixtures.js";

test("Store initial state", async (t) => {
  await t.test("holds Maps for keyed collections and a local section", () => {
    const store = new Store();
    assert(store.get("participants") instanceof Map, "participants should be Map");
    assert(store.get("matches") instanceof Map, "matches should be Map");
    assert(store.get("standings") instanceof Map, "standings should be Map");
    assert(store.get("teamAssignments") instanceof Map, "teamAssignments should be Map");
    assert(store.get("local") !== undefined, "should have local");
  });

  await t.test("meta has default values", () => {
    const store = new Store();
    assert.deepStrictEqual(store.get("meta.id"), null);
    assert.deepStrictEqual(store.get("meta.status"), "lobby");
    assert.deepStrictEqual(store.get("meta.type"), "single");
  });
});

test("Store.get", async (t) => {
  await t.test("returns undefined for non-existent path", () => {
    const store = new Store();
    assert.deepStrictEqual(store.get("nonexistent"), undefined);
  });

  await t.test("returns value for simple path", () => {
    const store = new Store();
    store.set("meta.id", "test-room");
    assert.deepStrictEqual(store.get("meta.id"), "test-room");
  });

  await t.test("returns nested value", () => {
    const store = new Store();
    assert.deepStrictEqual(store.get("meta.config.teamSize"), 2);
  });

  await t.test("returns undefined through a missing intermediate", () => {
    assert.deepStrictEqual(new Store().get("nonexistent.deep.path"), undefined);
  });
});

test("Store.set", async (t) => {
  await t.test("sets simple value", () => {
    const store = new Store();
    store.set("meta.id", "test-123");
    assert.deepStrictEqual(store.get("meta.id"), "test-123");
  });

  await t.test("sets nested value", () => {
    const store = new Store();
    store.set("meta.config.teamSize", 3);
    assert.deepStrictEqual(store.get("meta.config.teamSize"), 3);
  });

  await t.test("creates missing parent objects", () => {
    const store = new Store();
    store.set("nonexistent.deep.path", 1);
    assert.deepStrictEqual(store.get("nonexistent.deep.path"), 1);
  });

  await t.test("emits change event with the path", () => {
    const store = new Store();
    const paths = [];
    store.on("change", (e) => paths.push(e.path));
    store.set("meta.id", "test");
    assert.deepStrictEqual(paths, ["meta.id"]);
  });
});

test("Store.reset", async (t) => {
  await t.test("resets state to initial values", () => {
    const store = new Store();
    store.set("meta.id", "test-room");
    store.set("meta.name", "My Tournament");
    store.reset();
    assert.deepStrictEqual(store.get("meta.id"), null);
    assert.deepStrictEqual(store.get("meta.name"), "");
  });
});

test("Store.addParticipant", async (t) => {
  await t.test("adds new participant", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice" });
    const p = store.getParticipant("user-1");
    assert.deepStrictEqual(p.name, "Alice");
    assert(p.isConnected, "should be connected");
  });

  await t.test("assigns the next seed when none is given and keeps an explicit one", () => {
    const store = new Store();
    store.addParticipant({ id: "p1", name: "Player 1", seed: null });
    store.addParticipant({ id: "p2", name: "Player 2" });
    store.addParticipant({ id: "p3", name: "Player 3", seed: 5 });
    assert.deepStrictEqual(store.getParticipant("p1").seed, 1);
    assert.deepStrictEqual(store.getParticipant("p2").seed, 2);
    assert.deepStrictEqual(store.getParticipant("p3").seed, 5);
  });

  await t.test("updates existing participant", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice", seed: 1 });
    store.addParticipant({ id: "user-1", name: "Alice Updated" });
    const p = store.getParticipant("user-1");
    assert.deepStrictEqual(p.name, "Alice Updated");
    assert.deepStrictEqual(p.seed, 1, "should preserve seed");
  });
});

test("Store.updateParticipant", async (t) => {
  await t.test("updates participant properties", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice" });
    store.updateParticipant("user-1", { name: "Alice Smith" });
    assert.deepStrictEqual(store.getParticipant("user-1").name, "Alice Smith");
  });

  await t.test("does nothing for non-existent participant", () => {
    const store = new Store();
    store.updateParticipant("non-existent", { name: "Test" });
    assert.deepStrictEqual(store.getParticipant("non-existent"), undefined);
  });
});

test("Store.removeParticipant", async (t) => {
  await t.test("removes participant", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice" });
    store.removeParticipant("user-1");
    assert.deepStrictEqual(store.getParticipant("user-1"), undefined);
  });

  await t.test("emits participant:leave with the removed participant", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice" });
    const left = [];
    store.on("participant:leave", (p) => left.push(p));
    store.removeParticipant("user-1");
    assert.deepStrictEqual(left.length, 1);
    assert.deepStrictEqual(left[0].id, "user-1");
    assert.deepStrictEqual(left[0].name, "Alice");
  });

  await t.test("does nothing for non-existent participant", () => {
    const store = new Store();
    store.removeParticipant("non-existent");
    assert.deepStrictEqual(store.getParticipant("non-existent"), undefined);
    assert.deepStrictEqual(store.getParticipantList().length, 0);
  });
});

test("Store.addManualParticipant", async (t) => {
  await t.test("adds an offline, unclaimed participant with a manual_ id", () => {
    const store = new Store();
    store.addParticipant({ id: "online-1", name: "Online" });

    const manual = store.addManualParticipant("Offline");

    assert(manual.id.startsWith("manual_"));
    assert.deepStrictEqual(manual.name, "Offline");
    assert.deepStrictEqual(manual.isManual, true);
    assert.deepStrictEqual(manual.isConnected, false);
    assert.deepStrictEqual(manual.claimedBy, null);
    assert.deepStrictEqual(store.getParticipant(manual.id), manual);
    assert.deepStrictEqual(store.getParticipantList().length, 2);
  });
});

test("Store.addParticipant", async (t) => {
  await t.test("new participants default to connected but keep an explicit isConnected: false", () => {
    const store = new Store();
    store.addParticipant({ id: "online", name: "Online" });
    store.addParticipant({ id: "manual", name: "Manual", isManual: true, isConnected: false });

    assert.deepStrictEqual(store.getParticipant("online").isConnected, true);
    assert.deepStrictEqual(store.getParticipant("manual").isConnected, false);
  });
});

test("Store events", async (t) => {
  await t.test("addParticipant emits participant:join for a new participant", () => {
    const store = new Store();
    const joins = [];
    store.on("participant:join", (p) => joins.push(p));
    store.addParticipant({ id: "user-1", name: "Alice" });
    assert.deepStrictEqual(joins.map((p) => p.id), ["user-1"]);
  });

  await t.test("updateMatch applies the update and emits change for matches", () => {
    const store = new Store();
    store.deserialize({
      matches: [["r1m0", { id: "r1m0", participants: ["p1", "p2"], scores: [0, 0], winnerId: null }]],
    });
    const paths = [];
    store.on("change", (e) => paths.push(e.path));
    store.updateMatch("r1m0", { scores: [3, 1], winnerId: "p1" });
    assert.deepStrictEqual(paths, ["matches"]);
    assert.deepStrictEqual(store.getMatch("r1m0").winnerId, "p1");
  });
});

test("Store.serialize/deserialize", async (t) => {
  await t.test("serializes state to plain object", () => {
    const store = new Store();
    store.set("meta.id", "test-room");
    store.addParticipant({ id: "user-1", name: "Alice" });

    const serialized = store.serialize();
    assert(Array.isArray(serialized.participants), "participants should be array");
    assert.deepStrictEqual(serialized.meta.id, "test-room");
  });

  await t.test("deserializes state from plain object", () => {
    const store = new Store();
    const data = {
      meta: { id: "restored-room", type: "double" },
      participants: [["user-1", { id: "user-1", name: "Bob" }]],
    };

    store.deserialize(data);
    assert.deepStrictEqual(store.get("meta.id"), "restored-room");
    assert.deepStrictEqual(store.get("meta.type"), "double");
    assert.deepStrictEqual(store.getParticipant("user-1").name, "Bob");
  });

  await t.test("serializes an empty store with empty participants and matches", () => {
    const serialized = new Store().serialize();
    assert.deepStrictEqual(serialized.participants, []);
    assert.deepStrictEqual(serialized.matches, []);
  });

  await t.test("deserialize tolerates missing, empty and null fields", () => {
    const store = new Store();
    store.deserialize({});
    assert.deepStrictEqual(store.get("meta.status"), "lobby");
    assert.deepStrictEqual(store.getParticipantList().length, 0);
    assert.deepStrictEqual(store.get("bracket"), null);

    store.deserialize({ participants: [], matches: [], bracket: null });
    assert.deepStrictEqual(store.getParticipantList().length, 0);
    assert.deepStrictEqual(store.getMatch("any"), undefined);
    assert.deepStrictEqual(store.get("bracket"), null);
  });
});

test("Store.isAdmin/setAdmin", async (t) => {
  await t.test("defaults to false", () => {
    const store = new Store();
    assert.ok(!store.isAdmin());
  });

  await t.test("can be set to true", () => {
    const store = new Store();
    store.setAdmin(true);
    assert(store.isAdmin());
  });

  await t.test("can be toggled", () => {
    const store = new Store();
    store.setAdmin(true);
    assert(store.isAdmin());
    store.setAdmin(false);
    assert.ok(!store.isAdmin());
  });
});

test("Store.merge - participant OR-Set", async (t) => {
  await t.test("adds new participants from remote", () => {
    const store = new Store();
    store.addParticipant({ id: "local-1", name: "Alice", joinedAt: 1000 });

    const remoteState = {
      participants: [
        ["remote-1", { id: "remote-1", name: "Bob", joinedAt: 2000 }],
      ],
    };

    store.merge(remoteState, null);

    // Additions win: merge never removes a participant.
    assert(store.getParticipant("local-1") !== undefined);
    assert(store.getParticipant("remote-1") !== undefined);
    assert.deepStrictEqual(store.getParticipant("remote-1").name, "Bob");
  });

  await t.test("uses LWW for conflicting participants", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice", joinedAt: 1000 });

    const remoteState = {
      participants: [
        ["user-1", { id: "user-1", name: "Alice Updated", joinedAt: 2000 }],
      ],
    };

    store.merge(remoteState, null);

    // joinedAt is the LWW key when neither side has updatedAt.
    assert.deepStrictEqual(store.getParticipant("user-1").name, "Alice Updated");
  });

  await t.test("keeps local participant if joinedAt is newer", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Local Alice", joinedAt: 2000 });

    const remoteState = {
      participants: [
        ["user-1", { id: "user-1", name: "Remote Alice", joinedAt: 1000 }],
      ],
    };

    store.merge(remoteState, null);

    const p = store.getParticipant("user-1");
    assert.deepStrictEqual(p.joinedAt, 2000);
  });

  await t.test("partitioned stores converge after merging both ways", () => {
    const participants = createParticipants(4);
    const initial = () => ({
      meta: { status: "lobby", adminId: "admin" },
      participants: participants.map((p) => [p.id, { ...p }]),
    });
    const storeA = new Store();
    const storeB = new Store();
    storeA.deserialize(initial());
    storeB.deserialize(initial());

    storeA.addParticipant({ id: "p5", name: "Player 5" });
    storeB.addParticipant({ id: "p6", name: "Player 6" });

    storeA.merge(storeB.serialize(), false);
    storeB.merge(storeA.serialize(), false);

    const names = (store) => store.getParticipantList().map((p) => p.name).sort();
    assert.deepStrictEqual(storeA.getParticipantList().length, 6);
    assert.deepStrictEqual(storeB.getParticipantList().length, 6);
    assert.deepStrictEqual(names(storeA), names(storeB));
  });
});

test("Store.merge - match LWW with admin verification", async (t) => {
  /** A store holding m1 with the given result fields. */
  function storeWithMatch(fields) {
    const store = new Store();
    store.deserialize({ matches: [["m1", { id: "m1", participants: ["p1", "p2"], ...fields }]] });
    return store;
  }

  await t.test("the admin's verified match wins over a newer unverified one", () => {
    const store = storeWithMatch({ winnerId: "p1", reportedAt: 2000, verifiedBy: null });

    store.merge({ matches: [["m1", { id: "m1", participants: ["p1", "p2"], winnerId: "p2", reportedAt: 1000, verifiedBy: "admin" }]] }, true);

    const match = store.getMatch("m1");
    assert.deepStrictEqual(match.winnerId, "p2");
    assert.deepStrictEqual(match.verifiedBy, "admin");
  });

  await t.test("keeps local verified over remote unverified", () => {
    const store = storeWithMatch({ winnerId: "p1", reportedAt: 1000, verifiedBy: "admin" });

    store.merge({ matches: [["m1", { id: "m1", participants: ["p1", "p2"], winnerId: "p2", reportedAt: 2000, verifiedBy: null }]] }, true);

    assert.deepStrictEqual(store.getMatch("m1").winnerId, "p1");
  });

  await t.test("newer reportedAt wins when both unverified", () => {
    const store = storeWithMatch({ winnerId: "p1", reportedAt: 1000, verifiedBy: null });

    store.merge({ matches: [["m1", { id: "m1", participants: ["p1", "p2"], winnerId: "p2", reportedAt: 2000, verifiedBy: null }]] }, null);

    assert.deepStrictEqual(store.getMatch("m1").winnerId, "p2");
  });

  await t.test("ignores match ids the local tournament lacks", () => {
    const store = storeWithMatch({ winnerId: "p1" });

    store.merge({ matches: [["m2", { id: "m2", participants: ["p3", "p4"], winnerId: "p3" }]] }, null);

    assert(store.getMatch("m1") !== undefined);
    assert.deepStrictEqual(store.getMatch("m2"), undefined);
  });
});

test("Store.merge - emits events", async (t) => {
  await t.test("emits change event", () => {
    const store = new Store();
    let emitted = false;
    store.on("change", () => { emitted = true; });

    store.merge({ meta: { status: "active" } }, null);

    assert(emitted, "change event should be emitted");
  });
});

test("Store - additional methods", async (t) => {
  await t.test("the function returned by on() removes the listener", () => {
    const store = new Store();
    let count = 0;

    const unsubscribe = store.on("change", () => { count++; });
    store.set("meta.id", "test-1");
    assert.deepStrictEqual(count, 1);

    unsubscribe();
    store.set("meta.id", "test-2");
    assert.deepStrictEqual(count, 1, "handler should not be called after unsubscribing");
  });

  await t.test("getMatch() returns match by id", () => {
    const store = new Store();
    store.deserialize({
      matches: [
        ["m1", { id: "m1", winnerId: "p1" }],
      ],
    });

    const match = store.getMatch("m1");
    assert.deepStrictEqual(match.id, "m1");
    assert.deepStrictEqual(match.winnerId, "p1");
  });

  await t.test("getMatch() returns undefined for non-existent match", () => {
    const store = new Store();
    assert.deepStrictEqual(store.getMatch("non-existent"), undefined);
  });

  await t.test("setTeamAssignment() assigns participant to team", () => {
    const store = new Store();
    store.setTeamAssignment("user-1", "team-a");

    const assignments = store.getTeamAssignments();
    assert.deepStrictEqual(assignments.get("user-1"), "team-a");
  });

  await t.test("clearTeamAssignments() removes all assignments", () => {
    const store = new Store();
    store.setTeamAssignment("user-1", "team-a");
    store.setTeamAssignment("user-2", "team-b");

    store.clearTeamAssignments();

    const assignments = store.getTeamAssignments();
    assert.deepStrictEqual(assignments.size, 0);
  });

  await t.test("removeTeamAssignment() removes single assignment", () => {
    const store = new Store();
    store.setTeamAssignment("user-1", "team-a");
    store.setTeamAssignment("user-2", "team-b");

    store.removeTeamAssignment("user-1");

    const assignments = store.getTeamAssignments();
    assert.deepStrictEqual(assignments.get("user-1"), undefined);
    assert.deepStrictEqual(assignments.get("user-2"), "team-b");
  });
});
