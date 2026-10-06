/**
 * Central State Store
 * Event-emitting store for tournament state management
 */

import { getFinalStandings } from '../tournament/standings.js';

/**
 * @typedef {Object} Participant
 * @property {string} id - Unique ID (user_ for connected, manual_ for manual)
 * @property {string} name - Display name
 * @property {string|null} teamId - Team ID for doubles
 * @property {boolean} isConnected - Connection status (always false for manual until claimed)
 * @property {boolean} isManual - True if manually added by admin
 * @property {string|null} claimedBy - localUserId of user who claimed this slot
 * @property {number} seed - Seeding position
 * @property {number} joinedAt - Join timestamp
 */

/**
 * @typedef {Object} Match
 * @property {string} id - Match ID
 * @property {number} round - Round number
 * @property {number} position - Position in round
 * @property {[string|null, string|null]} participants - Participant IDs
 * @property {[number, number]} scores - Match scores
 * @property {string|null} winnerId - Winner's participant ID
 * @property {string|null} reportedBy - Who reported the result
 * @property {number|null} reportedAt - Report timestamp
 * @property {string|null} verifiedBy - Admin who verified (if disputed)
 * @property {boolean} isBye - Is this a bye match
 */

/**
 * @typedef {Object} TournamentState
 * @property {Object} meta - Tournament metadata
 * @property {Map<string, Participant>} participants - Participants map
 * @property {Object|null} bracket - Bracket structure; its rounds hold ids into matches
 * @property {Map<string, Match>} matches - Matches map
 * @property {Map<string, Object>} standings - Standings (Mario Kart)
 * @property {Object} local - Local-only state (not synced)
 */

// Event emitter mixin
class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this._listeners.has(event)) {
      this._listeners.get(event).delete(callback);
    }
  }

  emit(event, data) {
    if (this._listeners.has(event)) {
      for (const callback of this._listeners.get(event)) {
        try {
          callback(data);
        } catch (e) {
          console.error(`Error in event listener for ${event}:`, e);
        }
      }
    }
  }
}

/**
 * Generate a unique ID for a manual participant
 * Uses crypto random values with manual_ prefix
 * @returns {string} Manual participant ID (e.g., 'manual_a1b2c3d4')
 */
function generateManualParticipantId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `manual_${hex}`;
}

// Initial state factory
function createInitialState() {
  return {
    meta: {
      id: null,
      name: '',
      type: 'single',
      adminId: null,
      status: 'lobby', // 'lobby' | 'active' | 'complete'
      config: {
        bestOf: 1,
        numRounds: 4,
        teamSize: 2,
        seedingMode: 'random',
        pointsTable: null,
      },
      createdAt: null,
      version: 0,
    },
    participants: new Map(),
    bracket: null,
    matches: new Map(),
    standings: new Map(),
    teamAssignments: new Map(), // participantId -> teamId
    history: [], // Array of archived tournament summaries
    local: {
      peerId: null,
      name: '',
      view: 'home',
      isAdmin: false,
      isConnected: false,
      pendingActions: [],
    },
  };
}

// Store implementation
class Store extends EventEmitter {
  constructor() {
    super();
    this._state = createInitialState();
  }

  // Get current state (returns reference - callers should not mutate directly)
  getState() {
    return this._state;
  }

  // Get specific state slice
  get(path) {
    const parts = path.split('.');
    let value = this._state;
    for (const part of parts) {
      if (value == null) return undefined;
      value = value instanceof Map ? value.get(part) : value[part];
    }
    return value;
  }

  // Set state and emit change event
  set(path, value) {
    const parts = path.split('.');
    const lastPart = parts.pop();
    let target = this._state;

    for (const part of parts) {
      if (target instanceof Map) {
        if (!target.has(part)) {
          target.set(part, {});
        }
        target = target.get(part);
      } else {
        if (target[part] == null) {
          target[part] = {};
        }
        target = target[part];
      }
    }

    const oldValue = target instanceof Map ? target.get(lastPart) : target[lastPart];

    if (target instanceof Map) {
      target.set(lastPart, value);
    } else {
      target[lastPart] = value;
    }

    this.emit('change', { path, value, oldValue });
    this.emit(`change:${parts.concat(lastPart).join('.')}`, { value, oldValue });

    return this;
  }

  // Batch multiple updates
  batch(updates) {
    const changes = [];
    for (const [path, value] of Object.entries(updates)) {
      const oldValue = this.get(path);
      this.set(path, value);
      changes.push({ path, value, oldValue });
    }
    this.emit('batch', changes);
    return this;
  }

  // Reset to initial state
  reset() {
    this._state = createInitialState();
    this.emit('reset');
    return this;
  }

  // --- Participant methods ---

  addParticipant(participant) {
    const existing = this._state.participants.get(participant.id);
    if (existing) {
      // Update existing participant (preserve seed and other data)
      this._state.participants.set(participant.id, {
        ...existing,
        ...participant,
        isConnected: true,
      });
    } else {
      // Add new participant
      this._state.participants.set(participant.id, {
        ...participant,
        joinedAt: participant.joinedAt || Date.now(),
        isConnected: true,
        seed: participant.seed || this._state.participants.size + 1,
      });
      this.emit('participant:join', participant);
    }
    this._state.meta.version++;
    this.emit('change', { path: 'participants' });
    return this;
  }

  updateParticipant(id, updates) {
    const participant = this._state.participants.get(id);
    if (participant) {
      // Add updatedAt timestamp for LWW conflict resolution during state sync
      Object.assign(participant, updates, { updatedAt: Date.now() });
      this._state.meta.version++;
      this.emit('participant:update', { id, updates });
      this.emit('change', { path: 'participants' });
    }
    return this;
  }

  removeParticipant(id) {
    const participant = this._state.participants.get(id);
    if (participant) {
      this._state.participants.delete(id);
      this._state.meta.version++;
      this.emit('participant:leave', participant);
      this.emit('change', { path: 'participants' });
    }
    return this;
  }

  getParticipant(id) {
    return this._state.participants.get(id);
  }

  getParticipantByPeerId(peerId) {
    for (const p of this._state.participants.values()) {
      if (p.peerId === peerId) return p;
    }
    return null;
  }

  getParticipantList() {
    return Array.from(this._state.participants.values());
  }

  /**
   * Add a manual (offline) participant
   * @param {string} name - Display name for the participant
   * @returns {Object} The created participant
   */
  addManualParticipant(name) {
    const id = generateManualParticipantId();
    const participant = {
      id,
      name,
      teamId: null,
      isConnected: false,
      isManual: true,
      claimedBy: null,
      seed: this._state.participants.size + 1,
      joinedAt: Date.now(),
    };

    this._state.participants.set(id, participant);
    this._state.meta.version++;
    this.emit('participant:join', participant);
    this.emit('change', { path: 'participants' });

    return participant;
  }

  // --- Team assignment methods ---

  setTeamAssignment(participantId, teamId) {
    this._state.teamAssignments.set(participantId, teamId);
    this._state.meta.version++;
    this.emit('change', { path: 'teamAssignments' });
    return this;
  }

  clearTeamAssignments() {
    this._state.teamAssignments.clear();
    this._state.meta.version++;
    this.emit('change', { path: 'teamAssignments' });
    return this;
  }

  removeTeamAssignment(participantId) {
    this._state.teamAssignments.delete(participantId);
    this._state.meta.version++;
    this.emit('change', { path: 'teamAssignments' });
    return this;
  }

  getTeamAssignments() {
    return this._state.teamAssignments;
  }

  // --- Match methods ---

  setMatches(matches) {
    this._state.matches = matches instanceof Map ? matches : new Map(Object.entries(matches));
    this._state.meta.version++;
    this.emit('change', { path: 'matches' });
    return this;
  }

  getMatch(id) {
    return this._state.matches.get(id);
  }

  updateMatch(id, updates) {
    const match = this._state.matches.get(id);
    if (match) {
      Object.assign(match, updates);
      this._state.meta.version++;
      this.emit('match:update', { id, match, updates });
      this.emit('change', { path: 'matches' });
    }
    return this;
  }

  // --- Admin helpers ---

  isAdmin() {
    return this._state.local.isAdmin;
  }

  setAdmin(isAdmin) {
    this._state.local.isAdmin = isAdmin;
    this.emit('change', { path: 'local.isAdmin' });
    return this;
  }

  // --- History methods ---

  /**
   * Archive current tournament to history
   * Creates a summary entry with winner, top 4 standings, type, and participant count
   * @returns {Object|null} The created history entry, or null if tournament not complete
   */
  archiveTournament() {
    if (this._state.meta.status !== 'complete') {
      console.warn('[Store] Cannot archive incomplete tournament');
      return null;
    }

    let ranked = [];
    try {
      ranked = getFinalStandings(this._state);
    } catch (e) {
      // A malformed bracket must not block the admin from starting the next tournament.
      console.error('[Store] Failed to rank archived tournament:', e);
    }
    const top = ranked[0];

    const historyEntry = {
      id: `${Date.now()}-${this._state.history.length}`,
      name: this._state.meta.name || 'Tournament',
      type: this._state.meta.type,
      winner: top ? {
        id: top.participantId,
        name: top.name,
        ...(top.team && { team: { id: top.team.id, name: top.team.name, members: top.team.members } }),
      } : null,
      standings: ranked.slice(0, 4).map(({ place, name, points }) => ({ place, name, points })),
      participantCount: this._state.participants.size,
      completedAt: Date.now(),
    };

    this._state.history.push(historyEntry);
    this._state.meta.version++;
    this.emit('change', { path: 'history' });

    return historyEntry;
  }

  /**
   * Get tournament history
   * @returns {Array} History array
   */
  getHistory() {
    return this._state.history;
  }

  /**
   * Reset state for a new tournament while keeping participants and history
   */
  resetForNewTournament() {
    this._state.meta.status = 'lobby';
    this._state.bracket = null;
    this._state.matches = new Map();
    this._state.standings = new Map();
    this._state.teamAssignments = new Map();
    this._state.meta.version++;
    this.emit('change', { path: '*' });
    return this;
  }

  // --- Serialization for P2P sync ---

  serialize() {
    // Full snapshot including meta.adminToken. Safe for LOCAL persistence
    // (the admin's own localStorage). For anything sent to peers use
    // serializeForNetwork(), which strips the reclaim secret.
    return {
      meta: { ...this._state.meta },
      participants: Array.from(this._state.participants.entries()),
      bracket: this._state.bracket,
      matches: Array.from(this._state.matches.entries()),
      standings: Array.from(this._state.standings.entries()),
      teamAssignments: Array.from(this._state.teamAssignments.entries()),
      history: this._state.history,
    };
  }

  // Snapshot for broadcasting to peers. Strips admin-only secrets:
  // meta.adminToken is the room-reclaim secret; leaking it to peers (or into
  // their localStorage) would let anyone hijack the room. The admin keeps its
  // own copy locally in this._state.meta AND in a separate localStorage slot
  // (see saveAdminToken in persistence.js), so omitting it from network state
  // does not affect the admin's own ability to reclaim.
  serializeForNetwork() {
    const snapshot = this.serialize();
    delete snapshot.meta.adminToken;
    return snapshot;
  }

  deserialize(data) {
    if (data.meta) {
      this._state.meta = data.meta;
    }
    if (data.participants) {
      this._state.participants = new Map(data.participants);
    }
    if (data.bracket) {
      this._state.bracket = data.bracket;
    }
    if (data.matches) {
      this._state.matches = new Map(data.matches);
    }
    if (data.standings) {
      this._state.standings = new Map(data.standings);
    }
    if (data.teamAssignments) {
      this._state.teamAssignments = new Map(data.teamAssignments);
    }
    if (data.history) {
      this._state.history = data.history;
    }
    this.emit('sync', data);
    this.emit('change', { path: '*' });
    return this;
  }

  /**
   * Merge remote state (for conflict resolution).
   *
   * CONTRACT CHANGE (security): the second argument is now `senderIsAdmin`,
   * a boolean the CALLER must set to true only when it has verified that the
   * peer that SENT this state is the room's trusted admin (e.g. via the
   * STATE_RESPONSE `isAdmin` flag cross-checked against the sending peer's id).
   *
   * Previously this argument was the remote state's `meta.adminId` and authority
   * was granted whenever it equalled our known admin id. That was unsafe: EVERY
   * peer's serialized state carries `meta.adminId` (it records "who the admin
   * is"), so any peer — including a stale rejoiner echoing the known adminId —
   * was accepted as admin-authoritative and could clobber meta/bracket/standings
   * with no guard. Authority must key off whether the SENDER is the admin, not
   * off the state merely echoing the known admin id.
   *
   * @param {Object} remoteState - Serialized remote state
   * @param {boolean} [senderIsAdmin=false] - True iff the sending peer is the verified admin
   */
  merge(remoteState, senderIsAdmin = false) {
    const localState = this._state;
    const localAdminId = localState.meta?.adminId;
    const remoteAdminId = remoteState.meta?.adminId;

    // Grant remote admin authority when EITHER:
    //  1. the caller verified the sending peer is the admin, OR
    //  2. we are a fresh joiner with no known admin yet and the remote state
    //     names an admin — this is our initial authoritative snapshot and we
    //     have nothing of our own to protect, so we bootstrap fully from it.
    // We deliberately do NOT grant authority merely because remoteAdminId
    // echoes our known adminId (every honest peer carries that field), which
    // is what let any peer clobber admin-controlled data before.
    const isRemoteAdmin = senderIsAdmin === true || (!localAdminId && !!remoteAdminId);

    // Meta: accept when admin-authoritative, or (monotonic guard) when the
    // remote carries a strictly higher version. The version guard keeps a
    // stale, non-admin peer from regressing meta.
    if (remoteState.meta) {
      const shouldAcceptMeta = isRemoteAdmin ||
        ((remoteState.meta.version || 0) > (localState.meta.version || 0));

      if (shouldAcceptMeta) {
        // adminToken is a LOCAL-ONLY secret (stripped from network state by
        // serializeForNetwork). Never adopt a remote-supplied one: an attacker
        // could otherwise get meta accepted via the version guard and overwrite
        // the real admin's local reclaim token. Always keep our own verbatim,
        // and drop any remote token entirely if we have none.
        const localAdminToken = this._state.meta?.adminToken;
        this._state.meta = { ...remoteState.meta };
        if (localAdminToken) {
          this._state.meta.adminToken = localAdminToken;
        } else {
          delete this._state.meta.adminToken;
        }
      }
    }

    // Participants: OR-Set merge (additions win)
    if (remoteState.participants) {
      const remoteParticipants = new Map(remoteState.participants);
      for (const [id, participant] of remoteParticipants) {
        if (!localState.participants.has(id)) {
          localState.participants.set(id, participant);
        } else {
          // LWW for updates - use updatedAt (falls back to joinedAt for older data)
          const local = localState.participants.get(id);
          const localTimestamp = local.updatedAt || local.joinedAt || 0;
          const remoteTimestamp = participant.updatedAt || participant.joinedAt || 0;
          if (remoteTimestamp > localTimestamp) {
            localState.participants.set(id, { ...local, ...participant });
          }
        }
      }
    }

    // Match ids repeat across tournaments, so matches merge only within the same
    // tournament (bracket.startedAt); the admin's new tournament replaces them all.
    const sameTournament = remoteState.bracket?.startedAt === localState.bracket?.startedAt;

    // Bracket: admin-authoritative
    if (remoteState.bracket && isRemoteAdmin) {
      this._state.bracket = remoteState.bracket;
    }

    // Matches: LWW with admin verification override
    if (remoteState.matches && remoteState.bracket && isRemoteAdmin && !sameTournament) {
      localState.matches = new Map(remoteState.matches);
    } else if (remoteState.matches && sameTournament) {
      for (const [id, remoteMatch] of remoteState.matches) {
        const localMatch = localState.matches.get(id);
        if (!localMatch) {
          localState.matches.set(id, remoteMatch);
        } else {
          // Admin verification always wins
          if (remoteMatch.verifiedBy && !localMatch.verifiedBy) {
            localState.matches.set(id, remoteMatch);
          } else if (!remoteMatch.verifiedBy && localMatch.verifiedBy) {
            // Keep local (admin verified)
          } else {
            // Ties go to the admin, whose bracket advancement carries no reportedAt.
            const newer = (remoteMatch.reportedAt || 0) - (localMatch.reportedAt || 0);
            if (newer > 0 || (newer === 0 && isRemoteAdmin)) {
              localState.matches.set(id, remoteMatch);
            }
          }
        }
      }
    }

    // Standings: admin-authoritative
    if (remoteState.standings && isRemoteAdmin) {
      this._state.standings = new Map(remoteState.standings);
    }

    // Team assignments: admin-authoritative
    if (remoteState.teamAssignments && isRemoteAdmin) {
      this._state.teamAssignments = new Map(remoteState.teamAssignments);
    }

    // History: union merge (additions win, dedupe by id)
    if (remoteState.history && Array.isArray(remoteState.history)) {
      const existingIds = new Set(localState.history.map(h => h.id));
      for (const entry of remoteState.history) {
        if (!existingIds.has(entry.id)) {
          localState.history.push(entry);
          existingIds.add(entry.id);
        }
      }
      // Sort by completedAt (most recent last) for consistent ordering
      localState.history.sort((a, b) => a.completedAt - b.completedAt);
    }

    this.emit('merge', remoteState);
    this.emit('change', { path: '*' });
    return this;
  }
}

// Singleton store instance
export const store = new Store();

// Export for testing
export { Store, createInitialState };
