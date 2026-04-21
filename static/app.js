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

  // Tag tree
  collapsedCategories: new Set(),

  // Chart
  chartDrillCategory: null,
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
  document.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', () => saveTheme(card.dataset.theme));
  });
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
    state.allTagCounts = Array.isArray(data) ? data : (data.tags ?? []);
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
    params.set('query', state.searchTags.join(','));

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
  updateFilterSummary();
  updateTagSelectedBadge();
  loadGallery();
  buildTagTree();
  syncChartIfOpen();
}

function syncChartIfOpen() {
  const modal = document.getElementById('chartModal');
  if (modal && !modal.classList.contains('hidden')) {
    buildSunburstChart();
    renderChartActiveTags();
  }
}

function updateTagSelectedBadge() {
  const badge = document.getElementById('tagSelectedBadge');
  const btn   = document.getElementById('btnClearTagSel');
  if (!badge || !btn) return;
  const n = state.searchTags.length;
  if (n > 0) {
    badge.textContent = n;
    badge.classList.remove('hidden');
    btn.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
    btn.classList.add('hidden');
  }
}

// ── Tag Filter Tree ───────────────────────────
const TAG_CATEGORIES = [
  { id: 'character', label: '人物',
    keys: ['1girl','2girls','3girls','4girls','5girls','6+girls','1boy','2boys','3boys','multiple girls','multiple boys','solo','couple','androgynous'] },
  { id: 'hair', label: '髮型/髮色',
    keys: ['hair','twintails','ponytail','braid','bun','bangs','ahoge','ringlets','bob cut','drill hair','hair down','hair up','hair between eyes'] },
  { id: 'eyes', label: '眼睛',
    keys: ['eyes','eye','pupil','iris','eyelash','eyebrow','wink','heterochromia','tsurime','tareme'] },
  { id: 'expression', label: '表情',
    keys: ['smile','grin','smirk','laugh','crying','tears','blush','angry','sad','serious','pout','open mouth','closed eyes','half-closed eyes','tongue out','expressionless','surprised','embarrassed'] },
  { id: 'outfit', label: '服裝',
    keys: ['dress','skirt','shirt','jacket','coat','uniform','swimsuit','bikini','pants','shorts','hoodie','sweater','gloves','socks','stockings','boots','shoes','sandals','hat','cap','headband','ribbon','bow','collar','apron','vest','cloak','robe','bra','thighhighs','leotard','armor','kimono','yukata','maid','nurse','sailor','lingerie','underwear','choker','necktie','scarf'] },
  { id: 'body', label: '體型/身體',
    keys: ['breast','chest','navel','belly','stomach','waist','hips','thigh','barefoot','bare shoulders','bare back','abs','muscle','nude','naked','topless','skin'] },
  { id: 'pose', label: '姿勢/動作',
    keys: ['sitting','standing','lying','running','walking','jumping','kneeling','floating','leaning','bending','holding','hugging','kissing','dancing','looking at viewer','looking back','from behind','from above','from below','arms up','on back','on stomach','outstretched arms','spread arms','reaching out'] },
  { id: 'scene', label: '場景',
    keys: ['outdoors','indoors','sky','ocean','sea','beach','forest','city','street','building','classroom','bedroom','kitchen','bathroom','park','garden','mountain','snow','rain','scenery','landscape','grass','cloud','tree','water','river','lake','ruins','shrine','temple','field','night sky'] },
  { id: 'lighting', label: '光照',
    keys: ['sunlight','moonlight','candlelight','sunset','sunrise','neon','rim light','backlight','spotlight','sparkle','reflection','bokeh','depth of field','glowing','fire','lens flare','bloom','light rays','dark background','white background','gradient background','simple background','starry sky'] },
  { id: 'camera', label: '鏡頭/構圖',
    keys: ['close-up','full body','upper body','lower body','cowboy shot','bust shot','portrait','dutch angle','from side','pov','fisheye','wide shot','face focus','head focus','torso shot'] },
  { id: 'quality', label: '畫質',
    keys: ['masterpiece','best quality','highres','ultra-detailed','detailed','absurdres','intricate','sharp focus','blurry','noisy','8k','4k','high quality','extremely detailed'] },
  { id: 'style', label: '風格',
    keys: ['realistic','anime','cartoon','digital art','oil painting','watercolor','sketch','line art','flat color','photorealistic','cel shading','chibi','pixel art','illustration','painting','rendered','3d'] },
];

// word-boundary match: keyword must appear as whole word(s) within tag
function tagBelongsTo(tag, keys) {
  const t = tag.toLowerCase();
  return keys.some(k => {
    const kl = k.toLowerCase();
    if (t === kl) return true;
    const idx = t.indexOf(kl);
    if (idx === -1) return false;
    const before = idx === 0 || t[idx - 1] === ' ';
    const after  = idx + kl.length === t.length || t[idx + kl.length] === ' ';
    return before && after;
  });
}

function buildTagTree() {
  const listEl = document.getElementById('tagAllList');
  if (!listEl) return;
  listEl.innerHTML = '';

  const query = (document.getElementById('tagSearchInput')?.value ?? '').toLowerCase().trim();
  const badge = document.getElementById('tagCountBadge');
  if (badge) badge.textContent = state.allTagCounts.length;

  // 分配 tags 至各 category（先到先得，避免重複）
  const assigned = new Set();
  const catData = TAG_CATEGORIES.map(cat => {
    let tags = state.allTagCounts.filter(t => {
      if (assigned.has(t.tag)) return false;
      return tagBelongsTo(t.tag, cat.keys);
    });
    tags.forEach(t => assigned.add(t.tag));
    if (query) tags = tags.filter(t => t.tag.includes(query));
    return { ...cat, tags };
  });

  // 未分類的 tags 歸入「其他」
  let otherTags = state.allTagCounts.filter(t => !assigned.has(t.tag));
  if (query) otherTags = otherTags.filter(t => t.tag.includes(query));
  if (otherTags.length) catData.push({ id: 'other', label: '其他', tags: otherTags });

  catData.forEach(cat => {
    if (!cat.tags.length) return;

    const isCollapsed = state.collapsedCategories.has(cat.id);
    const section = document.createElement('div');
    section.className = 'tag-category';

    // header
    const header = document.createElement('div');
    header.className = 'tag-cat-header';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = cat.label;
    const cntSpan = document.createElement('span');
    cntSpan.className = 'tag-cat-cnt';
    cntSpan.textContent = cat.tags.length;
    const toggleSpan = document.createElement('span');
    toggleSpan.className = 'tag-cat-toggle';
    toggleSpan.textContent = isCollapsed ? '▸' : '▾';
    header.appendChild(labelSpan);
    header.appendChild(cntSpan);
    header.appendChild(toggleSpan);

    // tag list
    const tagList = document.createElement('div');
    tagList.className = 'tag-cat-list' + (isCollapsed ? ' collapsed' : '');

    cat.tags.forEach(t => {
      const el = document.createElement('div');
      el.className = 'ftag' + (state.searchTags.includes(t.tag) ? ' active' : '');
      el.dataset.tag = t.tag;
      el.textContent = t.tag;
      const cnt = document.createElement('span');
      cnt.className = 'ftag-cnt';
      cnt.textContent = t.count;
      el.appendChild(cnt);
      el.addEventListener('click', () => toggleFilterTag(t.tag, el));
      tagList.appendChild(el);
    });

    header.addEventListener('click', () => {
      if (state.collapsedCategories.has(cat.id)) {
        state.collapsedCategories.delete(cat.id);
        tagList.classList.remove('collapsed');
        toggleSpan.textContent = '▾';
      } else {
        state.collapsedCategories.add(cat.id);
        tagList.classList.add('collapsed');
        toggleSpan.textContent = '▸';
      }
    });

    section.appendChild(header);
    section.appendChild(tagList);
    listEl.appendChild(section);
  });
}

// ── Sunburst Chart ────────────────────────────
const CHART_PALETTE = [
  '#7eb8e8','#7cc4a0','#f0a070','#d88ec8','#94c8e0',
  '#e8c86a','#a8c090','#e89890','#88b8d8','#c8a8e8',
  '#98d8c8','#d8b870','#b8d898'
];

function getChartCatData() {
  const assigned = new Set();
  const cats = TAG_CATEGORIES.map((cat, i) => {
    const tags = state.allTagCounts.filter(t => {
      if (assigned.has(t.tag)) return false;
      return tagBelongsTo(t.tag, cat.keys);
    });
    tags.forEach(t => assigned.add(t.tag));
    return { ...cat, tags, color: CHART_PALETTE[i % CHART_PALETTE.length] };
  }).filter(c => c.tags.length > 0);
  const otherTags = state.allTagCounts.filter(t => !assigned.has(t.tag));
  if (otherTags.length) cats.push({
    id: 'other', label: '其他', tags: otherTags,
    color: CHART_PALETTE[cats.length % CHART_PALETTE.length]
  });
  return cats;
}

function buildSunburstChart() {
  const wrap = document.getElementById('tagChartWrap');
  if (!wrap || wrap.classList.contains('hidden')) return;
  wrap.innerHTML = '';
  if (!state.allTagCounts.length) return;

  const catData = getChartCatData();
  const drillCat = state.chartDrillCategory
    ? catData.find(c => c.id === state.chartDrillCategory) : null;
  const displayCats = drillCat ? [drillCat] : catData;
  const grandTotal = displayCats.reduce((s, c) =>
    s + c.tags.reduce((ts, t) => ts + t.count, 0), 0) || 1;

  const W = 500, cx = W / 2, cy = W / 2;
  const innerR = 88, midR = 188, outerR = 228;
  const ns = 'http://www.w3.org/2000/svg';

  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.style.cssText = 'display:block;overflow:visible;';

  function pt(r, a) { return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; }

  function arcPath(r1, r2, a1, a2) {
    const span = a2 - a1;
    if (span >= Math.PI * 2 - 0.001) {
      const [ax, ay] = pt(r1, a1); const [bx, by] = pt(r2, a1);
      const [cx2, cy2] = pt(r2, a1 + Math.PI); const [dx, dy] = pt(r1, a1 + Math.PI);
      return `M${ax},${ay} L${bx},${by} A${r2},${r2} 0 1,1 ${cx2},${cy2} A${r2},${r2} 0 1,1 ${bx},${by} Z`;
    }
    const lg = span > Math.PI ? 1 : 0;
    const [x1,y1]=pt(r1,a1),[x2,y2]=pt(r2,a1),[x3,y3]=pt(r2,a2),[x4,y4]=pt(r1,a2);
    return `M${x1},${y1} L${x2},${y2} A${r2},${r2} 0 ${lg},1 ${x3},${y3} L${x4},${y4} A${r1},${r1} 0 ${lg},0 ${x1},${y1} Z`;
  }

  function mkEl(tag, attrs) {
    const el = document.createElementNS(ns, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  let startAngle = -Math.PI / 2;

  displayCats.forEach(cat => {
    const catTotal = cat.tags.reduce((s, t) => s + t.count, 0) || 1;
    const catAngle = (catTotal / grandTotal) * Math.PI * 2;
    const endAngle = startAngle + catAngle;
    const midAng = (startAngle + endAngle) / 2;
    const isActive = state.chartDrillCategory === cat.id;

    // Inner ring arc
    const inner = mkEl('path', {
      d: arcPath(innerR, midR, startAngle, endAngle),
      fill: cat.color, 'fill-opacity': isActive ? '0.9' : '0.7',
      stroke: 'var(--bg)', 'stroke-width': '1.5'
    });
    inner.style.cursor = 'pointer';
    inner.addEventListener('mouseenter', () => inner.setAttribute('fill-opacity', '1'));
    inner.addEventListener('mouseleave', () => inner.setAttribute('fill-opacity', isActive ? '0.9' : '0.7'));
    inner.addEventListener('click', e => {
      e.stopPropagation();
      state.chartDrillCategory = isActive ? null : cat.id;
      buildSunburstChart();
      buildChartLegend();
    });
    svg.appendChild(inner);

    // Category label
    if (catAngle > 0.22) {
      const lr = (innerR + midR) / 2;
      const [lx, ly] = pt(lr, midAng);
      svg.appendChild(mkEl('text', {
        x: lx, y: ly, 'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': catAngle > 0.55 ? '18' : '14', 'font-weight': '600',
        fill: '#fff', 'pointer-events': 'none'
      })).textContent = cat.label;
    }

    // Outer ring: tag arcs
    const showTags = drillCat
      ? cat.tags
      : cat.tags.slice(0, Math.max(3, Math.ceil(catAngle / (Math.PI * 2) * 45)));
    const tagTotalW = showTags.reduce((s, t) => s + t.count, 0) || 1;
    let tagStart = startAngle;

    showTags.forEach(t => {
      const tagAngle = (t.count / tagTotalW) * catAngle;
      const tagEnd = tagStart + tagAngle;
      if (tagAngle < 0.01) { tagStart = tagEnd; return; }

      const active = state.searchTags.includes(t.tag);
      const baseOp = active ? '1' : '0.38';
      const outer = mkEl('path', {
        d: arcPath(midR + 2, outerR, tagStart, tagEnd),
        fill: cat.color, 'fill-opacity': baseOp,
        stroke: 'var(--bg)', 'stroke-width': '0.8'
      });
      outer.style.cursor = 'pointer';
      outer.dataset.tag = t.tag;
      outer.dataset.baseOp = baseOp;
      outer.addEventListener('mouseenter', () => {
        outer.setAttribute('fill-opacity', '0.9');
        showChartTooltip(t.tag, t.count, active);
      });
      outer.addEventListener('mouseleave', () => {
        outer.setAttribute('fill-opacity', outer.dataset.baseOp);
        hideChartTooltip();
      });
      outer.addEventListener('click', e => { e.stopPropagation(); toggleChartTag(t.tag); });
      svg.appendChild(outer);
      tagStart = tagEnd;
    });

    startAngle = endAngle;
  });

  // Center circle
  const bg = mkEl('circle', {
    cx, cy, r: innerR - 4,
    fill: 'var(--surface2)', stroke: 'var(--border)', 'stroke-width': '2'
  });
  if (drillCat) {
    bg.style.cursor = 'pointer';
    bg.addEventListener('click', () => { state.chartDrillCategory = null; buildSunburstChart(); buildChartLegend(); });
  }
  svg.appendChild(bg);

  // Center text
  const ct = mkEl('text', { x: cx, y: cy, 'text-anchor': 'middle', 'pointer-events': 'none' });
  if (drillCat) {
    const t1 = mkEl('tspan', { x: cx, dy: '-14', 'font-size': '16', fill: 'var(--text3)' });
    t1.textContent = '↩ 返回';
    const t2 = mkEl('tspan', { x: cx, dy: '28', 'font-size': '22', 'font-weight': '700', fill: 'var(--text)' });
    t2.textContent = drillCat.label;
    ct.appendChild(t1); ct.appendChild(t2);
  } else {
    const t1 = mkEl('tspan', { x: cx, dy: '-14', 'font-size': '36', 'font-weight': '700', fill: 'var(--text)' });
    t1.textContent = state.allTagCounts.length;
    const t2 = mkEl('tspan', { x: cx, dy: '28', 'font-size': '18', fill: 'var(--text3)' });
    t2.textContent = 'TAGS';
    ct.appendChild(t1); ct.appendChild(t2);
  }
  svg.appendChild(ct);
  wrap.appendChild(svg);
}

function toggleChartTag(tag) {
  const idx = state.searchTags.indexOf(tag);
  if (idx >= 0) state.searchTags.splice(idx, 1);
  else { state.searchTags.push(tag); state.excludeTags = []; }
  updateFilterSummary();
  updateTagSelectedBadge();
  state.currentPage = 1;
  loadGallery();
  document.querySelectorAll('#tagChartWrap path[data-tag]').forEach(p => {
    const op = state.searchTags.includes(p.dataset.tag) ? '1' : '0.38';
    p.dataset.baseOp = op;
    p.setAttribute('fill-opacity', op);
  });
  renderChartActiveTags();
  buildTagTree();
}

let _chartTip = null;
function showChartTooltip(tag, count, isActive) {
  if (!_chartTip) {
    _chartTip = document.createElement('div');
    _chartTip.style.cssText = 'position:fixed;background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:12px;color:var(--text);pointer-events:none;z-index:999;box-shadow:var(--shadow);white-space:nowrap;';
    document.body.appendChild(_chartTip);
  }
  _chartTip.textContent = `${tag}  ×${count}${isActive ? '  ✓' : ''}`;
  _chartTip.style.display = 'block';
}
function hideChartTooltip() { if (_chartTip) _chartTip.style.display = 'none'; }
document.addEventListener('mousemove', e => {
  if (_chartTip && _chartTip.style.display !== 'none') {
    _chartTip.style.left = (e.clientX + 14) + 'px';
    _chartTip.style.top  = (e.clientY - 8)  + 'px';
  }
});

function openChartModal() {
  try {
    const modal = document.getElementById('chartModal');
    if (!modal) { console.error('[Chart] chartModal element not found'); return; }
    modal.classList.remove('hidden');
    buildSunburstChart();
    buildChartLegend();
    renderChartActiveTags();
  } catch(e) {
    console.error('[Chart] openChartModal failed:', e);
  }
}

function closeChartModal() {
  document.getElementById('chartModal').classList.add('hidden');
  state.chartDrillCategory = null;
}

function buildChartLegend() {
  const el = document.getElementById('chartLegend');
  if (!el) return;
  el.innerHTML = '';
  const cats = getChartCatData();
  cats.forEach(cat => {
    const item = document.createElement('div');
    item.className = 'chart-legend-item' + (state.chartDrillCategory === cat.id ? ' active' : '');
    item.innerHTML = `<span class="chart-legend-dot" style="background:${cat.color}"></span><span>${cat.label}</span><span class="chart-legend-cnt">${cat.tags.length}</span>`;
    item.addEventListener('click', () => {
      state.chartDrillCategory = state.chartDrillCategory === cat.id ? null : cat.id;
      buildSunburstChart();
      buildChartLegend();
    });
    el.appendChild(item);
  });
}

function renderChartActiveTags() {
  const el = document.getElementById('chartActiveTags');
  if (!el) return;
  el.innerHTML = '';
  if (!state.searchTags.length) {
    el.innerHTML = '<span style="font-size:11px;color:var(--text3);">— 無 —</span>';
    return;
  }
  state.searchTags.forEach(tag => {
    const chip = document.createElement('div');
    chip.className = 'chart-atag';
    chip.innerHTML = `<span>${tag}</span><span class="chart-atag-x">✕</span>`;
    chip.addEventListener('click', () => {
      state.searchTags.splice(state.searchTags.indexOf(tag), 1);
      updateFilterSummary();
      updateTagSelectedBadge();
      state.currentPage = 1;
      loadGallery();
      buildSunburstChart();
      renderChartActiveTags();
      buildTagTree();
    });
    el.appendChild(chip);
  });
}

function bindTagChartToggle() {
  const btn = document.getElementById('btnTagChart');
  if (!btn) { console.error('[Chart] btnTagChart not found'); return; }
  btn.addEventListener('click', openChartModal);
  console.log('[Chart] btnTagChart listener bound');

  document.getElementById('chartModalClose').addEventListener('click', closeChartModal);
  document.getElementById('chartModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeChartModal();
  });
  document.getElementById('chartClearBtn').addEventListener('click', () => {
    state.searchTags = [];
    state.excludeTags = [];
    document.getElementById('searchInput').value = '';
    document.querySelectorAll('.ftag.active').forEach(f => f.classList.remove('active'));
    updateFilterSummary();
    updateTagSelectedBadge();
    state.currentPage = 1;
    loadGallery();
    buildSunburstChart();
    renderChartActiveTags();
  });
  document.getElementById('chartApplyBtn').addEventListener('click', closeChartModal);
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
  updateTagSelectedBadge();
  state.currentPage = 1;
  loadGallery();
  syncChartIfOpen();
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

function clearAllTagFilters() {
  state.searchTags  = [];
  state.excludeTags = [];
  document.getElementById('searchInput').value = '';
  document.querySelectorAll('.ftag.active').forEach(f => f.classList.remove('active'));
  updateFilterSummary();
  updateTagSelectedBadge();
  state.currentPage = 1;
  loadGallery();
  buildTagTree();
  syncChartIfOpen();
}

function bindFilterClearEvent() {
  document.getElementById('btnClearFilter').addEventListener('click', clearAllTagFilters);
  document.getElementById('btnClearTagSel').addEventListener('click', clearAllTagFilters);
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

  document.getElementById('detBtnDelete').addEventListener('click', async () => {
    if (state.detImageId === null) return;
    if (!confirm('刪除這張圖片？此操作不可還原。')) return;

    // 先記下相鄰圖片
    const cards = [...document.querySelectorAll('.card')];
    const curIdx = cards.findIndex(c => Number(c.dataset.id) === state.detImageId);
    const nextCard = cards[curIdx + 1] ?? cards[curIdx - 1] ?? null;
    const nextId = nextCard ? Number(nextCard.dataset.id) : null;

    try {
      await DEL('/api/image', { image_id: state.detImageId });
      state.detImageId = null;
      toast('已刪除');
      loadGallery();
      loadStats();
      if (nextId !== null) {
        openDetailPanel(nextId);
      } else {
        document.getElementById('detPanel').classList.add('hidden');
      }
    } catch {
      toast('刪除失敗', 'error');
    }
  });

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

// ── Sidebar ───────────────────────────────────
function bindSidebarEvents() {
  document.querySelectorAll('.sb-icon[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.mode;
      document.querySelectorAll('.sb-icon[data-mode]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.sb-panel').forEach(p => p.classList.add('hidden'));
      const panel = document.querySelector(`.sb-panel[data-panel="${mode}"]`);
      if (panel) panel.classList.remove('hidden');
      document.getElementById('sidebar').dataset.mode = mode;
      document.getElementById('sidebar').classList.remove('collapsed');
    });
  });

  document.getElementById('sbCollapseBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  ['confSlider', 'confSlider2'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => {
      const val = parseFloat(el.value);
      state.threshold = val;
      const labelId = i === 0 ? 'confValue' : 'confValue2';
      document.getElementById(labelId).textContent = val;
      const otherId    = i === 0 ? 'confSlider2' : 'confSlider';
      const otherLabel = i === 0 ? 'confValue2'  : 'confValue';
      const other = document.getElementById(otherId);
      if (other) { other.value = val; document.getElementById(otherLabel).textContent = val; }
    });
  });

  document.getElementById('gridWidthSlider').addEventListener('input', (e) => {
    const val = Number(e.target.value);
    state.cardMinWidth = val;
    document.getElementById('gridWidthValue').textContent = val;
    document.getElementById('gallery').style.setProperty('--card-min-width', `${val}px`);
  });

  document.getElementById('perPageSelect').addEventListener('change', (e) => {
    state.perPage = Number(e.target.value);
    state.currentPage = 1;
    loadGallery();
  });

  document.getElementById('tagSearchInput').addEventListener('input', () => buildTagTree());
}

// ── Scan ──────────────────────────────────────
function bindScanEvents() {
  document.getElementById('btnScan').addEventListener('click', async () => {
    const folder = document.getElementById('scanFolderInput').value.trim();
    if (!folder) { toast('請輸入資料夾路徑', 'error'); return; }
    try {
      const res = await POST('/api/scan', { folder });
      state.lastFolder = folder;
      document.getElementById('folderPath').textContent = folder;
      POST('/api/config', { last_folder: folder, threshold: state.threshold, theme: state.theme }).catch(() => {});
      toast(`掃描完成：${res.new ?? 0} 張新圖，共 ${res.total ?? 0} 張`);
      await loadCollections();
      await loadAllTags();
      await loadGallery();
      document.getElementById('btnTag').disabled = false;
    } catch {
      toast('掃描失敗', 'error');
    }
  });

  document.getElementById('btnScanHeader').addEventListener('click', () => {
    document.querySelector('.sb-icon[data-mode="scan"]').click();
  });

  document.getElementById('btnTag').addEventListener('click', async () => {
    const folder = document.getElementById('scanFolderInput').value.trim();
    if (!folder) return;
    try {
      await POST('/api/tag', { folder, threshold: state.threshold });
      toast('打標開始，請稍候...');
      pollTagProgress();
    } catch {
      toast('打標啟動失敗', 'error');
    }
  });

  document.getElementById('btnHistory').addEventListener('click', async () => {
    try {
      const data = await GET('/api/scan-history');
      const list = document.getElementById('historyList');
      list.innerHTML = data.map(h => `
        <div style="padding:6px 0;border-bottom:1px solid var(--border2);font-family:JetBrains Mono,monospace;font-size:9px;">
          <div style="color:var(--text);">${h.folder}</div>
          <div style="color:var(--text3);">${h.last_scan ?? ''} · ${h.image_count ?? 0} 張 · 掃描 ${h.scan_count ?? 0} 次</div>
        </div>
      `).join('') || '<div style="color:var(--text3);font-size:10px;">無記錄</div>';
      document.getElementById('modalOverlay').classList.remove('hidden');
      document.getElementById('historyModal').classList.remove('hidden');
      document.getElementById('historyClose').onclick = closeModal;
      document.getElementById('modalOverlay').onclick  = closeModal;
    } catch {
      toast('載入歷史失敗', 'error');
    }
  });
}

function pollTagProgress() {
  const bar  = document.getElementById('tagProgressBar');
  const fill = document.getElementById('tagProgressFill');
  bar.classList.remove('hidden');

  const timer = setInterval(async () => {
    try {
      const p = await GET('/api/tag/progress');
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      fill.style.width = `${pct}%`;
      if (!p.running) {
        clearInterval(timer);
        bar.classList.add('hidden');
        fill.style.width = '0%';
        toast(`打標完成：${p.done} 張`);
        loadGallery();
        loadStats();
      }
    } catch { clearInterval(timer); }
  }, 1500);
}

function closeModal() {
  document.getElementById('modalOverlay').classList.add('hidden');
  document.querySelectorAll('.modal-dialog').forEach(m => m.classList.add('hidden'));
}

// ── Bulk Operations ───────────────────────────
function bindBulkEvents() {
  document.getElementById('btnSelectMode').addEventListener('click', () => {
    state.selectMode ? exitSelectMode() : enterSelectMode();
  });
  document.getElementById('btnCancelSelect').addEventListener('click', exitSelectMode);

  document.getElementById('btnBulkDelete').addEventListener('click', () => {
    if (!state.selectedIds.size) return;
    if (confirm(`刪除 ${state.selectedIds.size} 張圖片？此操作不可還原。`)) bulkDelete();
  });

  document.getElementById('btnBulkAssign').addEventListener('click', () => {
    if (!state.selectedIds.size) return;
    const names = state.collections.map(c => `${c.id}: ${c.name}`).join('\n');
    const input = prompt(`輸入 Collection ID:\n${names}`);
    if (input === null) return;
    const colId = input.trim() === '' ? null : Number(input.trim());
    POST('/api/images/set-collection', { image_ids: [...state.selectedIds], collection_id: colId })
      .then(() => { toast('指派完成'); exitSelectMode(); loadGallery(); loadCollections(); })
      .catch(() => toast('指派失敗', 'error'));
  });

  document.getElementById('btnBulkMove').addEventListener('click', () => {
    if (!state.selectedIds.size) return;
    const dest = prompt('目標資料夾路徑：');
    if (!dest) return;
    POST('/api/images/bulk-move', { image_ids: [...state.selectedIds], dest_folder: dest })
      .then(r => { toast(`已移動 ${r.moved ?? 0} 張`); exitSelectMode(); loadGallery(); })
      .catch(() => toast('移動失敗', 'error'));
  });
}

async function bulkDelete() {
  try {
    const ids = [...state.selectedIds];
    await POST('/api/images/bulk-delete', { image_ids: ids });
    toast(`已刪除 ${ids.length} 張`);
    exitSelectMode();
    loadGallery();
    loadStats();
  } catch {
    toast('刪除失敗', 'error');
  }
}

// ── Keyboard Shortcuts ────────────────────────
function bindKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.key === 'Escape') {
      if (!document.getElementById('lightbox').classList.contains('hidden')) {
        document.getElementById('lightbox').classList.add('hidden'); return;
      }
      if (!document.getElementById('ctxMenu').classList.contains('hidden')) {
        hideCtxMenu(); return;
      }
      if (state.selectMode) { exitSelectMode(); return; }
      if (!document.getElementById('detPanel').classList.contains('hidden')) {
        document.getElementById('detClose').click(); return;
      }
    }

    if (inInput) return;

    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      if (!state.selectMode) enterSelectMode();
      document.querySelectorAll('.card').forEach(c => {
        state.selectedIds.add(Number(c.dataset.id));
        c.classList.add('selected');
      });
      updateSelectCount();
    }

    if (e.key === 'Delete' && state.selectMode && state.selectedIds.size > 0) {
      if (confirm(`刪除 ${state.selectedIds.size} 張圖片？此操作不可還原。`)) bulkDelete();
    }

    if (e.key === 'f' || e.key === 'F') {
      document.getElementById('sidebar').classList.toggle('collapsed');
    }

    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && state.detImageId !== null) {
      navigateDetail(e.key === 'ArrowLeft' ? -1 : 1);
    }
  });
}

// ── Add Collection ────────────────────────────
function bindAddCollectionEvent() {
  document.getElementById('btnAddCollection').addEventListener('click', async () => {
    const name = prompt('新 Collection 名稱：');
    if (!name) return;
    try {
      await POST('/api/collections', { name });
      await loadCollections();
      toast(`Collection "${name}" 已建立`);
    } catch {
      toast('建立失敗', 'error');
    }
  });
}

function bindEvents() {
  [
    bindThemeEvents, bindSidebarEvents, bindScanEvents, bindSearchEvents,
    bindFilterClearEvent, bindTagChartToggle, bindContextMenu, bindDetPanelEvents,
    bindBulkEvents, bindLasso, bindKeyboardShortcuts, bindAddCollectionEvent,
  ].forEach(fn => {
    try { fn(); }
    catch (e) { console.error(`[bindEvents] ${fn.name}:`, e); }
  });
}

// ── Init ──────────────────────────────────────
async function init() {
  await loadConfig();
  await loadStats();
  await loadCollections();
  await loadAllTags();
  await loadGallery();
  try { buildTagTree(); } catch(e) { console.warn('buildTagTree error', e); }
  bindEvents();
}

document.addEventListener('DOMContentLoaded', init);
