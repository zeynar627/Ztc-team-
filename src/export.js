/* ZTC AI Studio — export pipeline.

   Video is captured from the same canvas that drives the preview, with the live
   audio mix attached, so the file matches exactly what you watched. Audio-only,
   subtitles, contact sheets, project bundles and share links are also produced
   here. No server, no upload, no watermark unless branding is enabled. */

import { buildCues, frameSize, timingsOf, totalSeconds } from "./render.js";
import { listAssets, getAsset } from "./store.js";
import { encodeShare, makeZip, zipBlob, downloadBlob, safeFileName, slug } from "./util.js";
import { QUALITY } from "./catalog.js";

const VIDEO_TYPES = [
  { mime: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', ext: "mp4", label: "MP4 · best available codec" },
  { mime: "video/mp4", ext: "mp4", label: "MP4" },
  { mime: 'video/webm;codecs="vp9,opus"', ext: "webm", label: "WebM · VP9/Opus" },
  { mime: 'video/webm;codecs="vp8,opus"', ext: "webm", label: "WebM · VP8/Opus" },
  { mime: "video/webm", ext: "webm", label: "WebM" },
];

export function pickVideoType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of VIDEO_TYPES) {
    try { if (MediaRecorder.isTypeSupported(t.mime)) return t; } catch { /* ignore */ }
  }
  return VIDEO_TYPES[VIDEO_TYPES.length - 1];
}

export const videoSupported = () => typeof MediaRecorder !== "undefined" && !!HTMLCanvasElement.prototype.captureStream;

/**
 * Record the timeline in real time. Returns {blob, mime, ext, seconds}.
 * `signal` aborts and still finalises whatever was captured.
 */
export async function recordVideo({ renderer, audio, project, onProgress = () => {}, signal, onNotice = () => {} }) {
  if (!videoSupported()) throw new Error("This browser cannot record canvas video. Use Chrome, Edge, Firefox or Safari 16+.");
  const total = totalSeconds(project);
  if (total <= 0) throw new Error("There is nothing to render yet.");
  const type = pickVideoType();
  const { quality } = frameSize(project);
  const fps = Math.min(60, Math.max(12, Number(project?.settings?.fps) || quality.fps));

  renderer.setProject(project);
  renderer.drawAt(0);
  const stream = renderer.canvas.captureStream(fps);
  const audioTracks = audio?.stream ? audio.stream.getAudioTracks() : [];
  audioTracks.forEach((t) => stream.addTrack(t));

  const recorder = new MediaRecorder(stream, {
    mimeType: type?.mime,
    videoBitsPerSecond: quality.bitrate,
    audioBitsPerSecond: 160000,
  });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  const failed = new Promise((_, reject) => { recorder.onerror = (e) => reject(e.error || new Error("Recorder failed")); });

  recorder.start(1000);
  if (audio) {
    try { await audio.ctx?.resume?.(); } catch { /* some browsers reject resume without a gesture */ }
    audio.play(project, 0);
  }
  onNotice("Recording in real time — keep this tab in focus.");

  const t0 = performance.now();
  let aborted = false;
  await new Promise((resolve) => {
    const interval = Math.max(1000 / fps, 16);
    const timer = setInterval(() => {
      if (signal?.aborted) { aborted = true; clearInterval(timer); resolve(); return; }
      const t = (performance.now() - t0) / 1000;
      renderer.drawAt(Math.min(t, total));
      onProgress(Math.min(1, t / total), Math.min(t, total), total);
      if (t >= total + 0.12) { clearInterval(timer); resolve(); }
    }, interval);
  });

  renderer.drawAt(total);
  audio?.stop();
  await new Promise((r) => setTimeout(r, 260));
  try { recorder.stop(); } catch { /* already stopped */ }
  await Promise.race([stopped, failed.catch(() => {})]);
  stream.getVideoTracks().forEach((t) => t.stop());
  renderer.drawAt(0); // leave the stage where the user left it, not at the tail frame

  const blob = new Blob(chunks, { type: recorder.mimeType || type?.mime || "video/webm" });
  if (!blob.size) throw new Error("The recorder produced an empty file. Try a shorter duration or another browser.");
  // Trust the container header, not the codec string: browsers report codec
  // labels loosely but the magic bytes never lie.
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const isMp4 = head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70; // "ftyp"
  return {
    blob,
    mime: blob.type,
    container: isMp4 ? "mp4" : "webm",
    ext: isMp4 ? "mp4" : "webm",
    seconds: total,
    aborted,
    bytes: blob.size,
  };
}

/* ---------------- subtitles ---------------- */
const srtTime = (s) => {
  const ms = Math.round((s % 1) * 1000);
  const total = Math.floor(s);
  const h = String(Math.floor(total / 3600)).padStart(2, "0");
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const sec = String(total % 60).padStart(2, "0");
  return `${h}:${m}:${sec},${String(ms).padStart(3, "0")}`;
};
const vttTime = (s) => srtTime(s).replace(",", ".");

export function toSRT(project) {
  const cues = buildCues(project);
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

export function toVTT(project) {
  const cues = buildCues(project);
  return `WEBVTT\n\n${cues.map((c, i) => `${i + 1}\n${vttTime(c.start)} --> ${vttTime(c.end)}\n${c.text}\n`).join("\n")}`;
}

export function toPlainTranscript(project) {
  return (project?.plan?.scenes || []).map((s, i) => `[${String(i + 1).padStart(2, "0")}] ${s.title}\n${s.narration || "(no narration)"}`).join("\n\n");
}

/* ---------------- stills ---------------- */
export async function contactSheet(renderer, project, { cols = 3, rows = 3, thumbW = 480 } = {}) {
  renderer.setProject(project);
  await renderer.prepare().catch(() => {});
  const { w, h } = frameSize(project);
  const timings = timingsOf(project);
  if (!timings.length) throw new Error("No scenes to capture");
  const count = Math.min(cols * rows, timings.length);
  const thumbH = Math.round((thumbW * h) / w);
  const pad = 12;
  const labelH = 26;
  const sheet = document.createElement("canvas");
  sheet.width = cols * thumbW + pad * (cols + 1);
  sheet.height = rows * (thumbH + labelH) + pad * (rows + 1);
  const ctx = sheet.getContext("2d");
  ctx.fillStyle = "#08090c";
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  for (let i = 0; i < count; i++) {
    const tm = timings[i];
    renderer.drawAt(tm.start + tm.duration * 0.55);
    const cx = pad + (i % cols) * (thumbW + pad);
    const cy = pad + Math.floor(i / cols) * (thumbH + labelH + pad);
    ctx.drawImage(renderer.canvas, cx, cy, thumbW, thumbH);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.font = "600 13px Inter, system-ui, sans-serif";
    const title = `${String(i + 1).padStart(2, "0")} · ${project.plan.scenes[i].title}`.slice(0, 44);
    ctx.fillText(title, cx + 2, cy + thumbH + 17);
  }
  renderer.drawAt(0);
  return new Promise((resolve) => sheet.toBlob((b) => resolve(b), "image/png"));
}

/* ---------------- report ---------------- */
export function buildReport(project, extra = {}) {
  const { w, h, quality } = frameSize(project);
  return {
    generator: "ZTC AI Studio 3.1",
    generatedAt: new Date().toISOString(),
    project: { name: project.name, id: project.id },
    output: { width: w, height: h, fps: project.settings.fps, quality: quality.id, aspect: project.settings.aspect },
    durationSeconds: totalSeconds(project),
    scenes: (project.plan?.scenes || []).map((s, i) => ({
      index: i + 1,
      title: s.title,
      beat: s.beat,
      seconds: s.duration,
      motion: s.motion,
      transition: s.transition,
      imageProvider: s.provider?.image || "none",
      voiceProvider: s.provider?.voice || "none",
      hasImage: !!s.imageId,
      hasVoice: !!s.voiceId,
    })),
    style: project.settings.styleId,
    effects: project.settings.effects,
    music: { mood: project.settings.musicMood, generator: "built-in Web Audio composer", license: "MIT (this project)" },
    captions: project.settings.captions,
    limitations: [
      "Video is captured in real time from the browser canvas; export length equals video length.",
      "Free AI image providers are rate-limited and queued. Failures fall back automatically.",
      "Browser text-to-speech cannot be captured; a neural provider or your own endpoint is required for voice-over.",
      "Music is synthesised locally by this app; optional external models are not bundled.",
    ],
    ...extra,
  };
}

/* ---------------- bundles ---------------- */
export async function exportBundle({ project, renderer, videoBlob, videoExt = "webm", musicBlob = null }) {
  const entries = [];
  const base = slug(project.name);
  const clean = JSON.parse(JSON.stringify(project));
  entries.push({ name: `${base}/project.json`, data: JSON.stringify(clean, null, 2) });
  entries.push({ name: `${base}/brief.md`, data: `# ${project.plan.title || project.name}\n\n${project.brief.text}\n\n${project.plan.logline || ""}\n` });
  entries.push({ name: `${base}/script.md`, data: project.plan.script || "" });
  entries.push({ name: `${base}/captions.srt`, data: toSRT(project) });
  entries.push({ name: `${base}/captions.vtt`, data: toVTT(project) });
  entries.push({ name: `${base}/transcript.txt`, data: toPlainTranscript(project) });
  entries.push({ name: `${base}/report.json`, data: JSON.stringify(buildReport(project), null, 2) });

  try {
    const sheet = await contactSheet(renderer, project);
    if (sheet) entries.push({ name: `${base}/storyboard.png`, data: new Uint8Array(await sheet.arrayBuffer()) });
  } catch { /* sheet is optional */ }

  if (videoBlob) entries.push({ name: `${base}/video.${videoExt}`, data: new Uint8Array(await videoBlob.arrayBuffer()) });
  if (musicBlob) entries.push({ name: `${base}/audio/music.wav`, data: new Uint8Array(await musicBlob.arrayBuffer()) });

  const assets = await listAssets(project.id);
  const used = new Set((project.plan.scenes || []).flatMap((s) => [s.imageId, s.voiceId]).filter(Boolean));
  let n = 0;
  for (const a of assets) {
    if (!used.has(a.id) || !a.blob) continue;
    const ext = a.kind === "voice" ? "mp3" : a.mime.includes("png") ? "png" : "jpg";
    entries.push({ name: `${base}/media/${safeFileName(a.name || a.kind)}-${n++}.${ext}`, data: new Uint8Array(await a.blob.arrayBuffer()) });
    if (n >= 60) break;
  }

  entries.push({
    name: `${base}/README.txt`,
    data: [
      `ZTC AI Studio export — ${project.name}`,
      `Generated ${new Date().toISOString()}`,
      ``,
      `Contents: project.json (re-importable), script, captions, storyboard, media, report.`,
      `Re-import project.json with Studio → Import.`,
      `If the video is .webm and you need .mp4:`,
      `  ffmpeg -i video.webm -c:v libx264 -crf 20 -c:a aac -b:a 160k video.mp4`,
      ``,
      `Licensing: project code MIT. AI images are subject to the terms of the provider that`,
      `generated them (recorded per scene in report.json). Music is synthesised locally by`,
      `this app. Voice audio comes from the selected TTS provider — check its terms before`,
      `commercial use.`,
      ``,
      `Powered by Zeynar The Creator`,
    ].join("\n"),
  });

  return zipBlob(entries);
}

export function exportProjectJson(project) {
  const clean = JSON.parse(JSON.stringify(project));
  downloadBlob(new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" }), `${slug(project.name)}.ztc.json`);
}

/* ---------------- share ---------------- */
export function sharePayload(project) {
  return {
    v: 1,
    name: project.name,
    brief: project.brief,
    settings: project.settings,
    plan: { title: project.plan.title, logline: project.plan.logline, script: project.plan.script, scenes: project.plan.scenes.map((s) => ({ ...s, imageId: null, voiceId: null, voiceDur: 0, status: {}, provider: {} })) },
  };
}

export async function makeShareUrl(project) {
  const code = await encodeShare(sharePayload(project));
  if (code.length > 14000) throw new Error("This project is too detailed for a link. Export the project file instead.");
  const base = `${location.origin}${location.pathname}`;
  return `${base}#p=${code}`;
}

export async function readShareFromHash() {
  const m = location.hash.match(/[#&]p=([^&]+)/);
  if (!m) return null;
  const { decodeShare } = await import("./util.js");
  return decodeShare(m[1]);
}

/* ---------------- misc ---------------- */
export async function downloadAssetById(id, filename) {
  const a = await getAsset(id);
  if (!a?.blob) throw new Error("Asset not found");
  downloadBlob(a.blob, filename || a.name);
}

export function estimateRenderMinutes(project) {
  const total = totalSeconds(project);
  return total / 60;
}

export function exportZipBytes(entries) { return makeZip(entries); }

export { QUALITY };
