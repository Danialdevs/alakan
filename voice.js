// Voice-over settings shared by the page and scripts/make-voice.mjs (freedomspeech.kz).
import { hashString } from './reading.js';

export const TTS_DEFAULTS = {
  enabled: true,
  url: 'https://freedomspeech.kz/v1/audio/speech',
  apiKey: 'fspeech-front-2026-x7k9m',
  voices: { kk: 'saltanat', ru: 'saltanat_ru' },
};

/** Where the pre-recorded phrase lives in the project, e.g. voice/saltanat/1a2b3c4d.mp3. */
export const voiceFile = (voice, text) => `voice/${voice}/${hashString(`${voice}|${text}`).toString(16).padStart(8, '0')}.mp3`;
