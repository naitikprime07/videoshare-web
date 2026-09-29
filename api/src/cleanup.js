// The work server.js's setInterval used to do, now called from the Worker's `scheduled` trigger
// (wrangler.toml [triggers] crons — twice a day).
import { deleteExpiredPlayTokens, findStaleUploading, deleteFile } from './db.js';
import { abortUpload } from './storage.js';

export async function cleanup(env) {
  const dayAgo = Date.now() - 86400_000;

  // Uploads the owner started and never finished: free the parts they hold in the bucket, drop the row.
  const stale = await findStaleUploading(env, dayAgo);
  for (const file of stale) {
    await abortUpload(env, file.id, file.upload_id).catch(() => {});
    await deleteFile(env, file.id);
  }
  if (stale.length) console.log(`cleanup: removed ${stale.length} abandoned upload(s)`);

  // Mongo dropped expired play tokens through its TTL index; here the sweep deletes them.
  const tokens = await deleteExpiredPlayTokens(env, Date.now());
  if (tokens.meta?.changes) console.log(`cleanup: deleted ${tokens.meta.changes} expired play token(s)`);

  return { staleUploads: stale.length };
}
