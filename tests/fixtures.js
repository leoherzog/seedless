/**
 * Shared test fixtures: DOM and room mocks, participant builders and a bracket
 * play-through helper. Imports no app modules, so any test can load it cheaply.
 */

// Mock DOM

/**
 * Create a mock DOM element with the properties and methods the app touches
 * @param {string} tag - Element tag name
 * @param {Object} options - Initial property values
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

    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    showModal: () => {},
    close: () => {},
    select: () => {},
    focus: () => {},
    blur: () => {},
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  };

  return element;
}

/**
 * Create a mock document whose getElementById serves elements added with _addElement
 * @returns {Object} Mock document
 */
function createMockDocument() {
  const elements = new Map();

  return {
    getElementById: (id) => elements.get(id) || null,

    querySelector: (selector) => {
      if (selector.startsWith('#')) {
        return elements.get(selector.slice(1)) || null;
      }
      return null;
    },

    querySelectorAll: () => [],

    createElement: (tag) => createMockElement(tag),

    body: {
      classList: {
        add: () => {},
        remove: () => {},
        toggle: () => {},
        contains: () => false,
      },
    },

    addEventListener: () => {},
    removeEventListener: () => {},

    _elements: elements,
    _addElement: (id, el) => {
      el.id = id;
      elements.set(id, el);
      return el;
    },
  };
}

/**
 * Install a mock document holding the elements initBracketView and a render pass need
 * @returns {Object} The installed mock document
 */
export function installBracketViewDom() {
  const doc = createMockDocument();
  doc._addElement('score-modal', createMockElement('dialog'));
  doc._addElement('submit-score-btn', createMockElement('button'));
  doc._addElement('score1', createMockElement('input'));
  doc._addElement('score2', createMockElement('input'));
  for (const id of ['bracket-tabs', 'bracket-title', 'bracket-status', 'standings-panel', 'bracket-container']) {
    doc._addElement(id, createMockElement('div'));
  }
  doc._addElement('bracket-view', createMockElement('section', { hidden: false }));
  globalThis.document = doc;
  return doc;
}

/**
 * Create a mock P2P room with the interface sync.js uses
 * @param {string} selfId - Local peer ID
 * @returns {Object} Mock room
 */
export function createMockRoom(selfId = 'local-peer-id') {
  const actionHandlers = new Map();
  const broadcasts = [];
  const sentMessages = [];
  const joinHandlers = [];
  const leaveHandlers = [];
  let peers = [];

  return {
    selfId,

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

    onPeerJoin: (handler) => {
      joinHandlers.push(handler);
    },

    onPeerLeave: (handler) => {
      leaveHandlers.push(handler);
    },

    getPeers: () => peers,

    leave: () => {
      peers = [];
    },

    _broadcasts: broadcasts,
    _sentMessages: sentMessages,

    /** Deliver an action as if sent by fromPeerId; returns the handler's result. */
    _simulateAction: (type, payload, fromPeerId) => actionHandlers.get(type)?.(payload, fromPeerId),

    _simulatePeerJoin: (peerId) => {
      peers.push(peerId);
      joinHandlers.forEach(h => h(peerId));
    },

    _simulatePeerLeave: (peerId) => {
      peers = peers.filter(p => p !== peerId);
      leaveHandlers.forEach(h => h(peerId));
    },

    _setPeers: (ids) => {
      peers = ids;
    },

    _clearMessages: () => {
      broadcasts.length = 0;
      sentMessages.length = 0;
    },
  };
}

// Test data

/**
 * Create participants with sequential IDs and seeds
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

export const participants2 = createParticipants(2);
export const participants3 = createParticipants(3);
export const participants4 = createParticipants(4);
export const participants8 = createParticipants(8);

/**
 * Create team assignments for doubles tournaments, filling teams in order
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
 * Record a 2-0 result for every playable match until none remain. Each pass
 * records at least one result or stops, so a finite bracket always terminates.
 * @param {Object} bracket - Bracket with a matches Map
 * @param {Function} record - recordMatchResult(bracket, matchId, scores, winnerId, reportedBy)
 * @param {Function} pick - Chooses the winner of a match
 * @param {Function} [onRecord] - Called with each match after its result is recorded
 */
export function playToCompletion(bracket, record, pick = (m) => m.participants[0], onRecord) {
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const m of bracket.matches.values()) {
      if (m.isBye || m.winnerId || !m.participants[0] || !m.participants[1]) continue;
      const w = pick(m);
      record(bracket, m.id, [2, 0], w, w);
      onRecord?.(m);
      progressed = true;
    }
  }
}
