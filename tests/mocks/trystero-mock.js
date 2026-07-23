/**
 * Trystero Mock for Testing (0.23.0+ / '@trystero-p2p/*' API)
 *
 * Emulates the NEW raw Trystero API that room.js's adapter consumes:
 *   - joinRoom(config, roomId) -> Room
 *   - room.makeAction(namespace) -> { send, onMessage, onReceiveProgress }
 *       * send(data)                      broadcasts to all peers
 *       * send(data, { target })          sends to one peer id or an array of ids
 *       * onMessage is an ASSIGNABLE, replace-only callback invoked with
 *         (data, context) where context = { peerId }
 *   - room.onPeerJoin / room.onPeerLeave are ASSIGNABLE, replace-only
 *     properties (NOT registrar functions)
 *   - room.getPeers() -> Record<peerId, RTCPeerConnection-ish> (an OBJECT)
 *   - room.leave() -> Promise<void>
 *   - selfId is a top-level named export (string)
 *
 * The `_`-prefixed helpers below are the TEST-DRIVING HOOKS used by the suite
 * to simulate incoming messages, peer join/leave, and inspect sent traffic.
 * They are documented in contractNotes for the reconcile-phase test agents.
 */

/**
 * Creates a mock Trystero room instance
 * @param {Object} config - Room config ({ appId, password?, ... })
 * @param {string} roomId - Room identifier
 * @returns {Object} Mock Trystero room
 */
export function createMockTrysteroRoom(config, roomId) {
  // actionType -> { action, sentMessages }
  const actions = new Map();
  const peers = new Map();

  const room = {
    roomId,
    config,

    // Replace-only assignable peer-event callbacks (new API). Default null.
    onPeerJoin: null,
    onPeerLeave: null,

    /**
     * Create an action channel (new Trystero API).
     * Returns a MessageAction OBJECT (not a tuple).
     * @param {string} actionType - Action type name (max 12 bytes)
     * @returns {{ send: Function, onMessage: Function|null, onReceiveProgress: Function|null }}
     */
    makeAction(actionType) {
      const sentMessages = [];

      const action = {
        /**
         * Send data. Broadcast when no options.target; targeted otherwise.
         * options.target may be a single peer id or an array of ids.
         * @returns {Promise<void>}
         */
        send(data, options) {
          const targets = options == null ? undefined : options.target;
          sentMessages.push({ data, targets, timestamp: Date.now() });
          return Promise.resolve();
        },

        // Replace-only assignable receive callback (new API).
        onMessage: null,
        onReceiveProgress: null,
      };

      actions.set(actionType, { action, sentMessages });
      return action;
    },

    /**
     * Get connected peers.
     * @returns {Object} Record keyed by peerId (new API shape)
     */
    getPeers() {
      return Object.fromEntries(peers);
    },

    /**
     * Leave the room.
     * @returns {Promise<void>}
     */
    leave() {
      peers.clear();
      actions.clear();
      return Promise.resolve();
    },

    // ============================================
    // Test Helpers (test-driving hooks)
    // ============================================

    /**
     * Simulate a peer joining. Invokes the assigned room.onPeerJoin (if any).
     * @param {string} peerId - Peer ID
     * @param {Object} metadata - Optional peer metadata
     */
    _simulatePeerJoin(peerId, metadata = {}) {
      peers.set(peerId, metadata);
      if (typeof room.onPeerJoin === 'function') {
        room.onPeerJoin(peerId);
      }
    },

    /**
     * Simulate a peer leaving. Invokes the assigned room.onPeerLeave (if any).
     * @param {string} peerId - Peer ID
     */
    _simulatePeerLeave(peerId) {
      peers.delete(peerId);
      if (typeof room.onPeerLeave === 'function') {
        room.onPeerLeave(peerId);
      }
    },

    /**
     * Simulate receiving a message on an action channel.
     * Invokes the action's assigned onMessage(data, { peerId }).
     * @param {string} actionType - Action type
     * @param {*} data - Message data
     * @param {string} peerId - Sender peer ID
     */
    _simulateMessage(actionType, data, peerId) {
      const entry = actions.get(actionType);
      if (entry && typeof entry.action.onMessage === 'function') {
        entry.action.onMessage(data, { peerId });
      }
    },

    /**
     * Get messages sent on an action channel.
     * Each entry is { data, targets, timestamp } where `targets` is the
     * value passed as options.target (undefined for a broadcast).
     * @param {string} actionType - Action type
     * @returns {Object[]} Sent messages
     */
    _getSentMessages(actionType) {
      const entry = actions.get(actionType);
      return entry ? entry.sentMessages : [];
    },

    /**
     * Get all sent messages across all action types.
     * @returns {Object} Map of actionType -> messages
     */
    _getAllSentMessages() {
      const result = {};
      for (const [actionType, entry] of actions) {
        result[actionType] = entry.sentMessages;
      }
      return result;
    },

    /**
     * Clear sent messages for testing.
     * @param {string} [actionType] - Optional action type (clears all if omitted)
     */
    _clearSentMessages(actionType) {
      if (actionType) {
        const entry = actions.get(actionType);
        if (entry) entry.sentMessages.length = 0;
      } else {
        for (const entry of actions.values()) {
          entry.sentMessages.length = 0;
        }
      }
    },

    /**
     * Whether a peer-join callback is currently assigned (0 or 1 under
     * replace-only semantics).
     */
    _getPeerJoinCallbackCount() {
      return typeof room.onPeerJoin === 'function' ? 1 : 0;
    },

    /**
     * Whether a peer-leave callback is currently assigned (0 or 1 under
     * replace-only semantics).
     */
    _getPeerLeaveCallbackCount() {
      return typeof room.onPeerLeave === 'function' ? 1 : 0;
    },

    /**
     * Check if action channel exists.
     */
    _hasAction(actionType) {
      return actions.has(actionType);
    },

    /**
     * Get all registered action types.
     */
    _getActionTypes() {
      return Array.from(actions.keys());
    },
  };

  return room;
}

// Track all created rooms for testing
const createdRooms = [];

/**
 * Mock selfId - simulates the local peer ID (top-level named export)
 */
export let selfId = 'mock-self-id-' + Math.random().toString(36).slice(2, 8);

/**
 * Reset selfId to a new value (for test isolation)
 * @param {string} newId - New self ID
 */
export function _resetSelfId(newId) {
  selfId = newId || 'mock-self-id-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Mock joinRoom function (matches new @trystero-p2p/torrent API)
 * @param {Object} config - Room configuration
 * @param {string} roomId - Room identifier
 * @returns {Object} Mock room instance
 */
export function joinRoom(config, roomId) {
  const room = createMockTrysteroRoom(config, roomId);
  createdRooms.push(room);
  return room;
}

/**
 * Get all rooms created during testing
 * @returns {Object[]} Array of created rooms
 */
export function _getCreatedRooms() {
  return createdRooms;
}

/**
 * Get the most recently created room
 * @returns {Object|null} Most recent room or null
 */
export function _getLastRoom() {
  return createdRooms[createdRooms.length - 1] || null;
}

/**
 * Clear all created rooms (for test cleanup)
 */
export function _clearCreatedRooms() {
  createdRooms.length = 0;
}

/**
 * Reset all mock state (for test isolation)
 */
export function _resetAll() {
  _clearCreatedRooms();
  _resetSelfId();
}
