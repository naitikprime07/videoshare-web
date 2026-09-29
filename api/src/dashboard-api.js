// Owner dashboard API: upload, list, rename, delete, and date-wise views.
// Admin-only: every route below requires the token from POST /api/auth/login (see auth.js), and the
// password is read from the ADMIN_PASSWORD secret, so there is no account data in the database.
// The four upload routes additionally need the shared `X-Api-Key` header (API_KEY), because writing
// files to the bucket is the only thing here an attacker could actually abuse.
import { Hono } from "hono";
import { apiKey, guard } from "./auth.js";
import {
  channelDailySeries,
  channelLast7,
  channelTotals,
  deleteFileEverywhere,
  ensureOwner,
  fileDailyRows,
  getFile,
  insertFile,
  listDashboardFiles,
  renameFile,
  setFileReady,
  setFileThumb,
} from "./db.js";
import {
  completeUpload,
  deleteAll,
  PART_SIZE,
  putThumb,
  startUpload,
  uploadPart,
} from "./storage.js";
import {
  dayKey,
  fail,
  fileJson,
  fillDays,
  ID_RE,
  newId,
  num,
  readJson,
  shiftDay,
} from "./util.js";

export const dashboard = new Hono();

// Checked before anything else, so an anonymous caller never reaches a route handler or the bucket.
dashboard.use("*", guard);

dashboard.use("*", async (c, next) => {
  c.set("owner", await ensureOwner(c.env));
  await next();
});

// ---- Totals for the whole channel ----

dashboard.get("/stats", async (c) => {
  const days = Math.min(365, Math.max(7, num(c.req.query("days"), 30)));
  const today = dayKey(c.env);
  const from = shiftDay(today, -(days - 1));
  const [series, last7, totals] = await Promise.all([
    channelDailySeries(c.env, from),
    channelLast7(c.env, shiftDay(today, -6)),
    channelTotals(c.env),
  ]);
  const daily = fillDays(today, days, series);
  return c.json({
    channel: c.get("owner").name,
    today: daily.at(-1).views,
    last7,
    totalViews: totals.views,
    files: totals.count,
    days: daily,
  });
});

// ---- Videos ----

dashboard.get("/files", async (c) => {
  const limit = Math.min(100, num(c.req.query("limit"), 50));
  const offset = Math.max(0, num(c.req.query("offset"), 0));
  const sort = String(c.req.query("sort") || "newest");
  const search = String(c.req.query("q") || "")
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
    files: rows.map((row) => ({
      ...fileJson(c, row),
      serial: row.serial,
      todayViews: row.today_views,
    })),
    nextOffset: offset + rows.length < total ? offset + limit : null,
  });
});

// Date-wise views of one video.
dashboard.get("/files/:id/stats", async (c) => {
  const file = await findFile(c);
  if (!file) return fail(c, 404, "Video not found");
  const days = Math.min(365, Math.max(7, num(c.req.query("days"), 30)));
  const today = dayKey(c.env);
  const rows = await fileDailyRows(c.env, file.id, shiftDay(today, -(days - 1)));
  const daily = fillDays(today, days, rows);
  return c.json({
    file: fileJson(c, file),
    today: daily.at(-1).views,
    yesterday: daily.at(-2).views,
    last7: daily.slice(-7).reduce((sum, d) => sum + d.views, 0),
    total: file.views,
    days: daily,
  });
});

dashboard.patch("/files/:id", async (c) => {
  const { name } = await readJson(c);
  const clean = String(name || "")
    .trim()
    .slice(0, 200);
  if (!clean) return fail(c, 400, "Name is required");
  const renamed = await renameFile(c.env, c.req.param("id"), clean);
  if (!renamed) return fail(c, 404, "Video not found");
  return c.json({ ok: true });
});

dashboard.delete("/files/:id", async (c) => {
  const file = await findFile(c, true);
  if (!file) return fail(c, 404, "Video not found");
  // Parts still in the bucket, the finished video and the thumbnail, in one call.
  await deleteAll(c.env, file.id, file.upload_id);
  await deleteFileEverywhere(c.env, file.id);
  return c.json({ ok: true });
});

// ---- Upload: start → parts → complete (+ optional thumbnail) ----
// The only routes behind `apiKey` as well as the token: a leaked password or a stolen token alone
// cannot fill your bucket.
dashboard.post("/uploads", apiKey, async (c) => {
  const { name, size, mime } = await readJson(c);
  const maxBytes = num(c.env.MAX_UPLOAD_MB, 4096) * 1024 * 1024;
  if (!String(mime || "").startsWith("video/"))
    return fail(c, 400, "Only video files can be uploaded");
  if (!(size > 0) || size > maxBytes)
    return fail(c, 400, `File must be smaller than ${c.env.MAX_UPLOAD_MB} MB`);

  const id = newId();
  const uploadId = await startUpload(c.env, id, mime);
  await insertFile(c.env, {
    id,
    user_id: c.get("owner").id,
    name: String(name || "Untitled").slice(0, 200),
    size,
    mime,
    has_thumb: false,
    upload_id: uploadId,
    status: "uploading",
    views: 0,
    created_at: Date.now(),
  });

  return c.json({
    fileId: id,
    partSize: PART_SIZE,
    partCount: Math.ceil(size / PART_SIZE),
  });
});

dashboard.put("/uploads/:id/parts/:part", apiKey, async (c) => {
  const file = await findFile(c, true);
  if (!file || file.status !== "uploading" || !file.upload_id)
    return fail(c, 404, "Upload not found");
  const partNumber = num(c.req.param("part"), 0);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000)
    return fail(c, 400, "Bad part number");

  const body = await c.req.arrayBuffer();
  if (!body.byteLength || body.byteLength > PART_SIZE)
    return fail(c, 400, "Bad part size");
  const part = await uploadPart(c.env, file.id, file.upload_id, partNumber, body);
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

dashboard.post("/uploads/:id/complete", apiKey, async (c) => {
  const file = await findFile(c, true);
  if (!file || file.status !== "uploading" || !file.upload_id)
    return fail(c, 404, "Upload not found");
  const { parts } = await readJson(c);
  if (!Array.isArray(parts) || !parts.length)
    return fail(c, 400, "No parts uploaded");

  const sorted = parts
    .map((p) => ({ partNumber: Number(p.partNumber), etag: String(p.etag) }))
    .sort((a, b) => a.partNumber - b.partNumber);
  const { size } = await completeUpload(c.env, file.id, file.upload_id, sorted);
  await setFileReady(c.env, file.id, size);

  return c.json({
    file: fileJson(c, { ...file, status: "ready", size, upload_id: null }),
  });
});

dashboard.put("/uploads/:id/thumb", apiKey, async (c) => {
  const file = await findFile(c, true);
  if (!file) return fail(c, 404, "Video not found");
  const body = await c.req.arrayBuffer();
  if (!body.byteLength || body.byteLength > 2 * 1024 * 1024)
    return fail(c, 400, "Thumbnail must be under 2 MB");
  await putThumb(c.env, file.id, body);
  await setFileThumb(c.env, file.id);
  return c.json({ ok: true });
});

async function findFile(c, includeUploading = false) {
  const id = c.req.param("id");
  // Bucket keys are built from this id, so an out-of-shape id is rejected before any storage call.
  if (!ID_RE.test(id)) return null;
  const doc = await getFile(c.env, id);
  return doc && (includeUploading || doc.status !== "uploading") ? doc : null;
}
