# AGENTS.md

This file provides guidance to Claude Code, Codex, Gemini, etc when working with code in this repository.

## Project Overview

Seedless is a serverless P2P tournament bracket application. It runs entirely client-side with no build step, using ES modules directly in the browser. Peer-to-peer communication is handled through Trystero using BitTorrent/WebTorrent trackers for peer discovery.

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

**Admin Authority Model**: The tournament creator (admin) is authoritative for bracket structure. Match results use last-write-wins (LWW) with admin verification override. Admin status persists across page refreshes via localStorage token.

Security considerations in `sync.js` and `store.js`:
- Admin-only actions (`t:start`, `t:reset`, participant removal) verify sender's `localUserId` matches `meta.adminId`
- State merges only trust remote as admin if `remoteAdminId === localAdminId` (after admin is established)
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
│   ├── persistence.js   # localStorage read/write, admin token management
│   └── url-state.js     # URL hash routing (#room=slug&view=bracket)
├── network/
│   ├── room.js          # Trystero room wrapper, action channel setup
│   ├── sync.js          # P2P state sync, conflict resolution, message handlers
│   └── sync-validators.js # Payload validation and LWW conflict resolution
├── tournament/
│   ├── single-elimination.js  # Bracket generation and match advancement
│   ├── double-elimination.js  # Losers bracket support
│   ├── mario-kart.js          # Points race mode with balanced scheduling
│   ├── doubles.js             # Team-based tournament adapter
│   └── bracket-utils.js       # Seeding positions, round names
├── components/
│   ├── lobby.js         # Pre-tournament participant management
│   ├── bracket-view.js  # Tournament bracket rendering
│   └── toast.js         # Notification system
└── utils/
    ├── html.js          # HTML escaping
    ├── debounce.js      # Debounce utility
    ├── drag-drop.js     # Drag-and-drop helpers
    └── tournament-helpers.js # Match status, ordinals, team helpers
```

### State Flow

1. `store.js` is the single source of truth - an event-emitting store with `get()`, `set()`, `batch()` methods
2. Components subscribe to store changes via `store.on('change', callback)`
3. P2P messages trigger store updates through handlers in `sync.js`
4. Store changes are persisted to localStorage via `saveTournament()`

### Network Protocol

Actions defined in `room.js` (12-byte limit on names due to Trystero):
- `st:req/st:res` - State request/response
- `p:join/p:upd/p:leave` - Participant lifecycle
- `t:start/t:reset` - Tournament lifecycle (admin only)
- `m:result/m:verify` - Match reporting

Messages wrap payload with `senderId` and `timestamp` for conflict resolution.

### Configuration

`config.js` exports `CONFIG` object with:
- `appId` - Must be unique per fork to isolate tournament networks
- `defaults` - Tournament configuration defaults (bestOf, teamSize, seedingMode)
- `pointsTables` - Scoring presets for Mario Kart mode
- `validation` - Input validation limits (maxNameLength, maxMatchIdLength)
- `network` - Network timing settings (stateResponseDelay)

## Important Patterns

**View System**: HTML sections have `data-view` attributes. `showView()` in `main.js` hides/shows by toggling `hidden` attribute.

**Bracket Generation**: `single-elimination.js` creates bracket structure with seeding positions calculated to ensure high seeds don't meet until later rounds. Byes are placed to give high seeds the advantage.

**Match Advancement**: When a match result is reported, `advanceWinner()` in `sync.js` places the winner in the next round's match at the correct slot position.
