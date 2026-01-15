/**
 * Lobby View Component
 * Handles waiting room UI and tournament setup
 */

import { store } from '../state/store.js';
import { getRoomLink } from '../state/url-state.js';
import { showSuccess, showError, showInfo, showToast } from './toast.js';
import { escapeHtml } from '../utils/html.js';
import { getDragAfterElement } from '../utils/drag-drop.js';
import { CONFIG } from '../../config.js';

// Track subscriptions for cleanup
let lobbySubscriptions = [];

/**
 * Initialize lobby view
 */
export function initLobby() {
  // Clean up any existing subscriptions first
  cleanupLobby();

  setupAdminPanel();
  setupParticipantPanel();
  setupParticipantList();
  setupShareLink();
  setupTeamAssignmentDelegation(); // Event delegation for team assignment (set up once)

  // Listen for state changes and track subscriptions
  lobbySubscriptions.push(store.on('change', updateLobbyUI));
  lobbySubscriptions.push(store.on('participant:join', onParticipantJoin));
  lobbySubscriptions.push(store.on('participant:leave', onParticipantLeave));
}

/**
 * Clean up lobby subscriptions
 */
export function cleanupLobby() {
  lobbySubscriptions.forEach(unsubscribe => unsubscribe());
  lobbySubscriptions = [];
}

/**
 * Setup admin panel event handlers
 */
function setupAdminPanel() {
  const configForm = document.getElementById('tournament-config');
  const startBtn = document.getElementById('start-tournament-btn');

  // Tournament type selection
  const typeRadios = configForm.querySelectorAll('input[name="type"]');
  typeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      store.set('meta.type', e.target.value);

      // Open the corresponding details
      const details = e.target.closest('details');
      if (details) {
        // Close others
        configForm.querySelectorAll('details[name="tournament-type"]').forEach(d => {
          if (d !== details) d.open = false;
        });
        details.open = true;
      }

      // Show/hide team assignment panel for doubles
      updateTeamAssignmentPanel();
    });
  });

  // Seeding mode selection
  const seedingRadios = configForm.querySelectorAll('input[name="seeding"]');
  seedingRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      store.set('meta.config.seedingMode', e.target.value);
      updateParticipantListSortable();
    });
  });

  // Tournament name
  const nameInput = document.getElementById('tournament-name');
  nameInput.addEventListener('input', (e) => {
    store.set('meta.name', e.target.value);
  });

  // Players per game (for Points Race)
  const playersPerGameInput = document.getElementById('players-per-game');
  if (playersPerGameInput) {
    playersPerGameInput.addEventListener('input', (e) => {
      const value = parseInt(e.target.value) || 4;
      store.set('meta.config.playersPerGame', Math.min(12, Math.max(2, value)));
    });
  }

  // Games per player (for Points Race)
  const gamesPerPlayerInput = document.getElementById('games-per-player');
  if (gamesPerPlayerInput) {
    gamesPerPlayerInput.addEventListener('input', (e) => {
      const value = parseInt(e.target.value) || 5;
      store.set('meta.config.gamesPerPlayer', Math.min(20, Math.max(1, value)));
    });
  }

  // Points table (for Points Race)
  const pointsTableSelect = document.getElementById('points-table');
  if (pointsTableSelect) {
    pointsTableSelect.addEventListener('change', (e) => {
      const tableKey = e.target.value;
      store.set('meta.config.pointsTable', CONFIG.pointsTables[tableKey]);
    });
  }

  // Start button
  startBtn.addEventListener('click', onStartTournament);

  // Team size input (for Doubles)
  const teamSizeInput = document.getElementById('team-size');
  if (teamSizeInput) {
    teamSizeInput.addEventListener('input', (e) => {
      const value = parseInt(e.target.value) || 2;
      store.set('meta.config.teamSize', Math.min(4, Math.max(2, value)));
      renderTeamAssignmentUI();
    });
  }

  // Doubles bracket type
  const doublesBracketType = document.getElementById('doubles-bracket-type');
  if (doublesBracketType) {
    doublesBracketType.addEventListener('change', (e) => {
      store.set('meta.config.bracketType', e.target.value);
    });
  }

  // Auto-assign teams button
  const autoAssignBtn = document.getElementById('auto-assign-teams-btn');
  if (autoAssignBtn) {
    autoAssignBtn.addEventListener('click', onAutoAssignTeams);
  }

  // Clear teams button
  const clearTeamsBtn = document.getElementById('clear-teams-btn');
  if (clearTeamsBtn) {
    clearTeamsBtn.addEventListener('click', onClearTeams);
  }
}

/**
 * Setup participant panel (non-admin view)
 */
function setupParticipantPanel() {
  const updateForm = document.getElementById('update-name-form');
  const leaveBtn = document.getElementById('leave-tournament-btn');

  updateForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('my-name');
    const newName = nameInput.value.trim();

    if (newName) {
      // Update local name
      store.set('local.name', newName);

      // Update participant in store
      const localUserId = store.get('local.localUserId');
      if (localUserId) {
        store.updateParticipant(localUserId, { name: newName });

        // Announce update to peers
        const room = window.seedlessRoom;
        if (room) {
          room.broadcast('p:upd', { name: newName });
        }

        showSuccess('Name updated!');
      }
    }
  });

  // Leave tournament button
  if (leaveBtn) {
    leaveBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to leave this tournament?')) {
        await leaveTournament();
      }
    });
  }
}

/**
 * Leave the tournament
 */
async function leaveTournament() {
  const room = window.seedlessRoom;
  if (room) {
    room.broadcast('p:leave', {});
  }

  // Navigate home
  const { navigateToHome } = await import('../state/url-state.js');
  navigateToHome();

  // Disconnect
  if (window.seedlessRoom) {
    window.seedlessRoom.leave();
    window.seedlessRoom = null;
  }

  showToast('Left tournament', 'info');
}

/**
 * Setup participant list with drag-and-drop for manual seeding
 */
function setupParticipantList() {
  const list = document.getElementById('participant-list');

  // Drag and drop for manual seeding
  list.addEventListener('dragstart', onDragStart);
  list.addEventListener('dragover', onDragOver);
  list.addEventListener('drop', onDrop);
  list.addEventListener('dragend', onDragEnd);
}

/**
 * Update participant list sortable state
 */
function updateParticipantListSortable() {
  const list = document.getElementById('participant-list');
  const seedingMode = store.get('meta.config.seedingMode');
  const isAdmin = store.isAdmin();

  if (isAdmin && seedingMode === 'manual') {
    list.classList.add('sortable');
    list.querySelectorAll('li').forEach(li => {
      li.draggable = true;
    });
  } else {
    list.classList.remove('sortable');
    list.querySelectorAll('li').forEach(li => {
      li.draggable = false;
    });
  }
}

/**
 * Setup share link functionality
 */
function setupShareLink() {
  const shareInput = document.getElementById('share-link');
  const copyBtn = document.getElementById('copy-link-btn');
  const shareBtn = document.getElementById('share-btn');

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareInput.value);
      showSuccess('Link copied!');
    } catch (e) {
      // Clipboard API not available - select text for manual copy
      shareInput.select();
      showInfo('Press Ctrl+C to copy');
    }
  });

  shareBtn.addEventListener('click', async () => {
    const roomId = store.get('meta.id');
    const link = getRoomLink(roomId);

    if (navigator.share) {
      try {
        await navigator.share({
          title: store.get('meta.name') || 'Join Tournament',
          text: 'Join my tournament on Seedless!',
          url: link,
        });
      } catch (e) {
        // User cancelled or error
      }
    } else {
      try {
        await navigator.clipboard.writeText(link);
        showSuccess('Link copied!');
      } catch (e) {
        showError('Could not copy link');
      }
    }
  });
}

/**
 * Update lobby UI based on state
 */
function updateLobbyUI() {
  const isAdmin = store.isAdmin();
  const participants = store.getParticipantList();
  const roomId = store.get('meta.id');
  const tournamentName = store.get('meta.name');

  // Update body class for admin styling
  document.body.classList.toggle('is-admin', isAdmin);

  // Show/hide admin vs participant panels
  const adminPanel = document.getElementById('admin-panel');
  const participantPanel = document.getElementById('participant-panel');
  if (adminPanel) adminPanel.hidden = !isAdmin;
  if (participantPanel) participantPanel.hidden = isAdmin;

  // Update participant count
  document.getElementById('participant-count').textContent = participants.length;

  // Update room display
  const roomDisplay = document.getElementById('room-display');
  const roomCode = document.getElementById('room-code');
  if (roomId) {
    roomDisplay.hidden = false;
    roomCode.textContent = roomId;
  }

  // Update share link
  const shareInput = document.getElementById('share-link');
  const shareBtn = document.getElementById('share-btn');
  if (roomId) {
    shareInput.value = getRoomLink(roomId);
    shareBtn.hidden = false;
  }

  // Update start button state
  const startBtn = document.getElementById('start-tournament-btn');
  if (startBtn) {
    startBtn.disabled = participants.length < 2;
    startBtn.title = participants.length < 2 ? 'Need at least 2 participants' : '';
  }

  // Update participant name in non-admin panel
  const myNameInput = document.getElementById('my-name');
  if (myNameInput && !myNameInput.value) {
    myNameInput.value = store.get('local.name') || '';
  }

  // Update tournament name display for non-admins
  const tournamentNameDisplay = document.getElementById('tournament-name-display');
  if (tournamentNameDisplay) {
    tournamentNameDisplay.value = tournamentName || roomId || 'Tournament';
  }

  // Render participant list
  renderParticipantList(participants);
}

/**
 * Render participant list
 */
function renderParticipantList(participants) {
  const list = document.getElementById('participant-list');
  const adminId = store.get('meta.adminId');
  const localUserId = store.get('local.localUserId');
  const seedingMode = store.get('meta.config.seedingMode');
  const isAdmin = store.isAdmin();

  // Sort by seed
  const sorted = [...participants].sort((a, b) => (a.seed || 999) - (b.seed || 999));

  list.innerHTML = sorted.map(p => `
    <li data-participant-id="${p.id}" draggable="${isAdmin && seedingMode === 'manual'}">
      <div class="participant-name">
        ${isAdmin && seedingMode === 'manual' ? `<span class="seed-badge">${p.seed || '?'}</span>` : ''}
        <span>${escapeHtml(p.name)}</span>
        ${p.id === adminId ? '<span class="admin-badge">Admin</span>' : ''}
        ${p.id === localUserId ? '<small>(you)</small>' : ''}
      </div>
      <div class="participant-actions">
        <span class="participant-status ${p.isConnected ? 'online' : 'offline'}">
          <i class="fa-solid fa-circle"></i>
        </span>
        ${isAdmin && p.id !== adminId ? `
          <button type="button" class="remove-participant-btn outline secondary"
                  data-participant-id="${p.id}" title="Remove participant">
            <i class="fa-solid fa-xmark"></i>
          </button>
        ` : ''}
      </div>
    </li>
  `).join('');

  // Add event listeners for remove buttons
  if (isAdmin) {
    list.querySelectorAll('.remove-participant-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const participantId = btn.dataset.participantId;
        removeParticipant(participantId);
      });
    });
  }

  updateParticipantListSortable();
}

/**
 * Remove a participant (admin only)
 */
function removeParticipant(participantId) {
  const participant = store.getParticipant(participantId);
  if (!participant) return;

  if (confirm(`Remove ${participant.name} from the tournament?`)) {
    store.removeParticipant(participantId);

    // Broadcast removal
    const room = window.seedlessRoom;
    if (room) {
      room.broadcast('p:leave', { removedId: participantId });
    }

    showToast(`${participant.name} removed`, 'info');
    updateLobbyUI();
  }
}

/**
 * Handle participant join
 */
function onParticipantJoin(participant) {
  showSuccess(`${participant.name} joined!`);
  updateLobbyUI();
}

/**
 * Handle participant leave
 */
function onParticipantLeave(participant) {
  showInfo(`${participant.name} disconnected`);
  updateLobbyUI();
}

/**
 * Start tournament
 */
async function onStartTournament() {
  // Only admin can start tournament
  if (!store.isAdmin()) {
    showError('Only the admin can start the tournament');
    return;
  }

  const participants = store.getParticipantList();
  const tournamentType = store.get('meta.type');
  const seedingMode = store.get('meta.config.seedingMode');

  if (participants.length < 2) {
    showError('Need at least 2 participants');
    return;
  }

  // Apply seeding
  let seededParticipants = [...participants];
  if (seedingMode === 'random') {
    // Shuffle
    for (let i = seededParticipants.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [seededParticipants[i], seededParticipants[j]] = [seededParticipants[j], seededParticipants[i]];
    }
  }

  // Assign seeds
  seededParticipants.forEach((p, i) => {
    p.seed = i + 1;
    store.updateParticipant(p.id, { seed: i + 1 });
  });

  try {
    // Generate bracket based on type
    let bracket, matches;

    if (tournamentType === 'single') {
      const { generateSingleEliminationBracket } = await import('../tournament/single-elimination.js');
      const result = generateSingleEliminationBracket(seededParticipants, store.get('meta.config'));
      bracket = { ...result, matches: undefined };
      matches = result.matches;
    } else if (tournamentType === 'double') {
      const { generateDoubleEliminationBracket } = await import('../tournament/double-elimination.js');
      const result = generateDoubleEliminationBracket(seededParticipants, store.get('meta.config'));
      bracket = { ...result, matches: undefined };
      matches = result.matches;
    } else if (tournamentType === 'mariokart') {
      const { generateMarioKartTournament } = await import('../tournament/mario-kart.js');
      const result = generateMarioKartTournament(seededParticipants, store.get('meta.config'));
      bracket = { ...result, matches: undefined, standings: undefined };
      matches = result.matches;
      store.deserialize({ standings: Array.from(result.standings.entries()) });
    } else if (tournamentType === 'doubles') {
      const teamAssignments = store.getTeamAssignments();
      const teamSize = store.get('meta.config.teamSize') || 2;

      // Validate team assignments
      const { validateTeamAssignments, generateDoublesTournament } = await import('../tournament/doubles.js');
      const validation = validateTeamAssignments(seededParticipants, teamAssignments, teamSize);

      if (!validation.valid || validation.completeTeams < 2) {
        showError('Need at least 2 complete teams to start');
        return;
      }

      const result = generateDoublesTournament(seededParticipants, teamAssignments, {
        ...store.get('meta.config'),
        bracketType: store.get('meta.config.bracketType') || 'single',
      });

      bracket = {
        ...result,
        matches: undefined,
        teams: result.teams,
        teamAssignments: result.teamAssignments,
      };
      matches = result.matches;
    }

    // Update store
    store.set('bracket', bracket);
    store.setMatches(matches);
    store.set('meta.status', 'active');

    // Broadcast to peers
    const room = window.seedlessRoom;
    if (room) {
      const { startTournament } = await import('../network/sync.js');
      startTournament(room, bracket, matches);
    }

    showSuccess('Tournament started!');

    // Navigate to bracket view
    const { navigateToBracket } = await import('../state/url-state.js');
    navigateToBracket();

  } catch (e) {
    console.error('Failed to start tournament:', e);
    showError('Failed to start tournament');
  }
}

// Drag and drop handlers
let draggedItem = null;

function onDragStart(e) {
  draggedItem = e.target.closest('li');
  if (draggedItem) {
    draggedItem.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  }
}

function onDragOver(e) {
  e.preventDefault();
  const list = document.getElementById('participant-list');
  const afterElement = getDragAfterElement(list, e.clientY);
  if (draggedItem) {
    if (afterElement) {
      list.insertBefore(draggedItem, afterElement);
    } else {
      list.appendChild(draggedItem);
    }
  }
}

function onDrop(e) {
  e.preventDefault();
  if (draggedItem) {
    // Update seeds based on new order
    const list = document.getElementById('participant-list');
    const items = list.querySelectorAll('li');
    const room = window.seedlessRoom;
    items.forEach((item, index) => {
      const participantId = item.dataset.participantId;
      const newSeed = index + 1;
      store.updateParticipant(participantId, { seed: newSeed });
      // Broadcast seed change to peers (admin can specify target id)
      if (room) {
        room.broadcast('p:upd', { id: participantId, seed: newSeed });
      }
    });
    updateLobbyUI();
  }
}

function onDragEnd() {
  if (draggedItem) {
    draggedItem.classList.remove('dragging');
    draggedItem = null;
  }
}

// --- Team Assignment Functions (Doubles Mode) ---

/**
 * Show/hide team assignment panel based on tournament type
 */
function updateTeamAssignmentPanel() {
  const type = store.get('meta.type');
  const fieldset = document.getElementById('team-assignment-fieldset');
  if (fieldset) {
    fieldset.hidden = type !== 'doubles';
    if (type === 'doubles') {
      renderTeamAssignmentUI();
    }
  }
}

/**
 * Render team assignment interface
 */
function renderTeamAssignmentUI() {
  const participants = store.getParticipantList();
  const teamAssignments = store.getTeamAssignments();
  const teamSize = store.get('meta.config.teamSize') || 2;

  // Calculate number of possible teams
  const maxTeams = Math.max(2, Math.ceil(participants.length / teamSize));

  const grid = document.getElementById('team-assignment-grid');
  const unassignedList = document.getElementById('unassigned-list');

  if (!grid || !unassignedList) return;

  // Group participants by team
  const teams = new Map();
  const unassigned = [];

  for (const p of participants) {
    const teamId = teamAssignments.get(p.id);
    if (teamId) {
      if (!teams.has(teamId)) teams.set(teamId, []);
      teams.get(teamId).push(p);
    } else {
      unassigned.push(p);
    }
  }

  // Render team boxes
  grid.innerHTML = '';
  for (let i = 1; i <= maxTeams; i++) {
    const teamId = `team-${i}`;
    const members = teams.get(teamId) || [];
    const isFull = members.length >= teamSize;

    const teamBox = document.createElement('div');
    teamBox.className = `team-box ${isFull ? 'complete' : ''}`;
    teamBox.dataset.teamId = teamId;

    teamBox.innerHTML = `
      <h5>Team ${i} ${isFull ? '<i class="fa-solid fa-check"></i>' : ''}</h5>
      <ul class="team-members" data-team-id="${teamId}">
        ${members.map(m => `
          <li data-participant-id="${m.id}" draggable="true">
            <span>${escapeHtml(m.name)}</span>
            <button type="button" class="remove-from-team" data-participant-id="${m.id}">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </li>
        `).join('')}
        ${members.length < teamSize ? `<li class="drop-zone">Drop player here</li>` : ''}
      </ul>
    `;
    grid.appendChild(teamBox);
  }

  // Render unassigned
  unassignedList.innerHTML = unassigned.map(p => `
    <li data-participant-id="${p.id}" draggable="true">
      ${escapeHtml(p.name)}
    </li>
  `).join('');

  // Update validation status
  updateTeamValidationStatus();

  // Note: drag-and-drop handlers use event delegation set up in initLobby()
}

/**
 * Update team validation status display
 */
async function updateTeamValidationStatus() {
  const participants = store.getParticipantList();
  const teamAssignments = store.getTeamAssignments();
  const teamSize = store.get('meta.config.teamSize') || 2;

  const { validateTeamAssignments } = await import('../tournament/doubles.js');
  const validation = validateTeamAssignments(participants, teamAssignments, teamSize);

  const statusEl = document.getElementById('team-assignment-status');
  if (statusEl) {
    if (validation.valid && validation.completeTeams >= 2) {
      statusEl.innerHTML = `<mark class="success"><i class="fa-solid fa-check"></i> ${validation.completeTeams} teams ready</mark>`;
    } else if (validation.completeTeams >= 2) {
      statusEl.innerHTML = `<mark class="warning"><i class="fa-solid fa-triangle-exclamation"></i> ${validation.completeTeams} teams ready, ${participants.length - (validation.completeTeams * teamSize)} unassigned</mark>`;
    } else {
      statusEl.innerHTML = `<mark class="warning"><i class="fa-solid fa-triangle-exclamation"></i> Need at least 2 complete teams</mark>`;
    }
  }

  // Update start button state for doubles mode
  const startBtn = document.getElementById('start-tournament-btn');
  const type = store.get('meta.type');
  if (type === 'doubles' && startBtn) {
    startBtn.disabled = validation.completeTeams < 2;
    startBtn.title = validation.completeTeams < 2 ? 'Need at least 2 complete teams' : '';
  }
}

/**
 * Setup event delegation for team assignment drag-and-drop and remove buttons.
 * Called once during initLobby() to avoid memory leaks from repeated listener attachment.
 */
function setupTeamAssignmentDelegation() {
  const fieldset = document.getElementById('team-assignment-fieldset');
  if (!fieldset) return;

  let draggedEl = null;

  // Drag start - delegated to fieldset
  fieldset.addEventListener('dragstart', (e) => {
    draggedEl = e.target.closest('li[data-participant-id]');
    if (draggedEl) {
      draggedEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    }
  });

  // Drag over - delegated to fieldset
  fieldset.addEventListener('dragover', (e) => {
    e.preventDefault();

    // Handle team box drag over
    const teamBox = e.target.closest('.team-box');
    if (teamBox && draggedEl) {
      const teamId = teamBox.dataset.teamId;
      const teamSize = store.get('meta.config.teamSize') || 2;
      const teamAssignments = store.getTeamAssignments();

      // Count current members in this team (excluding the dragged one)
      const draggedId = draggedEl.dataset.participantId;
      let currentCount = 0;
      for (const [pid, tid] of teamAssignments) {
        if (tid === teamId && pid !== draggedId) currentCount++;
      }

      // Allow drop if team isn't full
      if (currentCount < teamSize) {
        teamBox.classList.add('drag-over');
      }
    }

    // Handle unassigned list drag over
    const unassignedList = e.target.closest('#unassigned-list');
    if (unassignedList && draggedEl) {
      unassignedList.classList.add('drag-over');
    }
  });

  // Drag leave - delegated to fieldset
  fieldset.addEventListener('dragleave', (e) => {
    const teamBox = e.target.closest('.team-box');
    if (teamBox) {
      teamBox.classList.remove('drag-over');
    }
    const unassignedList = e.target.closest('#unassigned-list');
    if (unassignedList) {
      unassignedList.classList.remove('drag-over');
    }
  });

  // Drop - delegated to fieldset
  fieldset.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggedEl) return;

    const participantId = draggedEl.dataset.participantId;

    // Drop on team box
    const teamBox = e.target.closest('.team-box');
    if (teamBox) {
      teamBox.classList.remove('drag-over');
      const teamId = teamBox.dataset.teamId;
      store.setTeamAssignment(participantId, teamId);
      renderTeamAssignmentUI();
      return;
    }

    // Drop on unassigned list
    const unassignedList = e.target.closest('#unassigned-list');
    if (unassignedList) {
      unassignedList.classList.remove('drag-over');
      store.removeTeamAssignment(participantId);
      renderTeamAssignmentUI();
    }
  });

  // Drag end - delegated to fieldset
  fieldset.addEventListener('dragend', () => {
    if (draggedEl) {
      draggedEl.classList.remove('dragging');
      draggedEl = null;
    }
    // Clean up any leftover drag-over states
    fieldset.querySelectorAll('.team-box').forEach(box => box.classList.remove('drag-over'));
    const unassignedList = fieldset.querySelector('#unassigned-list');
    if (unassignedList) {
      unassignedList.classList.remove('drag-over');
    }
  });

  // Click handler for remove buttons - delegated to fieldset
  fieldset.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.remove-from-team');
    if (removeBtn) {
      e.stopPropagation();
      const participantId = removeBtn.dataset.participantId;
      store.removeTeamAssignment(participantId);
      renderTeamAssignmentUI();
    }
  });
}

/**
 * Auto-assign teams randomly
 */
async function onAutoAssignTeams() {
  const participants = store.getParticipantList();
  const teamSize = store.get('meta.config.teamSize') || 2;

  const { autoAssignTeams } = await import('../tournament/doubles.js');
  const assignments = autoAssignTeams(participants, teamSize);

  // Clear and set all assignments
  store.clearTeamAssignments();
  for (const [participantId, teamId] of assignments) {
    store.setTeamAssignment(participantId, teamId);
  }

  renderTeamAssignmentUI();
  showSuccess('Teams auto-assigned!');
}

/**
 * Clear all team assignments
 */
function onClearTeams() {
  store.clearTeamAssignments();
  renderTeamAssignmentUI();
  showInfo('Team assignments cleared');
}
