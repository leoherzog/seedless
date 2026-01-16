/**
 * Trystero Room Management
 * Handles P2P room lifecycle using BitTorrent
 */

import { CONFIG } from '../../config.js';
import { joinRoom as trysteroJoin, selfId } from 'https://esm.run/trystero/torrent';

// Allow tests to override Trystero adapter via globalThis.__seedlessTrysteroJoin / __seedlessTrysteroSelfId
const getTrysteroJoin = () => globalThis.__seedlessTrysteroJoin || trysteroJoin;
const getSelfId = () => globalThis.__seedlessTrysteroSelfId || selfId;

/**
 * @typedef {Object} RoomConnection
 * @property {Object} room - Trystero room instance
 * @property {string} selfId - Local peer ID
 * @property {Object} actions - Message action senders/receivers
 * @property {Function} broadcast - Broadcast to all peers
 * @property {Function} sendTo - Send to specific peer(s)
 * @property {Function} leave - Leave the room
 * @property {Function} getPeers - Get connected peer IDs
 */

// Active room connection
let activeRoom = null;

/**
 * Join or create a tournament room
 * @param {string} roomId - Room identifier (slug)
 * @param {Object} options - Join options
 * @returns {Promise<RoomConnection>}
 */
export async function joinRoom(roomId, options = {}) {
  if (activeRoom) {
    console.warn('[Seedless] Already in a room, leaving first');
    await leaveRoom();
  }

  const config = {
    appId: CONFIG.appId,
    password: options.password || undefined,
  };

  console.info(`[Seedless] Joining room: ${roomId}`);
  const room = getTrysteroJoin()(config, roomId);
  const localSelfId = getSelfId();

  // Create action channels
  // Note: Trystero has 12-byte limit on action names
  const actions = {};
  const actionTypes = [
    'st:req',      // state request
    'st:res',      // state response
    'p:join',      // participant join
    'p:upd',       // participant update
    'p:leave',     // participant leave
    't:start',     // tournament start
    't:reset',     // tournament reset
    'm:result',    // match result
    'm:verify',    // match verify
    's:upd',       // standings update
    'r:result',    // race/game result (Points Race)
    'v:check',     // version check (admin heartbeat)
  ];

  for (const actionType of actionTypes) {
    const [send, receive] = room.makeAction(actionType);
    actions[actionType] = { send, receive };
  }

  // Connection state
  const connection = {
    room,
    roomId,
    selfId: localSelfId,
    actions,

    /**
     * Broadcast message to all peers
     */
    broadcast(actionType, payload) {
      if (!actions[actionType]) {
        console.error(`Unknown action type: ${actionType}`);
        return;
      }
      actions[actionType].send({
        payload,
        senderId: localSelfId,
        timestamp: Date.now(),
      });
    },

    /**
     * Send message to specific peer(s)
     */
    sendTo(actionType, payload, targetPeers) {
      if (!actions[actionType]) {
        console.error(`Unknown action type: ${actionType}`);
        return;
      }
      const targets = Array.isArray(targetPeers) ? targetPeers : [targetPeers];
      actions[actionType].send({
        payload,
        senderId: localSelfId,
        timestamp: Date.now(),
      }, targets);
    },

    /**
     * Register handler for peer events
     */
    onPeerJoin(callback) {
      room.onPeerJoin(callback);
      return connection;
    },

    onPeerLeave(callback) {
      room.onPeerLeave(callback);
      return connection;
    },

    /**
     * Register handler for action messages
     */
    onAction(actionType, callback) {
      if (!actions[actionType]) {
        console.error(`Unknown action type: ${actionType}`);
        return connection;
      }
      actions[actionType].receive((data, peerId) => {
        callback(data.payload, peerId, data);
      });
      return connection;
    },

    /**
     * Get list of connected peer IDs
     */
    getPeers() {
      return Array.from(Object.keys(room.getPeers()));
    },

    /**
     * Get peer count
     */
    getPeerCount() {
      return Object.keys(room.getPeers()).length;
    },

    /**
     * Leave the room
     */
    leave() {
      room.leave();
      activeRoom = null;
      console.info('[Seedless] Left room');
    },
  };

  // Log peer connections
  room.onPeerJoin((peerId) => {
    console.info(`[Seedless] Peer joined: ${peerId}`);
  });

  room.onPeerLeave((peerId) => {
    console.info(`[Seedless] Peer left: ${peerId}`);
  });

  activeRoom = connection;
  return connection;
}

/**
 * Leave the current room
 */
export async function leaveRoom() {
  if (activeRoom) {
    activeRoom.leave();
    activeRoom = null;
  }
}

// Export action type constants (max 12 bytes each)
export const ActionTypes = {
  STATE_REQUEST: 'st:req',
  STATE_RESPONSE: 'st:res',
  PARTICIPANT_JOIN: 'p:join',
  PARTICIPANT_UPDATE: 'p:upd',
  PARTICIPANT_LEAVE: 'p:leave',
  TOURNAMENT_START: 't:start',
  TOURNAMENT_RESET: 't:reset',
  MATCH_RESULT: 'm:result',
  MATCH_VERIFY: 'm:verify',
  STANDINGS_UPDATE: 's:upd',
  RACE_RESULT: 'r:result',
  VERSION_CHECK: 'v:check',
};
