/**
 * Tests for the drag-and-drop list helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('getDragAfterElement', async (t) => {
  // Midpoints at y=125, 225 and 325.
  const container = createMockContainer([
    createMockElement(100, 50, 'elem1'),
    createMockElement(200, 50, 'elem2'),
    createMockElement(300, 50, 'elem3'),
  ]);

  await t.test('returns first element when dragging above all', () => {
    assert.deepStrictEqual(getDragAfterElement(container, 50).id, 'elem1');
  });

  await t.test('returns second element when dragging between first and second', () => {
    assert.deepStrictEqual(getDragAfterElement(container, 160).id, 'elem2');
  });

  await t.test('returns third element when dragging between second and third', () => {
    assert.deepStrictEqual(getDragAfterElement(container, 260).id, 'elem3');
  });

  await t.test('returns undefined when dragging below all elements', () => {
    assert.deepStrictEqual(getDragAfterElement(container, 400), undefined);
  });

  await t.test('returns undefined for empty container', () => {
    assert.deepStrictEqual(getDragAfterElement(createMockContainer([]), 100), undefined);
  });

  await t.test('returns next element when dragging at exact center', () => {
    const elements = [
      createMockElement(100, 50, 'elem1'), // center at 125
      createMockElement(200, 50, 'elem2'), // center at 225
    ];
    const container = createMockContainer(elements);

    // At exactly elem1's center, the row goes after elem1.
    const result = getDragAfterElement(container, 125);
    assert.deepStrictEqual(result.id, 'elem2');
  });

  await t.test('returns element just above when dragging slightly above center', () => {
    const elements = [
      createMockElement(100, 50, 'elem1'), // center at 125
      createMockElement(200, 50, 'elem2'), // center at 225
    ];
    const container = createMockContainer(elements);

    const result = getDragAfterElement(container, 124);
    assert.deepStrictEqual(result.id, 'elem1');
  });

  await t.test('handles single element container', () => {
    const elements = [
      createMockElement(100, 50, 'only'),
    ];
    const container = createMockContainer(elements);

    assert.deepStrictEqual(getDragAfterElement(container, 50).id, 'only');
    assert.deepStrictEqual(getDragAfterElement(container, 200), undefined);
  });

  await t.test('handles tightly packed elements', () => {
    const elements = [
      createMockElement(0, 50, 'elem1'),   // center at 25
      createMockElement(50, 50, 'elem2'),  // center at 75
      createMockElement(100, 50, 'elem3'), // center at 125
    ];
    const container = createMockContainer(elements);

    const result = getDragAfterElement(container, 40);
    assert.deepStrictEqual(result.id, 'elem2');
  });

  await t.test('handles elements with varying heights', () => {
    const elements = [
      createMockElement(0, 100, 'tall'),    // center at 50
      createMockElement(100, 20, 'short'),  // center at 110
      createMockElement(120, 60, 'medium'), // center at 150
    ];
    const container = createMockContainer(elements);

    const result = getDragAfterElement(container, 80);
    assert.deepStrictEqual(result.id, 'short');
  });
});

test('makeSortable', async (t) => {
  /** A list mock that records insertBefore calls, plus one li row. */
  function sortableList() {
    const list = createMockDomElement();
    list.inserted = [];
    list.insertBefore = (node, before) => list.inserted.push([node, before]);
    const row = createMockDomElement();
    list.rows = new Set([row]);
    list.contains = (node) => list.rows.has(node);
    let moves = 0;
    const controller = new AbortController();
    makeSortable(list, { signal: controller.signal, onMove: () => moves++ });
    const drag = (type, extra = {}) => list.dispatchEvent({ type, preventDefault() {}, ...extra });
    return { list, row, drag, moves: () => moves };
  }

  await t.test('moves the dragged row on dragover and reports each move', () => {
    const { list, row, drag, moves } = sortableList();
    drag('dragstart', { target: { closest: () => row }, dataTransfer: {} });
    assert(row.classList.contains('dragging'));

    drag('dragover', { clientY: 10 });
    assert.deepStrictEqual(list.inserted, [[row, null]]);
    assert.deepStrictEqual(moves(), 1);

    drag('dragend');
    assert(!row.classList.contains('dragging'));
  });

  await t.test('ignores dragover once a re-render has detached the dragged row', () => {
    const { list, row, drag, moves } = sortableList();
    drag('dragstart', { target: { closest: () => row }, dataTransfer: {} });
    list.rows.delete(row);

    drag('dragover', { clientY: 10 });
    assert.deepStrictEqual(list.inserted, []);
    assert.deepStrictEqual(moves(), 0);
  });

  await t.test('ignores dragover with no row dragged from this list', () => {
    const { list, drag, moves } = sortableList();
    drag('dragstart', { target: { closest: () => null }, dataTransfer: {} });
    drag('dragover', { clientY: 10 });
    assert.deepStrictEqual(list.inserted, []);
    assert.deepStrictEqual(moves(), 0);
  });
});
