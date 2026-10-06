/**
 * Toast notifications shown in #toast-container for CONFIG.ui.toastDuration.
 */

import { CONFIG } from '../../config.js';
import { escapeHtml } from '../utils/html.js';

/**
 * Show a toast notification.
 * @param {string} message - Message to display
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 */
export function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? 'fa-check-circle'
    : type === 'error' ? 'fa-exclamation-circle'
    : type === 'warning' ? 'fa-exclamation-triangle'
    : 'fa-info-circle';

  toast.innerHTML = `
    <span class="fa-solid ${icon}"></span>
    <span>${escapeHtml(message)}</span>
  `;

  document.getElementById('toast-container').appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    // Matches the .toast.removing slide-out animation.
    setTimeout(() => toast.remove(), 300);
  }, CONFIG.ui.toastDuration);
}

export function showSuccess(message) {
  showToast(message, 'success');
}

export function showError(message) {
  showToast(message, 'error');
}

export function showInfo(message) {
  showToast(message, 'info');
}
