/**
 * State Synchronization
 * Handles P2P state sync and conflict resolution
 */

import { store } from '../state/store.js';
import { ActionTypes, leaveRoom } from './room.js';
import {
  isValidName,
  isValidMatchId,
  isValidScores,
  isValidState,
  shouldUpdateMatch,
  isValidMatchResultPayload,
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

// Track whether we've received initial state (prevents race conditions)
let stateInitialized = false;

// Admin heartbeat interval (broadcasts version for drift detection)
let heartbeatInterval = null;
const HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds

/**
 * Set up state synchronization for a room connection
 * @param {Object} room - Room connection from room.js
 */
export function setupStateSync(room) {
  // --- Handle incoming state requests ---
  room.onAction(ActionTypes.STATE_REQUEST, (payload, peerId) => {
    console.info(`[Sync] State request from ${peerId}`);

    room.sendTo(ActionTypes.STATE_RESPONSE, {
      state: store.serialize(),
      isAdmin: store.isAdmin(),
    }, peerId);
  });

  // --- Handle incoming state responses ---
  room.onAction(ActionTypes.STATE_RESPONSE, (payload, peerId) => {
    console.info(`[Sync] State response from ${peerId}`);

    const remoteState = payload.state;
    const isRemoteAdmin = payload.isAdmin;

    // Validate incoming state structure
    if (!isValidState(remoteState)) {
      console.warn(`[Sync] Invalid state structure from ${peerId}`);
      return;
    }

    // Merge with local state
    if (remoteState) {
      const adminId = remoteState.meta?.adminId;

      // Security: do NOT trust a self-declared isAdmin flag that merely echoes the
      // known adminId. Only establish (or refresh) the peerId → adminId mapping when
      // the sender is provably the admin: either no peer is currently acting as admin
      // (trust-on-first-use during initial sync) or this peer is already that admin.
      // Otherwise a malicious peer could seize admin authority by echoing adminId.
      let trustedAdminId = null;
      if (isRemoteAdmin && adminId) {
        const currentPeers = room.getPeers();
        const activeAdminPeer = [...peerIdToUserId.entries()]
          .find(([pid, uid]) => uid === adminId && currentPeers.includes(pid))?.[0];
        if (!activeAdminPeer || activeAdminPeer === peerId) {
          peerIdToUserId.set(peerId, adminId);
          trustedAdminId = adminId;
        } else {
          console.warn(`[Sync] Rejected admin mapping claim from ${peerId}: admin already active as ${activeAdminPeer}`);
        }
      }

      // Merge state. store.merge's second argument is `senderIsAdmin` (boolean): only
      // grant admin authority when the sender passed the trust check above, so store.merge
      // never treats an arbitrary peer's payload as admin-authoritative (bracket/matches
      // overrides, etc.). A fresh joiner with no local adminId still bootstraps content via
      // store.merge's own `!localAdminId && remoteAdminId` clause.
      store.merge(remoteState, trustedAdminId !== null);

      // Mark state as initialized (prevents race conditions with early messages)
      stateInitialized = true;

      // Reconcile connection status with actual WebRTC peers
      // isConnected is local/ephemeral - it reflects our actual peer connections,
      // not synced state (which may be stale due to LWW timestamps)
      const currentPeers = room.getPeers();
      const myUserId = store.get('local.localUserId');
      for (const participant of store.getParticipantList()) {
        if (participant.id === myUserId) {
          // We're always connected from our own perspective
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

      // Re-announce ourselves to the admin if this is from admin
      // This handles the case where our initial p:join was sent before WebRTC connected
      if (isRemoteAdmin && !store.isAdmin()) {
        const localName = store.get('local.name');
        const localUserId = store.get('local.localUserId');
        if (localName && localUserId) {
          room.broadcast(ActionTypes.PARTICIPANT_JOIN, {
            name: localName,
            localUserId: localUserId,
            joinedAt: Date.now(),
          });
        }
      }
    }
  });

  // --- Handle participant join announcements ---
  room.onAction(ActionTypes.PARTICIPANT_JOIN, (payload, peerId) => {
    // Validate payload
    if (!isValidParticipantJoinPayload(payload)) {
      console.warn(`[Sync] Invalid participant join payload from ${peerId}`);
      return;
    }

    // Use persistent userId if provided, fall back to peerId for backwards compatibility
    const localUserId = payload.localUserId || peerId;
    const adminId = store.get('meta.adminId');

    // Handle manual participant additions (admin only, no peerId needed)
    if (payload.isManual) {
      const senderUserId = peerIdToUserId.get(peerId) || peerId;
      if (!adminId || senderUserId !== adminId) {
        console.warn(`[Sync] Rejected manual participant injection from non-admin: ${senderUserId}`);
        return;
      }
      // Only process if we don't already have this participant
      const existingManual = store.getParticipant(localUserId);
      if (!existingManual) {
        store.addParticipant({
          id: localUserId,
          peerId: null,
          name: payload.name,
          teamId: null,
          seed: store.getParticipantList().length + 1,
          isManual: true,
          isConnected: false,
          claimedBy: null,
          joinedAt: payload.joinedAt || Date.now(),
        });
        console.info(`[Sync] Manual participant added: ${payload.name} (${localUserId})`);
      }
      return;
    }

    // Security: Prevent admin impersonation
    // If someone claims the admin's localUserId, reject unless:
    // 1. We don't have an admin yet (new room), OR
    // 2. We ARE the admin (this is our own join message echoed back)
    if (localUserId === adminId && adminId) {
      if (store.isAdmin()) {
        // This is our own join message - ignore it
        return;
      }
      // Someone else is trying to claim admin ID - reject
      console.warn(`[Sync] Rejected admin impersonation attempt from peer ${peerId}`);
      return;
    }

    // Security: Prevent ID hijacking of connected participants
    // Only allow claiming an existing ID if that participant is disconnected
    const existingParticipant = store.getParticipant(localUserId);
    if (existingParticipant && existingParticipant.isConnected && existingParticipant.peerId && existingParticipant.peerId !== peerId) {
      console.warn(`[Sync] Rejected duplicate localUserId claim from ${peerId} (${localUserId} already connected)`);
      return;
    }

    // Auto-claim: Check if there's an unclaimed manual participant with the exact same name
    const participants = store.getParticipantList();
    const matchingManual = participants.find(p =>
      p.isManual &&
      !p.claimedBy &&
      p.name.toLowerCase() === payload.name.toLowerCase()
    );

    if (matchingManual) {
      // Claim the manual participant slot
      console.info(`[Sync] Auto-claiming manual participant: ${matchingManual.name} (${matchingManual.id}) claimed by ${localUserId}`);

      // Store the peerId → manual participant ID mapping
      peerIdToUserId.set(peerId, matchingManual.id);

      // Update the manual participant with the claimer's info
      store.updateParticipant(matchingManual.id, {
        claimedBy: localUserId,
        isConnected: true,
        peerId: peerId,
      });

      // Broadcast the claim to peers so they also update. Only the admin relays
      // this: a non-admin's broadcast is misattributed by receivers (mapped to the
      // relayer, not payload.id) and would corrupt the relayer's own record. Every
      // peer already runs this auto-claim locally from the PARTICIPANT_JOIN broadcast,
      // so gating the relay to admin keeps claims consistent without corruption.
      if (store.isAdmin()) {
        room.broadcast(ActionTypes.PARTICIPANT_UPDATE, {
          id: matchingManual.id,
          claimedBy: localUserId,
          isConnected: true,
          peerId: peerId,
        });
      }

      return;
    }

    // Store the peerId → localUserId mapping for message routing
    peerIdToUserId.set(peerId, localUserId);

    console.info(`[Sync] Participant join: ${payload.name} (${localUserId}, peer: ${peerId})`);

    // Add or update participant
    if (existingParticipant) {
      store.updateParticipant(localUserId, {
        name: payload.name,
        peerId: peerId,
        isConnected: true,
      });
    } else {
      store.addParticipant({
        id: localUserId,
        peerId: peerId,
        name: payload.name,
        teamId: payload.teamId || null,
        seed: store.getParticipantList().length + 1,
      });
    }
  });

  // --- Handle participant updates ---
  room.onAction(ActionTypes.PARTICIPANT_UPDATE, (payload, peerId) => {
    // Validate payload structure (allowlist-based to prevent field injection)
    if (!isValidParticipantUpdatePayload(payload)) {
      console.warn(`[Sync] Invalid participant update payload from ${peerId}`);
      return;
    }

    const adminId = store.get('meta.adminId');
    let senderUserId = peerIdToUserId.get(peerId);

    // If no mapping exists, try to find participant by peerId or use localUserId from payload
    if (!senderUserId) {
      const participantByPeerId = store.getParticipantByPeerId(peerId);
      if (participantByPeerId) {
        senderUserId = participantByPeerId.id;
        // Cache the mapping for future use
        peerIdToUserId.set(peerId, senderUserId);
      } else if (payload.localUserId) {
        // Anti-impersonation: never accept (or cache) a self-declared identity claim
        // of the admin's id from a peer with no established mapping. Otherwise a peer
        // could set payload.localUserId = adminId and wield persistent admin authority.
        if (adminId && payload.localUserId === adminId) {
          console.warn(`[Sync] Rejected admin identity claim in participant update from ${peerId}`);
          return;
        }
        // Use localUserId from payload (handles case where PARTICIPANT_JOIN was rejected due to empty name)
        senderUserId = payload.localUserId;
        peerIdToUserId.set(peerId, senderUserId);
        console.info(`[Sync] Established mapping from payload: ${peerId} → ${senderUserId}`);
      } else {
        // Still no mapping - use peerId as fallback
        senderUserId = peerId;
      }
    }

    // Admin can update any participant by providing explicit id in payload
    // Non-admin updates apply to self only
    let targetUserId;
    if (senderUserId === adminId && payload.id) {
      targetUserId = payload.id;
      console.info(`[Sync] Admin updating participant ${targetUserId}:`, payload);
    } else {
      targetUserId = senderUserId;
      console.info(`[Sync] Participant update from ${targetUserId}:`, payload);
    }

    // Clean payload - remove routing fields before passing to store
    const { id, localUserId, ...cleanPayload } = payload;

    // If participant doesn't exist and we have a name, add them
    const existing = store.getParticipant(targetUserId);
    if (!existing && cleanPayload.name) {
      console.info(`[Sync] Participant not found, adding as new participant`);
      store.addParticipant({
        id: targetUserId,
        peerId: peerId,
        name: cleanPayload.name,
        isConnected: true,
      });
      peerIdToUserId.set(peerId, targetUserId);
    } else {
      store.updateParticipant(targetUserId, cleanPayload);
    }
  });

  // --- Handle participant leave ---
  room.onAction(ActionTypes.PARTICIPANT_LEAVE, async (payload, peerId) => {
    if (!payload || typeof payload !== 'object') {
      console.warn(`[Sync] Invalid participant leave payload from ${peerId}`);
      return;
    }

    const senderUserId = peerIdToUserId.get(peerId) || peerId;

    // Check if this is an admin removal (has removedId) or voluntary leave
    if (payload.removedId) {
      const adminId = store.get('meta.adminId');

      // Only admin can remove other participants
      if (senderUserId !== adminId) {
        console.warn(`[Sync] Rejected participant removal from non-admin: ${senderUserId}`);
        return;
      }

      const myUserId = store.get('local.localUserId');

      // Was I removed?
      if (payload.removedId === myUserId) {
        console.info('[Sync] You have been removed from the tournament');

        // Show notification
        const { showToast } = await import('../components/toast.js');
        showToast('You have been removed from the tournament', 'warning');

        leaveRoom();

        // Navigate home
        const { navigateToHome } = await import('../state/url-state.js');
        navigateToHome();
        return;
      }

      // Someone else was removed - remove from our store
      console.info(`[Sync] Participant removed by admin: ${payload.removedId}`);
      store.removeParticipant(payload.removedId);
    } else {
      // Voluntary leave - mark as disconnected (they might rejoin)
      console.info(`[Sync] Participant leave: ${senderUserId}`);
      store.updateParticipant(senderUserId, { isConnected: false });
    }
  });

  // --- Handle tournament start (admin only) ---
  room.onAction(ActionTypes.TOURNAMENT_START, async (payload, peerId) => {
    if (!payload || typeof payload !== 'object') {
      console.warn(`[Sync] Invalid tournament start payload from ${peerId}`);
      return;
    }

    const adminId = store.get('meta.adminId');
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    // Only accept from admin
    if (localUserId !== adminId) {
      console.warn(`[Sync] Rejected tournament start from non-admin: ${localUserId}`);
      return;
    }

    console.info('[Sync] Tournament starting');

    // Apply tournament state. Matches go first so no render sees a bracket id missing from them.
    if (payload.matches) {
      store.deserialize({ matches: payload.matches });
    }
    if (Array.isArray(payload.standings)) {
      store.deserialize({ standings: payload.standings });
    }
    if (payload.bracket) {
      store.set('bracket', payload.bracket);
      // Sync meta.type from bracket type (handles mariokart, doubles, etc.)
      if (payload.bracket.type) {
        store.set('meta.type', payload.bracket.type);
      }
    }
    store.set('meta.status', 'active');

    // Navigate to bracket view for non-admins
    if (!store.isAdmin()) {
      const { navigateToBracket } = await import('../state/url-state.js');
      navigateToBracket();
    }
  });

  // --- Handle tournament reset (admin only) ---
  room.onAction(ActionTypes.TOURNAMENT_RESET, async (payload, peerId) => {
    const adminId = store.get('meta.adminId');
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    if (localUserId !== adminId) {
      console.warn(`[Sync] Rejected tournament reset from non-admin: ${localUserId}`);
      return;
    }

    console.info('[Sync] Tournament resetting');

    store.set('meta.status', 'lobby');
    store.set('bracket', null);
    store.setMatches(new Map());
    // Clear mode-specific data (standings for Mario Kart, teamAssignments for Doubles)
    store.deserialize({ standings: [] });
    store.clearTeamAssignments();

    // Navigate non-admins back to lobby view
    if (!store.isAdmin()) {
      const { updateUrlState, URL_PARAMS, VIEWS } = await import('../state/url-state.js');
      updateUrlState({ [URL_PARAMS.VIEW]: VIEWS.LOBBY });
    }
  });

  // --- Handle tournament archive (admin only, for multi-tournament history) ---
  room.onAction(ActionTypes.TOURNAMENT_ARCHIVE, async (payload, peerId) => {
    const adminId = store.get('meta.adminId');
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    if (localUserId !== adminId) {
      console.warn(`[Sync] Rejected tournament archive from non-admin: ${localUserId}`);
      return;
    }

    console.info('[Sync] Tournament archived:', payload.archive?.id);

    // Add archive entry to local history (merge deduplicates by id)
    if (payload.archive) store.merge({ history: [payload.archive] });

    // Reset local state for new tournament (keeps participants and history)
    store.resetForNewTournament();

    // Navigate non-admins back to lobby view
    if (!store.isAdmin()) {
      const { updateUrlState, URL_PARAMS, VIEWS } = await import('../state/url-state.js');
      updateUrlState({ [URL_PARAMS.VIEW]: VIEWS.LOBBY });

      // Show notification
      const { showToast } = await import('../components/toast.js');
      showToast('Ready for new tournament!', 'info');
    }
  });

  // --- Handle match results ---
  room.onAction(ActionTypes.MATCH_RESULT, (payload, peerId) => {
    // Wait for state initialization before processing match results
    if (!stateInitialized && !store.isAdmin()) {
      console.info(`[Sync] Ignoring match result - state not yet initialized`);
      return;
    }

    // Validate payload
    if (!isValidMatchResultPayload(payload)) {
      console.warn(`[Sync] Invalid match result payload from ${peerId}`);
      return;
    }

    // Look up the persistent user ID for this peer
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    console.info(`[Sync] Match result from ${localUserId}:`, payload);

    const { matchId, scores, winnerId, reportedAt, version: incomingVersion = 0 } = payload;
    const match = store.getMatch(matchId);

    if (!match) {
      console.warn(`[Sync] Unknown match: ${matchId}`);
      return;
    }

    // Validate winnerId is actually a participant in the match
    if (!match.participants.includes(winnerId)) {
      console.warn(`[Sync] Winner ${winnerId} not in match participants: ${match.participants}`);
      return;
    }

    // Verify reporter is a participant in the match (using persistent ID)
    const teams = store.get('meta.type') === 'doubles' ? (store.get('bracket')?.teams ?? []) : undefined;
    const isParticipant = isInMatch(match, localUserId, teams);
    const isAdmin = localUserId === store.get('meta.adminId');

    if (!isParticipant && !isAdmin) {
      console.warn(`[Sync] Rejected match result from non-participant: ${localUserId}`);
      return;
    }

    // Protect verified matches from non-admin overwrites
    if (match.verifiedBy && !isAdmin) {
      console.warn(`[Sync] Rejected update to verified match from non-admin: ${localUserId}`);
      return;
    }

    // Apply LWW logic with logical clock
    const incoming = { version: incomingVersion, reportedAt };
    if (shouldUpdateMatch(incoming, match, isAdmin)) {
      store.updateMatch(matchId, {
        scores,
        winnerId,
        reportedBy: localUserId,
        reportedAt,
        version: incomingVersion,  // Store version for future comparisons
      });
      advanceWinner(matchId);
    }
  });

  // --- Handle match verification (admin only) ---
  room.onAction(ActionTypes.MATCH_VERIFY, (payload, peerId) => {
    if (!payload || typeof payload !== 'object') {
      console.warn(`[Sync] Invalid match verify payload from ${peerId}`);
      return;
    }

    const adminId = store.get('meta.adminId');
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    if (localUserId !== adminId) {
      console.warn(`[Sync] Rejected match verify from non-admin: ${localUserId}`);
      return;
    }

    const { matchId, scores, winnerId } = payload;

    // Basic shape validation before applying
    if (!isValidMatchId(matchId) || !isValidScores(scores) || typeof winnerId !== 'string') {
      console.warn(`[Sync] Invalid match verify shape from ${peerId}`);
      return;
    }

    store.updateMatch(matchId, {
      scores,
      winnerId,
      verifiedBy: localUserId,
      reportedAt: Date.now(),
    });
    advanceWinner(matchId);
  });

  // --- Handle standings updates (Mario Kart mode) ---
  room.onAction(ActionTypes.STANDINGS_UPDATE, (payload, peerId) => {
    if (!payload || typeof payload !== 'object') {
      console.warn(`[Sync] Invalid standings update payload from ${peerId}`);
      return;
    }

    const adminId = store.get('meta.adminId');
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    // Only accept from admin
    if (localUserId !== adminId) return;

    if (payload.standings) {
      store.deserialize({ standings: payload.standings });
    }
  });

  // --- Handle race/game results (Points Race mode) ---
  room.onAction(ActionTypes.RACE_RESULT, (payload, peerId) => {
    if (!payload || typeof payload !== 'object') {
      console.warn(`[Sync] Invalid race result payload from ${peerId}`);
      return;
    }

    const { gameId, results, reportedAt, version } = payload;
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    console.info(`[Sync] Race result from ${localUserId}:`, payload);

    const game = store.getMatch(gameId);
    if (!game) {
      console.warn(`[Sync] Unknown game: ${gameId}`);
      return;
    }

    const isParticipant = game.participants.includes(localUserId);
    const isAdmin = localUserId === store.get('meta.adminId');

    if (!isParticipant && !isAdmin) {
      console.warn(`[Sync] Rejected race result from non-participant: ${localUserId}`);
      return;
    }

    const incomingVersion = version || 0;
    if (!shouldUpdateMatch({ version: incomingVersion, reportedAt }, game, isAdmin)) {
      console.info(`[Sync] Ignoring stale race result`);
      return;
    }

    try {
      applyRaceResult(gameId, results, localUserId, reportedAt, incomingVersion);
    } catch (e) {
      console.error('[Sync] Failed to apply race result:', e);
    }
  });

  // --- Handle version check (admin heartbeat for drift detection) ---
  room.onAction(ActionTypes.VERSION_CHECK, (payload, peerId) => {
    if (!payload || typeof payload !== 'object') {
      console.warn(`[Sync] Invalid version check payload from ${peerId}`);
      return;
    }

    const { version } = payload;
    const localVersion = store.get('meta.version') || 0;

    // Heartbeat received = admin is connected
    // This ensures connection status stays accurate even without version drift.
    // Only refresh the mapping when the sender is ALREADY the trusted admin,
    // otherwise a malicious peer could impersonate the admin via heartbeat.
    const adminId = store.get('meta.adminId');
    if (adminId && peerIdToUserId.get(peerId) === adminId) {
      store.updateParticipant(adminId, { isConnected: true, peerId: peerId });
    }

    // If we're behind, request full state sync
    if (version > localVersion) {
      console.info(`[Sync] Version drift detected (local: ${localVersion}, admin: ${version}), requesting sync`);
      room.sendTo(ActionTypes.STATE_REQUEST, {}, peerId);
    }
  });

  // --- Handle peer join/leave for presence ---
  room.onPeerJoin((peerId) => {
    // Try to find participant by peerId mapping or direct lookup
    const localUserId = peerIdToUserId.get(peerId);
    if (localUserId) {
      store.updateParticipant(localUserId, { isConnected: true, peerId: peerId });
    }

    // Request state from new peer (might have fresher data)
    room.sendTo(ActionTypes.STATE_REQUEST, {}, peerId);

    // Re-announce ourselves to the new peer so they can establish the peerId → localUserId
    // mapping and mark us as connected. This is critical for re-joined participants who
    // load stale persisted state with everyone marked as disconnected.
    const myUserId = store.get('local.localUserId');
    const myName = store.get('local.name');
    if (myUserId && myName) {
      room.broadcast(ActionTypes.PARTICIPANT_JOIN, {
        name: myName,
        localUserId: myUserId,
        joinedAt: Date.now(),
      });
    }
  });

  room.onPeerLeave((peerId) => {
    // Find participant by peerId mapping
    const localUserId = peerIdToUserId.get(peerId);
    if (localUserId) {
      store.updateParticipant(localUserId, { isConnected: false });
    }
    // NOTE: Don't delete peerIdToUserId mapping here - peer may reconnect with same localUserId
    // Mapping cleanup happens in resetSyncState() when leaving room entirely
  });

  // --- Initial state request ---
  // Request state from all connected peers
  const peers = room.getPeers();
  if (peers.length > 0) {
    room.broadcast(ActionTypes.STATE_REQUEST, {});
  }

  // --- Admin heartbeat ---
  // Periodically broadcast version so peers can detect drift and request sync
  // Clear any existing interval first (in case of reconnect)
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  heartbeatInterval = setInterval(() => {
    // Only admin broadcasts heartbeat
    if (store.isAdmin() && room.getPeers().length > 0) {
      const version = store.get('meta.version') || 0;
      room.broadcast(ActionTypes.VERSION_CHECK, { version });
    }
  }, HEARTBEAT_INTERVAL_MS);
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
 * Announce joining a room
 * @param {Object} room - Room connection
 * @param {string} name - Display name
 * @param {string} localUserId - Persistent user ID
 */
export function announceJoin(room, name, localUserId) {
  room.broadcast(ActionTypes.PARTICIPANT_JOIN, {
    name,
    localUserId,
    joinedAt: Date.now(),
  });
}

/**
 * Record a local match result, advance the bracket and broadcast the result
 * @param {Object|null} room - Room connection; null records locally only
 * @param {string} matchId - Match ID
 * @param {number[]} scores - Match scores
 * @param {string} winnerId - Winner's participant ID
 */
export function reportMatchResult(room, matchId, scores, winnerId) {
  // Use a per-match logical clock (monotonic per match, consistent across peers),
  // NOT the global meta.version counter. meta.version differs per peer, so comparing
  // it in shouldUpdateMatch drops legitimate corrections and makes reporter/receivers
  // disagree on the same result's version.
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
  if (!store.isAdmin()) {
    console.warn('[Sync] Only admin can start tournament');
    return;
  }

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
 * Archive tournament and broadcast to peers (admin only)
 * @param {Object} room - Room connection
 * @param {Object} archive - History entry from store.archiveTournament()
 */
export function archiveTournament(room, archive) {
  if (!store.isAdmin()) {
    console.warn('[Sync] Only admin can archive tournament');
    return;
  }

  room.broadcast(ActionTypes.TOURNAMENT_ARCHIVE, {
    archive,
  });
}

/**
 * Mark state as initialized (call when admin creates room or loads from storage)
 */
export function markStateInitialized() {
  stateInitialized = true;
}

/**
 * Reset sync state (call when leaving a room)
 */
export function resetSyncState() {
  stateInitialized = false;
  peerIdToUserId.clear();
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
