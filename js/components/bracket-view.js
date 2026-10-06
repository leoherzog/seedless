/**
 * Bracket view: renders the active tournament's bracket or Points Race games,
 * the standings and results cards, and hosts the score and race-result modals.
 */

import { store } from '../state/store.js';
import { getRoom, ActionTypes } from '../network/room.js';
import { reportMatchResult, advanceWinner, reportRaceResult } from '../network/sync.js';
import { showSuccess, showError } from './toast.js';
import { escapeHtml } from '../utils/html.js';
import { getDragAfterElement, makeSortable } from '../utils/drag-drop.js';
import { formatOrdinal, determineMatchStatus, sortStandings, getPointsForPosition, isInMatch } from '../utils/tournament-helpers.js';
import { getFinalStandings } from '../tournament/standings.js';

// Podium class and icon, indexed by place - 1.
const PODIUM = ['first', 'second', 'third'];
const PODIUM_ICON = ['fa-trophy', 'fa-medal', 'fa-award'];

// Icon and label by tournament type. History entries come from peers, so their type is looked up, never echoed.
const TYPE_INFO = new Map([
  ['single', ['fa-sitemap', 'Single Elimination']],
  ['double', ['fa-layer-group', 'Double Elimination']],
  ['mariokart', ['fa-flag-checkered', 'Points Race']],
  ['doubles', ['fa-users', 'Doubles']],
]);

// members is optional because history entries are merged from peers unvalidated.
const memberNames = (team) => team.members?.map(m => escapeHtml(m.name)).join(' & ') ?? '';
const teamLabel = (team) => `${escapeHtml(team.name)} <small>(${memberNames(team)})</small>`;

let controller = null;

/** Wire the view's DOM and store listeners; cleanupBracketView removes them. */
export function initBracketView() {
  cleanupBracketView();
  controller = new AbortController();
  const { signal } = controller;

  setupBracketTabs(signal);
  setupBracketContainer(signal);
  setupScoreModal(signal);
  setupRaceResultModal(signal);

  signal.addEventListener('abort', store.on('change', updateBracketUI));
}

export function cleanupBracketView() {
  controller?.abort();
  controller = null;
}

function setupBracketTabs(signal) {
  document.getElementById('bracket-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    selectTab(btn.dataset.bracket);
    renderBracket();
  }, { signal });
}

/** Mark the #bracket-tabs button for the named bracket as current. */
function selectTab(name) {
  for (const btn of document.querySelectorAll('#bracket-tabs button')) {
    if (btn.dataset.bracket === name) {
      btn.setAttribute('aria-current', 'true');
    } else {
      btn.removeAttribute('aria-current');
    }
  }
}

// The cards are re-rendered wholesale, so their buttons are handled by one delegated listener.
function setupBracketContainer(signal) {
  document.getElementById('bracket-container').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.race) {
      openRaceResultModal(btn.dataset.race);
    } else if (btn.classList.contains('verify-btn')) {
      verifyMatch(btn.dataset.match);
    } else if (btn.dataset.match) {
      openScoreModal(btn.dataset.match);
    }
  }, { signal });
}

function setupScoreModal(signal) {
  const score1Input = document.getElementById('score1');
  const score2Input = document.getElementById('score2');

  // Auto-select the winner from the scores.
  [score1Input, score2Input].forEach(input => {
    input.addEventListener('input', () => {
      const s1 = parseInt(score1Input.value, 10) || 0;
      const s2 = parseInt(score2Input.value, 10) || 0;
      if (s1 !== s2) {
        document.getElementById('score-form').elements.winner[s1 > s2 ? 0 : 1].checked = true;
      }
    }, { signal });
  });

  document.getElementById('submit-score-btn').addEventListener('click', onSubmitScore, { signal });
}

function setupRaceResultModal(signal) {
  document.getElementById('submit-race-btn').addEventListener('click', onSubmitRaceResult, { signal });

  const list = document.getElementById('race-ranking-list');
  makeSortable(list, { signal, onMove: () => updatePointsPreviews(list) });

  // Touch input fires no drag events, so reordering by touch is wired separately.
  let touchItem = null;

  list.addEventListener('touchstart', (e) => {
    touchItem = e.target.closest('li');
    touchItem?.classList.add('dragging');
  }, { passive: true, signal });

  list.addEventListener('touchmove', (e) => {
    if (!touchItem) return;
    e.preventDefault();
    list.insertBefore(touchItem, getDragAfterElement(list, e.touches[0].clientY) ?? null);
    updatePointsPreviews(list);
  }, { passive: false, signal });

  list.addEventListener('touchend', () => {
    touchItem?.classList.remove('dragging');
    touchItem = null;
  }, { signal });
}

function updateBracketUI() {
  const status = store.get('meta.status');
  if (status !== 'active' && status !== 'complete') {
    // Between tournaments, so the next double-elimination bracket opens on Winners.
    selectTab('winners');
    return;
  }
  if (document.getElementById('bracket-view').hidden) return;

  const type = store.get('meta.type');
  console.info('[Bracket] Updating bracket UI, status:', status, 'type:', type);

  document.getElementById('bracket-title').textContent = store.get('meta.name') || 'Tournament';
  document.getElementById('bracket-status').textContent = status === 'complete' ? 'Complete' : store.get('local.name') || 'In Progress';
  document.getElementById('bracket-tabs').hidden = !store.get('bracket')?.winners;
  document.getElementById('standings-panel').hidden = type !== 'mariokart';

  if (type === 'mariokart') {
    renderStandings();
  }
  renderBracket();

  // The results card sits above the bracket and must appear as soon as the last result lands.
  const resultsView = document.getElementById('results-view');
  const justCompleted = resultsView.hidden && status === 'complete';
  resultsView.hidden = status !== 'complete';
  if (justCompleted) {
    resultsView.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (status === 'complete') {
    renderFinalStandings();
  }
}

function renderBracket() {
  const container = document.getElementById('bracket-container');
  const bracket = store.get('bracket');

  if (!bracket) {
    container.innerHTML = '<p>No bracket data</p>';
    return;
  }

  if (store.get('meta.type') === 'mariokart') {
    renderMarioKartRaces(container);
  } else {
    renderRounds(container, visibleRounds(bracket), bracket);
  }
}

/**
 * The rounds to show: every round, or the selected tab's for a double-elimination bracket.
 * @param {Object} bracket - Store bracket
 * @returns {Object[]} Rounds with name and matchIds
 */
function visibleRounds(bracket) {
  if (!bracket.winners) return bracket.rounds || [];

  const tab = document.querySelector('#bracket-tabs [aria-current]')?.dataset.bracket;
  if (tab === 'losers') return bracket.losers?.rounds || [];
  if (tab === 'finals') {
    const [gf1, gf2] = bracket.grandFinals;
    return [{ name: 'Grand Finals', matchIds: store.getMatch(gf2).requiresPlay ? [gf1, gf2] : [gf1] }];
  }
  return bracket.winners.rounds || [];
}

function renderRounds(container, rounds, bracket) {
  const isTeam = store.get('meta.type') === 'doubles';
  const teams = isTeam ? bracket.teams || [] : undefined;
  const ctx = {
    isTeam,
    teams,
    isAdmin: store.isAdmin(),
    localUserId: store.get('local.localUserId'),
    lookup: isTeam ? new Map(teams.map(t => [t.id, t])) : store.get('participants'),
  };

  container.innerHTML = rounds.map(round => `
    <div class="bracket-round">
      <h4>${escapeHtml(round.name)}</h4>
      ${round.matchIds.map(id => renderMatchCard(store.getMatch(id), ctx)).join('')}
    </div>
  `).join('');
}

/**
 * Render a match card for players or, in doubles, teams.
 * @param {Object} match - Match from the store
 * @param {Object} ctx - Per-render context built by renderRounds
 * @returns {string} Card HTML
 */
function renderMatchCard(match, ctx) {
  const status = determineMatchStatus(match);

  const side = (i) => {
    const id = match.participants[i];
    const entry = ctx.lookup.get(id);
    const result = !match.winnerId ? '' : match.winnerId === id ? 'winner' : 'loser';
    return `
        <div class="participant ${ctx.isTeam ? 'team' : ''} ${result}">
          <span class="${ctx.isTeam ? 'team-name' : 'name'} ${entry ? '' : 'tbd'}">${escapeHtml(entry?.name || 'TBD')}</span>
          ${ctx.isTeam && entry ? `<span class="team-members">${memberNames(entry)}</span>` : ''}
          <span class="score">${escapeHtml(match.scores[i])}</span>
        </div>`;
  };

  return `
    <article class="match-card ${ctx.isTeam ? 'team-match' : ''} ${match.isBye ? 'bye' : ''}">
      <header>
        <small>Match ${escapeHtml(match.position + 1)}</small>
        ${match.isBye ? '<mark>BYE</mark>' : `<span class="status-badge ${status}">${status}</span>`}
      </header>

      <div class="participants">
        ${side(0)}
        <div class="vs">vs</div>
        ${side(1)}
      </div>

      ${renderMatchFooter(match, isInMatch(match, ctx.localUserId, ctx.teams), ctx.isAdmin)}
    </article>
  `;
}

/**
 * Render the report, verify and edit buttons the local user may use on a match.
 * @param {Object} match - Match from the store
 * @param {boolean} canPlay - Whether the local user plays in the match
 * @param {boolean} isAdmin - Whether the local user is the admin
 * @returns {string} Footer HTML, or '' when no action applies
 */
function renderMatchFooter(match, canPlay, isAdmin) {
  const canReport = !match.winnerId && !match.isBye &&
    match.participants[0] && match.participants[1] && (canPlay || isAdmin);
  const needsVerify = match.winnerId && !match.verifiedBy && isAdmin;
  const canEdit = match.winnerId && isAdmin;
  if (!canReport && !needsVerify && !canEdit) return '';
  const id = escapeHtml(match.id);

  return `
      <footer>
        ${canReport ? `<button class="report-btn" data-match="${id}"><span class="fa-solid fa-edit"></span> Report</button>` : ''}
        ${needsVerify ? `<button class="verify-btn outline" data-match="${id}"><span class="fa-solid fa-check"></span> Verify</button>` : ''}
        ${canEdit ? `<button class="edit-btn outline" data-match="${id}"><span class="fa-solid fa-pen"></span> Edit</button>` : ''}
      </footer>
    `;
}

function renderMarioKartRaces(container) {
  const games = [...store.get('matches').values()].sort((a, b) => a.gameNumber - b.gameNumber);

  if (games.length === 0) {
    container.innerHTML = '<p>No games available</p>';
    return;
  }

  const ctx = {
    participants: store.get('participants'),
    localUserId: store.get('local.localUserId'),
    isAdmin: store.isAdmin(),
  };

  container.innerHTML = `
    <div class="games-header">
      <span class="progress-text">
        <span class="fa-solid fa-flag-checkered"></span>
        ${games.filter(g => g.complete).length} / ${games.length} games complete
      </span>
      ${store.get('meta.status') === 'complete' ? '<mark>Tournament Complete!</mark>' : ''}
    </div>
    <div class="games-grid">
      ${games.map(game => renderGameCard(game, ctx)).join('')}
    </div>
  `;
}

function renderGameCard(game, { participants, localUserId, isAdmin }) {
  const canReport = !game.complete && (game.participants.includes(localUserId) || isAdmin);
  const standIns = game.standIns || [];
  const standInTag = '<small class="stand-in" data-tooltip="Races for fun; scores nothing">stand-in</small>';
  const nameOf = (pid) => escapeHtml(participants.get(pid)?.name || 'Unknown');

  return `
    <article class="game-card ${game.complete ? 'complete' : ''}">
      <header>
        <span>Game ${escapeHtml(game.gameNumber)}</span>
        <span class="status-badge ${game.complete ? 'complete' : 'pending'}">
          ${game.complete ? 'Complete' : 'Pending'}
        </span>
      </header>

      <div class="game-participants">
        ${game.complete && game.results
          ? game.results.map((result, idx) => `
                <div class="game-participant">
                  <span class="position ${PODIUM[idx] ?? ''}">${escapeHtml(formatOrdinal(result.position))}</span>
                  <span class="name">${nameOf(result.participantId)}</span>
                  ${result.standIn ? standInTag : `<span class="points">+${escapeHtml(result.points)}</span>`}
                </div>
              `).join('')
          : game.participants.map(pid => `
                <div class="game-participant">
                  <span class="name">${nameOf(pid)}</span>
                  ${standIns.includes(pid) ? standInTag : ''}
                </div>
              `).join('')
        }
      </div>

      ${canReport ? `
        <footer>
          <button class="report-race-btn" data-race="${escapeHtml(game.id)}">
            <span class="fa-solid fa-flag-checkered"></span> Report Results
          </button>
        </footer>
      ` : ''}
    </article>
  `;
}

/** The team (doubles) or participant behind a match participant id. */
function getSide(id) {
  return store.get('meta.type') === 'doubles'
    ? store.get('bracket')?.teams?.find(t => t.id === id)
    : store.getParticipant(id);
}

function openScoreModal(matchId) {
  const match = store.getMatch(matchId);
  if (!match) return;

  const [p1Name, p2Name] = match.participants.map(id => getSide(id)?.name || 'Unknown');
  document.getElementById('player1-name').textContent = p1Name;
  document.getElementById('player2-name').textContent = p2Name;
  document.getElementById('winner-player1').textContent = p1Name;
  document.getElementById('winner-player2').textContent = p2Name;
  document.getElementById('score1').value = match.scores[0];
  document.getElementById('score2').value = match.scores[1];

  const form = document.getElementById('score-form');
  form.dataset.matchId = matchId;
  // Each winner radio carries its side's participant or team id.
  form.elements.winner.forEach((radio, i) => {
    radio.value = match.participants[i];
    radio.checked = radio.value === match.winnerId;
  });

  document.getElementById('score-modal').showModal();
}

function onSubmitScore() {
  const form = document.getElementById('score-form');
  const winnerId = form.elements.winner.value;
  const score1 = parseInt(document.getElementById('score1').value, 10) || 0;
  const score2 = parseInt(document.getElementById('score2').value, 10) || 0;

  if (!winnerId) {
    showError('Please select a winner');
    return;
  }

  try {
    reportMatchResult(getRoom(), form.dataset.matchId, [score1, score2], winnerId);
    document.getElementById('score-modal').close();
    showSuccess('Result reported!');
  } catch (e) {
    console.error('Failed to report result:', e);
    showError('Failed to report result');
  }
}

/** Ask the admin to confirm a reported result, then mark it verified and broadcast that. */
function verifyMatch(matchId) {
  const match = store.getMatch(matchId);
  if (!match?.winnerId) return;

  const winnerName = getSide(match.winnerId)?.name || match.winnerId;
  const scoresDisplay = match.scores ? match.scores.join(' - ') : 'N/A';
  if (!confirm(`Verify match result?\n\nWinner: ${winnerName}\nScores: ${scoresDisplay}`)) {
    return;
  }

  store.updateMatch(matchId, {
    verifiedBy: store.get('local.localUserId'),
  });

  // In case the result was not advanced when it was reported.
  advanceWinner(matchId);

  getRoom()?.broadcast(ActionTypes.MATCH_VERIFY, {
    matchId,
    scores: match.scores,
    winnerId: match.winnerId,
  });

  showSuccess('Match verified!');
}

function openRaceResultModal(gameId) {
  const game = store.getMatch(gameId);
  if (!game) {
    showError('Game not found');
    return;
  }

  const participants = store.get('participants');
  const standIns = game.standIns || [];

  document.getElementById('race-info').textContent = `Game ${game.gameNumber}`;

  const list = document.getElementById('race-ranking-list');
  list.innerHTML = game.participants.map(pid => `
      <li data-participant-id="${escapeHtml(pid)}" draggable="true"${standIns.includes(pid) ? ' data-stand-in' : ''}>
        <span class="fa-solid fa-grip-vertical drag-handle"></span>
        <span class="participant-name">${escapeHtml(participants.get(pid)?.name || 'Unknown')}</span>
        <span class="points-preview"></span>
      </li>
    `).join('');
  updatePointsPreviews(list);

  const modal = document.getElementById('race-result-modal');
  modal.dataset.gameId = gameId;
  modal.showModal();
}

/** Label each ranking row with the points its current position scores. */
function updatePointsPreviews(list) {
  const items = list.querySelectorAll('li');
  const pointsTable = store.get('bracket.pointsTable');
  items.forEach((item, idx) => {
    // Stand-ins take a finishing position but score nothing.
    item.querySelector('.points-preview').textContent = 'standIn' in item.dataset
      ? 'stand-in'
      : `+${getPointsForPosition(pointsTable, idx, items.length)} pts`;
  });
}

function onSubmitRaceResult() {
  const modal = document.getElementById('race-result-modal');
  const items = document.getElementById('race-ranking-list').querySelectorAll('li');

  if (items.length === 0) {
    showError('No participants to submit');
    return;
  }

  const results = Array.from(items, (item, idx) => ({
    participantId: item.dataset.participantId,
    position: idx + 1,
  }));

  try {
    reportRaceResult(getRoom(), modal.dataset.gameId, results);
    modal.close();
    showSuccess('Game result recorded!');
  } catch (e) {
    console.error('Failed to submit race result:', e);
    showError('Failed to submit result: ' + e.message);
  }
}

/** Render the Points Race standings table. */
function renderStandings() {
  const standings = store.get('standings');
  const tbody = document.querySelector('#standings-table tbody');

  if (!standings || standings.size === 0) {
    tbody.innerHTML = '<tr><td colspan="5">No standings yet</td></tr>';
    return;
  }

  tbody.innerHTML = sortStandings(Array.from(standings.values())).map((s, i) => `
    <tr class="${i === 0 ? 'leader' : ''}">
      <td>${i + 1}</td>
      <td>${escapeHtml(s.name || 'Unknown')}</td>
      <td><strong>${escapeHtml(s.points)}</strong></td>
      <td>${escapeHtml(s.wins)}</td>
      <td>${escapeHtml(s.gamesCompleted)}</td>
    </tr>
  `).join('');
}

/** Render the results card's final standings and the room's tournament history. */
function renderFinalStandings() {
  const container = document.getElementById('final-standings');

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

  const showPoints = store.get('meta.type') === 'mariokart';
  container.innerHTML = standings.map(s => {
    const icon = PODIUM_ICON[s.place - 1];
    const name = s.team?.members ? teamLabel(s.team) : escapeHtml(s.name || 'Unknown');
    const points = showPoints && s.points !== undefined ? ` <small>${escapeHtml(s.points)} pts</small>` : '';

    return `
      <div class="place ${PODIUM[s.place - 1] ?? ''}">
        <span class="position">${icon ? `<span class="fa-solid ${icon}"></span>` : ''} ${formatOrdinal(s.place)}</span>
        <span class="name">${name}${points}</span>
      </div>
    `;
  }).join('');

  renderHistorySection();
}

/** Fill #tournament-history with past tournaments, newest first, or hide it when there are none. */
function renderHistorySection() {
  const history = store.getHistory();
  const section = document.getElementById('tournament-history');
  section.hidden = history.length === 0;

  section.innerHTML = `
    <h4><span class="fa-solid fa-clock-rotate-left"></span> Past Tournaments</h4>
    ${history.toSorted((a, b) => b.completedAt - a.completedAt).map(entry => {
      const [icon, label] = TYPE_INFO.get(entry.type) ?? ['fa-trophy', 'Tournament'];
      const date = new Date(entry.completedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const winner = entry.winner?.team ? teamLabel(entry.winner.team) : escapeHtml(entry.winner?.name || 'Unknown');
      const topThree = entry.standings?.slice(0, 3).map(s => {
        const points = s.points !== undefined ? ` (${escapeHtml(s.points)} pts)` : '';
        return `${escapeHtml(s.place)}. ${escapeHtml(s.name)}${points}`;
      }).join(', ');

      return `
        <details class="history-entry">
          <summary>
            <span class="history-icon"><span class="fa-solid ${icon}"></span></span>
            <span class="history-winner">
              <span class="fa-solid fa-crown"></span> ${winner}
            </span>
            <span class="history-meta">${date}</span>
          </summary>
          <div class="history-details">
            <p><strong>Type:</strong> ${label}</p>
            <p><strong>Participants:</strong> ${escapeHtml(entry.participantCount)}</p>
            ${topThree ? `<p><strong>Top 3:</strong> ${topThree}</p>` : ''}
          </div>
        </details>
      `;
    }).join('')}
  `;
}
