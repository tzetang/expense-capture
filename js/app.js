import { loadSettings, saveSettings } from './settings.js';
import {
  loadOpenCV,
  processImage,
  reprocessWithCorners,
  setupCornerHandles,
  getHandleCorners,
} from './processor.js';
import { submitExpense } from './submitter.js';

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

  if (id === 'process')  initProcessPage();
  if (id === 'result')   triggerSubmission();
  if (id === 'settings') initSettingsPage();
}

// ── Hash router ──────────────────────────────────────────────────
function handleHash() {
  const hash = window.location.hash.replace('#', '') || 'home';
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
  const scanBtn     = document.getElementById('btn-scan');
  const alertBanner = document.getElementById('home-alert');
  const alertLink   = document.getElementById('home-alert-link');

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

// ── Camera page ──────────────────────────────────────────────────
function setupCameraPage() {
  document.getElementById('btn-back-camera')
    .addEventListener('click', () => showPage('home'));

  // File input: on mobile opens native camera; on desktop opens file picker
  document.getElementById('camera-file-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    window.appState.capturedBlob = file;
    e.target.value = ''; // reset so retaking fires change event again
    showPage('process');
  });
}

// ── Process page ─────────────────────────────────────────────────
async function initProcessPage() {
  const spinner       = document.getElementById('opencv-spinner');
  const previewCanvas = document.getElementById('canvas-preview');
  const container     = document.getElementById('process-canvas-container');
  const debugSection  = document.getElementById('debug-section');
  const debugPreviews = document.getElementById('debug-previews');
  const { debugMode } = loadSettings();

  debugSection.hidden = !debugMode;
  spinner.classList.remove('hidden');

  try {
    await loadOpenCV();
  } catch {
    spinner.classList.add('hidden');
    showToast('Failed to load image processor — using manual corners');
  }

  spinner.classList.add('hidden');

  const blob = window.appState.capturedBlob;
  if (!blob) { showPage('camera'); return; }

  let result;
  try {
    result = await processImage(blob, {
      debugMode,
      debugContainer: debugMode ? debugPreviews : null,
    });
  } catch (err) {
    console.error('processImage failed', err);
    showToast('Processing failed — please adjust corners manually');
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      previewCanvas.width  = img.naturalWidth;
      previewCanvas.height = img.naturalHeight;
      previewCanvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      setupCornerHandles(container, previewCanvas, [
        { x: 0,                y: 0                },
        { x: img.naturalWidth, y: 0                },
        { x: img.naturalWidth, y: img.naturalHeight },
        { x: 0,                y: img.naturalHeight },
      ]);
    };
    img.src = url;
    return;
  }

  window.appState.processedBlob = result.processedBlob;

  const img = new Image();
  const url = URL.createObjectURL(result.processedBlob);
  img.onload = () => {
    previewCanvas.width  = img.naturalWidth;
    previewCanvas.height = img.naturalHeight;
    previewCanvas.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
  };
  img.src = url;

  if (result.detectedCorners) {
    const tmpImg = new Image();
    const tmpUrl = URL.createObjectURL(blob);
    tmpImg.onload = () => {
      URL.revokeObjectURL(tmpUrl);
      setupCornerHandles(container, previewCanvas, result.detectedCorners.map((c) => ({
        x: (c.x / tmpImg.naturalWidth)  * previewCanvas.width,
        y: (c.y / tmpImg.naturalHeight) * previewCanvas.height,
      })));
    };
    tmpImg.src = tmpUrl;
  }

  if (!result.autoDetected) {
    showToast('Receipt outline not detected — adjust corners manually');
  }
}

function setupProcessPage() {
  document.getElementById('btn-back-process')
    .addEventListener('click', () => showPage('camera'));

  document.getElementById('btn-apply-corners').addEventListener('click', async () => {
    const blob = window.appState.capturedBlob;
    if (!blob) return;
    const { debugMode } = loadSettings();
    const corners = getHandleCorners();
    try {
      const result = await reprocessWithCorners(blob, corners, {
        debugMode,
        debugContainer: debugMode ? document.getElementById('debug-previews') : null,
      });
      window.appState.processedBlob = result.processedBlob;
      const previewCanvas = document.getElementById('canvas-preview');
      const img = new Image();
      const url = URL.createObjectURL(result.processedBlob);
      img.onload = () => {
        previewCanvas.width  = img.naturalWidth;
        previewCanvas.height = img.naturalHeight;
        previewCanvas.getContext('2d').drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
      };
      img.src = url;
      showToast('Corners applied');
    } catch {
      showToast('Failed to apply corners');
    }
  });

  document.getElementById('btn-confirm-process').addEventListener('click', () => {
    if (!window.appState.processedBlob) {
      showToast('No processed image — please wait or retake');
      return;
    }
    showPage('result');
  });
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

  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const input = document.getElementById('input-api-key');
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    document.getElementById('eye-icon').innerHTML = isHidden
      ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
         <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
         <line x1="1" y1="1" x2="23" y2="23"/>`
      : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>`;
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    saveSettings({
      webhookUrl: document.getElementById('input-webhook-url').value,
      apiKey:     document.getElementById('input-api-key').value,
      debugMode:  document.getElementById('toggle-debug').checked,
    });
    showToast('Settings saved');
  });
}

// ── Result page ──────────────────────────────────────────────────
function showResult({ success, title, message }) {
  const icon     = document.getElementById('result-icon');
  const titleEl  = document.getElementById('result-title');
  const msgEl    = document.getElementById('result-message');
  const retryBtn = document.getElementById('btn-retry-submit');

  const successSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2.5"
       stroke-linecap="round" stroke-linejoin="round" width="36" height="36">
    <polyline points="20 6 9 17 4 12"/></svg>`;
  const errorSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2.5"
       stroke-linecap="round" stroke-linejoin="round" width="36" height="36">
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/></svg>`;

  icon.className      = `result-icon result-icon--${success ? 'success' : 'error'}`;
  icon.innerHTML      = success ? successSVG : errorSVG;
  titleEl.textContent = title;
  msgEl.textContent   = message;
  retryBtn.hidden     = success;
}

async function triggerSubmission() {
  if (!navigator.onLine) {
    showResult({ success: false, title: 'You\'re Offline',
      message: 'Please reconnect to the internet and try again.' });
    return;
  }

  const blob = window.appState.processedBlob;
  if (!blob) { showPage('process'); return; }

  const spinner = document.getElementById('submit-spinner');
  spinner.classList.remove('hidden');

  const settings = loadSettings();
  try {
    const result = await submitExpense(blob, settings);
    spinner.classList.add('hidden');
    if (result.ok) {
      showResult({ success: true, title: 'Expense Submitted!',
        message: result.message || 'Your receipt has been sent to n8n successfully.' });
    } else {
      showResult({ success: false, title: `Submission Failed (${result.status})`,
        message: result.message || 'The server returned an error. Please try again.' });
    }
  } catch (err) {
    spinner.classList.add('hidden');
    showResult({ success: false, title: 'Network Error',
      message: err.message || 'Could not reach the webhook. Check your URL and connection.' });
  }
}

function setupResultPage() {
  document.getElementById('btn-scan-another').addEventListener('click', () => {
    window.appState.capturedBlob  = null;
    window.appState.processedBlob = null;
    showPage('home');
  });
  document.getElementById('btn-retry-submit').addEventListener('click', triggerSubmission);
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
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then(() => {
    // Auto-reload when a new SW takes over so users always run fresh JS
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      window.location.reload();
    });
  }).catch(() => {});
}

// ── Offline banner ───────────────────────────────────────────────
function setupOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  function update() { banner.classList.toggle('visible', !navigator.onLine); }
  window.addEventListener('online',  update);
  window.addEventListener('offline', update);
  update();
}

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  registerSW();
  setupOfflineBanner();
  setupHomePage();
  setupCameraPage();
  setupProcessPage();
  setupSettingsPage();
  setupResultPage();
  handleHash();
});
