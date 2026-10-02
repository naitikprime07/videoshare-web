# Brand assets (logo + icon)

Drop your brand images in this folder with **exactly these filenames**. They are used automatically
everywhere on the site (server-rendered share/creator/privacy/404 pages, the landing page, login,
terms, privacy and the dashboard) — no code change needed after you add the files.

| File | Used for | Recommended |
|------|----------|-------------|
| `logo.png` | Header / footer / sidebar **logo icon** (sits left of the "VidShare" name text) | Square-ish, transparent PNG, ~64×64 px (displays at 30–34 px, so a 2× asset looks crisp) |
| `icon.png` | **Favicon** (browser tab + mobile "add to home") | Perfect square PNG, 512×512 px, transparent or solid |

### Notes
- **Name text stays as text** (not baked into the image), so it keeps following the `APP_NAME`
  setting. `logo.png` is only the little icon in front of the name.
- **Before you add the files** nothing breaks: the site falls back to the current red play-triangle
  icon and the existing `/favicon.svg`. The moment `logo.png` / `icon.png` exist, they replace the
  fallback automatically.
- PNG is recommended. If you prefer SVG, name it `logo.png`? No — keep the extension matching what
  you actually drop; the code references `logo.png` and `icon.png` literally. To use a different
  filename or format, tell me and I'll update the references.
- These are served from the same origin at `https://<your-domain>/brand/logo.png` (Cloudflare Workers
  ASSETS), so they work in local dev, ngrok and production alike.
