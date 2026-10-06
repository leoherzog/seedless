/**
 * Seedless Configuration
 *
 * FORKS: Change the appId to create your own isolated tournament network.
 * Users with different appIds will not see each other's rooms.
 */
export const CONFIG = {
  // Trystero's Nostr strategy also picks relays from appId, so peers on one appId share relays.
  appId: 'seedless-tournament-v1',

  // Mario Kart style point tables
  // Use 'sequential' string for dynamic N, N-1, ..., 1 scoring based on game size
  pointsTables: {
    standard: [15, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    simple: [10, 8, 6, 4, 2, 1],
    f1: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    sequential: 'sequential',
  },

  storage: {
    prefix: 'seedless_',
    retentionDays: 30,
  },

  ui: {
    toastDuration: 3000,
  },

  network: {
    // TURN credential endpoint (see turn-worker/). Set to your deployed
    // Worker URL to enable TURN relay for peers behind strict NATs (e.g.
    // phones on cellular). Empty string disables TURN (STUN only).
    turnCredentialsUrl: 'https://turn.tournament.thehopegang.com',
  },

  validation: {
    maxNameLength: 100,
    maxMatchIdLength: 50,
  },
};
