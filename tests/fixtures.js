/**
 * Shared test fixtures: DOM and room mocks, participant builders and a bracket
 * play-through helper. Imports no app modules, so any test can load it cheaply.
 */

/**
 * Create a mock DOM element with the properties and methods the app touches
 * @param {Object} options - Initial property values
 * @returns {Object} Mock element
 */
export function createMockElement(options = {}) {
  const children = [];
  const eventListeners = new Map();
  const classList = new Set(options.classList || []);

  const element = {
    hidden: options.hidden ?? false,
    disabled: options.disabled ?? false,
    value: options.value ?? '',
    textContent: options.textContent ?? '',
    innerHTML: options.innerHTML ?? '',
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

    dispatchEvent: (event) => {
      const listeners = eventListeners.get(event.type) || [];
      listeners.forEach(({ handler }) => handler(event));
    },

    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    append: (...nodes) => children.push(...nodes),
    appendChild: (child) => {
      children.push(child);
      return child;
    },
    remove: () => {},
    showModal: () => {},
    close: () => {},
    select: () => {},
    focus: () => {},
    scrollIntoView: () => {},
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

    createElement: () => createMockElement(),

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
  doc._addElement('score-modal', createMockElement());
  doc._addElement('race-result-modal', createMockElement());
  doc._addElement('submit-score-btn', createMockElement());
  doc._addElement('submit-race-btn', createMockElement());
  doc._addElement('score1', createMockElement());
  doc._addElement('score2', createMockElement());
  doc._addElement('race-ranking-list', createMockElement());
  for (const id of ['bracket-tabs', 'bracket-title', 'bracket-status', 'standings-panel', 'bracket-container', 'final-standings']) {
    doc._addElement(id, createMockElement());
  }
  doc._addElement('bracket-view', createMockElement({ hidden: false }));
  doc._addElement('results-view', createMockElement({ hidden: true }));
  doc._addElement('tournament-history', createMockElement({ hidden: true }));
  globalThis.document = doc;
  return doc;
}

/**
 * A radio group mock whose value reads and checks its radios, like a RadioNodeList.
 * Each radio sits in its own details, and the first is checked by default.
 * @param {string[]} values - Radio values
 * @returns {Object[]} The radios
 */
function createRadioGroup(values) {
  const radios = values.map((value, i) => {
    const details = { open: false };
    return { value, checked: i === 0, defaultChecked: i === 0, closest: () => details };
  });
  return Object.defineProperty(radios, 'value', {
    get: () => radios.find((r) => r.checked)?.value ?? '',
    set: (value) => radios.forEach((r) => { r.checked = r.value === value; }),
  });
}

/**
 * A mock #tournament-config form whose controls start at their index.html defaults and return to them on reset.
 * @returns {Object} Mock form
 */
function createSettingsForm() {
  const form = createMockElement();
  const inputs = {
    'tournament-name': '', 'players-per-game': '4', 'games-per-player': '5', 'leftover-seats': 'smaller',
    'points-table': 'standard', 'team-size': '2', 'doubles-bracket-type': 'single',
  };
  form.elements = {
    type: createRadioGroup(['single', 'double', 'mariokart', 'doubles']),
    seeding: createRadioGroup(['random', 'manual']),
    ...Object.fromEntries(Object.entries(inputs).map(([name, value]) => [name, { name, value, defaultValue: value }])),
  };
  form.contains = (el) => Object.values(form.elements).flat().includes(el);
  form.reset = () => {
    for (const control of Object.values(form.elements)) {
      if (Array.isArray(control)) {
        control.forEach((r) => { r.checked = r.defaultChecked; });
      } else {
        control.value = control.defaultValue;
      }
    }
  };
  return form;
}

/**
 * Install a mock document holding the elements initLobby and a lobby render pass need
 * @returns {Object} The installed mock document
 */
export function installLobbyDom() {
  const doc = createMockDocument();
  doc._addElement('tournament-config', createSettingsForm());
  for (const id of [
    'games-per-player', 'game-plan-summary', 'start-tournament-btn',
    'auto-assign-teams-btn', 'clear-teams-btn', 'update-name-form', 'leave-tournament-btn', 'my-name',
    'participant-list', 'share-link', 'copy-link-btn', 'share-btn', 'add-manual-participant-form',
    'manual-participant-name', 'admin-panel', 'participant-panel', 'add-participant-footer',
    'participant-count', 'room-display', 'room-code', 'tournament-name-display',
    'team-assignment-fieldset', 'team-assignment-grid', 'unassigned-list', 'team-assignment-status',
    'toast-container',
  ]) {
    doc._addElement(id, createMockElement());
  }
  globalThis.document = doc;
  return doc;
}

/**
 * Create a mock P2P room with the interface sync.js uses
 * @returns {Object} Mock room
 */
export function createMockRoom() {
  const actionHandlers = new Map();
  const broadcasts = [];
  const sentMessages = [];
  const joinHandlers = [];
  const leaveHandlers = [];
  let peers = [];

  return {
    onAction: (type, handler) => {
      actionHandlers.set(type, handler);
    },

    broadcast: (type, payload) => {
      broadcasts.push({ type, payload });
    },

    sendTo: (type, payload, peerId) => {
      const peerIds = Array.isArray(peerId) ? peerId : [peerId];
      peerIds.forEach(pid => {
        sentMessages.push({ type, payload, peerId: pid });
      });
    },

    onPeerJoin: (handler) => {
      joinHandlers.push(handler);
    },

    onPeerLeave: (handler) => {
      leaveHandlers.push(handler);
    },

    getPeers: () => peers,

    _broadcasts: broadcasts,
    _sentMessages: sentMessages,

    /** Deliver an action as if sent by fromPeerId. */
    _simulateAction: (type, payload, fromPeerId) => {
      actionHandlers.get(type)?.(payload, fromPeerId);
    },

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
 * Record a result on a match, then advance the bracket.
 * @param {{bracket: Object, matches: Map}} tournament
 * @param {Function} advance - The bracket module's advance
 * @param {string} matchId - Match to decide
 * @param {string} winnerId - Winning participant or team
 * @param {number[]} [scores]
 * @returns {boolean} True once the tournament is complete
 */
export function report(tournament, advance, matchId, winnerId, scores = [2, 0]) {
  Object.assign(tournament.matches.get(matchId), { scores, winnerId });
  return advance(tournament);
}

/**
 * Report a 2-0 result for every playable match until none remain. A pass that
 * decides no match ends the loop, so a stuck bracket fails its caller's asserts.
 * @param {{bracket: Object, matches: Map}} tournament
 * @param {Function} advance - The bracket module's advance
 * @param {Function} pick - Chooses the winner of a match
 * @param {Function} [onRecord] - Called with each match after its result is recorded
 * @returns {boolean} True once the tournament is complete
 */
export function playToCompletion(tournament, advance, pick = (m) => m.participants[0], onRecord) {
  let complete = false;
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const m of tournament.matches.values()) {
      if (m.isBye || m.winnerId || !m.participants[0] || !m.participants[1]) continue;
      complete = report(tournament, advance, m.id, pick(m));
      if (!m.winnerId) continue;
      onRecord?.(m);
      progressed = true;
    }
  }
  return complete;
}
