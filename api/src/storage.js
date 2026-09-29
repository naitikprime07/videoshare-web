// Cloudflare R2 through the Worker's native bucket binding (wrangler.toml → [[r2_buckets]]).
// No keys, no endpoint, no SDK: the platform authenticates the Worker against the bucket, and
// reads through the binding cost no egress.
//
// Big files still reach the browser in 10 MB pieces. R2's native multipart upload does what the
// disk folders used to: every part is one independent PUT that can be retried on its own, the
// parts sit in the bucket invisibly until complete() joins them, and an upload nobody finished is
// aborted by the cron sweep so it never bills for stored parts.
//
// Reading streams the bytes through the Worker: /media/<id> checks its own signature here, honours
// the player's Range header, and hands back 206/200 — so seeking keeps working and the file never
// needs a public URL or a presigned link.
import { ID_RE } from './util.js';

export const PART_SIZE = 10 * 1024 * 1024; // must match the dashboard's chunk size (R2 minimum is 5 MB)

// One folder per kind, both keyed by the same 24-hex id the share links use, so a video can be found
// from its id alone and the bucket layout can change without breaking any link.
const videoKey = (id) => `videos/${guarded(id)}`;
const thumbKey = (id) => `thumbs/${guarded(id)}.jpg`;

function guarded(id) {
  if (!ID_RE.test(id || '')) throw new Error(`Bad file id: ${id}`);
  return id;
}

/** Opens a multipart upload and returns its uploadId, which the files row then carries. */
export async function startUpload(env, id, mime) {
  const { uploadId } = await env.R2.createMultipartUpload(videoKey(id), {
    httpMetadata: { contentType: mime || 'video/mp4' },
  });
  if (!uploadId) throw new Error('R2 did not return an uploadId');
  return uploadId;
}

export async function uploadPart(env, id, uploadId, partNumber, body) {
  const data = body instanceof Uint8Array ? body : new Uint8Array(body);
  if (!data.byteLength || data.byteLength > PART_SIZE) throw new Error('Bad part size');
  const upload = env.R2.resumeMultipartUpload(videoKey(id), uploadId);
  const part = await upload.uploadPart(partNumber, data);
  return { partNumber, etag: part.etag };
}

/**
 * Tells the bucket to join the parts. They must be listed in ascending order; the final size comes
 * back on the completed object (a HEAD would say the same).
 */
export async function completeUpload(env, id, uploadId, parts) {
  const upload = env.R2.resumeMultipartUpload(videoKey(id), uploadId);
  const sorted = [...parts]
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => ({ partNumber: p.partNumber, etag: p.etag }));
  const object = await upload.complete(sorted);
  const head = object?.size ? object : await env.R2.head(videoKey(id));
  return { size: head.size };
}

/** Drops the hidden parts of an upload that was never completed. Cheap, and stops them billing. */
export async function abortUpload(env, id, uploadId) {
  if (!uploadId) return;
  await env.R2.resumeMultipartUpload(videoKey(id), uploadId).abort();
}

export async function putThumb(env, id, body) {
  const data = body instanceof Uint8Array ? body : new Uint8Array(body);
  if (data.byteLength > 2 * 1024 * 1024) throw new Error('Thumbnail too large');
  await env.R2.put(thumbKey(id), data, { httpMetadata: { contentType: 'image/jpeg' } });
}

/** Both objects of one video, plus any half-finished parts, so a delete really frees the bucket. */
export async function deleteAll(env, id, uploadId = null) {
  await abortUpload(env, id, uploadId).catch(() => {});
  await Promise.all([env.R2.delete(videoKey(id)), env.R2.delete(thumbKey(id))]);
}

/** Size and type of the stored video, or null when the bucket has no such object. */
export async function statMedia(env, id) {
  const head = await env.R2.head(videoKey(id));
  return head ? { size: head.size, contentType: head.httpMetadata?.contentType, etag: head.etag } : null;
}

export async function statThumb(env, id) {
  const head = await env.R2.head(thumbKey(id));
  return head ? { size: head.size, etag: head.etag } : null;
}

/** "bytes=100-199" / "bytes=100-" / "bytes=-500" (first range only; players send one at a time). */
function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start = m[1] === '' ? null : Number(m[1]);
  let end = m[2] === '' ? null : Number(m[2]);
  if (start === null) { // "bytes=-N": the last N bytes
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  return start <= end && start < size ? { start, end } : null;
}

/**
 * Serves one object with range support: 206 with the exact byte window the player asked for, 200
 * with the whole file when it asks for everything. The signature check happened before this call —
 * nothing here decides whether the caller may watch.
 */
async function serve(env, key, rangeHeader, cacheSeconds) {
  const probe = await env.R2.head(key);
  if (!probe) return null;

  const range = parseRange(rangeHeader, probe.size);
  const object = range
    ? await env.R2.get(key, { range: { offset: range.start, length: range.end - range.start + 1 } })
    : await env.R2.get(key);
  if (!object) return null;

  const headers = {
    'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(object.size),
    // never cached beyond one window: the player must always re-ask, so a revoked link stops working
    'Cache-Control': `private, max-age=${Math.max(0, Number(cacheSeconds) || 0)}`,
  };
  if (range) {
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${probe.size}`;
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { status: 200, headers });
}

export const streamVideo = (env, id, rangeHeader, cacheSeconds) =>
  serve(env, videoKey(id), rangeHeader, cacheSeconds);

export const streamThumb = (env, id) => serve(env, thumbKey(id), null, 86400);

/**
 * Safety net for the daily cleanup: uploads the database still marks as "uploading" are the only
 * half-finished ones we know of, and the sweep aborts them there (see api/src/cleanup.js). A
 * binding cannot list multipart uploads the way the old S3 token could — an upload whose row was
 * lost manually would need the R2 dashboard to clean, which is acceptable for a single-admin app.
 */
