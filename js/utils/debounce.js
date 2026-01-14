/**
 * Debounce Utility
 * Delays function execution until after wait milliseconds have elapsed
 * since the last time it was invoked
 */

/**
 * Creates a debounced function that delays invoking func until after wait
 * milliseconds have elapsed since the last time the debounced function was invoked.
 *
 * @param {Function} func - The function to debounce
 * @param {number} wait - The number of milliseconds to delay
 * @returns {Function} The debounced function
 */
export function debounce(func, wait) {
  let timeoutId = null;

  const debounced = function(...args) {
    const context = this;

    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      timeoutId = null;
      func.apply(context, args);
    }, wait);
  };

  /**
   * Cancel any pending debounced call
   */
  debounced.cancel = function() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  /**
   * Immediately invoke the debounced function if pending
   */
  debounced.flush = function() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
      func.apply(this);
    }
  };

  return debounced;
}
