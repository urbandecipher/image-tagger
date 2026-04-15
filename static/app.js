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

// ── Stubs for later tasks ─────────────────────
// These will be defined in Tasks 5-9 by appending to this file.
// Declaring stubs here prevents "not defined" errors during init.
async function loadCollections() {}
async function loadAllTags()     {}
async function loadGallery()     {}
function buildTagTree()          {}
function bindEvents()            {}

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
