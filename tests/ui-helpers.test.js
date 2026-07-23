/**
 * Tests for Tournament UI Helper Functions
 */

import { assertEquals } from 'jsr:@std/assert';
import {
  getOrdinalSuffix,
  formatOrdinal,
  determineMatchStatus,
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
