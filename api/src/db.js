// D1 access in one place: every query the API runs lives here, the route files only call these
// functions. `env.DB` is the Cloudflare D1 binding (see wrangler.toml); there is no connection to
// open — the platform hands a ready one to every request, which replaces the old Mongo client that
// server.js created at boot.
//
// The tables mirror the old MongoDB collections 1:1 (see migrations/0001_init.sql):
//   users, files, play_tokens, views, file_daily.
// Where Mongo had a TTL index or a unique index, D1 has the same promise written in SQL — an
// INSERT that violates it throws, and a DELETE in the cron sweep replaces the TTL background job.
import { newId } from './util.js';

// ---------------- data access ----------------

/** SQLite says "UNIQUE constraint failed: ..." where Mongo said code 11000. */
export const isConstraintError = (err) => /UNIQUE constraint failed/i.test(String(err?.message || err));

const rowToFile = (r) => (r ? { ...r, has_thumb: !!r.has_thumb } : null);

// ---------------- users ----------------

export const getUser = (env, id) =>
  env.DB.prepare('SELECT * FROM users WHERE id = ? AND status = ?').bind(id, 'active').first();

/** The single account that owns every video. Created on first use; its name follows CHANNEL_NAME. */
export async function ensureOwner(env) {
  const name = env.CHANNEL_NAME || env.APP_NAME;
  let owner = await env.DB.prepare('SELECT * FROM users WHERE is_owner = 1').first();
  if (!owner) {
    const id = newId();
    // INSERT OR IGNORE + read: two requests racing on the first call both end up reading the one
    // row the partial unique index allows.
    await env.DB
      .prepare('INSERT OR IGNORE INTO users (id, email, name, status, is_owner, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(id, `owner-${id}@local`, name, 'active', Date.now())
      .run();
    owner = await env.DB.prepare('SELECT * FROM users WHERE is_owner = 1').first();
  }
  if (owner.name !== name) {
    await env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, owner.id).run();
    owner.name = name;
  }
  return { id: owner.id, name: owner.name };
}

// ---------------- files ----------------

/**
 * One file row, in any status — the route code decides what "uploading" means for the caller.
 * `withSerial` adds the upload-order number the dashboard shows (#1 = the first video ever).
 */
export async function getFile(env, id, { withSerial = false } = {}) {
  // (a, b) < (c, d) is SQLite's row comparison: created first, ties broken by id — the same order
  // the Mongo $setWindowFields used.
  const serial = ', (SELECT COUNT(*) FROM files p WHERE p.status != ? AND (p.created_at, p.id) < (f.created_at, f.id)) + 1 AS serial';
  const sql = withSerial
    ? `SELECT f.*${serial} FROM files f WHERE f.id = ?`
    : 'SELECT f.* FROM files f WHERE f.id = ?';
  const binds = withSerial ? ['uploading', id] : [id];
  const row = await env.DB.prepare(sql).bind(...binds).first();
  return rowToFile(row);
}

export function insertFile(env, f) {
  return env.DB
    .prepare(`INSERT INTO files (id, user_id, name, size, mime, has_thumb, upload_id, status, views, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(f.id, f.user_id, f.name, f.size, f.mime, f.has_thumb ? 1 : 0, f.upload_id, f.status, f.views, f.created_at)
    .run();
}

/** -> the row's new state, or null when the id is gone (rename answered 404 before). */
export async function renameFile(env, id, name) {
  const { meta } = await env.DB.prepare('UPDATE files SET name = ? WHERE id = ?').bind(name, id).run();
  return meta.changes ? { id, name } : null;
}

export const setFileReady = (env, id, size) =>
  env.DB
    .prepare("UPDATE files SET status = 'ready', upload_id = NULL, size = ? WHERE id = ?")
    .bind(size, id)
    .run();

export const setFileThumb = (env, id) =>
  env.DB.prepare('UPDATE files SET has_thumb = 1 WHERE id = ?').bind(id).run();

export const incrementFileViews = (env, id) =>
  env.DB.prepare('UPDATE files SET views = views + 1 WHERE id = ?').bind(id).run();

export const deleteFile = (env, id) => env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();

/** Uploads the owner started and never finished, for the cron sweep. */
export const findStaleUploading = (env, beforeMs) =>
  env.DB
    .prepare("SELECT id, upload_id FROM files WHERE status = 'uploading' AND created_at < ? LIMIT 200")
    .bind(beforeMs)
    .all()
    .then((r) => r.results);

// ---------------- dashboard list (the old $setWindowFields/$lookup/$facet pipeline) ----------------

const SORTS = {
  newest: 'f.created_at DESC, f.id DESC',
  today: 'today_views DESC, f.created_at DESC',
  total: 'f.views DESC, f.created_at DESC',
};

/**
 * Page of videos with their serial (upload order, computed over every video before the search
 * filter — exactly what the Mongo window function did), today's count joined from file_daily, and
 * the filtered total in every row, so the caller knows whether a next page exists.
 */
export async function listDashboardFiles(env, { sort, search, today, offset, limit }) {
  const order = SORTS[sort] || SORTS.newest;
  const where = ["f.status != 'uploading'", ...(search ? ['LOWER(f.name) LIKE ?'] : [])];
  const searchBinds = search ? [`%${search}%`] : [];
  const sql = `
    SELECT f.*,
           (SELECT COUNT(*) FROM files p
             WHERE p.status != 'uploading' AND (p.created_at, p.id) < (f.created_at, f.id)) + 1 AS serial,
           COALESCE(fd.views, 0) AS today_views,
           COUNT(*) OVER () AS total
    FROM files f
    LEFT JOIN file_daily fd ON fd.file_id = f.id AND fd.day = ?
    WHERE ${where.join(' AND ')}
    ORDER BY ${order}
    LIMIT ? OFFSET ?`;
  const { results } = await env.DB
    .prepare(sql)
    .bind(today, ...searchBinds, limit + 1, offset)
    .all();
  const total = results[0]?.total || 0;
  const rows = results.slice(0, limit).map(rowToFile);
  return { rows, total };
}

// ---------------- app list pages ----------------

/** Newest ready videos, one page; `exclude` skips the video currently playing. limit+1 read, so
 * the caller can say "there is more" without a second count query. */
export async function listReadyFiles(env, { limit, offset, exclude }) {
  const sql = `SELECT * FROM files
    WHERE status = 'ready' AND (? = '' OR id != ?)
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`;
  const { results } = await env.DB
    .prepare(sql)
    .bind(exclude || '', exclude || '', limit + 1, offset)
    .all();
  return results.map(rowToFile);
}

export async function listCreatorFiles(env, userId, limit, offset) {
  const { results } = await env.DB
    .prepare("SELECT * FROM files WHERE user_id = ? AND status = 'ready' ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
    .bind(userId, limit + 1, offset)
    .all();
  return results.map(rowToFile);
}

// ---------------- channel totals ----------------

export const channelDailySeries = async (env, fromDay) =>
  (await env.DB
    .prepare('SELECT day, SUM(views) AS views FROM file_daily WHERE day >= ? GROUP BY day ORDER BY day')
    .bind(fromDay)
    .all()).results;

export const channelLast7 = async (env, fromDay) =>
  (await env.DB.prepare('SELECT COALESCE(SUM(views), 0) AS views FROM file_daily WHERE day >= ?').bind(fromDay).first()).views;

export const channelTotals = (env) =>
  env.DB
    .prepare("SELECT COUNT(*) AS count, COALESCE(SUM(views), 0) AS views FROM files WHERE status != 'uploading'")
    .first();

export const fileDailyRows = async (env, fileId, fromDay) =>
  (await env.DB
    .prepare('SELECT day, views FROM file_daily WHERE file_id = ? AND day >= ? ORDER BY day')
    .bind(fileId, fromDay)
    .all()).results;

// ---------------- play tokens ----------------

export const insertPlayToken = (env, t) =>
  env.DB
    .prepare('INSERT INTO play_tokens (id, file_id, device_id, created_at, used, expires_at) VALUES (?, ?, ?, ?, 0, ?)')
    .bind(t.id, t.file_id, t.device_id, t.created_at, t.expires_at)
    .run();

export const getPlayToken = (env, id) =>
  env.DB.prepare('SELECT * FROM play_tokens WHERE id = ?').bind(id).first();

/** The atomic claim the old findOneAndUpdate({_id, used:false}) was: 1 change means we won the race. */
export async function claimPlayToken(env, id) {
  const { meta } = await env.DB.prepare('UPDATE play_tokens SET used = 1 WHERE id = ? AND used = 0').bind(id).run();
  return meta.changes === 1;
}

export const deletePlayTokensForFile = (env, fileId) =>
  env.DB.prepare('DELETE FROM play_tokens WHERE file_id = ?').bind(fileId).run();

/** Replaces MongoDB's TTL index: the cron deletes what is past its expiry. */
export const deleteExpiredPlayTokens = (env, nowMs) =>
  env.DB.prepare('DELETE FROM play_tokens WHERE expires_at < ?').bind(nowMs).run();

// ---------------- views + daily counts ----------------

export const countIpViews = async (env, fileId, ip, day) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM views WHERE file_id = ? AND ip = ? AND day = ?').bind(fileId, ip, day).first()).n;

/** Throws a constraint error on a second view for the same file+device+day (the old 11000). */
export const insertView = (env, v) =>
  env.DB
    .prepare('INSERT INTO views (file_id, device_id, day, ip, country, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(v.file_id, v.device_id, v.day, v.ip, v.country, v.created_at)
    .run();

export const deleteViewsForFile = (env, fileId) => env.DB.prepare('DELETE FROM views WHERE file_id = ?').bind(fileId).run();

/** The $setOnInsert + $inc upsert, written the SQLite way. */
export const upsertFileDaily = (env, fileId, day, nowMs) =>
  env.DB
    .prepare(`INSERT INTO file_daily (file_id, day, views, created_at) VALUES (?, ?, 1, ?)
              ON CONFLICT (file_id, day) DO UPDATE SET views = views + 1`)
    .bind(fileId, day, nowMs)
    .run();

export const deleteFileDaily = (env, fileId) => env.DB.prepare('DELETE FROM file_daily WHERE file_id = ?').bind(fileId).run();

// ---------------- delete a file everywhere (D1 batch = one implicit transaction) ----------------

export function deleteFileEverywhere(env, id) {
  return env.DB.batch([
    env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id),
    env.DB.prepare('DELETE FROM file_daily WHERE file_id = ?').bind(id),
    env.DB.prepare('DELETE FROM views WHERE file_id = ?').bind(id),
    env.DB.prepare('DELETE FROM play_tokens WHERE file_id = ?').bind(id),
  ]);
}
