/**
 * Seedless Configuration
 *
 * FORKS: Change the appId to create your own isolated tournament network.
 * Users with different appIds will not see each other's rooms.
 */
export const CONFIG = {
  // IMPORTANT: Change this for your fork!
  // This ensures your tournaments are isolated from other Seedless instances
  appId: 'seedless-tournament-v1',

  // Trystero strategy
  strategy: 'torrent',

  // Default tournament settings
  defaults: {
    bestOf: 1,
    numRounds: 4, // For Mario Kart mode
    teamSize: 2,  // For doubles
    seedingMode: 'random', // 'random' or 'manual'
  },

  // Mario Kart style point tables
  // Use 'sequential' string for dynamic N, N-1, ..., 1 scoring based on game size
  pointsTables: {
    standard: [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    simple: [10, 8, 6, 4, 2, 1],
    f1: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    sequential: 'sequential',
  },

  // localStorage settings
  storage: {
    prefix: 'seedless_',
    retentionDays: 30,
  },

  // UI settings
  ui: {
    toastDuration: 3000,
    reconnectDelay: 2000,
  },

  // Network settings
  network: {
    // Delay before sending state to new peers (allows connection to stabilize)
    stateResponseDelay: 500,
  },

  // Validation limits
  validation: {
    maxNameLength: 100,
    maxMatchIdLength: 50,
  },
};

// Warn if using default appId (helps remind forkers to change it)
if (CONFIG.appId === 'seedless-tournament-v1') {
  console.info(
    '%c[Seedless] Using default appId. Fork users should change CONFIG.appId in config.js',
    'color: #888'
  );
}
