/**
 * Tests for the drag-and-drop list helpers.
 */

import { assert, assertEquals } from 'jsr:@std/assert';
import { getDragAfterElement, makeSortable } from '../js/utils/drag-drop.js';
import { createMockElement as createMockDomElement } from './fixtures.js';

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
  // Midpoints at y=125, 225 and 325.
  const container = createMockContainer([
    createMockElement(100, 50, 'elem1'),
    createMockElement(200, 50, 'elem2'),
    createMockElement(300, 50, 'elem3'),
  ]);

  await t.step('returns first element when dragging above all', () => {
    assertEquals(getDragAfterElement(container, 50).id, 'elem1');
  });

  await t.step('returns second element when dragging between first and second', () => {
    assertEquals(getDragAfterElement(container, 160).id, 'elem2');
  });

  await t.step('returns third element when dragging between second and third', () => {
    assertEquals(getDragAfterElement(container, 260).id, 'elem3');
  });

  await t.step('returns undefined when dragging below all elements', () => {
    assertEquals(getDragAfterElement(container, 400), undefined);
  });

  await t.step('returns undefined for empty container', () => {
    assertEquals(getDragAfterElement(createMockContainer([]), 100), undefined);
  });

  await t.step('returns next element when dragging at exact center', () => {
    const elements = [
      createMockElement(100, 50, 'elem1'), // center at 125
      createMockElement(200, 50, 'elem2'), // center at 225
    ];
    const container = createMockContainer(elements);

    // At exactly elem1's center, the row goes after elem1.
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

Deno.test('makeSortable', async (t) => {
  /** A list mock that records insertBefore calls, plus one li row. */
  function sortableList() {
    const list = createMockDomElement('ol');
    list.inserted = [];
    list.insertBefore = (node, before) => list.inserted.push([node, before]);
    const row = createMockDomElement('li');
    let moves = 0;
    const controller = new AbortController();
    makeSortable(list, { signal: controller.signal, onMove: () => moves++ });
    const drag = (type, extra = {}) => list.dispatchEvent({ type, preventDefault() {}, ...extra });
    return { list, row, drag, moves: () => moves };
  }

  await t.step('moves the dragged row on dragover and reports each move', () => {
    const { list, row, drag, moves } = sortableList();
    drag('dragstart', { target: { closest: () => row }, dataTransfer: {} });
    assert(row.classList.contains('dragging'));

    drag('dragover', { clientY: 10 });
    assertEquals(list.inserted, [[row, null]]);
    assertEquals(moves(), 1);

    drag('dragend');
    assert(!row.classList.contains('dragging'));
  });

  await t.step('ignores dragover with no row dragged from this list', () => {
    const { list, drag, moves } = sortableList();
    drag('dragstart', { target: { closest: () => null }, dataTransfer: {} });
    drag('dragover', { clientY: 10 });
    assertEquals(list.inserted, []);
    assertEquals(moves(), 0);
  });
});
