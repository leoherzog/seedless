/**
 * URL State Management
 * Parse and update URL parameters for shareable links
 */

// URL parameter names
export const URL_PARAMS = {
  ROOM: 'room',
  VIEW: 'view',
  BRACKET: 'bracket', // 'winners' | 'losers' for double elim
};

// View names
export const VIEWS = {
  HOME: 'home',
  LOBBY: 'lobby',
  BRACKET: 'bracket',
  STANDINGS: 'standings',
  RESULTS: 'results',
};

/**
 * Parse current URL state
 * @returns {Object} URL state object
 */
export function parseUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    roomId: params.get(URL_PARAMS.ROOM),
    view: params.get(URL_PARAMS.VIEW) || VIEWS.HOME,
    bracketType: params.get(URL_PARAMS.BRACKET),
  };
}

/**
 * Update URL state
 * @param {Object} updates - Key-value pairs to update
 * @param {boolean} replace - Replace history instead of push
 */
export function updateUrlState(updates, replace = false) {
  const params = new URLSearchParams(window.location.search);

  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === undefined || value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }

  const queryString = params.toString();
  const newUrl = queryString
    ? `${window.location.pathname}?${queryString}`
    : window.location.pathname;

  if (replace) {
    window.history.replaceState({ urlState: parseUrlFromParams(params) }, '', newUrl);
  } else {
    window.history.pushState({ urlState: parseUrlFromParams(params) }, '', newUrl);
  }

  // Dispatch custom event for listeners
  window.dispatchEvent(new CustomEvent('urlstatechange', {
    detail: parseUrlState(),
  }));
}

/**
 * Parse URL state from URLSearchParams
 * @param {URLSearchParams} params
 * @returns {Object}
 */
function parseUrlFromParams(params) {
  return {
    roomId: params.get(URL_PARAMS.ROOM),
    view: params.get(URL_PARAMS.VIEW) || VIEWS.HOME,
    bracketType: params.get(URL_PARAMS.BRACKET),
  };
}

/**
 * Navigate to room lobby
 * @param {string} roomId - Room ID/slug
 */
export function navigateToRoom(roomId) {
  updateUrlState({
    [URL_PARAMS.ROOM]: roomId,
    [URL_PARAMS.VIEW]: VIEWS.LOBBY,
  });
}

/**
 * Navigate to bracket view
 * @param {string} bracketType - Optional bracket type for double elim
 */
export function navigateToBracket(bracketType = null) {
  updateUrlState({
    [URL_PARAMS.VIEW]: VIEWS.BRACKET,
    [URL_PARAMS.BRACKET]: bracketType,
  });
}

/**
 * Navigate to home (clear room)
 */
export function navigateToHome() {
  updateUrlState({
    [URL_PARAMS.ROOM]: null,
    [URL_PARAMS.VIEW]: VIEWS.HOME,
    [URL_PARAMS.BRACKET]: null,
  }, true);
}

/**
 * Generate shareable room link
 * @param {string} roomId - Room ID/slug
 * @returns {string} Full URL
 */
export function getRoomLink(roomId) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set(URL_PARAMS.ROOM, roomId);
  url.searchParams.set(URL_PARAMS.VIEW, VIEWS.LOBBY);
  return url.toString();
}

/**
 * Validate room slug format
 * @param {string} slug - Room slug to validate
 * @returns {boolean}
 */
export function isValidRoomSlug(slug) {
  // Lowercase letters, numbers, and hyphens only
  // Min 3 chars, max 50 chars
  return /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug);
}

/**
 * Sanitize room slug
 * @param {string} input - User input
 * @returns {string} Sanitized slug
 */
export function sanitizeRoomSlug(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

// Handle browser back/forward navigation
window.addEventListener('popstate', (event) => {
  const state = event.state?.urlState || parseUrlState();
  window.dispatchEvent(new CustomEvent('urlstatechange', {
    detail: state,
  }));
});
