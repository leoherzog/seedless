/**
 * Central State Store
 * Event-emitting store for tournament state management
 */

import { getFinalStandings } from '../tournament/standings.js';

/**
 * @typedef {Object} Participant
 * @property {string} id - Unique ID (user_ for connected, manual_ for manual)
 * @property {string|null} peerId - Transient WebRTC peer ID
 * @property {string} name - Display name
 * @property {string|null} teamId - Team ID for doubles
 * @property {boolean} isConnected - Connection status (always false for manual until claimed)
 * @property {boolean} isManual - True if manually added by admin
 * @property {string|null} claimedBy - localUserId of user who claimed this slot
 * @property {number} seed - Seeding position
 * @property {number} joinedAt - Join timestamp
 * @property {number} [updatedAt] - Set by updateParticipant; the LWW key in merge
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
 * @property {string|null} verifiedBy - Admin who verified
 * @property {boolean} isBye - Is this a bye match
 */

/**
 * @typedef {Object} TournamentState
 * @property {Object} meta - Tournament metadata
 * @property {Map<string, Participant>} participants - Participants map
 * @property {Object|null} bracket - Bracket structure; its rounds hold ids into matches
 * @property {Map<string, Match>} matches - Matches map
 * @property {Map<string, Object>} standings - Standings (Mario Kart)
 * @property {Map<string, string>} teamAssignments - participantId to teamId
 * @property {Array<Object>} history - Archived tournament summaries
 * @property {Object} local - Local-only state (not synced)
 */

function createInitialState() {
  return {
    meta: {
      id: null,
      name: '',
      type: 'single',
      adminId: null,
      status: 'lobby', // 'lobby' | 'active' | 'complete'
      config: {
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
    teamAssignments: new Map(),
    history: [],
    local: {
      name: '',
      isAdmin: false,
    },
  };
}

class Store extends EventTarget {
  constructor() {
    super();
    this._state = createInitialState();
  }

  /**
   * Subscribe to a store event.
   * @param {string} type - Event name
   * @param {Function} cb - Called with the event detail
   * @returns {Function} Unsubscribe
   */
  on(type, cb) {
    const h = (e) => cb(e.detail);
    this.addEventListener(type, h);
    return () => this.removeEventListener(type, h);
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  // Returns the live state; callers must not mutate it.
  getState() {
    return this._state;
  }

  get(path) {
    return path.split('.').reduce((v, k) => v?.[k], this._state);
  }

  /** Set a dotted path, creating missing parent objects, and emit 'change'. */
  set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((t, k) => (t[k] ??= {}), this._state);
    target[last] = value;
    this.emit('change', { path });
    return this;
  }

  reset() {
    this._state = createInitialState();
    return this;
  }

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
    const id = `manual_${crypto.randomUUID()}`;
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

  setMatches(matches) {
    this._state.matches = matches;
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
      this.emit('change', { path: 'matches' });
    }
    return this;
  }

  isAdmin() {
    return this._state.local.isAdmin;
  }

  setAdmin(isAdmin) {
    this._state.local.isAdmin = isAdmin;
    this.emit('change', { path: 'local.isAdmin' });
    return this;
  }

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

  serialize() {
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
    this.emit('change', { path: '*' });
    return this;
  }

  /**
   * Merge serialized remote state into local state.
   * `senderIsAdmin` must be true only when the caller has verified that the sending peer is the
   * room admin. Never derive it from remoteState.meta.adminId, because every peer's state carries it.
   * @param {Object} remoteState - Serialized remote state
   * @param {boolean} [senderIsAdmin=false] - True iff the sending peer is the verified admin
   */
  merge(remoteState, senderIsAdmin = false) {
    const localState = this._state;
    const localAdminId = localState.meta?.adminId;
    const remoteAdminId = remoteState.meta?.adminId;

    // Remote is authoritative when the caller verified the sender is admin, or when we are a
    // fresh joiner with no adminId and the remote names one; that is our bootstrap snapshot.
    // A remote adminId that matches ours grants nothing, because every peer carries it.
    const isRemoteAdmin = senderIsAdmin === true || (!localAdminId && !!remoteAdminId);

    // Meta: admin-authoritative
    if (remoteState.meta && isRemoteAdmin) {
      this._state.meta = { ...remoteState.meta };
      // A trusted snapshot may correct a non-admin's adminId, but nothing changes the admin's own.
      if (this.isAdmin() && localAdminId) {
        this._state.meta.adminId = localAdminId;
      }
    }

    // Participants: OR-Set merge (additions win)
    if (remoteState.participants) {
      const remoteParticipants = new Map(remoteState.participants);
      for (const [id, participant] of remoteParticipants) {
        if (!localState.participants.has(id)) {
          localState.participants.set(id, participant);
        } else {
          // LWW on updatedAt; joinedAt stands in for participants that were never updated.
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
    if (Array.isArray(remoteState.history)) {
      const existingIds = new Set(localState.history.map(h => h.id));
      for (const entry of remoteState.history) {
        if (!existingIds.has(entry.id)) {
          localState.history.push(entry);
          existingIds.add(entry.id);
        }
      }
    }

    this.emit('change', { path: '*' });
    return this;
  }
}

export const store = new Store();

// Export for testing
export { Store };
