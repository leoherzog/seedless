/**
 * Tests for Tournament UI Helper Functions
 */

import { assertEquals } from 'jsr:@std/assert';
import {
  getOrdinalSuffix,
  formatOrdinal,
  determineMatchStatus,
  canReportMatchResult,
  getTeamMemberCount,
  sortStandings
} from '../js/utils/tournament-helpers.js';

Deno.test('getOrdinalSuffix', async (t) => {
  await t.step('returns st for 1', () => {
    assertEquals(getOrdinalSuffix(1), 'st');
  });

  await t.step('returns nd for 2', () => {
    assertEquals(getOrdinalSuffix(2), 'nd');
  });

  await t.step('returns rd for 3', () => {
    assertEquals(getOrdinalSuffix(3), 'rd');
  });

  await t.step('returns th for 4-10', () => {
    assertEquals(getOrdinalSuffix(4), 'th');
    assertEquals(getOrdinalSuffix(5), 'th');
    assertEquals(getOrdinalSuffix(6), 'th');
    assertEquals(getOrdinalSuffix(7), 'th');
    assertEquals(getOrdinalSuffix(8), 'th');
    assertEquals(getOrdinalSuffix(9), 'th');
    assertEquals(getOrdinalSuffix(10), 'th');
  });

  await t.step('handles teens (11, 12, 13 are th)', () => {
    assertEquals(getOrdinalSuffix(11), 'th');
    assertEquals(getOrdinalSuffix(12), 'th');
    assertEquals(getOrdinalSuffix(13), 'th');
  });

  await t.step('handles 21, 22, 23', () => {
    assertEquals(getOrdinalSuffix(21), 'st');
    assertEquals(getOrdinalSuffix(22), 'nd');
    assertEquals(getOrdinalSuffix(23), 'rd');
  });

  await t.step('handles larger numbers', () => {
    assertEquals(getOrdinalSuffix(100), 'th');
    assertEquals(getOrdinalSuffix(101), 'st');
    assertEquals(getOrdinalSuffix(102), 'nd');
    assertEquals(getOrdinalSuffix(103), 'rd');
    assertEquals(getOrdinalSuffix(111), 'th');
    assertEquals(getOrdinalSuffix(112), 'th');
    assertEquals(getOrdinalSuffix(113), 'th');
  });
});

Deno.test('formatOrdinal', async (t) => {
  await t.step('formats numbers correctly', () => {
    assertEquals(formatOrdinal(1), '1st');
    assertEquals(formatOrdinal(2), '2nd');
    assertEquals(formatOrdinal(3), '3rd');
    assertEquals(formatOrdinal(4), '4th');
    assertEquals(formatOrdinal(11), '11th');
    assertEquals(formatOrdinal(21), '21st');
    assertEquals(formatOrdinal(22), '22nd');
    assertEquals(formatOrdinal(23), '23rd');
  });
});

Deno.test('determineMatchStatus', async (t) => {
  await t.step('returns complete when winnerId is set', () => {
    const match = {
      winnerId: 'user1',
      participants: ['user1', 'user2']
    };
    assertEquals(determineMatchStatus(match), 'complete');
  });

  await t.step('returns live when both participants present and no winner', () => {
    const match = {
      winnerId: null,
      participants: ['user1', 'user2']
    };
    assertEquals(determineMatchStatus(match), 'live');
  });

  await t.step('returns pending when only one participant', () => {
    const match = {
      winnerId: null,
      participants: ['user1', null]
    };
    assertEquals(determineMatchStatus(match), 'pending');
  });

  await t.step('returns pending when no participants', () => {
    const match = {
      winnerId: null,
      participants: [null, null]
    };
    assertEquals(determineMatchStatus(match), 'pending');
  });

  await t.step('returns pending for empty string participants', () => {
    const match = {
      winnerId: null,
      participants: ['', '']
    };
    assertEquals(determineMatchStatus(match), 'pending');
  });
});

Deno.test('canReportMatchResult', async (t) => {
  await t.step('returns true when user is participant and match is ready', () => {
    const match = {
      winnerId: null,
      isBye: false,
      participants: ['user1', 'user2']
    };
    assertEquals(canReportMatchResult(match, 'user1'), true);
    assertEquals(canReportMatchResult(match, 'user2'), true);
  });

  await t.step('returns false when winner already determined', () => {
    const match = {
      winnerId: 'user1',
      isBye: false,
      participants: ['user1', 'user2']
    };
    assertEquals(canReportMatchResult(match, 'user1'), false);
  });

  await t.step('returns false for bye matches', () => {
    const match = {
      winnerId: null,
      isBye: true,
      participants: ['user1', null]
    };
    assertEquals(canReportMatchResult(match, 'user1'), false);
  });

  await t.step('returns false when user is not a participant', () => {
    const match = {
      winnerId: null,
      isBye: false,
      participants: ['user1', 'user2']
    };
    assertEquals(canReportMatchResult(match, 'user3'), false);
  });

  await t.step('returns false when match is incomplete', () => {
    const match = {
      winnerId: null,
      isBye: false,
      participants: ['user1', null]
    };
    assertEquals(canReportMatchResult(match, 'user1'), false);
  });
});

Deno.test('getTeamMemberCount', async (t) => {
  await t.step('counts team members from Map', () => {
    const assignments = new Map([
      ['p1', 'team-1'],
      ['p2', 'team-1'],
      ['p3', 'team-2']
    ]);
    assertEquals(getTeamMemberCount(assignments, 'team-1'), 2);
    assertEquals(getTeamMemberCount(assignments, 'team-2'), 1);
    assertEquals(getTeamMemberCount(assignments, 'team-3'), 0);
  });

  await t.step('counts team members from Array', () => {
    const assignments = [
      ['p1', 'team-1'],
      ['p2', 'team-1'],
      ['p3', 'team-2']
    ];
    assertEquals(getTeamMemberCount(assignments, 'team-1'), 2);
    assertEquals(getTeamMemberCount(assignments, 'team-2'), 1);
  });

  await t.step('excludes specified participant', () => {
    const assignments = new Map([
      ['p1', 'team-1'],
      ['p2', 'team-1'],
      ['p3', 'team-1']
    ]);
    assertEquals(getTeamMemberCount(assignments, 'team-1', 'p1'), 2);
    assertEquals(getTeamMemberCount(assignments, 'team-1', 'p2'), 2);
    assertEquals(getTeamMemberCount(assignments, 'team-1', null), 3);
  });

  await t.step('returns 0 for empty assignments', () => {
    assertEquals(getTeamMemberCount(new Map(), 'team-1'), 0);
    assertEquals(getTeamMemberCount([], 'team-1'), 0);
  });
});

Deno.test('sortStandings', async (t) => {
  await t.step('sorts by points descending', () => {
    const standings = [
      { name: 'A', points: 5, wins: 0, gamesCompleted: 0 },
      { name: 'B', points: 10, wins: 0, gamesCompleted: 0 },
      { name: 'C', points: 7, wins: 0, gamesCompleted: 0 }
    ];
    const sorted = sortStandings(standings);
    assertEquals(sorted[0].name, 'B');
    assertEquals(sorted[1].name, 'C');
    assertEquals(sorted[2].name, 'A');
  });

  await t.step('uses wins as tiebreaker', () => {
    const standings = [
      { name: 'A', points: 10, wins: 2, gamesCompleted: 0 },
      { name: 'B', points: 10, wins: 5, gamesCompleted: 0 },
      { name: 'C', points: 10, wins: 3, gamesCompleted: 0 }
    ];
    const sorted = sortStandings(standings);
    assertEquals(sorted[0].name, 'B');
    assertEquals(sorted[1].name, 'C');
    assertEquals(sorted[2].name, 'A');
  });

  await t.step('uses gamesCompleted as second tiebreaker', () => {
    const standings = [
      { name: 'A', points: 10, wins: 5, gamesCompleted: 3 },
      { name: 'B', points: 10, wins: 5, gamesCompleted: 5 },
      { name: 'C', points: 10, wins: 5, gamesCompleted: 4 }
    ];
    const sorted = sortStandings(standings);
    assertEquals(sorted[0].name, 'B');
    assertEquals(sorted[1].name, 'C');
    assertEquals(sorted[2].name, 'A');
  });

  await t.step('does not modify original array', () => {
    const standings = [
      { name: 'A', points: 5, wins: 0, gamesCompleted: 0 },
      { name: 'B', points: 10, wins: 0, gamesCompleted: 0 }
    ];
    const sorted = sortStandings(standings);
    assertEquals(standings[0].name, 'A'); // original unchanged
    assertEquals(sorted[0].name, 'B');
  });

  await t.step('handles empty array', () => {
    assertEquals(sortStandings([]).length, 0);
  });

  await t.step('handles single element', () => {
    const standings = [{ name: 'A', points: 10, wins: 5, gamesCompleted: 4 }];
    const sorted = sortStandings(standings);
    assertEquals(sorted.length, 1);
    assertEquals(sorted[0].name, 'A');
  });
});
