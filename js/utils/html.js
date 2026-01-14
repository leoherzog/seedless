/**
 * HTML Utility Functions
 * Shared utilities for safe HTML manipulation
 */

// Character map for HTML escaping (faster than DOM-based approach)
const htmlEscapes = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const htmlEscapeRegex = /[&<>"']/g;

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} HTML-safe string
 */
export function escapeHtml(text) {
  return String(text).replace(htmlEscapeRegex, char => htmlEscapes[char]);
}
