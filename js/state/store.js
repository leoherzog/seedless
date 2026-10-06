/**
 * Single source of truth for tournament state. An EventTarget that emits 'change' on every
 * mutation and merges serialized snapshots from peers.
 */

import { getFinalStandings } from '../tournament/standings.js';
import { isNewerResult, isRaceOrder } from '../utils/tournament-helpers.js';

/**
 * @typedef {Object} Participant
 * @property {string} id - Unique ID (user_ for connected, manual_ for manual)
 * @property {string|null} peerId - Transient WebRTC peer ID
 * @property {string} name - Display name
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
 * @property {string|null} reportedBy - Reporter's persistent user ID
 * @property {number} [version] - Per-match logical clock for result LWW
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
      this._state.participants.set(participant.id, {
        ...existing,
        ...participant,
        isConnected: true,
      });
    } else {
      // New participants default to connected; manual players pass isConnected: false.
      this._state.participants.set(participant.id, {
        isConnected: true,
        ...participant,
        joinedAt: participant.joinedAt || Date.now(),
        seed: participant.seed || this._state.participants.size + 1,
      });
      this.emit('participant:join', participant);
    }
    this.emit('change', { path: 'participants' });
    return this;
  }

  updateParticipant(id, updates) {
    const participant = this._state.participants.get(id);
    if (participant) {
      // updatedAt is the LWW key in merge().
      Object.assign(participant, updates, { updatedAt: Date.now() });
      this.emit('change', { path: 'participants' });
    }
    return this;
  }

  removeParticipant(id) {
    const participant = this._state.participants.get(id);
    if (participant) {
      this._state.participants.delete(id);
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
   * Add a manual (offline) participant.
   * @param {string} name - Display name for the participant
   * @returns {Object} The created participant
   */
  addManualParticipant(name) {
    const id = `manual_${crypto.randomUUID()}`;
    const participant = {
      id,
      name,
      isConnected: false,
      isManual: true,
      claimedBy: null,
      seed: this._state.participants.size + 1,
      joinedAt: Date.now(),
    };

    this._state.participants.set(id, participant);
    this.emit('participant:join', participant);
    this.emit('change', { path: 'participants' });

    return participant;
  }

  setTeamAssignment(participantId, teamId) {
    this._state.teamAssignments.set(participantId, teamId);
    this.emit('change', { path: 'teamAssignments' });
    return this;
  }

  clearTeamAssignments() {
    this._state.teamAssignments.clear();
    this.emit('change', { path: 'teamAssignments' });
    return this;
  }

  removeTeamAssignment(participantId) {
    this._state.teamAssignments.delete(participantId);
    this.emit('change', { path: 'teamAssignments' });
    return this;
  }

  getTeamAssignments() {
    return this._state.teamAssignments;
  }

  setMatches(matches) {
    this._state.matches = matches;
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
   * Append a summary of the current tournament to history.
   * @returns {Object} The created history entry
   */
  archiveTournament() {
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
    this.emit('change', { path: 'history' });

    return historyEntry;
  }

  getHistory() {
    return this._state.history;
  }

  /** Return to the lobby, clearing bracket, matches, standings and teams; participants and history stay. */
  resetForNewTournament() {
    this._state.meta.status = 'lobby';
    this._state.bracket = null;
    this._state.matches = new Map();
    this._state.standings = new Map();
    this._state.teamAssignments = new Map();
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
   * Within one tournament only results merge; the caller re-derives seats and standings from them.
   * @param {Object} remoteState - Serialized remote state
   * @param {boolean} [senderIsAdmin=false] - True iff the sending peer is the verified admin
   */
  merge(remoteState, senderIsAdmin = false) {
    const localState = this._state;
    const localAdminId = localState.meta?.adminId;
    const remoteAdminId = remoteState.meta?.adminId;

    // Only creating the room makes this user admin, so a snapshot naming us is never trusted.
    const namesUs = !!remoteAdminId && remoteAdminId === localState.local.localUserId && !this.isAdmin();
    // Trust remote as admin if the caller verified the sender, or as our bootstrap snapshot when we have
    // no adminId and the remote names one; a matching adminId proves nothing, since every peer carries it.
    const isRemoteAdmin = !namesUs && (senderIsAdmin === true || (!localAdminId && !!remoteAdminId));

    // A known adminId never changes.
    if (remoteState.meta && isRemoteAdmin) {
      this._state.meta = { ...remoteState.meta, adminId: localAdminId || remoteAdminId };
    }

    // Additions win: merge never removes a participant.
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

    // Match ids repeat across tournaments, so bracket.startedAt tells tournaments apart.
    const sameTournament = remoteState.bracket?.startedAt === localState.bracket?.startedAt;

    if (remoteState.bracket && isRemoteAdmin && !sameTournament) {
      localState.bracket = remoteState.bracket;
      localState.matches = new Map(remoteState.matches ?? []);
      localState.standings = new Map(remoteState.standings ?? []);
    } else if (remoteState.matches && sameTournament) {
      const isRace = localState.bracket?.type === 'mariokart';
      for (const [id, remoteMatch] of remoteState.matches) {
        const localMatch = localState.matches.get(id);
        if (localMatch && takesResult(remoteMatch, localMatch, isRemoteAdmin, isRace)) {
          localState.matches.set(id, { ...localMatch, ...resultOf(remoteMatch, isRemoteAdmin, isRace) });
        }
      }
    }

    if (remoteState.teamAssignments && isRemoteAdmin) {
      this._state.teamAssignments = new Map(remoteState.teamAssignments);
    }

    if (Array.isArray(remoteState.history) && isRemoteAdmin) {
      const existingIds = new Set(localState.history.map(h => h.id));
      for (const entry of remoteState.history) {
        if (typeof entry?.id === 'string' && !existingIds.has(entry.id)) {
          localState.history.push(entry);
          existingIds.add(entry.id);
        }
      }
    }

    this.emit('change', { path: '*' });
    return this;
  }
}

/**
 * Whether a remote copy's result replaces the local one. Only the admin verifies, so only the
 * admin's verified result beats an unverified one or replaces a verified one; otherwise the
 * newer report wins. A Points Race result must list each racer once.
 * @param {Object} remote - Remote match
 * @param {Object} local - Local match
 * @param {boolean} fromAdmin - Whether the sender is the trusted admin
 * @param {boolean} isRace - Whether matches are Points Race games
 * @returns {boolean}
 */
function takesResult(remote, local, fromAdmin, isRace) {
  if (!remote.winnerId) return false;
  if (isRace && !(remote.complete === true && isRaceOrder(local, remote.results))) return false;
  const verified = fromAdmin && !!remote.verifiedBy;
  if (local.verifiedBy) return verified && isNewerResult(remote, local);
  return verified || isNewerResult(remote, local);
}

/**
 * The result fields of a remote match; seats, byes and walkovers are re-derived, never merged.
 * @param {Object} remote - Remote match
 * @param {boolean} fromAdmin - Whether the sender is the trusted admin, the only source of verifiedBy
 * @param {boolean} isRace - Whether matches are Points Race games
 * @returns {Object}
 */
function resultOf(remote, fromAdmin, isRace) {
  const { winnerId, reportedBy = null, reportedAt = null, version } = remote;
  if (isRace) {
    return { winnerId, reportedBy, reportedAt, version, results: remote.results, complete: true };
  }
  const verifiedBy = fromAdmin ? remote.verifiedBy ?? null : null;
  return { winnerId, reportedBy, reportedAt, version, scores: remote.scores ?? [0, 0], verifiedBy };
}

export const store = new Store();

// Exported for tests; the app uses the store singleton.
export { Store };
