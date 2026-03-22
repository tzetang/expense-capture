import { loadSettings, saveSettings } from './settings.js';

// ── App state ────────────────────────────────────────────────────
window.appState = {
  capturedBlob: null,
  processedBlob: null,
};

// ── Page registry ────────────────────────────────────────────────
const PAGES = ['home', 'camera', 'process', 'settings', 'result'];
let currentPage = null;

function showPage(id) {
  if (!PAGES.includes(id)) id = 'home';
  PAGES.forEach((p) => {
    const el = document.getElementById(`page-${p}`);
    if (!el) return;
    el.classList.remove('page--active', 'page--behind');
    if (p === id) el.classList.add('page--active');
    else if (p === currentPage) el.classList.add('page--behind');
  });
  currentPage = id;
  window.location.hash = id;

  // Lifecycle hooks
  if (id === 'settings') initSettingsPage();
}

// ── Hash router ──────────────────────────────────────────────────
function handleHash() {
  const hash = window.location.hash.replace('#', '') || 'home';
  // We only navigate via showPage(), but handle direct URL loads/back-button
  if (!PAGES.includes(hash)) return showPage('home');
  PAGES.forEach((p) => {
    const el = document.getElementById(`page-${p}`);
    if (!el) return;
    el.classList.toggle('page--active', p === hash);
    el.classList.remove('page--behind');
  });
  currentPage = hash;
  if (hash === 'settings') initSettingsPage();
}

window.addEventListener('hashchange', handleHash);

// ── Home page ────────────────────────────────────────────────────
function setupHomePage() {
  const scanBtn = document.getElementById('btn-scan');
  const alertBanner = document.getElementById('home-alert');
  const alertLink = document.getElementById('home-alert-link');

  scanBtn.addEventListener('click', () => {
    const { webhookUrl } = loadSettings();
    if (!webhookUrl) {
      alertBanner.hidden = false;
      return;
    }
    alertBanner.hidden = true;
    showPage('camera');
  });

  alertLink?.addEventListener('click', (e) => {
    e.preventDefault();
    showPage('settings');
  });

  document.getElementById('btn-settings-home')
    .addEventListener('click', () => showPage('settings'));
}

// ── Settings page ────────────────────────────────────────────────
function initSettingsPage() {
  const s = loadSettings();
  document.getElementById('input-webhook-url').value = s.webhookUrl;
  document.getElementById('input-api-key').value     = s.apiKey;
  document.getElementById('toggle-debug').checked    = s.debugMode;
}

function setupSettingsPage() {
  document.getElementById('btn-back-settings')
    .addEventListener('click', () => showPage('home'));

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    saveSettings({
      webhookUrl: document.getElementById('input-webhook-url').value,
      apiKey:     document.getElementById('input-api-key').value,
      debugMode:  document.getElementById('toggle-debug').checked,
    });
    showToast('Settings saved');
  });
}

// ── Toast ────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('toast--visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('toast--visible'), 2500);
}
window.showToast = showToast;

// ── Service worker ───────────────────────────────────────────────
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

// ── Offline banner ───────────────────────────────────────────────
function setupOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  function update() {
    banner.classList.toggle('visible', !navigator.onLine);
  }
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  registerSW();
  setupOfflineBanner();
  setupHomePage();
  setupSettingsPage();
  handleHash();
});
