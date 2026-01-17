/**
 * Central State Store
 * Event-emitting store for tournament state management
 */

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

      // Also update the bracket's embedded match (they can be separate objects after deserialization)
      this._updateBracketEmbeddedMatch(id, updates);

      this.emit('match:update', { id, match, updates });
      this.emit('change', { path: 'matches' });
    }
    return this;
  }

  /**
   * Update a match embedded in the bracket structure
   * After JSON deserialization, bracket.rounds[].matches[] are separate objects from the matches Map
   * @private
   */
  _updateBracketEmbeddedMatch(id, updates) {
    const bracket = this._state.bracket;
    if (!bracket) return;

    // Single elimination: bracket.rounds[].matches[]
    if (bracket.rounds) {
      for (const round of bracket.rounds) {
        if (!round.matches) continue;
        const match = round.matches.find(m => m.id === id);
        if (match) {
          Object.assign(match, updates);
          return;
        }
      }
    }

    // Double elimination: bracket.winners/losers/grandFinals
    if (bracket.winners?.rounds) {
      for (const round of bracket.winners.rounds) {
        const match = round.matches?.find(m => m.id === id);
        if (match) {
          Object.assign(match, updates);
          return;
        }
      }
    }
    if (bracket.losers?.rounds) {
      for (const round of bracket.losers.rounds) {
        const match = round.matches?.find(m => m.id === id);
        if (match) {
          Object.assign(match, updates);
          return;
        }
      }
    }
    if (bracket.grandFinals?.match?.id === id) {
      Object.assign(bracket.grandFinals.match, updates);
      return;
    }
    if (bracket.grandFinals?.reset?.id === id) {
      Object.assign(bracket.grandFinals.reset, updates);
    }
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
   * Creates a summary entry with winner, standings, type, and participant count
   * @returns {Object|null} The created history entry, or null if tournament not complete
   */
  archiveTournament() {
    const status = this._state.meta.status;
    if (status !== 'complete') {
      console.warn('[Store] Cannot archive incomplete tournament');
      return null;
    }

    const type = this._state.meta.type;
    const bracket = this._state.bracket;
    const participants = this._state.participants;
    const standings = this._state.standings;

    // Extract winner based on tournament type
    let winner = null;
    let standingsSummary = [];

    if (type === 'mariokart') {
      // Mario Kart: winner is top of standings by points
      const sorted = Array.from(standings.values())
        .sort((a, b) => b.points - a.points);
      if (sorted.length > 0) {
        const first = sorted[0];
        winner = { id: first.participantId, name: first.name };
        standingsSummary = sorted.slice(0, 4).map((s, i) => ({
          place: i + 1,
          name: s.name,
          points: s.points,
        }));
      }
    } else if (type === 'doubles') {
      // Doubles: winner is from grand finals or finals match
      const teams = bracket?.teams || [];
      let winnerId = null;

      if (bracket?.grandFinals) {
        // Double elimination doubles
        const gfReset = bracket.grandFinals.reset;
        const gfMatch = bracket.grandFinals.match;
        // Only use reset winner if reset was actually played
        winnerId = (gfReset?.requiresPlay && gfReset?.winnerId) || gfMatch?.winnerId;
      } else if (bracket?.rounds) {
        // Single elimination doubles
        const finalRound = bracket.rounds[bracket.rounds.length - 1];
        const finalMatch = finalRound?.matches?.[0];
        winnerId = finalMatch?.winnerId;
      }

      if (winnerId) {
        const winningTeam = teams.find(t => t.id === winnerId);
        if (winningTeam) {
          winner = {
            id: winningTeam.id,
            name: winningTeam.name,
            team: {
              id: winningTeam.id,
              name: winningTeam.name,
              members: winningTeam.members,
            },
          };
        }
      }
      // Build standings from bracket (simplified for doubles)
      standingsSummary = this._extractBracketStandings(bracket, participants, type);
    } else if (type === 'double') {
      // Double elimination
      const gfReset = bracket?.grandFinals?.reset;
      const gfMatch = bracket?.grandFinals?.match;
      // Only use reset winner if reset was actually played
      const winnerId = (gfReset?.requiresPlay && gfReset?.winnerId) || gfMatch?.winnerId;

      if (winnerId) {
        const p = participants.get(winnerId);
        winner = { id: winnerId, name: p?.name || 'Unknown' };
      }
      standingsSummary = this._extractBracketStandings(bracket, participants, type);
    } else {
      // Single elimination (default)
      if (bracket?.rounds) {
        const finalRound = bracket.rounds[bracket.rounds.length - 1];
        const finalMatch = finalRound?.matches?.[0];
        const winnerId = finalMatch?.winnerId;

        if (winnerId) {
          const p = participants.get(winnerId);
          winner = { id: winnerId, name: p?.name || 'Unknown' };
        }
      }
      standingsSummary = this._extractBracketStandings(bracket, participants, type);
    }

    const historyEntry = {
      id: `${Date.now()}-${this._state.history.length}`,
      name: this._state.meta.name || 'Tournament',
      type,
      winner,
      standings: standingsSummary,
      participantCount: participants.size,
      completedAt: Date.now(),
    };

    this._state.history.push(historyEntry);
    this._state.meta.version++;
    this.emit('change', { path: 'history' });

    return historyEntry;
  }

  /**
   * Extract top 4 standings from bracket structure
   * @private
   */
  _extractBracketStandings(bracket, participants, type) {
    const standings = [];

    if (type === 'doubles') {
      // For doubles, extract team standings
      const teams = bracket?.teams || [];
      const teamMap = new Map(teams.map(t => [t.id, t]));

      let winnerId, runnerUpId;
      if (bracket?.grandFinals) {
        const gfReset = bracket.grandFinals.reset;
        const gfMatch = bracket.grandFinals.match;
        // Only use reset winner if reset was actually played
        winnerId = (gfReset?.requiresPlay && gfReset?.winnerId) || gfMatch?.winnerId;
        const gfParticipants = gfMatch?.participants || [];
        runnerUpId = gfParticipants.find(id => id !== winnerId);
      } else if (bracket?.rounds) {
        const finalRound = bracket.rounds[bracket.rounds.length - 1];
        const finalMatch = finalRound?.matches?.[0];
        winnerId = finalMatch?.winnerId;
        runnerUpId = finalMatch?.participants?.find(id => id !== winnerId);
      }

      if (winnerId) {
        const winnerTeam = teamMap.get(winnerId);
        standings.push({ place: 1, name: winnerTeam?.name || 'Unknown' });
      }
      if (runnerUpId) {
        const runnerUpTeam = teamMap.get(runnerUpId);
        standings.push({ place: 2, name: runnerUpTeam?.name || 'Unknown' });
      }
    } else if (type === 'double') {
      // Double elimination
      const gfReset = bracket?.grandFinals?.reset;
      const gfMatch = bracket?.grandFinals?.match;
      // Only use reset winner if reset was actually played
      const winnerId = (gfReset?.requiresPlay && gfReset?.winnerId) || gfMatch?.winnerId;
      const gfParticipants = gfMatch?.participants || [];
      const runnerUpId = gfParticipants.find(id => id !== winnerId);

      if (winnerId) {
        const p = participants.get(winnerId);
        standings.push({ place: 1, name: p?.name || 'Unknown' });
      }
      if (runnerUpId) {
        const p = participants.get(runnerUpId);
        standings.push({ place: 2, name: p?.name || 'Unknown' });
      }
    } else {
      // Single elimination
      if (bracket?.rounds) {
        const finalRound = bracket.rounds[bracket.rounds.length - 1];
        const finalMatch = finalRound?.matches?.[0];
        const winnerId = finalMatch?.winnerId;
        const runnerUpId = finalMatch?.participants?.find(id => id !== winnerId);

        if (winnerId) {
          const p = participants.get(winnerId);
          standings.push({ place: 1, name: p?.name || 'Unknown' });
        }
        if (runnerUpId) {
          const p = participants.get(runnerUpId);
          standings.push({ place: 2, name: p?.name || 'Unknown' });
        }

        // Try to get 3rd/4th from semi-finals
        if (bracket.rounds.length >= 2) {
          const semiFinals = bracket.rounds[bracket.rounds.length - 2];
          const semiLosers = semiFinals?.matches
            ?.filter(m => m.winnerId)
            .map(m => m.participants.find(id => id !== m.winnerId))
            .filter(Boolean) || [];

          semiLosers.forEach((loserId, idx) => {
            const p = participants.get(loserId);
            standings.push({ place: 3 + idx, name: p?.name || 'Unknown' });
          });
        }
      }
    }

    return standings.slice(0, 4);
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
    return {
      meta: this._state.meta,
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
    this.emit('sync', data);
    this.emit('change', { path: '*' });
    return this;
  }

  // Merge remote state (for conflict resolution)
  merge(remoteState, remoteAdminId) {
    const localState = this._state;
    const localAdminId = localState.meta?.adminId;
    // Trust remote as admin authority ONLY if:
    // 1. We know who admin is (localAdminId exists), AND
    // 2. Remote claims to be that exact admin
    // For initial sync (no local adminId), we rely on version comparison
    // The real admin should have higher version from room operations
    const isRemoteAdmin = localAdminId && remoteAdminId && remoteAdminId === localAdminId;

    // Meta: prefer remote if from admin, newer version, or establishing initial admin
    if (remoteState.meta) {
      // Accept remote meta if:
      // 1. Remote is recognized admin (already established), OR
      // 2. Remote has higher version (logical clock), OR
      // 3. We have no admin yet and remote has one (initial admin establishment)
      const shouldAcceptMeta = isRemoteAdmin ||
        remoteState.meta.version > localState.meta.version ||
        (!localAdminId && remoteState.meta.adminId);

      if (shouldAcceptMeta) {
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
