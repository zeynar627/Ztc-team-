/* ZTC AI Studio — audio engine.
   Voice-over + music + optional transition whooshes, played in sync with the
   renderer, mixed into a MediaStream for recording, and renderable offline. */

import { audioContext, decodeAudio, composeMusicLoop, encodeWav } from "./media.js";
import { getAsset } from "./store.js";
import { timingsOf, totalSeconds } from "./render.js";
import { clamp } from "./util.js";

export class AudioEngine {
  constructor() {
    const ctx = audioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.voiceGain = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.mediaDest = ctx.createMediaStreamDestination();
    this.voiceGain.connect(this.master);
    this.musicGain.connect(this.master);
    this.sfxGain.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.master.connect(this.mediaDest);
    this.sources = [];
    this.voices = new Map();
    this.music = null;
    this.musicMeta = null;
    this.projectId = null;
    this.whoosh = null;
  }

  get stream() { return this.mediaDest.stream; }

  level() {
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / data.length);
  }

  async load(project, { onProgress = () => {} } = {}) {
    const ctx = this.ctx;
    const scenes = project?.plan?.scenes || [];
    this.projectId = project?.id;
    this.voices.clear();
    let done = 0;
    for (const scene of scenes) {
      if (!scene.voiceId) { done++; continue; }
      try {
        const asset = await getAsset(scene.voiceId);
        if (asset?.blob) {
          const buffer = await decodeAudio(asset.blob);
          this.voices.set(scene.id, buffer);
        }
      } catch (e) {
        console.warn("voice decode failed", scene.id, e);
      }
      done++;
      onProgress(done / Math.max(1, scenes.length));
    }

    const mood = project?.settings?.musicMood || "cinematic";
    if (mood !== "none") {
      if (!this.music || this.musicMeta?.mood !== mood) {
        try {
          const { buffer } = await composeMusicLoop(mood, 7);
          this.music = buffer;
          this.musicMeta = { mood };
        } catch (e) {
          console.warn("music render failed", e);
          this.music = null;
        }
      }
    } else {
      this.music = null;
      this.musicMeta = null;
    }

    this.voiceGain.gain.value = clamp(Number(project?.settings?.voiceVolume) ?? 1, 0, 1.5);
    this.musicGain.gain.value = clamp(Number(project?.settings?.musicVolume) ?? 0.2, 0, 1);

    if (!this.whoosh) this.whoosh = makeWhoosh(ctx);
    return { voices: this.voices.size, music: !!this.music };
  }

  play(project, from = 0) {
    this.stop();
    const ctx = this.ctx;
    const scenes = project?.plan?.scenes || [];
    const timings = timingsOf(project);
    const total = totalSeconds(project);
    const now = ctx.currentTime + 0.06;

    this.voiceGain.gain.value = clamp(Number(project?.settings?.voiceVolume) ?? 1, 0, 1.5);
    this.musicGain.gain.value = clamp(Number(project?.settings?.musicVolume) ?? 0.2, 0, 1);

    if (this.music && project?.settings?.musicMood !== "none") {
      const src = ctx.createBufferSource();
      src.buffer = this.music;
      src.loop = true;
      const offset = this.music.duration ? from % this.music.duration : 0;
      src.connect(this.musicGain);
      src.start(now, offset);
      this.sources.push(src);
    }

    scenes.forEach((scene, i) => {
      const buf = this.voices.get(scene.id);
      if (!buf) return;
      const tm = timings[i];
      if (!tm) return;
      if (tm.end <= from) return;
      const when = now + Math.max(0, tm.start - from);
      const offset = from > tm.start ? from - tm.start : 0;
      if (offset >= buf.duration) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.voiceGain);
      src.start(when, offset);
      this.sources.push(src);
    });

    if (project?.settings?.sfx !== false) {
      scenes.forEach((scene, i) => {
        if (i === 0 || !this.whoosh) return;
        const tm = timings[i];
        if (!tm || tm.start < from) return;
        const src = ctx.createBufferSource();
        src.buffer = this.whoosh;
        const g = ctx.createGain();
        g.gain.value = 0.18;
        src.connect(g).connect(this.sfxGain);
        src.start(now + (tm.start - from));
        this.sources.push(src);
      });
    }

    return { from, total };
  }

  stop() {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already stopped */ }
      try { s.disconnect(); } catch { /* ignore */ }
    }
    this.sources = [];
  }

  /** Render the full mix offline (for WAV export). */
  async renderMix(project, { sampleRate = 44100 } = {}) {
    const total = totalSeconds(project);
    if (total <= 0) throw new Error("nothing to render");
    const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtx) throw new Error("Offline audio rendering is not supported in this browser");
    const ctx = new OfflineCtx(2, Math.ceil(sampleRate * (total + 0.4)), sampleRate);
    const master = ctx.createGain();
    master.gain.value = 0.95;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 20;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = clamp(Number(project?.settings?.voiceVolume) ?? 1, 0, 1.5);
    voiceGain.connect(master);
    const musicGain = ctx.createGain();
    musicGain.gain.value = clamp(Number(project?.settings?.musicVolume) ?? 0.2, 0, 1);
    musicGain.connect(master);

    if (this.music) {
      const src = ctx.createBufferSource();
      src.buffer = this.music;
      src.loop = true;
      src.connect(musicGain);
      src.start(0);
    }

    const timings = timingsOf(project);
    project.plan.scenes.forEach((scene, i) => {
      const buf = this.voices.get(scene.id);
      if (!buf || !timings[i]) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(voiceGain);
      src.start(Math.max(0, timings[i].start));
    });

    return ctx.startRendering();
  }

  async renderMixWav(project) {
    const buffer = await this.renderMix(project);
    return encodeWav(buffer);
  }
}

function makeWhoosh(ctx) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 0.5);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = Math.sin(t * Math.PI) ** 2;
    const noise = Math.random() * 2 - 1;
    const tone = Math.sin(2 * Math.PI * (180 + t * 900) * (i / sr));
    d[i] = (noise * 0.5 + tone * 0.5) * env * 0.5;
  }
  return buf;
}
