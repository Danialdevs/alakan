// Voice (freedomspeech.kz) and synthesized sound effects.
// Everything goes through one analyser, so the ring around the scanner moves with the voice.
export class Audio {
  constructor({ sounds = true, tts } = {}) {
    this.tts = tts;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.75;
    this.voiceBus = this.ctx.createGain();
    this.voiceBus.connect(this.analyser);
    this.analyser.connect(this.master);
    this.master.connect(this.ctx.destination);
    this.freq = new Uint8Array(this.analyser.frequencyBinCount);
    this.sounds = sounds;
    this.current = null;
    this.queue = Promise.resolve();
    this.token = 0;
    this.hum = null;
  }

  resume() {
    if (this.ctx.state !== 'running') this.ctx.resume();
  }

  level() {
    this.analyser.getByteFrequencyData(this.freq);
    let sum = 0;
    for (let i = 2; i < 40; i++) sum += this.freq[i];
    return sum / (38 * 255);
  }

  async load(text, lang) {
    const bytes = await this.tts(text, lang);
    if (!bytes) return null;
    return this.ctx.decodeAudioData(bytes.slice(0)).catch(() => null);
  }

  prefetch(text, lang) {
    this.tts(text, lang).catch(() => {});
  }

  stopVoice() {
    this.token++;
    if (this.current) {
      try {
        this.current.stop();
      } catch {
        /* already finished */
      }
      this.current = null;
    }
    this.queue = Promise.resolve();
  }

  /** Queues a phrase; interrupt=true drops whatever is playing. Resolves when the phrase ends. */
  say(text, lang, { interrupt = false } = {}) {
    if (interrupt) this.stopVoice();
    const token = this.token;
    const loading = this.load(text, lang);
    this.queue = this.queue.then(async () => {
      const buffer = await loading;
      if (token !== this.token) return;
      if (!buffer) return console.warn('[voice] no recording for:', text.slice(0, 60));
      this.resume();
      await new Promise((resolve) => {
        const node = this.ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(this.voiceBus);
        node.onended = () => {
          if (this.current === node) this.current = null;
          resolve();
        };
        this.current = node;
        node.start();
      });
    });
    return this.queue;
  }

  get speaking() {
    return !!this.current;
  }

  // ---------------- sound effects
  env(node, t0, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }

  blip(freq = 880, dur = 0.12, type = 'sine', vol = 0.12) {
    if (!this.sounds) return;
    this.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.5, t + dur);
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  detect() {
    [520, 780, 1170].forEach((f, i) => setTimeout(() => this.blip(f, 0.14, 'triangle', 0.1), i * 70));
  }

  humStart() {
    if (!this.sounds || this.hum) return;
    this.resume();
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.6);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 6;
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 1.7;
    lfoGain.gain.value = 380;
    lfo.connect(lfoGain).connect(filter.frequency);
    const oscs = [55, 55.7, 110.4].map((f) => {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(filter);
      o.start(t);
      return o;
    });
    filter.connect(g).connect(this.master);
    lfo.start(t);
    this.hum = { g, oscs, lfo, filter };
  }

  humProgress(p) {
    if (!this.hum) return;
    const t = this.ctx.currentTime;
    this.hum.oscs.forEach((o, i) => o.frequency.setTargetAtTime([55, 55.7, 110.4][i] * (1 + p * 0.9), t, 0.2));
    this.hum.filter.Q.setTargetAtTime(6 + p * 8, t, 0.2);
  }

  humStop() {
    if (!this.hum) return;
    const { g, oscs, lfo } = this.hum;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    oscs.forEach((o) => o.stop(t + 0.45));
    lfo.stop(t + 0.45);
    this.hum = null;
  }

  reveal() {
    if (!this.sounds) return;
    this.resume();
    const t = this.ctx.currentTime;
    // whoosh: filtered noise sweep
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(5000, t + 0.5);
    bp.frequency.exponentialRampToValueAtTime(800, t + 1.1);
    const ng = this.ctx.createGain();
    this.env(ng, t, 0.25, 0.18, 0.9);
    noise.connect(bp).connect(ng).connect(this.master);
    noise.start(t);
    // shimmering chord
    [261.6, 329.6, 392, 523.3, 784].forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = i % 2 ? 'triangle' : 'sine';
      o.frequency.value = f;
      this.env(g, t + 0.25 + i * 0.05, 0.02, 0.07, 2.4);
      o.connect(g).connect(this.master);
      o.start(t + 0.2);
      o.stop(t + 3);
    });
  }
}
