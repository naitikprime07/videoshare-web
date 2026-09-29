// Owner dashboard ("Studio"): overview (KPIs, views-per-day chart, top videos today), videos table,
// per-video date-wise views (drawer), and chunked uploads (dialog).
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const API = `${window.API_BASE}/api/dashboard`;
const PARALLEL_PARTS = 3;
const REFRESH_MS = 60_000;
const nf = new Intl.NumberFormat('en-IN');
const axisDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const longDay = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const headerDay = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const uploadedFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const use = (id) => `<svg aria-hidden="true"><use href="#i-${id}"/></svg>`;

const state = {
  view: 'overview',
  appName: 'Studio',
  stats: null, // last /stats?days=90 response
  overallDays: 30,
  videoDays: 30,
  sort: 'newest',
  q: '',
  nextOffset: null,
  loaded: 0,
  current: null, // video open in the drawer
  lastFocus: null,
  uploading: 0,
};

// ---------- helpers ----------

// One-shot flag: when a 401 arrives, several in-flight calls (chart refresh, upload parts,
// interval) fail together. Only the first one shows the toast and starts the logout redirect;
// every later call fails fast without re-triggering it.
let sessionEnded = false;

function handleUnauthorized() {
  if (sessionEnded) return;
  sessionEnded = true;
  // Token invalid/expired on the server: clear the session and go back to login.
  try {
    localStorage.removeItem('authToken');
    localStorage.removeItem('authExpiresAt');
    localStorage.removeItem('authUser');
  } catch { /* private mode */ }
  toast('Session expired — please log in again', 'alert');
  setTimeout(() => { window.location.replace('/login/'); }, 900);
}

async function api(method, path, body) {
  if (sessionEnded) throw new Error('Session expired.'); // stop retries/actions after logout began
  const init = { method, headers: {} };
  // Every dashboard API call carries the login token: Authorization: Bearer <token>.
  let token = null;
  try { token = localStorage.getItem('authToken'); } catch { /* private mode */ }
  if (token) init.headers.Authorization = `Bearer ${token}`;
  // X-Api-Key is required by every dashboard upload endpoint in addition to the Bearer token:
  // POST /uploads (start), PUT /uploads/<id>/parts/<n> (chunk), POST /uploads/<id>/complete,
  // PUT /uploads/<id>/thumb. Other dashboard calls use the Bearer token only.
  if (window.API_KEY && /^\/(uploads|uploads\/[^/]+\/(parts\/\d+|complete|thumb))$/.test(path)) init.headers['X-Api-Key'] = window.API_KEY;
  if (body instanceof Blob) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(API + path, init);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    handleUnauthorized();
    throw new Error('Session expired.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function toast(text, iconId = 'check') {
  const el = $('[data-toast]');
  el.innerHTML = `${use(iconId)}<span></span>`;
  $('span', el).textContent = text;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2400);
}

const compact = (n) => (n >= 100000 ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n) : nf.format(n));
const sum = (arr) => arr.reduce((s, d) => s + d.views, 0);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

function thumbHtml(f, cls = 'thumb') {
  return f.thumbUrl ? `<span class="${cls}"><img src="${esc(f.thumbUrl)}" alt="" loading="lazy"></span>` : `<span class="${cls}">${use('play')}</span>`;
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied — paste it in WhatsApp or Telegram');
  } catch {
    prompt('Copy this link', url);
  }
}

function setPressed(group, days) {
  $$('[data-days]', group).forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days)));
}

// ---------- navigation ----------

const PAGES = {
  overview: { title: 'Overview', sub: () => (state.stats ? headerDay.format(new Date(state.stats.days.at(-1).day)) : '') },
  videos: { title: 'Videos', sub: () => (state.stats ? `${nf.format(state.stats.files)} videos · ${compact(state.stats.totalViews)} total views` : '') },
};

function route() {
  const view = location.hash === '#videos' ? 'videos' : 'overview';
  state.view = view;
  $$('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== view; });
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
  renderHeader();
  if (view === 'videos' && !state.loaded) loadFiles({ reset: true });
  if (view === 'overview' && state.stats) renderOverallChart();
  window.scrollTo(0, 0);
}

function renderHeader() {
  const page = PAGES[state.view];
  $('[data-page-title]').textContent = page.title;
  $('[data-page-sub]').textContent = page.sub();
  document.title = `${page.title} · ${state.appName}`;
}

window.addEventListener('hashchange', route);

$$('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('themeMode', next); } catch { /* private mode */ }
}));

// Logout: clears the API-issued session (token + expiry + username) and goes back to login.
// Call the backend logout API here too when one is added.
$$('[data-logout]').forEach((b) => b.addEventListener('click', () => {
  try {
    localStorage.removeItem('authToken');
    localStorage.removeItem('authExpiresAt');
    localStorage.removeItem('authUser');
  } catch { /* private mode */ }
  toast('Logged out — see you soon');
  setTimeout(() => { window.location.href = '/login/'; }, 900);
}));

// ---------- chart (single series columns: ≤24px bars, 4px rounded tops, 2px gaps, hover tooltip) ----------

const charts = new Map();

function niceMax(max) {
  if (max <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(max / 4));
  return [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => s * 4 >= max) * 4;
}

function drawChart(box, days) {
  charts.set(box, days);
  const W = box.clientWidth || 600;
  const H = box.clientHeight || 240;
  const pad = { top: 8, right: 4, bottom: 24, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const yMax = niceMax(Math.max(...days.map((d) => d.views)));
  const slot = plotW / days.length;
  const barW = Math.max(1, Math.min(24, slot - 2));
  const y = (v) => pad.top + plotH - (v / yMax) * plotH;
  const last = days.length - 1;

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Views per day">`;
  for (let i = 0; i <= 4; i++) {
    const v = (yMax / 4) * i;
    svg += `<line class="grid-line" x1="${pad.left}" x2="${W - pad.right}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text class="tick" x="${pad.left - 10}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  }
  days.forEach((d, i) => {
    const x = pad.left + i * slot + (slot - barW) / 2;
    const h = (d.views / yMax) * plotH;
    const top = pad.top + plotH - h;
    const r = Math.min(4, barW / 2, h);
    svg += `<rect class="hit" x="${pad.left + i * slot}" y="${pad.top}" width="${slot}" height="${plotH}" data-i="${i}"/>`;
    if (h > 0) {
      svg += `<path class="bar-mark" data-bar="${i}" d="M${x},${pad.top + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${pad.top + plotH} Z"/>`;
    }
  });
  [0, Math.floor(last / 2), last].forEach((i) => {
    const anchor = i === 0 ? 'start' : i === last ? 'end' : 'middle';
    const x = i === 0 ? pad.left : i === last ? W - pad.right : pad.left + (i + 0.5) * slot;
    svg += `<text class="tick" x="${x}" y="${H - 6}" text-anchor="${anchor}">${i === last ? 'Today' : axisDay.format(new Date(days[i].day))}</text>`;
  });
  box.innerHTML = `${svg}</svg>`;

  const tip = $('[data-tooltip]');
  $$('.hit', box).forEach((hit) => {
    const i = Number(hit.dataset.i);
    const bar = $(`[data-bar="${i}"]`, box);
    hit.addEventListener('pointerenter', () => {
      const d = days[i];
      const r = hit.getBoundingClientRect();
      tip.innerHTML = `${nf.format(d.views)} views<small>${i === last ? 'Today' : longDay.format(new Date(d.day))}</small>`;
      tip.style.left = `${r.left + r.width / 2}px`;
      tip.style.top = `${r.top + r.height - (d.views / yMax) * r.height}px`;
      tip.hidden = false;
      bar?.classList.add('active');
    });
    hit.addEventListener('pointerleave', () => {
      tip.hidden = true;
      bar?.classList.remove('active');
    });
  });
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => charts.forEach((days, box) => { if (box.offsetParent) drawChart(box, days); }), 150);
});

// ---------- overview ----------

async function loadStats() {
  try {
    state.stats = await api('GET', '/stats?days=90');
    renderStats();
    $('[data-updated]').textContent = `Updated ${timeFmt.format(new Date())}`;
  } catch (err) {
    toast(err.message, 'alert');
  }
}

function deltaHtml(cur, prev, label) {
  if (!prev) return `<span>${label}</span>`;
  const pct = Math.round(((cur - prev) / prev) * 100);
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const arrow = pct > 0 ? use('arrow-up') : pct < 0 ? use('arrow-down') : '';
  return `<span class="delta ${cls}">${arrow}${Math.abs(pct)}%</span><span>${label}</span>`;
}

function renderStats() {
  const s = state.stats;
  const days = s.days;
  const yesterday = days.at(-2).views;
  const last7 = sum(days.slice(-7));
  const prev7 = sum(days.slice(-14, -7));
  $('[data-kpi=today]').textContent = nf.format(s.today);
  $('[data-kpi-sub=today]').innerHTML = `<span>Yesterday <strong>${nf.format(yesterday)}</strong></span>`;
  $('[data-kpi=last7]').textContent = compact(last7);
  $('[data-kpi-sub=last7]').innerHTML = deltaHtml(last7, prev7, 'vs previous 7 days');
  $('[data-kpi=total]').textContent = compact(s.totalViews);
  $('[data-kpi-sub=total]').textContent = 'All time, all videos';
  $('[data-kpi=files]').textContent = nf.format(s.files);
  $('[data-kpi-sub=files]').textContent = s.files ? 'Live and shareable' : 'Upload your first video';
  $('[data-video-count]').textContent = s.files ? nf.format(s.files) : '';
  renderOverallChart();
  renderHeader();
}

function renderOverallChart() {
  const days = state.stats.days.slice(-state.overallDays);
  $('[data-range-total]').textContent = `${nf.format(sum(days))} views in the last ${state.overallDays} days`;
  if (state.view === 'overview') drawChart($('[data-chart=overall]'), days);
  else charts.set($('[data-chart=overall]'), days);
}

$('[data-range=overall]').addEventListener('click', (e) => {
  const days = Number(e.target.dataset.days);
  if (!days || !state.stats) return;
  state.overallDays = days;
  setPressed(e.currentTarget, days);
  renderOverallChart();
});

async function loadTop() {
  try {
    const { files } = await api('GET', '/files?sort=today&limit=5');
    const top = files.filter((f) => f.todayViews > 0);
    const max = Math.max(1, ...top.map((f) => f.todayViews));
    $('[data-top]').innerHTML = top.map((f, i) => `
      <li class="top-item" data-id="${f.id}">
        <span class="rank">${i + 1}</span>
        ${thumbHtml(f)}
        <div style="min-width:0">
          <div class="top-name">${esc(f.name)}</div>
          <div class="meter"><span style="width:${Math.max(4, (f.todayViews / max) * 100)}%"></span></div>
        </div>
        <div class="top-count">${nf.format(f.todayViews)}<small>today</small></div>
      </li>`).join('');
    $$('[data-top] .top-item').forEach((li, i) => li.addEventListener('click', () => openDrawer(top[i])));
    $('[data-top-empty]').hidden = top.length > 0;
  } catch (err) {
    toast(err.message, 'alert');
  }
}

// ---------- videos table ----------

let filesBusy = false;
let filesQueued = null; // opts of the last request that arrived while busy (coalesced, not dropped)

async function loadFiles(opts = {}) {
  // One table request at a time: a search/sort/refresh that arrives mid-flight is queued
  // and run once the current call finishes (always with the latest opts), so responses
  // can never interleave and the server sees at most one pending /files call.
  if (filesBusy) {
    filesQueued = opts;
    return;
  }
  filesBusy = true;
  try {
    await loadFilesInner(opts);
    while (filesQueued) {
      const next = filesQueued;
      filesQueued = null;
      await loadFilesInner(next);
    }
  } finally {
    filesBusy = false;
  }
}

async function loadFilesInner({ reset = false, keepCount = false }) {
  const offset = reset ? 0 : state.nextOffset ?? 0;
  const limit = keepCount ? Math.min(100, Math.max(50, state.loaded)) : 50;
  const params = new URLSearchParams({ sort: state.sort, q: state.q, offset, limit });
  const rows = $('[data-rows]');
  if (reset && !state.loaded) rows.innerHTML = skeletonRows(4);
  try {
    const data = await api('GET', `/files?${params}`);
    if (reset) {
      rows.innerHTML = '';
      state.loaded = 0;
    }
    data.files.forEach((f) => rows.append(fileRow(f)));
    state.loaded += data.files.length;
    state.nextOffset = data.nextOffset;
    $('[data-more]').hidden = data.nextOffset === null;
    $('[data-empty]').hidden = state.loaded > 0;
    $('[data-empty-title]').textContent = state.q ? 'No videos match your search' : 'No videos yet';
  } catch (err) {
    toast(err.message, 'alert');
  }
}

function skeletonRows(n) {
  return Array.from({ length: n }, () => `
    <div class="row"><span class="serial skeleton">#00</span>
      <div class="video-cell"><span class="thumb skeleton"></span><div class="video-text" style="flex:1"><div class="video-name skeleton" style="width:60%">.</div><div class="video-meta skeleton" style="width:35%;margin-top:6px">.</div></div></div>
      <span class="num skeleton">00</span><span class="num skeleton">000</span><span class="col-date skeleton">.</span><span></span></div>`).join('');
}

function fileRow(f) {
  const row = document.createElement('div');
  row.className = 'row';
  row.setAttribute('role', 'row');
  row.tabIndex = 0;
  row.dataset.id = f.id;
  row.innerHTML = `
    <span class="serial">#${f.serial}</span>
    <div class="video-cell">
      ${thumbHtml(f)}
      <div class="video-text">
        <div class="video-name"></div>
        <div class="video-meta"><span>${formatBytes(f.size)}</span>${f.status === 'blocked' ? '<span class="badge removed">Removed</span>' : ''}</div>
        <div class="mobile-stats"><strong>${nf.format(f.todayViews)}</strong> today · ${compact(f.views)} total</div>
      </div>
    </div>
    <span class="num today-cell${f.todayViews ? '' : ' zero'}">${nf.format(f.todayViews)}</span>
    <span class="num total-cell">${compact(f.views)}</span>
    <span class="col-date">${uploadedFmt.format(new Date(f.createdAt))}</span>
    <div class="row-actions">
      <button class="icon-btn" type="button" data-copy aria-label="Copy link" title="Copy link">${use('copy')}</button>
      <a class="icon-btn open-btn" href="${esc(f.shareUrl)}" target="_blank" rel="noopener" aria-label="Open share page" title="Open share page">${use('external')}</a>
    </div>`;
  $('.video-name', row).textContent = f.name;
  $('[data-copy]', row).addEventListener('click', (e) => {
    e.stopPropagation();
    copyLink(f.shareUrl);
  });
  $('.open-btn', row).addEventListener('click', (e) => e.stopPropagation());
  row.addEventListener('click', () => openDrawer(f));
  row.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDrawer(f); });
  return row;
}

$('[data-more]').addEventListener('click', () => loadFiles());
$('[data-sort]').addEventListener('change', (e) => {
  state.sort = e.target.value;
  loadFiles({ reset: true });
});
// Debounced search: typing fires no request until the input has been idle for 450ms,
// and an identical query never re-triggers a load (guards the trailing timer + Enter key).
const SEARCH_DEBOUNCE_MS = 450;
let searchTimer;
$('[data-search]').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = e.target.value.trim();
    if (q === state.q) return;
    state.q = q;
    loadFiles({ reset: true });
  }, SEARCH_DEBOUNCE_MS);
});

// ---------- one video (drawer) ----------

const drawer = $('[data-drawer]');

function openDrawer(f) {
  state.current = f;
  state.lastFocus = document.activeElement;
  $('[data-d-serial]').textContent = `Video #${f.serial ?? ''}`;
  $('[data-d-thumb]').innerHTML = f.thumbUrl ? `<img src="${esc(f.thumbUrl)}" alt="">` : '';
  $('[data-d-title]').textContent = f.name;
  $('[data-d-meta]').textContent = `Uploaded ${uploadedFmt.format(new Date(f.createdAt))} · ${formatBytes(f.size)}`;
  $('[data-d-link]').value = f.shareUrl;
  $('[data-d-open]').href = f.shareUrl;
  showRename(false);
  $$('[data-d]', drawer).forEach((el) => { el.textContent = '–'; });
  $('[data-d-table]').innerHTML = '';
  $('[data-chart=video]').innerHTML = '';
  $('[data-scrim]').hidden = false;
  drawer.hidden = false;
  document.body.style.overflow = 'hidden';
  $('[data-d-close]').focus({ focusVisible: false });
  loadVideoStats();
}

function closeDrawer() {
  drawer.hidden = true;
  $('[data-scrim]').hidden = true;
  document.body.style.overflow = '';
  state.current = null;
  $('[data-tooltip]').hidden = true;
  state.lastFocus?.focus?.();
}

async function loadVideoStats() {
  const f = state.current;
  if (!f) return;
  try {
    const s = await api('GET', `/files/${f.id}/stats?days=${state.videoDays}`);
    if (state.current !== f) return;
    if (!f.serial) $('[data-d-serial]').textContent = 'Video';
    const set = (k, v) => { $(`[data-d=${k}]`, drawer).textContent = nf.format(v); };
    set('today', s.today);
    set('yesterday', s.yesterday);
    set('last7', s.last7);
    set('total', s.total);
    drawChart($('[data-chart=video]'), s.days);
    const last = s.days.length - 1;
    const max = Math.max(1, ...s.days.map((d) => d.views));
    $('[data-d-table]').innerHTML = `<div class="day-row head"><span>Date</span><span></span><span class="num">Views</span></div>${s.days.map((d, i) => {
      const label = i === last ? 'Today' : i === last - 1 ? 'Yesterday' : longDay.format(new Date(d.day));
      return `<div class="day-row${i === last ? ' is-today' : ''}"><span>${label}</span><span class="bar"><span style="width:${(d.views / max) * 100}%"></span></span><span class="num${d.views ? '' : ' zero'}">${nf.format(d.views)}</span></div>`;
    }).reverse().join('')}`;
  } catch (err) {
    toast(err.message, 'alert');
  }
}

$('[data-d-close]').addEventListener('click', closeDrawer);
$('[data-scrim]').addEventListener('click', closeDrawer);
$('[data-d-copy]').addEventListener('click', () => copyLink(state.current.shareUrl));
$('[data-range=video]').addEventListener('click', (e) => {
  const days = Number(e.target.dataset.days);
  if (!days) return;
  state.videoDays = days;
  setPressed(e.currentTarget, days);
  loadVideoStats();
});

function showRename(on) {
  $('[data-d-rename-form]').hidden = !on;
  $('[data-d-title-row]').hidden = on;
  if (on) {
    const input = $('[data-d-rename-form] input');
    input.value = state.current.name;
    input.focus();
    input.select();
  }
}
$('[data-d-rename]').addEventListener('click', () => showRename(true));
$('[data-d-rename-cancel]').addEventListener('click', () => showRename(false));
$('[data-d-rename-form]').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  const f = state.current;
  if (!name || name === f.name) return showRename(false);
  try {
    await api('PATCH', `/files/${f.id}`, { name });
    f.name = name;
    $('[data-d-title]').textContent = name;
    $$(`[data-id="${f.id}"] .video-name, [data-id="${f.id}"] .top-name`).forEach((el) => { el.textContent = name; });
    showRename(false);
    toast('Renamed');
  } catch (err) {
    toast(err.message, 'alert');
  }
});

$('[data-d-delete]').addEventListener('click', async () => {
  const f = state.current;
  if (!confirm(`Delete "${f.name}"?\n\nThe link will stop working and its view history is removed.`)) return;
  try {
    await api('DELETE', `/files/${f.id}`);
    closeDrawer();
    toast('Video deleted');
    refreshAll();
  } catch (err) {
    toast(err.message, 'alert');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!drawer.hidden) closeDrawer();
  else if (!$('[data-upload-modal]').hidden) closeUpload();
});

// ---------- upload ----------

const MIME_BY_EXT = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', '3gp': 'video/3gpp' };
const modal = $('[data-upload-modal]');

function openUpload() {
  modal.hidden = false;
  $('[data-upload-pill]').hidden = true;
}
function closeUpload() {
  modal.hidden = true;
  $('[data-upload-pill]').hidden = state.uploading === 0;
}
$$('[data-upload-open]').forEach((b) => b.addEventListener('click', openUpload));
$('[data-upload-close]').addEventListener('click', closeUpload);
modal.addEventListener('click', (e) => { if (e.target === modal) closeUpload(); });
$('[data-upload-pill]').addEventListener('click', openUpload);

$('[data-file-input]').addEventListener('change', (e) => {
  [...e.target.files].forEach(uploadFile);
  e.target.value = '';
});

// Drop videos on the dialog or anywhere on the page.
let dragDepth = 0;
const dropOverlay = $('[data-drop-overlay]');
const dropzone = $('[data-dropzone]');
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  dragDepth++;
  if (modal.hidden) dropOverlay.hidden = false;
  else dropzone.classList.add('over');
});
window.addEventListener('dragleave', () => {
  if (--dragDepth > 0) return;
  dragDepth = 0;
  dropOverlay.hidden = true;
  dropzone.classList.remove('over');
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  dropzone.classList.remove('over');
  openUpload();
  [...e.dataTransfer.files].forEach(uploadFile);
});

function updatePill() {
  $('[data-upload-pill-text]').textContent = `Uploading ${state.uploading} video${state.uploading === 1 ? '' : 's'}…`;
  $('[data-upload-pill]').hidden = state.uploading === 0 || !modal.hidden;
}

async function uploadFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const mime = file.type || MIME_BY_EXT[ext] || '';
  const item = uploadItem(file.name, file.size);
  if (!mime.startsWith('video/')) return item.fail('Not a video file');

  state.uploading++;
  updatePill();
  try {
    const thumb = await makeThumbnail(file).catch(() => null);
    const start = await api('POST', '/uploads', { name: file.name.replace(/\.[^.]+$/, ''), size: file.size, mime });
    const parts = [];
    const queue = Array.from({ length: start.partCount }, (_, i) => i);
    let sent = 0;
    const worker = async () => {
      while (queue.length) {
        const i = queue.shift();
        const chunk = file.slice(i * start.partSize, (i + 1) * start.partSize);
        parts.push(await retry(() => api('PUT', `/uploads/${start.fileId}/parts/${i + 1}`, chunk)));
        sent += chunk.size;
        item.progress(sent / file.size);
      }
    };
    await Promise.all(Array.from({ length: PARALLEL_PARTS }, worker));
    const done = await api('POST', `/uploads/${start.fileId}/complete`, { parts });
    if (thumb) await api('PUT', `/uploads/${start.fileId}/thumb`, thumb).catch(() => { });
    item.done(done.file.shareUrl);
    toast('Upload complete — your link is ready');
    await refreshAll();
    $(`.row[data-id="${start.fileId}"]`)?.classList.add('fresh');
  } catch (err) {
    item.fail(err.message);
  } finally {
    state.uploading--;
    updatePill();
  }
}

async function retry(fn, tries = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); } catch (err) {
      // A 401 ("Session expired") will never succeed on retry — fail immediately.
      if (err.message === 'Session expired.' || i >= tries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

function uploadItem(name, size) {
  const li = document.createElement('li');
  li.className = 'upload-item';
  li.innerHTML = `<span class="ui-icon">${use('film')}</span>
    <div style="min-width:0"><div class="ui-name"></div><div class="ui-state">${formatBytes(size)} · Preparing…</div><div class="progress"><span></span></div></div>
    <div class="ui-action"></div>`;
  $('.ui-name', li).textContent = name;
  $('[data-upload-list]').prepend(li);
  const stateEl = $('.ui-state', li);
  const bar = $('.progress span', li);
  return {
    progress(p) {
      bar.style.width = `${Math.round(p * 100)}%`;
      stateEl.textContent = `${formatBytes(size)} · ${Math.round(p * 100)}%`;
    },
    done(url) {
      li.classList.add('done');
      $('.ui-icon', li).innerHTML = use('check');
      $('.progress', li).remove();
      stateEl.textContent = 'Uploaded — link ready';
      const btn = document.createElement('button');
      btn.className = 'btn primary sm';
      btn.type = 'button';
      btn.innerHTML = `${use('copy')}Copy link`;
      btn.addEventListener('click', () => copyLink(url));
      $('.ui-action', li).append(btn);
    },
    fail(msg) {
      li.classList.add('failed');
      $('.ui-icon', li).innerHTML = use('alert');
      $('.progress', li)?.remove();
      stateEl.textContent = msg;
    },
  };
}

// Grab a frame ~1s in as the thumbnail (no server-side video processing needed).
function makeThumbnail(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    const finish = (fn, value) => { clearTimeout(timer); URL.revokeObjectURL(url); fn(value); };
    const timer = setTimeout(() => finish(reject, new Error('timeout')), 15000);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onloadedmetadata = () => { video.currentTime = Math.min(1, (video.duration || 2) / 2); };
    video.onseeked = () => {
      const w = 640;
      const h = Math.round((w * video.videoHeight) / video.videoWidth) || 360;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      canvas.toBlob((blob) => (blob ? finish(resolve, blob) : finish(reject, new Error('no frame'))), 'image/jpeg', 0.8);
    };
    video.onerror = () => finish(reject, new Error('unreadable'));
    video.src = url;
  });
}

// ---------- boot ----------

function refreshAll() {
  return Promise.all([
    loadStats(),
    loadTop(),
    state.loaded || state.view === 'videos' ? loadFiles({ reset: true, keepCount: true }) : null,
    state.current ? loadVideoStats() : null,
  ]);
}

$('[data-refresh]').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  await refreshAll();
  btn.disabled = false;
  toast('Up to date');
});

fetch(`${window.API_BASE}/api/app/config`).then((r) => r.json()).then((cfg) => {
  if (!cfg.appName) return;
  state.appName = cfg.appName;
  $$('[data-app-name]').forEach((el) => { el.textContent = cfg.appName; });
  renderHeader();
}).catch(() => { });

route();
loadStats();
loadTop();

// Keep "today" numbers fresh while the page is open (stops once logout has begun).
setInterval(() => { if (!sessionEnded && document.visibilityState === 'visible') refreshAll(); }, REFRESH_MS);
