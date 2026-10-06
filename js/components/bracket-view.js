/**
 * Bracket View Component
 * Renders tournament bracket visualization
 */

import { store } from '../state/store.js';
import { getRoom } from '../network/room.js';
import { reportMatchResult, advanceWinner, reportRaceResult } from '../network/sync.js';
import { showSuccess, showError } from './toast.js';
import { escapeHtml } from '../utils/html.js';
import { getDragAfterElement } from '../utils/drag-drop.js';
import { formatOrdinal, determineMatchStatus, sortStandings, getPointsForPosition, isInMatch } from '../utils/tournament-helpers.js';
import { getFinalStandings } from '../tournament/standings.js';

// Track subscriptions for cleanup
let bracketSubscriptions = [];

// AbortController for DOM event listeners
let bracketDomController = null;

// AbortController for drag-drop event listeners (cleaner than node cloning)
let rankingDragController = null;

/**
 * Initialize bracket view
 */
export function initBracketView() {
  // Clean up any existing subscriptions first
  cleanupBracketView();

  // Create new AbortController for DOM listeners
  bracketDomController = new AbortController();

  setupBracketTabs();
  setupScoreModal();
  setupRaceResultModal();

  // Listen for state changes and track subscriptions
  bracketSubscriptions.push(store.on('change', updateBracketUI));
}

/**
 * Clean up bracket view subscriptions and DOM event listeners
 */
export function cleanupBracketView() {
  bracketSubscriptions.forEach(unsubscribe => unsubscribe());
  bracketSubscriptions = [];

  // Abort all DOM event listeners
  if (bracketDomController) {
    bracketDomController.abort();
    bracketDomController = null;
  }

  // Abort drag-drop listeners
  if (rankingDragController) {
    rankingDragController.abort();
    rankingDragController = null;
  }
}

/**
 * Setup bracket tabs (for double elimination)
 */
function setupBracketTabs() {
  const { signal } = bracketDomController;
  const tabs = document.getElementById('bracket-tabs');
  if (!tabs) return;

  const buttons = tabs.querySelectorAll('button');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.removeAttribute('aria-current'));
      btn.setAttribute('aria-current', 'true');
      renderBracket(btn.dataset.bracket);
    }, { signal });
  });
}

/**
 * Setup score reporting modal
 */
function setupScoreModal() {
  const { signal } = bracketDomController;
  const submitBtn = document.getElementById('submit-score-btn');
  const score1Input = document.getElementById('score1');
  const score2Input = document.getElementById('score2');

  // Auto-select winner based on scores
  [score1Input, score2Input].forEach(input => {
    input.addEventListener('input', () => {
      const s1 = parseInt(score1Input.value, 10) || 0;
      const s2 = parseInt(score2Input.value, 10) || 0;
      const form = document.getElementById('score-form');

      if (s1 > s2) {
        form.querySelector('input[value="player1"]').checked = true;
      } else if (s2 > s1) {
        form.querySelector('input[value="player2"]').checked = true;
      }
    }, { signal });
  });

  submitBtn.addEventListener('click', onSubmitScore, { signal });
}

/**
 * Update bracket UI
 */
function updateBracketUI() {
  const status = store.get('meta.status');
  const type = store.get('meta.type');
  const bracketView = document.getElementById('bracket-view');

  // Only update if bracket view is visible and tournament is active
  if (bracketView?.hidden || (status !== 'active' && status !== 'complete')) {
    return;
  }

  console.info('[Bracket] Updating bracket UI, status:', status, 'type:', type);

  // Update title
  document.getElementById('bracket-title').textContent = store.get('meta.name') || 'Tournament';
  const localName = store.get('local.name') || 'In Progress';
  document.getElementById('bracket-status').textContent = status === 'complete' ? 'Complete' : localName;

  // Show/hide tabs for double elimination (including doubles mode with double-elim bracket)
  const tabs = document.getElementById('bracket-tabs');
  const bracket = store.get('bracket');
  const bracketType = bracket?.bracketType;
  tabs.hidden = type !== 'double' && !(type === 'doubles' && bracketType === 'double');

  // Show/hide standings for Mario Kart
  const standingsPanel = document.getElementById('standings-panel');
  standingsPanel.hidden = type !== 'mariokart';

  if (type === 'mariokart') {
    renderStandings();
  }

  // Render bracket
  renderBracket();

  // The results card sits above the bracket and must appear as soon as the last result lands.
  const resultsView = document.getElementById('results-view');
  if (resultsView) {
    const justCompleted = resultsView.hidden && status === 'complete';
    resultsView.hidden = status !== 'complete';
    if (justCompleted) {
      resultsView.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Render final standings when tournament is complete
  if (status === 'complete') {
    renderFinalStandings();
  }
}

/**
 * Render bracket based on type
 */
function renderBracket(bracketFilter = null) {
  const container = document.getElementById('bracket-container');
  const type = store.get('meta.type');
  const bracket = store.get('bracket');

  if (!bracket) {
    container.innerHTML = '<p>No bracket data</p>';
    return;
  }

  if (type === 'single') {
    renderSingleEliminationBracket(container, bracket);
  } else if (type === 'double') {
    renderDoubleEliminationBracket(container, bracket, bracketFilter || 'winners');
  } else if (type === 'mariokart') {
    renderMarioKartRaces(container);
  } else if (type === 'doubles') {
    // Doubles can use either single or double elimination as underlying bracket
    const bracketType = bracket.bracketType || 'single';
    if (bracketType === 'double') {
      renderDoubleEliminationBracket(container, bracket, bracketFilter || 'winners');
    } else {
      renderSingleEliminationBracket(container, bracket);
    }
  }
}

/**
 * Render a list of bracket rounds into a container; each round's matchIds are read from the store
 */
function renderRounds(container, rounds, participants, localUserId) {
  container.innerHTML = rounds.map(round => `
    <div class="bracket-round">
      <h4>${escapeHtml(round.name)}</h4>
      ${round.matchIds.map(id => renderMatchCard(store.getMatch(id), participants, localUserId)).join('')}
    </div>
  `).join('');

  addMatchCardHandlers(container);
}

/**
 * Render single elimination bracket
 */
function renderSingleEliminationBracket(container, bracket) {
  const participants = store.get('participants');
  const localUserId = store.get('local.localUserId');

  renderRounds(container, bracket.rounds, participants, localUserId);
}

/**
 * Render double elimination bracket
 */
function renderDoubleEliminationBracket(container, bracket, filter) {
  const participants = store.get('participants');
  const localUserId = store.get('local.localUserId');

  let rounds;
  if (filter === 'winners') {
    rounds = bracket.winners?.rounds || [];
  } else if (filter === 'losers') {
    rounds = bracket.losers?.rounds || [];
  } else if (filter === 'finals') {
    const [gf1, gf2] = bracket.grandFinals;
    rounds = [{
      name: 'Grand Finals',
      matchIds: store.getMatch(gf2).requiresPlay ? [gf1, gf2] : [gf1],
    }];
  }

  renderRounds(container, rounds, participants, localUserId);
}

/**
 * Render Mario Kart / Points Race games
 */
function renderMarioKartRaces(container) {
  const matches = store.get('matches');
  const participants = store.get('participants');
  const localUserId = store.get('local.localUserId');
  const isAdmin = store.isAdmin();

  if (!matches || matches.size === 0) {
    container.innerHTML = '<p>No games available</p>';
    return;
  }

  // Sort games by game number
  const gamesArray = Array.from(matches.values())
    .sort((a, b) => a.gameNumber - b.gameNumber);

  const gamesComplete = gamesArray.filter(g => g.complete).length;

  container.innerHTML = `
    <div class="games-header">
      <span class="progress-text">
        <span class="fa-solid fa-flag-checkered"></span>
        ${gamesComplete} / ${gamesArray.length} games complete
      </span>
      ${store.get('meta.status') === 'complete' ? '<mark>Tournament Complete!</mark>' : ''}
    </div>
    <div class="games-grid">
      ${gamesArray.map(game => renderGameCard(game, participants, localUserId, isAdmin)).join('')}
    </div>
  `;

  addRaceCardHandlers(container);
}

/**
 * Render a game card (Points Race)
 */
function renderGameCard(game, participants, localUserId, isAdmin) {
  // Allow reporting if: user is a participant, OR admin
  const canReport = !game.complete && (game.participants.includes(localUserId) || isAdmin);
  const standIns = game.standIns || [];
  const standInTag = '<small class="stand-in" data-tooltip="Races for fun; scores nothing">stand-in</small>';

  return `
    <article class="game-card ${game.complete ? 'complete' : ''}">
      <header>
        <span>Game ${game.gameNumber}</span>
        <span class="status-badge ${game.complete ? 'complete' : 'pending'}">
          ${game.complete ? 'Complete' : 'Pending'}
        </span>
      </header>

      <div class="game-participants">
        ${game.complete && game.results
          ? game.results.map((result, idx) => {
              const p = participants.get(result.participantId);
              const positionClass = idx === 0 ? 'first' : idx === 1 ? 'second' : idx === 2 ? 'third' : '';
              return `
                <div class="game-participant">
                  <span class="position ${positionClass}">${formatOrdinal(result.position)}</span>
                  <span class="name">${escapeHtml(p?.name || 'Unknown')}</span>
                  ${result.standIn ? standInTag : `<span class="points">+${result.points}</span>`}
                </div>
              `;
            }).join('')
          : game.participants.map(pid => {
              const p = participants.get(pid);
              return `
                <div class="game-participant">
                  <span class="name">${escapeHtml(p?.name || 'Unknown')}</span>
                  ${standIns.includes(pid) ? standInTag : ''}
                </div>
              `;
            }).join('')
        }
      </div>

      ${canReport ? `
        <footer>
          <button class="report-race-btn" data-race="${game.id}">
            <span class="fa-solid fa-flag-checkered"></span> Report Results
          </button>
        </footer>
      ` : ''}
    </article>
  `;
}

/**
 * Compute the report/verify/edit permissions and status for a match.
 * @param {Object} match - Match object
 * @param {Function} canReportPredicate - () => boolean, whether the local user may report
 * @param {boolean} isAdmin - Whether the local user is an admin
 * @returns {{canReport: boolean, needsVerify: boolean, canAdminEdit: boolean, status: string}}
 */
function computeMatchActions(match, canReportPredicate, isAdmin) {
  const canReport = !match.winnerId && !match.isBye &&
    match.participants[0] && match.participants[1] &&
    (canReportPredicate() || isAdmin);
  const needsVerify = match.winnerId && !match.verifiedBy && isAdmin;
  const canAdminEdit = match.winnerId && isAdmin;
  const status = determineMatchStatus(match);

  return { canReport, needsVerify, canAdminEdit, status };
}

/**
 * Render the footer (report/verify/edit buttons) for a match card.
 * @param {Object} match - Match object
 * @param {{canReport: boolean, needsVerify: boolean, canAdminEdit: boolean}} actions
 * @returns {string} Footer HTML (empty string if no actions)
 */
function renderMatchFooter(match, actions) {
  const { canReport, needsVerify, canAdminEdit } = actions;
  if (!canReport && !needsVerify && !canAdminEdit) return '';
  const id = escapeHtml(match.id);

  return `
        <footer>
          ${canReport ? `<button class="report-btn" data-match="${id}"><span class="fa-solid fa-edit"></span> Report</button>` : ''}
          ${needsVerify ? `<button class="verify-btn outline" data-match="${id}"><span class="fa-solid fa-check"></span> Verify</button>` : ''}
          ${canAdminEdit ? `<button class="edit-btn outline" data-match="${id}"><span class="fa-solid fa-pen"></span> Edit</button>` : ''}
        </footer>
      `;
}

/**
 * Render a match card
 */
function renderMatchCard(match, participants, localUserId) {
  // Handle doubles mode differently
  if (store.get('meta.type') === 'doubles') {
    return renderTeamMatchCard(match, localUserId);
  }

  const p1 = participants.get(match.participants[0]);
  const p2 = participants.get(match.participants[1]);

  const isAdmin = store.isAdmin();

  const actions = computeMatchActions(match, () => isInMatch(match, localUserId), isAdmin);
  const { status } = actions;

  return `
    <article class="match-card ${match.isBye ? 'bye' : ''}">
      <header>
        <small>Match ${escapeHtml(match.position + 1)}</small>
        ${match.isBye ? '<mark>BYE</mark>' : `<span class="status-badge ${status}">${status}</span>`}
      </header>

      <div class="participants">
        <div class="participant ${match.winnerId === match.participants[0] ? 'winner' : match.winnerId ? 'loser' : ''}">
          <span class="name ${!p1 ? 'tbd' : ''}">${escapeHtml(p1?.name || 'TBD')}</span>
          <span class="score">${escapeHtml(match.scores[0])}</span>
        </div>
        <div class="vs">vs</div>
        <div class="participant ${match.winnerId === match.participants[1] ? 'winner' : match.winnerId ? 'loser' : ''}">
          <span class="name ${!p2 ? 'tbd' : ''}">${escapeHtml(p2?.name || 'TBD')}</span>
          <span class="score">${escapeHtml(match.scores[1])}</span>
        </div>
      </div>

      ${renderMatchFooter(match, actions)}
    </article>
  `;
}

/**
 * Render match card for doubles/team tournaments
 */
function renderTeamMatchCard(match, localUserId) {
  const bracket = store.get('bracket');
  const teams = bracket?.teams || [];
  const teamMap = new Map(teams.map(t => [t.id, t]));

  const team1 = teamMap.get(match.participants[0]);
  const team2 = teamMap.get(match.participants[1]);

  const isAdmin = store.isAdmin();

  const actions = computeMatchActions(match, () => isInMatch(match, localUserId, teams), isAdmin);
  const { status } = actions;

  return `
    <article class="match-card team-match ${match.isBye ? 'bye' : ''}">
      <header>
        <small>Match ${escapeHtml(match.position + 1)}</small>
        ${match.isBye ? '<mark>BYE</mark>' : `<span class="status-badge ${status}">${status}</span>`}
      </header>

      <div class="participants">
        <div class="participant team ${match.winnerId === match.participants[0] ? 'winner' : match.winnerId ? 'loser' : ''}">
          <span class="team-name ${!team1 ? 'tbd' : ''}">${escapeHtml(team1?.name || 'TBD')}</span>
          ${team1 ? `<span class="team-members">${team1.members.map(m => escapeHtml(m.name)).join(' & ')}</span>` : ''}
          <span class="score">${escapeHtml(match.scores[0])}</span>
        </div>
        <div class="vs">vs</div>
        <div class="participant team ${match.winnerId === match.participants[1] ? 'winner' : match.winnerId ? 'loser' : ''}">
          <span class="team-name ${!team2 ? 'tbd' : ''}">${escapeHtml(team2?.name || 'TBD')}</span>
          ${team2 ? `<span class="team-members">${team2.members.map(m => escapeHtml(m.name)).join(' & ')}</span>` : ''}
          <span class="score">${escapeHtml(match.scores[1])}</span>
        </div>
      </div>

      ${renderMatchFooter(match, actions)}
    </article>
  `;
}

/**
 * Add click handlers to match cards
 */
function addMatchCardHandlers(container) {
  container.querySelectorAll('.report-btn').forEach(btn => {
    btn.addEventListener('click', () => openScoreModal(btn.dataset.match));
  });

  container.querySelectorAll('.verify-btn').forEach(btn => {
    btn.addEventListener('click', () => verifyMatch(btn.dataset.match));
  });

  container.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', () => openScoreModal(btn.dataset.match));
  });
}

/**
 * Add click handlers to race cards
 */
function addRaceCardHandlers(container) {
  container.querySelectorAll('.report-race-btn').forEach(btn => {
    btn.addEventListener('click', () => openRaceResultModal(btn.dataset.race));
  });
}

/**
 * The team (doubles) or participant behind a match participant id.
 */
function getSide(id) {
  return store.get('meta.type') === 'doubles'
    ? store.get('bracket')?.teams?.find(t => t.id === id)
    : store.getParticipant(id);
}

/**
 * Open score modal for a match
 */
function openScoreModal(matchId) {
  const match = store.getMatch(matchId);
  if (!match) return;

  const [p1Name, p2Name] = match.participants.map(id => getSide(id)?.name || 'Unknown');

  // Update modal content
  document.getElementById('player1-name').textContent = p1Name;
  document.getElementById('player2-name').textContent = p2Name;
  document.getElementById('winner-player1').textContent = p1Name;
  document.getElementById('winner-player2').textContent = p2Name;
  document.getElementById('match-id').value = matchId;
  document.getElementById('score1').value = match.scores[0];
  document.getElementById('score2').value = match.scores[1];

  // Store participant IDs for submission (teamIds for doubles)
  document.getElementById('score-form').dataset.p1 = match.participants[0];
  document.getElementById('score-form').dataset.p2 = match.participants[1];

  // Pre-select winner radio if match already has a winner (for edit mode)
  const winnerRadios = document.querySelectorAll('input[name="winner"]');
  winnerRadios.forEach(radio => radio.checked = false);
  if (match.winnerId === match.participants[0]) {
    document.querySelector('input[name="winner"][value="player1"]').checked = true;
  } else if (match.winnerId === match.participants[1]) {
    document.querySelector('input[name="winner"][value="player2"]').checked = true;
  }

  // Open modal
  document.getElementById('score-modal').showModal();
}

/**
 * Submit score from modal
 */
function onSubmitScore() {
  const form = document.getElementById('score-form');
  const matchId = document.getElementById('match-id').value;
  const score1 = parseInt(document.getElementById('score1').value, 10) || 0;
  const score2 = parseInt(document.getElementById('score2').value, 10) || 0;
  const winnerRadio = form.querySelector('input[name="winner"]:checked');

  if (!winnerRadio) {
    showError('Please select a winner');
    return;
  }

  const winnerId = winnerRadio.value === 'player1' ? form.dataset.p1 : form.dataset.p2;

  try {
    reportMatchResult(getRoom(), matchId, [score1, score2], winnerId);

    // Close modal
    document.getElementById('score-modal').close();
    showSuccess('Result reported!');

    // Re-render bracket
    updateBracketUI();

  } catch (e) {
    console.error('Failed to report result:', e);
    showError('Failed to report result');
  }
}

/**
 * Verify a match result (admin only)
 */
function verifyMatch(matchId) {
  const match = store.getMatch(matchId);
  if (!match || !match.winnerId) return;

  const winnerName = getSide(match.winnerId)?.name || match.winnerId;

  // Confirmation dialog to prevent accidental verification
  const scoresDisplay = match.scores ? match.scores.join(' - ') : 'N/A';
  if (!confirm(`Verify match result?\n\nWinner: ${winnerName}\nScores: ${scoresDisplay}`)) {
    return;
  }

  store.updateMatch(matchId, {
    verifiedBy: store.get('local.localUserId'),
  });

  // Advance winner to next match (in case it wasn't advanced during initial report)
  advanceWinner(matchId);

  // Broadcast verification
  const room = getRoom();
  if (room) {
    room.broadcast('m:verify', {
      matchId,
      scores: match.scores,
      winnerId: match.winnerId,
    });
  }

  showSuccess('Match verified!');
  updateBracketUI();
}

/**
 * Setup race result modal handlers
 */
function setupRaceResultModal() {
  const { signal } = bracketDomController;
  const submitBtn = document.getElementById('submit-race-btn');
  if (submitBtn) {
    submitBtn.addEventListener('click', onSubmitRaceResult, { signal });
  }
}

/**
 * Open race result modal (Points Race)
 */
function openRaceResultModal(gameId) {
  const game = store.getMatch(gameId);
  if (!game) {
    showError('Game not found');
    return;
  }

  const participants = store.get('participants');
  const pointsTable = store.get('bracket').pointsTable;
  const totalPlayers = game.participants.length;
  const standIns = game.standIns || [];

  // Update modal header
  document.getElementById('race-info').textContent = `Game ${game.gameNumber}`;
  document.getElementById('race-id').value = gameId;

  // Populate ranking list with game participants
  const list = document.getElementById('race-ranking-list');
  list.innerHTML = game.participants.map((pid, idx) => {
    const p = participants.get(pid);
    const isStandIn = standIns.includes(pid);
    return `
      <li data-participant-id="${escapeHtml(pid)}" draggable="true"${isStandIn ? ' data-stand-in' : ''}>
        <span class="fa-solid fa-grip-vertical drag-handle"></span>
        <span class="participant-name">${escapeHtml(p?.name || 'Unknown')}</span>
        <span class="points-preview">${pointsPreviewText(isStandIn, pointsTable, idx, totalPlayers)}</span>
      </li>
    `;
  }).join('');

  // Setup drag-and-drop (pass totalPlayers for sequential scoring)
  setupRankingDragDrop(list, pointsTable, totalPlayers);

  // Open modal
  document.getElementById('race-result-modal').showModal();
}

/**
 * Setup drag-and-drop for race ranking
 */
function setupRankingDragDrop(list, pointsTable, totalPlayers) {
  let draggedItem = null;

  // Abort previous listeners if any (cleaner than node cloning)
  if (rankingDragController) {
    rankingDragController.abort();
  }
  rankingDragController = new AbortController();
  const { signal } = rankingDragController;

  list.addEventListener('dragstart', (e) => {
    draggedItem = e.target.closest('li');
    if (draggedItem) {
      draggedItem.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    }
  }, { signal });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(list, e.clientY);
    if (draggedItem) {
      if (afterElement) {
        list.insertBefore(draggedItem, afterElement);
      } else {
        list.appendChild(draggedItem);
      }
      updatePointsPreviews(list, pointsTable, totalPlayers);
    }
  }, { signal });

  list.addEventListener('dragend', () => {
    if (draggedItem) {
      draggedItem.classList.remove('dragging');
      draggedItem = null;
    }
  }, { signal });

  // Touch support for mobile
  let touchItem = null;

  list.addEventListener('touchstart', (e) => {
    const li = e.target.closest('li');
    if (li) {
      touchItem = li;
      li.classList.add('dragging');
    }
  }, { passive: true, signal });

  list.addEventListener('touchmove', (e) => {
    if (!touchItem) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    const afterElement = getDragAfterElement(list, y);
    if (afterElement) {
      list.insertBefore(touchItem, afterElement);
    } else {
      list.appendChild(touchItem);
    }
    updatePointsPreviews(list, pointsTable, totalPlayers);
  }, { passive: false, signal });

  list.addEventListener('touchend', () => {
    if (touchItem) {
      touchItem.classList.remove('dragging');
      touchItem = null;
    }
  }, { signal });
}

/**
 * Update points preview after reordering
 */
function updatePointsPreviews(list, pointsTable, totalPlayers) {
  const items = list.querySelectorAll('li');
  items.forEach((item, idx) => {
    const pointsEl = item.querySelector('.points-preview');
    if (pointsEl) {
      pointsEl.textContent = pointsPreviewText('standIn' in item.dataset, pointsTable, idx, totalPlayers);
    }
  });
}

/**
 * Label for a ranking row; stand-ins take a position but score nothing
 */
function pointsPreviewText(isStandIn, pointsTable, idx, totalPlayers) {
  return isStandIn ? 'stand-in' : `+${getPointsForPosition(pointsTable, idx, totalPlayers)} pts`;
}

/**
 * Submit race result from modal
 */
function onSubmitRaceResult() {
  const gameId = document.getElementById('race-id').value;
  const list = document.getElementById('race-ranking-list');
  const items = list.querySelectorAll('li');

  if (items.length === 0) {
    showError('No participants to submit');
    return;
  }

  // Build results array from current order
  const results = Array.from(items).map((item, idx) => ({
    participantId: item.dataset.participantId,
    position: idx + 1,
  }));

  try {
    reportRaceResult(getRoom(), gameId, results);

    // Close modal
    document.getElementById('race-result-modal').close();
    showSuccess('Game result recorded!');

    // Re-render
    updateBracketUI();

  } catch (e) {
    console.error('Failed to submit race result:', e);
    showError('Failed to submit result: ' + e.message);
  }
}

/**
 * Render standings table (Points Race)
 */
function renderStandings() {
  const standings = store.get('standings');
  const thead = document.querySelector('#standings-table thead tr');
  const tbody = document.querySelector('#standings-table tbody');

  if (!standings || standings.size === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No standings yet</td></tr>';
    return;
  }

  // Update header to include more columns
  thead.innerHTML = `
    <th>#</th>
    <th>Player</th>
    <th>Points</th>
    <th>Wins</th>
    <th>Games</th>
  `;

  // Sort by points, then wins, then games completed
  const sorted = sortStandings(Array.from(standings.values()));

  tbody.innerHTML = sorted.map((s, i) => `
    <tr class="${i === 0 ? 'leader' : ''}">
      <td>${i + 1}</td>
      <td>${escapeHtml(s.name || 'Unknown')}</td>
      <td><strong>${s.points}</strong></td>
      <td>${s.wins}</td>
      <td>${s.gamesCompleted}</td>
    </tr>
  `).join('');
}

/**
 * Render final standings when tournament is complete
 */
function renderFinalStandings() {
  const container = document.getElementById('final-standings');
  if (!container) return;

  const status = store.get('meta.status');
  if (status !== 'complete') {
    container.innerHTML = '';
    return;
  }

  const type = store.get('meta.type');

  if (!store.get('bracket')) {
    container.innerHTML = '<p>No bracket data available</p>';
    return;
  }

  let standings;
  try {
    standings = getFinalStandings(store.getState());
  } catch (e) {
    console.error('[Bracket] Failed to get standings:', e);
    container.innerHTML = '<p>Could not load standings</p>';
    return;
  }

  if (standings.length === 0) {
    container.innerHTML = '<p>No standings available</p>';
    return;
  }

  // Render standings HTML
  container.innerHTML = standings.map(s => {
    const placeClass = s.place === 1 ? 'first' : s.place === 2 ? 'second' : s.place === 3 ? 'third' : '';
    const icon = s.place === 1 ? '<span class="fa-solid fa-trophy"></span>' :
                 s.place === 2 ? '<span class="fa-solid fa-medal"></span>' :
                 s.place === 3 ? '<span class="fa-solid fa-award"></span>' : '';

    // Build name display (handles teams for doubles mode)
    let nameDisplay = escapeHtml(s.name || 'Unknown');
    if (s.team && s.team.members) {
      const memberNames = s.team.members.map(m => escapeHtml(m.name)).join(' & ');
      nameDisplay = `${escapeHtml(s.team.name)} <small>(${memberNames})</small>`;
    }

    // Add points for Mario Kart mode
    const pointsDisplay = type === 'mariokart' && s.points !== undefined
      ? ` <small>${s.points} pts</small>`
      : '';

    return `
      <div class="place ${placeClass}">
        <span class="position">${icon} ${formatOrdinal(s.place)}</span>
        <span class="name">${nameDisplay}${pointsDisplay}</span>
      </div>
    `;
  }).join('');

  // Render history section if there are past tournaments
  renderHistorySection(container);
}

/**
 * Get icon for tournament type
 * @param {string} type - Tournament type
 * @returns {string} FontAwesome icon class
 */
function getTournamentTypeIcon(type) {
  switch (type) {
    case 'single': return 'fa-solid fa-sitemap';
    case 'double': return 'fa-solid fa-layer-group';
    case 'mariokart': return 'fa-solid fa-flag-checkered';
    case 'doubles': return 'fa-solid fa-users';
    default: return 'fa-solid fa-trophy';
  }
}

/**
 * Format tournament type for display
 * @param {string} type - Tournament type
 * @returns {string} Human readable type name
 */
function formatTournamentType(type) {
  switch (type) {
    case 'single': return 'Single Elimination';
    case 'double': return 'Double Elimination';
    case 'mariokart': return 'Points Race';
    case 'doubles': return 'Doubles';
    default: return type;
  }
}

/**
 * Render tournament history section below standings
 * @param {HTMLElement} container - Parent container (final-standings)
 */
function renderHistorySection(container) {
  const history = store.getHistory();
  if (!history || history.length === 0) return;

  // Check if history section already exists
  let historySection = document.getElementById('tournament-history');
  if (!historySection) {
    historySection = document.createElement('section');
    historySection.id = 'tournament-history';
    historySection.className = 'tournament-history';
    container.after(historySection);
  }

  // Sort by completedAt descending (most recent first)
  const sortedHistory = [...history].sort((a, b) => b.completedAt - a.completedAt);

  historySection.innerHTML = `
    <h4><span class="fa-solid fa-clock-rotate-left"></span> Past Tournaments</h4>
    ${sortedHistory.map(entry => {
      const date = new Date(entry.completedAt);
      const dateStr = date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      // Build winner display
      let winnerDisplay = 'Unknown';
      if (entry.winner) {
        if (entry.winner.team) {
          const memberNames = entry.winner.team.members?.map(m => escapeHtml(m.name)).join(' & ') || '';
          winnerDisplay = `${escapeHtml(entry.winner.team.name)} <small>(${memberNames})</small>`;
        } else {
          winnerDisplay = escapeHtml(entry.winner.name || 'Unknown');
        }
      }

      // Build standings preview (top 3)
      const standingsPreview = entry.standings?.slice(0, 3).map(s => {
        const pointsStr = s.points !== undefined ? ` (${s.points} pts)` : '';
        return `${s.place}. ${escapeHtml(s.name)}${pointsStr}`;
      }).join(', ') || '';

      return `
        <details class="history-entry">
          <summary>
            <span class="history-icon"><span class="${getTournamentTypeIcon(entry.type)}"></span></span>
            <span class="history-winner">
              <span class="fa-solid fa-crown"></span> ${winnerDisplay}
            </span>
            <span class="history-meta">${dateStr}</span>
          </summary>
          <div class="history-details">
            <p><strong>Type:</strong> ${formatTournamentType(entry.type)}</p>
            <p><strong>Participants:</strong> ${entry.participantCount}</p>
            ${standingsPreview ? `<p><strong>Top 3:</strong> ${standingsPreview}</p>` : ''}
          </div>
        </details>
      `;
    }).join('')}
  `;
}
