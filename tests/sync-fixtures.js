/**
 * Sync test helpers that wire the store singleton to a mock room through
 * setupStateSync. Kept out of fixtures.js so tournament tests do not load sync.js.
 */

import { store } from '../js/state/store.js';
import { setupStateSync, resetSyncState } from '../js/network/sync.js';
import { ActionTypes } from '../js/network/room.js';
import { createMockRoom } from './fixtures.js';

/**
 * Reset sync and store state, set the local identity, then run setupStateSync on a fresh mock room.
 * @param {Object} opts
 * @param {string} opts.userId - local.localUserId
 * @param {string} opts.adminId - meta.adminId
 * @param {boolean} [opts.isAdmin] - Defaults to userId === adminId
 * @param {string} [opts.name] - local.name
 * @param {string[]} [opts.peers] - Peers already connected when setupStateSync runs
 * @returns {Object} The mock room
 */
export function connectAs({
  userId,
  adminId,
  isAdmin = userId === adminId,
  name = isAdmin ? 'Admin' : 'Participant',
  peers = [],
}) {
  resetSyncState();
  store.reset();
  store.set('meta.adminId', adminId);
  store.set('local.localUserId', userId);
  store.set('local.name', name);
  store.setAdmin(isAdmin);
  const room = createMockRoom('local-peer');
  room._setPeers(peers);
  setupStateSync(room);
  return room;
}

/**
 * Map peerId to adminId the way a real admin does, through a STATE_RESPONSE.
 * @param {Object} room - Mock room from connectAs
 * @param {string} adminId - The admin's persistent user ID
 * @param {string} [peerId] - The admin's peer ID
 */
export function mapAdmin(room, adminId, peerId = 'admin-peer') {
  room._simulateAction(ActionTypes.STATE_RESPONSE, {
    state: { meta: { adminId } },
    isAdmin: true,
  }, peerId);
}
