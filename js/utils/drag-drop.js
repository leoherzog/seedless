/**
 * Shared Drag-and-Drop Utilities
 */

/**
 * Get the element after which the dragged item should be inserted
 * @param {HTMLElement} container - The container element
 * @param {number} y - The current y position of the drag
 * @param {string} selector - CSS selector for draggable elements (default: 'li:not(.dragging)')
 * @returns {HTMLElement|undefined} The element to insert after, or undefined for end of list
 */
export function getDragAfterElement(container, y, selector = 'li:not(.dragging)') {
  const draggableElements = [...container.querySelectorAll(selector)];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}
