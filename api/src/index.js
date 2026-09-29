// The whole app: API routes, media streaming and the server-rendered share pages, as one Hono
// worker. The static frontend (landing page, dashboard) is served by the Assets binding in front
// of this — a request only reaches here when it is not a real file under frontend/.
//
// Config arrives per request as `c.env`: [vars] + bindings in wrangler.toml, secrets from
// .dev.vars (dev) or `wrangler secret put` (live). Nothing reads process.env any more.
import { Hono } from 'hono';
import { appApi } from './app-api.js';
import { auth } from './auth.js';
import { dashboard } from './dashboard-api.js';
import { publicApi } from './public-api.js';
import { streamMedia, thumbnail } from './media.js';
import { appleAppSiteAssociation, assetLinks, creatorPage, filePage, privacyPage } from './pages.js';

export function createApp() {
  const app = new Hono();

  // Two locks, each where it belongs: the admin token guards every dashboard route (see
  // dashboard-api.js), and the shared X-Api-Key is asked for only on the upload endpoints — see the
  // `apiKey` middleware put on those routes there. Nothing else on the server needs the key: the
  // public share pages, the app API and the video stream are reached by anonymous viewers.
  app.route('/api/auth', auth);
  app.route('/api/dashboard', dashboard);
  app.route('/api/app', appApi);
  // Public, no-auth reads (e.g. GET /api/videos) — the same list the dashboard shows, minus the login.
  app.route('/api', publicApi);

  app.get('/media/:id', streamMedia);
  app.get('/t/:id', thumbnail);

  app.get('/app/:id', filePage);
  app.get('/creator/:id', creatorPage);
  app.get('/privacy', privacyPage);
  app.get('/.well-known/assetlinks.json', assetLinks);
  app.get('/.well-known/apple-app-site-association', appleAppSiteAssociation);

  // Search crawlers reach this origin through the share links, so robots.txt belongs here.
  // (run_worker_first in wrangler.toml keeps this ahead of any same-named file.)
  app.get('/robots.txt', (c) => c.text('User-agent: *\nDisallow: /dashboard/\nDisallow: /api/\nDisallow: /media/\n', 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  }));

  app.notFound((c) => (c.req.path.startsWith('/api/') ? c.json({ error: 'Not found' }, 404) : c.text('Not found', 404)));
  app.onError((err, c) => {
    console.error(err);
    return c.req.path.startsWith('/api/') ? c.json({ error: 'Server error, please try again' }, 500) : c.text('Server error', 500);
  });

  return app;
}

export default createApp();
