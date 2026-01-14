# Seedless

**Serverless P2P Tournament Brackets**

A fully client-side tournament bracket system using peer-to-peer communication. No server required - works on any static hosting like GitHub Pages or Cloudflare Pages.

## Features

- **P2P Communication**: Uses [Trystero](https://github.com/dmotz/trystero) with BitTorrent trackers for peer discovery
- **Multiple Tournament Types**:
  - Single Elimination
  - Double Elimination
  - Points Race (Mario Kart style) - *Coming Soon*
  - Doubles (team-based) - *Coming Soon*
- **Admin Controls**: Tournament creator manages settings and can verify results
- **Participant Reporting**: Match participants can report their own results
- **Persistent State**: Tournament state saved to localStorage and synced across peers
- **Shareable Links**: Room URLs can be shared for easy joining
- **No Build Required**: Pure ES modules, runs directly in browser

## Quick Start

1. Clone or download this repository
2. Serve the files with any static HTTP server:
   ```bash
   # Using Python
   python -m http.server 8000

   # Using Node.js (npx)
   npx serve

   # Using PHP
   php -S localhost:8000
   ```
3. Open `http://localhost:8000` in your browser
4. Create a room and share the link with participants

## Deployment

Deploy to any static hosting:

### GitHub Pages
1. Push to a GitHub repository
2. Go to Settings > Pages
3. Select branch and save

### Cloudflare Pages
1. Connect your repository
2. Leave build command empty
3. Set output directory to `/`

### Netlify / Vercel
1. Connect repository
2. No build configuration needed

## Forking

To create your own Seedless instance:

1. Fork this repository
2. **Important**: Edit `config.js` and change the `appId` to something unique:
   ```javascript
   appId: 'your-unique-tournament-app-id',
   ```
   This ensures your tournaments are isolated from other Seedless instances.
3. **Font Awesome**: The icons use a Font Awesome kit. For your own deployment, either:
   - Create a free Font Awesome kit at [fontawesome.com](https://fontawesome.com/kits) and update the script tag in `index.html`
   - Or replace with the CDN version: `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css`
4. Deploy to your preferred static host

## How It Works

1. **Room Creation**: Admin creates a room with a custom slug (e.g., `friday-smash`)
2. **Peer Discovery**: Trystero uses BitTorrent trackers to discover peers in the same room
3. **State Sync**: Admin is authoritative for bracket structure; match results use last-write-wins
4. **Match Reporting**: Only participants in a match can report its result
5. **Persistence**: State is saved to localStorage and synced when peers reconnect

## Technology Stack

- **[Trystero](https://github.com/dmotz/trystero)** - P2P WebRTC connections via BitTorrent
- **[PicoCSS](https://picocss.com/)** - Minimal CSS framework for semantic HTML
- **[Font Awesome](https://fontawesome.com/)** - Icons
- **Vanilla JavaScript** - ES modules, no build step

## Browser Support

Works in modern browsers that support:
- WebRTC
- ES Modules
- localStorage

## License

MIT
