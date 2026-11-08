/* ZTC AI Studio — canvas renderer.

   Draws the finished frame for any timeline position: scene image with a 2.5D
   camera move, transitions, post effects, captions, branding and an optional
   real 3D mesh layer (rotating icosahedron with per-face lighting).

   The same draw() path is used for scrubbing, thumbnails and video capture, so
   what you preview is exactly what is recorded. */

import { QUALITY, ASPECTS, STYLES, TRANSITIONS, BRAND_PRESETS } from "./catalog.js";
import { assetUrl } from "./store.js";
import { clamp, seeded, hashString } from "./util.js";
import { loadImage, makeCanvas } from "./media.js";

const styleById = (id) => STYLES.find((s) => s.id === id) || STYLES[0];
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export function frameSize(project) {
  const aspect = ASPECTS[project?.settings?.aspect] || ASPECTS["16:9"];
  const q = QUALITY[project?.settings?.quality] || QUALITY.standard;
  const w = Math.round((aspect.w * q.scale) / 2) * 2;
  const h = Math.round((aspect.h * q.scale) / 2) * 2;
  return { w, h, aspect, quality: q };
}

export function totalSeconds(project) {
  return (project?.plan?.scenes || []).reduce((n, s) => n + (Number(s.duration) || 0), 0);
}

export function timingsOf(project) {
  let t = 0;
  return (project?.plan?.scenes || []).map((s, i) => {
    const start = t;
    t += Number(s.duration) || 0;
    return { index: i, start, end: t, duration: Number(s.duration) || 0 };
  });
}

/* ---------------- captions ---------------- */
export function buildCues(project) {
  const scenes = project?.plan?.scenes || [];
  const caps = project?.settings?.captions || {};
  if (!caps.enabled) return [];
  const maxChars = clamp(Number(caps.maxChars) || 64, 24, 120);
  const timings = timingsOf(project);
  const cues = [];

  scenes.forEach((scene, i) => {
    const text = String(scene.narration || "").replace(/\s+/g, " ").trim();
    if (!text) return;
    const chunks = [];
    // Prefer sentence boundaries, then split long sentences on word boundaries.
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (sentence.length <= maxChars) { chunks.push(sentence); continue; }
      let line = "";
      for (const word of sentence.split(" ")) {
        if ((line + " " + word).trim().length > maxChars && line) { chunks.push(line.trim()); line = word; }
        else line = `${line} ${word}`.trim();
      }
      if (line) chunks.push(line.trim());
    }
    const totalChars = chunks.reduce((n, c) => n + c.length, 0) || 1;
    let acc = timings[i].start;
    chunks.forEach((chunk, k) => {
      const share = (chunk.length / totalChars) * timings[i].duration;
      const start = acc;
      const end = k === chunks.length - 1 ? timings[i].end : start + share;
      cues.push({ text: chunk, start, end: Math.max(start + 0.4, end), sceneIndex: i });
      acc = end;
    });
  });
  return cues;
}

export function cueAt(cues, t) {
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (t < c.start) hi = mid - 1;
    else if (t > c.end) lo = mid + 1;
    else return c;
  }
  return null;
}

/* ---------------- renderer ---------------- */
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    this.project = null;
    this.images = new Map();
    this.cues = [];
    this.frame = 0;
    this.playing = false;
    this._raf = null;
    this._t0 = 0;
    this._from = 0;
    this.onEnd = null;
    this._bufA = null;
    this._bufB = null;
    this._noise = null;
  }

  setProject(project) {
    const changed = this.project?.id !== project?.id;
    this.project = project;
    const { w, h } = frameSize(project);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this._bufA = null;
      this._bufB = null;
    }
    this.cues = buildCues(project);
    if (changed) this.images.clear();
  }

  async prepare(onProgress = () => {}) {
    const scenes = this.project?.plan?.scenes || [];
    const ids = [...new Set(scenes.map((s) => s.imageId).filter(Boolean))];
    let done = 0;
    for (const id of ids) {
      if (this.images.has(id)) { done++; continue; }
      try {
        const url = await assetUrl(id);
        if (!url) continue;
        const img = await loadImage(url);
        this.images.set(id, img);
      } catch { /* a missing image falls back to procedural art */ }
      done++;
      onProgress(done / Math.max(1, ids.length));
    }
    this.cues = buildCues(this.project);
    return this.images.size;
  }

  total() { return totalSeconds(this.project); }

  _buffers() {
    const W = this.canvas.width, H = this.canvas.height;
    if (!this._bufA || this._bufA.width !== W || this._bufA.height !== H) {
      this._bufA = makeCanvas(W, H);
      this._bufB = makeCanvas(W, H);
    }
    return [this._bufA, this._bufB];
  }

  drawAt(time) {
    const ctx = this.ctx;
    const W = this.canvas.width, H = this.canvas.height;
    const project = this.project;
    const scenes = project?.plan?.scenes || [];
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#05060a";
    ctx.fillRect(0, 0, W, H);

    if (!scenes.length) {
      this._drawPlaceholder(W, H);
      ctx.restore();
      return;
    }

    const timings = timingsOf(project);
    const total = timings[timings.length - 1]?.end || 1;
    const t = clamp(time, 0, total - 0.0001);

    let idx = timings.findIndex((tm) => t < tm.end);
    if (idx < 0) idx = timings.length - 1;
    const scene = scenes[idx];
    const tm = timings[idx];
    const p = tm.duration ? clamp((t - tm.start) / tm.duration, 0, 1) : 0;

    const [bufA, bufB] = this._buffers();
    const trans = TRANSITIONS[scene.transition] || TRANSITIONS.fade;
    const inTransition = idx > 0 && trans.ms > 0 && (t - tm.start) * 1000 < trans.ms;

    if (inTransition) {
      const prev = scenes[idx - 1];
      this._drawScene(bufA.getContext("2d"), prev, 1, W, H, prev.imageId);
      this._drawScene(bufB.getContext("2d"), scene, p, W, H, scene.imageId);
      const k = clamp(((t - tm.start) * 1000) / trans.ms, 0, 1);
      this._composite(ctx, bufA, bufB, scene.transition, easeInOut(k), W, H);
    } else {
      this._drawScene(ctx, scene, p, W, H, scene.imageId);
    }

    this.frame++;
    this._postEffects(ctx, W, H, t, project);
    this._captions(ctx, W, H, t);
    this._branding(ctx, W, H, t, total, project);
    ctx.restore();
  }

  _drawPlaceholder(W, H) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0a0b10");
    g.addColorStop(1, "#140a10");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,48,79,.18)";
    ctx.lineWidth = 1;
    const step = Math.round(W / 24);
    for (let x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.fillStyle = "rgba(255,255,255,.34)";
    ctx.font = `600 ${Math.round(W * 0.024)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("No scenes yet — write a brief and generate a plan", W / 2, H / 2);
  }

  _drawScene(ctx, scene, p, W, H, imageId) {
    const style = styleById(scene.styleId || this.project?.settings?.styleId);
    const pal = style.palette;
    ctx.save();
    ctx.fillStyle = pal.bg1;
    ctx.fillRect(0, 0, W, H);

    const img = imageId ? this.images.get(imageId) : null;
    if (img) {
      // Respect the OS/browser reduced-motion preference and the in-app toggle.
      const reduced = typeof document !== "undefined" && document.documentElement.classList.contains("reduce-motion");
      const motion = reduced ? "static" : scene.motion || "zoom-in";
      const e = easeInOut(p);
      let zoom = 1.03, panX = 0, panY = 0;
      switch (motion) {
        case "zoom-in": zoom = 1.02 + 0.10 * e; break;
        case "zoom-out": zoom = 1.14 - 0.10 * e; break;
        case "pan-left": zoom = 1.10; panX = 0.045 * (1 - 2 * e); break;
        case "pan-right": zoom = 1.10; panX = -0.045 * (1 - 2 * e); break;
        case "tilt-up": zoom = 1.10; panY = 0.05 * (1 - 2 * e); break;
        case "orbit": zoom = 1.12; panX = 0.032 * Math.sin(e * Math.PI); panY = 0.012 * Math.cos(e * Math.PI); break;
        case "parallax": zoom = 1.07; panX = 0.022 * Math.sin(e * Math.PI * 2); panY = 0.012 * Math.cos(e * Math.PI * 2); break;
        case "dolly": zoom = 1.0 + 0.09 * e; panY = -0.01 * e; break;
        case "static": zoom = 1.0; break;
        default: zoom = 1.01 + 0.02 * e;
      }
      const s = Math.max(W / img.width, H / img.height) * zoom;
      const dw = img.width * s, dh = img.height * s;
      const dx = (W - dw) / 2 + panX * W;
      const dy = (H - dh) / 2 + panY * H;
      ctx.drawImage(img, dx, dy, dw, dh);

      // subtle graded wash keeps AI art consistent with the chosen style
      const wash = ctx.createLinearGradient(0, 0, W, H);
      wash.addColorStop(0, hexA(pal.accent, 0.07));
      wash.addColorStop(1, hexA(pal.bg1, 0.16));
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);
    } else {
      this._proceduralScene(ctx, scene, p, W, H, pal, style);
    }

    if ((this.project?.settings?.effects || []).includes("mesh3d")) {
      this._mesh3d(ctx, W * 0.74, H * 0.42, Math.min(W, H) * 0.17, p * Math.PI * 1.2 + 0.4, pal);
    }
    ctx.restore();
  }

  _proceduralScene(ctx, scene, p, W, H, pal, style) {
    const rnd = seeded(hashString(`${scene.id}-${scene.title}`));
    const g = ctx.createLinearGradient(0, 0, W * (0.6 + 0.4 * p), H);
    g.addColorStop(0, pal.bg1);
    g.addColorStop(0.6, pal.bg2);
    g.addColorStop(1, pal.bg1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 4; i++) {
      const cx = W * (rnd() * 0.9 + 0.05 + Math.sin(p * 2 + i) * 0.02);
      const cy = H * (rnd() * 0.9 + 0.05 + Math.cos(p * 1.6 + i) * 0.02);
      const r = Math.max(W, H) * (0.2 + rnd() * 0.35);
      const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      rg.addColorStop(0, hexA(pal.accent, 0.16 + 0.06 * Math.sin(p * Math.PI * 2 + i)));
      rg.addColorStop(1, hexA(pal.accent, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.globalCompositeOperation = "source-over";

    // structural motif
    ctx.save();
    ctx.translate(W * 0.5, H * 0.46);
    ctx.rotate(p * 0.5 + rnd());
    ctx.strokeStyle = hexA(pal.ink, 0.32);
    ctx.lineWidth = Math.max(1, W * 0.0022);
    const size = Math.min(W, H) * (0.18 + rnd() * 0.1);
    for (let ring = 0; ring < 3; ring++) {
      ctx.beginPath();
      const sides = 6;
      for (let i = 0; i <= sides; i++) {
        const a = (i / sides) * Math.PI * 2 + ring * 0.2;
        const r = size * (0.7 + ring * 0.3);
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = hexA(pal.accent, 0.9);
    ctx.fillRect(W * 0.08, H * 0.82, W * (0.1 + 0.15 * Math.sin(p * Math.PI)), Math.max(2, H * 0.005));

    // soft floor
    const floor = ctx.createLinearGradient(0, H * 0.72, 0, H);
    floor.addColorStop(0, hexA("#000000", 0));
    floor.addColorStop(1, hexA("#000000", 0.6));
    ctx.fillStyle = floor;
    ctx.fillRect(0, H * 0.72, W, H * 0.28);
  }

  _composite(ctx, a, b, type, k, W, H) {
    ctx.save();
    switch (type) {
      case "slide": {
        ctx.drawImage(a, 0, 0);
        ctx.drawImage(b, W * (1 - k), 0);
        break;
      }
      case "wipe": {
        ctx.drawImage(a, 0, 0);
        ctx.beginPath();
        ctx.rect(0, 0, W * k, H);
        ctx.clip();
        ctx.drawImage(b, 0, 0);
        break;
      }
      case "dip": {
        ctx.drawImage(a, 0, 0);
        if (k < 0.5) {
          ctx.fillStyle = `rgba(0,0,0,${k * 2})`;
          ctx.fillRect(0, 0, W, H);
        } else {
          ctx.fillStyle = "#000";
          ctx.fillRect(0, 0, W, H);
          ctx.globalAlpha = (k - 0.5) * 2;
          ctx.drawImage(b, 0, 0);
        }
        break;
      }
      case "glitch": {
        ctx.drawImage(a, 0, 0);
        const slices = 12;
        for (let i = 0; i < slices; i++) {
          const sy = (i / slices) * H;
          const sh = H / slices;
          const shift = (Math.sin(i * 12.9898 + k * 40) * 43758.5453 % 1) * W * 0.12 * (1 - Math.abs(k - 0.5) * 2);
          ctx.drawImage(b, 0, sy, W, sh, shift, sy, W, sh);
        }
        ctx.globalAlpha = k * 0.5;
        ctx.drawImage(a, 0, 0);
        break;
      }
      case "none": ctx.drawImage(b, 0, 0); break;
      default: {
        ctx.drawImage(a, 0, 0);
        ctx.globalAlpha = k;
        ctx.drawImage(b, 0, 0);
      }
    }
    ctx.restore();
  }

  _postEffects(ctx, W, H, t, project) {
    const effects = project?.settings?.effects || [];
    if (!effects.length) return;

    if (effects.includes("bloom")) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.16;
      ctx.filter = `blur(${Math.round(Math.min(W, H) * 0.02)}px)`;
      ctx.drawImage(this.canvas, 0, 0);
      ctx.filter = "none";
      ctx.restore();
    }

    if (effects.includes("chromatic")) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.globalAlpha = 0.12;
      ctx.drawImage(this.canvas, -Math.max(1, W * 0.0016), 0);
      ctx.drawImage(this.canvas, Math.max(1, W * 0.0016), 0);
      ctx.restore();
    }

    if (effects.includes("lightleak")) {
      const x = (Math.sin(t * 0.35) * 0.5 + 0.5) * W;
      const g = ctx.createRadialGradient(x, H * 0.15, 0, x, H * 0.15, Math.max(W, H) * 0.55);
      g.addColorStop(0, "rgba(255,140,90,.16)");
      g.addColorStop(0.5, "rgba(255,60,90,.06)");
      g.addColorStop(1, "rgba(255,60,90,0)");
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    if (effects.includes("particles")) {
      const n = 46;
      const rnd = seeded(`p-${project?.id}`);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < n; i++) {
        const bx = rnd(), by = rnd(), sp = 0.02 + rnd() * 0.06, r = (0.4 + rnd() * 1.4);
        const x = ((bx + t * sp * 0.12) % 1) * W;
        const y = ((by - t * sp * 0.08 + 1) % 1) * H;
        ctx.globalAlpha = 0.12 + 0.22 * Math.abs(Math.sin(t * 0.8 + i));
        ctx.fillStyle = i % 3 === 0 ? "#8be9ff" : "#ffffff";
        ctx.beginPath();
        ctx.arc(x, y, r * (W / 900), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (effects.includes("scanlines")) {
      ctx.save();
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = "#000";
      const step = Math.max(3, Math.round(H / 240));
      for (let y = 0; y < H; y += step * 2) ctx.fillRect(0, y, W, step);
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = "#8be9ff";
      ctx.fillRect(0, (t * 120) % H, W, Math.max(1, H * 0.004));
      ctx.restore();
    }

    if (effects.includes("grid")) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,.055)";
      ctx.lineWidth = 1;
      const step = Math.round(W / 16);
      for (let x = 0; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.restore();
    }

    if (effects.includes("halftone")) {
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = "#000";
      const step = Math.max(4, Math.round(W / 180));
      for (let y = 0; y < H; y += step) {
        for (let x = (y / step) % 2 ? step / 2 : 0; x < W; x += step) {
          ctx.beginPath();
          ctx.arc(x, y, step * 0.28, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    if (effects.includes("grain")) {
      if (!this._noise) this._noise = makeNoise();
      ctx.save();
      ctx.globalAlpha = 0.055;
      const pat = ctx.createPattern(this._noise, "repeat");
      ctx.translate((this.frame * 37) % 256, (this.frame * 53) % 256);
      ctx.fillStyle = pat;
      ctx.fillRect(-256, -256, W + 512, H + 512);
      ctx.restore();
    }

    if (effects.includes("glitch") && this.frame % 37 < 3) {
      ctx.save();
      ctx.globalAlpha = 0.55;
      const slices = 5;
      for (let i = 0; i < slices; i++) {
        const sy = Math.random() * H;
        const sh = H * 0.03 * Math.random();
        const dx = (Math.random() - 0.5) * W * 0.06;
        ctx.drawImage(this.canvas, 0, sy, W, sh, dx, sy, W, sh);
      }
      ctx.restore();
    }

    if (effects.includes("vignette")) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,.46)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    if (effects.includes("letterbox")) {
      const bar = Math.round(H * 0.055);
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, W, bar);
      ctx.fillRect(0, H - bar, W, bar);
    }
  }

  _captions(ctx, W, H, t) {
    const caps = this.project?.settings?.captions;
    if (!caps?.enabled) return;
    const cue = cueAt(this.cues, t);
    if (!cue) return;
    const style = caps.style || "bar";
    const brand = this.project?.settings?.branding || {};
    const accent = brand.color || "#ff304f";
    const size = Math.round(clamp(W * 0.031, 20, 64));
    const font = `600 ${size}px Inter, system-ui, -apple-system, sans-serif`;
    const maxWidth = W * 0.78;
    const lines = wrapLines(ctx, cue.text, maxWidth, font);
    const lineH = size * 1.32;
    const blockH = lines.length * lineH;
    const margin = H * 0.085;
    let baseY = H - margin - blockH;
    if (caps.position === "middle") baseY = (H - blockH) / 2;
    else if (caps.position === "top") baseY = margin;

    ctx.save();
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const cx = W / 2;
    const padX = size * 0.7, padY = size * 0.42;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));

    if (style === "bar") {
      const bx = cx - widest / 2 - padX;
      const by = baseY - padY;
      const bw = widest + padX * 2;
      const bh = blockH + padY * 2;
      ctx.fillStyle = "rgba(6,7,10,.72)";
      roundRect(ctx, bx, by, bw, bh, size * 0.28);
      ctx.fill();
      ctx.fillStyle = accent;
      ctx.fillRect(bx, by + bh * 0.16, Math.max(2, size * 0.09), bh * 0.68);
      ctx.fillStyle = "#ffffff";
      lines.forEach((line, i) => ctx.fillText(line, cx, baseY + i * lineH));
    } else if (style === "neon") {
      ctx.shadowColor = accent;
      ctx.shadowBlur = size * 0.6;
      ctx.fillStyle = "#ffffff";
      lines.forEach((line, i) => ctx.fillText(line, cx, baseY + i * lineH));
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = accent;
      ctx.font = font;
      lines.forEach((line, i) => ctx.fillText(line, cx, baseY + i * lineH));
    } else {
      ctx.shadowColor = "rgba(0,0,0,.85)";
      ctx.shadowBlur = size * 0.5;
      ctx.shadowOffsetY = size * 0.08;
      ctx.fillStyle = "#ffffff";
      lines.forEach((line, i) => ctx.fillText(line, cx, baseY + i * lineH));
    }
    ctx.restore();
  }

  _branding(ctx, W, H, t, total, project) {
    const b = project?.settings?.branding;
    if (!b) return;
    const accent = b.color || "#ff304f";
    const brandName = b.name || project?.name || "ZTC";
    const preset = BRAND_PRESETS.find((p) => p.id === b.presetId) || BRAND_PRESETS[0];

    if (b.watermark && brandName) {
      ctx.save();
      ctx.globalAlpha = 0.72;
      ctx.font = `600 ${Math.round(W * 0.014)}px ${preset.font === "mono" ? "ui-monospace, monospace" : "Inter, system-ui, sans-serif"}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "bottom";
      ctx.fillStyle = "rgba(0,0,0,.35)";
      const pad = Math.round(W * 0.026);
      const tw = ctx.measureText(brandName).width;
      ctx.fillText(brandName, W - pad + 1, H - pad + 1);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(brandName, W - pad, H - pad);
      ctx.fillStyle = accent;
      ctx.fillRect(W - pad - tw - Math.round(W * 0.016), H - pad - Math.round(W * 0.004), Math.round(W * 0.008), Math.round(W * 0.008));
      ctx.restore();
    }

    // intro title card
    if (b.intro && t < 2.6 && preset.intro !== "none") {
      const k = t < 0.5 ? t / 0.5 : t > 2.0 ? Math.max(0, 1 - (t - 2.0) / 0.6) : 1;
      ctx.save();
      ctx.globalAlpha = clamp(k, 0, 1);
      ctx.fillStyle = "rgba(4,5,8,.55)";
      ctx.fillRect(0, 0, W, H);
      const title = (project.plan?.title || brandName).slice(0, 60);
      const size = Math.round(W * 0.05);
      ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.fillText(title, W / 2, H / 2 - size * 0.3);
      ctx.fillStyle = accent;
      ctx.fillRect(W / 2 - W * 0.06, H / 2 + size * 0.55, W * 0.12, Math.max(2, W * 0.0035));
      if (b.tagline) {
        ctx.font = `500 ${Math.round(W * 0.018)}px Inter, system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,.82)";
        ctx.fillText(b.tagline.slice(0, 80), W / 2, H / 2 + size * 1.05);
      }
      ctx.restore();
    }

    // outro / CTA card
    if (b.outro && total - t < 3.0 && preset.outro !== "none" && total > 6) {
      const k = clamp((3.0 - (total - t)) / 0.6, 0, 1);
      ctx.save();
      ctx.globalAlpha = k;
      const g = ctx.createLinearGradient(0, H * 0.35, 0, H);
      g.addColorStop(0, "rgba(4,5,8,0)");
      g.addColorStop(1, "rgba(4,5,8,.88)");
      ctx.fillStyle = g;
      ctx.fillRect(0, H * 0.35, W, H * 0.65);
      ctx.textAlign = "center";
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 ${Math.round(W * 0.038)}px Inter, system-ui, sans-serif`;
      ctx.fillText(brandName, W / 2, H * 0.79);
      ctx.fillStyle = accent;
      ctx.font = `600 ${Math.round(W * 0.017)}px Inter, system-ui, sans-serif`;
      ctx.fillText((b.tagline || "Made with ZTC AI Studio").slice(0, 90), W / 2, H * 0.86);
      ctx.restore();
    }
  }

  /* real 3D: shaded, depth-sorted icosahedron */
  _mesh3d(ctx, cx, cy, radius, angle, pal) {
    const t = (1 + Math.sqrt(5)) / 2;
    const verts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map(([x, y, z]) => {
      const len = Math.hypot(x, y, z);
      return [x / len, y / len, z / len];
    });
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    const cosB = Math.cos(angle * 0.63), sinB = Math.sin(angle * 0.63);
    const rot = verts.map(([x, y, z]) => {
      const x1 = x * cosA - z * sinA;
      const z1 = x * sinA + z * cosA;
      const y1 = y * cosB - z1 * sinB;
      const z2 = y * sinB + z1 * cosB;
      return [x1, y1, z2];
    });
    const dist = 2.8;
    const fov = 2.1;
    const project = ([x, y, z]) => {
      const k = fov / (z + dist);
      return [cx + x * radius * k * 1.6, cy + y * radius * k * 1.6, z];
    };
    const light = [-0.4, -0.7, -0.58];
    const polys = faces.map((f) => {
      const pts = f.map((i) => rot[i]);
      const [a, b, c] = pts;
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const nl = Math.hypot(...n) || 1;
      const nn = n.map((x) => x / nl);
      const lum = clamp(Math.abs(nn[0] * light[0] + nn[1] * light[1] + nn[2] * light[2]), 0, 1);
      const zAvg = (a[2] + b[2] + c[2]) / 3;
      return { pts: pts.map(project), lum, z: zAvg };
    }).sort((p, q) => q.z - p.z);

    ctx.save();
    ctx.globalAlpha = 0.9;
    for (const poly of polys) {
      const lum = 0.22 + poly.lum * 0.78;
      ctx.beginPath();
      poly.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = mixColor(pal.accent, pal.ink, lum * 0.55);
      ctx.fill();
      ctx.strokeStyle = hexA(pal.ink, 0.18);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------- playback ---------------- */
  play(from = 0, onTick = null, onEnd = null) {
    this.stop();
    const total = this.total();
    if (total <= 0) return;
    this.playing = true;
    this._from = clamp(from, 0, total - 0.01);
    this._t0 = performance.now();
    this.onEnd = onEnd;
    const loop = () => {
      if (!this.playing) return;
      const t = this._from + (performance.now() - this._t0) / 1000;
      const clamped = Math.min(t, total);
      this.drawAt(clamped);
      if (onTick) onTick(clamped, total);
      if (t >= total) {
        this.playing = false;
        this._raf = null;
        if (this.onEnd) this.onEnd();
        return;
      }
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  pause() {
    const t = this.playing ? this.currentTime : this._lastT;
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this.__lastT = t;
    return t;
  }

  stop() {
    this.playing = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  get currentTime() {
    if (!this.playing) return this._lastT || 0;
    return this._from + (performance.now() - this._t0) / 1000;
  }
  set _lastT(v) { this.__lastT = v; }
  get _lastT() { return this.__lastT || 0; }

  seek(t) {
    const total = this.total();
    const clamped = clamp(t, 0, Math.max(0, total - 0.01));
    this.__lastT = clamped;
    this.drawAt(clamped);
    return clamped;
  }

  stillDataUrl(t, type = "image/jpeg", quality = 0.9) {
    this.drawAt(t);
    return this.canvas.toDataURL(type, quality);
  }

  async stillBlob(t, type = "image/jpeg", quality = 0.9) {
    this.drawAt(t);
    return new Promise((resolve) => this.canvas.toBlob((b) => resolve(b), type, quality));
  }
}

/* ---------------- helpers ---------------- */
export function wrapLines(ctx, text, maxWidth, font) {
  ctx.save();
  if (font) ctx.font = font;
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  ctx.restore();
  return lines.slice(0, 4);
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function hexA(hex, alpha) {
  const h = String(hex).replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function mixColor(a, b, k) {
  const pa = parse(a), pb = parse(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * k);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * k);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * k);
  return `rgb(${r},${g},${bl})`;
}
function parse(hex) {
  const h = String(hex).replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16) || 0, parseInt(n.slice(2, 4), 16) || 0, parseInt(n.slice(4, 6), 16) || 0];
}

let noiseCanvas = null;
function makeNoise() {
  if (noiseCanvas) return noiseCanvas;
  noiseCanvas = makeCanvas(180, 180);
  const ctx = noiseCanvas.getContext("2d");
  const img = ctx.createImageData(180, 180);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + Math.random() * 135;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return noiseCanvas;
}

export { hexA };
