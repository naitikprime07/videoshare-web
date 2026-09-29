// API used by the Android app. Public (no login), keyed by a random device id the app generates.
import { Hono } from 'hono';
import {
  claimPlayToken,
  countIpViews,
  getFile,
  getPlayToken,
  getUser,
  incrementFileViews,
  insertPlayToken,
  insertView,
  isConstraintError,
  listCreatorFiles,
  listReadyFiles,
  upsertFileDaily,
} from './db.js';
import { dayKey, fail, fileJson, ID_RE, mediaSignature, num, playStoreUrl, randomHex, readJson, requestBase } from './util.js';

const MEDIA_URL_TTL_S = 6 * 3600;
const PLAY_TOKEN_TTL_MS = 6 * 3600_000;
const TOKEN_TTL_MS = 24 * 3600_000; // the cron sweep removes tokens past this point (see cleanup.js)
const DEVICE_RE = /^[0-9a-f-]{16,64}$/i;

export const appApi = new Hono();

// Remote config: force-update + ad unit ids can change without shipping a new app.
appApi.get('/config', (c) => c.json({
  appName: c.env.APP_NAME,
  minVersionCode: num(c.env.MIN_APP_VERSION, 1),
  playStoreUrl: playStoreUrl(c.env),
  minWatchSeconds: num(c.env.MIN_WATCH_SECONDS, 10),
  ads: {
    enabled: c.env.ADS_ENABLED === 'true',
    bannerId: c.env.AD_BANNER_ID || '',
    interstitialId: c.env.AD_INTERSTITIAL_ID || '',
  },
}));

// Open a file: info + short-lived stream URL + one-time play token (needed to count the view).
appApi.post('/file', async (c) => {
  const { id, deviceId } = await readJson(c);
  if (!ID_RE.test(id || '')) return fail(c, 400, 'Invalid link');
  if (!DEVICE_RE.test(deviceId || '')) return fail(c, 400, 'Invalid device');

  const row = await getFile(c.env, id);
  if (!row || row.status === 'uploading') return fail(c, 404, 'This video does not exist or was deleted');
  if (row.status === 'blocked') return fail(c, 451, 'This video was removed');
  const creator = await getUser(c.env, row.user_id);

  const playToken = randomHex(24);
  const now = Date.now();
  const expiresAt = Math.floor(now / 1000) + MEDIA_URL_TTL_S;
  const signature = await mediaSignature(c.env, id, expiresAt);
  await insertPlayToken(c.env, {
    id: playToken, file_id: id, device_id: deviceId.toLowerCase(), created_at: now,
    expires_at: now + TOKEN_TTL_MS,
  });

  return c.json({
    file: fileJson(c, row),
    creator: { id: row.user_id, name: creator?.name || 'Unknown' },
    streamUrl: `${requestBase(c)}/media/${id}?e=${expiresAt}&s=${signature}`,
    playToken,
    minWatchSeconds: num(c.env.MIN_WATCH_SECONDS, 10),
  });
});

// Claim a view after the user has actually watched. Rules = what makes a view "qualified".
appApi.post('/view', async (c) => {
  const { playToken, deviceId, watchedSeconds } = await readJson(c);
  const minWatch = num(c.env.MIN_WATCH_SECONDS, 10);
  const now = Date.now();

  const token = await getPlayToken(c.env, String(playToken || ''));
  if (!token || token.used) return c.json({ counted: false, reason: 'invalid_token' });
  if (token.device_id !== String(deviceId || '').toLowerCase()) return c.json({ counted: false, reason: 'device_mismatch' });
  if (now - token.created_at > PLAY_TOKEN_TTL_MS) return c.json({ counted: false, reason: 'expired' });
  // Server-side clock check: can't claim 10 s of watching 2 s after opening the file.
  if (num(watchedSeconds, 0) < minWatch || now - token.created_at < minWatch * 800) {
    return c.json({ counted: false, reason: 'too_short' });
  }

  const ip = clientIp(c);
  const day = dayKey(c.env, now);
  const sameIp = await countIpViews(c.env, token.file_id, ip, day);
  if (sameIp >= num(c.env.MAX_VIEWS_PER_IP_DAY, 3)) return c.json({ counted: false, reason: 'ip_limit' });

  // Claim the token first; 0 changes means another request already used it (atomic, no double count).
  if (!(await claimPlayToken(c.env, token.id))) return c.json({ counted: false, reason: 'invalid_token' });

  const country = c.req.header('cf-ipcountry') || null;
  try {
    await insertView(c.env, {
      file_id: token.file_id, device_id: token.device_id, day, ip, country, created_at: now,
    });
  } catch (err) {
    // The primary key {file_id, device_id, day} rejects a second view on the same day.
    if (isConstraintError(err)) return c.json({ counted: false, reason: 'already_viewed_today' });
    throw err;
  }

  await incrementFileViews(c.env, token.file_id);
  await upsertFileDaily(c.env, token.file_id, day, now);
  return c.json({ counted: true });
});

// All videos, newest first: the "more videos" list under the player. `exclude` = the video playing now.
appApi.get('/videos', async (c) => {
  const limit = Math.min(50, Math.max(1, num(c.req.query('limit'), 20)));
  const offset = Math.max(0, num(c.req.query('offset'), 0));
  const exclude = String(c.req.query('exclude') || '');
  const docs = await listReadyFiles(c.env, { limit, offset, exclude });
  return c.json({
    files: docs.slice(0, limit).map((row) => fileJson(c, row)),
    nextOffset: docs.length > limit ? offset + limit : null,
  });
});

appApi.get('/creator/:id', async (c) => {
  const id = c.req.param('id');
  if (!ID_RE.test(id)) return fail(c, 400, 'Invalid link');
  const offset = Math.max(0, num(c.req.query('offset'), 0));
  const creator = await getUser(c.env, id);
  if (!creator) return fail(c, 404, 'Creator not found');
  const docs = await listCreatorFiles(c.env, id, 30, offset);
  return c.json({
    creator: { id: creator.id, name: creator.name },
    files: docs.slice(0, 30).map((row) => fileJson(c, row)),
    nextOffset: docs.length > 30 ? offset + 30 : null,
  });
});

/**
 * Best-guess visitor IP. Behind a proxy chain, X-Forwarded-For is "client, proxy1, proxy2" —
 * the first entry is the client. On Cloudflare cf-connecting-ip is the visitor's own address,
 * which the edge sets and nobody behind it can spoof.
 */
function clientIp(c) {
  const forwarded = (c.req.header('x-forwarded-for') || '').split(',')[0].trim();
  return forwarded || c.req.header('cf-connecting-ip') || '';
}
