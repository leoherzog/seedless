/**
 * Drag-and-drop reordering for vertical lists of li rows.
 */

/**
 * The first non-dragging li whose vertical midpoint is below y.
 * @param {HTMLElement} container - The list element
 * @param {number} y - Pointer clientY
 * @returns {HTMLElement|undefined} The li to insert before, or undefined to append
 */
export function getDragAfterElement(container, y) {
  return [...container.querySelectorAll('li:not(.dragging)')].find((el) => {
    const box = el.getBoundingClientRect();
    return y < box.top + box.height / 2;
  });
}

/**
 * Let mouse drags reorder a list's li rows. The dragged row carries the
 * 'dragging' class until dragend, so a drop handler can tell a drag is live.
 * @param {HTMLElement} list - The list; its rows may be re-rendered freely
 * @param {{signal?: AbortSignal, onMove?: Function}} [options] - Listener lifetime, and a callback after each move
 */
export function makeSortable(list, { signal, onMove } = {}) {
  let dragged = null;

  list.addEventListener('dragstart', (e) => {
    dragged = e.target.closest('li');
    if (dragged) {
      dragged.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    }
  }, { signal });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!dragged) return;
    list.insertBefore(dragged, getDragAfterElement(list, e.clientY) ?? null);
    onMove?.();
  }, { signal });

  list.addEventListener('dragend', () => {
    dragged?.classList.remove('dragging');
    dragged = null;
  }, { signal });
}
