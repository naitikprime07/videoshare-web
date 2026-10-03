// Server-rendered public pages. The video page (/app/:id) and creator page (/creator/:id) follow DiskWala's
// file and creator pages section by section: pill header, ad, card, "Uploaded by", ad, "Open in App",
// FAQ, footer. If the app is installed, Android opens the app directly (App Links) and these pages are
// never shown.
import { asset, escapeHtml, ID_RE, playStoreUrl, publicBase } from "./util.js";
import { getFile, getUser } from "./db.js";

// Material icons (Apache 2.0), same set DiskWala uses.
const ICONS = {
  file: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zM6 20V4h7v5h5v11z",
  videocam:
    "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11z",
  openInNew:
    "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3z",
  getApp: "M19 9h-4V3H9v6H5l7 7zM5 18v2h14v-2z",
  copy: "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2m0 16H8V7h11z",
  person:
    "M12 5.9c1.16 0 2.1.94 2.1 2.1s-.94 2.1-2.1 2.1S9.9 9.16 9.9 8s.94-2.1 2.1-2.1m0 9c2.97 0 6.1 1.46 6.1 2.1v1.1H5.9V17c0-.64 3.13-2.1 6.1-2.1M12 4C9.79 4 8 5.79 8 8s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m0 9c-2.67 0-8 1.34-8 4v3h16v-3c0-2.66-5.33-4-8-4",
  smartphone:
    "M17 1.01 7 1c-1.1 0-2 .9-2 2v18c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V3c0-1.1-.9-1.99-2-1.99M17 19H7V5h10z",
  help: "M11 18h2v-2h-2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8m0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4",
  expand: "M16.59 8.59 12 13.17 7.41 8.59 6 10l6 6 6-6z",
  errorOutline:
    "M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8",
  searchOff:
    "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3 6.08 3 3.28 5.64 3.03 9h2.02C5.3 6.75 7.18 5 9.5 5 11.99 5 14 7.01 14 9.5S11.99 14 9.5 14c-.17 0-.33-.03-.5-.05v2.02c.17.02.33.03.5.03 1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-8.03-.97L4.99 15.5l-2.47-2.47-.71.71L4.28 16.2l-2.47 2.47.71.71 2.47-2.47 2.47 2.47.71-.71-2.47-2.47 2.47-2.47z",
  home: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
  moon: "M11.93 2.3c-2.04-.5-4.02-.35-5.77.28-.72.26-.91 1.22-.31 1.71C8.08 6.12 9.5 8.89 9.5 12c0 3.11-1.42 5.88-3.65 7.71-.59.49-.42 1.45.31 1.7 1.04.38 2.17.59 3.34.59 6.05 0 10.85-5.38 9.87-11.6-.61-3.92-3.59-7.16-7.44-8.1",
  sun: "M12 5.5c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6M12 1c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1m0 19c-.55 0-1 .45-1 1v1c0 .55.45 1 1 1s1-.45 1-1v-1c0-.55-.45-1-1-1M2 11c-.55 0-1 .45-1 1s.45 1 1 1h1c.55 0 1-.45 1-1s-.45-1-1-1zm19 0c-.55 0-1 .45-1 1s.45 1 1 1h1c.55 0 1-.45 1-1s-.45-1-1-1zM4.93 3.51c-.39-.39-1.02-.39-1.41 0s-.39 1.02 0 1.41l.71.71c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41zm14.14 14.14c-.39-.39-1.02-.39-1.41 0s-.39 1.02 0 1.41l.71.71c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41zM3.51 19.07c-.39.39-.39 1.02 0 1.41s1.02.39 1.41 0l.71-.71c.39-.39.39-1.02 0-1.41s-1.02-.39-1.41 0zM19.78 5.64c.39-.39.39-1.02 0-1.41s-1.02-.39-1.41 0l-.71.71c-.39.39-.39 1.02 0 1.41s1.02.39 1.41 0z",
  play: "M8 5v14l11-7z",
  info: "M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8",
};
const icon = (name, cls = "") =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"${cls ? ` class="${cls}"` : ""}><path d="${ICONS[name]}"/></svg>`;

// ---------------- pages ----------------

export async function filePage(c) {
  const id = c.req.param("id");
  const row = ID_RE.test(id) && (await getFile(c.env, id));
  if (!row || row.status === "uploading" || row.status === "blocked")
    return c.html(notFoundPage(c), 404);
  const creator = await getUser(c.env, row.user_id);
  row.creator_name = creator?.name;

  const app = c.env.APP_NAME;
  const links = appLinks(
    c,
    { file: `/app/${row.id}`, profile: `/creator/${row.user_id}` },
    `file_id=${row.id}`,
  );
  return c.html(
    layout(c, {
      title: `Download ${app} App — Free on Android`,
      description: `Download the ${app} app for free on Android. Watch videos with fast playback and an advanced video player.`,
      links,
      body: `
      <main class="hero">
        <div class="container sm">
          ${adRegion(c, c.env.WEB_AD_TOP, "top")}
          <section class="glass-card">
            <span class="chip">${icon("file")}Shared File</span>
            <div class="type-circle">${icon("videocam")}</div>
            <h5 class="file-name">${escapeHtml(maskName(row.name) || `${app} File`)}</h5>
            <div class="chip-row">
              <span class="chip meta">${escapeHtml(row.mime || "Unknown type")}</span>
              ${row.size > 0 ? `<span class="chip meta">${formatSize(row.size)}</span>` : ""}
            </div>
            ${viewInApp("file")}
          </section>
          <section class="uploader">
            <div class="uploader-row">
              <span class="avatar">${icon("person")}</span>
              <div class="uploader-text">
                <span class="caption-strong">UPLOADED BY</span>
                <div class="uploader-name">${escapeHtml(row.creator_name || "Unknown")}</div>
              </div>
              <div class="uploader-actions">
                <button class="btn outlined" type="button" data-open="profile">${icon("person")}View Profile</button>
                <button class="btn text small" type="button" data-copy="file">${icon("copy")}Copy</button>
              </div>
            </div>
          </section>
          ${adRegion(c, c.env.WEB_AD_BOTTOM, "bottom")}
          ${openInApp(c, "File", true)}
        </div>
      </main>
      <hr class="divider">
      ${faq(c, "file")}
      ${sideRails(c)}`,
    }),
  );
}

export async function creatorPage(c) {
  const id = c.req.param("id");
  const creator = ID_RE.test(id) && (await getUser(c.env, id)); // getUser only answers for status='active'
  if (!creator) return c.html(notFoundPage(c), 404);

  const app = c.env.APP_NAME;
  const links = appLinks(
    c,
    { profile: `/creator/${creator.id}` },
    `creator_id=${creator.id}`,
  );
  return c.html(
    layout(c, {
      title: `${creator.name} | ${app}`,
      description: `View this creator's profile on ${app}. Explore their shared files and content. Download the ${app} app to access all files.`,
      links,
      body: `
      <main class="hero">
        <div class="container sm">
          ${adRegion(c, c.env.WEB_AD_TOP, "top")}
          <section class="glass-card profile-card">
            <div class="profile-banner"></div>
            <div class="profile-body">
              <div class="profile-avatar">${icon("person")}</div>
              <span class="chip">${icon("person")}Creator Profile</span>
              <h5 class="file-name">${escapeHtml(creator.name)}</h5>
              ${viewInApp("profile")}
            </div>
          </section>
          ${adRegion(c, c.env.WEB_AD_BOTTOM, "bottom")}
          ${openInApp(c, "Creator Profile", false)}
        </div>
      </main>
      <hr class="divider">
      ${faq(c, "creator")}
      ${sideRails(c)}`,
    }),
  );
}

export function privacyPage(c) {
  const app = escapeHtml(c.env.APP_NAME);
  const email = escapeHtml(c.env.SUPPORT_EMAIL);
  return c.html(
    layout(c, {
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
    }),
  );
}

export function assetLinks(c) {
  const fingerprints = (c.env.ANDROID_SHA256 || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return c.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: c.env.ANDROID_PACKAGE,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ]);
}

export function appleAppSiteAssociation(c) {
  const details = c.env.IOS_APP_ID
    ? [
        {
          appIDs: [c.env.IOS_APP_ID],
          components: [{ "/": "/app/*" }, { "/": "/creator/*" }],
        },
      ]
    : [];
  return c.json({ applinks: { details } });
}

// ---------------- sections ----------------

function viewInApp(kind) {
  return `
    <div class="view-in-app">
      <div class="row">
        <button class="btn contained" type="button" data-open="${kind}">${icon("openInNew")}View in App</button>
        <a class="btn outlined" href="#" data-store>${icon("getApp")}Download App</a>
      </div>
      <button class="btn text small muted" type="button" data-copy="${kind}">${icon("copy")}Copy link to open in browser</button>
    </div>`;
}

function openInApp(c, entityType, showTutorial) {
  const app = escapeHtml(c.env.APP_NAME);
  const video = c.env.TUTORIAL_YOUTUBE_ID
    ? `<div class="frame"><iframe src="https://www.youtube.com/embed/${encodeURIComponent(c.env.TUTORIAL_YOUTUBE_ID)}" title="How to open files in ${app} App" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`
    : "";
  return `
    <section class="promo">
      <span class="chip">${icon("smartphone")}Free on Android</span>
      <h6>Open in ${app} App</h6>
      <p class="lead">Download the app to access this ${entityType.toLowerCase()} and all ${app} content.</p>
      <div class="badges"><a href="#" data-store><img src="${asset(c, "/google-play-badge.png")}" alt="Get it on Google Play"></a></div>
      ${
        showTutorial
          ? `
      <div class="tutorial">
        <h4>How to Open ${entityType} in App</h4>
        <p>Click any ${app} link and it opens directly in the app.${video ? " Watch the tutorial below for a quick walkthrough." : ""}</p>
        ${video}
      </div>`
          : ""
      }
    </section>`;
}

function faq(c, pageType) {
  const app = escapeHtml(c.env.APP_NAME);
  const email = escapeHtml(c.env.SUPPORT_EMAIL);
  const linkInBrowser = [
    `My link still opens in the browser, not the ${app} App.`,
    "If the link is not opening the app directly, follow these steps:<ol><li>Uninstall the app.</li><li>Restart your device.</li><li>Reinstall the app from Play Store.</li></ol>",
  ];
  const common = [
    [
      `How can I exercise my DMCA rights on ${app}?`,
      `To exercise your DMCA (Digital Millennium Copyright Act) rights, submit a proper DMCA Notice via email to: <a href="mailto:${email}">${email}</a>. We're here to assist you promptly.`,
    ],
    [
      `How do I contact support as a ${app} App user?`,
      `You can reach our support team by email at <a href="mailto:${email}">${email}</a>. We're here to assist you promptly.`,
    ],
  ];
  const items =
    pageType === "file"
      ? [
          linkInBrowser,
          [
            "How do I watch a shared file?",
            `Install the ${app} app from the Play Store, then open the shared link. The file will open directly in the app where you can stream it.`,
          ],
          ...common,
        ]
      : [
          [
            "How do I view a creator's content?",
            `Install the ${app} app from the Play Store, then open the creator's profile link. You'll be able to browse all their shared files directly in the app.`,
          ],
          linkInBrowser,
          ...common,
        ];
  return `
    <section class="faq container sm">
      <span class="chip">${icon("help")}Support</span>
      <h2>Frequently Asked Questions</h2>
      <p class="sub">Can't find an answer? Reach out to us at <a href="mailto:${email}">${email}</a>.</p>
      <div class="faq-list">
        ${items.map(([q, a]) => `<details class="acc"><summary>${q}${icon("expand")}</summary><div class="answer">${a}</div></details>`).join("")}
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
            <div class="badges"><a href="#" data-store><img src="${asset(c, "/google-play-badge.png")}" alt="Get it on Google Play"></a></div>
            <span class="company">${app}</span>
          </div>
        </div>
        <div class="footer-bottom">
          <span>©${new Date().getFullYear()} xixvideohub.com All rights reserved.</span>
          <nav><a href="/privacy">Privacy Policy</a></nav>
        </div>
      </div>
    </footer>`;
}

function notFoundPage(c) {
  return layout(c, {
    title: `Page Not Found | ${c.env.APP_NAME}`,
    description: "Page not found.",
    noFooter: true,
    toast: "Unable to find file.",
    body: `
      <main class="hero not-found">
        <div class="container sm">
          <span class="chip error">${icon("errorOutline")}Error 404</span>
          <div class="nf-circle">${icon("searchOff")}</div>
          <h3 class="nf-title">Page Not Found</h3>
          <p class="nf-text">The page you're looking for doesn't exist or may have been moved. Check the URL or head back home.</p>
          <a class="btn contained large" href="/">${icon("home")}Go Home</a>
        </div>
      </main>`,
  });
}

// ---------------- helpers ----------------

/** Hides a random part of the name (different on every load), like DiskWala's share page. The app shows the full name. */
function maskName(name) {
  return [...String(name || "")]
    .map((ch) => (/[\p{L}\p{N}]/u.test(ch) && Math.random() < 0.45 ? "*" : ch))
    .join("");
}

/** 23312211 → "22.23 MB" (DiskWala's format). */
function formatSize(bytes) {
  if (!+bytes) return "0 Bytes";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${["Bytes", "KB", "MB", "GB", "TB"][i]}`;
}

const adSlot = (html) => (html ? `<div class="ad">${html}</div>` : "");

/**
 * Google Ad Manager (GPT) inline slots. Each region maps to an ad-unit path var and a sizes var
 * configured in wrangler.toml. gptHead() defines every slot once in <head>; adRegion() renders each
 * slot's div in the body. A region can be overridden with raw HTML via WEB_AD_TOP / WEB_AD_BOTTOM.
 */
const GAM_SLOTS = {
  top: {
    id: "gam-top",
    unitVar: "GAM_TOP_AD_UNIT",
    sizesVar: "GAM_TOP_AD_SIZES",
  },
  bottom: {
    id: "gam-bottom",
    unitVar: "GAM_BOTTOM_AD_UNIT",
    sizesVar: "GAM_BOTTOM_AD_SIZES",
  },
  left: {
    id: "gam-left",
    unitVar: "GAM_LEFT_AD_UNIT",
    sizesVar: "GAM_LEFT_AD_SIZES",
  },
  right: {
    id: "gam-right",
    unitVar: "GAM_RIGHT_AD_UNIT",
    sizesVar: "GAM_RIGHT_AD_SIZES",
  },
};
const gamUnit = (env, region) =>
  String(env[GAM_SLOTS[region].unitVar] || "").trim();

/**
 * Sizes for defineSlot, per region: GAM_TOP_AD_SIZES / GAM_BOTTOM_AD_SIZES first, then the shared
 * GAM_AD_SIZES, else 'fluid'. A value with no WxH pair (e.g. "fluid") → responsive 'fluid' (which the
 * adaptive-banner format needs — a fixed size makes it no-fill).
 */
function gamSizes(env, region) {
  return sizeList(
    String(env[GAM_SLOTS[region].sizesVar] || env.GAM_AD_SIZES || "").trim(),
  );
}

/** "WxH,WxH" → "[[W, H], ...]" JS array literal; a value with no WxH pair (e.g. "fluid") → 'fluid'. */
function sizeList(raw) {
  const arr = String(raw || "")
    .split(",")
    .map((s) => s.trim().match(/^(\d+)\s*[xX]\s*(\d+)$/))
    .filter(Boolean)
    .map((m) => `[${m[1]}, ${m[2]}]`);
  return arr.length ? `[${arr.join(", ")}]` : "'fluid'";
}

// One-time head include (gpt.js is injected exactly once, enableServices() called exactly once):
// the gpt.js loader + a defineSlot per configured inline region (top/bottom/left/right). Each slot
// is registered in window.__gamDisplaySlots so adAutoRefresh() can refresh exactly those slots —
// the interstitial + IMA video box are NOT registered there, so they're excluded by construction.
function gptHead(c) {
  const defs = Object.entries(GAM_SLOTS)
    .filter(([, s]) => String(c.env[s.unitVar] || "").trim())
    .map(
      ([region, s]) =>
        `window.__gamDisplaySlots[${JSON.stringify(s.id)}] = googletag.defineSlot(${JSON.stringify(c.env[s.unitVar])}, ${gamSizes(c.env, region)}, ${JSON.stringify(s.id)}).addService(googletag.pubads());`,
    );
  if (!defs.length && !String(c.env.GAM_INTERSTITIAL_AD_UNIT || "").trim())
    return "";
  const loader =
    '<script async src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>';
  // Chrome blocks GPT's web-interstitial attempt to add aria-hidden to <body> (WAI-ARIA forbids
  // hiding the whole accessibility tree) and logs a console warning. This observer strips the
  // attribute the moment GPT tries to set it, so the page stays accessible and the warning is
  // silenced. Interstitial functionality is unaffected — GPT's own a11y intent was already being
  // ignored by the browser anyway.
  const a11yGuard =
    '<script>(function(){function s(n){if(n&&n.tagName==="BODY"&&n.hasAttribute("aria-hidden")){n.removeAttribute("aria-hidden");}}if(document.body)s(document.body);try{var mo=new MutationObserver(function(ms){for(var i=0;i<ms.length;i++){var m=ms[i];if(m.type==="attributes"&&m.attributeName==="aria-hidden")s(m.target);}});mo.observe(document.documentElement,{attributes:true,attributeFilter:["aria-hidden"],subtree:true});}catch(e){}})();</script>';
  return `${a11yGuard}\n${loader}\n<script>window.googletag = window.googletag || { cmd: [] }; window.__gamDisplaySlots = window.__gamDisplaySlots || {}; googletag.cmd.push(function () {${defs.join(" ")} googletag.enableServices(); });</script>`;
}

/** The slot div + its display() call for a GPT region (empty when that region's unit isn't set). */
function gamSlot(c, region) {
  if (!gamUnit(c.env, region)) return "";
  const { id } = GAM_SLOTS[region];
  return `<div id="${id}" class="gam-slot"></div><script>googletag.cmd.push(function () { googletag.display(${JSON.stringify(id)}); });</script>`;
}

function adRegion(c, rawHtml, region) {
  if (rawHtml) return adSlot(rawHtml);
  const slot = gamSlot(c, region);
  return slot ? adSlot(slot) : "";
}

/** Build an IMA ad-tag URL from a GAM video unit path, or pass through a full VAST/https URL. */
function imaAdTagUrl(env, pathOrUrl) {
  const raw = String(pathOrUrl || "").trim();
  if (!raw) return "";
  if (/^https?:/i.test(raw)) return raw;
  const desc = encodeURIComponent(String(env.BASE_URL || env.PUBLIC_URL || ""));
  return `https://pubads.g.doubleclick.net/gampad/ads?iu=${raw}&env=vp&impl=s&gdfp_req=1&output=xml_vast2&uncovered_ad=1&description_url=${desc}`;
}

/**
 * Left sticky VIDEO ad box using Google IMA SDK + GAM VAST.
 *
 * Flow:
 * 1. Show custom Advertisement UI.
 * 2. 8-second countdown.
 * 3. Request GAM VAST preroll.
 * 4. Play one creative.
 * 5. Destroy IMA objects after the cycle.
 * 6. Reload after GAM_AD_REFRESH_SEC.
 *
 * GAM_LEFT_VIDEO_AD_TAG must contain the full GAM VAST URL.
 * [TIMESTAMP] is replaced with Date.now() for each request.
 */
function videoRail(c) {
  const tag = imaAdTagUrl(c.env, c.env.GAM_LEFT_VIDEO_AD_TAG);

  if (!tag) return "";

  let secs = parseInt(c.env.GAM_AD_REFRESH_SEC, 10);

  if (isNaN(secs)) {
    secs = 30;
  }

  secs = Math.max(30, secs);

  return `
<div id="adbox" class="adbox" aria-label="Advertisement" style="display:none;">

  <div class="adbox-top">

    <span class="adbox-label">
      Advertisement
    </span>

    <span
      class="adbox-count"
      id="adbox-count"
    >8</span>

    <button
      type="button"
      class="adbox-close"
      id="adbox-close"
      aria-label="Close ad"
    >&times;</button>

  </div>


  <div class="adbox-mid">

    <div
      class="adbox-ph"
      id="adbox-ph"
    >

      <span class="gam">
        Google Ad Manager
      </span>

      <span class="pre">
        Preroll
      </span>

      <span class="secs">
        <b id="adbox-secs">8</b>
        Seconds
      </span>

    </div>


    <div
      class="adbox-ima"
      id="adbox-ima"
      style="display:none;"
    >

      <video
        id="adbox-video"
        muted
        playsinline
        preload="auto"
      ></video>

    </div>

  </div>


  <div class="adbox-bottom">

    <span
      class="adbox-count2"
      id="adbox-count2"
    >8</span>

    <span
      class="adbox-help"
      title="Why this ad?"
    >?</span>

  </div>

</div>


<script src="https://imasdk.googleapis.com/js/sdkloader/ima3.js"></script>


<script>
(function () {

  /*
   * GAM tag from Worker environment.
   */
  var TAG_URL =
    ${JSON.stringify(tag)};


  /*
   * Minimum refresh.
   */
  var REFRESH_SEC =
    ${secs};


  /*
   * Countdown before ad request.
   */
  var START = 8;


  /*
   * Prevent duplicate IMA instances.
   */
  if (window.__gamVideoBox) {

    console.log(
      '[GAM VIDEO] already running - skipping duplicate'
    );

    return;
  }


  /*
   * Find original HTML box.
   */
  var first =
    document.getElementById('adbox');


  if (!first) {

    console.log(
      '[GAM VIDEO] adbox not found'
    );

    return;
  }


  /*
   * Mark global instance.
   */
  window.__gamVideoBox = true;


  /*
   * Save HTML template.
   */
  var template =
    first.outerHTML;


  /*
   * Remove original.
   */
  first.parentNode.removeChild(first);


  /*
   * Create fresh GAM request URL.
   *
   * IMPORTANT:
   *
   * Current page:
   *
   * https://xixvideohub.com/app/VIDEO_ID
   *
   * is automatically used as description_url.
   */
  function freshTag() {

    /*
     * Get current browser URL.
     */
    var pageUrl =
      window.location.href;


    /*
     * Remove hash because it is not useful
     * for GAM description_url.
     */
    try {

      var currentUrl =
        new URL(pageUrl);

      currentUrl.hash = "";

      pageUrl =
        currentUrl.toString();

    } catch (err) {

      /*
       * Keep original URL if URL parsing fails.
       */

    }


    /*
     * Encode current page URL.
     */
    var encodedPageUrl =
      encodeURIComponent(pageUrl);


    /*
     * New correlator.
     */
    var timestamp =
      Date.now();


    /*
     * Build final URL.
     */
    var finalUrl =
      TAG_URL
        .replace(
          '[DESCRIPTION_URL]',
          encodedPageUrl
        )
        .replace(
          '[TIMESTAMP]',
          timestamp
        );


    console.log(
      '[GAM VIDEO] Current page:',
      pageUrl
    );


    console.log(
      '[GAM VIDEO] VAST request URL:',
      finalUrl
    );


    return finalUrl;
  }


  /*
   * Best-effort play of the page's MAIN content video (any <video> that isn't ours).
   * Called from teardown() on error / no-fill paths so the user's own video starts
   * immediately after the preroll request fails, per user policy (no test fallback).
   */
  function playMainVideo() {

    var vids =
      document.querySelectorAll('video');


    for (var i = 0; i < vids.length; i++) {

      var v = vids[i];

      if (!v) continue;
      if (v.id === 'adbox-video') continue;
      if (v.closest && v.closest('#adbox')) continue;

      try {
        var p = v.play();
        if (p && p.catch) {
          p.catch(function (err) {
            console.log(
              '[GAM VIDEO] main video play err:',
              err
            );
          });
        }
      } catch (err) {
        console.warn(
          '[GAM VIDEO] main video play threw:',
          err
        );
      }

    }

  }


  /*
   * Start one ad cycle.
   */
  function runCycle() {

    /*
     * Create new holder.
     */
    var holder =
      document.createElement('div');


    holder.innerHTML =
      template;


    /*
     * Get ad box.
     */
    var box =
      holder.firstElementChild;


    if (!box) {

      console.error(
        '[GAM VIDEO] Could not create ad box'
      );

      return;
    }


    /*
     * Tell site that left ad is active.
     */
    window.__xixLeftAdActive = true;


    /*
     * Add to page.
     */
    document.body.appendChild(box);


    /*
     * Reveal the box ONLY now (server template ships display:none so nothing
     * flashes before preflight confirms GAM has a real <Ad> to serve).
     */
    box.style.display = '';


    /*
     * Helper.
     */
    var q = function (id) {

      return box.querySelector(
        '#' + id
      );

    };


    /*
     * Elements.
     */
    var countEl =
      q('adbox-count');

    var count2El =
      q('adbox-count2');

    var secsEl =
      q('adbox-secs');

    var ph =
      q('adbox-ph');

    var ima =
      q('adbox-ima');

    var video =
      q('adbox-video');

    var closeButton =
      q('adbox-close');


    /*
     * State.
     */
    var done = false;

    var started = 0;

    var mgr = null;

    var ddc = null;

    var loader = null;

    var tickTimer = null;

    var nextTimer = null;


    console.log(
      '[GAM VIDEO] cycle started ' +
      new Date().toISOString()
    );


    /*
     * Close box.
     */
    function closeBox() {

      if (
        box &&
        box.parentNode
      ) {

        box.parentNode.removeChild(
          box
        );

      }

    }


    /*
     * End cycle.
     */
    function teardown(why) {

      if (done) {
        return;
      }


      done = true;


      clearTimeout(
        tickTimer
      );


      clearTimeout(
        nextTimer
      );


      /*
       * Destroy AdsManager.
       */
      try {

        if (mgr) {
          mgr.destroy();
        }

      } catch (err) {

        console.warn(
          '[GAM VIDEO] manager destroy error:',
          err
        );

      }


      /*
       * Destroy display container.
       */
      try {

        if (ddc) {
          ddc.destroy();
        }

      } catch (err) {

        console.warn(
          '[GAM VIDEO] display container destroy error:',
          err
        );

      }


      /*
       * Remove ad box.
       */
      closeBox();


      /*
       * Left ad inactive.
       */
      window.__xixLeftAdActive = false;


      /*
       * Notify other site components.
       */
      try {

        document.dispatchEvent(
          new Event(
            'xix-left-ad-closed'
          )
        );

      } catch (err) {}


      /*
       * USER POLICY (Oct 2026): one GAM request per page load.
       * - NO 30s auto-cycle retry, even after AD_ERROR / 303 no-fill.
       * - NO test/sample fallback anywhere in the pipeline.
       * - On error / no-fill / 2nd-ad-blocked paths, hand playback straight back
       *   to the page's main content video (playMainVideo() finds the non-adbox <video>).
       */
      var errMode =
        /AD_ERROR|missing|failed|blocked|no fill/i.test(
          why || ''
        );


      console.log(
        '[GAM VIDEO] cycle ended (' +
        why +
        ') - no auto reload' +
        (errMode ? ' + starting main video' : '')
      );


      if (errMode) {

        try {
          playMainVideo();
        } catch (err) {
          console.warn(
            '[GAM VIDEO] playMainVideo failed:',
            err
          );
        }

      }

    }


    /*
     * Close button.
     */
    if (closeButton) {

      closeButton.addEventListener(
        'click',
        function () {

          console.log(
            '[GAM VIDEO] manual close'
          );


          teardown(
            'manual close'
          );

        }
      );

    }


    /*
     * Countdown circle.
     */
    function paint(
      el,
      frac
    ) {

      if (!el) {
        return;
      }


      el.style.background =
        'conic-gradient(' +
        '#4CAF50 ' +
        (frac * 360) +
        'deg, ' +
        'rgba(255,255,255,.14) 0deg)';

    }


    /*
     * Countdown.
     */
    var remaining =
      START;


    function tick() {

      if (done) {
        return;
      }


      remaining -= 1;


      var frac =
        Math.max(
          0,
          remaining / START
        );


      if (countEl) {

        countEl.textContent =
          remaining;

      }


      if (count2El) {

        count2El.textContent =
          remaining;

      }


      if (secsEl) {

        secsEl.textContent =
          remaining;

      }


      paint(
        countEl,
        frac
      );


      paint(
        count2El,
        frac
      );


      if (remaining > 0) {

        tickTimer =
          setTimeout(
            tick,
            1000
          );

      } else {

        tickTimer =
          setTimeout(
            startAd,
            400
          );

      }

    }


    /*
     * Start IMA ad.
     */
    function startAd() {

      if (done) {
        return;
      }


      console.log(
        '[GAM VIDEO] starting IMA ad'
      );


      /*
       * Hide placeholder.
       */
      if (ph) {

        ph.style.display =
          'none';

      }


      /*
       * Show IMA.
       */
      if (ima) {

        ima.style.display =
          'block';

      }


      /*
       * Get IMA SDK.
       */
      var IMA =
        (window.google &&
          window.google.ima) ||
        (window.goog &&
          window.goog.ima);


      if (!IMA) {

        console.error(
          '[GAM VIDEO] IMA SDK missing'
        );


        teardown(
          'IMA SDK missing'
        );


        return;
      }


      console.log(
        '[GAM VIDEO] IMA SDK ready'
      );


      /*
       * Create display container.
       */
      try {

        ddc =
          new IMA.AdDisplayContainer(
            ima,
            video
          );


        ddc.initialize();


        console.log(
          '[GAM VIDEO] AdDisplayContainer initialized'
        );

      } catch (err) {

        console.error(
          '[GAM VIDEO] AdDisplayContainer error:',
          err
        );


        teardown(
          'AdDisplayContainer failed'
        );


        return;
      }


      /*
       * Create AdsLoader.
       */
      try {

        loader =
          new IMA.AdsLoader(
            ddc
          );

      } catch (err) {

        console.error(
          '[GAM VIDEO] AdsLoader error:',
          err
        );


        teardown(
          'AdsLoader failed'
        );


        return;
      }


      /*
       * Ads manager loaded.
       */
      loader.addEventListener(
        IMA.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED,
        function (event) {

          if (done) {
            return;
          }


          console.log(
            '[GAM VIDEO] ADS_MANAGER_LOADED'
          );


          /*
           * Create AdsManager.
           */
          try {

            mgr =
              event.getAdsManager(
                video,
                new IMA.AdsRenderingSettings()
              );

          } catch (err) {

            console.error(
              '[GAM VIDEO] getAdsManager failed:',
              err
            );


            teardown(
              'getAdsManager failed'
            );


            return;
          }


          /*
           * Manager AD_ERROR.
           */
          mgr.addEventListener(
            IMA.AdErrorEvent.Type.AD_ERROR,
            function (event) {

              console.error(
                '[GAM VIDEO] ADS MANAGER AD_ERROR'
              );


              try {

                var adError =
                  event.getError
                    ? event.getError()
                    : event.error;


                console.error(
                  '[GAM VIDEO] manager error code:',
                  adError &&
                  adError.getErrorCode
                    ? adError.getErrorCode()
                    : ''
                );


                console.error(
                  '[GAM VIDEO] manager error message:',
                  adError &&
                  adError.getMessage
                    ? adError.getMessage()
                    : ''
                );


              } catch (err) {

                console.error(
                  '[GAM VIDEO] Could not read manager error:',
                  err
                );

              }


              teardown(
                'manager AD_ERROR'
              );

            },
            false
          );


          /*
           * Skipped.
           */
          mgr.addEventListener(
            IMA.AdEvent.Type.SKIPPED,
            function () {

              console.log(
                '[GAM VIDEO] ad skipped'
              );


              teardown(
                'skipped'
              );

            },
            false
          );


          /*
           * Completed.
           */
          mgr.addEventListener(
            IMA.AdEvent.Type.COMPLETED,
            function () {

              console.log(
                '[GAM VIDEO] ad completed'
              );


              teardown(
                'completed'
              );

            },
            false
          );


          /*
           * All ads completed.
           */
          mgr.addEventListener(
            IMA.AdEvent.Type.ALL_ADS_COMPLETED,
            function () {

              console.log(
                '[GAM VIDEO] all ads completed'
              );


              teardown(
                'all completed'
              );

            },
            false
          );


          /*
           * Only allow first ad.
           */
          mgr.addEventListener(
            IMA.AdEvent.Type.STARTED,
            function () {

              started++;


              console.log(
                '[GAM VIDEO] ad STARTED #' +
                started
              );


              if (started > 1) {

                teardown(
                  '2nd ad blocked'
                );

              }

            },
            false
          );


          /*
           * Initialize + start.
           */
          try {

            var width =
              ima.clientWidth ||
              300;


            var height =
              ima.clientHeight ||
              200;


            console.log(
              '[GAM VIDEO] manager init:',
              width,
              height
            );


            mgr.init(
              width,
              height,
              IMA.ViewMode.NORMAL
            );


            console.log(
              '[GAM VIDEO] manager initialized'
            );


            mgr.start();


            console.log(
              '[GAM VIDEO] manager started'
            );


          } catch (err) {

            console.error(
              '[GAM VIDEO] manager init/start failed:',
              err
            );


            teardown(
              'init/start failed'
            );

          }

        },
        false
      );


      /*
       * Loader AD_ERROR.
       */
      loader.addEventListener(
        IMA.AdErrorEvent.Type.AD_ERROR,
        function (event) {

          console.error(
            '[GAM VIDEO] ADS LOADER AD_ERROR'
          );


          try {

            var adError =
              event.getError
                ? event.getError()
                : event.error;


            console.error(
              '[GAM VIDEO] loader error object:',
              adError
            );


            console.error(
              '[GAM VIDEO] loader error code:',
              adError &&
              adError.getErrorCode
                ? adError.getErrorCode()
                : ''
            );


            console.error(
              '[GAM VIDEO] loader error message:',
              adError &&
              adError.getMessage
                ? adError.getMessage()
                : ''
            );


            console.error(
              '[GAM VIDEO] loader error data:',
              adError
                ? adError.data
                : ''
            );


          } catch (err) {

            console.error(
              '[GAM VIDEO] Could not read loader error:',
              err
            );

          }


          teardown(
            'loader AD_ERROR'
          );

        },
        false
      );


      /*
       * Create request.
       */
      var req =
        new IMA.AdsRequest();


      /*
       * Generate dynamic URL.
       */
      req.adTagUrl =
        freshTag();


      /*
       * Video size.
       */
      req.linearAdSlotWidthPx =
        300;

      req.linearAdSlotHeightPx =
        200;


      /*
       * Tell IMA that the ad will autoplay.
       */
      try {

        req.setAdWillAutoPlay(
          true
        );


        req.setAdWillPlayMuted(
          true
        );

      } catch (err) {

        console.warn(
          '[GAM VIDEO] autoplay flags unavailable:',
          err
        );

      }


      console.log(
        '[GAM VIDEO] requesting VAST'
      );


      /*
       * Request ad.
       */
      try {

        loader.requestAds(
          req
        );

      } catch (err) {

        console.error(
          '[GAM VIDEO] requestAds failed:',
          err
        );


        teardown(
          'requestAds failed'
        );

      }

    }


    /*
     * Initial countdown state.
     */
    paint(
      countEl,
      1
    );


    paint(
      count2El,
      1
    );


    /*
     * Start countdown.
     */
    tickTimer =
      setTimeout(
        tick,
        1000
      );

  }


  /*
   * PREFLIGHT + RETRY (user policy Oct 2026): do NOT mount the ad box unless GAM's
   * VAST response actually contains an <Ad>. If a real ad exists, run the normal cycle
   * ONCE. If it's an empty envelope (no demand booked yet) or the fetch fails, keep the
   * page clean (no box, no countdown, no AD_ERROR flash) and RE-TRY the preflight every
   * REFRESH_SEC seconds, so the instant GAM starts filling this unit the ad shows WITHOUT
   * needing a page reload. Retries stop after an ad has been shown. This is a lightweight
   * availability check, not a test/sample ad request.
   */
  var videoAdShown = false;      // true once we successfully run a cycle
  var preflightTimer = null;     // pending retry timer

  function schedulePreflightRetry() {
    if (videoAdShown || preflightTimer) return;
    preflightTimer = setTimeout(function () {
      preflightTimer = null;
      preflightAd();
    }, REFRESH_SEC * 1000);
    console.log(
      '[GAM VIDEO] preflight: no ad yet - will retry in ' + REFRESH_SEC + 's'
    );
  }

  function preflightAd() {

    if (videoAdShown) {
      return;
    }

    var url =
      freshTag();


    if (!url) {
      return;
    }


    try {

      fetch(
        url,
        {
          method: 'GET',
          credentials: 'omit',
          mode: 'cors',
          cache: 'no-store'
        }
      )
        .then(function (r) {
          return r.text();
        })
        .then(function (xml) {

          var body = xml || '';
          var hasAd = /<Ad[\s>]/i.test(body);


          console.log(
            '[GAM VIDEO] preflight hasAd=' +
            hasAd +
            ' bytes=' +
            body.length
          );


          if (hasAd) {

            videoAdShown = true;
            runCycle();

          } else {

            try {
              playMainVideo();
            } catch (e) {}

            schedulePreflightRetry();

          }

        })
        .catch(function (err) {

          console.warn(
            '[GAM VIDEO] preflight fetch failed:',
            err
          );

          // Safe default: if we cannot verify, do NOT show the box - but keep retrying.
          try {
            playMainVideo();
          } catch (e) {}

          schedulePreflightRetry();

        });

    } catch (e) {

      console.warn(
        '[GAM VIDEO] preflight threw:',
        e
      );

      try {
        playMainVideo();
      } catch (err) {}

      schedulePreflightRetry();

    }

  }


  preflightAd();

})();
</script>
`;
}

/**
 * Custom interstitial overlay — reproduces the Google "vignette" look (reference image 2):
 * a full-screen DARK + BLURRED backdrop (page shows through, blurred) with a small centered ad
 * card + our own Close button.
 *
 * WHY not the GPT web-interstitial: the GAM web-interstitial renders the creative as a full-screen
 * cross-origin canvas that paints its OWN opaque background (grey/black) ON TOP of anything we add,
 * so a page-blur behind it can never show (that was reference image 1). The only way to get the
 * blurred-page look is to own the overlay ourselves and render the ad as a normal Display slot.
 *
 * The card uses GAM_INTERSTITIAL_AD_UNIT (…display_interstitial_01) defined as a regular Display
 * slot (300x250 / 300x600 / fluid). If that GAM unit is configured as Display it fills exactly like
 * the right-panel display ads; if it is an out-of-page-only unit it will no-fill and we simply do
 * not show the overlay (safe). Timing (GAM_INTERSTITIAL_DELAY_SEC) and the window.gamInterstitial
 * singleton handle are preserved; video / top / bottom / left / right / auto-refresh are untouched.
 */
function interstitialManager(c) {
  const unit = String(c.env.GAM_INTERSTITIAL_AD_UNIT || "").trim();
  if (!unit) return "";
  const delay = parseInt(c.env.GAM_INTERSTITIAL_DELAY_SEC, 10);
  return `<script>
  (function () {
    var UNIT = ${JSON.stringify(unit)};
    var DELAY_SEC = ${isNaN(delay) ? 20 : delay};
    var GPT_WAIT_MS = 15000;
    var OVERLAY_ID = 'xix-inter-overlay';
    var CARD_ID = 'xix-inter-card';
    function log(m) { console.log('[GAM INTERSTITIAL] ' + m); }
    if (window.gamInterstitial) { log('manager already initialised - skipping duplicate'); return; }
    log('initializing (custom overlay mode)');

    var state = 'IDLE', slot = null, renderHandler = null, opened = false;
    var attempts = 0, MAX_ATTEMPTS = 3, RETRY_MS = 10000;

    // Blurred dark backdrop + centered card + Close, injected once.
    function ensureCss() {
      if (document.getElementById('xix-inter-css')) return;
      var s = document.createElement('style');
      s.id = 'xix-inter-css';
      s.textContent =
        '#' + OVERLAY_ID + '{position:fixed;inset:0;width:100vw;height:100vh;' +
          'background:rgba(52,58,65,0.5);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);' +
          'z-index:2147483640;display:flex;align-items:center;justify-content:center;' +
          'opacity:0;visibility:hidden;transition:opacity .25s ease;}' +
        '#' + OVERLAY_ID + '.xix-inter-open{opacity:1;visibility:visible;}' +
        '.xix-inter-stack{position:relative;display:flex;flex-direction:column;align-items:flex-end;}' +
        '#' + CARD_ID + '{position:relative;background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,.45);' +
          'min-width:300px;min-height:250px;max-width:92vw;max-height:85vh;overflow:hidden;}' +
        '.close-button-outer{cursor:pointer;padding:6px 10px;margin:0 0 8px;border:0;background:none;' +
          'font-family:Roboto,Arial,sans-serif;-webkit-tap-highlight-color:transparent;}' +
        '.close-button-outer:focus{outline:none;}' +
        '.close-button .continue-prompt-text{color:#fff;font-size:16px;font-weight:700;line-height:1.2;' +
          'text-shadow:0 1px 2px rgba(0,0,0,.4);}';
      (document.head || document.documentElement).appendChild(s);
    }

    function buildOverlay() {
      if (document.getElementById(OVERLAY_ID)) return;
      ensureCss();
      var ov = document.createElement('div');
      ov.id = OVERLAY_ID;
      ov.setAttribute('aria-hidden', 'true');
      // Vignette-style dismiss: .close-button-outer > .close-button > .continue-prompt-text ("Close"),
      // sitting above the card, right-aligned — same layout as the Google native interstitial.
      var stack = document.createElement('div');
      stack.className = 'xix-inter-stack';
      var closeOuter = document.createElement('div');
      closeOuter.className = 'close-button-outer';
      closeOuter.id = 'dismiss-button';
      closeOuter.setAttribute('aria-label', 'Close ad');
      closeOuter.setAttribute('role', 'button');
      closeOuter.setAttribute('tabindex', '0');
      var closeInner = document.createElement('div');
      closeInner.className = 'close-button';
      closeInner.id = 'dismiss-button-element';
      var closeText = document.createElement('div');
      closeText.className = 'continue-prompt-text';
      closeText.textContent = 'Close';
      closeInner.appendChild(closeText);
      closeOuter.appendChild(closeInner);
      var dismiss = function () { closeInterstitial('user closed'); };
      closeOuter.addEventListener('click', dismiss);
      closeOuter.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dismiss(); }
      });
      var card = document.createElement('div');
      card.id = CARD_ID;
      var ad = document.createElement('div');
      ad.id = 'xix-inter-ad';
      card.appendChild(ad);
      stack.appendChild(closeOuter);
      stack.appendChild(card);
      ov.appendChild(stack);
      ov.addEventListener('click', function (e) { if (e.target === ov) closeInterstitial('backdrop tap'); });
      document.body.appendChild(ov);
    }

    function closeInterstitial(reason) {
      if (!opened) return;
      opened = false;
      var ov = document.getElementById(OVERLAY_ID);
      if (ov) ov.classList.remove('xix-inter-open');
      try { document.body.style.overflow = ''; } catch (e) {}
      if (renderHandler) { try { window.googletag.pubads().removeEventListener('slotRenderEnded', renderHandler); } catch (e) {} renderHandler = null; }
      if (slot) { try { window.googletag.destroySlots([slot]); } catch (e) {} slot = null; }
      setTimeout(function () { var n = document.getElementById(OVERLAY_ID); if (n && !opened) n.remove(); }, 260);
      state = 'IDLE';
      log('closed (' + reason + ') - overlay removed, page restored');
    }

    function openOverlay() {
      if (opened) return;
      opened = true;
      buildOverlay();
      var ov = document.getElementById(OVERLAY_ID);
      if (ov) { void ov.offsetWidth; ov.classList.add('xix-inter-open'); }
      try { document.body.style.overflow = 'hidden'; } catch (e) {}
      state = 'SHOWING';
      log('interstitial shown (custom overlay)');
    }

    // Build the Display slot inside our card and request the ad. Only reveal once it actually fills.
    // Mobile reality: the first request often no-fills (tab was backgrounded / screen off when the
    // timer fired, slow connections, GAM serving variance) — and a leaked slot would make every later
    // attempt fail with defineSlot===null. So each failed attempt FULLY releases the slot and we
    // retry up to MAX_ATTEMPTS times, RETRY_MS apart.
    function releaseAttempt() {
      if (renderHandler) { try { window.googletag.pubads().removeEventListener('slotRenderEnded', renderHandler); } catch (e) {} renderHandler = null; }
      if (slot) { try { window.googletag.destroySlots([slot]); } catch (e) {} slot = null; }
      var ov = document.getElementById(OVERLAY_ID);
      if (ov && !opened) ov.remove();
      state = 'IDLE';
    }
    function failedAttempt(why) {
      releaseAttempt();
      if (attempts < MAX_ATTEMPTS) { log(why + ' - retry ' + attempts + '/' + MAX_ATTEMPTS + ' in ' + (RETRY_MS / 1000) + 's'); setTimeout(show, RETRY_MS); }
      else log(why + ' - giving up after ' + attempts + ' attempts');
    }
    function show() {
      if (state === 'SHOWING') { log('show skipped - already open'); return; }
      if (state === 'LOADING') { log('show skipped - request already in flight'); return; }
      attempts += 1;
      window.googletag = window.googletag || { cmd: [] };
      var ran = false;
      var guard = setTimeout(function () {
        if (ran) return;
        log('fallback - GPT not ready within ' + (GPT_WAIT_MS / 1000) + 's');
        failedAttempt('GPT not ready');
      }, GPT_WAIT_MS);
      window.googletag.cmd.push(function () {
        ran = true;
        clearTimeout(guard);
        state = 'LOADING';
        buildOverlay();
        slot = window.googletag.defineSlot(UNIT, [[300, 250], [300, 600], 'fluid'], 'xix-inter-ad');
        if (!slot) { failedAttempt('defineSlot returned null (is the unit a Display type?)'); return; }
        slot.addService(window.googletag.pubads());
        renderHandler = function (e) {
          if (!e || e.slot !== slot) return;
          try { window.googletag.pubads().removeEventListener('slotRenderEnded', renderHandler); } catch (err) {}
          renderHandler = null;
          if (e.isEmpty) { failedAttempt('no fill'); return; }
          openOverlay();
        };
        window.googletag.pubads().addEventListener('slotRenderEnded', renderHandler);
        window.googletag.display('xix-inter-ad');
        log('requesting interstitial display slot (attempt ' + attempts + ')');
      });
    }

    window.gamInterstitial = { show: show, close: closeInterstitial, state: function () { return state; } };
    // Phones pause/suppress ad requests while the tab is hidden (screen off, another app open).
    // If the timer fires when the page isn't visible, wait until the user actually sees the page.
    setTimeout(function () {
      if (!document.hidden) { show(); return; }
      var onVis = function () {
        if (document.hidden) return;
        document.removeEventListener('visibilitychange', onVis);
        log('page became visible - starting request');
        show();
      };
      document.addEventListener('visibilitychange', onVis);
      log('timer fired while page hidden - waiting for page to become visible');
    }, DELAY_SEC * 1000);
  })();
</script>`;
}

/** Fixed display-banner floating panels (right, and left if a display unit is set). Slide in when the ad fills. */
function displayRails(c) {
  const sides = [
    { region: "left", side: "left" },
    { region: "right", side: "right" },
  ].filter(({ region }) => gamUnit(c.env, region));
  if (!sides.length) return "";
  const ids = sides.map(({ region }) => GAM_SLOTS[region].id);
  const panels = sides
    .map(({ region, side }) => {
      const { id } = GAM_SLOTS[region];
      return `<div class="floating-ad floating-ad-${side}" id="floating-ad-${id}">
  <div class="floating-ad-content">${gamSlot(c, region)}</div>
  <div class="floating-ad-toggle" data-target="floating-ad-${id}"></div>
</div>`;
    })
    .join("\n");
  const script = `<script>
(function () {
  var ids = ${JSON.stringify(ids)};
  window.googletag = window.googletag || { cmd: [] };
  var AUTO_CLOSE = 6000, SLIDE_IN = 2500;
  // On mobile the two side ads run ONE-BY-ONE: the right display panel stays queued until the left
  // video box (.adbox) has closed, so they never overlap on the narrow screen. Desktop pops directly.
  var MOBILE = window.matchMedia("(max-width: 1023px)").matches;
  var pending = [];
  function setPanel(id, on) {
    var el = document.getElementById('floating-ad-' + id);
    if (el) el.classList[on ? 'add' : 'remove']('active');
  }
  function pop(id) { setPanel(id, true); setTimeout(function () { setPanel(id, false); }, AUTO_CLOSE); }
  function request(id) {
    if (!MOBILE || !window.__xixLeftAdActive) { pop(id); return; }
    if (pending.indexOf(id) === -1) pending.push(id);
  }
  document.addEventListener('xix-left-ad-closed', function () {
    while (pending.length) pop(pending.shift());
  });
  googletag.cmd.push(function () {
    googletag.pubads().addEventListener('slotRenderEnded', function (e) {
      var id = e.slot && e.slot.getSlotElementId();
      if (ids.indexOf(id) !== -1 && !e.isEmpty) request(id);
    });
    ids.forEach(function (id) { setTimeout(function () {
      var el = document.getElementById('floating-ad-' + id);
      if (el && el.querySelector('iframe')) request(id);
    }, SLIDE_IN); });
  });
})();
</script>`;
  return `${panels}\n${script}`;
}

/** One shared click handler: clicking any panel's nub toggles that panel open/closed. */
function railToggleScript() {
  return `<script>
(function () {
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.floating-ad-toggle');
    if (!t) return;
    var el = document.getElementById(t.getAttribute('data-target'));
    if (el) el.classList.toggle('active');
  });
})();
</script>`;
}

/**
 * Auto-refresh loop for the REGULAR GPT display slots (top/bottom banners + floating side panels):
 * calls googletag.pubads().refresh([...]) with ONLY the slots registered by gptHead() in
 * window.__gamDisplaySlots — bare refresh() is never called. The web interstitial (an out-of-page
 * slot created by interstitialManager on its own 20s page-load timer) and the left IMA video box (not
 * a GPT slot at all) are never in that registry, so they are excluded by construction and refresh
 * never touches them. Interval = GAM_AD_REFRESH_SEC (default 30; Google policy minimum is 30s —
 * lower values are clamped; 0 disables). Skips a cycle while the tab is hidden to save budget.
 */
function adAutoRefresh(c) {
  let secs = parseInt(c.env.GAM_AD_REFRESH_SEC, 10);
  if (isNaN(secs)) secs = 30;
  if (!secs) return "";
  secs = Math.max(30, secs);
  if (
    !Object.values(GAM_SLOTS).some((s) => String(c.env[s.unitVar] || "").trim())
  )
    return "";
  return `<script>
(function () {
  var REFRESH_SEC = ${secs};
  window.googletag = window.googletag || { cmd: [] };
  googletag.cmd.push(function () {
    var reg = window.__gamDisplaySlots || {};
    var slots = Object.keys(reg).map(function (k) { return reg[k]; }).filter(Boolean);
    if (!slots.length) return;
    console.log('[GAM REFRESH] auto-refresh ON every ' + REFRESH_SEC + 's for display slots only: ' + Object.keys(reg).join(', '));
    setInterval(function () {
      if (document.hidden) return;                       // don't burn ad budget on an unseen tab
      console.log('[GAM REFRESH] ' + new Date().toISOString() + ' -> refreshing [' + Object.keys(reg).join(', ') + '] only');
      googletag.pubads().refresh(slots);                 // specific slots ONLY (never a bare refresh())
    }, REFRESH_SEC * 1000);
  });
})();
</script>`;
}

/** All floating side rails (left video box + display panels), their toggle script + the interstitial. */
function sideRails(c) {
  const video = videoRail(c);
  const display = displayRails(c);
  const inter = interstitialManager(c);
  const refresh = adAutoRefresh(c);
  if (!video && !display && !inter && !refresh) return "";
  return `${video}${display}${inter}${refresh}\n${railToggleScript()}`;
}

function logo(c) {
  return `<a href="/" class="logo"><img class="logo-word" src="/brand/icon.png" alt="${escapeHtml(c.env.APP_NAME)}"></a>`;
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
  const links = { store, ios: c.env.IOS_APP_STORE_URL || "" };
  for (const [kind, path] of Object.entries(paths)) {
    links[kind] = {
      android: `intent://${host}${path}#Intent;scheme=https;package=${c.env.ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(store)};end`,
      share: `${base}${path}`,
    };
  }
  return links;
}

function pageScript(c, links, toast) {
  const data = JSON.stringify(links || { store: playStoreUrl(c.env) }).replace(
    /</g,
    "\\u003c",
  );
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
    ${toast ? `say(${JSON.stringify(toast)});` : ""}`;
}

function layout(
  c,
  { title, description, body, links, noFooter = false, toast = "" },
) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F44647">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${escapeHtml(c.env.APP_NAME)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<link rel="icon" href="/brand/logo.png" type="image/png">
<link rel="apple-touch-icon" href="/brand/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800;900&display=swap">
<link rel="stylesheet" href="${asset(c, "/share.css")}">
<script>
  (function () {
    var m = null;
    try { m = localStorage.getItem('themeMode'); } catch (e) {}
    document.documentElement.dataset.theme = m || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  })();
</script>
${c.env.WEB_AD_HEAD || ""}
${gptHead(c)}
</head>
<body>
<header class="appbar">
  <div class="container">
    <div class="toolbar">
      ${logo(c)}
      <button class="mode-toggle" type="button" aria-label="button to toggle theme" data-mode>${icon("moon", "moon")}${icon("sun", "sun")}</button>
    </div>
  </div>
</header>
${body}
${noFooter ? "" : footer(c)}
<div class="toast" role="status" aria-live="polite" data-toast hidden>${icon("info")}<span></span></div>
<script>${pageScript(c, links, toast)}</script>
</body>
</html>`;
}
