// Frontend config — the only file that knows where the backend lives.
// Loaded with a plain <script> tag before anything else runs, so no build step is needed.
// Deployed together with the API (one Cloudflare Worker serving this folder), /api and /media are
// the SAME origin: leave API empty. Only set a full URL if you ever split them again — local dev
// with `npm run dev` also serves both from one origin, so empty works there too.
// For local dev these values are overridden by API_BASE_URL / PLAY_STORE_URL in the .env file (see serve.mjs).
// This file is loaded directly by the browser, so it must NOT reference process/env —
// those only exist in Node. The values below are plain fallbacks; serve.mjs (dev) and the
// host's build step replace them by injecting the real values into these quoted strings.
window.APP_CONFIG = {
  API: '',
  // Fallback Google Play link for "Get the App" buttons when the API has no playStoreUrl yet.
  PLAY_STORE: 'https://play.google.com/store',
  // Sent as X-Api-Key on the upload endpoints. Empty here on purpose — set in .env (dev) or the host's env.
  API_KEY: '',
};

// Always a string with no trailing slash, so callers can just append "/api/…".
window.API_BASE = String(window.APP_CONFIG.API || '').replace(/\/$/, '');
window.PLAY_STORE_URL = String(window.APP_CONFIG.PLAY_STORE || '');
window.API_KEY = String(window.APP_CONFIG.API_KEY || '');
