/**
 * Shared test fixtures and helper functions
 */

// ============================================
// DOM Mocking Utilities
// ============================================

/**
 * Create a mock DOM element with common properties/methods
 * @param {string} tag - Element tag name
 * @param {Object} options - Additional options
 * @returns {Object} Mock element
 */
export function createMockElement(tag = 'div', options = {}) {
  const children = [];
  const eventListeners = new Map();
  const classList = new Set(options.classList || []);

  const element = {
    tagName: tag.toUpperCase(),
    hidden: options.hidden ?? false,
    disabled: options.disabled ?? false,
    value: options.value ?? '',
    textContent: options.textContent ?? '',
    innerHTML: options.innerHTML ?? '',
    checked: options.checked ?? false,
    dataset: options.dataset ?? {},
    id: options.id ?? '',
    children,

    classList: {
      add: (...names) => names.forEach(n => classList.add(n)),
      remove: (...names) => names.forEach(n => classList.delete(n)),
      toggle: (name, force) => {
        if (force === undefined) {
          classList.has(name) ? classList.delete(name) : classList.add(name);
        } else if (force) {
          classList.add(name);
        } else {
          classList.delete(name);
        }
      },
      contains: (name) => classList.has(name),
      _set: classList,
    },

    addEventListener: (type, handler, options) => {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, []);
      }
      eventListeners.get(type).push({ handler, options });
    },

    removeEventListener: (type, handler) => {
      const listeners = eventListeners.get(type);
      if (listeners) {
        const idx = listeners.findIndex(l => l.handler === handler);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    },

    dispatchEvent: (event) => {
      const listeners = eventListeners.get(event.type) || [];
      listeners.forEach(({ handler }) => handler(event));
    },

    querySelector: (selector) => null,
    querySelectorAll: (selector) => [],
    closest: (selector) => null,
    showModal: function() { this._isOpen = true; },
    close: function() { this._isOpen = false; },
    _isOpen: false,
    select: () => {},
    focus: () => {},
    blur: () => {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),

    // Internal testing helpers
    _eventListeners: eventListeners,
    _triggerEvent: (type, eventData = {}) => {
      const event = { type, target: element, preventDefault: () => {}, stopPropagation: () => {}, ...eventData };
      element.dispatchEvent(event);
    },
  };

  return element;
}

/**
 * Create a mock document with getElementById and other DOM APIs
 * @returns {Object} Mock document
 */
export function createMockDocument() {
  const elements = new Map();
  const eventListeners = new Map();

  return {
    getElementById: (id) => elements.get(id) || null,

    querySelector: (selector) => {
      // Simple selector support
      if (selector.startsWith('#')) {
        return elements.get(selector.slice(1)) || null;
      }
      return null;
    },

    querySelectorAll: (selector) => [],

    createElement: (tag) => createMockElement(tag),

    body: {
      classList: {
        add: () => {},
        remove: () => {},
        toggle: () => {},
        contains: () => false,
      },
    },

    addEventListener: (type, handler) => {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, []);
      }
      eventListeners.get(type).push(handler);
    },

    removeEventListener: (type, handler) => {
      const listeners = eventListeners.get(type);
      if (listeners) {
        const idx = listeners.indexOf(handler);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    },

    // Testing helpers
    _elements: elements,
    _addElement: (id, el) => {
      el.id = id;
      elements.set(id, el);
      return el;
    },
    _eventListeners: eventListeners,
  };
}

/**
 * Create a mock P2P room connection
 * @param {string} selfId - Local peer ID
 * @returns {Object} Mock room
 */
export function createMockRoom(selfId = 'local-peer-id') {
  const actionHandlers = new Map();
  const broadcasts = [];
  const sentMessages = [];
  const peerJoinHandlers = [];
  const peerLeaveHandlers = [];
  let peers = new Map();

  return {
    selfId,

    // Action handling
    onAction: (type, handler) => {
      actionHandlers.set(type, handler);
    },

    broadcast: (type, payload) => {
      broadcasts.push({ type, payload, timestamp: Date.now() });
    },

    sendTo: (type, payload, peerId) => {
      const peerIds = Array.isArray(peerId) ? peerId : [peerId];
      peerIds.forEach(pid => {
        sentMessages.push({ type, payload, peerId: pid, timestamp: Date.now() });
      });
    },

    // Peer management
    onPeerJoin: (handler) => {
      peerJoinHandlers.push(handler);
    },

    onPeerLeave: (handler) => {
      peerLeaveHandlers.push(handler);
    },

    getPeers: () => Array.from(peers.keys()),
    getPeerCount: () => peers.size,

    leave: () => {
      peers.clear();
    },

    // Testing helpers
    _broadcasts: broadcasts,
    _sentMessages: sentMessages,
    _actionHandlers: actionHandlers,
    _peerJoinHandlers: peerJoinHandlers,
    _peerLeaveHandlers: peerLeaveHandlers,

    _simulateAction: (type, payload, fromPeerId) => {
      const handler = actionHandlers.get(type);
      if (handler) {
        handler(payload, fromPeerId);
      }
    },

    _simulatePeerJoin: (peerId) => {
      peers.set(peerId, {});
      peerJoinHandlers.forEach(h => h(peerId));
    },

    _simulatePeerLeave: (peerId) => {
      peers.delete(peerId);
      peerLeaveHandlers.forEach(h => h(peerId));
    },

    _clearBroadcasts: () => {
      broadcasts.length = 0;
    },

    _clearSentMessages: () => {
      sentMessages.length = 0;
    },
  };
}

/**
 * Create a mock localStorage
 * @returns {Object} Mock localStorage
 */
export function createMockLocalStorage() {
  const storage = new Map();

  return {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index) => [...storage.keys()][index] ?? null,
    get length() { return storage.size; },

    // Testing helper
    _storage: storage,
  };
}

/**
 * Create a mock navigator object
 * @param {Object} options - Navigator options
 * @returns {Object} Mock navigator
 */
export function createMockNavigator(options = {}) {
  return {
    clipboard: options.clipboard ?? {
      writeText: async (text) => {},
      readText: async () => '',
    },
    share: options.share, // undefined by default (not all browsers support)
  };
}

/**
 * Create mock window object for tests
 * @param {Object} options - Options
 * @returns {Object} Mock window
 */
export function createMockWindow(options = {}) {
  const eventListeners = new Map();

  return {
    seedlessRoom: options.room ?? null,
    location: {
      href: options.href ?? 'http://localhost/',
      pathname: options.pathname ?? '/',
      search: options.search ?? '',
      hash: options.hash ?? '',
    },
    history: {
      pushState: () => {},
      replaceState: () => {},
    },
    addEventListener: (type, handler) => {
      if (!eventListeners.has(type)) {
        eventListeners.set(type, []);
      }
      eventListeners.get(type).push(handler);
    },
    removeEventListener: (type, handler) => {
      const listeners = eventListeners.get(type);
      if (listeners) {
        const idx = listeners.indexOf(handler);
        if (idx >= 0) listeners.splice(idx, 1);
      }
    },
    _eventListeners: eventListeners,
    _dispatchEvent: (event) => {
      const listeners = eventListeners.get(event.type) || [];
      listeners.forEach(h => h(event));
    },
  };
}

// ============================================
// Test Data Fixtures
// ============================================

/**
 * Create an array of participants with sequential IDs and seeds
 * @param {number} count - Number of participants to create
 * @returns {Object[]} Array of participant objects
 */
export function createParticipants(count) {
  const baseTime = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    id: `player-${i + 1}`,
    name: `Player ${i + 1}`,
    seed: i + 1,
    joinedAt: baseTime - (count - i) * 1000,
    isConnected: true,
  }));
}

/**
 * Create a Map of participants keyed by ID
 * @param {Object[]} participants - Array of participants
 * @returns {Map} Map of participantId -> participant
 */
export function createParticipantMap(participants) {
  return new Map(participants.map(p => [p.id, p]));
}

// Pre-built participant sets for common test scenarios
export const participants2 = createParticipants(2);
export const participants3 = createParticipants(3);
export const participants4 = createParticipants(4);
export const participants5 = createParticipants(5);
export const participants8 = createParticipants(8);
export const participants16 = createParticipants(16);

/**
 * Create team assignments for doubles tournaments
 * @param {Object[]} participants - Array of participants
 * @param {number} teamSize - Number of players per team
 * @returns {Map} Map of participantId -> teamId
 */
export function createTeamAssignments(participants, teamSize = 2) {
  const assignments = new Map();
  let teamNum = 1;
  for (let i = 0; i < participants.length; i += teamSize) {
    const teamId = `team-${teamNum}`;
    for (let j = 0; j < teamSize && i + j < participants.length; j++) {
      assignments.set(participants[i + j].id, teamId);
    }
    teamNum++;
  }
  return assignments;
}

/**
 * Create incomplete team assignments (some participants unassigned)
 * @param {Object[]} participants - Array of participants
 * @param {number} assignCount - Number of participants to assign
 * @returns {Map} Map of participantId -> teamId
 */
export function createPartialTeamAssignments(participants, assignCount) {
  const assignments = new Map();
  let teamNum = 1;
  for (let i = 0; i < Math.min(assignCount, participants.length); i += 2) {
    const teamId = `team-${teamNum}`;
    assignments.set(participants[i].id, teamId);
    if (i + 1 < assignCount) {
      assignments.set(participants[i + 1].id, teamId);
    }
    teamNum++;
  }
  return assignments;
}

/**
 * Standard points table for mario kart tests
 */
export const standardPointsTable = [15, 12, 10, 8, 6, 4, 2, 1];

/**
 * Simulate playing a match and returning result
 * @param {string} winnerId - ID of the winner
 * @param {string[]} participants - Array of participant IDs in the match
 * @returns {Object} Match result object
 */
export function createMatchResult(winnerId, participants) {
  return {
    winnerId,
    scores: participants[0] === winnerId ? [2, 0] : [0, 2],
    reportedBy: winnerId,
  };
}
