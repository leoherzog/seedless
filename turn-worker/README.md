# Seedless TURN Credential Worker

A Cloudflare Worker that mints short-lived [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/) credentials for Seedless. Peers behind strict NATs, such as phones on carrier-grade NAT, cannot connect with STUN alone. Cloudflare TURN has no long-lived client credentials, so the Worker keeps the API token secret and hands browsers credentials that expire.

## Deploy

1. In the Cloudflare dashboard under Realtime > TURN, create a TURN key and note its **Key ID** and **API Token**.
2. In `wrangler.jsonc`, set `TURN_KEY_ID`, set `ALLOWED_ORIGINS` to your app's comma-separated origins, and replace `routes` with your domain or delete it to use workers.dev. Keep `http://localhost:8000` in `ALLOWED_ORIGINS` for local development.
3. Deploy and set the secret:

   ```bash
   cd turn-worker
   npx wrangler deploy
   npx wrangler secret put TURN_KEY_API_TOKEN
   ```

4. Set `network.turnCredentialsUrl` in the root `config.js` to `https://<your domain>`, or to the workers.dev URL that `wrangler deploy` prints.

## Behavior

- A `GET` from an allowed `Origin` returns Cloudflare's `{ "iceServers": [...] }`, with STUN and TURN servers.
- A missing or disallowed `Origin` gets 403, and other methods get 405. This stops other websites from spending your quota but not scripted clients, so credentials expire after `TURN_TTL_SECONDS`, six hours by default.
- Upstream failures return 502. The client then joins with STUN only, so an outage degrades connectivity without blocking the app.

## Cost and Abuse

- Cloudflare Realtime egress is free for the first 1,000 GB a month, shared by TURN and the SFU, then $0.05/GB. TURN carries only peer pairs that cannot connect directly. Set a [billing notification](https://developers.cloudflare.com/notifications/) as a backstop.
- If the relay is abused, rotate or delete the TURN key, which invalidates every credential minted from it. [GraphQL analytics](https://developers.cloudflare.com/realtime/turn/analytics/) shows usage.
