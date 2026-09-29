// Read-only public endpoints: no admin token, no X-Api-Key. Anonymous callers only ever see the
// same fields a share page already shows, so this is safe to expose. The video list mirrors the
// admin dashboard (serial number + today's views) but is limited to files that are not still
// uploading (see listDashboardFiles) — nothing secret is returned, `fileJson` already strips those.
import { Hono } from 'hono';
import { listDashboardFiles } from './db.js';
import { dayKey, fileJson, num } from './util.js';

export const publicApi = new Hono();

// GET /api/videos?limit=&offset=&sort=&q=
// Everything the admin dashboard's video list shows, minus the login.
publicApi.get('/videos', async (c) => {
  const limit = Math.min(100, Math.max(1, num(c.req.query('limit'), 50)));
  const offset = Math.max(0, num(c.req.query('offset'), 0));
  const sort = String(c.req.query('sort') || 'newest');
  const search = String(c.req.query('q') || '')
    .trim()
    .toLowerCase();
  const { rows, total } = await listDashboardFiles(c.env, {
    sort,
    search,
    today: dayKey(c.env),
    offset,
    limit,
  });
  return c.json({
    total,
    files: rows.map((row) => ({
      ...fileJson(c, row),
      serial: row.serial,
      todayViews: row.today_views,
    })),
    nextOffset: offset + rows.length < total ? offset + limit : null,
  });
});
