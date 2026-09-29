// End-to-end test against a running app.
//   npm run dev                               (repo root: wrangler dev, one origin for FE + API)
//   npm run test:e2e                          (in another terminal)
// The frontend and the API now share one origin (the Worker serves the static files too), so BASE
// covers both. Two locks from the env, each on its own part of the admin API: every dashboard route
// needs the token from a login with ADMIN_USERNAME / ADMIN_PASSWORD, and the upload routes additionally
// need the `X-Api-Key` header (API_KEY). The public /api/app/* calls stay open, or a viewer with a
// share link could never play the video. The defaults below are the development values in .dev.vars;
// pass the real ones to test another server.
// The view rules use the app's own MIN_WATCH_SECONDS (read from /api/app/config), so the two sides
// can never disagree. Needs test/sample.mp4 (any MP4 > 10 MB so upload uses several parts).
// Videos go to and come from the R2 bucket the Worker is bound to; under `wrangler dev` that is the
// local simulator, so nothing leaves your machine unless you point BASE at a deployed Worker.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const BASE = (process.env.BASE || 'http://127.0.0.1:8787').replace(/\/$/, ''); // wrangler dev default port
const FE = (process.env.FE_BASE || BASE).replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';
const API_KEY = process.env.API_KEY || '9a5d22317c73e10903e025a1ca294e649be792237b542143';
const KEY = { 'X-Api-Key': API_KEY };
// The probes that are meant to fail pretend to be another visitor, so they never use up the retry
// budget of the address this test logs in from (8 refusals in 15 minutes would block the login).
const OUTSIDER = { 'X-Forwarded-For': '203.0.113.7' };
const WATCH = (await (await fetch(`${BASE}/api/app/config`)).json()).minWatchSeconds;
let token = ''; // set after the login step; sent on every dashboard call

// opts.noKey drops the X-Api-Key, opts.headers adds (or overrides) any header on that one call.
async function call(method, path, body, raw = false, opts = {}) {
  const headers = { ...(opts.noKey ? {} : KEY), ...opts.headers };
  if (token && path.startsWith('/api/dashboard')) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (body && !(body instanceof Uint8Array)) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const step = (name) => console.log(`✔ ${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- what is open, what is behind the token, what is behind the key too ---
let res;
res = await fetch(`${BASE}/api/app/config`); // no key, no token
assert.equal(res.status, 200, 'the public app API needs neither key nor token');
res = await fetch(`${BASE}/app/000000000000000000000000`);
assert.equal(res.status, 404, 'share pages stay reachable too (404 = unknown video)');
res = await fetch(`${BASE}/api/dashboard/uploads`, {
  method: 'POST', headers: { ...OUTSIDER, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'nobody', size: 1024, mime: 'video/mp4' }),
});
assert.equal(res.status, 401, 'an upload with no token and no key is refused');
step('public API + share page open, anonymous upload 401');

// --- admin login: the dashboard API is closed until the right password comes from the env ---
let r = await call('GET', '/api/dashboard/stats', null, false, { noKey: true });
assert.equal(r.status, 401, 'anonymous callers get nothing from the dashboard API');
r = await call('POST', '/api/auth/login', { username: ADMIN_USER, password: 'definitely-wrong' });
assert.equal(r.status, 401, 'a wrong password is refused');
r = await call('POST', '/api/auth/login', { username: 'someone-else', password: ADMIN_PASS });
assert.equal(r.status, 401, 'a wrong username is refused');
r = await call('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS }, false, { noKey: true });
assert.equal(r.status, 200, 'login needs the password alone — the key is only for uploads');
assert.ok(r.data.token && r.data.expiresAt > Date.now(), 'login returns a token with a lifetime');
token = r.data.token;
r = await call('GET', '/api/dashboard/stats', null, false, { noKey: true });
assert.equal(r.status, 200, 'the admin token alone opens the read routes, no key needed');
const forged = `${Date.now() + 3600_000}.aaaaaaaaaaaaaaaa.${'0'.repeat(64)}`;
res = await fetch(`${BASE}/api/dashboard/stats`, { headers: { ...OUTSIDER, Authorization: `Bearer ${forged}` } });
assert.equal(res.status, 401, 'a hand-made token with the same shape is still rejected');
r = await call('GET', '/api/app/videos');
assert.equal(r.status, 200, 'the public app API needs no login and no key');
step('login: 401 anonymous/wrong password/wrong username/forged token, 200 for the admin');

// --- uploads are the one thing behind the shared key as well ---
r = await call('POST', '/api/dashboard/uploads', { name: 'no key', size: 1024, mime: 'video/mp4' },
  false, { noKey: true, headers: OUTSIDER });
assert.equal(r.status, 401, 'an upload without X-Api-Key is refused');
assert.match(r.data.error, /API key/, JSON.stringify(r.data));
r = await call('POST', '/api/dashboard/uploads', { name: 'wrong key', size: 1024, mime: 'video/mp4' },
  false, { headers: { ...OUTSIDER, 'X-Api-Key': 'wrong-key' } });
assert.equal(r.status, 401, 'an upload with a wrong X-Api-Key is refused');
r = await call('DELETE', '/api/dashboard/files/000000000000000000000000', null, false, { noKey: true });
assert.equal(r.status, 404, 'deleting needs the token only (404 = unknown video, not 401)');
step('api key: upload 401 without/with wrong key, other dashboard routes need the token only');

// --- the dashboard page itself is served by the Worker's assets binding, same origin ---
r = await call('GET', '/api/dashboard/stats');
assert.equal(r.status, 200, JSON.stringify(r.data));
const before = r.data;
assert.equal(before.days.length, 30);
assert.ok(!('earningsUsd' in before), 'no revenue in the dashboard');
res = await fetch(`${FE}/dashboard/`);
assert.equal(res.status, 200, 'the dashboard html is served on the same origin');
assert.ok((await res.text()).includes('/dashboard/dashboard.js'));
step('stats API for the admin, dashboard html served by the Worker');

// --- upload in parts ---
const video = new Uint8Array(await readFile(new URL('./sample.mp4', import.meta.url)));
r = await call('POST', '/api/dashboard/uploads', { name: 'notes.pdf', size: 10, mime: 'application/pdf' });
assert.equal(r.status, 400);
const name = `E2E video ${Date.now()}`;
r = await call('POST', '/api/dashboard/uploads', { name, size: video.length, mime: 'video/mp4' });
assert.equal(r.status, 200, JSON.stringify(r.data));
const { fileId, partSize, partCount } = r.data;
assert.match(fileId, /^[0-9a-f]{24}$/, 'ids look like DiskWala ids (24 hex characters)');
assert.ok(Math.abs(parseInt(fileId.slice(0, 8), 16) - Date.now() / 1000) < 120, 'id starts with the upload time');
assert.ok(partCount >= 2, 'sample.mp4 should be > 10 MB to test multipart');
const parts = [];
for (let i = 0; i < partCount; i++) {
  r = await call('PUT', `/api/dashboard/uploads/${fileId}/parts/${i + 1}`, video.subarray(i * partSize, (i + 1) * partSize));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  parts.push(r.data);
}
r = await call('POST', `/api/dashboard/uploads/${fileId}/complete`, { parts: parts.reverse() });
assert.equal(r.status, 200, JSON.stringify(r.data));
assert.equal(r.data.file.size, video.length);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
r = await call('PUT', `/api/dashboard/uploads/${fileId}/thumb`, jpeg);
assert.equal(r.status, 200);
r = await call('GET', `/api/dashboard/files?q=${encodeURIComponent(name.toLowerCase())}`);
assert.equal(r.data.files.length, 1);
const listed = r.data.files[0];
assert.equal(listed.id, fileId);
assert.ok(listed.shareUrl.endsWith(`/app/${fileId}`));
assert.equal(listed.todayViews, 0);
assert.ok(listed.serial >= 1);
step(`upload ${(video.length / 1e6).toFixed(1)} MB in ${partCount} parts + thumbnail → link ${listed.shareUrl}`);

// --- share page, channel page, app-link files ---
res = await call('GET', `/app/${fileId}`, null, true);
let html = await res.text();
assert.equal(res.status, 200);
assert.ok(html.includes('Shared File') && html.includes('video/mp4'));
assert.ok(!html.includes(name), 'the name is partly hidden on the web page');
assert.ok(html.includes(`/app/${fileId}#Intent;scheme=https;package=`));
assert.ok(html.includes(encodeURIComponent(encodeURIComponent(`file_id=${fileId}`))), 'Play Store fallback carries the file id');
assert.ok(!html.includes('/dashboard/'), 'public pages do not link to the dashboard');
res = await call('GET', '/app/000000000000000000000000', null, true);
assert.equal(res.status, 404);
res = await call('GET', '/app/not-a-real-id', null, true);
assert.equal(res.status, 404);
r = await call('GET', '/.well-known/assetlinks.json');
assert.equal(r.data[0].relation[0], 'delegate_permission/common.handle_all_urls');
step('share page, assetlinks.json');

// --- app opens the video and streams it ---
const deviceId = crypto.randomUUID();
r = await call('POST', '/api/app/file', { id: fileId, deviceId });
assert.equal(r.status, 200, JSON.stringify(r.data));
const { streamUrl, playToken } = r.data;
res = await call('GET', `/creator/${r.data.creator.id}`, null, true);
assert.equal(res.status, 200);
res = await fetch(streamUrl, { redirect: 'manual' });
assert.equal(res.status, 200, 'the Worker streams the video straight from R2');
assert.equal(res.headers.get('content-length'), String(video.length));
assert.equal(res.headers.get('accept-ranges'), 'bytes');
res = await fetch(streamUrl, { headers: { Range: 'bytes=100-199' } });
assert.equal(res.status, 206, 'the Worker answers the ranged request the player sends to seek');
assert.equal(res.headers.get('content-range'), `bytes 100-199/${video.length}`);
assert.deepEqual(new Uint8Array(await res.arrayBuffer()), video.subarray(100, 200));
res = await fetch(streamUrl.replace(/s=[0-9a-f]+/, 's=' + '0'.repeat(64)));
assert.equal(res.status, 403, 'a bad signature is refused before a single byte is read');
step('app file info + signed link, streamed bytes, ranged seek, signature guard');

// --- "more videos" list for the app ---
r = await call('GET', '/api/app/videos?limit=50');
assert.equal(r.status, 200);
assert.ok(r.data.files.some((f) => f.id === fileId), 'new upload is in the list');
assert.ok(r.data.files.every((f) => f.status === 'ready'));
r = await call('GET', `/api/app/videos?limit=50&exclude=${fileId}`);
assert.ok(!r.data.files.some((f) => f.id === fileId), 'the playing video is left out');
r = await call('GET', '/api/app/videos?limit=1');
assert.equal(r.data.files.length, 1);
if (r.data.nextOffset !== null) {
  const page2 = await call('GET', `/api/app/videos?limit=1&offset=${r.data.nextOffset}`);
  assert.notEqual(page2.data.files[0]?.id, r.data.files[0].id, 'paging moves forward');
}
step('video list API (all videos, exclude, paging)');

// --- view counting rules ---
r = await call('POST', '/api/app/view', { playToken, deviceId, watchedSeconds: WATCH });
assert.equal(r.data.reason, 'too_short');
await sleep(WATCH * 1000 + 200);
r = await call('POST', '/api/app/view', { playToken, deviceId: crypto.randomUUID(), watchedSeconds: WATCH });
assert.equal(r.data.reason, 'device_mismatch');
r = await call('POST', '/api/app/view', { playToken, deviceId, watchedSeconds: WATCH });
assert.equal(r.data.counted, true, JSON.stringify(r.data));
r = await call('POST', '/api/app/view', { playToken, deviceId, watchedSeconds: WATCH });
assert.equal(r.data.reason, 'invalid_token');
r = await call('POST', '/api/app/file', { id: fileId, deviceId });
await sleep(WATCH * 1000 + 200);
r = await call('POST', '/api/app/view', { playToken: r.data.playToken, deviceId, watchedSeconds: WATCH });
assert.equal(r.data.reason, 'already_viewed_today');
step('view rules: too short, wrong device, single-use token, one per device per day');

// --- date-wise views ---
r = await call('GET', `/api/dashboard/files/${fileId}/stats?days=7`);
assert.equal(r.status, 200);
assert.equal(r.data.today, 1);
assert.equal(r.data.total, 1);
assert.equal(r.data.last7, 1);
assert.equal(r.data.days.length, 7);
assert.equal(r.data.days.at(-1).views, 1);
r = await call('GET', `/api/dashboard/files?sort=today`);
assert.equal(r.data.files.find((f) => f.id === fileId).todayViews, 1);
r = await call('GET', '/api/dashboard/stats');
assert.equal(r.data.today, before.today + 1);
assert.equal(r.data.totalViews, before.totalViews + 1);
step(`date-wise views: video today=1, channel today ${before.today} → ${r.data.today}`);

// --- rename + delete ---
r = await call('PATCH', `/api/dashboard/files/${fileId}`, { name: 'Renamed' });
assert.equal(r.status, 200);
r = await call('DELETE', `/api/dashboard/files/${fileId}`);
assert.equal(r.status, 200);
res = await call('GET', `/app/${fileId}`, null, true);
assert.equal(res.status, 404);
// The play link is still correctly signed, so a 404 here can only mean the object left the bucket.
res = await fetch(streamUrl, { redirect: 'manual' });
assert.equal(res.status, 404, 'the video is really gone from R2 after the delete');
r = await call('GET', '/api/dashboard/stats');
assert.equal(r.data.totalViews, before.totalViews);
step('rename, delete');

console.log('\nAll end-to-end checks passed.');
