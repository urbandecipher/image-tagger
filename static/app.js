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

// ── Card Event Handlers ───────────────────────
function onCardClick(e, card, img, idx) {
  if (!state.selectMode) {
    openDetailPanel(img.id);
    return;
  }

  if (e.shiftKey && state.lastClickedIndex !== null) {
    const gallery  = document.getElementById('gallery');
    const cards    = [...gallery.querySelectorAll('.card')];
    const start    = Math.min(state.lastClickedIndex, idx);
    const end      = Math.max(state.lastClickedIndex, idx);
    cards.slice(start, end + 1).forEach(c => {
      const id = Number(c.dataset.id);
      state.selectedIds.add(id);
      c.classList.add('selected');
    });
  } else {
    const id = img.id;
    if (state.selectedIds.has(id)) {
      state.selectedIds.delete(id);
      card.classList.remove('selected');
    } else {
      state.selectedIds.add(id);
      card.classList.add('selected');
    }
    state.lastClickedIndex = idx;
  }
  updateSelectCount();
}

function onCardRightClick(e, card, img) {
  e.preventDefault();
  if (!state.selectMode) return;

  const menu = document.getElementById('ctxMenu');
  menu.style.left = e.clientX + 'px';
  menu.style.top  = e.clientY + 'px';
  menu.classList.remove('hidden');
  menu._targetImg = img;
  document.addEventListener('click', hideCtxMenu, { once: true });
}

function hideCtxMenu() {
  document.getElementById('ctxMenu').classList.add('hidden');
}

// ── Selection System ──────────────────────────
function enterSelectMode() {
  state.selectMode = true;
  document.getElementById('gallery').classList.add('select-mode');
  document.getElementById('btnSelectMode').classList.add('active');
  document.getElementById('selectInfo').classList.remove('hidden');
  updateSelectCount();
}

function exitSelectMode() {
  state.selectMode = false;
  state.selectedIds.clear();
  state.lastClickedIndex = null;
  document.getElementById('gallery').classList.remove('select-mode');
  document.getElementById('btnSelectMode').classList.remove('active');
  document.getElementById('selectInfo').classList.add('hidden');
  document.querySelectorAll('.card.selected').forEach(c => c.classList.remove('selected'));
}

function updateSelectCount() {
  document.getElementById('selectCount').textContent = `■ ${state.selectedIds.size}`;
}

// ── Lasso ─────────────────────────────────────
function bindLasso() {
  const wrap  = document.getElementById('galleryWrap');
  const lasso = document.getElementById('lassoRect');

  wrap.addEventListener('mousedown', (e) => {
    if (!state.selectMode) return;
    if (e.target.closest('.card')) return;
    if (e.button !== 0) return;

    const rect = wrap.getBoundingClientRect();
    const gallery = wrap.querySelector('.gallery');
    state.lassoStart = { x: e.clientX - rect.left, y: e.clientY - rect.top + gallery.scrollTop };
    state.lassoActive = true;
    lasso.style.left   = state.lassoStart.x + 'px';
    lasso.style.top    = state.lassoStart.y + 'px';
    lasso.style.width  = '0px';
    lasso.style.height = '0px';
    lasso.classList.remove('hidden');
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!state.lassoActive) return;
    const rect   = wrap.getBoundingClientRect();
    const gallery = wrap.querySelector('.gallery');
    const curX   = e.clientX - rect.left;
    const curY   = e.clientY - rect.top + gallery.scrollTop;
    const sx     = state.lassoStart.x;
    const sy     = state.lassoStart.y;

    lasso.style.left   = Math.min(sx, curX) + 'px';
    lasso.style.top    = Math.min(sy, curY) + 'px';
    lasso.style.width  = Math.abs(curX - sx) + 'px';
    lasso.style.height = Math.abs(curY - sy) + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!state.lassoActive) return;
    state.lassoActive = false;
    selectCardsInLasso(lasso);
    lasso.classList.add('hidden');
    updateSelectCount();
  });
}

function selectCardsInLasso(lassoEl) {
  const lassoRect = lassoEl.getBoundingClientRect();
  document.querySelectorAll('.card').forEach(card => {
    const r = card.getBoundingClientRect();
    if (rectsOverlap(lassoRect, r)) {
      state.selectedIds.add(Number(card.dataset.id));
      card.classList.add('selected');
    }
  });
}

function rectsOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

// ── Context Menu ──────────────────────────────
function bindContextMenu() {
  document.getElementById('ctxSelectSimilar').addEventListener('click', () => {
    const img = document.getElementById('ctxMenu')._targetImg;
    if (!img || !img.tags) return;
    const topTags = img.tags.slice(0, 3);
    document.querySelectorAll('.card').forEach(card => {
      const cardImg = state.galleryCache.find(i => i.id === Number(card.dataset.id));
      if (!cardImg) return;
      const hasAll = topTags.every(t => cardImg.tags.includes(t));
      if (hasAll) {
        state.selectedIds.add(cardImg.id);
        card.classList.add('selected');
      }
    });
    updateSelectCount();
    hideCtxMenu();
  });

  document.getElementById('ctxInvertSelect').addEventListener('click', () => {
    document.querySelectorAll('.card').forEach(card => {
      const id = Number(card.dataset.id);
      if (state.selectedIds.has(id)) {
        state.selectedIds.delete(id);
        card.classList.remove('selected');
      } else {
        state.selectedIds.add(id);
        card.classList.add('selected');
      }
    });
    updateSelectCount();
    hideCtxMenu();
  });

  document.getElementById('ctxClearSelect').addEventListener('click', () => {
    exitSelectMode();
    enterSelectMode();
    hideCtxMenu();
  });
}

// ── Search ───────────────────────────────────
const TAG_ZH = {};

function parseSearchQuery(raw) {
  const include = [];
  const exclude = [];
  const parts = raw.trim().split(/\s+AND\s+/i);
  parts.forEach(part => {
    const tokens = part.trim().split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.toUpperCase() === 'NOT' && i + 1 < tokens.length) {
        exclude.push(normalizeTag(tokens[++i]));
      } else if (tok.startsWith('-')) {
        exclude.push(normalizeTag(tok.slice(1)));
      } else {
        const normalized = normalizeTag(tok);
        if (normalized) include.push(normalized);
      }
    }
  });
  return { include, exclude };
}

function normalizeTag(raw) {
  const zh = raw.trim();
  if (TAG_ZH[zh]) return TAG_ZH[zh];
  return zh.toLowerCase().replace(/ /g, '_');
}

function bindSearchEvents() {
  const input   = document.getElementById('searchInput');
  const suggest = document.getElementById('searchSuggest');

  input.addEventListener('input', () => {
    const val = input.value.trim();
    const lastTerm = val.split(/\s+/).pop();
    if (!lastTerm || lastTerm.length < 1) {
      suggest.classList.add('hidden');
      return;
    }
    const normalized = normalizeTag(lastTerm);
    const matches = state.allTagCounts
      .filter(t => t.tag.includes(normalized))
      .slice(0, 8);

    if (!matches.length) { suggest.classList.add('hidden'); return; }

    suggest.innerHTML = matches.map((t, i) => `
      <div class="ss-item${i === 0 ? ' active' : ''}" data-tag="${t.tag}">
        <span class="ss-tag">${t.tag}</span>
        <span class="ss-cnt">× ${t.count}</span>
      </div>
    `).join('');
    suggest.classList.remove('hidden');

    suggest.querySelectorAll('.ss-item').forEach(item => {
      item.addEventListener('click', () => acceptSuggestion(input, item.dataset.tag, suggest));
    });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const first = suggest.querySelector('.ss-item');
      if (first) acceptSuggestion(input, first.dataset.tag, suggest);
    }
    if (e.key === 'Enter') {
      suggest.classList.add('hidden');
      executeSearch(input.value);
    }
    if (e.key === 'Escape') suggest.classList.add('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !suggest.contains(e.target))
      suggest.classList.add('hidden');
  });
}

function acceptSuggestion(input, tag, suggest) {
  const parts = input.value.trim().split(/\s+/);
  parts[parts.length - 1] = tag;
  input.value = parts.join(' ') + ' ';
  suggest.classList.add('hidden');
  input.focus();
}

function executeSearch(raw) {
  const { include, exclude } = parseSearchQuery(raw);
  state.searchTags  = include;
  state.excludeTags = exclude;
  state.currentPage = 1;
  loadGallery();
}

// ── Tag Filter Tree ───────────────────────────
const TAG_CATEGORIES = {
  CHARACTER:  ['1girl','2girls','solo','multiple_girls','boy','1boy'],
  HAIR:       ['long_hair','short_hair','twintails','ponytail','blonde_hair','brown_hair','black_hair','blue_hair','red_hair','white_hair','pink_hair','silver_hair'],
  EXPRESSION: ['smile','open_mouth','blush','closed_eyes','tears','angry','serious','expressionless'],
  OUTFIT:     ['dress','skirt','school_uniform','swimsuit','bikini','shirt','jacket','coat'],
  SCENE:      ['outdoors','indoors','sky','ocean','forest','city','classroom','bedroom'],
  QUALITY:    ['masterpiece','best_quality','highres','realistic','anime','detailed'],
};

function buildTagTree() {
  const treeEl = document.getElementById('tagTree');
  treeEl.innerHTML = '';

  Object.entries(TAG_CATEGORIES).forEach(([cat, defaultTags]) => {
    const catTags = state.allTagCounts
      .filter(t => defaultTags.includes(t.tag))
      .slice(0, 12);

    if (!catTags.length) return;

    const section = document.createElement('div');
    section.className = 'tag-category';
    section.innerHTML = `
      <div class="tag-cat-header">${cat} <span>▾</span></div>
      <div class="tag-cat-list">
        ${catTags.map(t => `
          <div class="ftag${state.searchTags.includes(t.tag) ? ' active' : ''}"
               data-tag="${t.tag}">
            ${t.tag} <span class="ftag-cnt">${t.count}</span>
          </div>
        `).join('')}
      </div>
    `;

    section.querySelectorAll('.ftag').forEach(ftag => {
      ftag.addEventListener('click', () => toggleFilterTag(ftag.dataset.tag, ftag));
    });

    treeEl.appendChild(section);
  });
}

function toggleFilterTag(tag, el) {
  const idx = state.searchTags.indexOf(tag);
  if (idx >= 0) {
    state.searchTags.splice(idx, 1);
    el.classList.remove('active');
  } else {
    state.searchTags.push(tag);
    state.excludeTags = [];
    el.classList.add('active');
  }
  updateFilterSummary();
  state.currentPage = 1;
  loadGallery();
}

function updateFilterSummary() {
  const exprEl  = document.getElementById('filterExpr');
  const clearEl = document.getElementById('btnClearFilter');
  const searchEl = document.getElementById('searchInput');

  if (state.searchTags.length) {
    exprEl.textContent  = state.searchTags.join(' AND ');
    searchEl.value      = state.searchTags.join(' AND ');
    clearEl.classList.remove('hidden');
  } else {
    exprEl.textContent = '— 無 —';
    searchEl.value     = '';
    clearEl.classList.add('hidden');
  }
}

function bindFilterClearEvent() {
  document.getElementById('btnClearFilter').addEventListener('click', () => {
    state.searchTags  = [];
    state.excludeTags = [];
    document.getElementById('searchInput').value = '';
    document.querySelectorAll('.ftag.active').forEach(f => f.classList.remove('active'));
    updateFilterSummary();
    state.currentPage = 1;
    loadGallery();
  });
}

// ── Detail Panel ──────────────────────────────
async function openDetailPanel(imageId) {
  try {
    const img = await GET(`/api/image/${imageId}`);
    state.detImageId      = imageId;
    state.detOriginalTags = [...(img.tags ?? [])];
    state.detStagedRemove.clear();
    state.detStagedAdd    = [];
    renderDetailPanel(img);
    document.getElementById('detPanel').classList.remove('hidden');
  } catch {
    toast('載入圖片資訊失敗', 'error');
  }
}

function renderDetailPanel(img) {
  const imgEl = document.getElementById('detImg');
  imgEl.src   = `/api/full/${img.id}`;
  document.getElementById('detTitle').textContent = `◈ ${(img.path ?? '').split(/[\\/]/).pop()}`;

  const filename = (img.path ?? '').split(/[\\/]/).pop();
  const avgConf  = img.avg_confidence != null ? img.avg_confidence.toFixed(2) : '—';
  document.getElementById('detMeta').innerHTML = `
    <div class="det-meta-row"><span class="det-meta-key">FILE</span><span class="det-meta-val" title="${filename}">${filename.slice(0, 24)}${filename.length > 24 ? '…' : ''}</span></div>
    <div class="det-meta-row"><span class="det-meta-key">TAGS</span><span class="det-meta-val">${(img.tags ?? []).length}</span></div>
    <div class="det-meta-row"><span class="det-meta-key">CONF AVG</span><span class="det-meta-val">${avgConf}</span></div>
    <div class="det-meta-row"><span class="det-meta-key">TAGGED</span><span class="det-meta-val">${img.tagged ? 'YES' : 'NO'}</span></div>
  `;

  renderDetTags(img.tags ?? []);
}

function renderDetTags(tags) {
  const list = document.getElementById('detTagList');
  list.innerHTML = '';
  document.getElementById('detTagCount').textContent = tags.length + state.detStagedAdd.length;

  tags.forEach(tag => {
    const el = document.createElement('div');
    const isRemove = state.detStagedRemove.has(tag);
    el.className = `dtag${isRemove ? ' staged-remove' : ''}`;
    el.dataset.tag = tag;
    el.innerHTML = `${tag} <span class="dtag-del">✕</span>`;
    el.querySelector('.dtag-del').addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.detStagedRemove.has(tag)) {
        state.detStagedRemove.delete(tag);
        el.classList.remove('staged-remove');
      } else {
        state.detStagedRemove.add(tag);
        el.classList.add('staged-remove');
      }
      const effective = state.detOriginalTags.length - state.detStagedRemove.size + state.detStagedAdd.length;
      document.getElementById('detTagCount').textContent = effective;
    });
    list.appendChild(el);
  });

  state.detStagedAdd.forEach(tag => {
    const el = document.createElement('div');
    el.className = 'dtag staged-add';
    el.dataset.tag = tag;
    el.innerHTML = `${tag} <span class="dtag-del">✕</span>`;
    el.querySelector('.dtag-del').addEventListener('click', (e) => {
      e.stopPropagation();
      state.detStagedAdd = state.detStagedAdd.filter(t => t !== tag);
      renderDetTags(state.detOriginalTags);
    });
    list.appendChild(el);
  });
}

function addStagedTag(tag) {
  if (state.detOriginalTags.includes(tag) || state.detStagedAdd.includes(tag)) return;
  state.detStagedAdd.push(tag);
  renderDetTags(state.detOriginalTags);
}

async function saveDetPanel() {
  if (state.detImageId === null) return;

  const finalTags = [
    ...state.detOriginalTags.filter(t => !state.detStagedRemove.has(t)),
    ...state.detStagedAdd,
  ];

  try {
    await PUT('/api/image/tags', { image_id: state.detImageId, tags: finalTags });
    state.detOriginalTags = finalTags;
    state.detStagedRemove.clear();
    state.detStagedAdd = [];
    renderDetTags(finalTags);
    toast('儲存成功');
    loadGallery();
  } catch {
    toast('儲存失敗', 'error');
  }
}

function bindDetAddInput() {
  const input   = document.getElementById('detAddInput');
  const suggest = document.getElementById('detAddSuggest');

  input.addEventListener('input', () => {
    const val = normalizeTag(input.value.trim());
    if (!val) { suggest.classList.add('hidden'); return; }

    const matches = state.allTagCounts
      .filter(t => t.tag.includes(val) && !state.detOriginalTags.includes(t.tag) && !state.detStagedAdd.includes(t.tag))
      .slice(0, 6);

    if (!matches.length) { suggest.classList.add('hidden'); return; }

    suggest.innerHTML = matches.map((t, i) => `
      <div class="das-item${i === 0 ? ' active' : ''}" data-tag="${t.tag}">
        <span>${t.tag}</span><span class="ss-cnt">× ${t.count}</span>
      </div>
    `).join('');
    suggest.classList.remove('hidden');

    suggest.querySelectorAll('.das-item').forEach(item => {
      item.addEventListener('click', () => {
        addStagedTag(item.dataset.tag);
        input.value = '';
        suggest.classList.add('hidden');
      });
    });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const tag = normalizeTag(input.value.trim());
      if (tag) { addStagedTag(tag); input.value = ''; suggest.classList.add('hidden'); }
    }
    if (e.key === 'Escape') suggest.classList.add('hidden');
    if (e.key === 'Tab') {
      e.preventDefault();
      const first = suggest.querySelector('.das-item');
      if (first) {
        addStagedTag(first.dataset.tag);
        input.value = '';
        suggest.classList.add('hidden');
      }
    }
  });
}

function bindDetPanelEvents() {
  document.getElementById('detClose').addEventListener('click', () => {
    if (state.detStagedRemove.size || state.detStagedAdd.length) {
      if (!confirm('有未儲存的 tag 變更，確定關閉？')) return;
    }
    document.getElementById('detPanel').classList.add('hidden');
    state.detImageId = null;
  });

  document.getElementById('detBtnSave').addEventListener('click', saveDetPanel);

  document.getElementById('detBtnReveal').addEventListener('click', async () => {
    if (state.detImageId === null) return;
    try { await GET(`/api/reveal/${state.detImageId}`); } catch {}
  });

  document.getElementById('detImg').addEventListener('click', () => {
    const lb = document.getElementById('lightbox');
    document.getElementById('lightboxImg').src = document.getElementById('detImg').src;
    lb.classList.remove('hidden');
  });

  document.getElementById('lightboxClose').addEventListener('click', () => {
    document.getElementById('lightbox').classList.add('hidden');
  });

  document.getElementById('lightbox').addEventListener('click', (e) => {
    if (e.target === e.currentTarget)
      document.getElementById('lightbox').classList.add('hidden');
  });

  bindDetAddInput();
}

async function navigateDetail(dir) {
  const cards = [...document.querySelectorAll('.card')];
  const cur = cards.findIndex(c => Number(c.dataset.id) === state.detImageId);
  const next = cards[cur + dir];
  if (next) openDetailPanel(Number(next.dataset.id));
}

// ── bindEvents stub (full impl in Task 9) ─────────────
// Task 9 must call: bindThemeEvents, bindSidebarEvents, bindScanEvents,
// bindSearchEvents, bindFilterClearEvent, bindContextMenu,
// bindDetPanelEvents, bindBulkEvents, bindLasso, bindKeyboardShortcuts,
// bindAddCollectionEvent
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
