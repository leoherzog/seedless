/**
 * Tests for debounce utility
 */

import { assertEquals } from 'jsr:@std/assert';
import { debounce } from '../js/utils/debounce.js';

// Helper to create a delay promise
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

Deno.test('debounce', async (t) => {
  await t.step('basic debouncing - multiple calls result in single execution', async () => {
    let callCount = 0;
    const debounced = debounce(() => callCount++, 50);

    debounced();
    debounced();
    debounced();

    assertEquals(callCount, 0, 'should not be called immediately');

    await delay(60);

    assertEquals(callCount, 1, 'should be called once after wait period');
  });

  await t.step('preserves arguments from last call', async () => {
    let receivedArgs = null;
    const debounced = debounce((...args) => {
      receivedArgs = args;
    }, 50);

    debounced(1, 2, 3);
    debounced(4, 5, 6);
    debounced(7, 8, 9);

    await delay(60);

    assertEquals(receivedArgs, [7, 8, 9], 'should receive args from last call');
  });

  await t.step('preserves this context', async () => {
    let receivedContext = null;
    const obj = {
      value: 42,
      method: debounce(function() {
        receivedContext = this;
      }, 50)
    };

    obj.method();

    await delay(60);

    assertEquals(receivedContext, obj, 'should preserve this context');
    assertEquals(receivedContext.value, 42);
  });

  await t.step('cancel prevents pending execution', async () => {
    let callCount = 0;
    const debounced = debounce(() => callCount++, 50);

    debounced();
    debounced.cancel();

    await delay(60);

    assertEquals(callCount, 0, 'should not be called after cancel');
  });

  await t.step('cancel is safe to call when nothing pending', () => {
    const debounced = debounce(() => {}, 50);

    // Should not throw
    debounced.cancel();
    debounced.cancel();
  });

  await t.step('flush immediately executes pending call', async () => {
    let callCount = 0;
    const debounced = debounce(() => callCount++, 50);

    debounced();
    assertEquals(callCount, 0, 'not called yet');

    debounced.flush();
    assertEquals(callCount, 1, 'called immediately after flush');

    await delay(60);
    assertEquals(callCount, 1, 'not called again after wait period');
  });

  await t.step('flush does nothing when no pending call', () => {
    let callCount = 0;
    const debounced = debounce(() => callCount++, 50);

    debounced.flush();
    assertEquals(callCount, 0, 'should not call when nothing pending');
  });

  await t.step('wait=0 still defers execution', async () => {
    let callCount = 0;
    const debounced = debounce(() => callCount++, 0);

    debounced();
    assertEquals(callCount, 0, 'should not be called synchronously');

    await delay(10);
    assertEquals(callCount, 1, 'should be called after next tick');
  });

  await t.step('rapid sequential calls - only last executes', async () => {
    const calls = [];
    const debounced = debounce((value) => calls.push(value), 30);

    for (let i = 0; i < 10; i++) {
      debounced(i);
      await delay(5);
    }

    await delay(40);

    assertEquals(calls.length, 1, 'should only execute once');
    assertEquals(calls[0], 9, 'should use value from last call');
  });

  await t.step('independent debounced functions do not interfere', async () => {
    let count1 = 0;
    let count2 = 0;
    const debounced1 = debounce(() => count1++, 50);
    const debounced2 = debounce(() => count2++, 50);

    debounced1();
    debounced2();
    debounced1.cancel();

    await delay(60);

    assertEquals(count1, 0, 'first should be cancelled');
    assertEquals(count2, 1, 'second should execute');
  });

  await t.step('can be called again after execution', async () => {
    let callCount = 0;
    const debounced = debounce(() => callCount++, 30);

    debounced();
    await delay(40);
    assertEquals(callCount, 1);

    debounced();
    await delay(40);
    assertEquals(callCount, 2);
  });
});
