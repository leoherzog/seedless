# AGENTS.md

This file provides guidance to Claude Code, Codex, Gemini, etc when working with code in this repository.

## Project Overview

Seedless is a serverless P2P tournament bracket application. It runs entirely client-side with no build step, using ES modules directly in the browser. Peer-to-peer communication is handled through Trystero using Nostr relays for peer discovery.

## Running Locally

Serve the files with any static HTTP server:
```bash
python -m http.server 8000
# or
npx serve
```

Open `http://localhost:8000` in browser.

## Testing

Tests use Deno's built-in test runner:
```bash
deno task test           # Run all tests
deno task test:watch     # Watch mode
deno task test:coverage  # Generate coverage report
```

Tests are in `tests/` with mocks in `tests/mocks/` and integration tests in `tests/integration/`.

## Architecture

### Key Concepts

**No Build System**: Pure ES modules loaded directly by the browser. All imports use relative paths with `.js` extensions.

**Admin Authority Model**: The tournament creator (admin) is authoritative for bracket structure. Match results use last-write-wins (LWW) with admin verification override. Admin status persists across page refreshes because meta.adminId matches the persistent localUserId.

Security considerations in `sync.js` and `store.js`:
- Admin-only actions (`t:start`, `t:reset`, participant removal) verify sender's `localUserId` matches `meta.adminId`
- `store.merge` grants admin authority only when sync.js has verified the sending peer as admin (`senderIsAdmin`)
- Initial sync allows admin establishment when local has no adminId yet
- `p:join` rejects claims to existing connected user IDs (prevents impersonation)

**Dual ID System**: Participants have two IDs:
- `peerId` - Transient WebRTC peer ID (changes on reconnect)
- `localUserId` - Persistent ID stored in localStorage (survives page refresh)

The `peerIdToUserId` map in `js/network/sync.js` translates between them.

### Module Structure

```
js/
├── main.js              # App entry point, view routing, room lifecycle
├── state/
│   ├── store.js         # Central event-emitting state store with CRDT-like merge
│   ├── persistence.js   # localStorage read/write
│   └── url-state.js     # URL query routing (?room=slug&view=bracket)
├── network/
│   ├── room.js          # Trystero room wrapper, action channel setup
│   ├── sync.js          # P2P state sync, conflict resolution, message handlers
│   └── sync-validators.js # Payload validation and LWW conflict resolution
├── tournament/
│   ├── single-elimination.js  # Bracket generation and match advancement
│   ├── double-elimination.js  # Losers bracket support
│   ├── mario-kart.js          # Points race mode with balanced scheduling
│   ├── doubles.js             # Team-based tournament adapter
│   ├── standings.js           # Final standings for any type (results card, history)
│   └── bracket-utils.js       # Seed order, shared knockout builder, round names
├── components/
│   ├── lobby.js         # Pre-tournament participant management
│   ├── bracket-view.js  # Tournament bracket rendering
│   └── toast.js         # Notification system
└── utils/
    ├── html.js          # HTML escaping
    ├── debounce.js      # Debounce utility
    ├── drag-drop.js     # Drag-and-drop helpers
    ├── random-names.js  # Default room slugs and player names
    └── tournament-helpers.js # Match status, ordinals, seeding, shuffle, team membership
```

### State Flow

1. `store.js` is the single source of truth - an event-emitting store with `get()`, `set()` and `on()` methods
2. Components subscribe to store changes via `store.on('change', callback)`
3. P2P messages trigger store updates through handlers in `sync.js`
4. Store changes are persisted to localStorage via `saveTournament()`

### Network Protocol

`ActionTypes` in `room.js` names each action. Trystero limits names to 32 bytes.
- `st:req/st:res` - State request/response
- `p:join/p:upd/p:leave` - Participant lifecycle
- `t:start/t:reset/t:archive` - Tournament lifecycle (admin only)
- `m:result/m:verify` - Match reporting
- `r:result` - Points Race game result
- `s:upd` - Standings update (admin only)
- `v:check` - Admin version heartbeat

Messages travel as `{ payload }`. Sender identity comes from Trystero's `peerId`.

### Configuration

`config.js` exports `CONFIG` object with:
- `appId` - Must be unique per fork to isolate tournament networks
- `pointsTables` - Scoring presets for Mario Kart mode
- `validation` - Input validation limits (maxNameLength, maxMatchIdLength)
- `storage` - localStorage prefix and retentionDays
- `ui` - toastDuration
- `network` - Network settings (stateResponseDelay, turnCredentialsUrl)

## Important Patterns

**View System**: HTML sections have `data-view` attributes. `showView()` in `main.js` hides/shows by toggling `hidden` attribute.

**Bracket Generation**: `buildKnockout()` in `bracket-utils.js` seeds the single-elimination bracket and the double-elimination winners bracket so high seeds don't meet until later rounds, and gives byes to the top seeds. Generators return `{ bracket, matches }`: the store's `matches` Map is the only copy of each match, and bracket rounds hold match ids. `bracket.startedAt` marks the tournament, so a merge never mixes matches from two tournaments.

**Match Advancement**: Each elimination module exports `advance()`, the only advancement engine. `advanceWinner()` in `sync.js` runs it with `store.updateMatch` as the writer and sets `meta.status` to `'complete'` once the champion is decided.
