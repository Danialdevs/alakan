// Settings and voice-over for the browser.
// Settings: defaults below → saved in this browser (settings panel, key S) → URL (?lang=ru&source=demo).

const DEFAULTS = {
  source: 'camera', // camera | demo
  language: 'kk',
  scanSeconds: 9,
  resultSeconds: 35,
  sounds: true,
  camera: {
    deviceId: '', // empty — pick automatically (VP530 scanner camera first)
    detect: 'auto', // auto | hand | cover | both
    mirror: true,
    rotate: 0,
    sensitivity: 0.5,
  },
  tts: {
    enabled: true,
    url: 'https://freedomspeech.kz/v1/audio/speech',
    apiKey: 'fspeech-front-2026-x7k9m',
    voices: { kk: 'saltanat', ru: 'saltanat_ru' },
  },
};

const STORE_KEY = 'alakan.settings';

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
  } catch {
    return {};
  }
}

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
  }
  return out;
}

export function loadConfig() {
  const config = merge(DEFAULTS, load());
  const q = new URLSearchParams(location.search);
  if (q.get('lang')) config.language = q.get('lang');
  if (q.get('source')) config.source = q.get('source');
  if (q.get('key')) config.tts = { ...config.tts, apiKey: q.get('key') };
  if (q.has('mute')) config.sounds = false;
  if (q.get('detect')) config.camera = { ...config.camera, detect: q.get('detect') };
  return config;
}

/** Saves only the part of settings that changed in this browser. */
export function saveSettings(patch) {
  const next = merge(load(), patch);
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* private mode — settings live until reload */
  }
}

// ------------------------------------------------------------ voice-over (freedomspeech.kz)
const memory = new Map();
let cachePromise = null;
const openCache = () => {
  if (!cachePromise) cachePromise = (window.caches ? caches.open('alakan-tts-v1') : Promise.resolve(null)).catch(() => null);
  return cachePromise;
};

/** Returns audio bytes (ArrayBuffer) for the phrase, or null when voice-over is unavailable. */
export function makeTts(options) {
  return async function tts(text, lang) {
    if (!options.enabled || !text) return null;
    const voice = options.voices[lang] || options.voices.ru;
    const key = `https://alakan.local/tts/${encodeURIComponent(voice)}/${encodeURIComponent(text)}`;
    if (memory.has(key)) return memory.get(key);
    const job = (async () => {
      const cache = await openCache();
      const hit = cache && (await cache.match(key));
      if (hit) return hit.arrayBuffer();
      try {
        const res = await fetch(options.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': options.apiKey },
          body: JSON.stringify({ input: text, voice, emotion: '' }),
          signal: AbortSignal.timeout(30000),
        });
        const type = res.headers.get('content-type') || '';
        if (!res.ok || !type.startsWith('audio/')) throw new Error(`${res.status} ${type}`);
        const audio = await res.arrayBuffer();
        if (cache) cache.put(key, new Response(audio.slice(0), { headers: { 'content-type': type } })).catch(() => {});
        return audio;
      } catch (error) {
        console.warn('[tts]', error.message);
        memory.delete(key); // try again next time
        return null;
      }
    })();
    memory.set(key, job);
    return job;
  };
}
