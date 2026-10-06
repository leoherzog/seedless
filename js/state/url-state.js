/**
 * URL State Management
 * Parse and update URL parameters for shareable links
 */

export const URL_PARAMS = {
  ROOM: 'room',
  VIEW: 'view',
};

export const VIEWS = {
  HOME: 'home',
  LOBBY: 'lobby',
  BRACKET: 'bracket',
};

export function parseUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    roomId: params.get(URL_PARAMS.ROOM),
    view: params.get(URL_PARAMS.VIEW) || VIEWS.HOME,
  };
}

const notifyUrlChange = () =>
  window.dispatchEvent(new CustomEvent('urlstatechange', { detail: parseUrlState() }));

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

  window.history[replace ? 'replaceState' : 'pushState'](null, '', newUrl);
  notifyUrlChange();
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
 */
export function navigateToBracket() {
  updateUrlState({ [URL_PARAMS.VIEW]: VIEWS.BRACKET });
}

/**
 * Navigate to home (clear room)
 */
export function navigateToHome() {
  updateUrlState({
    [URL_PARAMS.ROOM]: null,
    [URL_PARAMS.VIEW]: VIEWS.HOME,
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
 * Canonical slug used when a room is created or joined: the live-typed form without its trailing hyphen.
 * @param {string} input - User input
 * @returns {string} Sanitized slug
 */
export function sanitizeRoomSlug(input) {
  return formatRoomSlugInput(input).replace(/-$/, '');
}

/**
 * Formats a slug while typing. Unlike sanitizeRoomSlug it keeps one trailing hyphen so the next word can be typed.
 * @param {string} input - Raw input value
 * @returns {string} Formatted (in-progress) slug
 */
export function formatRoomSlugInput(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-/, '')
    .slice(0, 50);
}

window.addEventListener('popstate', notifyUrlChange);
