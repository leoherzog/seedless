/**
 * Central State Store
 * Event-emitting store for tournament state management
 */

/**
 * @typedef {Object} Participant
 * @property {string} id - Peer ID
 * @property {string} name - Display name
 * @property {string|null} teamId - Team ID for doubles
 * @property {boolean} isConnected - Connection status
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
 * @property {Object|null} bracket - Bracket structure
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
      Object.assign(participant, updates);
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

  // --- Serialization for P2P sync ---

  serialize() {
    return {
      meta: this._state.meta,
      participants: Array.from(this._state.participants.entries()),
      bracket: this._state.bracket,
      matches: Array.from(this._state.matches.entries()),
      standings: Array.from(this._state.standings.entries()),
      teamAssignments: Array.from(this._state.teamAssignments.entries()),
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
    this.emit('sync', data);
    this.emit('change', { path: '*' });
    return this;
  }

  // Merge remote state (for conflict resolution)
  merge(remoteState, remoteAdminId) {
    const localState = this._state;
    const isRemoteAdmin = remoteAdminId === remoteState.meta?.adminId;

    // Meta: prefer remote if from admin or newer version
    if (remoteState.meta) {
      if (isRemoteAdmin || remoteState.meta.version > localState.meta.version) {
        this._state.meta = { ...remoteState.meta };
      }
    }

    // Participants: OR-Set merge (additions win)
    if (remoteState.participants) {
      const remoteParticipants = new Map(remoteState.participants);
      for (const [id, participant] of remoteParticipants) {
        if (!localState.participants.has(id)) {
          localState.participants.set(id, participant);
        } else {
          // LWW for updates
          const local = localState.participants.get(id);
          if (participant.joinedAt > local.joinedAt) {
            localState.participants.set(id, { ...local, ...participant });
          }
        }
      }
    }

    // Bracket: admin-authoritative
    if (remoteState.bracket && isRemoteAdmin) {
      this._state.bracket = remoteState.bracket;
    }

    // Matches: LWW with admin verification override
    if (remoteState.matches) {
      const remoteMatches = new Map(remoteState.matches);
      for (const [id, remoteMatch] of remoteMatches) {
        const localMatch = localState.matches.get(id);
        if (!localMatch) {
          localState.matches.set(id, remoteMatch);
        } else {
          // Admin verification always wins
          if (remoteMatch.verifiedBy && !localMatch.verifiedBy) {
            localState.matches.set(id, remoteMatch);
          } else if (!remoteMatch.verifiedBy && localMatch.verifiedBy) {
            // Keep local (admin verified)
          } else if ((remoteMatch.reportedAt || 0) > (localMatch.reportedAt || 0)) {
            localState.matches.set(id, remoteMatch);
          }
        }
      }
    }

    // Standings: recalculate from matches (derived state)
    if (remoteState.standings) {
      this._state.standings = new Map(remoteState.standings);
    }

    // Team assignments: admin-authoritative
    if (remoteState.teamAssignments && isRemoteAdmin) {
      this._state.teamAssignments = new Map(remoteState.teamAssignments);
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
