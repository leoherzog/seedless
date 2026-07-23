/**
 * Seedless TURN Credential Worker
 *
 * Mints short-lived Cloudflare Realtime TURN credentials for the client app.
 * The long-lived TURN key API token stays server-side as a Worker secret;
 * browsers only ever receive credentials that expire after TURN_TTL_SECONDS.
 *
 * GET / -> { iceServers: [...] }  (Cloudflare generate-ice-servers passthrough)
 *
 * Origin-locked: only browsers on an ALLOWED_ORIGINS page can read the
 * response (CORS). This stops other websites from using the endpoint; it is
 * not cryptographic protection against non-browser clients, which is why the
 * credentials are short-lived.
 */

const UPSTREAM = 'https://rtc.live.cloudflare.com/v1/turn/keys';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (!origin || !allowed.includes(origin)) {
      return Response.json({ error: 'origin not allowed' }, { status: 403 });
    }

    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
      });
    }

    if (request.method !== 'GET') {
      return Response.json({ error: 'method not allowed' }, { status: 405, headers: cors });
    }

    const ttl = Number(env.TURN_TTL_SECONDS) || 21600;

    try {
      const upstream = await fetch(
        `${UPSTREAM}/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.TURN_KEY_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ttl }),
        },
      );

      if (!upstream.ok) {
        console.error(JSON.stringify({ event: 'turn_upstream_error', status: upstream.status }));
        return Response.json({ error: 'upstream error' }, { status: 502, headers: cors });
      }

      const body = await upstream.json();
      return Response.json(body, {
        headers: { ...cors, 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      console.error(JSON.stringify({ event: 'turn_worker_error', message: error.message }));
      return Response.json({ error: 'internal error' }, { status: 502, headers: cors });
    }
  },
};
