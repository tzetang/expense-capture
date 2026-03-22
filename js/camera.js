/**
 * Returns true on iPhone, iPad, or iPadOS (desktop Safari with touch).
 * Used to branch away from getUserMedia (which prompts every session on iOS)
 * to a <input type="file" capture> approach instead.
 */
export function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as macOS — use touch event presence instead of deprecated navigator.platform
    (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
}

let stream = null;

const video = () => document.getElementById('camera-video');

/**
 * Start the rear camera and stream it to the <video> element.
 * Throws if permission is denied or no camera is found.
 */
export async function startCamera() {
  // Prefer exact rear camera; fall back to any environment-facing camera
  const constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  };

  stream = await navigator.mediaDevices.getUserMedia(constraints);
  const v = video();
  v.srcObject = stream;
  await v.play();
}

/**
 * Stop all camera tracks and clear the video element.
 */
export function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  const v = video();
  v.srcObject = null;
}

/**
 * Capture the current video frame and return it as a Blob (image/jpeg).
 * Returns null if the camera is not running.
 */
export function captureFrame() {
  const v = video();
  if (!v.videoWidth) return null;

  const canvas = document.createElement('canvas');
  canvas.width  = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0);

  return new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.95);
  });
}
