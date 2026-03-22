import { loadSettings, saveSettings } from './settings.js';
import { submitExpense } from './submitter.js';

// ── Page system ───────────────────────────────────────────────────
const PAGES = ['home', 'settings', 'result'];
let currentPage = 'home';

function showPage(id) {
  PAGES.forEach((p) => {
    const el = document.getElementById(`page-${p}`);
    el.classList.remove('page--active', 'page--behind');
    if (p === id)          el.classList.add('page--active');
    else if (p === currentPage) el.classList.add('page--behind');
  });
  currentPage = id;
  if (id === 'settings') populateSettings();
}

// ── Home ──────────────────────────────────────────────────────────
function setupHome() {
  document.getElementById('btn-settings-home')
    .addEventListener('click', () => showPage('settings'));

  document.getElementById('home-alert-link')
    .addEventListener('click', (e) => { e.preventDefault(); showPage('settings'); });

  // Intercept the label click to guard webhook URL before opening file picker
  document.getElementById('btn-scan').addEventListener('click', (e) => {
    const { webhookUrl } = loadSettings();
    if (!webhookUrl) {
      e.preventDefault();
      document.getElementById('home-alert').hidden = false;
      return;
    }
    document.getElementById('home-alert').hidden = true;
    // Let the label's default behaviour open the file input
  });

  document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await submitFile(file);
  });
}

// ── Submit ────────────────────────────────────────────────────────
async function submitFile(file) {
  if (!navigator.onLine) {
    showPage('result');
    showResult({ success: false, title: 'You\'re Offline',
      message: 'Please reconnect and try again.' });
    return;
  }

  showPage('result');
  document.getElementById('submit-spinner').classList.remove('hidden');

  try {
    const result = await submitExpense(file, loadSettings());
    document.getElementById('submit-spinner').classList.add('hidden');

    if (result.ok) {
      showResult({ success: true, title: 'Expense Submitted!',
        message: result.message || 'Your receipt has been sent to n8n.' });
    } else {
      showResult({ success: false, title: `Failed (${result.status})`,
        message: result.message || 'Server returned an error.' });
    }
  } catch (err) {
    document.getElementById('submit-spinner').classList.add('hidden');
    showResult({ success: false, title: 'Network Error',
      message: err.message || 'Could not reach the webhook.' });
  }
}

// ── Result ────────────────────────────────────────────────────────
function showResult({ success, title, message }) {
  const successSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5"
    stroke-linecap="round" stroke-linejoin="round" width="36" height="36">
    <polyline points="20 6 9 17 4 12"/></svg>`;
  const errorSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2.5"
    stroke-linecap="round" stroke-linejoin="round" width="36" height="36">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/></svg>`;

  document.getElementById('result-icon').className =
    `result-icon result-icon--${success ? 'success' : 'error'}`;
  document.getElementById('result-icon').innerHTML  = success ? successSVG : errorSVG;
  document.getElementById('result-title').textContent   = title;
  document.getElementById('result-message').textContent = message;
  document.getElementById('btn-retry-submit').hidden    = success;
}

function setupResult() {
  document.getElementById('btn-scan-another')
    .addEventListener('click', () => showPage('home'));

  document.getElementById('btn-retry-submit')
    .addEventListener('click', () => showPage('home'));
}

// ── Settings ──────────────────────────────────────────────────────
function populateSettings() {
  const s = loadSettings();
  document.getElementById('input-webhook-url').value = s.webhookUrl;
  document.getElementById('input-api-key').value     = s.apiKey;
}

function setupSettings() {
  document.getElementById('btn-back-settings')
    .addEventListener('click', () => showPage('home'));

  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const input = document.getElementById('input-api-key');
    const hide  = input.type === 'password';
    input.type  = hide ? 'text' : 'password';
    document.getElementById('eye-icon').innerHTML = hide
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
         <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
         <line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    saveSettings({
      webhookUrl: document.getElementById('input-webhook-url').value,
      apiKey:     document.getElementById('input-api-key').value,
    });
    showToast('Settings saved');
  });
}

// ── Toast ─────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('toast--visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('toast--visible'), 2500);
}

// ── Offline banner ────────────────────────────────────────────────
function setupOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  const update = () => banner.classList.toggle('visible', !navigator.onLine);
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

// ── Service worker ────────────────────────────────────────────────
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then(() => {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }).catch(() => {});
}

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  registerSW();
  setupOfflineBanner();
  setupHome();
  setupSettings();
  setupResult();
});
