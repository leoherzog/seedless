/**
 * Seedless - P2P Tournament Brackets
 * Main Application Entry Point
 */

import { store } from './state/store.js';
import {
  parseUrlState,
  navigateToRoom,
  navigateToHome,
  sanitizeRoomSlug,
  formatRoomSlugInput,
  VIEWS,
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
import { showSuccess, showError, showToast } from './components/toast.js';
import { initLobby, cleanupLobby } from './components/lobby.js';
import { initBracketView, cleanupBracketView } from './components/bracket-view.js';
import { debounce } from './utils/debounce.js';
import { HOST_NAME, generateRoomSlug, generatePlayerName } from './utils/random-names.js';

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

// Flag to prevent concurrent connection attempts
let isConnecting = false;

// Auto-save on state changes (debounced to avoid excessive writes)
const autoSave = debounce(() => {
  const roomId = store.get('meta.id');
  if (roomId) {
    saveTournament(roomId, store.serialize());
  }
}, 1000);

// Set up auto-save listener
store.on('change', (event) => {
  // Don't auto-save for local-only changes
  if (event.path && event.path.startsWith('local.')) {
    return;
  }
  autoSave();
});

/**
 * Initialize application
 */
async function init() {
  console.info('[Seedless] Initializing...');

  // Load last used name
  const lastName = getLastDisplayName();
  if (lastName) {
    store.set('local.name', lastName);
    prefillNameInputs(lastName);
  }

  // Initialize components
  initLobby();
  initBracketView();

  // Setup event listeners
  setupFormHandlers();
  setupNavigationHandlers();

  // Handle initial URL state
  const urlState = parseUrlState();
  await handleUrlChange(urlState);

  // Listen for URL changes
  window.addEventListener('urlstatechange', (e) => {
    handleUrlChange(e.detail);
  });
  window.addEventListener('popstate', () => handleUrlChange(parseUrlState()));

  // Update connection status
  updateConnectionStatus('disconnected');

  console.info('[Seedless] Ready!');
}

/**
 * Setup form handlers
 */
function setupFormHandlers() {
  // Create room form
  const createForm = document.getElementById('create-room-form');
  createForm.addEventListener('submit', onCreateRoom);

  // Join room form
  const joinForm = document.getElementById('join-room-form');
  joinForm.addEventListener('submit', onJoinRoom);

  // Auto-format room name inputs as the user types, so the value is always a
  // valid slug (lowercase, spaces -> hyphens, special characters stripped)
  // instead of forcing the user to enter one that meets the criteria.
  attachSlugFormatter(document.getElementById('room-slug'));
  attachSlugFormatter(document.getElementById('join-slug'));

  // New tournament button
  const newTournamentBtn = document.getElementById('new-tournament-btn');
  if (newTournamentBtn) {
    newTournamentBtn.addEventListener('click', onNewTournament);
  }
}

/**
 * Live-format a room-slug text input on every keystroke while keeping the
 * caret in a sensible place (formatting the text before the caret tells us
 * where it should land in the new value).
 * @param {HTMLInputElement|null} input
 */
function attachSlugFormatter(input) {
  if (!input) return;
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

/**
 * Setup navigation handlers
 */
function setupNavigationHandlers() {
  // Home link in nav
  const homeLink = document.getElementById('home-link');
  if (homeLink) {
    homeLink.addEventListener('click', (e) => {
      e.preventDefault();
      navigateToHome();
    });
  }
}

/**
 * Handle URL state changes
 */
async function handleUrlChange(urlState) {
  const { view } = urlState;
  // Normalize any room id arriving via the URL (shared links, hand-typed) to
  // the same canonical slug the create/join forms produce.
  const roomId = urlState.roomId ? sanitizeRoomSlug(urlState.roomId) : urlState.roomId;

  // Update view visibility
  showView(view || VIEWS.HOME);

  // Handle room connection (with race condition protection)
  if (roomId && !getRoom() && !isConnecting) {
    // Need to connect to room
    isConnecting = true;
    try {
      await connectToRoom(roomId);
    } finally {
      isConnecting = false;
    }
  } else if (!roomId && getRoom()) {
    // Need to disconnect
    await disconnectFromRoom();
  }
}

/**
 * Show specific view
 */
function showView(viewName) {
  const views = document.querySelectorAll('[data-view]');
  views.forEach(view => {
    view.hidden = view.dataset.view !== viewName;
  });

  if (viewName === VIEWS.HOME) {
    fillHomeDefaults();
  }

  // Special handling for bracket view with complete tournament
  if (viewName === VIEWS.BRACKET && store.get('meta.status') === 'complete') {
    document.getElementById('results-view').hidden = false;
    document.getElementById('bracket-view').hidden = false;
  }

  // Trigger bracket update when showing bracket view
  if (viewName === VIEWS.BRACKET) {
    // Dispatch a change event to trigger bracket re-render
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

/**
 * Create room handler
 */
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

  // Show confirmation modal if room exists but user is not the admin
  const existingData = loadTournament(slug);
  if (existingData && existingData.meta?.adminId !== getLocalUserId()) {
    showRoomExistsModal(slug, name);
    return;
  }

  await joinAndNavigate(slug, name, { isAdmin: true });
}

/**
 * Join room handler
 */
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

/**
 * Show room exists confirmation modal
 * @param {string} slug - Room slug
 * @param {string} name - User's display name
 */
function showRoomExistsModal(slug, name) {
  const modal = document.getElementById('room-exists-modal');
  const roomNameEl = document.getElementById('existing-room-name');
  const joinBtn = document.getElementById('join-existing-btn');

  // Set room name in modal
  roomNameEl.textContent = slug;

  // Handle join button click
  const handleJoin = async () => {
    modal.close();
    joinBtn.removeEventListener('click', handleJoin);

    // Joining as a regular player, so drop the host label and let connectToRoom resolve a name
    await joinAndNavigate(slug, name === HOST_NAME ? '' : name, { isAdmin: false });
  };

  joinBtn.addEventListener('click', handleJoin);

  // Handle close button and backdrop click
  const closeHandler = () => {
    joinBtn.removeEventListener('click', handleJoin);
  };
  modal.addEventListener('close', closeHandler, { once: true });

  // Setup close buttons
  modal.querySelectorAll('.close-modal').forEach(btn => {
    btn.onclick = () => modal.close();
  });

  modal.showModal();
}

/**
 * Connect to a room
 */
async function connectToRoom(roomId, options = {}) {
  const { isAdmin = false, name = '' } = options;

  updateConnectionStatus('connecting');

  // Re-initialize component listeners (they may have been cleaned up by disconnectFromRoom)
  initLobby();
  initBracketView();

  try {
    // Check for existing tournament data
    const existingData = loadTournament(roomId);

    // Join the P2P room
    const room = await joinRoom(roomId);

    // Get persistent local user ID (survives page refresh)
    const localUserId = getLocalUserId();

    // Resolve display name, first match wins:
    // 1. Provided name (from form submission)
    // 2. Existing participant data in this tournament (page refresh/rejoin)
    // 3. Last saved display name (from localStorage preferences)
    // 4. Random adjective + animal, saved so later joins reuse it
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

    // Store local peer info
    store.set('local.localUserId', localUserId);
    store.set('local.name', resolvedName);

    // Setup state sync handlers
    setupStateSync(room);

    // Admin is the room's creator, or the user whose persistent ID matches the saved adminId
    const isActualAdmin = isAdmin || existingData?.meta?.adminId === localUserId;

    store.setAdmin(isActualAdmin);

    if (isActualAdmin) {
      store.set('meta.id', roomId);
      store.set('meta.adminId', localUserId);
      store.set('meta.createdAt', existingData?.meta?.createdAt || Date.now());

      // Restore existing tournament data if any
      if (existingData) {
        store.deserialize(existingData);
        // Reset all participants to disconnected (will be updated as peers actually connect)
        resetAllParticipantsOffline();
      }
    } else {
      // Store room ID for non-admin
      store.set('meta.id', roomId);

      // Restore existing local data
      if (existingData) {
        store.deserialize(existingData);
        // Reset all participants to disconnected (will be updated as peers actually connect)
        resetAllParticipantsOffline();
      }
    }

    // Add self as participant (use persistent ID, not transient peerId)
    store.addParticipant({
      id: localUserId,
      peerId: room.selfId,
      name: resolvedName,
      isConnected: true,
    });

    // Setup peer event handlers
    room.onPeerJoin(() => {
      updateConnectionStatus('connected');
      updatePeerCount();
    });

    room.onPeerLeave((peerId) => {
      updatePeerCount();
      const participant = store.getParticipantByPeerId(peerId);
      if (participant) {
        showToast(`${participant.name} disconnected`, 'info');
      }
    });

    // Save to localStorage
    saveTournament(roomId, store.serialize());

    updateConnectionStatus('connected');
    updatePeerCount();
    showSuccess(`Joined room: ${roomId}`);

    // Show appropriate view based on tournament status
    const status = store.get('meta.status');
    if (status === 'active' || status === 'complete') {
      showView(VIEWS.BRACKET);
    } else {
      showView(VIEWS.LOBBY);
    }

  } catch (err) {
    updateConnectionStatus('disconnected');
    throw err;
  }
}

/**
 * Disconnect from current room
 */
async function disconnectFromRoom() {
  await leaveRoom();

  // Cleanup component listeners before resetting state
  cleanupLobby();
  cleanupBracketView();

  // Reset local state (keep preferences)
  const localName = store.get('local.name');
  store.reset();
  store.set('local.name', localName);

  // Reset sync state (clear peerId mappings and initialization flag)
  resetSyncState();

  updateConnectionStatus('disconnected');
  updatePeerCount();
}

/**
 * New tournament handler
 */
function onNewTournament() {
  const room = getRoom();
  if (room && store.isAdmin()) {
    // The button lives in the results view, so the tournament is complete.
    const archive = store.archiveTournament();
    room.broadcast(ActionTypes.TOURNAMENT_RESET, { archive });

    // Reset for new tournament (keeps participants and history)
    store.resetForNewTournament();

    // Save now rather than after autoSave's debounce, so closing the tab cannot lose the archive.
    saveTournament(store.get('meta.id'), store.serialize());

    showView(VIEWS.LOBBY);
    showSuccess('Ready for new tournament!');
  } else {
    navigateToHome();
  }
}

/**
 * Update connection status indicator
 */
function updateConnectionStatus(status) {
  const statusEl = document.getElementById('connection-status');
  const icon = document.getElementById('status-icon');

  if (statusEl) {
    statusEl.hidden = status === 'disconnected' && !getRoom();
  }

  if (icon) {
    // Use setAttribute for SVG compatibility (FontAwesome JS replaces <i> with <svg>)
    try {
      icon.setAttribute('class', `fa-solid fa-circle ${status}`);
    } catch (e) {
      // Fallback if setAttribute fails
      console.warn('[Seedless] Could not update status icon:', e.message);
    }
  }
}

/**
 * Update peer count display
 */
function updatePeerCount() {
  const countEl = document.getElementById('peer-count');
  const peerCount = getRoom()?.getPeers().length ?? 0;
  // Add 1 to include yourself in the total
  const totalInRoom = peerCount + 1;
  if (countEl) {
    countEl.textContent = totalInRoom;
  }
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

/**
 * Prefill the in-room name input with the last used name
 */
function prefillNameInputs(name) {
  const input = document.getElementById('my-name');
  if (input && !input.value) {
    input.value = name;
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
