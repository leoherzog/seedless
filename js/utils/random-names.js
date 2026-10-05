/**
 * Random default names for the home view: adjective + game/sport room slugs,
 * adjective + animal player names, and the fixed name for room creators.
 */

export const HOST_NAME = 'Host';

// Lowercase single words that read well before both a game and an animal
export const ADJECTIVES = [
  'agile', 'atomic', 'bold', 'bouncy', 'brave', 'breezy', 'bright', 'brisk',
  'bubbly', 'clever', 'cosmic', 'crafty', 'crispy', 'daring', 'dashing', 'dizzy',
  'electric', 'epic', 'fearless', 'feisty', 'fiery', 'fizzy', 'flashy', 'fluffy',
  'frosty', 'funky', 'fuzzy', 'gentle', 'giant', 'glitchy', 'golden', 'groovy',
  'happy', 'heroic', 'hyper', 'icy', 'jazzy', 'jolly', 'jumpy', 'legendary',
  'lucky', 'lunar', 'magical', 'mellow', 'mighty', 'misty', 'mystic', 'nimble',
  'noble', 'peppy', 'perky', 'plucky', 'proud', 'quick', 'quirky', 'radiant',
  'rapid', 'rowdy', 'royal', 'rusty', 'salty', 'sassy', 'scrappy', 'shiny',
  'silent', 'silly', 'sleepy', 'slick', 'sly', 'snappy', 'sneaky', 'solar',
  'sparkly', 'speedy', 'spicy', 'spooky', 'sporty', 'stealthy', 'steady', 'stormy',
  'sunny', 'swift', 'tiny', 'turbo', 'valiant', 'vivid', 'wacky', 'wild',
  'wily', 'witty', 'zany', 'zesty', 'zippy',
];

// Already in slug form so they can be joined into a room slug directly
export const GAMES_AND_SPORTS = [
  // Video games
  'among-us', 'apex-legends', 'beat-saber', 'bomberman', 'brawlhalla', 'call-of-duty',
  'counter-strike', 'donkey-kong', 'f-zero', 'fall-guys', 'fortnite', 'galaga',
  'goldeneye', 'gran-turismo', 'guitar-hero', 'halo', 'hearthstone', 'just-dance',
  'kirby', 'mario-golf', 'mario-kart', 'mario-party', 'mario-tennis', 'melee',
  'minecraft', 'mortal-kombat', 'nba-jam', 'overwatch', 'pac-man', 'pokemon',
  'pong', 'puyo-puyo', 'rock-band', 'rocket-league', 'smash-bros', 'soulcalibur',
  'splatoon', 'starcraft', 'street-fighter', 'tekken', 'tetris', 'tony-hawk',
  'valorant', 'wario-ware', 'wii-sports',
  // Sports and table games
  'air-hockey', 'arm-wrestling', 'badminton', 'baseball', 'basketball', 'billiards',
  'bocce', 'bowling', 'checkers', 'chess', 'cornhole', 'cricket',
  'croquet', 'curling', 'darts', 'dodgeball', 'fencing', 'foosball',
  'four-square', 'frisbee', 'golf', 'handball', 'hockey', 'karate',
  'kickball', 'lacrosse', 'mini-golf', 'pickleball', 'pinball', 'ping-pong',
  'racquetball', 'rugby', 'shuffleboard', 'skee-ball', 'soccer', 'softball',
  'spikeball', 'squash', 'sumo', 'tennis', 'tetherball', 'tug-of-war',
  'volleyball', 'wiffle-ball',
];

export const ANIMALS = [
  'alpaca', 'armadillo', 'axolotl', 'badger', 'beaver', 'bison', 'capybara', 'cheetah',
  'chinchilla', 'cobra', 'corgi', 'coyote', 'crane', 'dingo', 'dolphin', 'eagle',
  'falcon', 'ferret', 'flamingo', 'fox', 'frog', 'gazelle', 'gecko', 'gibbon',
  'giraffe', 'gopher', 'gorilla', 'hamster', 'hawk', 'hedgehog', 'heron', 'hippo',
  'ibex', 'iguana', 'jackal', 'jaguar', 'kangaroo', 'kiwi', 'koala', 'lemur',
  'lion', 'llama', 'lobster', 'lynx', 'mantis', 'marmot', 'meerkat', 'mongoose',
  'moose', 'narwhal', 'newt', 'ocelot', 'octopus', 'orca', 'otter', 'owl',
  'panda', 'panther', 'parrot', 'pelican', 'penguin', 'platypus', 'porcupine', 'possum',
  'puffin', 'python', 'quokka', 'rabbit', 'raccoon', 'raven', 'rhino', 'robin',
  'salamander', 'seal', 'shark', 'skunk', 'sloth', 'sparrow', 'squirrel', 'stingray',
  'swan', 'tapir', 'tiger', 'tortoise', 'toucan', 'turtle', 'viper', 'vulture',
  'walrus', 'weasel', 'whale', 'wolf', 'wolverine', 'wombat', 'yak', 'zebra',
];

/**
 * @template T
 * @param {T[]} list
 * @returns {T}
 */
function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * @param {string} word
 * @returns {string}
 */
function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Random room slug such as "spicy-mario-kart". Always a valid canonical slug.
 * @returns {string}
 */
export function generateRoomSlug() {
  return `${pick(ADJECTIVES)}-${pick(GAMES_AND_SPORTS)}`;
}

/**
 * Random player display name such as "Sneaky Otter".
 * @returns {string}
 */
export function generatePlayerName() {
  return `${capitalize(pick(ADJECTIVES))} ${capitalize(pick(ANIMALS))}`;
}
