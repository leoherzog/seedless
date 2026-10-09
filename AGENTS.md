# AGENTS.md

Guidance for coding agents working in this repository.

## Overview

Seedless is a serverless P2P tournament bracket app built from plain ES modules with no build step. Every import is a relative path ending in `.js`. Peers discover each other through Trystero over Nostr relays and sync over WebRTC.

## Commands

```bash
python -m http.server 8000   # serve at http://localhost:8000
npm test                     # run all tests
npm run test:watch           # watch mode
npm run test:coverage        # coverage report
```

Serve on port 8000, the only local origin the TURN worker allows. Tests run on Node 24 or later with `node:test` and `node:assert/strict`, and need no dependencies. They live in `tests/`, with integration tests in `tests/integration/`. Each test file runs in its own process with an in-memory `localStorage`. `tests/register-hooks.js` resolves the Trystero CDN import to `tests/mocks/trystero-mock.js`, so changing that URL in `room.js` means changing both.

## Module Structure

```
index.html          # All views, as data-view sections
config.js           # CONFIG, commented per key
css/tournament.css  # App styles on top of Pico
js/
├── main.js         # Entry: room join/leave from the URL, view switching, saves
├── state/
│   ├── store.js           # Event-emitting store, serialize, merge
│   ├── persistence.js     # localStorage snapshots, preferences, localUserId
│   └── url-state.js       # ?room= query parameter
├── network/
│   ├── room.js            # Trystero wrapper, ActionTypes, TURN fetch
│   ├── sync.js            # Action handlers, sender trust, reconcile
│   └── sync-validators.js # Payload validators
├── tournament/
│   ├── bracket-utils.js       # Seed order, knockout builder, replay helpers, round names
│   ├── single-elimination.js  # Generation, advance() replay, standings
│   ├── double-elimination.js  # Same, plus losers bracket and grand finals
│   ├── doubles.js             # Teams through a single or double bracket
│   ├── mario-kart.js          # Points Race scheduling and scoring
│   └── standings.js           # Final standings for any type
├── components/
│   ├── lobby.js           # Participants, settings, teams, start
│   ├── bracket-view.js    # Bracket, games, standings, result modals
│   └── toast.js           # Notifications
└── utils/
    ├── html.js               # HTML escaping
    ├── drag-drop.js          # Sortable lists
    ├── random-names.js       # Default room slugs and player names
    └── tournament-helpers.js # Ordinals, match status, points, seeding, membership, result order
turn-worker/        # Cloudflare Worker that mints TURN credentials
```

## State Model

`store.js` is the single source of truth, and each mutation emits `change` with its path. `main.js` saves every change outside `local.*` after a debounce, and `local.*` is never serialized or synced.

The `matches` Map is the only copy of each match and Points Race game, and bracket rounds hold `matchIds`. `bracket.startedAt`, stamped at start, identifies the tournament. `meta.status` runs `lobby`, `active`, `complete`; inside a room `main.js` shows the lobby until `active`, then the bracket view.

`advance()` in `single-elimination.js` and `double-elimination.js` is the only advancement engine, and doubles reuses it with teams as participants. It replays every result in bracket order, so seats, walkovers and the reset follow from results alone, and a result whose players are no longer seated is cleared. `scoreRace()` in `mario-kart.js` does the same for Points Race scores and standings. `reconcile()` in `sync.js` runs the right one after every result and merge, writes through `store.updateMatch`, and sets an active tournament's `meta.status` to `complete` exactly when it has a champion.

## Identity and Admin

Participants have a transient Trystero `peerId` and a persistent `localUserId` from localStorage. `peerIdToUserId` in `sync.js` maps one to the other, and handlers identify senders only through it. Manual players added by the admin have `manual_` ids and no peer until a joiner with the same name claims them.

The admin is the room's creator, and `connectToRoom()` in `main.js` restores admin status when the saved `meta.adminId` equals `localUserId`.

## Network Protocol

`ActionTypes` in `room.js` names each action:

- `st:req/st:res`: state request and full-state reply, exchanged with each new peer; the admin also broadcasts `st:res` once its lobby edits settle
- `p:join/p:upd`: participant announce and update; `p:join` maps the sender's `peerId`
- `p:leave`: admin removal; voluntary leaves arrive as Trystero peer-leave events
- `t:start/t:reset`: tournament start, and return to lobby carrying the archived history entry
- `m:result/m:verify`: match report and admin verification
- `r:result`: Points Race game result

Messages travel as `{ payload }`. `room.js` drops non-object payloads, and handlers receive `(payload, peerId)`. `isNewerResult()` orders reports by `version`, then `reportedAt`, then reporter id, the same way on every peer; the admin overrides a result only by verifying it. A result whose winner or sender is not seated locally makes the receiver request the sender's state.

## Security Invariants

`sync.js` and `store.js` enforce these:

- Admin only, meaning the sender's mapped id equals `meta.adminId`: `t:start`, `t:reset`, `m:verify`, `p:leave`, manual `p:join`, and a `p:upd` naming another participant, which otherwise applies to the sender.
- An `st:res` with `isAdmin` maps its sender to the admin only if its `adminId` matches the known `meta.adminId` and no other connected peer holds that mapping. The admin trusts no claim, and a claim naming the local user is refused. Trust on first use remains: a joiner with no `adminId` yet accepts the first claim and adopts its `adminId`.
- `store.merge(remote, senderIsAdmin)` takes `meta`, `teamAssignments`, history, and another tournament's bracket, matches and standings only from a verified admin, or as a bootstrap when local has no `adminId`. Never derive `senderIsAdmin` from `remote.meta.adminId`, which every peer carries. A known `adminId` never changes, and a snapshot naming the local user as admin is ignored.
- Within one tournament any snapshot may carry newer results for existing matches, but never seats or new ids, and only the admin's carries `verifiedBy`. Replay clears a result whose players are not seated.
- `p:join` rejects claims to `meta.adminId` and to ids connected from another peer, and retries the latter once that peer leaves.
- `m:result` comes only from the match's players, their teammates, or the admin, and only the admin changes a verified match. Non-admins ignore it until their first `st:res`.
- `r:result` comes only from the game's players or the admin, and must list each racer once.
- `sync-validators.js` checks `st:res` and its match entries, `p:join`, `p:upd`, `m:result`, `m:verify` and `r:result` payloads, and `p:upd` allows only listed fields.

Merges never remove participants and resolve their fields by `updatedAt`. Within one tournament a result merges when it is the admin's verified one or `isNewerResult()` ranks it higher, and a verified result yields only to a newer one the admin verified. A trusted snapshot of another tournament replaces all matches. History entries union by `id`.

## Configuration

`config.js` comments each `CONFIG` key. Changing `appId` moves the app to a separate tournament network, cut off from existing rooms. `network.turnCredentialsUrl` points at the deployed `turn-worker/`, and an empty string means STUN only.
