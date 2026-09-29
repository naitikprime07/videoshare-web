// Server-rendered public pages. The video page (/app/:id) and creator page (/creator/:id) follow DiskWala's
// file and creator pages section by section: pill header, ad, card, "Uploaded by", ad, "Open in App",
// FAQ, footer. If the app is installed, Android opens the app directly (App Links) and these pages are
// never shown.
import { asset, escapeHtml, ID_RE, playStoreUrl, publicBase } from './util.js';
import { getFile, getUser } from './db.js';

// Material icons (Apache 2.0), same set DiskWala uses.
const ICONS = {
  file: 'M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zM6 20V4h7v5h5v11z',
  videocam: 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11z',
  openInNew: 'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3z',
  getApp: 'M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z',
  copy: 'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z',
  person: 'M12 5.9c1.16 0 2.1.94 2.1 2.1s-.94 2.1-2.1 2.1S9.9 9.16 9.9 8s.94-2.1 2.1-2.1m0 9c2.97 0 6.1 1.46 6.1 2.1v1.1H5.9V17c0-.64 3.13-2.1 6.1-2.1M12 4C9.79 4 8 5.79 8 8s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m0 9c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4',
  smartphone: 'M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99M17 19H7V5h10z',
  help: 'M11 18h2v-2h-2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4',
  expand: 'M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z',
  errorOutline: 'M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8',
  searchOff: 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3 6.08 3 3.28 5.64 3.03 9h2.02C5.3 6.75 7.18 5 9.5 5 11.99 5 14 7.01 14 9.5S11.99 14 9.5 14c-.17 0-.33-.03-.5-.05v2.02c.17.02.33.03.5.03 1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-8.03-.97L4.99 15.5l-2.47-2.47-.71.71L4.28 16.2l-2.47 2.47.71.71 2.47-2.47 2.47 2.47.71-.71-2.47-2.47 2.47-2.47z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  moon: 'M11.93 2.3c-2.04-.5-4.02-.35-5.77.28-.72.26-.91 1.22-.31 1.71C8.08 6.12 9.5 8.89 9.5 12c0 3.11-1.42 5.88-3.65 7.71-.59.49-.42 1.45.31 1.7 1.04.38 2.17.59 3.34.59 6.05 0 10.85-5.38 9.87-11.6-.61-3.92-3.59-7.16-7.44-8.1',
  sun: 'M12 5.5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6M12 1c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1m0 19c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1s1-.45 1-1v-1c0-.55-.45-1-1-1M2 11c-.55 0-1 .45-1 1s.45 1 1 1h1c.55 0 1-.45 1-1s-.45-1-1-1zm19 0c-.55 0-1 .45-1 1s.45 1 1 1h1c.55 0 1-.45 1-1s-.45-1-1-1zM4.93 3.51c-.39-.39-1.02-.39-1.41 0s-.39 1.02 0 1.41l.71.71c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41zm14.14 14.14c-.39-.39-1.02-.39-1.41 0s-.39 1.02 0 1.41l.71.71c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41zM3.51 19.07c-.39.39-.39 1.02 0 1.41s1.02.39 1.41 0l.71-.71c.39-.39.39-1.02 0-1.41s-1.02-.39-1.41 0zM19.78 5.64c.39-.39.39-1.02 0-1.41s-1.02-.39-1.41 0l-.71.71c-.39.39-.39 1.02 0 1.41s1.02.39 1.41 0z',
  play: 'M8 5v14l11-7z',
  info: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8',
};
const icon = (name, cls = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ''}><path d="${ICONS[name]}"/></svg>`;

// ---------------- pages ----------------

export async function filePage(c) {
  const id = c.req.param('id');
  const row = ID_RE.test(id) && await getFile(c.env, id);
  if (!row || row.status === 'uploading' || row.status === 'blocked') return c.html(notFoundPage(c), 404);
  const creator = await getUser(c.env, row.user_id);
  row.creator_name = creator?.name;

  const app = c.env.APP_NAME;
  const links = appLinks(c, { file: `/app/${row.id}`, profile: `/creator/${row.user_id}` }, `file_id=${row.id}`);
  return c.html(layout(c, {
    title: `Download ${app} App — Free on Android`,
    description: `Download the ${app} app for free on Android. Watch videos with fast playback and an advanced video player.`,
    links,
    body: `
      <main class="hero">
        <div class="container sm">
          ${adSlot(c.env.WEB_AD_TOP)}
          <section class="glass-card">
            <span class="chip">${icon('file')}Shared File</span>
            <div class="type-circle">${icon('videocam')}</div>
            <h5 class="file-name">${escapeHtml(maskName(row.name) || `${app} File`)}</h5>
            <div class="chip-row">
              <span class="chip meta">${escapeHtml(row.mime || 'Unknown type')}</span>
              ${row.size > 0 ? `<span class="chip meta">${formatSize(row.size)}</span>` : ''}
            </div>
            ${viewInApp('file')}
          </section>
          <section class="uploader">
            <div class="uploader-row">
              <span class="avatar">${icon('person')}</span>
              <div class="uploader-text">
                <span class="caption-strong">UPLOADED BY</span>
                <div class="uploader-name">${escapeHtml(row.creator_name || 'Unknown')}</div>
              </div>
              <div class="uploader-actions">
                <button class="btn outlined" type="button" data-open="profile">${icon('person')}View Profile</button>
                <button class="btn text small" type="button" data-copy="profile">${icon('copy')}Copy</button>
              </div>
            </div>
          </section>
          ${adSlot(c.env.WEB_AD_BOTTOM)}
          ${openInApp(c, 'File', true)}
        </div>
      </main>
      <hr class="divider">
      ${faq(c, 'file')}`,
  }));
}

export async function creatorPage(c) {
  const id = c.req.param('id');
  const creator = ID_RE.test(id) && await getUser(c.env, id); // getUser only answers for status='active'
  if (!creator) return c.html(notFoundPage(c), 404);

  const app = c.env.APP_NAME;
  const links = appLinks(c, { profile: `/creator/${creator.id}` }, `creator_id=${creator.id}`);
  return c.html(layout(c, {
    title: `${creator.name} | ${app}`,
    description: `View this creator's profile on ${app}. Explore their shared files and content. Download the ${app} app to access all files.`,
    links,
    body: `
      <main class="hero">
        <div class="container sm">
          ${adSlot(c.env.WEB_AD_TOP)}
          <section class="glass-card profile-card">
            <div class="profile-banner"></div>
            <div class="profile-body">
              <div class="profile-avatar">${icon('person')}</div>
              <span class="chip">${icon('person')}Creator Profile</span>
              <h5 class="file-name">${escapeHtml(creator.name)}</h5>
              ${viewInApp('profile')}
            </div>
          </section>
          ${adSlot(c.env.WEB_AD_BOTTOM)}
          ${openInApp(c, 'Creator Profile', false)}
        </div>
      </main>
      <hr class="divider">
      ${faq(c, 'creator')}`,
  }));
}

export function privacyPage(c) {
  const app = escapeHtml(c.env.APP_NAME);
  const email = escapeHtml(c.env.SUPPORT_EMAIL);
  return c.html(layout(c, {
    title: `Privacy Policy | ${c.env.APP_NAME}`,
    description: `How ${c.env.APP_NAME} handles your data.`,
    body: `
      <main class="hero">
        <div class="container sm">
          <section class="glass-card prose">
            <h1>Privacy Policy</h1>
            <p>This page explains what the ${app} website and Android app collect and why.</p>
            <h2>What we collect</h2>
            <ul>
              <li><strong>A random app ID.</strong> The app creates a random ID when it is installed. It is not linked to your name, phone number or Google account. We use it to count each view only once per day.</li>
              <li><strong>Viewing data.</strong> Which video was opened, how long it played (up to the counting limit), your IP address and country. We use this to count views and to stop fake views.</li>
              <li><strong>Install source.</strong> When you install the app from a shared link, the Play Store tells the app which video you came from so it can open it.</li>
            </ul>
            <p>We do not ask for accounts, contacts, location, photos or files on your phone.</p>
            <h2>Ads</h2>
            <p>The app shows ads from Google AdMob, and the website may show ads from advertising partners. They may use device identifiers (such as the advertising ID) and cookies to show and measure ads. See <a href="https://policies.google.com/technologies/ads" rel="noopener">how Google uses data from ads</a>. You can reset or delete your advertising ID in your phone's settings.</p>
            <h2>How long we keep data</h2>
            <p>Play records are deleted after 1 day. Daily view counts are kept while the video exists.</p>
            <h2>Contact</h2>
            <p>Questions, deletion requests or copyright (DMCA) notices: <a href="mailto:${email}">${email}</a>.</p>
          </section>
        </div>
      </main>`,
  }));
}

export function assetLinks(c) {
  const fingerprints = (c.env.ANDROID_SHA256 || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return c.json([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: c.env.ANDROID_PACKAGE, sha256_cert_fingerprints: fingerprints },
  }]);
}

export function appleAppSiteAssociation(c) {
  const details = c.env.IOS_APP_ID
    ? [{ appIDs: [c.env.IOS_APP_ID], components: [{ '/': '/app/*' }, { '/': '/creator/*' }] }]
    : [];
  return c.json({ applinks: { details } });
}

// ---------------- sections ----------------

function viewInApp(kind) {
  return `
    <div class="view-in-app">
      <div class="row">
        <button class="btn contained" type="button" data-open="${kind}">${icon('openInNew')}View in App</button>
        <a class="btn outlined" href="#" data-store>${icon('getApp')}Download App</a>
      </div>
      <button class="btn text small muted" type="button" data-copy="${kind}">${icon('copy')}Copy link to open in browser</button>
    </div>`;
}

function openInApp(c, entityType, showTutorial) {
  const app = escapeHtml(c.env.APP_NAME);
  const video = c.env.TUTORIAL_YOUTUBE_ID
    ? `<div class="frame"><iframe src="https://www.youtube.com/embed/${encodeURIComponent(c.env.TUTORIAL_YOUTUBE_ID)}" title="How to open files in ${app} App" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`
    : '';
  return `
    <section class="promo">
      <span class="chip">${icon('smartphone')}Free on Android</span>
      <h6>Open in ${app} App</h6>
      <p class="lead">Download the app to access this ${entityType.toLowerCase()} and all ${app} content.</p>
      <div class="badges"><a href="#" data-store><img src="${asset(c, '/google-play-badge.png')}" alt="Get it on Google Play"></a></div>
      ${showTutorial ? `
      <div class="tutorial">
        <h4>How to Open ${entityType} in App</h4>
        <p>Click any ${app} link and it opens directly in the app.${video ? ' Watch the tutorial below for a quick walkthrough.' : ''}</p>
        ${video}
      </div>` : ''}
    </section>`;
}

function faq(c, pageType) {
  const app = escapeHtml(c.env.APP_NAME);
  const email = escapeHtml(c.env.SUPPORT_EMAIL);
  const linkInBrowser = [
    `My link still opens in the browser, not the ${app} App.`,
    'If the link is not opening the app directly, follow these steps:<ol><li>Uninstall the app.</li><li>Restart your device.</li><li>Reinstall the app from Play Store.</li></ol>',
  ];
  const common = [
    [`How can I exercise my DMCA rights on ${app}?`, `To exercise your DMCA (Digital Millennium Copyright Act) rights, submit a proper DMCA Notice via email to: <a href="mailto:${email}">${email}</a>. We're here to assist you promptly.`],
    [`How do I contact support as a ${app} App user?`, `You can reach our support team by email at <a href="mailto:${email}">${email}</a>. We're here to assist you promptly.`],
  ];
  const items = pageType === 'file'
    ? [linkInBrowser, ['How do I watch a shared file?', `Install the ${app} app from the Play Store, then open the shared link. The file will open directly in the app where you can stream it.`], ...common]
    : [["How do I view a creator's content?", `Install the ${app} app from the Play Store, then open the creator's profile link. You'll be able to browse all their shared files directly in the app.`], linkInBrowser, ...common];
  return `
    <section class="faq container sm">
      <span class="chip">${icon('help')}Support</span>
      <h2>Frequently Asked Questions</h2>
      <p class="sub">Can't find an answer? Reach out to us at <a href="mailto:${email}">${email}</a>.</p>
      <div class="faq-list">
        ${items.map(([q, a]) => `<details class="acc"><summary>${q}${icon('expand')}</summary><div class="answer">${a}</div></details>`).join('')}
      </div>
    </section>`;
}

function footer(c) {
  const app = escapeHtml(c.env.APP_NAME);
  const email = escapeHtml(c.env.SUPPORT_EMAIL);
  return `
    <footer class="footer">
      <div class="container">
        <div class="footer-grid">
          <div class="footer-col">
            ${logo(c)}
            <p class="blurb">Watch shared videos with fast playback in the free ${app} app.</p>
          </div>
          <div class="footer-col">
            <span class="overline">Resources</span>
            <div class="footer-links">
              <a href="/">Download App</a>
              <a href="/privacy">Privacy Policy</a>
              <a href="mailto:${email}">Contact Us</a>
            </div>
          </div>
          <div class="footer-col end">
            <span class="overline">Get the App</span>
            <div class="badges"><a href="#" data-store><img src="${asset(c, '/google-play-badge.png')}" alt="Get it on Google Play"></a></div>
            <span class="company">${app}</span>
          </div>
        </div>
        <div class="footer-bottom">
          <span>© ${new Date().getFullYear()} ${app}. All rights reserved.</span>
          <nav><a href="/privacy">Privacy Policy</a><span>•</span><a href="mailto:${email}?subject=DMCA">DMCA</a></nav>
        </div>
      </div>
    </footer>`;
}

function notFoundPage(c) {
  return layout(c, {
    title: `Page Not Found | ${c.env.APP_NAME}`,
    description: 'Page not found.',
    noFooter: true,
    toast: 'Unable to find file.',
    body: `
      <main class="hero not-found">
        <div class="container sm">
          <span class="chip error">${icon('errorOutline')}Error 404</span>
          <div class="nf-circle">${icon('searchOff')}</div>
          <h3 class="nf-title">Page Not Found</h3>
          <p class="nf-text">The page you're looking for doesn't exist or may have been moved. Check the URL or head back home.</p>
          <a class="btn contained large" href="/">${icon('home')}Go Home</a>
        </div>
      </main>`,
  });
}

// ---------------- helpers ----------------

/** Hides a random part of the name (different on every load), like DiskWala's share page. The app shows the full name. */
function maskName(name) {
  return [...String(name || '')].map((ch) => (/[\p{L}\p{N}]/u.test(ch) && Math.random() < 0.45 ? '*' : ch)).join('');
}

/** 23312211 → "22.23 MB" (DiskWala's format). */
function formatSize(bytes) {
  if (!+bytes) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${['Bytes', 'KB', 'MB', 'GB', 'TB'][i]}`;
}

const adSlot = (html) => (html ? `<div class="ad">${html}</div>` : '');

function logo(c) {
  return `<a href="/" class="logo"><span class="logo-mark">${icon('play')}</span>${escapeHtml(c.env.APP_NAME)}</a>`;
}

/**
 * Android: an intent:// URL opens the app even inside in-app browsers (Instagram, Facebook, Telegram)
 * where App Links don't fire. If the app isn't installed, Chrome goes to the fallback: the Play Store
 * with `referrer`, which the app reads after install to open this exact video (deferred deep link).
 */
function appLinks(c, paths, referrer) {
  const base = publicBase(c);
  const host = new URL(base).host;
  const store = playStoreUrl(c.env, referrer);
  const links = { store, ios: c.env.IOS_APP_STORE_URL || '' };
  for (const [kind, path] of Object.entries(paths)) {
    links[kind] = {
      android: `intent://${host}${path}#Intent;scheme=https;package=${c.env.ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(store)};end`,
      share: `${base}${path}`,
    };
  }
  return links;
}

function pageScript(c, links, toast) {
  const data = JSON.stringify(links || { store: playStoreUrl(c.env) }).replace(/</g, '\\u003c');
  return `
    const L = ${data};
    const ua = navigator.userAgent;
    const toastEl = document.querySelector('[data-toast]');
    const say = (t) => {
      toastEl.querySelector('span').textContent = t;
      toastEl.hidden = false;
      clearTimeout(say.t);
      say.t = setTimeout(() => { toastEl.hidden = true; }, 3000);
    };
    document.querySelector('[data-mode]').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('themeMode', next); } catch {}
    });
    document.querySelectorAll('[data-store]').forEach((a) => { a.href = L.store; a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    document.querySelectorAll('[data-open]').forEach((el) => el.addEventListener('click', () => {
      const t = L[el.dataset.open];
      if (/Android/i.test(ua)) location.href = t.android;
      else if (/iPhone|iPad|iPod/i.test(ua) && L.ios) { location.href = t.share; setTimeout(() => { location.href = L.ios; }, 1500); }
      else location.href = t.share;
    }));
    document.querySelectorAll('[data-copy]').forEach((el) => el.addEventListener('click', () => {
      navigator.clipboard?.writeText(L[el.dataset.copy].share);
      say('Link copied! Open in your browser to launch the app.');
    }));
    ${toast ? `say(${JSON.stringify(toast)});` : ''}`;
}

function layout(c, { title, description, body, links, noFooter = false, toast = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#1F7A1F">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(c.env.APP_NAME)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<link rel="icon" href="${asset(c, '/favicon.svg')}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800;900&display=swap">
<link rel="stylesheet" href="${asset(c, '/share.css')}">
<script>
  (function () {
    var m = null;
    try { m = localStorage.getItem('themeMode'); } catch (e) {}
    document.documentElement.dataset.theme = m || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  })();
</script>
${c.env.WEB_AD_HEAD || ''}
</head>
<body>
<header class="appbar">
  <div class="container">
    <div class="toolbar">
      ${logo(c)}
      <button class="mode-toggle" type="button" aria-label="button to toggle theme" data-mode>${icon('moon', 'moon')}${icon('sun', 'sun')}</button>
    </div>
  </div>
</header>
${body}
${noFooter ? '' : footer(c)}
<div class="toast" role="status" aria-live="polite" data-toast hidden>${icon('info')}<span></span></div>
<script>${pageScript(c, links, toast)}</script>
</body>
</html>`;
}
