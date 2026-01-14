/**
 * Toast Notification Component
 */

import { CONFIG } from '../../config.js';
import { escapeHtml } from '../utils/html.js';

// Lazy-initialized container reference
let container = null;

function getContainer() {
  if (!container) {
    container = document.getElementById('toast-container');
  }
  return container;
}

/**
 * Show a toast notification
 * @param {string} message - Message to display
 * @param {string} type - 'success' | 'error' | 'info'
 * @param {number} duration - Duration in ms (0 = permanent)
 */
export function showToast(message, type = 'info', duration = CONFIG.ui.toastDuration) {
  const toastContainer = getContainer();
  if (!toastContainer) {
    console.warn('[Toast] Container not found, cannot show toast:', message);
    return null;
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? 'fa-check-circle'
    : type === 'error' ? 'fa-exclamation-circle'
    : 'fa-info-circle';

  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${escapeHtml(message)}</span>
  `;

  toastContainer.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      removeToast(toast);
    }, duration);
  }

  return toast;
}

/**
 * Remove a toast
 */
export function removeToast(toast) {
  toast.classList.add('removing');
  setTimeout(() => {
    toast.remove();
  }, 300);
}

/**
 * Show success toast
 */
export function showSuccess(message) {
  return showToast(message, 'success');
}

/**
 * Show error toast
 */
export function showError(message) {
  return showToast(message, 'error');
}

/**
 * Show info toast
 */
export function showInfo(message) {
  return showToast(message, 'info');
}
