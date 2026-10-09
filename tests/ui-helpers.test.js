/**
 * Tests for tournament-helpers.js.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOrdinalSuffix,
  formatOrdinal,
  determineMatchStatus,
  sortStandings,
  isInMatch,
  isNewerResult,
  isRaceOrder,
} from '../js/utils/tournament-helpers.js';

test('getOrdinalSuffix', async (t) => {
  await t.test('returns st for 1', () => {
    assert.deepStrictEqual(getOrdinalSuffix(1), 'st');
  });

  await t.test('returns nd for 2', () => {
    assert.deepStrictEqual(getOrdinalSuffix(2), 'nd');
  });

  await t.test('returns rd for 3', () => {
    assert.deepStrictEqual(getOrdinalSuffix(3), 'rd');
  });

  await t.test('returns th for 4-10', () => {
    assert.deepStrictEqual(getOrdinalSuffix(4), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(5), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(6), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(7), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(8), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(9), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(10), 'th');
  });

  await t.test('handles teens (11, 12, 13 are th)', () => {
    assert.deepStrictEqual(getOrdinalSuffix(11), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(12), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(13), 'th');
  });

  await t.test('handles 21, 22, 23', () => {
    assert.deepStrictEqual(getOrdinalSuffix(21), 'st');
    assert.deepStrictEqual(getOrdinalSuffix(22), 'nd');
    assert.deepStrictEqual(getOrdinalSuffix(23), 'rd');
  });

  await t.test('handles larger numbers', () => {
    assert.deepStrictEqual(getOrdinalSuffix(100), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(101), 'st');
    assert.deepStrictEqual(getOrdinalSuffix(102), 'nd');
    assert.deepStrictEqual(getOrdinalSuffix(103), 'rd');
    assert.deepStrictEqual(getOrdinalSuffix(111), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(112), 'th');
    assert.deepStrictEqual(getOrdinalSuffix(113), 'th');
  });
});

test('formatOrdinal', async (t) => {
  await t.test('formats numbers correctly', () => {
    assert.deepStrictEqual(formatOrdinal(1), '1st');
    assert.deepStrictEqual(formatOrdinal(2), '2nd');
    assert.deepStrictEqual(formatOrdinal(3), '3rd');
    assert.deepStrictEqual(formatOrdinal(4), '4th');
    assert.deepStrictEqual(formatOrdinal(11), '11th');
    assert.deepStrictEqual(formatOrdinal(21), '21st');
    assert.deepStrictEqual(formatOrdinal(22), '22nd');
    assert.deepStrictEqual(formatOrdinal(23), '23rd');
  });
});

test('determineMatchStatus', async (t) => {
  await t.test('returns complete when winnerId is set', () => {
    const match = {
      winnerId: 'user1',
      participants: ['user1', 'user2']
    };
    assert.deepStrictEqual(determineMatchStatus(match), 'complete');
  });

  await t.test('returns live when both participants present and no winner', () => {
    const match = {
      winnerId: null,
      participants: ['user1', 'user2']
    };
    assert.deepStrictEqual(determineMatchStatus(match), 'live');
  });

  await t.test('returns pending when only one participant', () => {
    const match = {
      winnerId: null,
      participants: ['user1', null]
    };
    assert.deepStrictEqual(determineMatchStatus(match), 'pending');
  });

  await t.test('returns pending when no participants', () => {
    const match = {
      winnerId: null,
      participants: [null, null]
    };
    assert.deepStrictEqual(determineMatchStatus(match), 'pending');
  });

  await t.test('returns pending for empty string participants', () => {
    const match = {
      winnerId: null,
      participants: ['', '']
    };
    assert.deepStrictEqual(determineMatchStatus(match), 'pending');
  });
});

test('sortStandings', async (t) => {
  await t.test('sorts by points descending', () => {
    const standings = [
      { name: 'A', points: 5, wins: 0, gamesCompleted: 0 },
      { name: 'B', points: 10, wins: 0, gamesCompleted: 0 },
      { name: 'C', points: 7, wins: 0, gamesCompleted: 0 }
    ];
    const sorted = sortStandings(standings);
    assert.deepStrictEqual(sorted[0].name, 'B');
    assert.deepStrictEqual(sorted[1].name, 'C');
    assert.deepStrictEqual(sorted[2].name, 'A');
  });

  await t.test('uses wins as tiebreaker', () => {
    const standings = [
      { name: 'A', points: 10, wins: 2, gamesCompleted: 0 },
      { name: 'B', points: 10, wins: 5, gamesCompleted: 0 },
      { name: 'C', points: 10, wins: 3, gamesCompleted: 0 }
    ];
    const sorted = sortStandings(standings);
    assert.deepStrictEqual(sorted[0].name, 'B');
    assert.deepStrictEqual(sorted[1].name, 'C');
    assert.deepStrictEqual(sorted[2].name, 'A');
  });

  await t.test('uses gamesCompleted as second tiebreaker', () => {
    const standings = [
      { name: 'A', points: 10, wins: 5, gamesCompleted: 3 },
      { name: 'B', points: 10, wins: 5, gamesCompleted: 5 },
      { name: 'C', points: 10, wins: 5, gamesCompleted: 4 }
    ];
    const sorted = sortStandings(standings);
    assert.deepStrictEqual(sorted[0].name, 'B');
    assert.deepStrictEqual(sorted[1].name, 'C');
    assert.deepStrictEqual(sorted[2].name, 'A');
  });

  await t.test('does not modify original array', () => {
    const standings = [
      { name: 'A', points: 5, wins: 0, gamesCompleted: 0 },
      { name: 'B', points: 10, wins: 0, gamesCompleted: 0 }
    ];
    const sorted = sortStandings(standings);
    assert.deepStrictEqual(standings[0].name, 'A');
    assert.deepStrictEqual(sorted[0].name, 'B');
  });

  await t.test('handles empty array', () => {
    assert.deepStrictEqual(sortStandings([]).length, 0);
  });

  await t.test('handles single element', () => {
    const standings = [{ name: 'A', points: 10, wins: 5, gamesCompleted: 4 }];
    const sorted = sortStandings(standings);
    assert.deepStrictEqual(sorted.length, 1);
    assert.deepStrictEqual(sorted[0].name, 'A');
  });
});

test('isInMatch', async (t) => {
  const teams = [
    { id: 'team-1', members: [{ id: 'p1' }, { id: 'p2' }] },
    { id: 'team-2', members: [{ id: 'p3' }, { id: 'p4' }] },
    { id: 'team-3', members: [{ id: 'p5' }, { id: 'p6' }] },
  ];
  const teamMatch = { participants: ['team-1', 'team-2'] };

  await t.test('matches a player id directly without teams', () => {
    assert.deepStrictEqual(isInMatch({ participants: ['p1', 'p2'] }, 'p1'), true);
    assert.deepStrictEqual(isInMatch({ participants: ['p1', 'p2'] }, 'p3'), false);
  });

  await t.test('matches a member of either team', () => {
    assert.deepStrictEqual(isInMatch(teamMatch, 'p2', teams), true);
    assert.deepStrictEqual(isInMatch(teamMatch, 'p4', teams), true);
  });

  await t.test('rejects a member of a team not in the match', () => {
    assert.deepStrictEqual(isInMatch(teamMatch, 'p5', teams), false);
  });

  await t.test('rejects everyone when doubles has no teams', () => {
    assert.deepStrictEqual(isInMatch({ participants: ['p1', 'p2'] }, 'p1', []), false);
  });
});

test('isNewerResult', async (t) => {
  await t.test('a higher version wins over a later reportedAt', () => {
    assert.deepStrictEqual(isNewerResult({ version: 2, reportedAt: 1000 }, { version: 1, reportedAt: 2000 }), true);
    assert.deepStrictEqual(isNewerResult({ version: 1, reportedAt: 2000 }, { version: 2, reportedAt: 1000 }), false);
  });

  await t.test('on equal versions the later reportedAt wins', () => {
    assert.deepStrictEqual(isNewerResult({ version: 1, reportedAt: 2000 }, { version: 1, reportedAt: 1000 }), true);
    assert.deepStrictEqual(isNewerResult({ version: 1, reportedAt: 1000 }, { version: 1, reportedAt: 2000 }), false);
  });

  await t.test('on equal clocks the greater reporter id wins, so both sides agree', () => {
    const a = { version: 1, reportedAt: 1000, reportedBy: 'admin' };
    const b = { version: 1, reportedAt: 1000, reportedBy: 'player' };
    assert.deepStrictEqual(isNewerResult(b, a), true);
    assert.deepStrictEqual(isNewerResult(a, b), false);
    assert.deepStrictEqual(isNewerResult(a, { ...a }), false);
  });

  await t.test('missing version and reportedAt count as 0', () => {
    assert.deepStrictEqual(isNewerResult({ reportedAt: 2000 }, { reportedAt: 1000 }), true);
    assert.deepStrictEqual(isNewerResult({ version: 1 }, { version: 1, reportedAt: 1000 }), false);
  });

  await t.test('Infinity reportedAt wins and NaN loses', () => {
    const existing = { version: 1, reportedAt: 1000 };
    assert.deepStrictEqual(isNewerResult({ version: 1, reportedAt: Infinity }, existing), true);
    assert.deepStrictEqual(isNewerResult({ version: 1, reportedAt: NaN }, existing), false);
  });
});

test('isRaceOrder', async (t) => {
  const game = { participants: ['a', 'b', 'c'] };

  await t.test('accepts each racer exactly once, in any order', () => {
    assert.deepStrictEqual(isRaceOrder(game, [{ participantId: 'c' }, { participantId: 'a' }, { participantId: 'b' }]), true);
  });

  await t.test('rejects repeats, omissions, strangers and non-arrays', () => {
    assert.deepStrictEqual(isRaceOrder(game, [{ participantId: 'a' }, { participantId: 'a' }, { participantId: 'a' }]), false);
    assert.deepStrictEqual(isRaceOrder(game, [{ participantId: 'a' }, { participantId: 'b' }]), false);
    assert.deepStrictEqual(isRaceOrder(game, [{ participantId: 'a' }, { participantId: 'b' }, { participantId: 'x' }]), false);
    assert.deepStrictEqual(isRaceOrder(game, [null, null, null]), false);
    assert.deepStrictEqual(isRaceOrder(game, 'abc'), false);
  });
});
