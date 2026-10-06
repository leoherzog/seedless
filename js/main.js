/**
 * Seedless entry point: wires the home forms, joins or leaves the room named in
 * the URL, and shows the view that the URL room and meta.status call for.
 */

import { store } from './state/store.js';
import {
  parseUrlState,
  navigateToRoom,
  navigateToHome,
  sanitizeRoomSlug,
  formatRoomSlugInput,
} from './state/url-state.js';
import {
  saveTournament,
  loadTournament,
  saveDisplayName,
  getLastDisplayName,
  getLocalUserId,
} from './state/persistence.js';
import { joinRoom, leaveRoom, getRoom, ActionTypes } from './network/room.js';
import { setupStateSync, resetSyncState } from './network/sync.js';
import { showSuccess, showError, showInfo } from './components/toast.js';
import { initLobby } from './components/lobby.js';
import { initBracketView } from './components/bracket-view.js';
import { HOST_NAME, generateRoomSlug, generatePlayerName } from './utils/random-names.js';

// Values of the data-view attributes in index.html.
const VIEWS = {
  HOME: 'home',
  LOBBY: 'lobby',
  BRACKET: 'bracket',
};

/**
 * Connect to a room and navigate to it, surfacing a friendly error on failure.
 * @param {string} slug - Room slug
 * @param {string} name - User's display name
 * @param {{ isAdmin?: boolean }} [options]
 */
async function joinAndNavigate(slug, name, { isAdmin = false } = {}) {
  // HOST_NAME is a role label, so remembering it would make it the default join name
  if (name && name !== HOST_NAME) {
    saveDisplayName(name);
  }
  store.set('local.name', name);

  const verb = isAdmin ? 'create' : 'join';
  try {
    await connectToRoom(slug, { isAdmin, name });
    navigateToRoom(slug);
  } catch (err) {
    console.error(`Failed to ${verb} room:`, err);
    showError(`Failed to ${verb} room. Please try again.`);
  }
}

let isConnecting = false;

/** @type {string|null} The view showView last displayed */
let currentView = null;

// Persist non-local state changes, debounced to batch rapid updates.
let saveTimer;
store.on('change', ({ path }) => {
  if (path?.startsWith('local.')) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const roomId = store.get('meta.id');
    if (roomId) saveTournament(roomId, store.serialize());
  }, 1000);
});

async function init() {
  console.info('[Seedless] Initializing...');

  const lastName = getLastDisplayName();
  if (lastName) {
    store.set('local.name', lastName);
  }

  initLobby();
  initBracketView();
  setupFormHandlers();
  setupNavigationHandlers();

  // st:res, t:start and t:reset change meta.status without touching the URL.
  store.on('change', () => {
    const view = viewFor(urlRoomId());
    if (view !== currentView) showView(view);
  });
  window.addEventListener('urlstatechange', handleUrlChange);
  window.addEventListener('popstate', handleUrlChange);

  await handleUrlChange();

  console.info('[Seedless] Ready!');
}

function setupFormHandlers() {
  document.getElementById('create-room-form').addEventListener('submit', onCreateRoom);
  document.getElementById('join-room-form').addEventListener('submit', onJoinRoom);
  attachSlugFormatter(document.getElementById('room-slug'));
  attachSlugFormatter(document.getElementById('join-slug'));
  document.getElementById('new-tournament-btn').addEventListener('click', onNewTournament);
}

/**
 * Live-format a room-slug text input on every keystroke while keeping the
 * caret in a sensible place (formatting the text before the caret tells us
 * where it should land in the new value).
 * @param {HTMLInputElement} input
 */
function attachSlugFormatter(input) {
  input.addEventListener('input', () => {
    const caret = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, caret);
    const formatted = formatRoomSlugInput(input.value);
    if (formatted === input.value) return;
    const newCaret = formatRoomSlugInput(before).length;
    input.value = formatted;
    input.setSelectionRange(newCaret, newCaret);
  });
}

function setupNavigationHandlers() {
  document.getElementById('home-link').addEventListener('click', (e) => {
    e.preventDefault();
    navigateToHome();
  });
}

/**
 * @returns {string} The URL's room in canonical slug form, or '' outside a room
 */
function urlRoomId() {
  // Shared and hand-typed links get the same canonical slug the forms produce.
  return sanitizeRoomSlug(parseUrlState().roomId ?? '');
}

/**
 * @param {string} roomId - Current room slug, or '' outside a room
 * @returns {string} HOME outside a room; inside one, BRACKET once the tournament has started, else LOBBY
 */
function viewFor(roomId) {
  if (!roomId) return VIEWS.HOME;
  const status = store.get('meta.status');
  return status === 'active' || status === 'complete' ? VIEWS.BRACKET : VIEWS.LOBBY;
}

/**
 * Show the view for the URL's room, then join or leave a room to match it.
 */
async function handleUrlChange() {
  const roomId = urlRoomId();
  showView(viewFor(roomId));

  if (roomId && !getRoom() && !isConnecting) {
    isConnecting = true;
    try {
      await connectToRoom(roomId);
    } catch (err) {
      console.error('Failed to join room:', err);
      showError('Failed to join room. Please try again.');
      navigateToHome();
    } finally {
      isConnecting = false;
    }
  } else if (!roomId && getRoom()) {
    await disconnectFromRoom();
  }
}

function showView(viewName) {
  currentView = viewName;
  for (const view of document.querySelectorAll('[data-view]')) {
    view.hidden = view.dataset.view !== viewName;
  }

  if (viewName === VIEWS.HOME) {
    fillHomeDefaults();
  }

  if (viewName === VIEWS.BRACKET) {
    // Unhide the results card before rendering so bracket-view's completion scroll fires only on a live finish.
    if (store.get('meta.status') === 'complete') {
      document.getElementById('results-view').hidden = false;
    }
    // bracket-view skips rendering while hidden, so render now that it is visible.
    store.emit('change', { path: 'view' });
  }
}

/**
 * Fill the home forms with a fresh room slug and default names. The slug is
 * always replaced because reusing a previous one would reopen that room.
 */
function fillHomeDefaults() {
  document.getElementById('room-slug').value = generateRoomSlug();

  const hostNameInput = document.getElementById('display-name');
  if (!hostNameInput.value) {
    hostNameInput.value = HOST_NAME;
  }

  const joinNameInput = document.getElementById('join-name');
  if (!joinNameInput.value) {
    joinNameInput.value = getLastDisplayName() || generatePlayerName();
  }
}

async function onCreateRoom(e) {
  e.preventDefault();

  const slugInput = document.getElementById('room-slug');
  const nameInput = document.getElementById('display-name');

  const slug = sanitizeRoomSlug(slugInput.value);
  const name = nameInput.value.trim();

  // Auto-formatted: only reject when there's nothing usable left (e.g. the
  // input was empty or made up entirely of unsupported characters).
  if (!slug) {
    showError('Please enter a room name');
    return;
  }
  // Reflect the canonical slug back so the user sees what they're creating.
  slugInput.value = slug;

  if (!name) {
    showError('Please enter your name');
    return;
  }

  const existingData = loadTournament(slug);
  if (existingData && existingData.meta?.adminId !== getLocalUserId()) {
    showRoomExistsModal(slug, name);
    return;
  }

  await joinAndNavigate(slug, name, { isAdmin: true });
}

async function onJoinRoom(e) {
  e.preventDefault();

  const slugInput = document.getElementById('join-slug');
  const nameInput = document.getElementById('join-name');

  const slug = sanitizeRoomSlug(slugInput.value);
  const name = nameInput.value.trim();

  if (!slug) {
    showError('Please enter a room name');
    return;
  }
  slugInput.value = slug;

  if (!name) {
    showError('Please enter your name');
    return;
  }

  await joinAndNavigate(slug, name, { isAdmin: false });
}

function showRoomExistsModal(slug, name) {
  const modal = document.getElementById('room-exists-modal');
  document.getElementById('existing-room-name').textContent = slug;

  // Only the Join button closes with returnValue 'join'; Cancel, the close button and Esc do not.
  modal.returnValue = '';
  modal.addEventListener('close', () => {
    if (modal.returnValue !== 'join') return;
    // Joining as a regular player, so drop the host label and let connectToRoom resolve a name
    joinAndNavigate(slug, name === HOST_NAME ? '' : name, { isAdmin: false });
  }, { once: true });

  modal.showModal();
}

async function connectToRoom(roomId, options = {}) {
  const { isAdmin = false, name = '' } = options;

  updateConnectionStatus('connecting');

  try {
    const existingData = loadTournament(roomId);
    const room = await joinRoom(roomId);
    const localUserId = getLocalUserId();

    // First non-empty wins: form name, this room's saved participant, last display name,
    // then a random name that is saved so later joins reuse it.
    let resolvedName = name;
    if (!resolvedName && existingData?.participants) {
      const existingParticipant = existingData.participants.find(([id]) => id === localUserId);
      resolvedName = existingParticipant?.[1]?.name || '';
    }
    if (!resolvedName) {
      resolvedName = getLastDisplayName();
    }
    if (!resolvedName) {
      resolvedName = generatePlayerName();
      saveDisplayName(resolvedName);
    }

    store.set('local.localUserId', localUserId);
    store.set('local.name', resolvedName);

    setupStateSync(room);

    // Admin is the room's creator, or the user whose persistent ID matches the saved adminId
    const isActualAdmin = isAdmin || existingData?.meta?.adminId === localUserId;
    store.setAdmin(isActualAdmin);

    store.set('meta.id', roomId);
    if (existingData) {
      store.deserialize(existingData);
      resetAllParticipantsOffline();
    }
    if (isActualAdmin) {
      store.set('meta.adminId', localUserId);
      store.set('meta.createdAt', existingData?.meta?.createdAt || Date.now());
    }

    // Keyed by the persistent ID, not the transient peerId.
    store.addParticipant({
      id: localUserId,
      peerId: room.selfId,
      name: resolvedName,
      isConnected: true,
    });

    room.onPeerJoin(updatePeerCount);
    room.onPeerLeave((peerId) => {
      updatePeerCount();
      const participant = store.getParticipantByPeerId(peerId);
      if (participant) {
        showInfo(`${participant.name} disconnected`);
      }
    });

    saveTournament(roomId, store.serialize());

    updateConnectionStatus('connected');
    updatePeerCount();
    showSuccess(`Joined room: ${roomId}`);
  } catch (err) {
    updateConnectionStatus('disconnected');
    throw err;
  }
}

async function disconnectFromRoom() {
  await leaveRoom();

  // The display name outlives the room. Setting it also emits the change that clears the room UI.
  const localName = store.get('local.name');
  store.reset();
  store.set('local.name', localName);

  resetSyncState();

  updateConnectionStatus('disconnected');
  updatePeerCount();
}

function onNewTournament() {
  const room = getRoom();
  if (room && store.isAdmin()) {
    // The button lives in the results view, so the tournament is complete.
    const archive = store.archiveTournament();
    room.broadcast(ActionTypes.TOURNAMENT_RESET, { archive });

    // Keeps participants and history. The status change returns everyone to the lobby.
    store.resetForNewTournament();

    // Save now rather than after the debounced auto-save, so closing the tab cannot lose the archive.
    saveTournament(store.get('meta.id'), store.serialize());

    showSuccess('Ready for new tournament!');
  } else {
    navigateToHome();
  }
}

function updateConnectionStatus(status) {
  document.getElementById('connection-status').hidden = status === 'disconnected' && !getRoom();
  // setAttribute because Font Awesome may swap the <span> for an <svg>, whose className is read-only.
  document.getElementById('status-icon').setAttribute('class', `fa-solid fa-circle ${status}`);
}

function updatePeerCount() {
  document.getElementById('peer-count').textContent = (getRoom()?.getPeers().length ?? 0) + 1;
}

/**
 * Reset all participants to offline status
 * Used when loading from localStorage since saved connection status is stale
 */
function resetAllParticipantsOffline() {
  const participants = store.getParticipantList();
  for (const p of participants) {
    store.updateParticipant(p.id, { isConnected: false });
  }
}

init();
