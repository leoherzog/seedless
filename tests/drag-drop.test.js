/**
 * Tests for Drag-Drop Helper Functions
 */

import { assertEquals } from 'jsr:@std/assert';
import { getDragAfterElement } from '../js/utils/drag-drop.js';

/**
 * Create a mock DOM element with getBoundingClientRect
 * @param {number} top - Top position
 * @param {number} height - Element height
 * @param {string} id - Element identifier
 * @returns {Object} Mock element
 */
function createMockElement(top, height, id) {
  return {
    id,
    getBoundingClientRect() {
      return { top, height, bottom: top + height };
    }
  };
}

/**
 * Create a mock container with querySelectorAll
 * @param {Array} elements - Array of mock elements
 * @returns {Object} Mock container
 */
function createMockContainer(elements) {
  return {
    querySelectorAll(_selector) {
      return elements;
    }
  };
}

Deno.test('getDragAfterElement', async (t) => {
  await t.step('returns first element when dragging above all', () => {
    // Three elements at y=100, 200, 300 (each 50px tall)
    const elements = [
      createMockElement(100, 50, 'elem1'), // center at 125
      createMockElement(200, 50, 'elem2'), // center at 225
      createMockElement(300, 50, 'elem3'), // center at 325
    ];
    const container = createMockContainer(elements);

    // Dragging at y=50 (above all elements)
    const result = getDragAfterElement(container, 50);
    assertEquals(result.id, 'elem1');
  });

  await t.step('returns second element when dragging between first and second', () => {
    const elements = [
      createMockElement(100, 50, 'elem1'), // center at 125
      createMockElement(200, 50, 'elem2'), // center at 225
      createMockElement(300, 50, 'elem3'), // center at 325
    ];
    const container = createMockContainer(elements);

    // Dragging at y=160 (between elem1 and elem2, closer to elem2)
    const result = getDragAfterElement(container, 160);
    assertEquals(result.id, 'elem2');
  });

  await t.step('returns third element when dragging between second and third', () => {
    const elements = [
      createMockElement(100, 50, 'elem1'),
      createMockElement(200, 50, 'elem2'),
      createMockElement(300, 50, 'elem3'),
    ];
    const container = createMockContainer(elements);

    // Dragging at y=260 (between elem2 and elem3)
    const result = getDragAfterElement(container, 260);
    assertEquals(result.id, 'elem3');
  });

  await t.step('returns undefined when dragging below all elements', () => {
    const elements = [
      createMockElement(100, 50, 'elem1'),
      createMockElement(200, 50, 'elem2'),
      createMockElement(300, 50, 'elem3'),
    ];
    const container = createMockContainer(elements);

    // Dragging at y=400 (below all elements)
    const result = getDragAfterElement(container, 400);
    assertEquals(result, undefined);
  });

  await t.step('returns undefined for empty container', () => {
    const container = createMockContainer([]);
    const result = getDragAfterElement(container, 100);
    assertEquals(result, undefined);
  });

  await t.step('returns next element when dragging at exact center', () => {
    const elements = [
      createMockElement(100, 50, 'elem1'), // center at 125
      createMockElement(200, 50, 'elem2'), // center at 225
    ];
    const container = createMockContainer(elements);

    // Dragging at exactly y=125 (center of elem1)
    // offset for elem1 = 0 (not < 0, so not selected)
    // offset for elem2 = -100 (< 0 and > -Infinity, so selected)
    // This means: insert before elem2 (i.e., after elem1)
    const result = getDragAfterElement(container, 125);
    assertEquals(result.id, 'elem2');
  });

  await t.step('returns element just above when dragging slightly above center', () => {
    const elements = [
      createMockElement(100, 50, 'elem1'), // center at 125
      createMockElement(200, 50, 'elem2'), // center at 225
    ];
    const container = createMockContainer(elements);

    // Dragging at y=124 (just above center of elem1)
    const result = getDragAfterElement(container, 124);
    assertEquals(result.id, 'elem1');
  });

  await t.step('handles single element container', () => {
    const elements = [
      createMockElement(100, 50, 'only'),
    ];
    const container = createMockContainer(elements);

    // Above the element
    assertEquals(getDragAfterElement(container, 50).id, 'only');

    // Below the element
    assertEquals(getDragAfterElement(container, 200), undefined);
  });

  await t.step('handles tightly packed elements', () => {
    // Elements with no gaps between them
    const elements = [
      createMockElement(0, 50, 'elem1'),   // center at 25
      createMockElement(50, 50, 'elem2'),  // center at 75
      createMockElement(100, 50, 'elem3'), // center at 125
    ];
    const container = createMockContainer(elements);

    // At y=40 (between centers of elem1 and elem2, closer to elem2)
    const result = getDragAfterElement(container, 40);
    assertEquals(result.id, 'elem2');
  });

  await t.step('uses custom selector', () => {
    // The selector is passed to querySelectorAll, our mock ignores it
    // but we can verify the function accepts the parameter
    const elements = [createMockElement(100, 50, 'elem1')];
    const container = createMockContainer(elements);

    const result = getDragAfterElement(container, 50, '.custom-class');
    assertEquals(result.id, 'elem1');
  });

  await t.step('handles elements with varying heights', () => {
    const elements = [
      createMockElement(0, 100, 'tall'),    // center at 50
      createMockElement(100, 20, 'short'),  // center at 110
      createMockElement(120, 60, 'medium'), // center at 150
    ];
    const container = createMockContainer(elements);

    // Dragging at y=80 (below center of tall, above center of short)
    const result = getDragAfterElement(container, 80);
    assertEquals(result.id, 'short');
  });
});
