// sketch.js — Listen to the Cold Rain · Dual-Hand Gesture Text Installation
//
// Gesture 1: Either hand open  → character ripple scatter (original)
// Gesture 2: Both hands pinch  → form a rectangle, hold 2s → text melts downward like rain

// ── Poem character pool ───────────────────────────────────────────────────────
const POEM =
  '前尘隔海古屋不在听听那冷雨杏花春雨江南' +
  '六个方块字或许那片土就在那里面而无论赤县也好神州也好中国也好' +
  '变来变去只要仓颉的灵感不灭美丽的中文不老' +
  '那形象那磁石一般的向心力当必然长在' +
  '因为一个方块字是一个天地太初有字' +
  '于是汉族的心灵他祖先的回忆和希望便有了寄托' +
  '譬如凭空写一个雨字点点滴滴滂滂沱沱' +
  '淅沥淅沥淅沥一切云情雨意就宛然其中了' +
  '雨雨雨雨雨雨雨雨雨雨雨雨雨雨水水水';
const POOL      = [...POEM];
const RAIN_POOL = [...'雨滴点沱沥淅云露滂'];

// ── Constants ─────────────────────────────────────────────────────────────────
const CELL         = 25;    // slightly bigger — makes poem text more readable
const FONT_SZ      = 17;    // was 15
const CYCLE_MIN    = 10;    // was 7 — characters stay a touch longer
const CYCLE_MAX    = 28;    // was 20
const TRAIL_DECAY  = 0.89;
const BRIGHT_FLOOR = 0.018;
const INFLUENCE_R  = 0.072;  // hand keypoint influence radius (relative to screen width)
const SCATTER_R    = 0.22;

const MELT_TOTAL   = 2200;   // total melt duration (ms), frame-rate independent
const MELT_STREAKS = 5;      // number of trail layers

const CAM_OPACITY = 0.14;
const CAM_FILTER  = 'grayscale(0.90) brightness(0.42) contrast(0.88)';

// ── Grid state ────────────────────────────────────────────────────────────────
let cells   = [];
let cols    = 0;
let rows    = 0;
let _cursor = 0;

// ─────────────────────────────────────────────────────────────────────────────
//  p5 LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif");
  textAlign(CENTER, CENTER);
  noStroke();
  _buildGrid();
  initHandDetection();
}

function draw() {
  background(8, 10, 14);

  // 1. Camera background (desaturated + blue tint, very low opacity)
  _drawCameraBackground();

  // 2. Brightness decay (trail fade)
  for (const c of cells) {
    if (!c.melting) {
      c.bright = c.bright * TRAIL_DECAY + BRIGHT_FLOOR * (1 - TRAIL_DECAY);
    }
  }

  // 3. Hand influence (all keypoints from both hands)
  if (handLandmarks) _applyHandInfluence();

  // 4. Ripple scatter (open palm)
  if (palmOpenEvent && palmCenterNorm) {
    _triggerScatter(palmCenterNorm.x * width, palmCenterNorm.y * height);
  }

  // 5. Rectangle melt trigger
  if (rectPinchBlurTrigger && rectCornersNorm) {
    const x1 = Math.min(rectCornersNorm.x1, rectCornersNorm.x2) * width;
    const y1 = Math.min(rectCornersNorm.y1, rectCornersNorm.y2) * height;
    const x2 = Math.max(rectCornersNorm.x1, rectCornersNorm.x2) * width;
    const y2 = Math.max(rectCornersNorm.y1, rectCornersNorm.y2) * height;
    _triggerRectMelt(x1, y1, x2, y2);
  }

  // 6. Update + draw characters
  for (const c of cells) {
    _updateCell(c);
    _drawCell(c);
  }

  // 7. Pinch rectangle overlay (drawn above character layer)
  if (rectPinchActive && rectCornersNorm) _drawPinchRect();

  // 8. Vignette
  _drawVignette();

  if (_debugOn) _drawDebug();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  _buildGrid();
}

let _debugOn = false;
function keyPressed() {
  if (key === 'd' || key === 'D') {
    _debugOn = !_debugOn;
    document.getElementById('debug').style.display = _debugOn ? 'block' : 'none';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Camera background
// ─────────────────────────────────────────────────────────────────────────────

function _drawCameraBackground() {
  if (typeof videoEl === 'undefined' || !camReady) return;
  if (!videoEl || videoEl.readyState < 2) return;
  const ctx = drawingContext;
  ctx.save();
  ctx.filter = CAM_FILTER;
  ctx.globalAlpha = CAM_OPACITY;
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, 0, 0, width, height);
  ctx.restore();
  noStroke();
  fill(8, 18, 50, 28);
  rect(0, 0, width, height);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Vignette
// ─────────────────────────────────────────────────────────────────────────────

function _drawVignette() {
  const ctx = drawingContext;
  ctx.save();
  const cx = width/2, cy = height/2;
  const grad = ctx.createRadialGradient(cx, cy, Math.min(width,height)*0.28,
                                         cx, cy, Math.max(width,height)*0.78);
  grad.addColorStop(0,   'rgba(0,0,0,0)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.18)');
  grad.addColorStop(1,   'rgba(0,0,0,0.72)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Grid construction
// ─────────────────────────────────────────────────────────────────────────────

function _buildGrid() {
  cells = [];
  cols = Math.floor(width  / CELL);
  rows = Math.floor(height / CELL);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * CELL;
      const y = (r + 0.5) * CELL;
      cells.push({
        ox: x, oy: y, x, y,
        char:       POOL[(r * cols + c) % POOL.length],
        timer:      Math.floor(Math.random() * CYCLE_MAX),
        bright:     BRIGHT_FLOOR + Math.random() * 0.03,
        vx: 0, vy: 0,
        scattering: false,
        melting:    false,
        meltFrame:  0,
        meltSpeed:  1,
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cell update
// ─────────────────────────────────────────────────────────────────────────────

function _updateCell(c) {
  // Character swap
  c.timer--;
  if (c.timer <= 0) {
    c.timer = CYCLE_MIN + Math.floor(Math.random() * (CYCLE_MAX - CYCLE_MIN));
    _cursor = (_cursor + 1 + Math.floor(Math.random() * 3)) % POOL.length;
    if (!c.melting) c.char = POOL[_cursor];
  }

  // Spring return (after ripple scatter)
  if (c.scattering) {
    c.vx += (c.ox - c.x) * 0.040;
    c.vy += (c.oy - c.y) * 0.040;
    c.vx *= 0.87; c.vy *= 0.87;
    c.x += c.vx;  c.y += c.vy;
    if ((c.x-c.ox)**2 + (c.y-c.oy)**2 < 0.25 && c.vx**2+c.vy**2 < 0.02) {
      c.x=c.ox; c.y=c.oy; c.vx=0; c.vy=0; c.scattering=false;
    }
  }

  // Melt progress: accumulate deltaTime (ms), fully frame-rate independent.
  // meltSpeed is a time multiplier: 0.85 → ~2.6s, 1.30 → ~1.7s
  if (c.melting) {
    c.meltFrame += deltaTime * c.meltSpeed;
    if (c.meltFrame > 80 && c.meltFrame < MELT_TOTAL * 0.72) {
      if (Math.random() < 0.06) {
        c.char = RAIN_POOL[Math.floor(Math.random() * RAIN_POOL.length)];
      }
    }
    if (c.meltFrame >= MELT_TOTAL) {
      c.melting   = false;
      c.meltFrame = 0;
      c.bright    = BRIGHT_FLOOR;
      c.char      = POOL[Math.floor(Math.random() * POOL.length)];
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Cell draw
// ─────────────────────────────────────────────────────────────────────────────

function _drawCell(c) {
  const b = Math.min(1, c.bright);

  // Three-stop color ramp
  let r, g, bl;
  if (b < 0.38) {
    const t = b / 0.38;
    r=14+t*(55-14); g=22+t*(130-22); bl=42+t*(195-42);
  } else if (b < 0.72) {
    const t = (b-0.38)/0.34;
    r=55+t*(165-55); g=130+t*(210-130); bl=195+t*(240-195);
  } else {
    const t = (b-0.72)/0.28;
    r=165+t*(225-165); g=210+t*(244-210); bl=240+t*(255-240);
  }

  if (c.melting) {
    // ── Melt effect: downward trails, like rain sliding down glass ────────────
    const prog      = c.meltFrame / MELT_TOTAL;
    const maxDrop   = CELL * 7 * prog;
    // Fading starts at 20% progress — trails begin disappearing almost immediately
    // rather than staying at full brightness for 1+ seconds (the original 0.55 bug)
    const fadeStart = 0.50;

    for (let i = 0; i < MELT_STREAKS; i++) {
      const t       = i / (MELT_STREAKS - 1);       // 0 = top layer, 1 = lowest
      const yOff    = t * maxDrop;
      // Top layer brightest/largest; lower layers dimmer and smaller
      const streakA = (1 - t * 0.78) * (prog < fadeStart ? 1 : 1 - (prog - fadeStart) / (1 - fadeStart));
      const sz      = Math.max(8, FONT_SZ - t * 3 + b * 3);
      textSize(sz);
      fill(r, g, bl, Math.max(0, streakA) * 255 * b);  // b not floored — fully invisible when bright=0
      text(c.char, c.x, c.y + yOff);
    }
  } else {
    // ── Normal draw ───────────────────────────────────────────────────────────
    textSize(FONT_SZ - 1 + b * 4.5);
    fill(r, g, bl);
    text(c.char, c.x, c.y);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hand influence (supports both hands)
// ─────────────────────────────────────────────────────────────────────────────

function _applyHandInfluence() {
  const R = width * INFLUENCE_R;
  for (const lm of handLandmarks) {
    const lx = lm.x * width;
    const ly = lm.y * height;
    const minC = Math.max(0,     Math.floor((lx-R)/CELL));
    const maxC = Math.min(cols-1, Math.ceil ((lx+R)/CELL));
    const minR = Math.max(0,     Math.floor((ly-R)/CELL));
    const maxR = Math.min(rows-1, Math.ceil ((ly+R)/CELL));
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const cell = cells[r*cols+c];
        if (!cell) continue;
        const dx = cell.x-lx, dy = cell.y-ly;
        const d  = Math.sqrt(dx*dx+dy*dy);
        if (d < R) {
          const inf = Math.pow(1-d/R, 1.6);
          if (inf > cell.bright) cell.bright = inf;
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Ripple scatter (open palm)
// ─────────────────────────────────────────────────────────────────────────────

function _triggerScatter(cx, cy) {
  const R = width * SCATTER_R;
  for (const c of cells) {
    const dx = c.ox-cx, dy = c.oy-cy;
    const d = Math.sqrt(dx*dx+dy*dy);
    if (d < R) {
      const force = map(d, 0, R, 22, 2.5);
      const angle = Math.atan2(dy, dx);
      const turb  = (Math.random()-0.5)*0.55;
      c.vx = Math.cos(angle+turb)*force*(0.8+Math.random()*0.4);
      c.vy = Math.sin(angle+turb)*force*(0.8+Math.random()*0.4);
      c.scattering = true;
      c.bright     = Math.min(1.0, c.bright+0.55+Math.random()*0.45);
      c.char       = RAIN_POOL[Math.floor(Math.random()*RAIN_POOL.length)];
      c.timer      = 8;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Rectangle melt trigger
// ─────────────────────────────────────────────────────────────────────────────

function _triggerRectMelt(rx1, ry1, rx2, ry2) {
  const minC = Math.max(0,     Math.floor(rx1/CELL));
  const maxC = Math.min(cols-1, Math.ceil (rx2/CELL));
  const minR = Math.max(0,     Math.floor(ry1/CELL));
  const maxR = Math.min(rows-1, Math.ceil (ry2/CELL));

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      const cell = cells[r*cols+c];
      if (!cell || cell.melting) continue;
      cell.melting   = true;
      cell.meltFrame = 0;
      // Speed multiplier: 0.85–1.30, varied per cell for organic irregularity
      cell.meltSpeed = 0.85 + Math.random() * 0.45;
      cell.bright    = 0.4 + Math.random() * 0.6;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Pinch rectangle overlay
// ─────────────────────────────────────────────────────────────────────────────

function _drawPinchRect() {
  const c = rectCornersNorm;
  const x1 = Math.min(c.x1, c.x2) * width;
  const y1 = Math.min(c.y1, c.y2) * height;
  const x2 = Math.max(c.x1, c.x2) * width;
  const y2 = Math.max(c.y1, c.y2) * height;
  const rw = x2 - x1, rh = y2 - y1;
  const prog = rectPinchProgress;  // 0 → 1

  // Subtle fill, more visible as progress increases
  noStroke();
  fill(60, 160, 220, 10 + prog * 18);
  rect(x1, y1, rw, rh);

  // ── Border: dark blue → bright white, brightens with progress ─────────────
  const lineAlpha = 80 + prog * 160;
  const lineW     = 1.0 + prog * 1.2;

  // Outer glow
  stroke(60, 160, 220, lineAlpha * 0.3);
  strokeWeight(lineW + 4);
  noFill();
  rect(x1, y1, rw, rh);

  // Core line
  stroke(120, 210, 255, lineAlpha);
  strokeWeight(lineW);
  rect(x1, y1, rw, rh);

  // ── Progress animation: edges "charge up" in sequence ────────────────────
  // Map prog to perimeter distance, draw a brighter leading segment
  const perim   = 2 * (rw + rh);
  const traveled = prog * perim;
  const corners = [
    [x1, y1, x2, y1],   // top
    [x2, y1, x2, y2],   // right
    [x2, y2, x1, y2],   // bottom
    [x1, y2, x1, y1],   // left
  ];
  const segLens = [rw, rh, rw, rh];

  stroke(200, 240, 255, 220);
  strokeWeight(lineW + 1.5);
  let remaining = traveled;
  for (let i = 0; i < 4 && remaining > 0; i++) {
    const [ax, ay, bx, by] = corners[i];
    const segL = segLens[i];
    const t = Math.min(1, remaining / segL);
    line(ax, ay, ax + (bx-ax)*t, ay + (by-ay)*t);
    remaining -= segL;
  }

  // Countdown label (appears when nearing 2s)
  if (prog > 0.6) {
    noStroke();
    const remain = ((1 - prog) * 2).toFixed(1);
    textSize(11);
    fill(160, 220, 255, (prog - 0.6) * 2.5 * 180);
    text(remain + 's', (x1 + x2) / 2, y1 - 12);
  }

  noStroke();
}

// ─────────────────────────────────────────────────────────────────────────────
//  Debug overlay
// ─────────────────────────────────────────────────────────────────────────────

function _drawDebug() {
  const el = document.getElementById('debug');
  if (!el) return;
  el.innerHTML = [
    `hands   : ${handCount}`,
    `spread  : ${palmSpread.toFixed(3)}`,
    `scatter : ${palmOpenEvent}`,
    `rect    : ${rectPinchActive} / ${(rectPinchProgress*100).toFixed(0)}%`,
    `melt    : ${rectPinchBlurTrigger}`,
    `cam     : ${typeof videoEl !== 'undefined' && camReady}`,
    `cells   : ${cells.length}`,
    `fps     : ${frameRate().toFixed(1)}`,
  ].join('<br>');
}