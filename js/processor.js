/**
 * processor.js
 *
 * Lazy-loads OpenCV.js then:
 *  1. Draws captured blob onto a canvas
 *  2. Grayscale → Canny edge detect → find largest quadrilateral contour
 *  3. Perspective warp to flat top-down view
 *  4. Lighting pipeline: CLAHE → Gaussian blur → adaptive threshold
 *  5. Returns final processed JPEG blob
 *
 * Corner handles let the user adjust the detected quad before warping.
 * Debug mode renders intermediate canvases for inspection.
 */

let cvReady = false;
let cvLoading = false;
const cvReadyCallbacks = [];

// ── OpenCV lazy loader ────────────────────────────────────────────
export function loadOpenCV() {
  return new Promise((resolve, reject) => {
    if (cvReady) { resolve(); return; }
    cvReadyCallbacks.push({ resolve, reject });
    if (cvLoading) return;
    cvLoading = true;

    window.Module = {
      onRuntimeInitialized() {
        cvReady = true;
        cvReadyCallbacks.forEach(({ resolve }) => resolve());
        cvReadyCallbacks.length = 0;
      },
    };

    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.async = true;
    script.onerror = () => {
      cvLoading = false;
      const err = new Error('Failed to load OpenCV.js');
      cvReadyCallbacks.forEach(({ reject }) => reject(err));
      cvReadyCallbacks.length = 0;
    };
    document.head.appendChild(script);
  });
}

// ── Helpers ───────────────────────────────────────────────────────
function blobToImageData(blob) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.src = url;
  });
}

function canvasToBlob(canvas, quality = 0.85) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function matToCanvas(mat, label) {
  const canvas = document.createElement('canvas');
  cv.imshow(canvas, mat);
  const wrap = document.createElement('div');
  wrap.className = 'debug-preview';
  wrap.appendChild(canvas);
  const p = document.createElement('p');
  p.textContent = label;
  wrap.appendChild(p);
  return wrap;
}

/**
 * Order corners: top-left, top-right, bottom-right, bottom-left.
 */
function orderCorners(pts) {
  // pts is array of {x, y}
  const sorted = [...pts].sort((a, b) => a.y - b.y);
  const top    = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[1], bottom[0]]; // TL, TR, BR, BL
}

/**
 * Find the largest quadrilateral contour in a binary edge image.
 * Returns array of 4 {x,y} points, or null if not found.
 */
function findReceiptQuad(edgeMat) {
  const contours  = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(edgeMat, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  let bestQuad = null;
  let bestArea = 0;

  for (let i = 0; i < contours.size(); i++) {
    const cnt  = contours.get(i);
    const peri = cv.arcLength(cnt, true);
    const approx = new cv.Mat();
    cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

    if (approx.rows === 4) {
      const area = Math.abs(cv.contourArea(approx));
      if (area > bestArea) {
        bestArea = area;
        const pts = [];
        for (let r = 0; r < 4; r++) {
          pts.push({ x: approx.data32S[r * 2], y: approx.data32S[r * 2 + 1] });
        }
        bestQuad = pts;
      }
    }
    approx.delete();
    cnt.delete();
  }

  contours.delete();
  hierarchy.delete();

  // Reject quads that are too small (< 10% of image area)
  if (bestQuad && bestArea < edgeMat.rows * edgeMat.cols * 0.10) return null;
  return bestQuad ? orderCorners(bestQuad) : null;
}

/**
 * Apply perspective warp given 4 source corners.
 * corners: [TL, TR, BR, BL] in {x,y} pixel coords of srcMat.
 * Returns a new warped cv.Mat (caller must .delete() it).
 */
function perspectiveWarp(srcMat, corners) {
  const [tl, tr, br, bl] = corners;

  // Compute output dimensions from the quad
  const widthA  = Math.hypot(br.x - bl.x, br.y - bl.y);
  const widthB  = Math.hypot(tr.x - tl.x, tr.y - tl.y);
  const maxW    = Math.round(Math.max(widthA, widthB));

  const heightA = Math.hypot(tr.x - br.x, tr.y - br.y);
  const heightB = Math.hypot(tl.x - bl.x, tl.y - bl.y);
  const maxH    = Math.round(Math.max(heightA, heightB));

  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y,
  ]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0, maxW - 1, 0, maxW - 1, maxH - 1, 0, maxH - 1,
  ]);
  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const warped = new cv.Mat();
  cv.warpPerspective(srcMat, warped, M, new cv.Size(maxW, maxH), cv.INTER_LINEAR);

  srcPts.delete(); dstPts.delete(); M.delete();
  return warped;
}

// ── Corner handle UI ──────────────────────────────────────────────
let handleCorners = []; // [{x, y}] in canvas-display pixels

export function setupCornerHandles(containerEl, canvasEl, corners) {
  // Remove any existing handles
  containerEl.querySelectorAll('.corner-handle').forEach((h) => h.remove());

  const rect   = canvasEl.getBoundingClientRect();
  const scaleX = rect.width  / canvasEl.width;
  const scaleY = rect.height / canvasEl.height;

  handleCorners = corners.map((c) => ({ x: c.x, y: c.y }));

  corners.forEach((corner, idx) => {
    const handle = document.createElement('div');
    handle.className = 'corner-handle';
    handle.style.left = `${corner.x * scaleX}px`;
    handle.style.top  = `${corner.y * scaleY}px`;
    containerEl.appendChild(handle);

    let startX, startY, origX, origY;

    function onStart(e) {
      e.preventDefault();
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX;
      startY = pt.clientY;
      const r = containerEl.getBoundingClientRect();
      origX = parseFloat(handle.style.left);
      origY = parseFloat(handle.style.top);
      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('mouseup',   onEnd);
      document.addEventListener('touchend',  onEnd);
    }

    function onMove(e) {
      e.preventDefault();
      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;

      const contRect = containerEl.getBoundingClientRect();
      const newLeft = Math.max(0, Math.min(origX + dx, contRect.width));
      const newTop  = Math.max(0, Math.min(origY + dy, contRect.height));

      handle.style.left = `${newLeft}px`;
      handle.style.top  = `${newTop}px`;

      // Update logical coords (unscaled back to canvas pixels)
      handleCorners[idx] = {
        x: newLeft  / scaleX,
        y: newTop   / scaleY,
      };
    }

    function onEnd() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup',   onEnd);
      document.removeEventListener('touchend',  onEnd);
    }

    handle.addEventListener('mousedown',  onStart);
    handle.addEventListener('touchstart', onStart, { passive: false });
  });
}

export function getHandleCorners() {
  return handleCorners.map((c) => ({ ...c }));
}

// ── Main processing pipeline ──────────────────────────────────────
/**
 * processImage(blob, options)
 *
 * Returns { processedBlob, detectedCorners, autoDetected }
 *
 * options.debugContainer — DOM element to append debug previews to
 * options.debugMode      — boolean
 */
export async function processImage(blob, { debugContainer, debugMode } = {}) {
  const srcCanvas = await blobToImageData(blob);
  const src = cv.imread(srcCanvas);

  const debugPreviews = [];

  // ── Step 1: Grayscale ────────────────────────────────────────
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  if (debugMode) debugPreviews.push(matToCanvas(gray, 'Grayscale'));

  // ── Step 2: Gaussian blur (noise reduction before edge detect) ─
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  // ── Step 3: Canny edge detection ─────────────────────────────
  const edges = new cv.Mat();
  cv.Canny(blurred, edges, 75, 200);

  // Dilate slightly to close small gaps in receipt border
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  cv.dilate(edges, edges, kernel);
  kernel.delete();
  if (debugMode) debugPreviews.push(matToCanvas(edges, 'Edges (Canny)'));

  // ── Step 4: Find receipt quad ─────────────────────────────────
  let corners = findReceiptQuad(edges);
  let autoDetected = corners !== null;

  if (!autoDetected) {
    // Fall back to full-image corners
    corners = [
      { x: 0,          y: 0           },
      { x: src.cols,   y: 0           },
      { x: src.cols,   y: src.rows    },
      { x: 0,          y: src.rows    },
    ];
  }

  // ── Step 5: Perspective warp ──────────────────────────────────
  const warped = perspectiveWarp(src, corners);
  if (debugMode) debugPreviews.push(matToCanvas(warped, 'Warped'));

  // ── Step 6: CLAHE adaptive contrast ──────────────────────────
  const warpedGray = new cv.Mat();
  cv.cvtColor(warped, warpedGray, cv.COLOR_RGBA2GRAY);

  const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
  const claheOut = new cv.Mat();
  clahe.apply(warpedGray, claheOut);
  clahe.delete();
  if (debugMode) debugPreviews.push(matToCanvas(claheOut, 'CLAHE'));

  // ── Step 7: Gaussian blur ─────────────────────────────────────
  const blurred2 = new cv.Mat();
  cv.GaussianBlur(claheOut, blurred2, new cv.Size(3, 3), 0);

  // ── Step 8: Adaptive threshold ────────────────────────────────
  const thresh = new cv.Mat();
  cv.adaptiveThreshold(
    blurred2, thresh, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY,
    11, 2
  );
  if (debugMode) debugPreviews.push(matToCanvas(thresh, 'Threshold'));

  // ── Render debug previews ─────────────────────────────────────
  if (debugMode && debugContainer) {
    debugContainer.innerHTML = '';
    debugPreviews.forEach((el) => debugContainer.appendChild(el));
  }

  // ── Export final result ───────────────────────────────────────
  const outCanvas = document.createElement('canvas');
  cv.imshow(outCanvas, thresh);
  const processedBlob = await canvasToBlob(outCanvas, 0.85);

  // ── Cleanup ───────────────────────────────────────────────────
  src.delete(); gray.delete(); blurred.delete(); edges.delete();
  warped.delete(); warpedGray.delete(); claheOut.delete();
  blurred2.delete(); thresh.delete();

  return { processedBlob, detectedCorners: corners, autoDetected };
}

/**
 * reprocessWithCorners(blob, corners, options)
 *
 * Re-runs the warp + lighting pipeline with user-adjusted corners.
 * Returns { processedBlob }.
 */
export async function reprocessWithCorners(blob, corners, { debugContainer, debugMode } = {}) {
  const srcCanvas = await blobToImageData(blob);
  const src = cv.imread(srcCanvas);

  const debugPreviews = [];

  const warped = perspectiveWarp(src, corners);
  if (debugMode) debugPreviews.push(matToCanvas(warped, 'Warped'));

  const warpedGray = new cv.Mat();
  cv.cvtColor(warped, warpedGray, cv.COLOR_RGBA2GRAY);

  const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
  const claheOut = new cv.Mat();
  clahe.apply(warpedGray, claheOut);
  clahe.delete();
  if (debugMode) debugPreviews.push(matToCanvas(claheOut, 'CLAHE'));

  const blurred = new cv.Mat();
  cv.GaussianBlur(claheOut, blurred, new cv.Size(3, 3), 0);

  const thresh = new cv.Mat();
  cv.adaptiveThreshold(blurred, thresh, 255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 11, 2);
  if (debugMode) debugPreviews.push(matToCanvas(thresh, 'Threshold'));

  if (debugMode && debugContainer) {
    debugContainer.innerHTML = '';
    debugPreviews.forEach((el) => debugContainer.appendChild(el));
  }

  const outCanvas = document.createElement('canvas');
  cv.imshow(outCanvas, thresh);
  const processedBlob = await canvasToBlob(outCanvas, 0.85);

  src.delete(); warped.delete(); warpedGray.delete();
  claheOut.delete(); blurred.delete(); thresh.delete();

  return { processedBlob };
}
