/**
 * State Synchronization
 * Handles P2P state sync and conflict resolution
 */

import { store } from '../state/store.js';
import { saveTournament } from '../state/persistence.js';
import { ActionTypes } from './room.js';

// --- Validation helpers ---
const MAX_NAME_LENGTH = 100;
const MAX_MATCH_ID_LENGTH = 50;

// Map peerId (transient) to odocalUserId (persistent)
// This allows us to identify participants across page refreshes
const peerIdToUserId = new Map();

function isValidName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= MAX_NAME_LENGTH;
}

function isValidMatchId(matchId) {
  return typeof matchId === 'string' && matchId.length > 0 && matchId.length <= MAX_MATCH_ID_LENGTH;
}

function isValidScores(scores) {
  return Array.isArray(scores) &&
    scores.length === 2 &&
    typeof scores[0] === 'number' &&
    typeof scores[1] === 'number';
}

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

    // Merge with local state
    if (remoteState) {
      const adminId = remoteState.meta?.adminId;

      // If this is from the admin, register their peerId → odocalUserId mapping
      if (isRemoteAdmin && adminId) {
        peerIdToUserId.set(peerId, adminId);
      }

      // Merge state (admin state is given priority in store.merge)
      store.merge(remoteState, adminId);

      // Persist merged state
      if (store.get('meta.id')) {
        saveTournament(store.get('meta.id'), store.serialize());
      }

      // Re-announce ourselves to the admin if this is from admin
      // This handles the case where our initial p:join was sent before WebRTC connected
      if (isRemoteAdmin && !store.isAdmin()) {
        const localName = store.get('local.name');
        const localUserId = store.get('local.odocalUserId');
        if (localName && localUserId) {
          room.broadcast(ActionTypes.PARTICIPANT_JOIN, {
            name: localName,
            odocalUserId: localUserId,
            joinedAt: Date.now(),
          });
        }
      }
    }
  });

  // --- Handle participant join announcements ---
  room.onAction(ActionTypes.PARTICIPANT_JOIN, (payload, peerId) => {
    // Validate payload
    if (!payload || !isValidName(payload.name)) {
      console.warn(`[Sync] Invalid participant join payload from ${peerId}`);
      return;
    }

    // Use persistent userId if provided, fall back to peerId for backwards compatibility
    const odocalUserId = payload.odocalUserId || peerId;

    // Store the peerId → odocalUserId mapping for message routing
    peerIdToUserId.set(peerId, odocalUserId);

    console.info(`[Sync] Participant join: ${payload.name} (${odocalUserId}, peer: ${peerId})`);

    // Add or update participant
    const existing = store.getParticipant(odocalUserId);
    if (existing) {
      store.updateParticipant(odocalUserId, {
        name: payload.name,
        peerId: peerId,
        isConnected: true,
      });
    } else {
      store.addParticipant({
        id: odocalUserId,
        peerId: peerId,
        name: payload.name,
        teamId: payload.teamId || null,
        seed: store.getParticipantList().length + 1,
      });
    }

    // Persist
    if (store.get('meta.id')) {
      saveTournament(store.get('meta.id'), store.serialize());
    }
  });

  // --- Handle participant updates ---
  room.onAction(ActionTypes.PARTICIPANT_UPDATE, (payload, peerId) => {
    let odocalUserId = peerIdToUserId.get(peerId);

    // If no mapping exists, try to find participant by peerId
    if (!odocalUserId) {
      const participantByPeerId = store.getParticipantByPeerId(peerId);
      if (participantByPeerId) {
        odocalUserId = participantByPeerId.id;
        // Cache the mapping for future use
        peerIdToUserId.set(peerId, odocalUserId);
      } else {
        // Still no mapping - use peerId as fallback
        odocalUserId = peerId;
      }
    }

    console.info(`[Sync] Participant update from ${odocalUserId}:`, payload);

    // If participant doesn't exist and we have a name, add them
    const existing = store.getParticipant(odocalUserId);
    if (!existing && payload.name) {
      console.info(`[Sync] Participant not found, adding as new participant`);
      store.addParticipant({
        id: odocalUserId,
        peerId: peerId,
        name: payload.name,
        isConnected: true,
      });
      peerIdToUserId.set(peerId, odocalUserId);
    } else {
      store.updateParticipant(odocalUserId, payload);
    }

    if (store.get('meta.id')) {
      saveTournament(store.get('meta.id'), store.serialize());
    }
  });

  // --- Handle participant leave ---
  room.onAction(ActionTypes.PARTICIPANT_LEAVE, (payload, peerId) => {
    const odocalUserId = peerIdToUserId.get(peerId) || peerId;
    console.info(`[Sync] Participant leave: ${odocalUserId}`);

    // Mark as disconnected but don't remove (they might rejoin)
    store.updateParticipant(odocalUserId, { isConnected: false });

    if (store.get('meta.id')) {
      saveTournament(store.get('meta.id'), store.serialize());
    }
  });

  // --- Handle tournament start (admin only) ---
  room.onAction(ActionTypes.TOURNAMENT_START, async (payload, peerId) => {
    const adminId = store.get('meta.adminId');
    const odocalUserId = peerIdToUserId.get(peerId) || peerId;

    // Only accept from admin
    if (odocalUserId !== adminId) {
      console.warn(`[Sync] Rejected tournament start from non-admin: ${odocalUserId}`);
      return;
    }

    console.info('[Sync] Tournament starting');

    // Apply tournament state
    if (payload.bracket) {
      store.set('bracket', payload.bracket);
    }
    if (payload.matches) {
      store.deserialize({ matches: payload.matches });
    }
    store.set('meta.status', 'active');

    if (store.get('meta.id')) {
      saveTournament(store.get('meta.id'), store.serialize());
    }

    // Navigate to bracket view for non-admins
    if (!store.isAdmin()) {
      const { navigateToBracket } = await import('../state/url-state.js');
      navigateToBracket();
    }
  });

  // --- Handle tournament reset (admin only) ---
  room.onAction(ActionTypes.TOURNAMENT_RESET, (payload, peerId) => {
    const adminId = store.get('meta.adminId');
    const odocalUserId = peerIdToUserId.get(peerId) || peerId;

    if (odocalUserId !== adminId) {
      console.warn(`[Sync] Rejected tournament reset from non-admin: ${odocalUserId}`);
      return;
    }

    console.info('[Sync] Tournament resetting');

    store.set('meta.status', 'lobby');
    store.set('bracket', null);
    store.setMatches(new Map());

    if (store.get('meta.id')) {
      saveTournament(store.get('meta.id'), store.serialize());
    }
  });

  // --- Handle match results ---
  room.onAction(ActionTypes.MATCH_RESULT, (payload, peerId) => {
    // Validate payload
    if (!payload ||
        !isValidMatchId(payload.matchId) ||
        !isValidScores(payload.scores) ||
        typeof payload.winnerId !== 'string' ||
        typeof payload.reportedAt !== 'number') {
      console.warn(`[Sync] Invalid match result payload from ${peerId}`);
      return;
    }

    // Look up the persistent user ID for this peer
    const odocalUserId = peerIdToUserId.get(peerId) || peerId;

    console.info(`[Sync] Match result from ${odocalUserId}:`, payload);

    const { matchId, scores, winnerId, reportedAt } = payload;
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
        .filter(t => t.members.some(m => m.id === odocalUserId))
        .map(t => t.id);
      isParticipant = match.participants.some(teamId => userTeamIds.includes(teamId));
    } else {
      isParticipant = match.participants.includes(odocalUserId);
    }

    const isAdmin = odocalUserId === store.get('meta.adminId');

    if (!isParticipant && !isAdmin) {
      console.warn(`[Sync] Rejected match result from non-participant: ${odocalUserId}`);
      return;
    }

    // Apply LWW logic
    // Accept update if:
    // 1. Newer timestamp (standard LWW), OR
    // 2. Admin is reporting and match isn't already admin-verified
    const existingReportedAt = match.reportedAt || 0;
    const shouldUpdate = reportedAt > existingReportedAt ||
      (isAdmin && !match.verifiedBy);

    if (shouldUpdate) {
      store.updateMatch(matchId, {
        scores,
        winnerId,
        reportedBy: odocalUserId,
        reportedAt,
      });

      // Update bracket advancement
      advanceWinner(matchId, winnerId);

      if (store.get('meta.id')) {
        saveTournament(store.get('meta.id'), store.serialize());
      }
    }
  });

  // --- Handle match verification (admin only) ---
  room.onAction(ActionTypes.MATCH_VERIFY, (payload, peerId) => {
    const adminId = store.get('meta.adminId');
    const odocalUserId = peerIdToUserId.get(peerId) || peerId;

    if (odocalUserId !== adminId) {
      console.warn(`[Sync] Rejected match verify from non-admin: ${odocalUserId}`);
      return;
    }

    const { matchId, scores, winnerId } = payload;

    store.updateMatch(matchId, {
      scores,
      winnerId,
      verifiedBy: odocalUserId,
      reportedAt: Date.now(),
    });

    advanceWinner(matchId, winnerId);

    if (store.get('meta.id')) {
      saveTournament(store.get('meta.id'), store.serialize());
    }
  });

  // --- Handle standings updates (Mario Kart mode) ---
  room.onAction(ActionTypes.STANDINGS_UPDATE, (payload, peerId) => {
    const adminId = store.get('meta.adminId');
    const odocalUserId = peerIdToUserId.get(peerId) || peerId;

    // Only accept from admin
    if (odocalUserId !== adminId) return;

    if (payload.standings) {
      store.deserialize({ standings: payload.standings });
    }

    if (store.get('meta.id')) {
      saveTournament(store.get('meta.id'), store.serialize());
    }
  });

  // --- Handle race/game results (Points Race mode) ---
  room.onAction(ActionTypes.RACE_RESULT, async (payload, peerId) => {
    const { gameId, results, reportedAt } = payload;
    const odocalUserId = peerIdToUserId.get(peerId) || peerId;

    console.info(`[Sync] Race result from ${odocalUserId}:`, payload);

    // Get game from matches
    const game = store.getMatch(gameId);
    if (!game) {
      console.warn(`[Sync] Unknown game: ${gameId}`);
      return;
    }

    // Verify reporter is a participant in the game
    const isParticipant = game.participants.includes(odocalUserId);
    const isAdmin = odocalUserId === store.get('meta.adminId');

    if (!isParticipant && !isAdmin) {
      console.warn(`[Sync] Rejected race result from non-participant: ${odocalUserId}`);
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

      recordRaceResult(tournament, gameId, results, odocalUserId);

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

      // Persist
      if (store.get('meta.id')) {
        saveTournament(store.get('meta.id'), store.serialize());
      }

    } catch (e) {
      console.error('[Sync] Failed to apply race result:', e);
    }
  });

  // --- Handle peer join/leave for presence ---
  room.onPeerJoin((peerId) => {
    // Try to find participant by peerId mapping or direct lookup
    const odocalUserId = peerIdToUserId.get(peerId);
    if (odocalUserId) {
      store.updateParticipant(odocalUserId, { isConnected: true, peerId: peerId });
    }

    // Request state from new peer (might have fresher data)
    room.sendTo(ActionTypes.STATE_REQUEST, {}, peerId);
  });

  room.onPeerLeave((peerId) => {
    // Find participant by peerId mapping
    const odocalUserId = peerIdToUserId.get(peerId);
    if (odocalUserId) {
      store.updateParticipant(odocalUserId, { isConnected: false });
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
function advanceWinner(matchId, winnerId) {
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
 * @param {string} odocalUserId - Persistent user ID
 */
export function announceJoin(room, name, odocalUserId) {
  room.broadcast(ActionTypes.PARTICIPANT_JOIN, {
    name,
    odocalUserId,
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

