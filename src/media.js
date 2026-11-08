/* ZTC AI Studio — media generation.

   image : AI Horde -> Pollinations -> procedural canvas art (always works)
   voice : Puter TTS -> StreamElements -> your own Piper/Kokoro endpoint
   music : built-in Web Audio composer (no network) or your own endpoint

   Nothing here ships a secret. Keyless providers are used anonymously; the
   account/key providers only ever read the user's own configuration. */

import { IMAGE_PROVIDERS, VOICE_PROVIDERS, withFailover, fetchWithTimeout, readErrorMessage } from "./providers.js";
import { clamp, hashString, seeded, sleep } from "./util.js";
import { STYLES } from "./catalog.js";

/* ---------------- canvas helpers ---------------- */
export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(2, Math.round(w));
  c.height = Math.max(2, Math.round(h));
  return c;
}

export const canvasToBlob = (canvas, type = "image/jpeg", quality = 0.9) =>
  new Promise((resolve, reject) => {
    if (canvas.toBlob) canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))), type, quality);
    else reject(new Error("Canvas export is not supported"));
  });

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = src;
  });
}

const stylePalette = (styleId) => (STYLES.find((s) => s.id === styleId) || STYLES[0]).palette;

/* ---------------- procedural art (offline floor) ---------------- */
/**
 * Deterministic abstract artwork derived from the prompt and style.
 * This is the guaranteed visual floor: no network, no GPU, no quota.
 */
export function proceduralArt({ prompt = "", styleId = "cinematic3d", width = 1024, height = 576, seed = 1 }) {
  const pal = stylePalette(styleId);
  const rnd = seeded(`${prompt}|${seed}|${styleId}`);
  const canvas = makeCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;

  // base gradient — direction varies per seed so scenes do not look cloned
  const angle = rnd() * Math.PI * 2;
  const g = ctx.createLinearGradient(
    W * (0.5 - Math.cos(angle) * 0.7), H * (0.5 - Math.sin(angle) * 0.7),
    W * (0.5 + Math.cos(angle) * 0.7), H * (0.5 + Math.sin(angle) * 0.7),
  );
  g.addColorStop(0, pal.bg1);
  g.addColorStop(0.5 + rnd() * 0.12, pal.bg2);
  g.addColorStop(1, pal.bg1);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // soft colour fields
  ctx.globalCompositeOperation = "lighter";
  const blobs = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < blobs; i++) {
    const cx = rnd() * W, cy = rnd() * H, r = (0.18 + rnd() * 0.42) * Math.max(W, H);
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, hexA(i % 2 ? pal.ink : pal.accent, 0.14 + rnd() * 0.18));
    rg.addColorStop(1, hexA(pal.accent, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.globalCompositeOperation = "source-over";

  // horizon / structural band
  const horizon = H * (0.52 + rnd() * 0.26);
  const bandGrad = ctx.createLinearGradient(0, horizon - H * 0.25, 0, H);
  bandGrad.addColorStop(0, hexA(pal.bg1, 0));
  bandGrad.addColorStop(1, hexA("#000000", 0.5 + rnd() * 0.25));
  ctx.fillStyle = bandGrad;
  ctx.fillRect(0, horizon - H * 0.25, W, H - horizon + H * 0.25);

  // motif: three families so consecutive scenes read differently
  const family = Math.floor(rnd() * 3);
  ctx.save();
  ctx.translate(W * (0.24 + rnd() * 0.52), H * (0.3 + rnd() * 0.3));
  ctx.rotate((rnd() - 0.5) * Math.PI);
  const size = Math.min(W, H) * (0.14 + rnd() * 0.18);
  ctx.strokeStyle = hexA(pal.ink, 0.4 + rnd() * 0.25);
  ctx.lineWidth = Math.max(1.2, Math.min(W, H) * (0.002 + rnd() * 0.0025));

  if (family === 0) {
    const sides = 3 + Math.floor(rnd() * 5);
    ctx.beginPath();
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * size, y = Math.sin(a) * size;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.55;
    for (let i = 1; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, size * (0.36 + i * 0.28), 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (family === 1) {
    ctx.globalAlpha = 0.7;
    const rings = 5 + Math.floor(rnd() * 5);
    for (let i = 0; i < rings; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 0, size * (0.3 + i * 0.16), size * (0.3 + i * 0.1), rnd() * 0.6, 0, Math.PI * (1.2 + rnd()));
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, size, 0, Math.PI * 2);
    ctx.clip();
    const gap = Math.max(6, size * 0.16);
    for (let x = -size; x < size; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x, -size);
      ctx.lineTo(x + size * 1.4, size);
      ctx.stroke();
    }
  }
  ctx.restore();

  // accent rules (design detail, reads as art direction)
  ctx.fillStyle = hexA(pal.accent, 0.8 + rnd() * 0.2);
  const bars = 1 + (rnd() > 0.55 ? 1 : 0);
  for (let i = 0; i < bars; i++) {
    const barY = H * (0.7 + rnd() * 0.14);
    ctx.fillRect(W * (0.06 + rnd() * 0.1), barY, W * (0.08 + rnd() * 0.26), Math.max(2, H * (0.004 + rnd() * 0.006)));
  }

  // fine grain
  const grain = ctx.getImageData(0, 0, W, H);
  const d = grain.data;
  const gr = seeded(`${seed}-grain`);
  for (let i = 0; i < d.length; i += 4) {
    const n = (gr() - 0.5) * 16;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(grain, 0, 0);

  // vignette
  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  return canvas;
}

function hexA(hex, alpha) {
  const h = String(hex).replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export async function proceduralImage(opts) {
  const canvas = proceduralArt(opts);
  return canvasToBlob(canvas, "image/jpeg", 0.9);
}

/* ---------------- AI Horde ---------------- */
const HORDE = "https://aihorde.net/api/v2";

export function hordeSize(width, height) {
  const aspect = width / height;
  const round64 = (v) => Math.max(64, Math.round(v / 64) * 64);
  if (aspect > 1.4) return { width: 1024, height: round64(1024 / aspect) };
  if (aspect < 0.75) return { width: round64(1024 * aspect), height: 1024 };
  return { width: 832, height: round64(832 / aspect) };
}

async function hordeImage(provider, { prompt, negative, width, height, seed, model, settings, signal, onEvent }) {
  const size = hordeSize(width, height);
  const key = settings?.hordeKey || "0000000000";
  const headers = { "Content-Type": "application/json", "Client-Agent": "ZTCStudio:3.1.0:browser", apikey: key };
  const fullPrompt = `${prompt.slice(0, 1400)}${negative ? ` ### ${negative.slice(0, 400)}` : ""}`;
  const start = await fetchWithTimeout(`${HORDE}/generate/async`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      prompt: fullPrompt,
      params: { width: size.width, height: size.height, steps: 24, cfg_scale: 6.5, sampler_name: "k_euler", n: 1, karras: true },
      models: model ? [model] : undefined,
      nsfw: false,
      censor_nsfw: true,
      trusted_workers: false,
      r2: true,
      shared: false,
      slow_workers: true,
    }),
  }, { timeout: 30000, signal });
  if (!start.ok) throw new Error(await readErrorMessage(start));
  const job = await start.json();
  if (!job.id) throw new Error("AI Horde did not return a job id");

  const deadline = Date.now() + 150000;
  let announced = false;
  while (Date.now() < deadline) {
    await sleep(2000);
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const chkRes = await fetchWithTimeout(`${HORDE}/generate/check/${job.id}`, { headers }, { timeout: 20000, signal });
    if (!chkRes.ok) continue;
    const chk = await chkRes.json();
    if (chk.faulted) throw new Error("AI Horde worker faulted the job");
    if (chk.is_possible === false) throw new Error("no AI Horde worker can run this model/size right now");
    if (!announced && onEvent) {
      onEvent({ level: "info", text: `queued on AI Horde (position ${chk.queue_position ?? "?"})` });
      announced = true;
    }
    if (chk.done) {
      const stRes = await fetchWithTimeout(`${HORDE}/generate/status/${job.id}`, { headers }, { timeout: 30000, signal });
      if (!stRes.ok) throw new Error(await readErrorMessage(stRes));
      const st = await stRes.json();
      const url = st.generations?.[0]?.img;
      if (!url) throw new Error("AI Horde returned no image");
      const imgRes = await fetchWithTimeout(url, {}, { timeout: 45000, signal });
      if (!imgRes.ok) throw new Error(await readErrorMessage(imgRes));
      const blob = await imgRes.blob();
      if (!/^image\//.test(blob.type) || blob.size < 1200) throw new Error("AI Horde image was empty or not an image");
      return { blob, meta: { model: st.generations[0].model || model || "horde", seed: st.generations[0].seed ?? seed, width: size.width, height: size.height } };
    }
  }
  throw new Error("AI Horde queue timed out after 150s");
}

/* ---------------- Pollinations ---------------- */
async function pollinationsImage(provider, { prompt, width, height, seed, model, signal }) {
  // Classic keyless tier: one image per 45s and 768px max. Scale down to fit.
  const maxSide = 768;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(256, Math.round(width * scale));
  const h = Math.max(256, Math.round(height * scale));
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt.slice(0, 900))}?width=${w}&height=${h}&seed=${seed}&nologo=true&model=${encodeURIComponent(model || "sana")}`;
  const res = await fetchWithTimeout(url, { mode: "cors", cache: "no-store" }, { timeout: 90000, signal });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/")) throw new Error(`unexpected content-type ${ct || "none"} (rate limit page?)`);
  const blob = await res.blob();
  if (blob.size < 1200) throw new Error("image response was too small");
  return { blob, meta: { model: model || "sana", seed, width: w, height: h } };
}

/* ---------------- public image API ---------------- */
export async function generateImage({ prompt, negative = "", width, height, seed, model, styleId, settings, signal, onEvent = () => {}, prefer = null }) {
  const providers = prefer ? IMAGE_PROVIDERS.filter((p) => prefer.includes(p.id)) : IMAGE_PROVIDERS;
  const { value, provider, attempts } = await withFailover({
    providers,
    settings,
    signal,
    onEvent,
    label: "image",
    retryPerProvider: 1,
    run: async (p, sig) => {
      if (p.id === "horde") return { ...(await hordeImage(p, { prompt, negative, width, height, seed, model, settings, signal: sig, onEvent })), provider: p.name };
      if (p.id === "pollinations") return { ...(await pollinationsImage(p, { prompt, width, height, seed, model, signal: sig })), provider: p.name };
      const blob = await proceduralImage({ prompt, styleId, width, height, seed });
      return { blob, meta: { model: "procedural", seed, width, height }, provider: "Procedural canvas" };
    },
  });
  return { ...value, providerName: value.provider || provider.name, attempts };
}

/* ---------------- voice ---------------- */
let puterChecked = 0;

async function puterVoice(provider, { text, voice, signal }) {
  if (typeof window === "undefined" || !window.puter?.ai?.txt2speech) {
    throw new Error("Puter.js is not loaded (blocked by CSP or offline)");
  }
  if (window.puter.auth?.isSignedIn) {
    let signed = false;
    try { signed = await window.puter.auth.isSignedIn(); } catch { signed = false; }
    if (!signed) throw new Error("Puter sign-in required — connect it in Settings → Voice");
  }
  const audio = await window.puter.ai.txt2speech(String(text).slice(0, 2900), {
    provider: "aws-polly", voice: voice || "Joanna", engine: "neural", language: voiceLang(voice),
  });
  const src = typeof audio === "string" ? audio : audio?.src || audio?.currentSrc || "";
  if (!src) throw new Error("Puter returned no audio source");
  const res = await fetchWithTimeout(src, {}, { timeout: 45000, signal });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const blob = await res.blob();
  if (blob.size < 800) throw new Error("Puter audio was empty");
  return { blob, meta: { voice, engine: "aws-polly/neural", provider: "Puter" } };
}

function voiceLang(voice) {
  const map = { Amy: "en-GB", Brian: "en-GB", Emma: "en-GB", Olivia: "en-AU", Aria: "en-NZ", Kajal: "en-IN", Zhiyu: "cmn-CN", Takumi: "ja-JP", Camila: "pt-BR", Lupe: "es-US", Daniel: "de-DE", Léa: "fr-FR" };
  return map[voice] || "en-US";
}

async function streamelementsVoice(provider, { text, voice, signal }) {
  const url = `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(voice || "Brian")}&text=${encodeURIComponent(String(text).slice(0, 900))}`;
  const res = await fetchWithTimeout(url, {}, { timeout: 40000, signal });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const blob = await res.blob();
  if (!/^audio\//.test(blob.type) && !/mpeg|mp3|octet/.test(blob.type)) throw new Error(`unexpected audio type ${blob.type}`);
  if (blob.size < 800) throw new Error("TTS audio was empty");
  return { blob, meta: { voice, provider: "StreamElements" } };
}

async function endpointVoice(provider, { text, voice, settings, signal }) {
  const url = String(settings?.ttsEndpoint || "").trim();
  if (!url) throw new Error("no self-hosted TTS endpoint configured");
  const headers = { "Content-Type": "application/json" };
  if (settings.ttsEndpointToken) headers.Authorization = `Bearer ${settings.ttsEndpointToken}`;
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ text, voice, format: "wav" }),
  }, { timeout: 90000, signal });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const blob = await res.blob();
  if (!blob.size) throw new Error("TTS endpoint returned no audio");
  return { blob, meta: { voice, provider: "Self-hosted TTS" } };
}

export async function generateVoice({ text, voice = "Joanna", settings, signal, onEvent = () => {}, prefer = null }) {
  if (!String(text || "").trim()) throw new Error("nothing to speak");
  const providers = prefer ? VOICE_PROVIDERS.filter((p) => prefer.includes(p.id)) : VOICE_PROVIDERS;
  const { value, provider, attempts } = await withFailover({
    providers,
    settings,
    signal,
    onEvent,
    label: "voice",
    retryPerProvider: 1,
    run: async (p, sig) => {
      if (p.id === "puter") return puterVoice(p, { text, voice, signal: sig });
      if (p.id === "streamelements") return streamelementsVoice(p, { text, voice, signal: sig });
      if (p.id === "endpoint") return endpointVoice(p, { text, voice, settings, signal: sig });
      throw new Error("browser speech can be previewed but not recorded");
    },
  });
  return { ...value, providerName: value.meta?.provider || provider.name, attempts };
}

export async function probeVoice(settings, voice = "Joanna") {
  const r = await generateVoice({ text: "ZTC Studio voice check.", voice, settings, prefer: settings.enableDeviceVoice ? null : ["puter", "streamelements", "endpoint"] });
  return { provider: r.providerName, bytes: r.blob.size };
}

/* ---------------- audio context ---------------- */
let sharedCtx = null;
export function audioContext() {
  if (!sharedCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error("Web Audio is not available in this browser");
    sharedCtx = new Ctx({ latencyHint: "interactive" });
  }
  if (sharedCtx.state === "suspended") sharedCtx.resume().catch(() => {});
  return sharedCtx;
}

export async function decodeAudio(blob) {
  const ctx = audioContext();
  const buf = await blob.arrayBuffer();
  return ctx.decodeAudioData(buf.slice(0));
}

/* ---------------- music composition ---------------- */
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};
const PROGRESSIONS = {
  cinematic: [[0, 5, 3, 4], [0, 3, 5, 4], [0, 4, 5, 3]],
  ambient: [[0, 3, 0, 4], [0, 5, 3, 4]],
  lofi: [[0, 5, 3, 4], [0, 3, 5, 3]],
  synthwave: [[0, 5, 3, 4], [0, 2, 5, 4]],
  tension: [[0, 1, 0, 1], [0, 5, 1, 0]],
  uplifting: [[0, 4, 5, 3], [0, 3, 4, 4]],
  minimal: [[0, 0, 5, 5], [0, 3, 0, 3]],
  none: [[0, 0, 0, 0]],
};

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

/**
 * Render a loopable music bed. Returns an AudioBuffer of ~4 bars.
 * Deterministic for a given mood + seed.
 */
export async function composeMusicLoop(moodId = "cinematic", seed = 1) {
  const cfg = { cinematic: { tempo: 76, key: 0, scale: "minor" }, ambient: { tempo: 62, key: 2, scale: "dorian" }, lofi: { tempo: 84, key: -2, scale: "dorian" }, synthwave: { tempo: 104, key: -3, scale: "minor" }, tension: { tempo: 90, key: 1, scale: "phrygian" }, uplifting: { tempo: 112, key: 3, scale: "major" }, minimal: { tempo: 96, key: 0, scale: "major" }, none: { tempo: 90, key: 0, scale: "major" } }[moodId] || { tempo: 76, key: 0, scale: "minor" };
  const scale = SCALES[cfg.scale];
  const prog = (PROGRESSIONS[moodId] || PROGRESSIONS.cinematic)[0];
  const beat = 60 / cfg.tempo;
  const barLen = beat * 4;
  const bars = 4;
  const secs = barLen * bars;
  const sr = 32000;

  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OfflineCtx) throw new Error("Offline audio rendering is not available");
  const ctx = new OfflineCtx(2, Math.ceil(sr * (secs + 1.2)), sr);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 24; comp.ratio.value = 3.2; comp.attack.value = 0.01; comp.release.value = 0.25;
  master.connect(comp).connect(ctx.destination);

  const rnd = seeded(`${moodId}-${seed}`);
  if (moodId !== "none") {
    // pads + bass per bar
    prog.forEach((deg, bar) => {
      const root = 48 + cfg.key + scale[deg % scale.length];
      const chord = [0, 2, 4].map((o) => root + scale[(deg + o) % scale.length] + (o === 4 ? 12 : 0));
      const t0 = bar * barLen;

      for (const note of chord) {
        const osc = ctx.createOscillator();
        osc.type = moodId === "synthwave" || moodId === "cinematic" || moodId === "tension" ? "sawtooth" : "sine";
        osc.frequency.value = midiToHz(note);
        osc.detune.value = (rnd() - 0.5) * 12;
        const filt = ctx.createBiquadFilter();
        filt.type = "lowpass";
        filt.frequency.setValueAtTime(700, t0);
        filt.frequency.linearRampToValueAtTime(moodId === "ambient" ? 1400 : 2200, t0 + barLen * 0.6);
        filt.Q.value = 0.7;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.09, t0 + Math.min(1.6, barLen * 0.45));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + barLen * 1.05);
        osc.connect(filt).connect(g).connect(master);
        osc.start(t0);
        osc.stop(t0 + barLen * 1.1);
      }

      // bass
      const bass = ctx.createOscillator();
      bass.type = "triangle";
      bass.frequency.value = midiToHz(root - 12);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.0001, t0);
      bg.gain.exponentialRampToValueAtTime(0.16, t0 + 0.08);
      bg.gain.exponentialRampToValueAtTime(0.0001, t0 + barLen * 0.92);
      bass.connect(bg).connect(master);
      bass.start(t0); bass.stop(t0 + barLen);

      // arpeggio (skip for ambient/tension)
      if (moodId !== "ambient" && moodId !== "tension") {
        const steps = 8;
        for (let i = 0; i < steps; i++) {
          if (rnd() < 0.28) continue;
          const note = chord[i % chord.length] + 12;
          const t = t0 + (i * barLen) / steps;
          const osc = ctx.createOscillator();
          osc.type = moodId === "lofi" ? "triangle" : "square";
          osc.frequency.value = midiToHz(note);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(moodId === "minimal" ? 0.05 : 0.07, t + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
          const f = ctx.createBiquadFilter();
          f.type = "lowpass"; f.frequency.value = moodId === "minimal" ? 2600 : 4200;
          osc.connect(f).connect(g).connect(master);
          osc.start(t); osc.stop(t + 0.3);
        }
      }

      // drums
      const drums = moodId === "ambient" || moodId === "minimal" ? "none" : moodId === "lofi" ? "lofi" : moodId === "tension" ? "pulse" : "four";
      if (drums !== "none") {
        const kicks = drums === "four" ? [0, 1, 2, 3] : drums === "lofi" ? [0, 2] : [0];
        for (const b of kicks) {
          const t = t0 + b * beat;
          const osc = ctx.createOscillator();
          osc.type = "sine";
          osc.frequency.setValueAtTime(120, t);
          osc.frequency.exponentialRampToValueAtTime(44, t + 0.16);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.32, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
          osc.connect(g).connect(master);
          osc.start(t); osc.stop(t + 0.3);
        }
        // hats
        for (let i = 0; i < 8; i++) {
          const t = t0 + (i * barLen) / 8;
          const noise = ctx.createBufferSource();
          noise.buffer = noiseBuffer(ctx, 0.05, rnd);
          const hp = ctx.createBiquadFilter();
          hp.type = "highpass"; hp.frequency.value = 7000;
          const g = ctx.createGain();
          g.gain.setValueAtTime(drums === "four" ? 0.05 : 0.03, t);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
          noise.connect(hp).connect(g).connect(master);
          noise.start(t);
        }
      }
    });
  }

  const buffer = await ctx.startRendering();
  return { buffer, seconds: secs, sampleRate: sr };
}

function noiseBuffer(ctx, seconds, rnd) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  return buf;
}

/** Optional: fetch a generated score from a self-hosted MusicGen / Stable Audio endpoint. */
export async function endpointMusic({ mood, duration, settings, signal }) {
  const url = String(settings?.musicEndpoint || "").trim();
  if (!url) throw new Error("no music endpoint configured");
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: `${mood} instrumental background score, loopable, no vocals`, duration: Math.min(30, duration) }),
  }, { timeout: 120000, signal });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const blob = await res.blob();
  if (!blob.size) throw new Error("music endpoint returned no audio");
  const buffer = await decodeAudio(blob);
  return { buffer, blob };
}

/* ---------------- WAV encoding ---------------- */
export function encodeWav(audioBuffer) {
  const channels = Math.min(2, audioBuffer.numberOfChannels);
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  const chans = [];
  for (let c = 0; c < channels; c++) chans.push(audioBuffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/* ---------------- image checks ---------------- */
export async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}

export const imageCacheKey = ({ prompt, styleId, model, width, height, seed }) =>
  `img|${prompt}|${styleId}|${model}|${width}x${height}|${seed}`;

export const voiceCacheKey = ({ text, voice }) => `vo|${voice}|${text}`;

export { hashString };
