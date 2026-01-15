/**
 * Tests for store.js
 */

import { assertEquals, assert, assertFalse } from "jsr:@std/assert";
import { Store, createInitialState } from "../js/state/store.js";

Deno.test("createInitialState", async (t) => {
  await t.step("returns object with expected properties", () => {
    const state = createInitialState();
    assert(state.meta !== undefined, "should have meta");
    assert(state.participants instanceof Map, "participants should be Map");
    assert(state.matches instanceof Map, "matches should be Map");
    assert(state.standings instanceof Map, "standings should be Map");
    assert(state.local !== undefined, "should have local");
  });

  await t.step("meta has default values", () => {
    const state = createInitialState();
    assertEquals(state.meta.id, null);
    assertEquals(state.meta.status, "lobby");
    assertEquals(state.meta.type, "single");
    assertEquals(state.meta.version, 0);
  });
});

Deno.test("Store.get", async (t) => {
  await t.step("returns undefined for non-existent path", () => {
    const store = new Store();
    assertEquals(store.get("nonexistent"), undefined);
  });

  await t.step("returns value for simple path", () => {
    const store = new Store();
    store.set("meta.id", "test-room");
    assertEquals(store.get("meta.id"), "test-room");
  });

  await t.step("returns nested value", () => {
    const store = new Store();
    assertEquals(store.get("meta.config.bestOf"), 1);
  });
});

Deno.test("Store.set", async (t) => {
  await t.step("sets simple value", () => {
    const store = new Store();
    store.set("meta.id", "test-123");
    assertEquals(store.get("meta.id"), "test-123");
  });

  await t.step("sets nested value", () => {
    const store = new Store();
    store.set("meta.config.bestOf", 3);
    assertEquals(store.get("meta.config.bestOf"), 3);
  });

  await t.step("emits change event", () => {
    const store = new Store();
    let emitted = false;
    store.on("change", () => { emitted = true; });
    store.set("meta.id", "test");
    assert(emitted, "change event should be emitted");
  });
});

Deno.test("Store.batch", async (t) => {
  await t.step("sets multiple values", () => {
    const store = new Store();
    store.batch({
      "meta.id": "room-1",
      "meta.name": "Test Tournament",
      "meta.type": "double",
    });
    assertEquals(store.get("meta.id"), "room-1");
    assertEquals(store.get("meta.name"), "Test Tournament");
    assertEquals(store.get("meta.type"), "double");
  });

  await t.step("emits batch event", () => {
    const store = new Store();
    let emitted = false;
    store.on("batch", () => { emitted = true; });
    store.batch({ "meta.id": "test" });
    assert(emitted, "batch event should be emitted");
  });
});

Deno.test("Store.reset", async (t) => {
  await t.step("resets state to initial values", () => {
    const store = new Store();
    store.set("meta.id", "test-room");
    store.set("meta.name", "My Tournament");
    store.reset();
    assertEquals(store.get("meta.id"), null);
    assertEquals(store.get("meta.name"), "");
  });

  await t.step("emits reset event", () => {
    const store = new Store();
    let emitted = false;
    store.on("reset", () => { emitted = true; });
    store.reset();
    assert(emitted, "reset event should be emitted");
  });
});

Deno.test("Store.addParticipant", async (t) => {
  await t.step("adds new participant", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice" });
    const p = store.getParticipant("user-1");
    assertEquals(p.name, "Alice");
    assert(p.isConnected, "should be connected");
  });

  await t.step("increments version", () => {
    const store = new Store();
    const v1 = store.get("meta.version");
    store.addParticipant({ id: "user-1", name: "Alice" });
    const v2 = store.get("meta.version");
    assert(v2 > v1, "version should increment");
  });

  await t.step("updates existing participant", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice", seed: 1 });
    store.addParticipant({ id: "user-1", name: "Alice Updated" });
    const p = store.getParticipant("user-1");
    assertEquals(p.name, "Alice Updated");
    assertEquals(p.seed, 1, "should preserve seed");
  });
});

Deno.test("Store.updateParticipant", async (t) => {
  await t.step("updates participant properties", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice" });
    store.updateParticipant("user-1", { name: "Alice Smith" });
    assertEquals(store.getParticipant("user-1").name, "Alice Smith");
  });

  await t.step("does nothing for non-existent participant", () => {
    const store = new Store();
    store.updateParticipant("non-existent", { name: "Test" });
    assertEquals(store.getParticipant("non-existent"), undefined);
  });
});

Deno.test("Store.removeParticipant", async (t) => {
  await t.step("removes participant", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice" });
    store.removeParticipant("user-1");
    assertEquals(store.getParticipant("user-1"), undefined);
  });

  await t.step("emits participant:leave event", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice" });
    let emitted = false;
    store.on("participant:leave", () => { emitted = true; });
    store.removeParticipant("user-1");
    assert(emitted, "participant:leave should be emitted");
  });
});

Deno.test("Store.serialize/deserialize", async (t) => {
  await t.step("serializes state to plain object", () => {
    const store = new Store();
    store.set("meta.id", "test-room");
    store.addParticipant({ id: "user-1", name: "Alice" });

    const serialized = store.serialize();
    assert(Array.isArray(serialized.participants), "participants should be array");
    assertEquals(serialized.meta.id, "test-room");
  });

  await t.step("deserializes state from plain object", () => {
    const store = new Store();
    const data = {
      meta: { id: "restored-room", type: "double", version: 5 },
      participants: [["user-1", { id: "user-1", name: "Bob" }]],
    };

    store.deserialize(data);
    assertEquals(store.get("meta.id"), "restored-room");
    assertEquals(store.get("meta.type"), "double");
    assertEquals(store.getParticipant("user-1").name, "Bob");
  });
});

Deno.test("Store.isAdmin/setAdmin", async (t) => {
  await t.step("defaults to false", () => {
    const store = new Store();
    assertFalse(store.isAdmin());
  });

  await t.step("can be set to true", () => {
    const store = new Store();
    store.setAdmin(true);
    assert(store.isAdmin());
  });

  await t.step("can be toggled", () => {
    const store = new Store();
    store.setAdmin(true);
    assert(store.isAdmin());
    store.setAdmin(false);
    assertFalse(store.isAdmin());
  });
});

Deno.test("Store.merge - meta resolution", async (t) => {
  await t.step("prefers remote admin state over local non-admin", () => {
    const store = new Store();
    store.set("meta.version", 10);
    store.set("meta.status", "lobby");
    store.set("meta.adminId", "local-admin");

    const remoteState = {
      meta: { version: 5, status: "active", adminId: "remote-admin" },
    };

    // Remote is admin (remoteAdminId matches remote state's adminId)
    store.merge(remoteState, "remote-admin");

    // Admin state should win despite lower version
    assertEquals(store.get("meta.status"), "active");
    assertEquals(store.get("meta.version"), 5);
  });

  await t.step("prefers higher version when neither is admin", () => {
    const store = new Store();
    store.set("meta.version", 3);
    store.set("meta.status", "lobby");

    const remoteState = {
      meta: { version: 10, status: "active" },
    };

    // Neither is admin
    store.merge(remoteState, null);

    assertEquals(store.get("meta.status"), "active");
    assertEquals(store.get("meta.version"), 10);
  });

  await t.step("keeps local when local version is higher and remote not admin", () => {
    const store = new Store();
    store.set("meta.version", 10);
    store.set("meta.status", "lobby");

    const remoteState = {
      meta: { version: 3, status: "active" },
    };

    store.merge(remoteState, null);

    assertEquals(store.get("meta.status"), "lobby");
    assertEquals(store.get("meta.version"), 10);
  });
});

Deno.test("Store.merge - participant OR-Set", async (t) => {
  await t.step("adds new participants from remote", () => {
    const store = new Store();
    store.addParticipant({ id: "local-1", name: "Alice", joinedAt: 1000 });

    const remoteState = {
      participants: [
        ["remote-1", { id: "remote-1", name: "Bob", joinedAt: 2000 }],
      ],
    };

    store.merge(remoteState, null);

    // Both should exist (OR-Set: additions win)
    assert(store.getParticipant("local-1") !== undefined);
    assert(store.getParticipant("remote-1") !== undefined);
    assertEquals(store.getParticipant("remote-1").name, "Bob");
  });

  await t.step("uses LWW for conflicting participants", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Alice", joinedAt: 1000 });

    const remoteState = {
      participants: [
        ["user-1", { id: "user-1", name: "Alice Updated", joinedAt: 2000 }],
      ],
    };

    store.merge(remoteState, null);

    // Newer joinedAt wins
    assertEquals(store.getParticipant("user-1").name, "Alice Updated");
  });

  await t.step("keeps local participant if joinedAt is newer", () => {
    const store = new Store();
    store.addParticipant({ id: "user-1", name: "Local Alice", joinedAt: 2000 });

    const remoteState = {
      participants: [
        ["user-1", { id: "user-1", name: "Remote Alice", joinedAt: 1000 }],
      ],
    };

    store.merge(remoteState, null);

    // Local has newer joinedAt, should preserve but merge properties
    const p = store.getParticipant("user-1");
    // The implementation merges newer over older, so local values preserved
    assertEquals(p.joinedAt, 2000);
  });
});

Deno.test("Store.merge - match LWW with admin verification", async (t) => {
  await t.step("verified match wins over unverified", () => {
    const store = new Store();
    store.deserialize({
      matches: [
        ["m1", { id: "m1", winnerId: "p1", reportedAt: 2000, verifiedBy: null }],
      ],
    });

    const remoteState = {
      matches: [
        ["m1", { id: "m1", winnerId: "p2", reportedAt: 1000, verifiedBy: "admin" }],
      ],
    };

    store.merge(remoteState, null);

    // Admin verified should win despite older timestamp
    const match = store.getMatch("m1");
    assertEquals(match.winnerId, "p2");
    assertEquals(match.verifiedBy, "admin");
  });

  await t.step("keeps local verified over remote unverified", () => {
    const store = new Store();
    store.deserialize({
      matches: [
        ["m1", { id: "m1", winnerId: "p1", reportedAt: 1000, verifiedBy: "admin" }],
      ],
    });

    const remoteState = {
      matches: [
        ["m1", { id: "m1", winnerId: "p2", reportedAt: 2000, verifiedBy: null }],
      ],
    };

    store.merge(remoteState, null);

    // Local verified should be kept
    const match = store.getMatch("m1");
    assertEquals(match.winnerId, "p1");
  });

  await t.step("newer reportedAt wins when both unverified", () => {
    const store = new Store();
    store.deserialize({
      matches: [
        ["m1", { id: "m1", winnerId: "p1", reportedAt: 1000, verifiedBy: null }],
      ],
    });

    const remoteState = {
      matches: [
        ["m1", { id: "m1", winnerId: "p2", reportedAt: 2000, verifiedBy: null }],
      ],
    };

    store.merge(remoteState, null);

    // Newer timestamp wins
    const match = store.getMatch("m1");
    assertEquals(match.winnerId, "p2");
  });

  await t.step("adds new matches from remote", () => {
    const store = new Store();
    store.deserialize({
      matches: [
        ["m1", { id: "m1", winnerId: "p1" }],
      ],
    });

    const remoteState = {
      matches: [
        ["m2", { id: "m2", winnerId: "p3" }],
      ],
    };

    store.merge(remoteState, null);

    assert(store.getMatch("m1") !== undefined);
    assert(store.getMatch("m2") !== undefined);
  });
});

Deno.test("Store.merge - emits events", async (t) => {
  await t.step("emits merge event", () => {
    const store = new Store();
    let emitted = false;
    store.on("merge", () => { emitted = true; });

    store.merge({ meta: { version: 1 } }, null);

    assert(emitted, "merge event should be emitted");
  });

  await t.step("emits change event", () => {
    const store = new Store();
    let emitted = false;
    store.on("change", () => { emitted = true; });

    store.merge({ meta: { version: 1 } }, null);

    assert(emitted, "change event should be emitted");
  });
});

Deno.test("Store - additional methods", async (t) => {
  await t.step("off() removes event listener", () => {
    const store = new Store();
    let count = 0;
    const handler = () => { count++; };

    store.on("change", handler);
    store.set("meta.id", "test-1");
    assertEquals(count, 1);

    store.off("change", handler);
    store.set("meta.id", "test-2");
    assertEquals(count, 1, "handler should not be called after off()");
  });

  await t.step("getMatch() returns match by id", () => {
    const store = new Store();
    store.deserialize({
      matches: [
        ["m1", { id: "m1", winnerId: "p1" }],
      ],
    });

    const match = store.getMatch("m1");
    assertEquals(match.id, "m1");
    assertEquals(match.winnerId, "p1");
  });

  await t.step("getMatch() returns undefined for non-existent match", () => {
    const store = new Store();
    assertEquals(store.getMatch("non-existent"), undefined);
  });

  await t.step("setTeamAssignment() assigns participant to team", () => {
    const store = new Store();
    store.setTeamAssignment("user-1", "team-a");

    const assignments = store.getTeamAssignments();
    assertEquals(assignments.get("user-1"), "team-a");
  });

  await t.step("clearTeamAssignments() removes all assignments", () => {
    const store = new Store();
    store.setTeamAssignment("user-1", "team-a");
    store.setTeamAssignment("user-2", "team-b");

    store.clearTeamAssignments();

    const assignments = store.getTeamAssignments();
    assertEquals(assignments.size, 0);
  });

  await t.step("removeTeamAssignment() removes single assignment", () => {
    const store = new Store();
    store.setTeamAssignment("user-1", "team-a");
    store.setTeamAssignment("user-2", "team-b");

    store.removeTeamAssignment("user-1");

    const assignments = store.getTeamAssignments();
    assertEquals(assignments.get("user-1"), undefined);
    assertEquals(assignments.get("user-2"), "team-b");
  });

  await t.step("version increments by 1 on addParticipant", () => {
    const store = new Store();
    const v1 = store.get("meta.version");
    store.addParticipant({ id: "user-1", name: "Alice" });
    const v2 = store.get("meta.version");
    assertEquals(v2, v1 + 1, "version should increment by exactly 1");
  });
});
