/* ═══════════════════════════════════════════════
   IMAGE TAG STUDIO v2 — app.js
═══════════════════════════════════════════════ */
'use strict';

// ── Global State ──────────────────────────────
const state = {
  // Config
  theme: 'tactical',
  threshold: 0.35,
  lastFolder: '',
  cardMinWidth: 120,
  perPage: 50,

  // Gallery
  currentPage: 1,
  totalImages: 0,
  currentCollectionId: null,
  uncollectedMode: false,
  searchTags: [],
  excludeTags: [],
  allTagCounts: [],

  // Collections
  collections: [],

  // Selection
  selectMode: false,
  selectedIds: new Set(),
  lastClickedIndex: null,

  // Detail Panel
  detImageId: null,
  detStagedRemove: new Set(),
  detStagedAdd: [],
  detOriginalTags: [],

  // Gallery cache (for context menu)
  galleryCache: [],

  // Lasso
  lassoStart: null,
  lassoActive: false,

  // Tagging job
  tagJobRunning: false,
};

// ── API Helpers ───────────────────────────────
async function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

const GET  = (path)       => api('GET',    path);
const POST = (path, body) => api('POST',   path, body);
const PUT  = (path, body) => api('PUT',    path, body);
const DEL  = (path, body) => api('DELETE', path, body);

// ── Toast ─────────────────────────────────────
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = msg;
  const container = document.getElementById('toastContainer');
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Theme ─────────────────────────────────────
const THEME_LABELS = {
  tactical: '⊙ TACTICAL',
  hud:      '◈ HUD',
  cyber:    '▶ CYBER',
};

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('themeLabel').textContent = THEME_LABELS[theme] || theme;
  document.querySelectorAll('.theme-card').forEach(c => {
    c.classList.toggle('active', c.dataset.theme === theme);
  });
}

function saveTheme(theme) {
  applyTheme(theme);
  localStorage.setItem('its-theme', theme);
  POST('/api/config', {
    last_folder: state.lastFolder,
    threshold: state.threshold,
    theme,
  }).catch(() => {});
}

function bindThemeEvents() {
  const switcher = document.getElementById('themeSwitcher');
  const menu     = document.getElementById('themeMenu');

  switcher.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });

  document.querySelectorAll('.theme-option').forEach(opt => {
    opt.addEventListener('click', () => {
      saveTheme(opt.dataset.theme);
      menu.classList.add('hidden');
    });
  });

  document.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', () => saveTheme(card.dataset.theme));
  });

  document.addEventListener('click', () => menu.classList.add('hidden'));
}

// ── Config Load ───────────────────────────────
async function loadConfig() {
  try {
    const cfg = await GET('/api/config');
    state.threshold  = cfg.threshold  ?? 0.35;
    state.lastFolder = cfg.last_folder ?? '';
    const savedTheme = localStorage.getItem('its-theme') || cfg.theme || 'tactical';
    applyTheme(savedTheme);

    ['confSlider', 'confSlider2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = state.threshold;
    });
    ['confValue', 'confValue2'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = state.threshold;
    });

    if (state.lastFolder) {
      document.getElementById('folderPath').textContent = state.lastFolder;
      const scanInput = document.getElementById('scanFolderInput');
      if (scanInput) scanInput.value = state.lastFolder;
    }
  } catch (e) {
    console.warn('Config load failed', e);
  }
}

// ── Stats ─────────────────────────────────────
async function loadStats() {
  try {
    const s = await GET('/api/stats');
    document.getElementById('statFiles').textContent  = s.total  ?? 0;
    document.getElementById('statTagged').textContent = s.tagged ?? 0;
  } catch {}
}

// ── Utility ───────────────────────────────────
function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ── Collections ───────────────────────────────
async function loadCollections() {
  try {
    const data = await GET('/api/collections');
    state.collections = data.collections ?? [];

    const tabsEl = document.getElementById('colTabs');
    tabsEl.innerHTML = '';

    const allTab = createTab('ALL', null);
    tabsEl.appendChild(allTab);
    allTab.classList.add('active');

    const uncolCount = data.uncollected ?? 0;
    tabsEl.appendChild(createTab(`UNCOLLECTED (${uncolCount})`, '__uncollected__'));

    state.collections.forEach(col => {
      tabsEl.appendChild(createTab(`${col.name} (${col.count})`, col.id));
    });

    document.getElementById('statCols').textContent = state.collections.length;
  } catch (e) {
    toast('載入 Collection 失敗', 'error');
  }
}

function createTab(label, colId) {
  const btn = document.createElement('button');
  btn.className = 'col-tab';
  btn.textContent = label;
  btn.dataset.colId = colId ?? '';
  btn.addEventListener('click', () => switchCollection(btn, colId));
  return btn;
}

function switchCollection(tabEl, colId) {
  document.querySelectorAll('.col-tab').forEach(t => t.classList.remove('active'));
  tabEl.classList.add('active');
  state.currentPage = 1;
  if (colId === '__uncollected__') {
    state.currentCollectionId = null;
    state.uncollectedMode = true;
  } else {
    state.currentCollectionId = colId;
    state.uncollectedMode = false;
  }
  loadAllTags().then(buildTagTree);
  loadGallery();
}

// ── All Tags ──────────────────────────────────
async function loadAllTags() {
  try {
    const params = new URLSearchParams();
    if (state.currentCollectionId !== null && !state.uncollectedMode)
      params.set('collection_id', state.currentCollectionId);
    if (state.uncollectedMode) params.set('uncollected', 'true');

    const data = await GET(`/api/tags/all?${params}`);
    state.allTagCounts = data.tags ?? [];
  } catch {}
}

// ── Gallery ───────────────────────────────────
async function loadGallery() {
  const params = new URLSearchParams({
    page:     state.currentPage,
    per_page: state.perPage,
  });

  if (state.currentCollectionId !== null && !state.uncollectedMode)
    params.set('collection_id', state.currentCollectionId);
  if (state.uncollectedMode) params.set('uncollected', 'true');
  if (state.searchTags.length)
    params.set('tags', state.searchTags.join(','));

  try {
    const data = await GET(`/api/images?${params}`);
    let images = data.images ?? [];

    if (state.excludeTags.length) {
      images = images.filter(img =>
        !state.excludeTags.some(ex => img.tags.includes(ex))
      );
    }

    state.totalImages = data.total ?? 0;
    state.galleryCache = images;
    renderGallery(images);
    renderPagination(data.total ?? 0);
    loadStats();
  } catch (e) {
    toast('Gallery 載入失敗', 'error');
  }
}

function renderGallery(images) {
  const gallery = document.getElementById('gallery');
  gallery.style.setProperty('--card-min-width', `${state.cardMinWidth}px`);
  gallery.innerHTML = '';

  if (!images.length) {
    gallery.innerHTML = '<div class="gallery-empty">◎ NO RESULTS</div>';
    return;
  }

  images.forEach((img, idx) => gallery.appendChild(createCard(img, idx)));
}

function createCard(img, idx) {
  const card = document.createElement('div');
  card.className = `card${state.selectedIds.has(img.id) ? ' selected' : ''}`;
  card.dataset.id  = img.id;
  card.dataset.idx = idx;

  const filename = img.path.split(/[\\/]/).pop();
  card.innerHTML = `
    <img class="card-thumb" src="/api/thumb/${img.id}" alt="" loading="lazy">
    <div class="card-check">✓</div>
    <div class="card-hover-info">${filename} · ${img.tags.length}T</div>
    <div class="card-foot">
      <span>${truncate(filename, 10)}</span>
      <span>${img.tags.length}T</span>
    </div>
  `;

  card.addEventListener('click',       (e) => onCardClick(e, card, img, idx));
  card.addEventListener('contextmenu', (e) => onCardRightClick(e, card, img));
  return card;
}

// ── Pagination ────────────────────────────────
function renderPagination(total) {
  const totalPages = Math.ceil(total / state.perPage);
  const pg = document.getElementById('pagination');
  pg.innerHTML = '';
  if (totalPages <= 1) {
    if (total > 0) {
      const info = document.createElement('span');
      info.className = 'pg-info';
      info.textContent = `${total} RESULTS`;
      pg.appendChild(info);
    }
    return;
  }

  const cur = state.currentPage;

  const info = document.createElement('span');
  info.className = 'pg-info';
  info.textContent = `${total} RESULTS`;
  pg.appendChild(info);

  function addBtn(label, page, isActive) {
    const btn = document.createElement('button');
    btn.className = `pg-btn${isActive ? ' active' : ''}`;
    btn.textContent = label;
    btn.addEventListener('click', () => {
      state.currentPage = page;
      loadGallery();
    });
    pg.appendChild(btn);
  }

  addBtn('◀', Math.max(1, cur - 1), false);

  const pages = getPaginationPages(cur, totalPages);
  let last = 0;
  pages.forEach(p => {
    if (p - last > 1) {
      const dots = document.createElement('span');
      dots.className = 'pg-info';
      dots.textContent = '…';
      pg.appendChild(dots);
    }
    addBtn(p, p, p === cur);
    last = p;
  });

  addBtn('▶', Math.min(totalPages, cur + 1), false);
}

function getPaginationPages(cur, total) {
  const delta = 2;
  const pages = new Set([1, total]);
  for (let i = Math.max(2, cur - delta); i <= Math.min(total - 1, cur + delta); i++)
    pages.add(i);
  return [...pages].sort((a, b) => a - b);
}

// ── Stub card event handlers (defined in Task 7 & 8) ──
function onCardClick(e, card, img, idx) {}
function onCardRightClick(e, card, img) {}

// ── Tag Filter Tree (stub, full impl in Task 6) ────────
function buildTagTree() {}

// ── bindEvents stub (full impl in Task 9) ─────────────
function bindEvents() {}

// ── Init ──────────────────────────────────────
async function init() {
  await loadConfig();
  await loadStats();
  await loadCollections();
  await loadAllTags();
  await loadGallery();
  buildTagTree();
  bindEvents();
}

document.addEventListener('DOMContentLoaded', init);
