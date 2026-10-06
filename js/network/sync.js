/**
 * State Synchronization
 * Handles P2P state sync and conflict resolution
 */

import { store } from '../state/store.js';
import { navigateToHome } from '../state/url-state.js';
import { showToast, showInfo } from '../components/toast.js';
import { ActionTypes } from './room.js';
import {
  isValidState,
  shouldUpdateMatch,
  isValidMatchResultPayload,
  isValidMatchVerifyPayload,
  isValidParticipantJoinPayload,
  isValidParticipantUpdatePayload
} from './sync-validators.js';
import { advance as advanceSingle } from '../tournament/single-elimination.js';
import { advance as advanceDouble } from '../tournament/double-elimination.js';
import { recordRaceResult } from '../tournament/mario-kart.js';
import { isInMatch } from '../utils/tournament-helpers.js';

// Map peerId (transient) to localUserId (persistent)
// This allows us to identify participants across page refreshes
const peerIdToUserId = new Map();

// Non-admins ignore match results until their first state response.
let stateInitialized = false;

/**
 * @param {string} peerId - Sender's peer ID
 * @returns {string} The sender's persistent ID, or the peerId when unmapped
 */
const senderOf = (peerId) => peerIdToUserId.get(peerId) || peerId;

/**
 * @param {string} peerId - Sender's peer ID
 * @returns {boolean} True when the sender maps to the established meta.adminId
 */
const isFromAdmin = (peerId) => {
  const adminId = store.get('meta.adminId');
  return !!adminId && senderOf(peerId) === adminId;
};

/**
 * Broadcast our p:join so peers can map our peerId to our persistent ID.
 * @param {Object} room - Room connection
 */
function announceSelf(room) {
  const name = store.get('local.name');
  const localUserId = store.get('local.localUserId');
  if (name && localUserId) {
    room.broadcast(ActionTypes.PARTICIPANT_JOIN, { name, localUserId });
  }
}

/**
 * Set up state synchronization for a room connection
 * @param {Object} room - Room connection from room.js
 */
export function setupStateSync(room) {
  room.onAction(ActionTypes.STATE_REQUEST, (payload, peerId) => {
    console.info(`[Sync] State request from ${peerId}`);

    room.sendTo(ActionTypes.STATE_RESPONSE, {
      state: store.serialize(),
      isAdmin: store.isAdmin(),
    }, peerId);
  });

  room.onAction(ActionTypes.STATE_RESPONSE, (payload, peerId) => {
    console.info(`[Sync] State response from ${peerId}`);

    const { state: remoteState, isAdmin: isRemoteAdmin } = payload;
    if (!isValidState(remoteState)) {
      console.warn(`[Sync] Invalid state structure from ${peerId}`);
      return;
    }

    const adminId = remoteState.meta?.adminId;
    const currentPeers = room.getPeers();

    // An isAdmin flag proves nothing alone. Map this peer to adminId only if no
    // connected peer holds it yet (trust on first use) or this peer already does.
    let senderIsAdmin = false;
    if (isRemoteAdmin && adminId) {
      const activeAdminPeer = [...peerIdToUserId.entries()]
        .find(([pid, uid]) => uid === adminId && currentPeers.includes(pid))?.[0];
      if (!activeAdminPeer || activeAdminPeer === peerId) {
        peerIdToUserId.set(peerId, adminId);
        senderIsAdmin = true;
      } else {
        console.warn(`[Sync] Rejected admin mapping claim from ${peerId}: admin already active as ${activeAdminPeer}`);
      }
    }

    // Only a sender that passed the check above merges with admin authority.
    store.merge(remoteState, senderIsAdmin);
    stateInitialized = true;

    // isConnected reflects our own WebRTC peers, not the synced value, which may be stale.
    const myUserId = store.get('local.localUserId');
    for (const participant of store.getParticipantList()) {
      if (participant.id === myUserId) {
        if (!participant.isConnected) {
          store.updateParticipant(participant.id, { isConnected: true });
        }
      } else if (participant.peerId) {
        const isActuallyConnected = currentPeers.includes(participant.peerId);
        if (participant.isConnected !== isActuallyConnected) {
          store.updateParticipant(participant.id, { isConnected: isActuallyConnected });
        }
      }
    }

    // Retry our join in case the admin rejected the earlier one.
    if (isRemoteAdmin && !store.isAdmin()) {
      announceSelf(room);
    }
  });

  room.onAction(ActionTypes.PARTICIPANT_JOIN, (payload, peerId) => {
    if (!isValidParticipantJoinPayload(payload)) {
      console.warn(`[Sync] Invalid participant join payload from ${peerId}`);
      return;
    }

    const { localUserId, name } = payload;
    const adminId = store.get('meta.adminId');

    // Manual players come only from the admin and have no peer.
    if (payload.isManual) {
      if (!isFromAdmin(peerId)) {
        console.warn(`[Sync] Rejected manual participant injection from non-admin: ${senderOf(peerId)}`);
        return;
      }
      if (!store.getParticipant(localUserId)) {
        store.addParticipant({ id: localUserId, name, isManual: true, isConnected: false, joinedAt: payload.joinedAt });
        console.info(`[Sync] Manual participant added: ${name} (${localUserId})`);
      }
      return;
    }

    // A join under the admin's id would hand the sender admin authority.
    if (adminId && localUserId === adminId) {
      console.warn(`[Sync] Rejected admin impersonation attempt from peer ${peerId}`);
      return;
    }

    // A connected participant's id cannot be claimed from another peer.
    const existingParticipant = store.getParticipant(localUserId);
    if (existingParticipant?.isConnected && existingParticipant.peerId && existingParticipant.peerId !== peerId) {
      console.warn(`[Sync] Rejected duplicate localUserId claim from ${peerId} (${localUserId} already connected)`);
      return;
    }

    // Auto-claim an unclaimed manual participant whose name matches, ignoring case.
    const matchingManual = store.getParticipantList().find(p =>
      p.isManual &&
      !p.claimedBy &&
      p.name.toLowerCase() === name.toLowerCase()
    );

    if (matchingManual) {
      console.info(`[Sync] Auto-claiming manual participant: ${matchingManual.name} (${matchingManual.id}) claimed by ${localUserId}`);

      peerIdToUserId.set(peerId, matchingManual.id);
      const claim = { claimedBy: localUserId, isConnected: true, peerId };
      store.updateParticipant(matchingManual.id, claim);

      // Only the admin relays the claim: every peer already auto-claims from p:join,
      // and receivers attribute a non-admin relay to the relayer.
      if (store.isAdmin()) {
        room.broadcast(ActionTypes.PARTICIPANT_UPDATE, { id: matchingManual.id, ...claim });
      }
      return;
    }

    peerIdToUserId.set(peerId, localUserId);

    console.info(`[Sync] Participant join: ${name} (${localUserId}, peer: ${peerId})`);

    if (existingParticipant) {
      store.updateParticipant(localUserId, { name, peerId, isConnected: true });
    } else {
      store.addParticipant({ id: localUserId, peerId, name });
    }
  });

  room.onAction(ActionTypes.PARTICIPANT_UPDATE, (payload, peerId) => {
    if (!isValidParticipantUpdatePayload(payload)) {
      console.warn(`[Sync] Invalid participant update payload from ${peerId}`);
      return;
    }

    // The admin may update anyone by id; everyone else updates only themselves.
    const { id, ...updates } = payload;
    const targetUserId = id && isFromAdmin(peerId) ? id : senderOf(peerId);
    console.info(`[Sync] Participant update for ${targetUserId}:`, updates);
    store.updateParticipant(targetUserId, updates);
  });

  // Voluntary leaves arrive through onPeerLeave, so this action only carries admin removals.
  room.onAction(ActionTypes.PARTICIPANT_LEAVE, (payload, peerId) => {
    if (!payload.removedId) return;

    if (!isFromAdmin(peerId)) {
      console.warn(`[Sync] Rejected participant removal from non-admin: ${senderOf(peerId)}`);
      return;
    }

    if (payload.removedId === store.get('local.localUserId')) {
      console.info('[Sync] You have been removed from the tournament');
      showToast('You have been removed from the tournament', 'warning');
      navigateToHome();
      return;
    }

    console.info(`[Sync] Participant removed by admin: ${payload.removedId}`);
    store.removeParticipant(payload.removedId);
  });

  room.onAction(ActionTypes.TOURNAMENT_START, (payload, peerId) => {
    if (!isFromAdmin(peerId)) {
      console.warn(`[Sync] Rejected tournament start from non-admin: ${senderOf(peerId)}`);
      return;
    }

    console.info('[Sync] Tournament starting');

    store.deserialize({ matches: payload.matches, standings: payload.standings, bracket: payload.bracket });
    if (payload.bracket?.type) {
      store.set('meta.type', payload.bracket.type);
    }
    store.set('meta.status', 'active');
  });

  room.onAction(ActionTypes.TOURNAMENT_RESET, (payload, peerId) => {
    if (!isFromAdmin(peerId)) {
      console.warn(`[Sync] Rejected tournament reset from non-admin: ${senderOf(peerId)}`);
      return;
    }

    console.info('[Sync] Tournament reset:', payload.archive?.id);

    // merge skips an archive whose id is already in history.
    if (payload.archive) store.merge({ history: [payload.archive] });
    store.resetForNewTournament();

    if (!store.isAdmin()) {
      showInfo('Ready for new tournament!');
    }
  });

  room.onAction(ActionTypes.MATCH_RESULT, (payload, peerId) => {
    if (!stateInitialized && !store.isAdmin()) {
      console.info(`[Sync] Ignoring match result - state not yet initialized`);
      return;
    }

    if (!isValidMatchResultPayload(payload)) {
      console.warn(`[Sync] Invalid match result payload from ${peerId}`);
      return;
    }

    const senderId = senderOf(peerId);

    console.info(`[Sync] Match result from ${senderId}:`, payload);

    const { matchId, scores, winnerId, reportedAt, version = 0 } = payload;
    const match = store.getMatch(matchId);

    if (!match) {
      console.warn(`[Sync] Unknown match: ${matchId}`);
      return;
    }

    if (!match.participants.includes(winnerId)) {
      console.warn(`[Sync] Winner ${winnerId} not in match participants: ${match.participants}`);
      return;
    }

    const teams = store.get('meta.type') === 'doubles' ? (store.get('bracket')?.teams ?? []) : undefined;
    const isAdmin = isFromAdmin(peerId);

    if (!isInMatch(match, senderId, teams) && !isAdmin) {
      console.warn(`[Sync] Rejected match result from non-participant: ${senderId}`);
      return;
    }

    if (match.verifiedBy && !isAdmin) {
      console.warn(`[Sync] Rejected update to verified match from non-admin: ${senderId}`);
      return;
    }

    if (shouldUpdateMatch({ version, reportedAt }, match, isAdmin)) {
      store.updateMatch(matchId, { scores, winnerId, reportedBy: senderId, reportedAt, version });
      advanceWinner(matchId);
    }
  });

  room.onAction(ActionTypes.MATCH_VERIFY, (payload, peerId) => {
    if (!isFromAdmin(peerId)) {
      console.warn(`[Sync] Rejected match verify from non-admin: ${senderOf(peerId)}`);
      return;
    }

    if (!isValidMatchVerifyPayload(payload)) {
      console.warn(`[Sync] Invalid match verify shape from ${peerId}`);
      return;
    }

    const { matchId, scores, winnerId } = payload;
    store.updateMatch(matchId, { scores, winnerId, verifiedBy: senderOf(peerId) });
    advanceWinner(matchId);
  });

  room.onAction(ActionTypes.RACE_RESULT, (payload, peerId) => {
    const { gameId, results, reportedAt, version } = payload;
    const senderId = senderOf(peerId);

    console.info(`[Sync] Race result from ${senderId}:`, payload);

    const game = store.getMatch(gameId);
    if (!game) {
      console.warn(`[Sync] Unknown game: ${gameId}`);
      return;
    }

    const isAdmin = isFromAdmin(peerId);

    if (!game.participants.includes(senderId) && !isAdmin) {
      console.warn(`[Sync] Rejected race result from non-participant: ${senderId}`);
      return;
    }

    const incomingVersion = version || 0;
    if (!shouldUpdateMatch({ version: incomingVersion, reportedAt }, game, isAdmin)) {
      console.info(`[Sync] Ignoring stale race result`);
      return;
    }

    try {
      applyRaceResult(gameId, results, senderId, reportedAt, incomingVersion);
    } catch (e) {
      console.error('[Sync] Failed to apply race result:', e);
    }
  });

  room.onPeerJoin((peerId) => {
    const userId = peerIdToUserId.get(peerId);
    if (userId) {
      store.updateParticipant(userId, { isConnected: true, peerId });
    }

    // Ask the new peer for its state, and announce ourselves so it maps our peerId and marks us connected.
    room.sendTo(ActionTypes.STATE_REQUEST, {}, peerId);
    announceSelf(room);
  });

  room.onPeerLeave((peerId) => {
    const userId = peerIdToUserId.get(peerId);
    if (userId) {
      store.updateParticipant(userId, { isConnected: false });
    }
    // Keep the mapping so a peer that reconnects is still recognized.
  });
}

/**
 * Advance the bracket past a match whose result is already in the store, and
 * mark the tournament complete once the champion is decided.
 * @param {string} matchId - Decided match ID
 */
export function advanceWinner(matchId) {
  const bracket = store.get('bracket');
  const match = store.getMatch(matchId);
  if (!match?.winnerId || !(bracket?.winners || bracket?.rounds)) return;

  const advance = bracket.winners ? advanceDouble : advanceSingle;
  const complete = advance(
    { bracket, matches: store.get('matches') },
    matchId,
    (id, fields) => store.updateMatch(id, fields),
  );
  if (complete) {
    store.set('meta.status', 'complete');
  }
}

/**
 * Apply a race result to the store's game and standings, and mark the tournament
 * complete after the last game.
 * @param {string} gameId - Game ID
 * @param {Object[]} results - Array of { participantId }, in finishing order
 * @param {string} reportedBy - Reporter's persistent ID
 * @param {number} reportedAt - Reporter's timestamp
 * @param {number} version - Per-game logical clock
 */
function applyRaceResult(gameId, results, reportedBy, reportedAt, version) {
  const race = { ...store.get('bracket'), matches: store.get('matches'), standings: store.get('standings') };
  const complete = recordRaceResult(race, gameId, results, reportedBy, reportedAt);
  store.updateMatch(gameId, { version });
  if (complete) {
    store.set('meta.status', 'complete');
  }
}

/**
 * Record a local match result, advance the bracket and broadcast the result
 * @param {Object|null} room - Room connection; null records locally only
 * @param {string} matchId - Match ID
 * @param {number[]} scores - Match scores
 * @param {string} winnerId - Winner's participant ID
 */
export function reportMatchResult(room, matchId, scores, winnerId) {
  // Per-match logical clock so reporter and receivers agree on the version.
  const match = store.getMatch(matchId);
  const version = (match?.version || 0) + 1;
  const reportedAt = Date.now();

  // Store the same version/timestamp we broadcast so the reporter and receivers agree.
  store.updateMatch(matchId, {
    scores,
    winnerId,
    reportedBy: store.get('local.localUserId'),
    reportedAt,
    version,
  });
  advanceWinner(matchId);

  room?.broadcast(ActionTypes.MATCH_RESULT, {
    matchId,
    scores,
    winnerId,
    reportedAt,
    version,
  });
}

/**
 * Start tournament (admin only)
 * @param {Object} room - Room connection
 * @param {Object} bracket - Generated bracket
 * @param {Map} matches - Generated matches
 */
export function startTournament(room, bracket, matches) {
  room.broadcast(ActionTypes.TOURNAMENT_START, {
    bracket,
    matches: Array.from(matches.entries()),
    standings: Array.from(store.get('standings')),
  });
}

/**
 * Record a local race result and broadcast it (Points Race mode)
 * @param {Object|null} room - Room connection; null records locally only
 * @param {string} gameId - Game ID
 * @param {Object[]} results - Array of { participantId }, in finishing order
 */
export function reportRaceResult(room, gameId, results) {
  const version = (store.getMatch(gameId)?.version || 0) + 1;
  const reportedAt = Date.now();
  applyRaceResult(gameId, results, store.get('local.localUserId'), reportedAt, version);
  room?.broadcast(ActionTypes.RACE_RESULT, { gameId, results, reportedAt, version });
}

/**
 * Reset sync state (call when leaving a room)
 */
export function resetSyncState() {
  stateInitialized = false;
  peerIdToUserId.clear();
}
