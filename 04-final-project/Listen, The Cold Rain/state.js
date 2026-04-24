// state.js — MediaPipe Hands (dual-hand version)
//
// Globals exposed to sketch.js:
//   handLandmarks     : [{x,y}×42] flat array of all keypoints from both hands, or null
//   handPresent       : bool
//   handCount         : 0 | 1 | 2
//   palmOpenEvent     : true for the frame when either hand opens (triggers ripple scatter)
//   palmCenterNorm    : palm center {x,y} of the hand that triggered open (normalized, x mirrored)
//   palmSpread        : current maximum spread value
//   rectPinchActive   : true when both hands are pinching simultaneously
//   rectCornersNorm   : {x1,y1,x2,y2} both pinch midpoints (normalized), or null
//   rectPinchProgress : 0–1, sustained pinch progress (full at 2s)
//   rectPinchBlurTrigger : true for the frame when 2s is reached (triggers melt effect)
//   videoEl / camReady : used for camera background rendering

let handLandmarks        = null;
let handPresent          = false;
let handCount            = 0;
let palmOpenEvent        = false;
let palmCenterNorm       = null;
let palmSpread           = 0;
let rectPinchActive      = false;
let rectCornersNorm      = null;
let rectPinchProgress    = 0;
let rectPinchBlurTrigger = false;

let camReady = false;
let videoEl  = null;

// ── Detection parameters ──────────────────────────────────────────────────────
const PINCH_DIST_THRESHOLD  = 0.075;
const SPREAD_OPEN_THRESHOLD = 0.22;
const SPREAD_CLOSE_FACTOR   = 0.85;  // close threshold relaxed to 0.22×0.85≈0.187, a loose fist is enough
const SCATTER_COOLDOWN_MS   = 900;
const HAND_ENTRY_GRACE_MS   = 600;   // suppress triggers for 600ms after hand enters frame (avoids false fires)
const RECT_HOLD_MS          = 2000;

// ── Internal state ────────────────────────────────────────────────────────────
let _prevMaxSpread   = 0;
let _lastScatterMs   = 0;
let _rectStartMs     = 0;
let _rectBlurFired   = false;
let _handFirstSeenMs = 0;   // timestamp when a hand first appeared
let _prevHandCount   = 0;   // hand count from the previous frame

// ─────────────────────────────────────────────────────────────────────────────

function initHandDetection() {
  videoEl = document.getElementById('cam-video');
  const hintEl = document.getElementById('hint');

  if (typeof Hands === 'undefined') {
    hintEl.textContent = 'MediaPipe not loaded — move mouse to right half of screen';
    _setupMouseFallback();
    return;
  }

  const hands = new Hands({
    locateFile: f => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`,
  });

  hands.setOptions({
    maxNumHands:            2,       // track up to two hands simultaneously
    modelComplexity:        1,
    minDetectionConfidence: 0.65,
    minTrackingConfidence:  0.55,
  });

  hands.onResults(_onResults);

  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } })
    .then(stream => {
      videoEl.srcObject = stream;
      return new Promise(r => { videoEl.onloadedmetadata = r; });
    })
    .then(() => videoEl.play())
    .then(() => {
      camReady = true;
      const cam = new Camera(videoEl, {
        onFrame: async () => { await hands.send({ image: videoEl }); },
        width: 640, height: 480,
      });
      cam.start();
      setTimeout(() => { hintEl.style.opacity = '0'; }, 4000);
    })
    .catch(err => {
      console.warn('Camera init failed:', err);
      hintEl.textContent = 'Camera unavailable — using mouse interaction';
      _setupMouseFallback();
    });
}

// ─────────────────────────────────────────────────────────────────────────────
//  MediaPipe callback
// ─────────────────────────────────────────────────────────────────────────────

function _onResults(results) {
  // Reset per-frame events
  palmOpenEvent        = false;
  rectPinchBlurTrigger = false;

  const now      = performance.now();   // declared early to avoid TDZ ReferenceError
  const detected = results.multiHandLandmarks || [];
  handCount   = detected.length;
  handPresent = handCount > 0;

  // Record the moment a hand first appears (transition from 0 to >0)
  if (_prevHandCount === 0 && handCount > 0) {
    _handFirstSeenMs = now;
    _prevMaxSpread   = 0;   // reset to avoid spurious trigger on entry
  }
  _prevHandCount = handCount;

  if (!handPresent) {
    handLandmarks     = null;
    palmSpread        = 0;
    rectPinchActive   = false;
    rectCornersNorm   = null;
    rectPinchProgress = 0;
    _prevMaxSpread    = 0;
    _rectBlurFired    = false;
    return;
  }

  // Merge keypoints from all hands into one array for influence calculation (x mirrored)
  handLandmarks = detected.flatMap(lm =>
    lm.map(p => ({ x: 1 - p.x, y: p.y }))
  );

  // ── Process each hand individually ────────────────────────────────────────
  const pinchMidpoints = [];  // pinch midpoints of currently pinching hands
  let maxSpread   = 0;
  let openTrigger = null;     // palm center of the hand that triggered scatter

  for (const lm of detected) {
    // Spread: average distance from wrist to each fingertip
    const wrist  = lm[0];
    const spread = [4,8,12,16,20].reduce((s, i) => {
      const dx = lm[i].x - wrist.x, dy = lm[i].y - wrist.y;
      return s + Math.sqrt(dx*dx + dy*dy);
    }, 0) / 5;
    if (spread > maxSpread) {
      maxSpread   = spread;
      openTrigger = { x: 1 - lm[9].x, y: lm[9].y };
    }

    // Pinch detection (thumb tip [4] vs index tip [8])
    const dx  = lm[4].x - lm[8].x;
    const dy  = lm[4].y - lm[8].y;
    const d   = Math.sqrt(dx*dx + dy*dy);
    if (d < PINCH_DIST_THRESHOLD) {
      pinchMidpoints.push({
        x: 1 - (lm[4].x + lm[8].x) / 2,
        y:     (lm[4].y + lm[8].y) / 2,
      });
    }
  }

  palmSpread = maxSpread;

  // ── Scatter trigger ────────────────────────────────────────────────────────
  // Condition: spread crosses from below close-threshold to above open-threshold.
  // During grace period, _prevMaxSpread stays at 0 so it doesn't update.
  // Once grace ends, if hand is already open it fires immediately;
  // if closed, normal low→high crossing detection resumes.
  if (
    maxSpread > SPREAD_OPEN_THRESHOLD &&
    _prevMaxSpread < SPREAD_OPEN_THRESHOLD * SPREAD_CLOSE_FACTOR &&
    now - _lastScatterMs > SCATTER_COOLDOWN_MS &&
    now - _handFirstSeenMs > HAND_ENTRY_GRACE_MS
  ) {
    palmOpenEvent  = true;
    palmCenterNorm = openTrigger;
    _lastScatterMs = now;
  }

  // Freeze _prevMaxSpread at 0 during grace period;
  // resume normal tracking after it ends so closed→open transitions are detectable.
  if (now - _handFirstSeenMs > HAND_ENTRY_GRACE_MS) {
    _prevMaxSpread = maxSpread;
  }

  // ── Two-hand pinch rectangle ───────────────────────────────────────────────
  if (pinchMidpoints.length >= 2) {
    if (!rectPinchActive) {
      rectPinchActive = true;
      _rectStartMs    = now;
      _rectBlurFired  = false;
    }
    rectCornersNorm = {
      x1: pinchMidpoints[0].x, y1: pinchMidpoints[0].y,
      x2: pinchMidpoints[1].x, y2: pinchMidpoints[1].y,
    };
    rectPinchProgress = Math.min(1, (now - _rectStartMs) / RECT_HOLD_MS);

    // Held for 2s → fire melt trigger once
    if (rectPinchProgress >= 1 && !_rectBlurFired) {
      rectPinchBlurTrigger = true;
      _rectBlurFired       = true;
    }
  } else {
    rectPinchActive   = false;
    rectCornersNorm   = null;
    rectPinchProgress = 0;
    if (pinchMidpoints.length === 0) _rectBlurFired = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Mouse fallback (when camera is unavailable)
// ─────────────────────────────────────────────────────────────────────────────

function _setupMouseFallback() {
  document.addEventListener('mousemove', e => {
    const nx = e.clientX / window.innerWidth;
    const ny = e.clientY / window.innerHeight;
    handPresent = e.clientX > window.innerWidth * 0.05;
    handCount   = handPresent ? 1 : 0;
    palmCenterNorm = handPresent ? { x: nx, y: ny } : null;
    palmSpread = 0.15;
    handLandmarks = handPresent
      ? Array.from({ length: 21 }, () => ({
          x: nx + (Math.random()-0.5)*0.04,
          y: ny + (Math.random()-0.5)*0.04,
        }))
      : null;
  });

  document.addEventListener('click', () => {
    if (handPresent) {
      palmOpenEvent = true;
      setTimeout(() => { palmOpenEvent = false; }, 50);
    }
  });
}