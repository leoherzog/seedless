/**
 * In-memory stand-in for the Trystero 0.26 surface room.js uses. deno.json maps
 * the Trystero CDN import to this file, so tests never reach the network.
 */

export const selfId = 'mock-self-id';

let lastRoom = null;

/**
 * Create a mock Trystero room and remember it for _getLastRoom.
 * @param {Object} config - Room config ({ appId, turnConfig })
 * @param {string} roomId - Room identifier
 * @returns {Object} Mock room
 */
export function joinRoom(config, roomId) {
  const actions = new Map();
  const peers = new Map();

  const room = {
    roomId,
    config,
    onPeerJoin: null,
    onPeerLeave: null,

    makeAction(type) {
      const sent = [];
      const action = {
        send(data, options) {
          sent.push({ data, targets: options?.target });
          return Promise.resolve();
        },
        onMessage: null,
      };
      actions.set(type, { action, sent });
      return action;
    },

    getPeers() {
      return Object.fromEntries(peers);
    },

    leave() {
      peers.clear();
      actions.clear();
      return Promise.resolve();
    },

    /** @returns {{ data: *, targets: * }[]} Messages sent on one channel; targets is undefined for a broadcast */
    _getSentMessages(type) {
      return actions.get(type)?.sent ?? [];
    },

    _simulatePeerJoin(peerId) {
      peers.set(peerId, {});
      room.onPeerJoin?.(peerId);
    },

    _simulatePeerLeave(peerId) {
      peers.delete(peerId);
      room.onPeerLeave?.(peerId);
    },

    _simulateMessage(type, data, peerId) {
      actions.get(type)?.action.onMessage?.(data, { peerId });
    },
  };

  lastRoom = room;
  return room;
}

/**
 * @returns {Object|null} The room most recently created by joinRoom
 */
export const _getLastRoom = () => lastRoom;
