// One-time move of the rows that live in MongoDB Atlas into the Cloudflare D1 database.
// The Worker itself never talks to Mongo — this script runs on your machine, reads the old
// .env / .dev.vars, and writes through `wrangler d1 execute`, so it works against the real
// (--remote) or the local dev (--local) database.
//
//   node --env-file=backend/.env scripts/migrate-mongo-to-d1.mjs --remote
//   node --env-file=.dev.vars    scripts/migrate-mongo-to-d1.mjs --local   (try it first)
//
// Safe to re-run only on an EMPTY D1 (a second run on a filled one fails on duplicate ids,
// which is deliberate: it stops a half-new/half-old mix). Share links do not change: a link
// carries the file id, and the ids are copied over untouched.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const REMOTE = process.argv.includes('--remote');
const DB_NAME = 'vidshare'; // wrangler.toml database_name
const BATCH_ROWS = 500; // multi-row INSERTs, kept small enough for one D1 statement

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Run with: node --env-file=backend/.env scripts/migrate-mongo-to-d1.mjs');
  process.exit(1);
}

// ---- helpers ----

const sqlStr = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`);
const sqlNum = (v) => (v === null || v === undefined || v === '' ? 'NULL' : String(v));
const sqlBool = (v) => (v ? 1 : 0);
const ms = (v) => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber();
  return Number(v);
};

/** Runs one or many statements through wrangler, quietly, failing loudly. */
function d1(sql, { json = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'vidshare-d1-'));
  const file = path.join(dir, 'stmt.sql');
  writeFileSync(file, sql, 'utf8');
  try {
    const args = ['d1', 'execute', DB_NAME, ...(REMOTE ? ['--remote'] : ['--local']), '--file', file];
    if (json) args.push('--json');
    return execFileSync('npx', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function dumpAll(col) {
  const out = [];
  for await (const doc of col.find({})) out.push(doc);
  return out;
}

/** Writes `rows` as multi-row INSERTs of one table into a temp file and executes them. */
function insertTable(table, columns, rows, toValues) {
  for (let i = 0; i < rows.length; i += BATCH_ROWS) {
    const chunk = rows.slice(i, i + BATCH_ROWS);
    const values = chunk.map((r) => `  (${toValues(r).join(', ')})`).join(',\n');
    d1(`INSERT INTO ${table} (${columns.join(', ')}) VALUES\n${values};`);
    console.log(`  ${table}: ${Math.min(i + BATCH_ROWS, rows.length)}/${rows.length}`);
  }
  if (!rows.length) console.log(`  ${table}: empty`);
}

const countTable = (t) => {
  const out = d1(`SELECT COUNT(*) AS n FROM ${t};`, { json: true });
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  const row = parsed?.[0]?.results?.[0] ?? parsed?.results?.[0];
  return row?.n ?? 0;
};

// ---- read the old database ----

const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
await client.connect();
const db = client.db();
console.log(`reading from MongoDB: ${db.databaseName}\nwriting to D1 "${DB_NAME}" (${REMOTE ? 'remote' : 'local'})\n`);

const [users, files, playTokens, views, fileDaily] = await Promise.all([
  dumpAll(db.collection('users')),
  dumpAll(db.collection('files')),
  dumpAll(db.collection('play_tokens')),
  dumpAll(db.collection('views')),
  dumpAll(db.collection('file_daily')),
]);
await client.close();

// ---- write the new one (column order = api/migrations/0001_init.sql) ----

insertTable('users',
  ['id', 'email', 'name', 'status', 'is_owner', 'created_at'], users,
  (r) => [sqlStr(r._id), sqlStr(r.email), sqlStr(r.name), sqlStr(r.status || 'active'), sqlBool(r.is_owner), sqlNum(ms(r.created_at))]);

insertTable('files',
  ['id', 'user_id', 'name', 'size', 'mime', 'has_thumb', 'upload_id', 'status', 'views', 'created_at'], files,
  (r) => [sqlStr(r._id), sqlStr(r.user_id), sqlStr(r.name), sqlNum(ms(r.size) ?? 0), sqlStr(r.mime), sqlBool(r.has_thumb),
    sqlStr(r.upload_id ?? null), sqlStr(r.status), sqlNum(ms(r.views) ?? 0), sqlNum(ms(r.created_at))]);

insertTable('play_tokens',
  ['id', 'file_id', 'device_id', 'created_at', 'used', 'expires_at'], playTokens,
  (r) => [sqlStr(r._id), sqlStr(r.file_id), sqlStr(r.device_id), sqlNum(ms(r.created_at)), sqlBool(r.used), sqlNum(ms(r.expires_at))]);

insertTable('views',
  ['file_id', 'device_id', 'day', 'ip', 'country', 'created_at'], views,
  (r) => [sqlStr(r.file_id), sqlStr(r.device_id), sqlStr(r.day), sqlStr(r.ip ?? null), sqlStr(r.country ?? null), sqlNum(ms(r.created_at))]);

insertTable('file_daily',
  ['file_id', 'day', 'views', 'created_at'], fileDaily,
  (r) => [sqlStr(r.file_id), sqlStr(r.day), sqlNum(ms(r.views) ?? 0), sqlNum(ms(r.created_at))]);

// ---- verify: same row count on both sides ----

const expected = { users: users.length, files: files.length, play_tokens: playTokens.length, views: views.length, file_daily: fileDaily.length };
let ok = true;
console.log('\ncount check:');
for (const [table, want] of Object.entries(expected)) {
  const got = countTable(table);
  const good = got === want;
  ok &&= good;
  console.log(`  ${table.padEnd(12)} mongo=${String(want).padStart(6)} d1=${String(got).padStart(6)}  ${good ? 'OK' : 'MISMATCH'}`);
}
console.log(ok ? '\nDone — the D1 database mirrors MongoDB. Videos/thumbnails already live in R2.'
  : '\nRow counts differ — fix the tables above before cutting over.');
process.exit(ok ? 0 : 1);
