/**
 * State Synchronization
 * Handles P2P state sync and conflict resolution
 */

import { store } from '../state/store.js';
import { ActionTypes } from './room.js';
import {
  isValidName,
  isValidMatchId,
  isValidScores,
  isValidState,
  shouldUpdateMatch,
  isValidMatchResultPayload,
  isValidParticipantJoinPayload
} from './sync-validators.js';

// Map peerId (transient) to localUserId (persistent)
// This allows us to identify participants across page refreshes
const peerIdToUserId = new Map();

// Track whether we've received initial state (prevents race conditions)
let stateInitialized = false;

/**
 * Set up state synchronization for a room connection
 * @param {Object} room - Room connection from room.js
 */
export function setupStateSync(room) {
  const { selfId } = room;

  // --- Handle incoming state requests ---
  room.onAction(ActionTypes.STATE_REQUEST, (payload, peerId) => {
    console.info(`[Sync] State request from ${peerId}`);

    // Send our current state
    const state = store.serialize();
    room.sendTo(ActionTypes.STATE_RESPONSE, {
      state,
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

      // If this is from the admin, register their peerId → localUserId mapping
      if (isRemoteAdmin && adminId) {
        peerIdToUserId.set(peerId, adminId);
      }

      // Merge state (admin state is given priority in store.merge)
      store.merge(remoteState, adminId);

      // Mark state as initialized (prevents race conditions with early messages)
      stateInitialized = true;

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

    // Store the peerId → localUserId mapping for message routing
    peerIdToUserId.set(peerId, localUserId);

    console.info(`[Sync] Participant join: ${payload.name} (${localUserId}, peer: ${peerId})`);

    // Add or update participant
    const existing = store.getParticipant(localUserId);
    if (existing) {
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
    const adminId = store.get('meta.adminId');
    let senderUserId = peerIdToUserId.get(peerId);

    // If no mapping exists, try to find participant by peerId
    if (!senderUserId) {
      const participantByPeerId = store.getParticipantByPeerId(peerId);
      if (participantByPeerId) {
        senderUserId = participantByPeerId.id;
        // Cache the mapping for future use
        peerIdToUserId.set(peerId, senderUserId);
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

    // If participant doesn't exist and we have a name, add them
    const existing = store.getParticipant(targetUserId);
    if (!existing && payload.name) {
      console.info(`[Sync] Participant not found, adding as new participant`);
      store.addParticipant({
        id: targetUserId,
        peerId: peerId,
        name: payload.name,
        isConnected: true,
      });
      peerIdToUserId.set(peerId, targetUserId);
    } else {
      store.updateParticipant(targetUserId, payload);
    }
  });

  // --- Handle participant leave ---
  room.onAction(ActionTypes.PARTICIPANT_LEAVE, (payload, peerId) => {
    const localUserId = peerIdToUserId.get(peerId) || peerId;
    console.info(`[Sync] Participant leave: ${localUserId}`);

    // Mark as disconnected but don't remove (they might rejoin)
    store.updateParticipant(localUserId, { isConnected: false });
  });

  // --- Handle tournament start (admin only) ---
  room.onAction(ActionTypes.TOURNAMENT_START, async (payload, peerId) => {
    const adminId = store.get('meta.adminId');
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    // Only accept from admin
    if (localUserId !== adminId) {
      console.warn(`[Sync] Rejected tournament start from non-admin: ${localUserId}`);
      return;
    }

    console.info('[Sync] Tournament starting');

    // Apply tournament state
    if (payload.bracket) {
      store.set('bracket', payload.bracket);
      // Sync meta.type from bracket type (handles mariokart, doubles, etc.)
      if (payload.bracket.type) {
        store.set('meta.type', payload.bracket.type);
      }
    }
    if (payload.matches) {
      store.deserialize({ matches: payload.matches });
    }
    store.set('meta.status', 'active');

    // Navigate to bracket view for non-admins
    if (!store.isAdmin()) {
      const { navigateToBracket } = await import('../state/url-state.js');
      navigateToBracket();
    }
  });

  // --- Handle tournament reset (admin only) ---
  room.onAction(ActionTypes.TOURNAMENT_RESET, (payload, peerId) => {
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

    // Verify reporter is a participant in the match (using persistent ID)
    let isParticipant;
    const tournamentType = store.get('meta.type');

    if (tournamentType === 'doubles') {
      // For doubles, check if user's team is in the match
      const bracket = store.get('bracket');
      const teams = bracket?.teams || [];
      const userTeamIds = teams
        .filter(t => t.members.some(m => m.id === localUserId))
        .map(t => t.id);
      isParticipant = match.participants.some(teamId => userTeamIds.includes(teamId));
    } else {
      isParticipant = match.participants.includes(localUserId);
    }

    const isAdmin = localUserId === store.get('meta.adminId');

    if (!isParticipant && !isAdmin) {
      console.warn(`[Sync] Rejected match result from non-participant: ${localUserId}`);
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

      // Update bracket advancement
      advanceWinner(matchId, winnerId);
    }
  });

  // --- Handle match verification (admin only) ---
  room.onAction(ActionTypes.MATCH_VERIFY, (payload, peerId) => {
    const adminId = store.get('meta.adminId');
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    if (localUserId !== adminId) {
      console.warn(`[Sync] Rejected match verify from non-admin: ${localUserId}`);
      return;
    }

    const { matchId, scores, winnerId } = payload;

    store.updateMatch(matchId, {
      scores,
      winnerId,
      verifiedBy: localUserId,
      reportedAt: Date.now(),
    });

    advanceWinner(matchId, winnerId);
  });

  // --- Handle standings updates (Mario Kart mode) ---
  room.onAction(ActionTypes.STANDINGS_UPDATE, (payload, peerId) => {
    const adminId = store.get('meta.adminId');
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    // Only accept from admin
    if (localUserId !== adminId) return;

    if (payload.standings) {
      store.deserialize({ standings: payload.standings });
    }
  });

  // --- Handle race/game results (Points Race mode) ---
  room.onAction(ActionTypes.RACE_RESULT, async (payload, peerId) => {
    const { gameId, results, reportedAt } = payload;
    const localUserId = peerIdToUserId.get(peerId) || peerId;

    console.info(`[Sync] Race result from ${localUserId}:`, payload);

    // Get game from matches
    const game = store.getMatch(gameId);
    if (!game) {
      console.warn(`[Sync] Unknown game: ${gameId}`);
      return;
    }

    // Verify reporter is a participant in the game
    const isParticipant = game.participants.includes(localUserId);
    const isAdmin = localUserId === store.get('meta.adminId');

    if (!isParticipant && !isAdmin) {
      console.warn(`[Sync] Rejected race result from non-participant: ${localUserId}`);
      return;
    }

    // LWW - only apply if newer
    const existingReportedAt = game.reportedAt || 0;
    if (reportedAt <= existingReportedAt && !isAdmin) {
      console.info(`[Sync] Ignoring stale race result`);
      return;
    }

    // Apply the result using mario-kart module
    try {
      const { recordRaceResult } = await import('../tournament/mario-kart.js');

      const bracket = store.get('bracket');
      const matches = store.get('matches');
      const standings = store.get('standings');

      const tournament = {
        ...bracket,
        matches: matches,
        standings: standings,
      };

      recordRaceResult(tournament, gameId, results, localUserId);

      // Update store
      store.set('bracket', {
        ...bracket,
        gamesComplete: tournament.gamesComplete,
        isComplete: tournament.isComplete,
      });
      store.setMatches(tournament.matches);
      store.deserialize({ standings: Array.from(tournament.standings.entries()) });

      if (tournament.isComplete) {
        store.set('meta.status', 'complete');
      }

    } catch (e) {
      console.error('[Sync] Failed to apply race result:', e);
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
  });

  room.onPeerLeave((peerId) => {
    // Find participant by peerId mapping
    const localUserId = peerIdToUserId.get(peerId);
    if (localUserId) {
      store.updateParticipant(localUserId, { isConnected: false });
    }
    // Clean up mapping
    peerIdToUserId.delete(peerId);
  });

  // --- Initial state request ---
  // Request state from all connected peers
  const peers = room.getPeers();
  if (peers.length > 0) {
    room.broadcast(ActionTypes.STATE_REQUEST, {});
  }
}

/**
 * Advance winner to next match in bracket
 * @param {string} matchId - Completed match ID
 * @param {string} winnerId - Winner's participant ID
 */
export function advanceWinner(matchId, winnerId) {
  const bracket = store.get('bracket');
  if (!bracket) return;

  // Handle double-elimination (has winners/losers structure)
  if (bracket.winners) {
    advanceInDoubleElim(bracket, matchId, winnerId);
    return;
  }

  // Handle single-elimination (has rounds array)
  if (!bracket.rounds) return;

  // Find current match
  let currentMatch = null;
  let currentRoundIdx = -1;
  let currentMatchIdx = -1;

  for (let r = 0; r < bracket.rounds.length; r++) {
    const round = bracket.rounds[r];
    for (let m = 0; m < round.matches.length; m++) {
      if (round.matches[m].id === matchId) {
        currentMatch = round.matches[m];
        currentRoundIdx = r;
        currentMatchIdx = m;
        break;
      }
    }
    if (currentMatch) break;
  }

  if (!currentMatch) return;

  // Find next match
  const nextRoundIdx = currentRoundIdx + 1;
  if (nextRoundIdx >= bracket.rounds.length) {
    // This was the finals, tournament is complete
    if (currentRoundIdx === bracket.rounds.length - 1) {
      store.set('meta.status', 'complete');
    }
    return;
  }

  const nextMatchIdx = Math.floor(currentMatchIdx / 2);
  const nextMatch = bracket.rounds[nextRoundIdx]?.matches[nextMatchIdx];

  if (nextMatch) {
    // Determine which slot (0 or 1) the winner goes to
    const slot = currentMatchIdx % 2;
    const newParticipants = [...nextMatch.participants];
    newParticipants[slot] = winnerId;

    store.updateMatch(nextMatch.id, {
      participants: newParticipants,
    });
  }
}

/**
 * Advance winner in double-elimination bracket
 * @param {Object} bracket - Double-elimination bracket
 * @param {string} matchId - Completed match ID
 * @param {string} winnerId - Winner's participant/team ID
 */
function advanceInDoubleElim(bracket, matchId, winnerId) {
  const match = bracket.matches instanceof Map
    ? bracket.matches.get(matchId)
    : bracket.matches?.[matchId];

  if (!match) return;

  const loserId = match.participants.find(p => p !== winnerId);

  if (match.bracket === 'winners') {
    // Advance winner in winners bracket
    const currentRoundIdx = match.round - 1;
    const nextRound = bracket.winners.rounds[currentRoundIdx + 1];

    if (nextRound) {
      const nextMatchIdx = Math.floor(match.position / 2);
      const nextMatch = nextRound.matches[nextMatchIdx];
      if (nextMatch) {
        const slot = match.position % 2;
        store.updateMatch(nextMatch.id, {
          participants: updateSlot(nextMatch.participants, slot, winnerId),
        });
      }
    } else {
      // Winners finals - advance to grand finals
      const gf = bracket.grandFinals.match;
      store.updateMatch(gf.id, {
        participants: updateSlot(gf.participants, 0, winnerId),
      });
    }

    // Drop loser to losers bracket
    if (loserId && !match.isBye && match.dropsTo) {
      const losersRound = bracket.losers.rounds[match.dropsTo.round - 1];
      if (losersRound) {
        const targetMatch = losersRound.matches[match.dropsTo.position];
        if (targetMatch) {
          store.updateMatch(targetMatch.id, {
            participants: updateSlot(targetMatch.participants, 1, loserId),
          });
        }
      }
    }
  } else if (match.bracket === 'losers') {
    // Advance winner in losers bracket
    const currentRoundIdx = match.round - 1;
    const nextRound = bracket.losers.rounds[currentRoundIdx + 1];

    if (nextRound) {
      const nextMatchIdx = match.isMinorRound ? match.position : Math.floor(match.position / 2);
      const nextMatch = nextRound.matches[nextMatchIdx];
      if (nextMatch) {
        const slot = match.isMinorRound ? 0 : match.position % 2;
        store.updateMatch(nextMatch.id, {
          participants: updateSlot(nextMatch.participants, slot, winnerId),
        });
      }
    } else {
      // Losers finals - advance to grand finals
      const gf = bracket.grandFinals.match;
      store.updateMatch(gf.id, {
        participants: updateSlot(gf.participants, 1, winnerId),
      });
    }
  } else if (match.bracket === 'grandFinals') {
    // Handle grand finals
    if (match.id === 'gf1') {
      if (winnerId === match.participants[1]) {
        // Losers champ won - need bracket reset
        const reset = bracket.grandFinals.reset;
        store.updateMatch(reset.id, {
          participants: [...match.participants],
        });
      } else {
        // Winners champ won - tournament complete
        store.set('meta.status', 'complete');
      }
    } else if (match.id === 'gf2') {
      // Bracket reset complete
      store.set('meta.status', 'complete');
    }
  }
}

/**
 * Update a single slot in participants array
 */
function updateSlot(participants, slot, value) {
  const updated = [...participants];
  updated[slot] = value;
  return updated;
}

/**
 * Broadcast local state to all peers (admin use)
 * @param {Object} room - Room connection
 */
export function broadcastState(room) {
  if (!store.isAdmin()) {
    console.warn('[Sync] Only admin can broadcast full state');
    return;
  }

  room.broadcast(ActionTypes.STATE_RESPONSE, {
    state: store.serialize(),
    isAdmin: true,
  });
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
 * Report match result
 * @param {Object} room - Room connection
 * @param {string} matchId - Match ID
 * @param {number[]} scores - Match scores
 * @param {string} winnerId - Winner's participant ID
 */
export function reportMatchResult(room, matchId, scores, winnerId) {
  room.broadcast(ActionTypes.MATCH_RESULT, {
    matchId,
    scores,
    winnerId,
    reportedAt: Date.now(),
    version: store.get('meta.version') || 0,  // Logical clock for conflict resolution
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
  });
}

/**
 * Report race/game result (Points Race mode)
 * @param {Object} room - Room connection
 * @param {string} gameId - Game ID
 * @param {Object[]} results - Array of { participantId, position }
 */
export function reportRaceResult(room, gameId, results) {
  room.broadcast(ActionTypes.RACE_RESULT, {
    gameId,
    results,
    reportedAt: Date.now(),
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
}

