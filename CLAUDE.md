# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this app is

A mobile-first PWA for scanning receipts and submitting them as expenses to a Zoho-connected n8n webhook. Pure static site — no build step, no framework, no server-side code.

## Running locally

```bash
python3 -m http.server 8080
# or
npx serve .
```

Service workers require HTTPS or `localhost`. Use `localhost:8080`, not `127.0.0.1:8080`, to avoid SW registration issues.

## Deployment

Vercel static deployment. `vercel.json` rewrites all routes to `index.html` (SPA) and sets `Cache-Control: no-cache` on `sw.js` so updates propagate immediately.

## Architecture

Single-page app — all "pages" are `<section id="page-*">` elements in `index.html`, shown/hidden via `.page--active` CSS class. Navigation is hash-based (`#home`, `#camera`, `#process`, `#settings`, `#result`).

**JS modules** (all ES modules, no bundler):

| File | Role |
|---|---|
| `js/app.js` | Router, page lifecycle hooks, global wiring |
| `js/camera.js` | `getUserMedia`, `captureFrame()` returns a JPEG Blob |
| `js/processor.js` | Lazy-loads OpenCV.js; full pipeline: edge detect → perspective warp → CLAHE → threshold |
| `js/settings.js` | `loadSettings()` / `saveSettings()` via localStorage (`ec_*` keys) |
| `js/submitter.js` | `submitExpense(blob, settings)` — multipart POST with `X-API-Key` header |

**Global state**: `window.appState = { capturedBlob, processedBlob }` — set in `camera.js`, consumed by `processor.js` and `submitter.js`.

## OpenCV.js

Loaded lazily from the CDN (`https://docs.opencv.org/4.8.0/opencv.js`) only when the `#process` page activates. It's ~8 MB — never import it at page load. The `window.Module.onRuntimeInitialized` callback signals readiness. All OpenCV `Mat` objects **must** be manually `.delete()`d to avoid WASM memory leaks.

## Key flows

- **Missing webhook URL**: home page blocks navigation to camera and shows an inline alert linking to settings.
- **No quad detected**: `findReceiptQuad()` returns `null` → falls back to full-image corners; user adjusts manually.
- **Re-apply Corners**: `reprocessWithCorners(blob, corners)` re-runs warp + lighting without re-detecting edges.
- **Offline**: `navigator.onLine` checked before submission; result page shows offline error immediately.
