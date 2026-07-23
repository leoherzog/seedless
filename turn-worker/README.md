# Seedless TURN Credential Worker

A minimal Cloudflare Worker that mints short-lived [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/) credentials for the Seedless client. WebRTC connections between peers behind strict NATs (phones on cellular carrier-grade NAT, isolated WiFi networks) fail with STUN alone; a TURN relay is the fallback path. Cloudflare's TURN service deliberately has no long-lived client credentials, so this Worker holds the TURN key secret and hands browsers credentials that expire on their own.

## Deploy

1. Create a TURN key in the Cloudflare dashboard (Realtime → TURN) if you haven't already. Note the **Key ID** and **API Token**.

2. Edit `wrangler.jsonc`:
   - Set `TURN_KEY_ID` to your key ID.
   - Set `ALLOWED_ORIGINS` to your app's origin(s).

3. Deploy and set the secret:

   ```bash
   cd turn-worker
   npx wrangler deploy
   npx wrangler secret put TURN_KEY_API_TOKEN   # paste the API token when prompted
   ```

4. Point the client at the Worker: in the repo root `config.js`, set

   ```js
   network: {
     turnCredentialsUrl: 'https://seedless-turn-mint.<your-subdomain>.workers.dev',
   }
   ```

   (`wrangler deploy` prints the exact URL.)

## Behavior

- `GET /` with an allowed `Origin` header → `{ "iceServers": [...] }`, ready to pass to WebRTC. Cloudflare's response includes both its STUN and TURN servers.
- Requests without an allowed `Origin` → 403. This is CORS-level protection: it stops other websites from consuming your relay quota, but not non-browser clients spoofing headers — which is why credentials are short-lived (`TURN_TTL_SECONDS`, default 6 hours).
- Upstream/API failures → 502. The Seedless client treats any failure as "no TURN" and joins with STUN only, so this Worker being down degrades connectivity but never blocks the app.

## Cost & abuse notes

- Cloudflare Realtime includes 1,000 GB/month of TURN egress free, then $0.05/GB. TURN only relays traffic for peer pairs that can't connect directly.
- Consider a [billing notification](https://developers.cloudflare.com/notifications/) as a backstop.
- If abused, rotate/delete the TURN key in the dashboard — that invalidates all credentials minted from it. Cloudflare's [GraphQL analytics](https://developers.cloudflare.com/realtime/turn/analytics/) shows usage.
