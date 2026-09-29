// Video playback and thumbnails. The bytes live in R2 and the Worker streams them straight from
// the binding — no presigned bucket link, no second hop, nothing to expire while someone watches.
//
// Our own `?e=<expiry>&s=<signature>` link still fronts everything: that is what protects the
// video, and it is checked here before a single byte is handed over.
import { ID_RE, mediaSignature, safeEqual } from './util.js';
import { statMedia, statThumb, streamThumb, streamVideo } from './storage.js';

export async function streamMedia(c) {
  const id = c.req.param('id');
  const expiresAt = Number(c.req.query('e'));
  if (!ID_RE.test(id) || !(expiresAt > Date.now() / 1000)) return c.text('Link expired', 403);
  if (!safeEqual(c.req.query('s') || '', await mediaSignature(c.env, id, expiresAt))) return c.text('Bad signature', 403);

  if (!(await statMedia(c.env, id))) return c.text('Not found', 404);
  // Range/seeking is answered here (206); one byte-window response may be cached for a while, the
  // player always re-asks through the signed link for the next window.
  const res = await streamVideo(c.env, id, c.req.header('Range'), c.env.MEDIA_CACHE_SECONDS);
  return res ?? c.text('Not found', 404);
}

export async function thumbnail(c) {
  const id = c.req.param('id');
  if (!ID_RE.test(id)) return c.notFound();
  const res = await streamThumb(c.env, id);
  return res ?? c.notFound();
}
