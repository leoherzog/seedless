/**
 * Tests for store.js
 */

import { describe, test, assertEqual, assertTrue, assertFalse } from './run.js';
import { Store, createInitialState } from '../js/state/store.js';

await describe('createInitialState', async () => {
  await test('returns object with expected properties', () => {
    const state = createInitialState();
    assertTrue(state.meta !== undefined, 'should have meta');
    assertTrue(state.participants instanceof Map, 'participants should be Map');
    assertTrue(state.matches instanceof Map, 'matches should be Map');
    assertTrue(state.standings instanceof Map, 'standings should be Map');
    assertTrue(state.local !== undefined, 'should have local');
  });

  await test('meta has default values', () => {
    const state = createInitialState();
    assertEqual(state.meta.id, null);
    assertEqual(state.meta.status, 'lobby');
    assertEqual(state.meta.type, 'single');
    assertEqual(state.meta.version, 0);
  });
});

await describe('Store.get', async () => {
  await test('returns undefined for non-existent path', () => {
    const store = new Store();
    assertEqual(store.get('nonexistent'), undefined);
  });

  await test('returns value for simple path', () => {
    const store = new Store();
    store.set('meta.id', 'test-room');
    assertEqual(store.get('meta.id'), 'test-room');
  });

  await test('returns nested value', () => {
    const store = new Store();
    assertEqual(store.get('meta.config.bestOf'), 1);
  });
});

await describe('Store.set', async () => {
  await test('sets simple value', () => {
    const store = new Store();
    store.set('meta.id', 'test-123');
    assertEqual(store.get('meta.id'), 'test-123');
  });

  await test('sets nested value', () => {
    const store = new Store();
    store.set('meta.config.bestOf', 3);
    assertEqual(store.get('meta.config.bestOf'), 3);
  });

  await test('emits change event', () => {
    const store = new Store();
    let emitted = false;
    store.on('change', () => { emitted = true; });
    store.set('meta.id', 'test');
    assertTrue(emitted, 'change event should be emitted');
  });
});

await describe('Store.batch', async () => {
  await test('sets multiple values', () => {
    const store = new Store();
    store.batch({
      'meta.id': 'room-1',
      'meta.name': 'Test Tournament',
      'meta.type': 'double',
    });
    assertEqual(store.get('meta.id'), 'room-1');
    assertEqual(store.get('meta.name'), 'Test Tournament');
    assertEqual(store.get('meta.type'), 'double');
  });

  await test('emits batch event', () => {
    const store = new Store();
    let emitted = false;
    store.on('batch', () => { emitted = true; });
    store.batch({ 'meta.id': 'test' });
    assertTrue(emitted, 'batch event should be emitted');
  });
});

await describe('Store.reset', async () => {
  await test('resets state to initial values', () => {
    const store = new Store();
    store.set('meta.id', 'test-room');
    store.set('meta.name', 'My Tournament');
    store.reset();
    assertEqual(store.get('meta.id'), null);
    assertEqual(store.get('meta.name'), '');
  });

  await test('emits reset event', () => {
    const store = new Store();
    let emitted = false;
    store.on('reset', () => { emitted = true; });
    store.reset();
    assertTrue(emitted, 'reset event should be emitted');
  });
});

await describe('Store.addParticipant', async () => {
  await test('adds new participant', () => {
    const store = new Store();
    store.addParticipant({ id: 'user-1', name: 'Alice' });
    const p = store.getParticipant('user-1');
    assertEqual(p.name, 'Alice');
    assertTrue(p.isConnected, 'should be connected');
  });

  await test('increments version', () => {
    const store = new Store();
    const v1 = store.get('meta.version');
    store.addParticipant({ id: 'user-1', name: 'Alice' });
    const v2 = store.get('meta.version');
    assertTrue(v2 > v1, 'version should increment');
  });

  await test('updates existing participant', () => {
    const store = new Store();
    store.addParticipant({ id: 'user-1', name: 'Alice', seed: 1 });
    store.addParticipant({ id: 'user-1', name: 'Alice Updated' });
    const p = store.getParticipant('user-1');
    assertEqual(p.name, 'Alice Updated');
    assertEqual(p.seed, 1, 'should preserve seed');
  });
});

await describe('Store.updateParticipant', async () => {
  await test('updates participant properties', () => {
    const store = new Store();
    store.addParticipant({ id: 'user-1', name: 'Alice' });
    store.updateParticipant('user-1', { name: 'Alice Smith' });
    assertEqual(store.getParticipant('user-1').name, 'Alice Smith');
  });

  await test('does nothing for non-existent participant', () => {
    const store = new Store();
    store.updateParticipant('non-existent', { name: 'Test' });
    assertEqual(store.getParticipant('non-existent'), undefined);
  });
});

await describe('Store.removeParticipant', async () => {
  await test('removes participant', () => {
    const store = new Store();
    store.addParticipant({ id: 'user-1', name: 'Alice' });
    store.removeParticipant('user-1');
    assertEqual(store.getParticipant('user-1'), undefined);
  });

  await test('emits participant:leave event', () => {
    const store = new Store();
    store.addParticipant({ id: 'user-1', name: 'Alice' });
    let emitted = false;
    store.on('participant:leave', () => { emitted = true; });
    store.removeParticipant('user-1');
    assertTrue(emitted, 'participant:leave should be emitted');
  });
});

await describe('Store.serialize/deserialize', async () => {
  await test('serializes state to plain object', () => {
    const store = new Store();
    store.set('meta.id', 'test-room');
    store.addParticipant({ id: 'user-1', name: 'Alice' });

    const serialized = store.serialize();
    assertTrue(Array.isArray(serialized.participants), 'participants should be array');
    assertEqual(serialized.meta.id, 'test-room');
  });

  await test('deserializes state from plain object', () => {
    const store = new Store();
    const data = {
      meta: { id: 'restored-room', type: 'double', version: 5 },
      participants: [['user-1', { id: 'user-1', name: 'Bob' }]],
    };

    store.deserialize(data);
    assertEqual(store.get('meta.id'), 'restored-room');
    assertEqual(store.get('meta.type'), 'double');
    assertEqual(store.getParticipant('user-1').name, 'Bob');
  });
});

await describe('Store.isAdmin/setAdmin', async () => {
  await test('defaults to false', () => {
    const store = new Store();
    assertFalse(store.isAdmin());
  });

  await test('can be set to true', () => {
    const store = new Store();
    store.setAdmin(true);
    assertTrue(store.isAdmin());
  });

  await test('can be toggled', () => {
    const store = new Store();
    store.setAdmin(true);
    assertTrue(store.isAdmin());
    store.setAdmin(false);
    assertFalse(store.isAdmin());
  });
});
