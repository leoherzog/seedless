/**
 * Tests for random default room slugs and player names
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../config.js';
import {
  HOST_NAME,
  ADJECTIVES,
  GAMES_AND_SPORTS,
  ANIMALS,
  generateRoomSlug,
  generatePlayerName,
} from '../js/utils/random-names.js';

// Canonical slug shape produced by sanitizeRoomSlug in url-state.js
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 50;

test('random-names wordlists', async (t) => {
  await t.test('have no duplicate entries', () => {
    for (const list of [ADJECTIVES, GAMES_AND_SPORTS, ANIMALS]) {
      assert.deepStrictEqual(new Set(list).size, list.length);
    }
  });

  await t.test('contain only slug-safe lowercase words', () => {
    for (const word of [...ADJECTIVES, ...ANIMALS]) {
      assert.match(word, /^[a-z]+$/);
    }
    for (const game of GAMES_AND_SPORTS) {
      assert.match(game, SLUG_PATTERN);
    }
  });

  await t.test('never repeat an adjective as the first word of a game', () => {
    const adjectives = new Set(ADJECTIVES);
    for (const game of GAMES_AND_SPORTS) {
      assert(!adjectives.has(game.split('-')[0]), game);
    }
  });
});

test('generateRoomSlug', async (t) => {
  await t.test('joins an adjective and a game or sport into a canonical slug', () => {
    for (let i = 0; i < 200; i++) {
      const slug = generateRoomSlug();
      assert.match(slug, SLUG_PATTERN);
      assert(slug.length <= MAX_SLUG_LENGTH, slug);

      const [adjective, ...rest] = slug.split('-');
      assert(ADJECTIVES.includes(adjective), slug);
      assert(GAMES_AND_SPORTS.includes(rest.join('-')), slug);
    }
  });

  await t.test('longest possible slug fits the slug length limit', () => {
    const longest = (list) => Math.max(...list.map(w => w.length));
    assert(longest(ADJECTIVES) + 1 + longest(GAMES_AND_SPORTS) <= MAX_SLUG_LENGTH);
  });
});

test('generatePlayerName', async (t) => {
  await t.test('returns a capitalized adjective and animal', () => {
    for (let i = 0; i < 200; i++) {
      const name = generatePlayerName();
      assert.match(name, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
      assert(name.length <= CONFIG.validation.maxNameLength, name);

      const [adjective, animal] = name.toLowerCase().split(' ');
      assert(ADJECTIVES.includes(adjective), name);
      assert(ANIMALS.includes(animal), name);
    }
  });

  await t.test('never produces the host name', () => {
    for (let i = 0; i < 200; i++) {
      assert(generatePlayerName() !== HOST_NAME);
    }
  });
});
