# Seedless

**Serverless P2P Tournament Brackets**

Tournament brackets that run entirely in the browser. Peers sync directly with each other, so there is no backend and any static host works.

## Features

- **Tournament types**: Single Elimination, Double Elimination, Points Race in the style of Mario Kart, and Doubles, which runs teams through a single- or double-elimination bracket
- **Shareable links**: a room is a URL, and anyone with the link can join
- **Admin controls**: the room's creator is authoritative for bracket structure and can verify or edit results
- **Self-reporting**: match participants or the admin report results, and the latest report wins until the admin verifies it
- **Persistent state**: each browser saves the tournament to localStorage and resyncs with peers when they reconnect

## Quick Start

Serve the repo root, open `http://localhost:8000`, then create a room and share its link.

```bash
python -m http.server 8000
```

## Forking

1. Fork this repository.
2. Change `appId` in `config.js` to something unique. Peers on different appIds never see each other's rooms.
3. Replace the Font Awesome kit `<script>` in `index.html` with your own kit or `<script defer src="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.3.1/js/all.min.js"></script>`. Use an SVG+JS build, because only it replaces the emoji fallback inside each icon span.
4. Set `network.turnCredentialsUrl` in `config.js` to your deployed [TURN worker](turn-worker/README.md), or to `''` for STUN only. The default URL refuses other sites, and without TURN, peers behind strict NATs such as cellular networks may fail to connect.
5. Deploy the repo root to any static host. There is no build step.

## Technology Stack

- **[Trystero](https://github.com/dmotz/trystero)**: WebRTC peer connections, with Nostr relays for discovery
- **[PicoCSS](https://picocss.com/)**: minimal CSS framework for semantic HTML
- **[Font Awesome](https://fontawesome.com/)**: icons
- **Vanilla JavaScript**: ES modules, no build step

## License

MIT
