# VidShare — one repo, one Cloudflare Worker

Landing page + admin dashboard (static frontend) **and** the API, media streaming and the
server-rendered share pages (Hono Worker) deploy together as **one** Cloudflare Worker. No second
repo, no separate Node host, no CORS: the frontend and `/api` share one origin.

```
videoshare-web/
├── wrangler.toml            the whole app in one file: assets + R2 + D1 + config vars + cron
├── api/                     the Hono app (was backend/src)
│   ├── src/                routes: index, app-api, dashboard-api, auth, media, pages, util
│   ├── src/db.js            D1 (SQLite) queries            ← was MongoDB
│   ├── src/storage.js       native R2 binding              ← was the AWS S3 SDK
│   ├── src/cleanup.js        cron sweep (abandoned uploads, expired play tokens)
│   └── migrations/          0001_init.sql — the tables the Mongo collections became
├── worker/index.js          Worker entry: fetch + scheduled
├── frontend/                static landing + dashboard (served by the assets binding)
├── scripts/                 migrate-mongo-to-d1.mjs — one-time data move (Mongo → D1)
└── test/e2e.mjs             full end-to-end check, run against `wrangler dev`
```

Storage: videos and thumbnails live in **R2**, counts/rows live in **D1**. Nothing is kept on a
server, and reads through the Worker cost no egress.

## Requirements

- Node 20+ (uses `node --env-file`), `npm`
- A Cloudflare account with **R2** enabled, and `npx wrangler` (installed as a dev dependency)

## First-time setup (once)

```bash
npm install

npx wrangler login

# 1. D1 database (the relational store that replaced MongoDB)
npx wrangler d1 create vidshare
#    → copy the returned database_id into wrangler.toml [[d1_databases]].database_id

# 2. R2 bucket (rename in wrangler.toml to match, or use the name you already have)
npx wrangler r2 bucket create vidshare-media

# 3. create the tables in the real database
npm run db:migrate            # wrangler d1 migrations apply vidshare --remote

# 4. secrets (they never touch git)
npx wrangler secret put SIGNING_SECRET     # any long random string
npx wrangler secret put ADMIN_PASSWORD     # the dashboard password
npx wrangler secret put API_KEY            # second lock on uploads; empty to skip

# 5. ship it
npx wrangler deploy
```

`wrangler deploy` gives you a `*.workers.dev` URL. Add your own domain on the Workers **Triggers**
tab; set `PUBLIC_URL` in `wrangler.toml` to it so share links and App Links use your domain.

## Local development

```bash
cp .dev.vars.example .dev.vars      # fill SIGNING_SECRET / ADMIN_PASSWORD / API_KEY
npm run db:migrate:local            # build the tables in the local D1 simulator
npm run dev                         # wrangler dev → http://127.0.0.1:8787  (frontend + API, one origin)
npm run test:e2e                    # in another terminal: the full flow against the dev server
```

`wrangler dev` runs D1, R2 and the static assets locally, so uploads/playback/stats all work
without a Cloudflare account. The secrets come from `.dev.vars`; config values come from the
`[vars]` block in `wrangler.toml`.

## Migrating existing data (MongoDB → D1, one-time)

If you already ran the old Node + MongoDB backend and want to keep your rows (users, files, view
counts), run the mover. It reads your Atlas connection and writes through wrangler into D1. The
videos/thumbnails are already in R2 and are untouched, and share links keep working because the
file ids are copied over as-is.

```bash
# preview into the local simulator first, then do it for real
node --env-file=.dev.vars        scripts/migrate-mongo-to-d1.mjs --local
node --env-file=backend/.env     scripts/migrate-mongo-to-d1.mjs --remote
```

Run it once against an empty D1. It prints a per-table row count check (Mongo vs D1) at the end.
Set `MONGODB_URI` in the env file you pass.

## Config reference

Everything is in `wrangler.toml`:

- `[vars]` — non-secret settings (APP_NAME, TIMEZONE, view rules, ad unit ids, Android/iOS link
  config …). Edit and `npx wrangler deploy`.
- **secrets** — `SIGNING_SECRET`, `ADMIN_PASSWORD`, `API_KEY`, set with `wrangler secret put`.
- **bindings** — `DB` (D1), `R2` (bucket), `ASSETS` (the frontend folder). The R2 keys, account id
  and bucket-name env vars the old backend needed are gone: the Worker is authenticated to the
  bucket by the binding.

## How requests are routed

`assets` serves any real file under `frontend/` (the landing page, `/dashboard/`, `share.css`,
`config.js`). Every other path reaches the Hono app: `/api/*`, `/media/:id`, `/t/:id`, `/app/:id`,
`/creator/:id`, `/privacy`, `/.well-known/*`, `/robots.txt`. `/privacy` uses `run_worker_first` so
the Worker's dynamic page (with the configured app name and support email) wins over the static
folder.

## Notes and limits

- Workers upload body limit is 100 MB (free) / 500 MB (paid) — uploads stay well under that because
  the dashboard sends 10 MB chunks.
- The abandoned-upload / expired-token sweep that the old `server.js` ran on a timer is now a cron
  (`[triggers] crons`, `worker/index.js` `scheduled`). Trigger it locally with
  `curl http://127.0.0.1:8787/cdn-cgi/local/scheduled`.
- `backend/` (the old Node + Mongo project) is git-ignored and NOT part of this repo. It is kept
  on disk only so the one-time migration can read `backend/.env`; once you have migrated, delete
  it and retire the MongoDB cluster.
