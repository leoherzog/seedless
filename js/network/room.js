/**
 * Trystero room wrapper: joins a room over Nostr relays, opens one channel per
 * ActionTypes entry, and holds the single active connection.
 */

import { CONFIG } from '../../config.js';
// tests/register-hooks.js resolves this URL to tests/mocks/trystero-mock.js; change both together.
import { joinRoom as trysteroJoin, selfId } from 'https://cdn.jsdelivr.net/npm/@trystero-p2p/nostr@0.26/+esm';

// Trystero action names must be 1 to 32 UTF-8 bytes.
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
  RACE_RESULT: 'r:result',
};

/**
 * @typedef {Object} RoomConnection
 * @property {string} selfId - Local peer ID
 * @property {(type: string, payload: *) => void} broadcast - Send to every peer
 * @property {(type: string, payload: *, target: string|string[]) => void} sendTo - Send to specific peer(s)
 * @property {(type: string, callback: (payload: Object, peerId: string) => void) => void} onAction - Set the handler for one action type; non-object payloads are dropped
 * @property {(callback: (peerId: string) => void) => void} onPeerJoin - Add a peer-join handler
 * @property {(callback: (peerId: string) => void) => void} onPeerLeave - Add a peer-leave handler
 * @property {() => string[]} getPeers - Connected peer IDs
 * @property {() => void} leave - Leave the room
 */

/** @type {RoomConnection|null} */
let activeRoom = null;

/**
 * @returns {RoomConnection|null} The connected room, or null when not in one
 */
export const getRoom = () => activeRoom;

/**
 * Fetch short-lived TURN credentials from turn-worker/. Trystero adds them to its
 * default STUN servers, which alone fail across carrier-grade NAT.
 * @returns {Promise<RTCIceServer[]|undefined>} undefined when unconfigured or unreachable
 */
async function fetchTurnServers() {
  const url = CONFIG.network?.turnCredentialsUrl;
  if (!url) return undefined;

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
    return undefined;
  }
}

/**
 * Join a tournament room, leaving any room already joined.
 * @param {string} roomId - Room identifier (slug)
 * @returns {Promise<RoomConnection>}
 */
export async function joinRoom(roomId) {
  if (activeRoom) await leaveRoom();

  const config = { appId: CONFIG.appId, turnConfig: await fetchTurnServers() };

  const room = trysteroJoin(config, roomId);

  const actions = Object.fromEntries(Object.values(ActionTypes).map((type) => [type, room.makeAction(type)]));

  // Trystero's onPeerJoin/onPeerLeave are replace-only, so handlers fan out from local arrays.
  const joinHandlers = [];
  const leaveHandlers = [];
  room.onPeerJoin = (peerId) => joinHandlers.forEach((handler) => handler(peerId));
  room.onPeerLeave = (peerId) => leaveHandlers.forEach((handler) => handler(peerId));

  activeRoom = {
    selfId,
    broadcast: (type, payload) => actions[type].send({ payload }),
    sendTo: (type, payload, target) => actions[type].send({ payload }, { target }),
    onAction: (type, callback) => {
      actions[type].onMessage = (data, { peerId }) => {
        if (typeof data?.payload === 'object' && data.payload !== null) callback(data.payload, peerId);
      };
    },
    onPeerJoin: (callback) => joinHandlers.push(callback),
    onPeerLeave: (callback) => leaveHandlers.push(callback),
    getPeers: () => Object.keys(room.getPeers()),
    leave() {
      room.leave();
      activeRoom = null;
    },
  };
  return activeRoom;
}

/**
 * Leave the current room, if any.
 */
export async function leaveRoom() {
  activeRoom?.leave();
}
