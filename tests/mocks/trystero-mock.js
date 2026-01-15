/**
 * Trystero Mock for Testing
 * Provides a mock implementation of trystero/torrent for testing room.js
 */

/**
 * Creates a mock Trystero room instance
 * @param {Object} config - Room config
 * @param {string} roomId - Room identifier
 * @returns {Object} Mock Trystero room
 */
export function createMockTrysteroRoom(config, roomId) {
  const actions = new Map();
  const peerJoinCallbacks = [];
  const peerLeaveCallbacks = [];
  const peers = new Map();

  const room = {
    roomId,
    config,

    /**
     * Create an action channel (Trystero API)
     * @param {string} actionType - Action type name (max 12 bytes)
     * @returns {[Function, Function]} [send, receive] tuple
     */
    makeAction(actionType) {
      const sentMessages = [];
      let receiveCallback = null;

      const send = (data, targets) => {
        sentMessages.push({ data, targets, timestamp: Date.now() });
      };

      const receive = (callback) => {
        receiveCallback = callback;
        actions.set(actionType, { send, receive: callback, sentMessages });
      };

      // Store reference for test helpers even before receive is called
      if (!actions.has(actionType)) {
        actions.set(actionType, { send, receive: null, sentMessages });
      }

      return [send, receive];
    },

    /**
     * Register peer join callback
     */
    onPeerJoin(callback) {
      peerJoinCallbacks.push(callback);
    },

    /**
     * Register peer leave callback
     */
    onPeerLeave(callback) {
      peerLeaveCallbacks.push(callback);
    },

    /**
     * Get connected peers
     * @returns {Object} Peer map
     */
    getPeers() {
      return Object.fromEntries(peers);
    },

    /**
     * Leave the room
     */
    leave() {
      peers.clear();
      actions.clear();
    },

    // ============================================
    // Test Helpers
    // ============================================

    /**
     * Simulate a peer joining
     * @param {string} peerId - Peer ID
     * @param {Object} metadata - Optional peer metadata
     */
    _simulatePeerJoin(peerId, metadata = {}) {
      peers.set(peerId, metadata);
      peerJoinCallbacks.forEach(cb => cb(peerId));
    },

    /**
     * Simulate a peer leaving
     * @param {string} peerId - Peer ID
     */
    _simulatePeerLeave(peerId) {
      peers.delete(peerId);
      peerLeaveCallbacks.forEach(cb => cb(peerId));
    },

    /**
     * Simulate receiving a message on an action channel
     * @param {string} actionType - Action type
     * @param {Object} data - Message data
     * @param {string} peerId - Sender peer ID
     */
    _simulateMessage(actionType, data, peerId) {
      const action = actions.get(actionType);
      if (action && action.receive) {
        action.receive(data, peerId);
      }
    },

    /**
     * Get messages sent on an action channel
     * @param {string} actionType - Action type
     * @returns {Object[]} Sent messages
     */
    _getSentMessages(actionType) {
      const action = actions.get(actionType);
      return action ? action.sentMessages : [];
    },

    /**
     * Get all sent messages across all action types
     * @returns {Object} Map of actionType -> messages
     */
    _getAllSentMessages() {
      const result = {};
      for (const [actionType, action] of actions) {
        result[actionType] = action.sentMessages;
      }
      return result;
    },

    /**
     * Clear sent messages for testing
     * @param {string} actionType - Optional action type (clears all if not specified)
     */
    _clearSentMessages(actionType) {
      if (actionType) {
        const action = actions.get(actionType);
        if (action) action.sentMessages.length = 0;
      } else {
        for (const action of actions.values()) {
          action.sentMessages.length = 0;
        }
      }
    },

    /**
     * Get registered peer join callbacks count
     */
    _getPeerJoinCallbackCount() {
      return peerJoinCallbacks.length;
    },

    /**
     * Get registered peer leave callbacks count
     */
    _getPeerLeaveCallbackCount() {
      return peerLeaveCallbacks.length;
    },

    /**
     * Check if action channel exists
     */
    _hasAction(actionType) {
      return actions.has(actionType);
    },

    /**
     * Get all registered action types
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
 * Mock selfId - simulates the local peer ID
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
 * Mock joinRoom function (matches trystero/torrent API)
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
