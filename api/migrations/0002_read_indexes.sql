-- 0002_read_indexes.sql — index the READ hot paths so D1 scans only the rows a request returns
-- instead of the whole (wide) `files` table. Cloudflare meters "rows read" per request; the newest-
-- first feeds re-sorted every row on `id` ties and the per-row serial count re-read the table, which
-- is what pushed the read count over quota. These partial indexes make those reads bounded/index-only.
-- Idempotent, same `IF NOT EXISTS` style as 0001_init.sql, so every deploy can re-run it safely.

-- Public "next videos" feed — listReadyFiles:
--   WHERE status = 'ready' ORDER BY created_at DESC, id DESC LIMIT ?
-- The `id` tie-breaker lives INSIDE the index, so a newest-first page stops after `limit` rows on the
-- index instead of reading every ready row to re-sort ties on equal created_at values.
CREATE INDEX IF NOT EXISTS files_ready_created
  ON files(created_at DESC, id DESC)
  WHERE status = 'ready';

-- A creator's ready feed — listCreatorFiles:
--   WHERE user_id = ? AND status = 'ready' ORDER BY created_at DESC, id DESC LIMIT ?
CREATE INDEX IF NOT EXISTS files_creator_ready
  ON files(user_id, created_at DESC, id DESC)
  WHERE status = 'ready';

-- Dashboard/public list (newest sort) + the per-row `serial` upload-order count + channelTotals, all
-- scoped to "not uploading": a compact partial index keeps the ordered page and the COUNT(*) index-only
-- (no wide-table row fetches). See listDashboardFiles in db.js.
CREATE INDEX IF NOT EXISTS files_notuploading_created
  ON files(created_at DESC, id DESC)
  WHERE status != 'uploading';
