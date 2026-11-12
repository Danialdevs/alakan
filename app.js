import { UI, PHRASES } from './i18n.js';
import { makeReading, localized, TRAITS } from './reading.js';
import { Scene, palmLines, LINE_COLORS } from './fx.js';
import { CameraSource, DemoSource, templateHand } from './sources.js';
import { Audio } from './audio.js';
import { loadConfig, saveSettings, makeTts } from './platform.js';
import { setupSettings } from './settings.js';

const $ = (id) => document.getElementById(id);
const config = loadConfig();
let lang = config.language === 'ru' ? 'ru' : 'kk';
const other = () => (lang === 'kk' ? 'ru' : 'kk');

const audio = new Audio({ sounds: config.sounds !== false, tts: makeTts(config.tts) });
const scene = new Scene($('scene'));
const source = config.source === 'demo' ? new DemoSource() : new CameraSource(config.camera);
const promptKey = () => (source.kind === 'demo' ? 'demo' : source.isScanner ? 'vp530' : 'webcam');

const SCAN_SECONDS = Math.max(4, config.scanSeconds || 9);
const RESULT_SECONDS = Math.max(10, config.resultSeconds || 35);
const LINE_ORDER = ['life', 'heart', 'head', 'fate'];

// ------------------------------------------------------------ state
const st = {
  mode: 'boot',
  since: performance.now(),
  progress: 0,
  absentSince: 0,
  lostSaid: false,
  midSaid: false,
  reading: null,
  readingAt: 0,
  lines: null,
  lineSeed: 1,
  needRelease: false,
  step: -1,
  voiceDone: true,
  photo: null, // still picture of the scanned palm, shown on the result screen
  photoLandmarks: null,
};

// Keeps the last frame where the palm was in place, so the result shows that photo
// and nothing changes when the hand is taken away.
function keepPhoto() {
  if (!source.image) return;
  if (!st.photo) {
    st.photo = document.createElement('canvas');
    st.photo.width = source.image.width;
    st.photo.height = source.image.height;
  }
  const g = st.photo.getContext('2d');
  g.clearRect(0, 0, st.photo.width, st.photo.height);
  g.drawImage(source.image, 0, 0);
  st.photoLandmarks = source.landmarks ? source.landmarks.map((p) => ({ ...p })) : st.photoLandmarks;
}

function setMode(mode) {
  st.mode = mode;
  st.since = performance.now();
  document.body.className = `mode-${mode}`;
  bumpCursor();
}
const modeTime = () => (performance.now() - st.since) / 1000;

// ------------------------------------------------------------ texts
function renderTexts() {
  const t = UI[lang];
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach((el) => (el.textContent = t[el.dataset.t]));
  document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  $('promptMain').textContent = t.prompt[promptKey()];
  $('promptSub').textContent = t.sub;
  $('promptAlt').textContent = `${UI[other()].prompt[promptKey()]} · ${UI[other()].sub}`;
  if ($('startBtn')) $('startBtn').textContent = t.start;
  $('disclaimer').textContent = t.disclaimer;
  $('again').textContent = source.kind === 'demo' ? t.againDemo : t.again;
  $('scanLabel').textContent = t.scanning;
  $('liveTitle').textContent = t.traitsTitle;
  $('steps').innerHTML = t.steps.map((s) => `<li><span>${s}</span><b>···</b></li>`).join('');
  $('liveBars').innerHTML = TRAITS.map((tr) => `<div class="row"><span>${tr[lang]}</span><span class="val">--</span><div class="bar"><i></i></div></div>`).join('');
  $('warn').textContent = t.hold;
  renderStatus();
  if (st.mode === 'result' && st.reading) renderResult(false);
}

function renderStatus() {
  const t = UI[lang];
  const el = $('status');
  let ok = false;
  let text = '';
  if (source.kind === 'camera') {
    ok = source.ready;
    text = source.error ? t.noCamera : !source.ready ? t.loading : source.isScanner ? 'VP530 · ONLINE' : 'CAMERA · ONLINE';
  } else {
    ok = true;
    text = 'DEMO';
  }
  el.classList.toggle('ok', ok);
  el.querySelector('span').textContent = text;
}

function renderResult(withVoice) {
  const t = UI[lang];
  const r = localized(st.reading, lang);
  document.documentElement.style.setProperty('--hue', r.hue);
  const hand = st.reading.hand === 1 ? t.rightHand : st.reading.hand === 2 ? t.leftHand : '';
  $('rEyebrow').textContent = hand ? `${t.yourType} · ${hand}` : t.yourType;
  $('rTitle').innerHTML = [...r.title].map((ch, i) => `<span style="animation-delay:${0.6 + i * 0.06}s">${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
  $('rDesc').textContent = r.desc;
  $('rTraitsT').textContent = t.traitsTitle;
  $('rLinesT').textContent = t.linesTitle;
  $('rAdviceT').textContent = t.adviceTitle;
  $('rAdvice').textContent = r.advice;
  $('rTraits').innerHTML = r.traits.map((tr) => `<div class="row"><span>${tr.name}</span><span class="val" data-v="${tr.value}">0%</span><div class="bar"><i data-w="${tr.value}"></i></div></div>`).join('');
  $('rLines').innerHTML = ['life', 'heart', 'head'].map((k) => `<div class="item" style="color:${LINE_COLORS[k]}"><i></i><div><b>${t.lineNames[k]}</b><span>${r.lines[k]}</span></div></div>`).join('');
  setTimeout(() => {
    document.querySelectorAll('#rTraits .bar i').forEach((el) => (el.style.width = `${el.dataset.w}%`));
    document.querySelectorAll('#rTraits .val').forEach((el) => countUp(el, +el.dataset.v));
    document.querySelectorAll('#rLines .item').forEach((el, i) => setTimeout(() => el.classList.add('on'), 400 + i * 250));
  }, 900);
  if (withVoice) {
    st.voiceDone = false;
    audio.say(PHRASES[lang].result(r), lang, { interrupt: true }).finally(() => (st.voiceDone = true));
  }
}

function countUp(el, target) {
  const start = performance.now();
  const tick = () => {
    const k = Math.min(1, (performance.now() - start) / 1400);
    el.textContent = `${Math.round(target * (1 - Math.pow(1 - k, 3)))}%`;
    if (k < 1) requestAnimationFrame(tick);
  };
  tick();
}

// ------------------------------------------------------------ flow
function startLock() {
  setMode('lock');
  audio.detect();
  audio.say(PHRASES[lang].start, lang, { interrupt: true });
  document.documentElement.style.setProperty('--hue', 190);
}

function startScan() {
  setMode('scan');
  st.progress = 0;
  st.absentSince = 0;
  st.lostSaid = false;
  st.midSaid = false;
  st.reading = null;
  st.step = -1;
  st.lineSeed = (Math.random() * 1e9) | 0;
  st.photoLandmarks = null;
  source.beginCollect();
  audio.humStart();
  document.querySelectorAll('#steps li').forEach((li) => (li.className = ''));
}

function cancelScan() {
  audio.humStop();
  audio.stopVoice();
  source.features();
  st.lines = null;
  setMode('idle');
}

function finishScan() {
  setMode('analyze');
  audio.humStop();
  if (!st.reading) st.reading = makeReading(source.features());
  else source.features();
}

function showResult() {
  setMode('result');
  const r = localized(st.reading, lang);
  const { cx, cy, R } = scene.layout();
  scene.burst(cx, cy, R, r.hue);
  audio.reveal();
  st.needRelease = source.present;
  if (source.kind === 'demo') {
    source.setPresent(false);
    st.needRelease = false;
  }
  renderResult(true);
}

function updateSteps(p) {
  const step = Math.min(6, Math.floor(p * 7));
  if (step === st.step) return;
  st.step = step;
  audio.blip(660 + step * 90, 0.09, 'square', 0.04);
  document.querySelectorAll('#steps li').forEach((li, i) => {
    li.className = i < step ? 'done' : i === step ? 'active' : '';
    li.querySelector('b').textContent = i < step ? 'OK' : i === step ? 'SCAN' : '···';
  });
}

let hexTimer = 0;
function updateLive(p, dt) {
  hexTimer -= dt;
  if (hexTimer <= 0) {
    hexTimer = 0.09;
    const lines = $('hexdump').textContent.split('\n').slice(-6);
    const hex = () => ((Math.random() * 0xffff) | 0).toString(16).padStart(4, '0').toUpperCase();
    lines.push(`0x${hex()}${hex()}  ${hex()} ${hex()} ${hex()}  ${(Math.random() * 99).toFixed(2)}`);
    $('hexdump').textContent = lines.join('\n');
  }
  const rows = document.querySelectorAll('#liveBars .row');
  rows.forEach((row, i) => {
    const visible = p > 0.15 + i * 0.1;
    const target = st.reading ? st.reading.scores[i] : 40 + 50 * Math.abs(Math.sin(performance.now() / 300 + i));
    const v = visible ? (st.reading ? target : Math.round(target)) : 0;
    row.querySelector('i').style.width = `${v}%`;
    row.querySelector('.val').textContent = visible ? `${Math.round(v)}%` : '--';
  });
}

function currentLines(revealAll) {
  const frozen = st.mode === 'analyze' || st.mode === 'result';
  const lm = (frozen ? st.photoLandmarks : source.landmarks) || st.photoLandmarks || templateHand();
  const pts = palmLines(lm, st.lineSeed);
  const lines = {};
  LINE_ORDER.forEach((name, i) => {
    const start = 0.2 + i * 0.17;
    const reveal = revealAll ? 1 : Math.max(0, Math.min(1, (st.progress - start) / 0.15));
    lines[name] = { pts: pts[name], reveal };
  });
  return lines;
}

// ------------------------------------------------------------ main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (source.update) source.update(now);
  const present = source.present;

  switch (st.mode) {
    case 'idle':
      if (present && source.ready) startLock();
      break;
    case 'lock':
      if (!present) {
        if (!st.absentSince) st.absentSince = now;
        if (now - st.absentSince > 600) {
          st.absentSince = 0;
          audio.stopVoice();
          setMode('idle');
        }
      } else {
        st.absentSince = 0;
        if (modeTime() > 1.1) startScan();
      }
      break;
    case 'scan': {
      if (present) {
        st.absentSince = 0;
        st.lostSaid = false;
        st.progress = Math.min(1, st.progress + dt / SCAN_SECONDS);
        keepPhoto();
      } else {
        if (!st.absentSince) st.absentSince = now;
        if (now - st.absentSince > 700 && !st.lostSaid) {
          st.lostSaid = true;
          audio.say(PHRASES[lang].lost, lang, { interrupt: true });
        }
        if (now - st.absentSince > 3500) {
          cancelScan();
          break;
        }
      }
      $('warn').classList.toggle('on', !!st.absentSince && now - st.absentSince > 400);
      audio.humProgress(st.progress);
      updateSteps(st.progress);
      updateLive(st.progress, dt);
      $('pct').textContent = Math.floor(st.progress * 100);
      if (st.progress > 0.38 && !st.midSaid) {
        st.midSaid = true;
        audio.say(PHRASES[lang].mid, lang);
      }
      // Reading is fixed halfway, so the voice for it is ready by the end of the scan.
      if (st.progress > 0.5 && !st.reading) {
        st.reading = makeReading(source.features());
        source.beginCollect();
        audio.prefetch(PHRASES[lang].result(localized(st.reading, lang)), lang);
      }
      if (st.progress >= 1) finishScan();
      break;
    }
    case 'analyze':
      $('warn').classList.remove('on');
      if (modeTime() > 1.3) showResult();
      break;
    case 'result': {
      if (st.needRelease && !present) st.needRelease = false;
      const t = modeTime();
      if (!st.needRelease && present && t > 3) {
        audio.stopVoice();
        startLock();
      } else if (t > RESULT_SECONDS && st.voiceDone) {
        st.lines = null;
        document.documentElement.style.setProperty('--hue', 190);
        setMode('idle');
      }
      break;
    }
    default:
      break;
  }

  const showLines = st.mode === 'scan' || st.mode === 'analyze' || st.mode === 'result';
  const lineLabels = UI[lang].lineNames;
  scene.draw(now / 1000, dt, {
    mode: st.mode === 'boot' ? 'idle' : st.mode,
    progress: st.progress,
    present,
    paused: st.mode === 'scan' && !present,
    source,
    photo: st.mode === 'analyze' || st.mode === 'result' ? st.photo : null,
    lines: showLines ? currentLines(st.mode !== 'scan') : null,
    lineLabels,
    hue: st.reading ? st.reading.archetype.hue : 190,
    level: audio.level(),
    freq: audio.freq,
  });
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------ input
function setLang(next) {
  if (next === lang) return;
  lang = next;
  saveSettings({ language: lang });
  renderTexts();
  if (st.mode === 'result' && st.reading) {
    st.voiceDone = false;
    audio.say(PHRASES[lang].result(localized(st.reading, lang)), lang, { interrupt: true }).finally(() => (st.voiceDone = true));
  }
}
document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => {
  audio.resume();
  setLang(b.dataset.lang);
}));
window.addEventListener('keydown', (e) => {
  audio.resume();
  if (e.target.closest && e.target.closest('.settings')) return;
  if (e.code === 'KeyL') setLang(other());
  if (e.code === 'KeyF') toggleFullscreen();
});
window.addEventListener('dblclick', (e) => !e.target.closest('.settings, .top') && toggleFullscreen());

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

// Browsers start sound and full screen only after a click. If sound is already allowed
// (e.g. Chrome started with --autoplay-policy=no-user-gesture-required), the start screen is skipped.
async function setupStart() {
  const gate = $('start');
  audio.resume();
  await new Promise((r) => setTimeout(r, 300));
  if (audio.ctx.state === 'running' && !new URLSearchParams(location.search).has('start')) {
    gate.remove();
    return;
  }
  gate.classList.add('on');
  gate.addEventListener('click', () => {
    audio.resume();
    document.documentElement.requestFullscreen().catch(() => {});
    gate.remove();
  }, { once: true });
}
window.addEventListener('pointerdown', () => audio.resume());

let cursorTimer = 0;
function bumpCursor() {
  document.body.classList.remove('hide-cursor');
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 3000);
}
window.addEventListener('pointermove', bumpCursor);

// ------------------------------------------------------------ start
source.onChange(() => {
  renderStatus();
  const key = promptKey();
  if (key !== renderTexts.key) {
    renderTexts.key = key;
    renderTexts();
  }
});
renderTexts();
setupStart();
setupSettings({ source, save: saveSettings });
setMode('idle');
requestAnimationFrame(frame);
source.start().then(renderStatus);

// Warm the voice cache with the fixed phrases in both languages.
for (const l of ['kk', 'ru']) for (const key of ['start', 'mid', 'lost']) audio.prefetch(PHRASES[l][key], l);
