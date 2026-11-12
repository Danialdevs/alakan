// Where the palm comes from:
//  - camera: any camera the browser sees — the VP530 palm scanner (a USB camera in Windows),
//            a laptop or all-in-one webcam. The palm is found by MediaPipe hand detection and/or
//            by "something covered the camera" (the scanner sees the palm up close, fingers may be cut off).
//  - demo:   no hardware, Space bar "puts" a palm
// Every source gives a square colourised picture (`image`), 21 hand points in 0..1 (`landmarks`),
// a coarse mask of the hand for the hologram dots (`mask`, MASK×MASK) and `present`/`hand`.
import { hashString } from './reading.js';

export const SIZE = 360;
export const MASK = 72;

// Biometric colour map: black → deep blue → cyan → white.
const LUT = (() => {
  const stops = [
    [0, [2, 3, 10]], [0.3, [8, 30, 70]], [0.55, [10, 120, 160]], [0.78, [90, 235, 255]], [1, [240, 255, 255]],
  ];
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const [a, ca] = stops[k];
    const [b, cb] = stops[k + 1];
    const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = ca[c] + (cb[c] - ca[c]) * t;
  }
  return lut;
})();

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Converts the work canvas to grayscale with auto levels and paints it with the colour map. */
function colorize(work, out) {
  const ctx = work.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, SIZE, SIZE);
  const d = img.data;
  const n = SIZE * SIZE;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const g = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    gray[i] = g;
    hist[g]++;
  }
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && (acc += hist[lo]) < n * 0.02; lo++);
  for (let acc = 0; hi > 0 && (acc += hist[hi]) < n * 0.01; hi--);
  const span = Math.max(24, hi - lo);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const v = Math.max(0, Math.min(255, ((gray[i] - lo) * 255) / span)) | 0;
    gray[i] = v;
    d[j] = LUT[v * 3];
    d[j + 1] = LUT[v * 3 + 1];
    d[j + 2] = LUT[v * 3 + 2];
    d[j + 3] = 255;
  }
  out.getContext('2d').putImageData(img, 0, 0);
  return gray;
}

// A calm open right palm (fingers up) in 0..1 — used when the source has no hand points.
const TEMPLATE = [
  [0.5, 0.9], [0.385, 0.83], [0.3, 0.735], [0.235, 0.645], [0.185, 0.565],
  [0.385, 0.555], [0.36, 0.43], [0.345, 0.345], [0.335, 0.27],
  [0.48, 0.535], [0.475, 0.39], [0.47, 0.295], [0.465, 0.21],
  [0.575, 0.55], [0.59, 0.415], [0.6, 0.33], [0.605, 0.255],
  [0.66, 0.59], [0.69, 0.495], [0.71, 0.425], [0.725, 0.36],
];

export function templateHand(cx = 0.5, cy = 0.56, scale = 1, breathe = 0) {
  const s = scale * (1 + breathe * 0.015);
  return TEMPLATE.map(([x, y]) => ({ x: cx + (x - 0.5) * s, y: cy + (y - 0.56) * s }));
}

const maskCanvas = makeCanvas(MASK);
/** Draws the hand silhouette from 21 points and returns it as a MASK×MASK array (0..1). */
export function silhouetteMask(lm) {
  const ctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, MASK, MASK);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const P = (i) => [lm[i].x * MASK, lm[i].y * MASK];
  const width = Math.hypot(lm[5].x - lm[17].x, lm[5].y - lm[17].y) * MASK;
  ctx.beginPath();
  for (const [k, i] of [0, 1, 2, 5, 9, 13, 17].entries()) (k ? ctx.lineTo : ctx.moveTo).call(ctx, ...P(i));
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = width * 0.3;
  ctx.stroke();
  for (const [chain, w] of [[[1, 2, 3, 4], 0.3], [[5, 6, 7, 8], 0.26], [[9, 10, 11, 12], 0.27], [[13, 14, 15, 16], 0.25], [[17, 18, 19, 20], 0.22]]) {
    ctx.lineWidth = width * w;
    ctx.beginPath();
    chain.forEach((i, k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, ...P(i)));
    ctx.stroke();
  }
  const d = ctx.getImageData(0, 0, MASK, MASK).data;
  const mask = new Float32Array(MASK * MASK);
  for (let i = 0; i < mask.length; i++) mask[i] = d[i * 4 + 3] / 255;
  return mask;
}

class BaseSource {
  constructor(kind) {
    this.kind = kind;
    this.ready = false;
    this.present = false;
    this.hand = 0;
    this.error = null;
    this.image = null;
    this.landmarks = null;
    this.mask = null;
    this.listeners = new Set();
    this.collecting = null;
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  setPresent(value) {
    if (value !== this.present) {
      this.present = value;
      this.emit();
    }
  }

  beginCollect() {
    this.collecting = [];
  }

  /** Returns { z: six rough z-scores, key: stable fingerprint, hand } from what was seen during the scan. */
  features() {
    const samples = this.collecting || [];
    this.collecting = null;
    return this.summarize(samples);
  }

  summarize() {
    return { z: [], key: String(Math.random()), hand: this.hand };
  }
}

// ------------------------------------------------------------------ Camera
// VP530 cameras: infrared 1d6c:0103 and colour 2c7f:4a60 — Chrome/Edge show the USB id in the label.
const SCANNER_RE = /2c7f:4a60|1d6c:0103|vp530|palm|vein/i;
const SCANNER_PREFERENCE = [/2c7f:4a60/i, /1d6c:0103/i, /vp530|palm|vein/i];

export class CameraSource extends BaseSource {
  constructor(options) {
    super('camera');
    this.options = { ...options };
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.work = makeCanvas(SIZE);
    this.image = makeCanvas(SIZE);
    this.small = makeCanvas(MASK);
    this.devices = [];
    this.label = '';
    this.isScanner = false;
    this.crop = null;
    this.lastVideoTime = -1;
    this.rawSince = 0;
    this.lostSince = 0;
    this.handTracked = false;
    this.bg = null;
    this.bgFrames = 0;
    this.coverSince = 0;
    this.coverage = 0;
  }

  get detect() {
    const d = this.options.detect || 'auto';
    return d === 'auto' ? (this.isScanner ? 'both' : 'hand') : d;
  }

  async start() {
    try {
      await this.open(this.options.deviceId);
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      if (!this.options.deviceId) {
        // Nothing chosen yet: take the palm scanner when it is plugged in.
        for (const re of SCANNER_PREFERENCE) {
          const scanner = this.devices.find((d) => re.test(d.label));
          if (scanner) {
            if (scanner.label !== this.label) await this.open(scanner.deviceId);
            break;
          }
        }
      }
      this.ready = true;
      this.error = null;
    } catch (error) {
      console.error(error);
      this.error = 'camera';
    }
    this.emit();
    if (this.detect !== 'cover') this.loadHands();
    navigator.mediaDevices.addEventListener?.('devicechange', async () => {
      this.devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      this.emit();
    });
  }

  async open(deviceId) {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) },
      audio: false,
    });
    const track = this.stream.getVideoTracks()[0];
    this.label = track.label || '';
    this.deviceId = track.getSettings().deviceId || deviceId || '';
    this.isScanner = SCANNER_RE.test(this.label);
    this.video.srcObject = this.stream;
    await this.video.play();
    this.bg = null;
    this.bgFrames = 0;
    this.crop = null;
  }

  async switchCamera(deviceId) {
    this.options.deviceId = deviceId;
    try {
      await this.open(deviceId);
      this.ready = true;
      this.error = null;
    } catch (error) {
      console.error(error);
      this.error = 'camera';
    }
    if (this.detect !== 'cover') this.loadHands();
    this.emit();
  }

  setOptions(patch) {
    Object.assign(this.options, patch);
    if ('rotate' in patch || 'mirror' in patch) {
      this.bg = null;
      this.bgFrames = 0;
    }
    if (this.detect !== 'cover') this.loadHands();
    this.emit();
  }

  async loadHands() {
    if (this.landmarker || this.loadingHands) return;
    this.loadingHands = true;
    try {
      const vision = await import('./vendor/mediapipe/vision_bundle.mjs');
      const base = new URL('.', import.meta.url).href;
      const fileset = await vision.FilesetResolver.forVisionTasks(`${base}vendor/mediapipe/wasm`);
      const make = (delegate) => vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      });
      this.landmarker = await make('GPU').catch(() => make('CPU'));
    } catch (error) {
      console.error('hand detection unavailable', error);
    }
    this.loadingHands = false;
  }

  // Maps a point of the raw video (0..1) into the square picture (0..1): crop, mirror, rotate.
  toView(p, vw, vh) {
    const { cx, cy, size } = this.crop;
    let u = (p.x * vw - (cx - size / 2)) / size - 0.5;
    const v = (p.y * vh - (cy - size / 2)) / size - 0.5;
    if (this.options.mirror) u = -u;
    const a = ((this.options.rotate || 0) * Math.PI) / 180;
    return { x: u * Math.cos(a) - v * Math.sin(a) + 0.5, y: u * Math.sin(a) + v * Math.cos(a) + 0.5 };
  }

  drawTo(canvas, side, crop) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, side, side);
    ctx.translate(side / 2, side / 2);
    ctx.rotate(((this.options.rotate || 0) * Math.PI) / 180);
    ctx.scale(this.options.mirror ? -1 : 1, 1);
    ctx.drawImage(this.video, crop.cx - crop.size / 2, crop.cy - crop.size / 2, crop.size, crop.size, -side / 2, -side / 2, side, side);
    ctx.restore();
    return ctx;
  }

  update(now) {
    if (!this.ready || this.video.readyState < 2) return;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const full = { cx: vw / 2, cy: vh / 2, size: Math.min(vw, vh) };
    const detect = this.detect;

    // 1) hand points
    let hand = null;
    let handedness = '';
    const fresh = this.video.currentTime !== this.lastVideoTime;
    if (fresh && this.landmarker && detect !== 'cover') {
      const res = this.landmarker.detectForVideo(this.video, now);
      hand = res.landmarks?.[0] || null;
      handedness = res.handedness?.[0]?.[0]?.categoryName || '';
      if (hand && !this.isOpenPalm(hand)) hand = null;
      this.lastHand = hand;
    } else {
      hand = this.lastHand || null;
    }
    if (fresh) this.lastVideoTime = this.video.currentTime;

    // 2) "covered" — difference from the empty camera picture (always the full frame, never zoomed)
    const cover = detect === 'hand' ? null : this.coverCheck(full, now);

    // 3) zoom onto the hand when it is known
    let target = full;
    if (hand) {
      const pts = [0, 5, 9, 13, 17].map((i) => hand[i]);
      const cx = (pts.reduce((s, p) => s + p.x, 0) / 5) * vw;
      const cy = (pts.reduce((s, p) => s + p.y, 0) / 5) * vh;
      const len = Math.hypot((hand[9].x - hand[0].x) * vw, (hand[9].y - hand[0].y) * vh);
      target = { cx, cy: cy - len * 0.25, size: Math.min(full.size, Math.max(200, len * 2.9)) };
    }
    if (!this.crop) this.crop = target;
    const k = 0.18;
    this.crop = {
      cx: this.crop.cx + (target.cx - this.crop.cx) * k,
      cy: this.crop.cy + (target.cy - this.crop.cy) * k,
      size: this.crop.size + (target.size - this.crop.size) * k,
    };
    this.drawTo(this.work, SIZE, this.crop);
    colorize(this.work, this.image);

    this.handTracked = !!hand;
    if (hand) {
      this.landmarks = hand.map((p) => this.toView(p, vw, vh));
      this.mask = silhouetteMask(this.landmarks);
      // MediaPipe labels assume a mirrored picture.
      const flip = this.options.mirror ? 'Right' : 'Left';
      this.hand = handedness === flip ? 2 : handedness ? 1 : 0;
    } else if (cover && cover.present) {
      this.landmarks = templateHand(cover.cx, cover.cy + 0.02, cover.scale);
      this.mask = cover.mask;
    } else {
      this.landmarks = null;
      this.mask = null;
    }

    // 4) present with a little hysteresis
    const raw = !!hand || !!(cover && cover.present);
    if (raw) {
      this.lostSince = 0;
      if (!this.rawSince) this.rawSince = now;
      if (now - this.rawSince > 250) this.setPresent(true);
    } else {
      this.rawSince = 0;
      if (!this.lostSince) this.lostSince = now;
      if (now - this.lostSince > 500) this.setPresent(false);
    }

    if (this.collecting && fresh) {
      if (hand) this.collecting.push({ kind: 'hand', ...this.measure(hand) });
      else if (cover && cover.present) this.collecting.push({ kind: 'cover', ...cover.stats });
    }
  }

  coverCheck(full, now) {
    const ctx = this.drawTo(this.small, MASK, full);
    const d = ctx.getImageData(0, 0, MASK, MASK).data;
    const n = MASK * MASK;
    const gray = new Float32Array(n);
    for (let i = 0; i < n; i++) gray[i] = (d[i * 4] * 77 + d[i * 4 + 1] * 150 + d[i * 4 + 2] * 29) / 256;
    if (!this.bg || this.bgFrames < 8) {
      // the first frames after start: learn the empty picture
      if (!this.bg) this.bg = gray.slice();
      for (let i = 0; i < n; i++) this.bg[i] = (this.bg[i] * this.bgFrames + gray[i]) / (this.bgFrames + 1);
      this.bgFrames++;
      return { present: false };
    }
    const sens = Math.max(0, Math.min(1, this.options.sensitivity ?? 0.5));
    const thr = 14 + (1 - sens) * 30;
    const mask = new Float32Array(n);
    let changed = 0;
    let sx = 0;
    let sy = 0;
    let sum = 0;
    let sum2 = 0;
    let edges = 0;
    for (let y = 0; y < MASK; y++) {
      for (let x = 0; x < MASK; x++) {
        const i = y * MASK + x;
        const diff = Math.abs(gray[i] - this.bg[i]);
        if (diff > thr) {
          mask[i] = Math.min(1, (diff - thr) / thr + 0.4);
          changed++;
          sx += x;
          sy += y;
          const v = gray[i] / 255;
          sum += v;
          sum2 += v * v;
          if (x + 1 < MASK) edges += Math.abs(gray[i + 1] - gray[i]) / 255;
        }
      }
    }
    const coverage = changed / n;
    this.coverage = coverage;
    const present = coverage > 0.32 - sens * 0.2;
    if (present) {
      if (!this.coverSince) this.coverSince = now;
      // Something has lain on the camera for 2 minutes — it is the new background, not a palm.
      if (now - this.coverSince > 120000) {
        this.bg = gray;
        this.coverSince = 0;
      }
    } else {
      this.coverSince = 0;
      for (let i = 0; i < n; i++) this.bg[i] = this.bg[i] * 0.97 + gray[i] * 0.03;
    }
    if (!changed) return { present };
    const mean = sum / changed;
    return {
      present,
      mask,
      cx: sx / changed / MASK,
      cy: sy / changed / MASK,
      scale: Math.min(1.25, Math.max(0.7, Math.sqrt(coverage) * 1.5)),
      stats: { area: coverage, edges: edges / changed, std: Math.sqrt(Math.max(0, sum2 / changed - mean * mean)), cy: sy / changed / MASK, cx: sx / changed / MASK, mean },
    };
  }

  isOpenPalm(h) {
    const d = (a, b) => Math.hypot(h[a].x - h[b].x, h[a].y - h[b].y);
    let open = 0;
    for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) if (d(tip, 0) > d(pip, 0) * 1.08) open++;
    return open >= 3;
  }

  measure(h) {
    const d = (a, b) => Math.hypot(h[a].x - h[b].x, h[a].y - h[b].y);
    const angle = (a, b, c, e) => {
      const v1 = [h[b].x - h[a].x, h[b].y - h[a].y];
      const v2 = [h[e].x - h[c].x, h[e].y - h[c].y];
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) || 1);
      return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    };
    const palm = d(0, 9) || 1;
    return {
      digit: d(5, 8) / (d(13, 16) || 1), // index / ring finger
      middle: d(9, 12) / palm,
      width: d(5, 17) / palm,
      thumb: angle(2, 4, 0, 5),
      spread: angle(5, 8, 17, 20),
      pinky: d(17, 20) / (d(13, 16) || 1),
    };
  }

  summarize(samples) {
    const hands = samples.filter((s) => s.kind === 'hand');
    if (hands.length >= 3) {
      const avg = (k) => hands.reduce((s, x) => s + x[k], 0) / hands.length;
      const m = Object.fromEntries(['digit', 'middle', 'width', 'thumb', 'spread', 'pinky'].map((k) => [k, avg(k)]));
      const zs = {
        digit: (m.digit - 0.96) / 0.05, middle: (m.middle - 0.95) / 0.1, width: (m.width - 0.85) / 0.09,
        thumb: (m.thumb - 40) / 14, spread: (m.spread - 25) / 12, pinky: (m.pinky - 0.78) / 0.07,
      };
      // Palmistry folklore: long ring finger — boldness, wide thumb — will, long fingers — imagination…
      const z = [
        0.6 * zs.thumb - 0.5 * zs.digit + 0.3 * zs.width, // leadership
        0.6 * zs.pinky + 0.4 * zs.spread, // intuition
        0.6 * zs.middle + 0.4 * zs.spread, // creativity
        0.7 * zs.digit - 0.2 * zs.width + 0.2 * zs.pinky, // empathy
        0.6 * zs.width + 0.3 * zs.middle - 0.2 * zs.spread, // logic
        0.5 * zs.width + 0.5 * zs.thumb, // energy
      ];
      return { z, key: `hand:${this.hand}:` + Object.values(m).map((v) => v.toFixed(2)).join(','), hand: this.hand };
    }
    const covers = samples.filter((s) => s.kind === 'cover');
    if (!covers.length) return super.summarize();
    const avg = (k) => covers.reduce((s, x) => s + x[k], 0) / covers.length;
    const stats = ['area', 'edges', 'std', 'cy', 'cx', 'mean'].map(avg);
    // No population statistics for close-up palms: each measurement is spread by a stable hash.
    const z = stats.map((v, i) => ((hashString(`${i}:${v.toFixed(2)}`) % 1000) / 1000 - 0.5) * 3);
    return { z, key: 'cover:' + stats.map((v) => v.toFixed(2)).join(','), hand: this.hand };
  }
}

// ------------------------------------------------------------------ Demo
export class DemoSource extends BaseSource {
  constructor() {
    super('demo');
  }

  async start() {
    this.ready = true;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !e.repeat) this.setPresent(!this.present);
    });
    this.emit();
  }

  update(now) {
    this.landmarks = this.present ? templateHand(0.5, 0.56, 1, Math.sin(now / 700)) : null;
    this.mask = this.landmarks ? silhouetteMask(this.landmarks) : null;
  }

  summarize() {
    return { z: [], key: `demo:${Date.now()}`, hand: 1 };
  }
}
