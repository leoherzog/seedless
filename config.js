/**
 * App-wide settings. A fork must change appId to get its own tournament
 * network, since peers on different appIds never see each other's rooms.
 */
export const CONFIG = {
  // Trystero's Nostr strategy also picks relays from appId, so peers on one appId share relays.
  appId: 'seedless-tournament-v1',

  // Points Race scoring by finishing position; positions past the table score 0.
  // 'sequential' awards N, N-1, ..., 1 in an N-player game.
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
    // Deployed turn-worker/ URL, which lets peers behind strict NATs such as cellular connect.
    // An empty string disables TURN and leaves STUN only.
    turnCredentialsUrl: 'https://turn.tournament.thehopegang.com',
  },

  validation: {
    maxNameLength: 100,
    maxMatchIdLength: 50,
  },
};
