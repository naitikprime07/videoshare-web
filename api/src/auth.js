// Admin login. One account, whose username and password come from the environment (ADMIN_USERNAME /
// ADMIN_PASSWORD), so there is no signup, no "forgot password" and no user table to secure.
// A successful login returns a signed session token; every /api/dashboard route needs it as a
// Bearer token — see `guard` below, used by dashboard-api.js. `apiKey` below is a second, shared
// X-Api-Key lock, put only on the upload endpoints (see dashboard-api.js) — reading stats, renaming
// or deleting needs the token alone. Pages, /media, /t and /api/app stay open on purpose: those are
// what viewers and the Android app reach, and a key there would have to be published publicly.
import { Hono } from "hono";
import {
  bearerToken,
  fail,
  issueToken,
  num,
  readJson,
  safeEqual,
  verifyToken,
} from "./util.js";

export const auth = new Hono();

// Slows down guessing — key or password, one IP gets a handful of tries per window either way.
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 8;
const attempts = new Map();

/** The visitor's own address: Cloudflare's edge sets cf-connecting-ip and nobody behind it can
 * spoof it; X-Forwarded-For is the fallback for a dev server in front of another proxy. Only used
 * to count failed tries, never trusted for anything else, so a spoofed header at worst gets
 * someone else's counter. */
function clientIp(c) {
  const forwarded = (c.req.header("x-forwarded-for") || "")
    .split(",")[0]
    .trim();
  return forwarded || c.req.header("cf-connecting-ip") || "unknown";
}

function blocked(ip) {
  const entry = attempts.get(ip);
  if (!entry) return false;
  // The window passed: start over, this attempt is free.
  if (Date.now() - entry.first > WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function noteFailure(ip) {
  const entry = attempts.get(ip);
  if (entry && Date.now() - entry.first <= WINDOW_MS) entry.count++;
  else attempts.set(ip, { count: 1, first: Date.now() });
  // Keep the table small on a server that runs for months.
  if (attempts.size > 5000) {
    for (const [key, value] of attempts)
      if (Date.now() - value.first > WINDOW_MS) attempts.delete(key);
  }
}

/** Refuse `tries` bad calls from this IP in the current window (shared by the key and the password). */
function refused(c, tries) {
  const ip = clientIp(c);
  if (blocked(ip))
    return fail(c, 429, "Too many attempts, please try again in a few minutes");
  if (tries > 0) noteFailure(ip);
  return null;
}

/**
 * POST /api/auth/login  { username, password }
 *   → 200 { token, expiresAt, username }      admin may now call every dashboard route
 *   → 401 wrong credentials, 429 too many attempts, 400 nothing sent
 */
auth.post("/login", async (c) => {
  const body = await readJson(c);
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!username && !password)
    return fail(c, 400, "Username and password are required");

  // Both checks always run (`&`, not `&&`), so a right username and a wrong password cost the
  // same time as two wrong ones and cannot be told apart from outside.
  const ok =
    safeEqual(username, c.env.ADMIN_USERNAME) &
    safeEqual(password, c.env.ADMIN_PASSWORD);
  if (!ok) return refused(c, 10) || fail(c, 401, "Wrong username or password");

  // Right password: forget the earlier refusals, so a typo does not haunt the next login.
  attempts.delete(clientIp(c));

  const ttlMs = Math.max(1, num(c.env.ADMIN_TOKEN_TTL_HOURS, 12)) * 3600_000;
  return c.json({
    token: await issueToken(c.env, ttlMs),
    expiresAt: Date.now() + ttlMs,
    username: c.env.ADMIN_USERNAME,
  });
});

// Lets a client ask "is my saved token still usable?" before showing the login form again.
auth.get("/session", async (c) =>
  (await verifyToken(c.env, bearerToken(c)))
    ? c.json({ ok: true, username: c.env.ADMIN_USERNAME })
    : fail(c, 401, "Login required"),
);

/**
 * Dashboard middleware: passes only on a valid admin token, and answers 401 for everyone else.
 * An expired token reads the same as a missing one, so a long-open tab knows to ask again.
 */
export async function guard(c, next) {
  if (await verifyToken(c.env, bearerToken(c))) return next();
  return fail(c, 401, "Login required");
}

/**
 * `X-Api-Key` middleware, used on the upload routes only — the token still covers everything else.
 * Off when API_KEY is empty, so the app can be handed to real viewers without anyone editing code.
 * A wrong key is counted like a wrong password, so guessing either one ends in 429 after a few tries.
 */
export async function apiKey(c, next) {
  if (!c.env.API_KEY) return next();
  if (safeEqual(c.req.header("x-api-key") || "", c.env.API_KEY)) return next();
  return refused(c, 1) || fail(c, 401, "Invalid API key");
}
