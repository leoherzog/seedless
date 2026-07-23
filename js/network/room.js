/**
 * Trystero Room Management
 * Handles P2P room lifecycle using Nostr relays for peer discovery
 */

import { CONFIG } from '../../config.js';
// trystero 0.23.0+ API, shipped as the '@trystero-p2p/*' packages (the main
// 'trystero' package deprecated its '/torrent' subpath, which now throws on
// import). This module adapts the new object-based API — makeAction() returns
// { send, onMessage } and onPeerJoin/onPeerLeave are assignable properties —
// to room.js's stable wrapper contract, so sync.js/main.js need no changes.
import { joinRoom as trysteroJoin, selfId } from 'https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr/+esm';

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
 * Fetch short-lived TURN credentials from the credential Worker (see
 * turn-worker/). Returns an RTCIceServer array, or null when unconfigured or
 * unreachable — the app then falls back to Trystero's default STUN servers,
 * which is enough for same-network / friendly-NAT peers but fails across
 * carrier-grade NAT (e.g. phones on cellular).
 */
async function fetchTurnServers() {
  const url = CONFIG.network?.turnCredentialsUrl;
  if (!url) return null;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const { iceServers } = await response.json();
    if (!Array.isArray(iceServers) || iceServers.length === 0) {
      throw new Error('response has no iceServers');
    }
    return iceServers;
  } catch (error) {
    console.warn(`[Seedless] TURN credentials unavailable, using STUN only: ${error?.message || error}`);
    return null;
  }
}

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

  // turnConfig entries are merged with Trystero's default STUN servers
  const iceServers = await fetchTurnServers();

  const config = {
    appId: CONFIG.appId,
    password: options.password || undefined,
    ...(iceServers ? { turnConfig: iceServers } : {}),
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
    't:archive',   // tournament archive (history entry)
    'm:result',    // match result
    'm:verify',    // match verify
    's:upd',       // standings update
    'r:result',    // race/game result (Points Race)
    'v:check',     // version check (admin heartbeat)
  ];

  for (const actionType of actionTypes) {
    // New API: makeAction() returns { send, onMessage, onReceiveProgress }.
    // Adapt it to the classic { send, receive } shape this wrapper expects so
    // broadcast()/sendTo()/onAction() below stay unchanged:
    //  - send(data)          -> broadcast (no target)
    //  - send(data, targets) -> send({ target }); target accepts a peerId or array
    //  - receive(cb)         -> assign onMessage; cb gets (payload, peerId) via context.peerId
    const action = room.makeAction(actionType);
    actions[actionType] = {
      send: (data, targets) =>
        action.send(data, targets == null ? undefined : { target: targets }),
      receive: (cb) => {
        action.onMessage = (data, context) => cb(data, context.peerId);
      },
    };
  }

  // Trystero's room.onPeerJoin/onPeerLeave are replace-only (registering a
  // new callback discards the previous one), but multiple parts of the app
  // (this module's logging, the sync layer, and the UI) all need to react
  // to peer join/leave events. Maintain our own handler lists and register
  // a single real callback with Trystero that fans out to all of them.
  const peerJoinHandlers = [];
  const peerLeaveHandlers = [];

  // New API: onPeerJoin/onPeerLeave are assignable (replace-only) properties,
  // not registrar functions. Assign one real callback that fans out to our lists.
  room.onPeerJoin = (peerId) => {
    for (const handler of peerJoinHandlers) {
      handler(peerId);
    }
  };

  room.onPeerLeave = (peerId) => {
    for (const handler of peerLeaveHandlers) {
      handler(peerId);
    }
  };

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
      peerJoinHandlers.push(callback);
      return connection;
    },

    onPeerLeave(callback) {
      peerLeaveHandlers.push(callback);
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
  peerJoinHandlers.push((peerId) => {
    console.info(`[Seedless] Peer joined: ${peerId}`);
  });

  peerLeaveHandlers.push((peerId) => {
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
  TOURNAMENT_ARCHIVE: 't:archive',
  MATCH_RESULT: 'm:result',
  MATCH_VERIFY: 'm:verify',
  STANDINGS_UPDATE: 's:upd',
  RACE_RESULT: 'r:result',
  VERSION_CHECK: 'v:check',
};
