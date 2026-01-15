/**
 * Seedless - P2P Tournament Brackets
 * Main Application Entry Point
 */

import { CONFIG } from '../config.js';
import { store } from './state/store.js';
import {
  parseUrlState,
  updateUrlState,
  navigateToRoom,
  navigateToHome,
  navigateToBracket,
  getRoomLink,
  isValidRoomSlug,
  sanitizeRoomSlug,
  VIEWS,
  URL_PARAMS,
} from './state/url-state.js';
import {
  saveTournament,
  loadTournament,
  saveDisplayName,
  getLastDisplayName,
  saveAdminToken,
  loadAdminToken,
  generateAdminToken,
  getLocalUserId,
} from './state/persistence.js';
import { joinRoom, leaveRoom, ActionTypes } from './network/room.js';
import { setupStateSync, announceJoin, markStateInitialized, resetSyncState } from './network/sync.js';
import { showSuccess, showError, showToast } from './components/toast.js';
import { initLobby, cleanupLobby } from './components/lobby.js';
import { initBracketView, cleanupBracketView } from './components/bracket-view.js';
import { debounce } from './utils/debounce.js';

// Make room globally accessible for components
window.seedlessRoom = null;

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

  // New tournament button
  const newTournamentBtn = document.getElementById('new-tournament-btn');
  if (newTournamentBtn) {
    newTournamentBtn.addEventListener('click', onNewTournament);
  }
}

/**
 * Setup navigation handlers
 */
function setupNavigationHandlers() {
  // Note: popstate is handled by url-state.js which fires 'urlstatechange' events
  // We listen to urlstatechange in init() to avoid duplicate handling

  // Home link in nav
  const homeLink = document.getElementById('home-link');
  if (homeLink) {
    homeLink.addEventListener('click', async (e) => {
      e.preventDefault();
      await disconnectFromRoom();
      navigateToHome();
    });
  }
}

/**
 * Handle URL state changes
 */
async function handleUrlChange(urlState) {
  const { roomId, view } = urlState;

  // Update view visibility
  showView(view || VIEWS.HOME);

  // Handle room connection (with race condition protection)
  if (roomId && !window.seedlessRoom && !isConnecting) {
    // Need to connect to room
    isConnecting = true;
    try {
      await connectToRoom(roomId);
    } finally {
      isConnecting = false;
    }
  } else if (!roomId && window.seedlessRoom) {
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
 * Create room handler
 */
async function onCreateRoom(e) {
  e.preventDefault();

  const slugInput = document.getElementById('room-slug');
  const nameInput = document.getElementById('display-name');

  const slug = sanitizeRoomSlug(slugInput.value);
  const name = nameInput.value.trim();

  if (!isValidRoomSlug(slug)) {
    showError('Invalid room name. Use lowercase letters, numbers, and hyphens.');
    return;
  }

  if (!name) {
    showError('Please enter your name');
    return;
  }

  // Check if room already exists and user is not the original admin
  const existingData = loadTournament(slug);
  const storedAdminToken = loadAdminToken(slug);
  const existingAdminToken = existingData?.meta?.adminToken;
  const hasMatchingToken = storedAdminToken && existingAdminToken &&
    storedAdminToken === existingAdminToken;

  // Show confirmation modal if room exists but user is not the admin
  if (existingData && !hasMatchingToken) {
    showRoomExistsModal(slug, name);
    return;
  }

  // Save name for next time
  saveDisplayName(name);
  store.set('local.name', name);

  try {
    await connectToRoom(slug, { isAdmin: true, name });
    navigateToRoom(slug);
  } catch (err) {
    console.error('Failed to create room:', err);
    showError('Failed to create room. Please try again.');
  }
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

  if (!name) {
    showError('Please enter your name');
    return;
  }

  // Save name for next time
  saveDisplayName(name);
  store.set('local.name', name);

  try {
    await connectToRoom(slug, { isAdmin: false, name });
    navigateToRoom(slug);
  } catch (err) {
    console.error('Failed to join room:', err);
    showError('Failed to join room. Please try again.');
  }
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

    // Save name for next time
    saveDisplayName(name);
    store.set('local.name', name);

    try {
      await connectToRoom(slug, { isAdmin: false, name });
      navigateToRoom(slug);
    } catch (err) {
      console.error('Failed to join room:', err);
      showError('Failed to join room. Please try again.');
    }
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

  try {
    // Check for existing tournament data and admin token
    const existingData = loadTournament(roomId);
    const storedAdminToken = loadAdminToken(roomId);

    // Join the P2P room
    const room = await joinRoom(roomId);
    window.seedlessRoom = room;

    // Get persistent local user ID (survives page refresh)
    const localUserId = getLocalUserId();

    // Resolve display name from multiple sources (for page refresh/rejoin):
    // 1. Provided name (from form submission)
    // 2. Last saved display name (from localStorage preferences)
    // 3. Existing participant data in this tournament (if rejoining)
    let resolvedName = name;
    if (!resolvedName) {
      resolvedName = getLastDisplayName();
    }
    if (!resolvedName && existingData?.participants) {
      const existingParticipant = existingData.participants.find(([id]) => id === localUserId);
      if (existingParticipant) {
        resolvedName = existingParticipant[1]?.name || '';
      }
    }

    // Store local peer info
    store.set('local.localUserId', localUserId);
    store.set('local.peerId', room.selfId);
    store.set('local.name', resolvedName);
    store.set('local.isConnected', true);

    // Setup state sync handlers
    setupStateSync(room);

    // Determine admin status using token-based persistence
    // Admin is either:
    // 1. Creating a new room (isAdmin flag from Create form)
    // 2. Has matching admin token from localStorage (survives page refresh)
    const existingAdminToken = existingData?.meta?.adminToken;
    const hasMatchingToken = storedAdminToken && existingAdminToken &&
      storedAdminToken === existingAdminToken;
    const isActualAdmin = isAdmin || hasMatchingToken;

    store.setAdmin(isActualAdmin);

    if (isActualAdmin) {
      // Generate new admin token if creating room, reuse existing if rejoining
      const adminToken = hasMatchingToken ? existingAdminToken : generateAdminToken();

      // Save admin token to localStorage for future page refreshes
      saveAdminToken(roomId, adminToken);

      // Initialize as admin (use persistent ID)
      store.batch({
        'meta.id': roomId,
        'meta.adminId': localUserId,
        'meta.adminToken': adminToken,
        'meta.createdAt': existingData?.meta?.createdAt || Date.now(),
      });

      // Restore existing tournament data if any
      if (existingData) {
        store.deserialize(existingData);
        // Update adminId to current persistent ID (token proves we're the admin)
        store.set('meta.adminId', localUserId);
        // Reset all participants to disconnected (will be updated as peers actually connect)
        resetAllParticipantsOffline();
      }

      // Admin is authoritative, mark state as initialized
      markStateInitialized();
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

    // Announce join to peers
    announceJoin(room, resolvedName, localUserId);

    // Setup peer event handlers
    room.onPeerJoin((peerId) => {
      updateConnectionStatus('connected');
      updatePeerCount();

      // If admin, broadcast current state to new peer
      if (store.isAdmin()) {
        setTimeout(() => {
          room.sendTo(ActionTypes.STATE_RESPONSE, {
            state: store.serialize(),
            isAdmin: true,
          }, peerId);
        }, CONFIG.network.stateResponseDelay);
      }
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
  if (window.seedlessRoom) {
    // Announce leave
    window.seedlessRoom.broadcast(ActionTypes.PARTICIPANT_LEAVE, {});

    // Leave room
    await leaveRoom();
    window.seedlessRoom = null;
  }

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
async function onNewTournament() {
  if (window.seedlessRoom && store.isAdmin()) {
    // Reset tournament
    store.set('meta.status', 'lobby');
    store.set('bracket', null);
    store.setMatches(new Map());

    // Broadcast reset
    window.seedlessRoom.broadcast(ActionTypes.TOURNAMENT_RESET, {});

    // Save
    saveTournament(store.get('meta.id'), store.serialize());

    showView(VIEWS.LOBBY);
    showSuccess('Tournament reset!');
  } else {
    // Leave current room and go home
    await disconnectFromRoom();
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
    statusEl.hidden = status === 'disconnected' && !window.seedlessRoom;
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
  const peerCount = window.seedlessRoom?.getPeerCount() || 0;
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
 * Prefill name inputs with last used name
 */
function prefillNameInputs(name) {
  const inputs = [
    document.getElementById('display-name'),
    document.getElementById('join-name'),
    document.getElementById('my-name'),
  ];

  inputs.forEach(input => {
    if (input && !input.value) {
      input.value = name;
    }
  });
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
