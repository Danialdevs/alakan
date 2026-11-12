// Records every voice phrase with freedomspeech.kz into voice/<voice>/<hash>.mp3,
// so the published site speaks without calling the API (it only allows localhost).
// Run after changing texts: node scripts/make-voice.mjs
import { mkdirSync, existsSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PHRASES } from '../i18n.js';
import { ARCHETYPES } from '../reading.js';
import { voiceFile, TTS_DEFAULTS } from '../voice.js';

const root = new URL('..', import.meta.url).pathname;
const wanted = new Set();
for (const lang of ['kk', 'ru']) {
  const p = PHRASES[lang];
  const voice = TTS_DEFAULTS.voices[lang];
  const texts = [p.start, p.mid, p.lost, ...ARCHETYPES.map((a) => p.result(a[lang]))];
  mkdirSync(join(root, 'voice', voice), { recursive: true });
  for (const text of texts) {
    const file = join(root, voiceFile(voice, text));
    wanted.add(file);
    if (existsSync(file)) continue;
    const res = await fetch(TTS_DEFAULTS.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': TTS_DEFAULTS.apiKey, origin: 'http://localhost:8080' },
      body: JSON.stringify({ input: text, voice, emotion: '' }),
    });
    if (!res.ok) throw new Error(`${res.status} for: ${text.slice(0, 40)}`);
    const wav = join(root, 'voice', 'tmp.wav');
    writeFileSync(wav, Buffer.from(await res.arrayBuffer()));
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '64k', file]);
    unlinkSync(wav);
    console.log('recorded', voiceFile(voice, text), text.slice(0, 50));
  }
}
// drop recordings of texts that no longer exist
for (const voice of readdirSync(join(root, 'voice'))) {
  for (const f of readdirSync(join(root, 'voice', voice))) {
    const file = join(root, 'voice', voice, f);
    if (!wanted.has(file)) unlinkSync(file), console.log('removed', file);
  }
}
