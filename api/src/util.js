export const ID_RE = /^[0-9a-f]{24}$/;

/**
 * Public id used in links (/app/<id>, /creator/<id>), same shape as DiskWala's: 24 hex characters,
 * like a MongoDB ObjectId. First 8 = creation time in seconds, last 16 = random (2^64 per second).
 */
export function newId(ms = Date.now()) {
  return Math.floor(ms / 1000).toString(16).padStart(8, '0') + randomHex(8);
}

export function randomHex(bytes = 32) {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signature for a short-lived video URL: /media/<id>?e=<expiry>&s=<sig> */
export function mediaSignature(env, fileId, expiresAt) {
  return hmacHex(signingSecret(env), `media:${fileId}:${expiresAt}`);
}

export function signingSecret(env) {
  if (!env.SIGNING_SECRET) throw new Error('SIGNING_SECRET is not set (see .env.example)');
  return env.SIGNING_SECRET;
}

const tokenMessage = (exp, jti) => `admin:${exp}:${jti}`;

/**
 * Admin session token: `<expiry-ms>.<random id>.<signature>`, signed with SIGNING_SECRET.
 * Nothing is stored server-side, so a restart does not log anyone out and a logout only needs
 * the client to drop the token. The random id keeps two logins in the same millisecond apart and
 * is the hook for a blocklist later, if you ever want one.
 */
export async function issueToken(env, ttlMs) {
  const exp = Date.now() + ttlMs;
  const jti = randomHex(8);
  return `${exp}.${jti}.${await hmacHex(signingSecret(env), tokenMessage(exp, jti))}`;
}

/** True when `token` is one we signed for the admin and has not expired. Any other text fails. */
export async function verifyToken(env, token) {
  const [expRaw, jti, sig] = String(token || '').split('.');
  const exp = Number(expRaw);
  if (!Number.isInteger(exp) || exp < Date.now() || !jti || !sig) return false;
  return safeEqual(sig, await hmacHex(signingSecret(env), tokenMessage(exp, jti)));
}

/** The token from an `Authorization: Bearer <token>` header, or '' when there is none. */
export function bearerToken(c) {
  const header = c.req.header('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

const dayFormatters = new Map();

/** Calendar date "YYYY-MM-DD" in TIMEZONE (e.g. Asia/Kolkata), so "today" matches the owner's clock. */
export function dayKey(env, ms = Date.now()) {
  const tz = env.TIMEZONE || 'UTC';
  let fmt = dayFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(tz, fmt);
  }
  return fmt.format(ms);
}

/** "2026-09-28" + (-1) → "2026-09-27" */
export function shiftDay(key, delta) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Last `count` days ending today, oldest first, with 0 for days that have no row. */
export function fillDays(todayKey, count, rows) {
  const byDay = new Map(rows.map((r) => [r.day, r.views]));
  return Array.from({ length: count }, (_, i) => {
    const day = shiftDay(todayKey, i - count + 1);
    return { day, views: byDay.get(day) || 0 };
  });
}

export function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Public base URL for share links (your domain), falls back to the current host. */
export function publicBase(c) {
  return (c.env.PUBLIC_URL || requestBase(c)).replace(/\/$/, '');
}

/**
 * Base URL for static assets (css, icons, Play badge). They live in the separate frontend project,
 * so share pages link them absolutely; falls back to this server when nothing is configured.
 */
export function assetBase(c) {
  return c.env.ASSET_BASE || c.env.WEB_ORIGIN || publicBase(c);
}

export const asset = (c, filePath) => `${assetBase(c)}${filePath}`;

const LOCAL_HOST_RE = /^(localhost|127(\.\d+){3}|10(\.\d+){3}|192\.168(\.\d+){2}|172\.(1[6-9]|2\d|3[01])(\.\d+){2}|\[::1\])$/;
const HOST_RE = /^[a-z0-9.-]+(:\d+)?$/i;

/**
 * Base URL of the host serving this request (used for API/media URLs).
 * Behind a dev tunnel (VS Code port forwarding, ngrok…) the local server sees "localhost", so the
 * tunnel's domain comes from X-Forwarded-Host. That header is only trusted on a local dev server:
 * behind a real proxy (Render, Railway, Fly) the request URL already carries your domain.
 */
export function requestBase(c) {
  const url = new URL(c.req.url);
  const header = (name) => (c.req.header(name) || '').split(',')[0].trim();
  const forwardedHost = header('x-forwarded-host');
  if (forwardedHost && HOST_RE.test(forwardedHost) && LOCAL_HOST_RE.test(url.hostname)) {
    return `${header('x-forwarded-proto') === 'http' ? 'http' : 'https'}://${forwardedHost}`;
  }
  // Tunnels that keep their own Host (cloudflared, ngrok) reach the local server over plain http.
  if (url.protocol === 'http:' && header('x-forwarded-proto') === 'https') return `https://${url.host}`;
  return url.origin;
}

export function shareUrl(c, fileId) {
  return `${publicBase(c)}/app/${fileId}`;
}

export function playStoreUrl(env, referrer) {
  const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(env.ANDROID_PACKAGE)}`;
  return referrer ? `${url}&referrer=${encodeURIComponent(referrer)}` : url;
}

/** Mongo file document → the shape the rest of the code expects (`_id` → `id`, 0/1 → boolean). */
export function fileRow(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { ...rest, id: _id, has_thumb: !!doc.has_thumb };
}

/** Shape of a file as returned by every API. */
export function fileJson(c, row) {
  return {
    id: row.id,
    name: row.name,
    size: row.size,
    mime: row.mime,
    views: row.views,
    status: row.status,
    createdAt: row.created_at,
    thumbUrl: row.has_thumb ? `${requestBase(c)}/t/${row.id}` : null,
    shareUrl: shareUrl(c, row.id),
  };
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);

export async function readJson(c) {
  try {
    return await c.req.json();
  } catch {
    return {};
  }
}

export const fail = (c, status, error) => c.json({ error }, status);
