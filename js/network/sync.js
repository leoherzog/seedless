/**
 * Binds room actions to the store: state sync with new peers, participant
 * lifecycle, admin-only tournament actions and match reporting. Senders are
 * trusted only through the peerId to localUserId map.
 */

import { store } from '../state/store.js';
import { navigateToHome } from '../state/url-state.js';
import { showToast, showInfo } from '../components/toast.js';
import { ActionTypes } from './room.js';
import {
  isValidState,
  isValidMatchResultPayload,
  isValidMatchVerifyPayload,
  isValidParticipantJoinPayload,
  isValidParticipantUpdatePayload,
  isValidRaceResultPayload,
} from './sync-validators.js';
import { advance as advanceSingle } from '../tournament/single-elimination.js';
import { advance as advanceDouble } from '../tournament/double-elimination.js';
import { recordRaceResult, scoreRace } from '../tournament/mario-kart.js';
import { isInMatch, isNewerResult } from '../utils/tournament-helpers.js';

// Transient WebRTC peerId to persistent localUserId, which survives page refreshes.
const peerIdToUserId = new Map();

// Non-admins ignore match results until their first state response.
let stateInitialized = false;

// Peers whose identity claim lost to another connected peer holding the same id, retried when a
// peer leaves. Each maps to its rejected p:join payload, or to null for an st:res admin claim.
const deferredClaims = new Map();

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
 * Whether a match has both players seated, one of them winnerId. Replay clears any other result.
 * @param {Object} match - Bracket match
 * @param {string} winnerId - Reported winner
 * @returns {boolean}
 */
const isSeated = (match, winnerId) => !match.participants.includes(null) && match.participants.includes(winnerId);

/**
 * Send our p:join so peers can map our peerId to our persistent ID.
 * @param {Object} room - Room connection
 * @param {string} [peerId] - The one peer to tell; every peer when omitted
 */
function announceSelf(room, peerId) {
  const name = store.get('local.name');
  const localUserId = store.get('local.localUserId');
  if (!name || !localUserId) return;
  if (peerId) {
    room.sendTo(ActionTypes.PARTICIPANT_JOIN, { name, localUserId }, peerId);
  } else {
    room.broadcast(ActionTypes.PARTICIPANT_JOIN, { name, localUserId });
  }
}

/**
 * Decide whether an st:res claiming admin speaks for the admin, and map its sender if so. The
 * admin trusts no claim, and a claim may neither name the local user nor change a known adminId.
 * While another connected peer holds the mapping the claim waits in deferredClaims.
 * @param {Object} room - Room connection
 * @param {*} claimedId - The snapshot's meta.adminId
 * @param {string} peerId - Sender's peer ID
 * @returns {boolean} True when the sender is mapped to the admin
 */
function acceptAdminClaim(room, claimedId, peerId) {
  const knownId = store.get('meta.adminId');
  if (store.isAdmin() || typeof claimedId !== 'string' || claimedId === store.get('local.localUserId') ||
      (knownId && claimedId !== knownId)) {
    return false;
  }

  const peers = room.getPeers();
  const holder = [...peerIdToUserId]
    .find(([pid, uid]) => uid === claimedId && pid !== peerId && peers.includes(pid))?.[0];
  if (holder) {
    console.warn(`[Sync] Rejected admin mapping claim from ${peerId}: admin already active as ${holder}`);
    deferredClaims.set(peerId, null);
    return false;
  }

  peerIdToUserId.set(peerId, claimedId);
  return true;
}

/**
 * Send the full state, flagged as the admin's when it is.
 * @param {Object} room - Room connection
 * @param {string} [peerId] - The one peer to send to; every peer when omitted
 */
export function sendState(room, peerId) {
  const payload = { state: store.serialize(), isAdmin: store.isAdmin() };
  if (peerId) {
    room.sendTo(ActionTypes.STATE_RESPONSE, payload, peerId);
  } else {
    room.broadcast(ActionTypes.STATE_RESPONSE, payload);
  }
}

/**
 * Register every action and peer handler on a room connection.
 * @param {Object} room - Room connection from room.js
 */
export function setupStateSync(room) {
  // Asks a peer for its state, to catch up on results that have not reached us.
  const requestState = (peerId) => room.sendTo(ActionTypes.STATE_REQUEST, {}, peerId);

  room.onAction(ActionTypes.STATE_REQUEST, (payload, peerId) => sendState(room, peerId));

  room.onAction(ActionTypes.STATE_RESPONSE, (payload, peerId) => {
    const { state: remoteState, isAdmin: claimsAdmin } = payload;
    if (!isValidState(remoteState)) {
      console.warn(`[Sync] Invalid state structure from ${peerId}`);
      return;
    }

    // An isAdmin flag proves nothing alone; only a sender that passes the claim check merges as admin.
    const senderIsAdmin = claimsAdmin === true && acceptAdminClaim(room, remoteState.meta?.adminId, peerId);
    store.merge(remoteState, senderIsAdmin);
    stateInitialized = true;

    const currentPeers = room.getPeers();

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
    if (claimsAdmin === true && !store.isAdmin()) {
      announceSelf(room, peerId);
    }

    // Merged results change the seats and standings that follow from them.
    reconcile();
  });

  room.onAction(ActionTypes.PARTICIPANT_JOIN, (payload, peerId) => handleJoin(payload, peerId));

  /**
   * Map a joining peer to its persistent ID, or to the manual player it claims by name.
   * @param {Object} payload - p:join payload
   * @param {string} peerId - Sender's peer ID
   */
  function handleJoin(payload, peerId) {
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
      deferredClaims.set(peerId, payload);
      return;
    }

    // Auto-claim an unclaimed manual participant whose name matches, ignoring case.
    const matchingManual = store.getParticipantList().find(p =>
      p.isManual &&
      !p.claimedBy &&
      p.name.toLowerCase() === name.toLowerCase()
    );

    if (matchingManual) {
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

    if (existingParticipant) {
      store.updateParticipant(localUserId, { name, peerId, isConnected: true });
    } else {
      store.addParticipant({ id: localUserId, peerId, name });
    }
  }

  room.onAction(ActionTypes.PARTICIPANT_UPDATE, (payload, peerId) => {
    if (!isValidParticipantUpdatePayload(payload)) {
      console.warn(`[Sync] Invalid participant update payload from ${peerId}`);
      return;
    }

    // The admin may update anyone by id; everyone else updates only themselves.
    const { id, ...updates } = payload;
    const targetUserId = id && isFromAdmin(peerId) ? id : senderOf(peerId);
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
      showToast('You have been removed from the tournament', 'warning');
      navigateToHome();
      return;
    }

    store.removeParticipant(payload.removedId);
  });

  room.onAction(ActionTypes.TOURNAMENT_START, (payload, peerId) => {
    if (!isFromAdmin(peerId)) {
      console.warn(`[Sync] Rejected tournament start from non-admin: ${senderOf(peerId)}`);
      return;
    }

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

    // The sender is the verified admin; merge skips an archive whose id is already in history.
    if (payload.archive) store.merge({ history: [payload.archive] }, true);
    store.resetForNewTournament();

    if (!store.isAdmin()) {
      showInfo('Ready for new tournament!');
    }
  });

  room.onAction(ActionTypes.MATCH_RESULT, (payload, peerId) => {
    if (!stateInitialized && !store.isAdmin()) return;

    if (!isValidMatchResultPayload(payload)) {
      console.warn(`[Sync] Invalid match result payload from ${peerId}`);
      return;
    }

    const senderId = senderOf(peerId);
    const { matchId, scores, winnerId, reportedAt, version = 0 } = payload;
    const match = store.getMatch(matchId);

    if (!match) {
      console.warn(`[Sync] Unknown match: ${matchId}`);
      return;
    }

    // A winner, opponent or sender not seated here usually means an earlier result has not reached us.
    if (!isSeated(match, winnerId)) {
      console.warn(`[Sync] Winner ${winnerId} not seated with an opponent in ${matchId}: ${match.participants}`);
      requestState(peerId);
      return;
    }

    const teams = store.get('meta.type') === 'doubles' ? (store.get('bracket')?.teams ?? []) : undefined;
    const isAdmin = isFromAdmin(peerId);

    if (!isInMatch(match, senderId, teams) && !isAdmin) {
      console.warn(`[Sync] Rejected match result from non-participant: ${senderId}`);
      requestState(peerId);
      return;
    }

    if (match.verifiedBy && !isAdmin) {
      console.warn(`[Sync] Rejected update to verified match from non-admin: ${senderId}`);
      return;
    }

    const result = { scores, winnerId, reportedBy: senderId, reportedAt, version };
    if (isNewerResult(result, match)) {
      store.updateMatch(matchId, result);
      reconcile();
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
    const match = store.getMatch(matchId);
    if (!match) return;
    // An unseated player means an earlier result has not reached us.
    if (!isSeated(match, winnerId)) {
      requestState(peerId);
      return;
    }
    store.updateMatch(matchId, { scores, winnerId, verifiedBy: senderOf(peerId) });
    reconcile();
  });

  room.onAction(ActionTypes.RACE_RESULT, (payload, peerId) => {
    if (!isValidRaceResultPayload(payload)) {
      console.warn(`[Sync] Invalid race result payload from ${peerId}`);
      return;
    }

    const { gameId, results, reportedAt, version = 0 } = payload;
    const senderId = senderOf(peerId);

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

    if (!isNewerResult({ version, reportedAt, reportedBy: senderId }, game)) return;

    try {
      applyRaceResult(gameId, results, senderId, reportedAt, version);
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
    requestState(peerId);
    announceSelf(room);
  });

  room.onPeerLeave((peerId) => {
    const userId = peerIdToUserId.get(peerId);
    if (userId) {
      store.updateParticipant(userId, { isConnected: false });
    }
    // Keep the mapping so a peer that reconnects is still recognized.

    // A claim that lost to the departed peer can succeed now, so retry every waiting claim.
    deferredClaims.delete(peerId);
    const peers = room.getPeers();
    for (const [pid, joinPayload] of [...deferredClaims]) {
      deferredClaims.delete(pid);
      if (!peers.includes(pid)) continue;
      if (joinPayload) {
        handleJoin(joinPayload, pid);
      } else {
        requestState(pid);
      }
    }
  });
}

/**
 * Re-derive what follows from the stored results: bracket seats and walkovers, or Points Race
 * scores and standings. An active or complete tournament is complete exactly when a champion
 * is decided or every game is played.
 */
export function reconcile() {
  const bracket = store.get('bracket');
  const matches = store.get('matches');
  let complete;
  if (bracket?.type === 'mariokart') {
    complete = scoreRace({ ...bracket, matches, standings: store.get('standings') });
    store.emit('change', { path: 'standings' });
  } else if (bracket?.winners || bracket?.rounds) {
    const advance = bracket.winners ? advanceDouble : advanceSingle;
    complete = advance({ bracket, matches }, (id, fields) => store.updateMatch(id, fields));
  } else {
    return;
  }

  const status = store.get('meta.status');
  const next = complete ? 'complete' : 'active';
  if ((status === 'active' || status === 'complete') && status !== next) {
    store.set('meta.status', next);
  }
}

/**
 * Apply a race result to the store's game and standings, then reconcile.
 * @param {string} gameId - Game ID
 * @param {Object[]} results - Array of { participantId }, in finishing order
 * @param {string} reportedBy - Reporter's persistent ID
 * @param {number} reportedAt - Reporter's timestamp
 * @param {number} version - Per-game logical clock
 */
function applyRaceResult(gameId, results, reportedBy, reportedAt, version) {
  const race = { ...store.get('bracket'), matches: store.get('matches'), standings: store.get('standings') };
  recordRaceResult(race, gameId, results, reportedBy, reportedAt);
  store.updateMatch(gameId, { version });
  reconcile();
}

/**
 * Record a local match result, advance the bracket and broadcast the result.
 * @param {Object|null} room - Room connection; null records locally only
 * @param {string} matchId - Match ID
 * @param {number[]} scores - Match scores
 * @param {string} winnerId - Winner's participant ID
 */
export function reportMatchResult(room, matchId, scores, winnerId) {
  // Store the same per-match version and timestamp we broadcast, so reporter and receivers agree.
  const match = store.getMatch(matchId);
  const version = (match?.version || 0) + 1;
  const reportedAt = Date.now();

  store.updateMatch(matchId, {
    scores,
    winnerId,
    reportedBy: store.get('local.localUserId'),
    reportedAt,
    version,
  });
  reconcile();

  room?.broadcast(ActionTypes.MATCH_RESULT, {
    matchId,
    scores,
    winnerId,
    reportedAt,
    version,
  });
}

/**
 * Broadcast a started tournament to peers. Admin only; the caller has already applied it locally.
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
 * Record a local Points Race result and broadcast it.
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
 * Forget peer mappings and sync progress. Call when leaving a room.
 */
export function resetSyncState() {
  stateInitialized = false;
  peerIdToUserId.clear();
  deferredClaims.clear();
}
