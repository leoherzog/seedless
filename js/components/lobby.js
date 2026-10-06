/**
 * Lobby view: the participant list, the admin's tournament settings and doubles
 * team assignment, and the start action that generates the bracket.
 */

import { store } from '../state/store.js';
import { getRoomLink, navigateToHome } from '../state/url-state.js';
import { getRoom } from '../network/room.js';
import { startTournament } from '../network/sync.js';
import { showSuccess, showError, showInfo } from './toast.js';
import { escapeHtml } from '../utils/html.js';
import { makeSortable } from '../utils/drag-drop.js';
import { CONFIG } from '../../config.js';
import { planGames, suggestEvenGamesPerPlayer, generateMarioKartTournament } from '../tournament/mario-kart.js';
import { generateSingleEliminationBracket } from '../tournament/single-elimination.js';
import { generateDoubleEliminationBracket } from '../tournament/double-elimination.js';
import { validateTeamAssignments, generateDoublesTournament, autoAssignTeams } from '../tournament/doubles.js';
import { bySeed, seedParticipants } from '../utils/tournament-helpers.js';

// Matches the max attribute of #games-per-player in index.html.
const MAX_GAMES_PER_PLAYER = 20;

// meta.config keys of the #tournament-config number inputs, by input name.
const NUMBER_SETTINGS = {
  'players-per-game': 'playersPerGame',
  'games-per-player': 'gamesPerPlayer',
  'team-size': 'teamSize',
};

/**
 * Wire the lobby's DOM and store listeners. Call once; they live for the page.
 */
export function initLobby() {
  setupAdminPanel();
  setupParticipantPanel();
  setupParticipantList();
  setupShareLink();
  setupTeamAssignmentDelegation();
  setupManualParticipantForm();

  store.on('change', updateLobbyUI);
  store.on('participant:join', onParticipantJoin);
  store.on('participant:leave', onParticipantLeave);
}

function setupAdminPanel() {
  const gamesPerPlayerInput = document.getElementById('games-per-player');

  // Radios and selects fire input too, so this one listener covers every setting.
  document.getElementById('tournament-config').addEventListener('input', ({ target: el }) => {
    switch (el.name) {
      case 'type':
        store.set('meta.type', el.value);
        // The type <details> share a name, so opening one closes the others.
        el.closest('details').open = true;
        break;
      case 'seeding':
        store.set('meta.config.seedingMode', el.value);
        break;
      case 'tournament-name':
        store.set('meta.name', el.value);
        break;
      case 'leftover-seats':
        store.set('meta.config.leftoverSeats', el.value);
        break;
      case 'points-table':
        store.set('meta.config.pointsTable', CONFIG.pointsTables[el.value]);
        break;
      case 'doubles-bracket-type':
        store.set('meta.config.bracketType', el.value);
        break;
      case 'players-per-game':
      case 'games-per-player':
      case 'team-size':
        store.set(`meta.config.${NUMBER_SETTINGS[el.name]}`,
          Math.min(+el.max, Math.max(+el.min, parseInt(el.value) || +el.defaultValue)));
        break;
    }
  });

  // Even-split suggestions apply their games-per-player count.
  document.getElementById('game-plan-summary').addEventListener('click', (e) => {
    const suggestion = e.target.closest('[data-games-per-player]');
    if (!suggestion) return;
    const value = Number(suggestion.dataset.gamesPerPlayer);
    gamesPerPlayerInput.value = value;
    store.set('meta.config.gamesPerPlayer', value);
  });

  document.getElementById('start-tournament-btn').addEventListener('click', onStartTournament);
  document.getElementById('auto-assign-teams-btn').addEventListener('click', onAutoAssignTeams);
  document.getElementById('clear-teams-btn').addEventListener('click', onClearTeams);
}

function setupParticipantPanel() {
  const nameInput = document.getElementById('my-name');

  document.getElementById('update-name-form').addEventListener('submit', (e) => {
    e.preventDefault();

    // A disabled input means locked: the first click unlocks it for editing.
    if (nameInput.disabled) {
      setNameLocked(false);
      return;
    }

    const newName = nameInput.value.trim();
    if (!newName) return;

    store.set('local.name', newName);
    const localUserId = store.get('local.localUserId');
    if (localUserId) {
      store.updateParticipant(localUserId, { name: newName });
      getRoom()?.broadcast('p:upd', { name: newName });
      showSuccess('Name updated!');
      setNameLocked(true);
    }
  });

  // navigateToHome triggers main.js's disconnect and cleanup.
  document.getElementById('leave-tournament-btn').addEventListener('click', () => {
    if (confirm('Are you sure you want to leave this tournament?')) {
      navigateToHome();
      showInfo('Left tournament');
    }
  });
}

/**
 * Lock #my-name behind an edit button, or unlock and focus it for editing.
 * @param {boolean} locked
 */
function setNameLocked(locked) {
  const nameInput = document.getElementById('my-name');
  const submitBtn = document.querySelector('#update-name-form button[type="submit"]');
  const label = locked ? 'Edit name' : 'Update name';
  nameInput.disabled = locked;
  submitBtn.innerHTML = `<span class="fa-solid ${locked ? 'fa-pen' : 'fa-check'}"></span>`;
  submitBtn.setAttribute('aria-label', label);
  submitBtn.setAttribute('data-tooltip', label);
  if (!locked) {
    nameInput.focus();
    nameInput.select();
  }
}

function setupParticipantList() {
  const list = document.getElementById('participant-list');

  makeSortable(list);
  list.addEventListener('drop', onDrop);
  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-participant-btn');
    if (btn) removeParticipant(btn.dataset.participantId);
  });
}

function setupShareLink() {
  const shareInput = document.getElementById('share-link');
  const copyBtn = document.getElementById('copy-link-btn');
  const shareBtn = document.getElementById('share-btn');

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareInput.value);
      showSuccess('Link copied!');
    } catch (e) {
      // Clipboard access is missing outside secure contexts or when denied.
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
        // Cancelling the share sheet also rejects, so failures stay silent.
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

function setupManualParticipantForm() {
  const nameInput = document.getElementById('manual-participant-name');

  document.getElementById('add-manual-participant-form').addEventListener('submit', (e) => {
    e.preventDefault();

    if (!store.isAdmin()) {
      showError('Only the admin can add offline players');
      return;
    }

    const name = nameInput.value.trim();
    if (!name) {
      showError('Please enter a player name');
      return;
    }

    const participant = store.addManualParticipant(name);

    getRoom()?.broadcast('p:join', {
      name: participant.name,
      localUserId: participant.id,
      isManual: true,
      joinedAt: participant.joinedAt,
    });

    nameInput.value = '';
  });
}

function updateLobbyUI() {
  const isAdmin = store.isAdmin();
  const participants = store.getParticipantList();
  const roomId = store.get('meta.id');

  document.getElementById('admin-panel').hidden = !isAdmin;
  document.getElementById('participant-panel').hidden = isAdmin;
  document.getElementById('add-participant-footer').hidden = !isAdmin;
  document.getElementById('participant-count').textContent = participants.length;

  document.getElementById('room-display').hidden = document.getElementById('share-btn').hidden = !roomId;
  document.getElementById('room-code').textContent = roomId ?? '';
  document.getElementById('share-link').value = roomId ? getRoomLink(roomId) : '';

  const completeTeams = updateTeamAssignmentPanel();
  document.getElementById('start-tournament-btn').disabled = store.get('meta.type') === 'doubles'
    ? completeTeams < 2
    : participants.length < 2;

  // Show the current name unless the user is editing it.
  const myNameInput = document.getElementById('my-name');
  if (myNameInput.disabled || !myNameInput.value) {
    const localName = store.get('local.name') || '';
    myNameInput.value = localName;
    if (localName && !myNameInput.disabled) setNameLocked(true);
  }

  document.getElementById('tournament-name-display').value = store.get('meta.name') || roomId || 'Tournament';

  updateGamePlanSummary(participants.length);
  renderParticipantList(participants);
}

/**
 * Describe the Points Race schedule the current settings produce.
 * @param {number} playerCount - Number of participants
 */
function updateGamePlanSummary(playerCount) {
  const summary = document.getElementById('game-plan-summary');

  const config = store.get('meta.config') || {};
  const plan = planGames(playerCount, config);
  if (plan.length === 0) {
    summary.textContent = '';
    return;
  }

  const sizes = plan.map(game => game.scored + game.standIns);
  const largest = sizes[0];
  const smallest = sizes[sizes.length - 1];
  const standIns = plan.reduce((sum, game) => sum + game.standIns, 0);
  const games = (n) => `${n} game${n === 1 ? '' : 's'}`;

  let text = largest === smallest
    ? `${games(plan.length)} of ${largest} players`
    : `${games(plan.length)}: ${sizes.filter(n => n === largest).length} of ${largest} players, `
      + `${sizes.filter(n => n === smallest).length} of ${smallest} players`;
  if (standIns > 0) {
    text += standIns === 1
      ? ', 1 seat filled by an unscored stand-in'
      : `, ${standIns} seats filled by unscored stand-ins`;
  }
  summary.textContent = `${text}.`;

  const suggestions = suggestEvenGamesPerPlayer(playerCount, config, MAX_GAMES_PER_PLAYER);
  if (suggestions.length === 0) return;

  summary.append(' For an even split, use ');
  suggestions.forEach((count, idx) => {
    if (idx > 0) summary.append(' or ');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inline-link';
    button.dataset.gamesPerPlayer = count;
    button.textContent = count;
    summary.append(button);
  });
  summary.append(' games per player.');
}

function renderParticipantList(participants) {
  const adminId = store.get('meta.adminId');
  const localUserId = store.get('local.localUserId');
  const isAdmin = store.isAdmin();
  const sortable = isAdmin && store.get('meta.config.seedingMode') === 'manual';

  document.getElementById('participant-list').innerHTML = participants.toSorted(bySeed).map(p => {
    const isUnclaimedManual = p.isManual && !p.claimedBy;

    return `
    <li data-participant-id="${escapeHtml(p.id)}" draggable="${sortable}">
      <div class="participant-name">
        ${sortable ? `<span class="seed-badge">${escapeHtml(p.seed || '?')}</span>` : ''}
        <span>${escapeHtml(p.name)}</span>
        ${p.id === adminId ? '<span class="admin-badge">Admin</span>' : ''}
        ${isUnclaimedManual ? '<span class="manual-badge">Offline</span>' : ''}
        ${p.id === localUserId ? '<small>(you)</small>' : ''}
      </div>
      <div class="participant-actions">
        <span class="participant-status ${p.isConnected ? 'online' : 'offline'}">
          <span class="fa-solid fa-circle"></span>
        </span>
        ${isAdmin && p.id !== adminId ? `
          <button type="button" class="remove-participant-btn outline secondary"
                  data-participant-id="${escapeHtml(p.id)}" title="Remove participant">
            <span class="fa-solid fa-xmark"></span>
          </button>
        ` : ''}
      </div>
    </li>
  `;
  }).join('');
}

function removeParticipant(participantId) {
  const participant = store.getParticipant(participantId);
  if (!participant) return;

  if (confirm(`Remove ${participant.name} from the tournament?`)) {
    store.removeParticipant(participantId);
    getRoom()?.broadcast('p:leave', { removedId: participantId });
  }
}

function onParticipantJoin(participant) {
  showSuccess(`${participant.name} joined!`);
}

// Only an admin removal deletes a participant; disconnects are toasted by main.js.
function onParticipantLeave(participant) {
  showInfo(`${participant.name} removed`);
}

function onStartTournament() {
  if (!store.isAdmin()) {
    showError('Only the admin can start the tournament');
    return;
  }

  const participants = store.getParticipantList();
  if (participants.length < 2) {
    showError('Need at least 2 participants');
    return;
  }

  const type = store.get('meta.type');
  const config = store.get('meta.config');
  const teamAssignments = store.getTeamAssignments();
  if (type === 'doubles' && validateTeamAssignments(participants, teamAssignments, config.teamSize || 2).completeTeams < 2) {
    showError('Need at least 2 complete teams to start');
    return;
  }

  // updateParticipant writes seeds onto these same objects, so the generators keep this order.
  const seeded = seedParticipants(participants, config.seedingMode);
  seeded.forEach((p, i) => store.updateParticipant(p.id, { seed: i + 1 }));

  try {
    let bracket, matches;
    if (type === 'mariokart') {
      let standings;
      ({ matches, standings, ...bracket } = generateMarioKartTournament(seeded, config));
      store.set('standings', standings);
    } else if (type === 'doubles') {
      ({ bracket, matches } = generateDoublesTournament(seeded, teamAssignments, config));
    } else {
      ({ bracket, matches } = { single: generateSingleEliminationBracket, double: generateDoubleEliminationBracket }[type](seeded));
    }

    // startedAt tells a peer's stale matches from this tournament's on merge.
    bracket.startedAt = Date.now();

    // Matches go first so no render sees a bracket id missing from them.
    store.setMatches(matches);
    store.set('bracket', bracket);
    store.set('meta.status', 'active');

    const room = getRoom();
    if (room) {
      startTournament(room, bracket, matches);
    }

    showSuccess('Tournament started!');
  } catch (e) {
    console.error('Failed to start tournament:', e);
    showError('Failed to start tournament');
  }
}

function onDrop(e) {
  e.preventDefault();
  const list = document.getElementById('participant-list');
  // drop fires before dragend, so a row dragged within this list still has the class.
  if (!list.querySelector('li.dragging')) return;

  const room = getRoom();
  list.querySelectorAll('li').forEach((item, index) => {
    const participantId = item.dataset.participantId;
    const seed = index + 1;
    store.updateParticipant(participantId, { seed });
    // The admin's p:upd may name another participant's id.
    room?.broadcast('p:upd', { id: participantId, seed });
  });
}

/**
 * Show the team panel in doubles mode and render it.
 * @returns {number|undefined} Complete teams in doubles mode, otherwise undefined
 */
function updateTeamAssignmentPanel() {
  const isDoubles = store.get('meta.type') === 'doubles';
  document.getElementById('team-assignment-fieldset').hidden = !isDoubles;
  if (!isDoubles) return undefined;

  renderTeamAssignmentUI();
  return updateTeamValidationStatus();
}

function renderTeamAssignmentUI() {
  const participants = store.getParticipantList();
  const teamAssignments = store.getTeamAssignments();
  const teamSize = store.get('meta.config.teamSize') || 2;
  const maxTeams = Math.max(2, Math.ceil(participants.length / teamSize));

  const grid = document.getElementById('team-assignment-grid');
  const unassignedList = document.getElementById('unassigned-list');

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

  grid.innerHTML = '';
  for (let i = 1; i <= maxTeams; i++) {
    const teamId = `team-${i}`;
    const members = teams.get(teamId) || [];
    const isFull = members.length >= teamSize;

    const teamBox = document.createElement('div');
    teamBox.className = `team-box ${isFull ? 'complete' : ''}`;
    teamBox.dataset.teamId = teamId;

    teamBox.innerHTML = `
      <h5>Team ${i} ${isFull ? '<span class="fa-solid fa-check"></span>' : ''}</h5>
      <ul class="team-members">
        ${members.map(m => `
          <li data-participant-id="${escapeHtml(m.id)}" draggable="true">
            <span>${escapeHtml(m.name)}</span>
            <button type="button" class="remove-from-team" data-participant-id="${escapeHtml(m.id)}">
              <span class="fa-solid fa-xmark"></span>
            </button>
          </li>
        `).join('')}
        ${members.length < teamSize ? `<li class="drop-zone">Drop player here</li>` : ''}
      </ul>
    `;
    grid.appendChild(teamBox);
  }

  unassignedList.innerHTML = unassigned.map(p => `
    <li data-participant-id="${escapeHtml(p.id)}" draggable="true">
      ${escapeHtml(p.name)}
    </li>
  `).join('');
}

/**
 * Show whether enough complete teams exist to start.
 * @returns {number} Complete teams
 */
function updateTeamValidationStatus() {
  const participants = store.getParticipantList();
  const teamSize = store.get('meta.config.teamSize') || 2;
  const { valid, completeTeams } = validateTeamAssignments(participants, store.getTeamAssignments(), teamSize);

  const statusEl = document.getElementById('team-assignment-status');
  if (valid && completeTeams >= 2) {
    statusEl.innerHTML = `<mark class="success"><span class="fa-solid fa-check"></span> ${completeTeams} teams ready</mark>`;
  } else if (completeTeams >= 2) {
    statusEl.innerHTML = `<mark class="warning"><span class="fa-solid fa-triangle-exclamation"></span> ${completeTeams} teams ready, ${participants.length - (completeTeams * teamSize)} unassigned</mark>`;
  } else {
    statusEl.innerHTML = `<mark class="warning"><span class="fa-solid fa-triangle-exclamation"></span> Need at least 2 complete teams</mark>`;
  }

  return completeTeams;
}

/**
 * Delegated drag-and-drop and remove-button handlers for the team assignment panel.
 */
function setupTeamAssignmentDelegation() {
  const fieldset = document.getElementById('team-assignment-fieldset');
  let draggedEl = null;

  // A full team accepts a drop only from one of its own members.
  const canDrop = (box) => !box.classList.contains('complete') || box.contains(draggedEl);
  const clearDragOver = () => fieldset.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

  fieldset.addEventListener('dragstart', (e) => {
    draggedEl = e.target.closest('li[data-participant-id]');
    if (draggedEl) {
      draggedEl.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    }
  });

  fieldset.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (!draggedEl) return;

    const teamBox = e.target.closest('.team-box');
    if (teamBox && canDrop(teamBox)) {
      teamBox.classList.add('drag-over');
    }

    const unassignedList = e.target.closest('#unassigned-list');
    if (unassignedList) {
      unassignedList.classList.add('drag-over');
    }
  });

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

  // An accepted drop re-renders the panel and detaches the dragged li, so its dragend
  // never reaches the fieldset; clear draggedEl here instead.
  fieldset.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggedEl) return;

    const participantId = draggedEl.dataset.participantId;
    clearDragOver();

    const teamBox = e.target.closest('.team-box');
    if (teamBox) {
      if (!canDrop(teamBox)) return;
      draggedEl = null;
      store.setTeamAssignment(participantId, teamBox.dataset.teamId);
    } else if (e.target.closest('#unassigned-list')) {
      draggedEl = null;
      store.removeTeamAssignment(participantId);
    }
  });

  fieldset.addEventListener('dragend', () => {
    draggedEl?.classList.remove('dragging');
    draggedEl = null;
    clearDragOver();
  });

  fieldset.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.remove-from-team');
    if (removeBtn) {
      store.removeTeamAssignment(removeBtn.dataset.participantId);
    }
  });
}

function onAutoAssignTeams() {
  const teamSize = store.get('meta.config.teamSize') || 2;
  store.set('teamAssignments', autoAssignTeams(store.getParticipantList(), teamSize));
  showSuccess('Teams auto-assigned!');
}

function onClearTeams() {
  store.clearTeamAssignments();
  showInfo('Team assignments cleared');
}
