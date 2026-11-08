// Before / After audio comparison. Plays the uploaded files untouched.

const ACCENT = { before: '#72eaff', after: '#ff5276' };
const MAX_DECODE_BYTES = 90 * 1024 * 1024;

let audioCtx = null;
const registry = [];
let syncOn = true;
let sharedPos = 0;

function fmt(t) {
  if (!isFinite(t)) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function notifyPlaying() {
  const any = registry.some((p) => p.playing);
  window.dispatchEvent(new CustomEvent('b4sil:playing', { detail: any }));
}

class Player {
  constructor(el, url) {
    this.el = el;
    this.kind = el.dataset.player;
    this.url = url;
    this.accent = ACCENT[this.kind];
    this.btn = el.querySelector('[data-play]');
    this.timeEl = el.querySelector('[data-time]');
    this.statusEl = el.querySelector('[data-status]');
    this.wave = el.querySelector('[data-wave]');
    this.canvas = this.wave.querySelector('canvas');
    this.ctx2d = this.canvas.getContext('2d');
    this.peaks = null;
    this.playing = false;
    this.level = 0;
    this.analyser = null;
    this.buf = null;
    this.raf = 0;
    this.dirty = true;
    this.duration = 0;
    this.audio = null;

    this.size();
    new ResizeObserver(() => { this.size(); this.draw(); }).observe(this.wave);

    if (!url) {
      el.classList.add('is-missing');
      this.statusEl.textContent = 'Audio file not added yet.';
      this.draw();
      return;
    }

    const a = new Audio();
    a.preload = 'metadata';
    a.src = url;
    this.audio = a;
    a.addEventListener('loadedmetadata', () => {
      this.duration = a.duration;
      this.btn.disabled = false;
      el.classList.add('is-ready');
      this.updateTime();
      this.draw();
    });
    a.addEventListener('error', () => {
      el.classList.add('is-missing');
      this.statusEl.textContent = 'This file could not be loaded.';
      this.btn.disabled = true;
    });
    a.addEventListener('ended', () => this.onEnded());

    this.btn.addEventListener('click', () => (this.playing ? this.pause() : this.play()));
    this.bindScrub();
    this.loadPeaks();
  }

  size() {
    const r = this.wave.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.dpr = dpr;
    this.dirty = true;
  }

  async loadPeaks() {
    try {
      const res = await fetch(this.url);
      const len = Number(res.headers.get('content-length') || 0);
      if (!res.ok || (len && len > MAX_DECODE_BYTES)) throw new Error('skip');
      const data = await res.arrayBuffer();
      const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const dec = await new Off(1, 1, 44100).decodeAudioData(data);
      const bins = 360;
      const ch = [];
      for (let c = 0; c < dec.numberOfChannels; c++) ch.push(dec.getChannelData(c));
      const per = Math.max(1, Math.floor(dec.length / bins));
      const peaks = new Float32Array(bins);
      let max = 0;
      for (let b = 0; b < bins; b++) {
        let sum = 0;
        let n = 0;
        const start = b * per;
        const end = Math.min(dec.length, start + per);
        const hop = Math.max(1, Math.floor((end - start) / 400));
        for (let i = start; i < end; i += hop) {
          let v = 0;
          for (let c = 0; c < ch.length; c++) v = Math.max(v, Math.abs(ch[c][i]));
          sum += v * v;
          n++;
        }
        const rms = Math.sqrt(sum / Math.max(1, n));
        peaks[b] = rms;
        if (rms > max) max = rms;
      }
      for (let b = 0; b < bins; b++) peaks[b] = Math.pow(peaks[b] / (max || 1), 0.8);
      this.peaks = peaks;
    } catch {
      // decoding is optional — fall back to a quiet placeholder pattern
      const p = new Float32Array(360);
      for (let i = 0; i < p.length; i++) p[i] = 0.22 + 0.12 * Math.sin(i * 0.31) * Math.sin(i * 0.07 + 1);
      this.peaks = p;
    }
    this.dirty = true;
    this.draw();
  }

  currentTime() {
    if (this.audio && (this.playing || !syncOn)) return this.audio.currentTime;
    if (syncOn) {
      const other = registry.find((p) => p !== this && p.playing);
      if (other) return other.audio.currentTime;
      return Math.min(sharedPos, this.duration || sharedPos);
    }
    return this.audio ? this.audio.currentTime : 0;
  }

  ensureAudioGraph() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (!this.analyser && this.audio) {
      try {
        const src = audioCtx.createMediaElementSource(this.audio);
        this.analyser = audioCtx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.buf = new Uint8Array(this.analyser.fftSize);
        src.connect(this.analyser);
        this.analyser.connect(audioCtx.destination);
      } catch {
        this.analyser = null;
      }
    }
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  }

  async play() {
    if (!this.audio) return;
    registry.forEach((p) => { if (p !== this && p.playing) p.pause(true); });
    if (syncOn) {
      try { this.audio.currentTime = Math.min(sharedPos, this.duration || sharedPos); } catch { /* not seekable yet */ }
    }
    this.ensureAudioGraph();
    try {
      await this.audio.play();
    } catch {
      return;
    }
    this.playing = true;
    this.el.classList.add('is-playing');
    this.btn.setAttribute('aria-label', `Pause ${this.kind} mix`);
    notifyPlaying();
    this.loop();
  }

  pause(switching = false) {
    if (!this.audio) return;
    sharedPos = this.audio.currentTime;
    this.audio.pause();
    this.playing = false;
    this.level = 0;
    this.el.classList.remove('is-playing');
    this.btn.setAttribute('aria-label', `Play ${this.kind} mix`);
    cancelAnimationFrame(this.raf);
    this.dirty = true;
    this.draw();
    registry.forEach((p) => { p.dirty = true; p.draw(); });
    if (!switching) notifyPlaying();
  }

  onEnded() {
    this.playing = false;
    this.el.classList.remove('is-playing');
    this.btn.setAttribute('aria-label', `Play ${this.kind} mix`);
    cancelAnimationFrame(this.raf);
    this.audio.currentTime = 0;
    sharedPos = 0;
    registry.forEach((p) => { p.dirty = true; p.draw(); p.updateTime(); });
    notifyPlaying();
  }

  seekRatio(r) {
    if (!this.audio || !this.duration) return;
    const t = Math.max(0, Math.min(1, r)) * this.duration;
    sharedPos = t;
    this.audio.currentTime = t;
    if (syncOn) registry.forEach((p) => { if (p !== this && p.audio) { try { p.audio.currentTime = Math.min(t, p.duration || t); } catch { /* ignore */ } } });
    registry.forEach((p) => { p.dirty = true; p.draw(); p.updateTime(); });
  }

  bindScrub() {
    const at = (e) => {
      const r = this.wave.getBoundingClientRect();
      return (e.clientX - r.left) / r.width;
    };
    let drag = false;
    this.wave.addEventListener('pointerdown', (e) => {
      if (!this.duration) return;
      drag = true;
      this.wave.setPointerCapture(e.pointerId);
      this.seekRatio(at(e));
    });
    this.wave.addEventListener('pointermove', (e) => { if (drag) this.seekRatio(at(e)); });
    const end = () => { drag = false; };
    this.wave.addEventListener('pointerup', end);
    this.wave.addEventListener('pointercancel', end);
    this.wave.addEventListener('keydown', (e) => {
      if (!this.duration) return;
      const cur = this.currentTime();
      const step = 5;
      if (e.key === 'ArrowRight') { this.seekRatio((cur + step) / this.duration); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { this.seekRatio((cur - step) / this.duration); e.preventDefault(); }
      else if (e.key === 'Home') { this.seekRatio(0); e.preventDefault(); }
      else if (e.key === 'End') { this.seekRatio(1); e.preventDefault(); }
      else if (e.key === ' ') { this.btn.click(); e.preventDefault(); }
    });
  }

  loop() {
    const tick = () => {
      if (!this.playing) return;
      if (this.analyser) {
        this.analyser.getByteTimeDomainData(this.buf);
        let s = 0;
        for (let i = 0; i < this.buf.length; i++) { const v = (this.buf[i] - 128) / 128; s += v * v; }
        const rms = Math.sqrt(s / this.buf.length);
        this.level += (Math.min(1, rms * 3.2) - this.level) * 0.25;
      } else {
        this.level = 0.35;
      }
      sharedPos = this.audio.currentTime;
      registry.forEach((p) => { p.updateTime(); p.dirty = true; p.draw(); });
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  updateTime() {
    const t = this.currentTime();
    this.timeEl.textContent = `${fmt(t)} / ${fmt(this.duration)}`;
    const pct = this.duration ? Math.round((t / this.duration) * 100) : 0;
    this.wave.setAttribute('aria-valuenow', String(pct));
  }

  draw() {
    if (!this.dirty) return;
    this.dirty = false;
    const g = this.ctx2d;
    const { dpr, w, h } = this;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const barW = 2;
    const gap = w < 360 ? 2.5 : 3.5;
    const count = Math.max(10, Math.floor(w / (barW + gap)));
    const t = this.currentTime();
    const prog = this.duration ? t / this.duration : 0;
    const playX = prog * w;
    const mid = h / 2;
    const live = this.playing ? this.level : 0;

    for (let i = 0; i < count; i++) {
      const x = i * (barW + gap);
      const f = i / count;
      const p = this.peaks ? this.peaks[Math.min(this.peaks.length - 1, Math.floor(f * this.peaks.length))] : 0.08;
      let amp = Math.max(0.05, p);
      // the bars around the playhead breathe with the signal
      const near = this.playing ? Math.max(0, 1 - Math.abs(x - playX) / 46) : 0;
      amp = Math.min(1, amp * (1 + near * live * 0.55));
      const bh = Math.max(3, amp * h * 0.92);
      const played = x + barW <= playX;
      if (played) {
        g.fillStyle = this.accent;
        g.globalAlpha = 0.92;
      } else {
        g.fillStyle = '#c9d3e8';
        g.globalAlpha = 0.17;
      }
      const y = mid - bh / 2;
      if (g.roundRect) { g.beginPath(); g.roundRect(x, y, barW, bh, barW / 2); g.fill(); }
      else g.fillRect(x, y, barW, bh);
    }
    g.globalAlpha = 1;

    if (this.duration) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, this.accent);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(Math.min(w - 1.5, Math.max(0, playX)) - 0.75, 0, 1.5, h);
    }
  }
}

export async function initPlayers() {
  let manifest = { before: null, after: null };
  try {
    const r = await fetch('/audio-manifest.json', { cache: 'no-store' });
    if (r.ok) manifest = await r.json();
  } catch { /* static host without manifest */ }

  document.querySelectorAll('[data-player]').forEach((el) => {
    registry.push(new Player(el, manifest[el.dataset.player]));
  });

  const sync = document.getElementById('sync');
  if (sync) {
    syncOn = sync.checked;
    sync.addEventListener('change', () => {
      syncOn = sync.checked;
      registry.forEach((p) => { p.dirty = true; p.draw(); p.updateTime(); });
    });
  }
  registry.forEach((p) => p.updateTime());
}
