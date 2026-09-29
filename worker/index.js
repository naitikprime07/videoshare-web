// The Cloudflare Worker: one deployable for the whole app.
//   fetch     — every request that is not a static file under frontend/ (see wrangler.toml assets)
//               lands in the Hono app: /api, /media, /t, /app, /creator, /privacy, /.well-known.
//   scheduled — the twice-a-day sweep of abandoned uploads and expired play tokens (the old
//               setInterval in backend/server.js, now on [triggers] crons).
import app from '@vidshare/api';
import { cleanup } from '@vidshare/api/cleanup';

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanup(env));
  },
};
