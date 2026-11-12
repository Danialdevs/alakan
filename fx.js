// Full-screen scene on one canvas: background, the scanner circle with the palm hologram,
// scan beam, palm lines, HUD rings, voice-reactive bars and particle bursts.
import { MASK, templateHand, silhouetteMask } from './sources.js';
import { rng } from './reading.js';

const TAU = Math.PI * 2;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (p, q, t) => ({ x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) });

export const LINE_COLORS = { life: '#ff4fd8', heart: '#ff6b81', head: '#6ff7ff', fate: '#ffd36b' };

/** Life, heart, head and fate lines from 21 hand points (0..1), slightly varied by the reading seed. */
export function palmLines(lm, seed = 1) {
  const r = rng(seed);
  const P = (i) => lm[i];
  const up = { x: P(9).x - P(0).x, y: P(9).y - P(0).y };
  const across = { x: P(17).x - P(5).x, y: P(17).y - P(5).y };
  const jit = (p, a = 0.05, b = 0.05) => ({
    x: p.x + up.x * (r() - 0.5) * a + across.x * (r() - 0.5) * b,
    y: p.y + up.y * (r() - 0.5) * a + across.y * (r() - 0.5) * b,
  });
  const quad = (a, c, b, n = 40) => Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return { x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t * t * b.y };
  });
  const cubic = (a, b, c, d, n = 48) => Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return {
      x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
      y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
    };
  });
  const center = {
    x: (P(0).x + P(5).x + P(9).x + P(13).x + P(17).x) / 5,
    y: (P(0).y + P(5).y + P(9).y + P(13).y + P(17).y) / 5,
  };
  const startLH = jit(mix(P(2), P(5), 0.55), 0.04, 0.04);
  const heartStart = jit({ x: mix(P(17), P(0), 0.17).x + across.x * 0.12, y: mix(P(17), P(0), 0.17).y + across.y * 0.12 });
  return {
    heart: quad(heartStart, jit(mix(P(13), P(0), 0.2), 0.08), jit(mix(mix(P(5), P(9), 0.55), P(0), 0.12), 0.06)),
    head: quad(startLH, jit(mix(mix(P(9), P(13), 0.5), P(0), 0.36), 0.1), jit(mix(P(17), P(0), 0.48), 0.12)),
    life: cubic(startLH, jit(mix(startLH, center, 0.85), 0.06), jit(mix(mix(P(0), P(1), 0.5), center, 0.45), 0.06), jit(mix(P(0), P(1), 0.3), 0.04)),
    fate: quad(jit(mix(P(0), P(9), 0.06), 0, 0.1), jit(mix(P(0), P(9), 0.45), 0, 0.16), jit(mix(P(0), P(9), 0.86), 0.04, 0.06)),
  };
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.bursts = [];
    this.waves = [];
    this.resultK = 0;
    this.lockK = 0;
    this.flash = 0;
    this.idleMask = null;
    this.idleMaskAt = 0;
    this.lastMask = null;
    this.maskFade = 0;
    window.addEventListener('resize', () => this.resize());
    this.resize();
    for (let i = 0; i < 260; i++) this.particles.push(this.spawn(true));
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.W = window.innerWidth;
    this.H = window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.portrait = this.W / this.H < 1.2;
    this.grid = this.makeHexGrid();
  }

  layout() {
    const { W, H } = this;
    const R0 = Math.min(H * 0.26, W * 0.22);
    const k = ease(this.resultK);
    const end = this.portrait ? { x: W / 2, y: H * 0.27, r: R0 * 0.8 } : { x: W * 0.29, y: H * 0.5, r: R0 * 1.1 };
    return { cx: lerp(W / 2, end.x, k), cy: lerp(H * 0.43, end.y, k), R: lerp(R0, end.r, k) };
  }

  makeHexGrid() {
    const c = document.createElement('canvas');
    c.width = Math.max(1, this.W);
    c.height = Math.max(1, this.H);
    const g = c.getContext('2d');
    const s = 26;
    const h = s * Math.sqrt(3);
    g.strokeStyle = 'rgba(80,220,255,1)';
    g.lineWidth = 1;
    g.beginPath();
    for (let y = -h; y < this.H + h; y += h) {
      for (let x = -s * 3, col = 0; x < this.W + s * 3; x += s * 1.5, col++) {
        const yy = y + (col % 2 ? h / 2 : 0);
        for (let i = 0; i <= 6; i++) {
          const a = (Math.PI / 3) * i;
          const px = x + s * Math.cos(a);
          const py = yy + s * Math.sin(a);
          i ? g.lineTo(px, py) : g.moveTo(px, py);
        }
      }
    }
    g.stroke();
    g.globalCompositeOperation = 'destination-in';
    const grad = g.createRadialGradient(this.W / 2, this.H / 2, 0, this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.6);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, this.W, this.H);
    return c;
  }

  spawn(anywhere = false) {
    const a = Math.random() * TAU;
    const far = Math.hypot(this.W, this.H) * 0.6;
    return {
      a,
      d: anywhere ? 80 + Math.random() * far : far * (0.8 + Math.random() * 0.3),
      v: 0.2 + Math.random() * 0.8,
      s: 0.6 + Math.random() * 1.6,
      tw: Math.random() * TAU,
    };
  }

  burst(cx, cy, R, hue) {
    for (let i = 0; i < 240; i++) {
      const a = Math.random() * TAU;
      const sp = 120 + Math.random() * 520;
      this.bursts.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, hue: hue + (Math.random() - 0.5) * 40, s: 1 + Math.random() * 2.5 });
    }
    this.waves.push({ r: R, a: 1, hue }, { r: R * 0.9, a: 0.7, hue: hue + 40, delay: 0.12 });
    this.flash = 1;
  }

  /**
   * s: { mode, modeTime, progress, present, source, lines: {name: {pts, reveal}}, lineLabels, hue, level, freq, paused }
   */
  draw(t, dt, s) {
    const { ctx, W, H } = this;
    this.resultK = clamp01(this.resultK + (s.mode === 'result' ? dt / 1.1 : -dt / 0.8));
    const locked = s.mode === 'lock' || s.mode === 'scan' || s.mode === 'analyze';
    this.lockK = clamp01(this.lockK + (locked ? dt / 0.5 : -dt / 0.4));
    this.flash = Math.max(0, this.flash - dt * 1.6);

    const { cx, cy, R } = this.layout();
    const scanning = s.mode === 'scan';
    const baseHue = lerp(190, s.hue ?? 190, ease(this.resultK));

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // ---------- background
    ctx.fillStyle = '#02030a';
    ctx.fillRect(0, 0, W, H);
    for (const [i, blob] of [[0, 0.3], [1, 0.7]].entries()) {
      const bx = W * (blob[1] + 0.12 * Math.sin(t * 0.07 + i * 2));
      const by = H * (0.4 + 0.2 * Math.cos(t * 0.05 + i * 3));
      const g = ctx.createRadialGradient(bx, by, 0, bx, by, Math.max(W, H) * 0.55);
      const hue = i ? baseHue + 70 : baseHue;
      g.addColorStop(0, `hsla(${hue},90%,45%,${0.13 + 0.06 * this.resultK})`);
      g.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalAlpha = 0.05 + 0.05 * this.lockK + 0.04 * Math.sin(t * 0.8) ** 2;
    ctx.drawImage(this.grid, 0, 0);
    ctx.globalAlpha = 1;

    // ---------- particles: drift, then spiral into the scanner while scanning
    ctx.globalCompositeOperation = 'lighter';
    const pull = scanning ? 1 : s.mode === 'lock' ? 0.5 : 0;
    for (const p of this.particles) {
      p.a += dt * (0.02 + pull * 0.5 / Math.max(0.6, p.d / 300)) * p.v;
      p.d += dt * (pull ? -pull * 160 * p.v : 6 * p.v);
      if (p.d < R + 20 || p.d > Math.hypot(W, H) * 0.75) Object.assign(p, this.spawn(!pull));
      const x = cx + Math.cos(p.a) * p.d;
      const y = cy + Math.sin(p.a) * p.d;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.5 + p.tw));
      ctx.fillStyle = `hsla(${baseHue + p.v * 60},100%,70%,${(0.25 + pull * 0.4) * tw})`;
      ctx.fillRect(x, y, p.s, p.s);
      if (pull) {
        ctx.strokeStyle = `hsla(${baseHue + p.v * 60},100%,70%,${0.12 * tw})`;
        ctx.lineWidth = p.s * 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(cx + Math.cos(p.a - 0.04) * (p.d + 30 * p.v), cy + Math.sin(p.a - 0.04) * (p.d + 30 * p.v));
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';

    // ---------- inside the circle
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();
    const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    inner.addColorStop(0, `hsla(${baseHue},80%,10%,1)`);
    inner.addColorStop(1, '#01030a');
    ctx.fillStyle = inner;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

    const src = s.source;
    // after the scan: the saved photo of the palm, not the live camera
    const picture = s.photo || (src && src.ready ? src.image : null);
    if (picture) {
      const a = s.photo ? (s.mode === 'result' ? 0.9 : 0.8) : s.mode === 'idle' ? (s.present ? 0.6 : 0.32) : 0.78;
      ctx.globalAlpha = a;
      ctx.drawImage(picture, cx - R, cy - R, 2 * R, 2 * R);
      ctx.globalAlpha = 1;
    }

    // radar sweep while waiting
    if (s.mode === 'idle') {
      const cg = ctx.createConicGradient(t * 1.2, cx, cy);
      cg.addColorStop(0, `hsla(${baseHue},100%,60%,0.22)`);
      cg.addColorStop(0.12, 'hsla(0,0%,0%,0)');
      cg.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.fillStyle = cg;
      ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    }

    // fine grid
    ctx.strokeStyle = `hsla(${baseHue},100%,70%,0.07)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -8; i <= 8; i++) {
      ctx.moveTo(cx + (i * R) / 8, cy - R);
      ctx.lineTo(cx + (i * R) / 8, cy + R);
      ctx.moveTo(cx - R, cy + (i * R) / 8);
      ctx.lineTo(cx + R, cy + (i * R) / 8);
    }
    ctx.stroke();

    // hologram of the hand made of dots
    let mask = src && src.mask;
    if (!mask && s.mode === 'idle') {
      if (!this.idleMask || t - this.idleMaskAt > 0.08) {
        this.idleMask = silhouetteMask(templateHand(0.5, 0.56, 0.98, Math.sin(t * 1.4)));
        this.idleMaskAt = t;
      }
      mask = this.idleMask;
    }
    if (mask && s.mode !== 'result') {
      this.lastMask = mask;
      this.maskFade = Math.min(1, this.maskFade + dt * 3);
    } else if (s.mode === 'result' && this.lastMask) {
      mask = this.lastMask; // the scanned hand stays under the lines on the result screen
      this.maskFade = Math.min(1, this.maskFade + dt * 3);
    } else {
      this.maskFade = Math.max(0, this.maskFade - dt * 2);
      mask = this.maskFade > 0 ? this.lastMask : null;
    }
    const beamY = cy + R * 0.95 * Math.sin(t * 1.7);
    if (mask) {
      const cell = (2 * R) / MASK;
      const dot = Math.max(1.2, cell * 0.34);
      const idle = s.mode === 'idle' && !(src && src.mask);
      const fade = this.maskFade * (s.mode === 'result' ? (s.photo ? 0.25 : 0.55) : 1);
      ctx.globalCompositeOperation = 'lighter';
      const levels = [[], [], [], []];
      for (let y = 0; y < MASK; y++) {
        const py = cy - R + (y + 0.5) * cell;
        const beam = scanning ? Math.max(0, 1 - Math.abs(py - beamY) / (R * 0.18)) : 0;
        for (let x = 0; x < MASK; x++) {
          const m = mask[y * MASK + x];
          if (m < 0.35) continue;
          const px = cx - R + (x + 0.5) * cell;
          const shimmer = idle ? 0.5 + 0.5 * Math.sin(t * 2 - y * 0.18) : 0.6 + 0.4 * Math.sin(t * 3 + x * 0.7 + y * 0.3);
          const v = Math.min(3, Math.floor((m * 0.6 + shimmer * 0.4) * 2 + beam * 2.2));
          levels[v].push(px, py);
        }
      }
      const alphas = idle ? [0.12, 0.22, 0.38, 0.6] : [0.22, 0.4, 0.65, 1];
      levels.forEach((pts, i) => {
        ctx.fillStyle = `hsla(${baseHue + i * 6},100%,${60 + i * 8}%,${alphas[i] * fade})`;
        const sz = dot * (1 + i * 0.18);
        for (let k = 0; k < pts.length; k += 2) ctx.fillRect(pts[k] - sz / 2, pts[k + 1] - sz / 2, sz, sz);
      });
      ctx.globalCompositeOperation = 'source-over';
    }

    // hand skeleton (only when MediaPipe found real fingers)
    if (src && src.handTracked && src.landmarks && this.lockK > 0 && s.mode !== 'result') {
      const L = src.landmarks;
      const P = (i) => [cx - R + L[i].x * 2 * R, cy - R + L[i].y * 2 * R];
      ctx.strokeStyle = `hsla(${baseHue},100%,75%,${0.35 * this.lockK})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const chain of [[0, 1, 2, 3, 4], [0, 5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [0, 17, 18, 19, 20], [5, 9, 13, 17]]) {
        chain.forEach((i, k) => (k ? ctx.lineTo : ctx.moveTo).call(ctx, ...P(i)));
      }
      ctx.stroke();
      for (let i = 0; i < 21; i++) {
        const [x, y] = P(i);
        ctx.strokeStyle = `hsla(${baseHue},100%,80%,${0.7 * this.lockK})`;
        ctx.beginPath();
        ctx.arc(x, y, i % 4 === 0 ? 5 : 3, 0, TAU);
        ctx.stroke();
      }
    }

    // scan beam
    if (scanning && !s.paused) {
      const dir = Math.cos(t * 1.7) >= 0 ? 1 : -1;
      const trail = ctx.createLinearGradient(0, beamY, 0, beamY - dir * R * 0.45);
      trail.addColorStop(0, `hsla(${baseHue + 120},100%,65%,0.35)`);
      trail.addColorStop(1, 'hsla(0,0%,0%,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = trail;
      ctx.fillRect(cx - R, Math.min(beamY, beamY - dir * R * 0.45), 2 * R, R * 0.45);
      ctx.shadowColor = `hsl(${baseHue + 120},100%,70%)`;
      ctx.shadowBlur = 24;
      ctx.fillStyle = `hsla(${baseHue + 120},100%,85%,0.95)`;
      ctx.fillRect(cx - R, beamY - 1.5, 2 * R, 3);
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'source-over';
    }

    // palm lines
    if (s.lines) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const [name, line] of Object.entries(s.lines)) {
        if (!line.reveal) continue;
        const n = Math.max(2, Math.floor(line.pts.length * clamp01(line.reveal)));
        const pts = line.pts.slice(0, n).map((p) => [cx - R + p.x * 2 * R, cy - R + p.y * 2 * R]);
        const color = LINE_COLORS[name];
        ctx.shadowColor = color;
        ctx.shadowBlur = 18;
        ctx.strokeStyle = color;
        ctx.globalAlpha = s.mode === 'result' ? 0.85 : 1;
        ctx.lineWidth = Math.max(2.5, R * 0.014);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        const [hx, hy] = pts[pts.length - 1];
        if (line.reveal < 1) {
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(hx, hy, 5, 0, TAU);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        // label
        if (line.reveal > 0.25 && s.lineLabels && s.mode !== 'result') {
          const [lx, ly] = pts[Math.floor(pts.length * 0.5)];
          ctx.font = `600 ${Math.round(R * 0.045)}px "Segoe UI", system-ui, sans-serif`;
          const text = s.lineLabels[name];
          const tw = ctx.measureText(text).width;
          const a = clamp01((line.reveal - 0.25) * 3);
          ctx.globalAlpha = a;
          ctx.fillStyle = 'rgba(2,6,16,0.75)';
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          const bx = lx + 12;
          const by = ly - 26;
          ctx.beginPath();
          ctx.roundRect(bx, by, tw + 16, R * 0.07, 4);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = color;
          ctx.fillText(text, bx + 8, by + R * 0.052);
          ctx.globalAlpha = 1;
        }
      }
    }

    // vignette and flash
    const vg = ctx.createRadialGradient(cx, cy, R * 0.62, cx, cy, R);
    vg.addColorStop(0, 'rgba(2,3,10,0)');
    vg.addColorStop(1, 'rgba(2,3,10,0.92)');
    ctx.fillStyle = vg;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.8})`;
      ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    }
    ctx.restore();

    // ---------- HUD rings
    const hue = baseHue;
    ctx.lineCap = 'butt';
    ctx.shadowColor = `hsl(${hue},100%,60%)`;
    ctx.shadowBlur = 22;
    ctx.strokeStyle = `hsla(${hue},100%,70%,0.95)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ticks
    const rot = t * 0.05;
    ctx.strokeStyle = `hsla(${hue},100%,75%,0.45)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < 144; i++) {
      const a = rot + (i / 144) * TAU;
      const long = i % 12 === 0;
      const r1 = R + 12;
      const r2 = R + (long ? 26 : 18);
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    }
    ctx.stroke();

    // rotating arc segments
    const arcs = [[0, 0.7], [1.3, 0.25], [2.2, 1.1], [4.1, 0.4], [5.0, 0.6]];
    ctx.lineWidth = 3;
    arcs.forEach(([start, len], i) => {
      const a = start - t * (i % 2 ? 0.35 : -0.22);
      ctx.strokeStyle = i % 2 ? `hsla(${hue + 70},100%,70%,0.7)` : `hsla(${hue},100%,70%,0.55)`;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 44 + (i % 2) * 8, a, a + len);
      ctx.stroke();
    });

    // scan progress / result ring
    const prog = s.mode === 'scan' ? s.progress : s.mode === 'analyze' || s.mode === 'result' ? 1 : 0;
    if (prog > 0) {
      const a0 = -Math.PI / 2;
      const pg = ctx.createConicGradient(a0, cx, cy);
      pg.addColorStop(0, `hsl(${hue},100%,65%)`);
      pg.addColorStop(1, `hsl(${hue + 120},100%,65%)`);
      ctx.strokeStyle = pg;
      ctx.lineWidth = 5;
      ctx.shadowColor = `hsl(${hue + 60},100%,60%)`;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(cx, cy, R + 33, a0, a0 + TAU * prog);
      ctx.stroke();
      const ea = a0 + TAU * prog;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(ea) * (R + 33), cy + Math.sin(ea) * (R + 33), 5, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // voice bars around the ring
    if (s.freq && s.level > 0.005) {
      const n = 96;
      ctx.lineWidth = Math.max(2, (TAU * (R + 64)) / n * 0.45);
      ctx.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const bin = s.freq[Math.floor((i < n / 2 ? i : n - i) * 1.1) + 2] / 255;
        const len = 3 + bin * bin * R * 0.32;
        const a = (i / n) * TAU - Math.PI / 2;
        ctx.strokeStyle = `hsla(${hue + bin * 90},100%,${60 + bin * 25}%,${0.35 + bin * 0.6})`;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * (R + 64), cy + Math.sin(a) * (R + 64));
        ctx.lineTo(cx + Math.cos(a) * (R + 64 + len), cy + Math.sin(a) * (R + 64 + len));
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }

    // compass labels
    ctx.font = '500 11px "Cascadia Mono", Consolas, "SF Mono", monospace';
    ctx.fillStyle = `hsla(${hue},100%,80%,0.45)`;
    ctx.textAlign = 'center';
    ['000', '090', '180', '270'].forEach((txt, i) => {
      const a = (i / 4) * TAU - Math.PI / 2;
      ctx.fillText(txt, cx + Math.cos(a) * (R + 80), cy + Math.sin(a) * (R + 80) + 4);
    });
    ctx.textAlign = 'start';

    // lock-on brackets
    if (this.lockK > 0) {
      const k = ease(this.lockK);
      const half = (R + 70) * lerp(1.35, 1, k);
      const len = R * 0.22;
      ctx.strokeStyle = `hsla(${hue},100%,70%,${k})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = cx + sx * half;
        const y = cy + sy * half;
        ctx.moveTo(x, y - sy * len);
        ctx.lineTo(x, y);
        ctx.lineTo(x - sx * len, y);
      }
      ctx.stroke();
    }

    // shock waves and burst particles
    ctx.globalCompositeOperation = 'lighter';
    this.waves = this.waves.filter((w) => {
      if (w.delay > 0) {
        w.delay -= dt;
        return true;
      }
      w.r += dt * R * 2.2;
      w.a -= dt * 0.9;
      if (w.a <= 0) return false;
      ctx.strokeStyle = `hsla(${w.hue},100%,70%,${w.a})`;
      ctx.lineWidth = 3 + 10 * w.a;
      ctx.beginPath();
      ctx.arc(cx, cy, w.r, 0, TAU);
      ctx.stroke();
      return true;
    });
    this.bursts = this.bursts.filter((p) => {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.life -= dt * 0.55;
      if (p.life <= 0) return false;
      ctx.fillStyle = `hsla(${p.hue},100%,70%,${p.life})`;
      ctx.fillRect(p.x, p.y, p.s, p.s);
      return true;
    });
    ctx.globalCompositeOperation = 'source-over';

    return { cx, cy, R };
  }
}
