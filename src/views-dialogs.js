/* ZTC AI Studio — export, settings, providers, versions and help dialogs. */

import { activeProject, state, saveNow, snapshot, restoreVersion, deleteVersion, storageUsage, exportWorkspace, importWorkspace, clearProjectAssets, save } from "./store.js";
import { totalSeconds, buildCues, frameSize } from "./render.js";
import { recordVideo, exportBundle, toSRT, toVTT, contactSheet, makeShareUrl, buildReport, exportProjectJson, pickVideoType, videoSupported } from "./export.js";
import { studioRenderer, studioAudio } from "./views-studio.js";
import { LLM_PROVIDERS, IMAGE_PROVIDERS, VOICE_PROVIDERS, MUSIC_PROVIDERS, readiness, healthSnapshot, resetHealth } from "./providers.js";
import { probeLlm } from "./llm.js";
import { generateVoice } from "./media.js";
import { QUALITY } from "./catalog.js";
import { $, h, clear, fmtBytes, fmtTime, fmtClock, clamp, downloadText, downloadBlob, copyText } from "./util.js";
import { iconEl, field, tag, toast, openModal, closeModal, checkbox, selectEl, segmented, progressBlock, confirmDialog } from "./ui.js";

const section = (title, children, note = "") => h("section", { style: { marginBottom: "18px" } }, [
  h("h4", { text: title }),
  h("div", { class: "stack", style: { gap: "8px" } }, children),
  note ? h("p", { class: "note", text: note }) : null,
]);

/* ============================================================
   Export
   ============================================================ */
export function openExportDialog({ renderer } = {}) {
  const p = activeProject();
  if (!p) return;
  const r = renderer || studioRenderer();
  const audio = studioAudio();
  const total = totalSeconds(p);
  const scenes = p.plan.scenes;
  const missingVoice = scenes.filter((s) => !s.voiceId && s.narration).length;
  const missingArt = scenes.filter((s) => !s.imageId).length;
  const supported = videoSupported();
  const type = pickVideoType();
  let blob = null;
  let ext = type?.ext || "webm";
  let rendering = false;
  let ctl = null;

  const quality = selectEl(Object.values(QUALITY).map((q) => ({ value: q.id, label: `${q.label} · ${q.hint}` })), p.settings.quality, (v) => {
    p.settings.quality = v;
    save();
    updateEstimate();
  }, { ariaLabel: "Render quality" });

  const fpsSel = selectEl([{ value: "24", label: "24 fps" }, { value: "30", label: "30 fps" }, { value: "60", label: "60 fps" }], String(p.settings.fps || 30), (v) => { p.settings.fps = Number(v); save(); updateEstimate(); }, { ariaLabel: "Frame rate" });

  const estimate = h("p", { class: "render-note" });
  const progress = progressBlock("Ready");
  progress.el.hidden = true;

  const renderBtn = h("button", { class: "btn primary wide", type: "button", disabled: !supported, onclick: renderVideo }, [iconEl("film"), "Render video"]);
  const cancelBtn = h("button", { class: "btn danger wide", type: "button", hidden: true, onclick: () => { ctl?.abort(); } }, "Cancel render");
  const resultRow = h("div", { class: "row", style: { marginTop: "10px" } });

  const videoCard = h("div", { class: "panel", style: { padding: "12px" } }, [
    h("div", { class: "row between" }, [h("h3", { text: "Video" }), tag(type?.label || "not supported", supported ? "ok" : "bad")]),
    h("p", { class: "render-note", text: "Rendered frame by frame in your browser at real time, with the live audio mix. Keep this tab focused while it records." }),
    h("div", { class: "grid-2", style: { margin: "10px 0" } }, [field("Quality", quality), field("Frame rate", fpsSel)]),
    estimate,
    progress.el,
    renderBtn, cancelBtn, resultRow,
  ]);

  const actions = [
    h("button", { class: "export-opt", type: "button", onclick: () => downloadWav() }, [h("b", { text: "Audio mix (WAV)" }), h("span", { text: "Voice, music and transition sounds mixed down." }), tag("offline render", "info")]),
    h("button", { class: "export-opt", type: "button", onclick: () => downloadCaptions("srt") }, [h("b", { text: "Subtitles (SRT)" }), h("span", { text: "Timed captions for YouTube, Premiere, Resolve, CapCut." })]),
    h("button", { class: "export-opt", type: "button", onclick: () => downloadCaptions("vtt") }, [h("b", { text: "Subtitles (VTT)" }), h("span", { text: "Web player captions with the same cues." })]),
    h("button", { class: "export-opt", type: "button", onclick: () => downloadStoryboard() }, [h("b", { text: "Storyboard PNG" }), h("span", { text: "Contact sheet of every scene at the rendered frame." })]),
    h("button", { class: "export-opt", type: "button", onclick: () => downloadBundle() }, [h("b", { text: "Project bundle (ZIP)" }), h("span", { text: "Project JSON, script, captions, storyboard, media, report." })]),
    h("button", { class: "export-opt", type: "button", onclick: () => { exportProjectJson(p); toast("Project file downloaded", "ok"); } }, [h("b", { text: "Project file (.ztc.json)" }), h("span", { text: "Re-importable single file with the full timeline." })]),
    h("button", { class: "export-opt", type: "button", onclick: () => shareLink() }, [h("b", { text: "Share link" }), h("span", { text: "Compressed state in the URL — no assets, no upload." })]),
    h("button", { class: "export-opt", type: "button", onclick: () => downloadReport() }, [h("b", { text: "Render report (JSON)" }), h("span", { text: "Providers, seeds, durations, limitations." })]),
  ];

  const body = h("div", {}, [
    h("div", { class: "grid-2", style: { gridTemplateColumns: "minmax(0,1.15fr) minmax(0,1fr)", alignItems: "start" } }, [
      videoCard,
      h("div", {}, [
        h("h4", { text: "Downloads" }),
        h("div", { class: "export-grid" }, actions),
      ]),
    ]),
    missingArt || missingVoice
      ? h("p", { class: "note", style: { marginTop: "12px" } }, [
          missingArt ? `${missingArt} scene(s) have no image and will use generated procedural art. ` : "",
          missingVoice ? `${missingVoice} scene(s) have no voice-over — the video will still export with captions and music.` : "",
        ])
      : null,
    h("p", { class: "note", text: `Output: ${frameSize(p).w}×${frameSize(p).h} · ${p.settings.aspect} · ${fmtClock(total)} · ${scenes.length} scenes. Rendering takes about ${Math.ceil(total / 60)} minute(s).` }),
  ]);

  openModal({ title: "Export", subtitle: p.name, body, wide: true, onClose: () => { ctl?.abort(); } });
  updateEstimate();

  function updateEstimate() {
    const q = QUALITY[p.settings.quality] || QUALITY.standard;
    const est = `${frameSize(p).w}×${frameSize(p).h} · ~${q.bitrate / 1_000_000} Mbps · recording time ≈ ${fmtClock(total)}`;
    estimate.textContent = est;
  }

  async function renderVideo() {
    if (rendering) return;
    if (!scenes.length) { toast("Generate a plan first", "warn"); return; }
    rendering = true;
    ctl = new AbortController();
    renderBtn.hidden = true;
    cancelBtn.hidden = false;
    progress.el.hidden = false;
    progress.set(0, "Preparing…");
    try {
      if (audio) await audio.load(p);
      await r.prepare();
      const out = await recordVideo({
        renderer: r, audio, project: p, signal: ctl.signal,
        onProgress: (pct, t, totalSec) => {
          const eta = Math.max(0, totalSec - t);
          progress.set(pct, `Recording ${fmtClock(t)} of ${fmtClock(totalSec)} · ${Math.ceil(eta)}s left`);
        },
        onNotice: (msg) => toast(msg, "", 5000),
      });
      blob = out.blob;
      ext = out.ext;
      p.pipeline = p.pipeline || {};
      p.pipeline.render = { status: "done", at: Date.now(), file: `video.${ext}`, bytes: out.bytes };
      state.stats.renders = (state.stats.renders || 0) + 1;
      state.stats.lastRenderAt = Date.now();
      saveNow();
      progress.set(1, `Done · ${fmtBytes(out.bytes)}`);
      toast("Video rendered — downloading now", "ok");
      downloadBlob(blob, `${p.name.replace(/[^\w\- ]+/g, "").trim() || "ztc-video"}.${ext}`);
      resultRow.replaceChildren(
        h("button", { class: "btn primary", type: "button", onclick: () => downloadBlob(blob, `video.${ext}`) }, [iconEl("download"), "Download again"]),
        h("button", { class: "btn ghost", type: "button", onclick: () => downloadBundle() }, "Bundle with ZIP"),
      );
      if (out.aborted) toast("Render cancelled — partial file saved", "warn");
    } catch (e) {
      if (e?.name !== "AbortError") toast(String(e.message || e), "bad", 8000);
      progress.set(0, "Failed");
    } finally {
      rendering = false;
      renderBtn.hidden = false;
      cancelBtn.hidden = true;
      ctl = null;
    }
  }

  async function downloadWav() {
    if (!audio) { toast("Audio engine not ready", "bad"); return; }
    const t = toast("Rendering audio mix…", "", 0);
    try {
      await audio.load(p);
      const wav = await audio.renderMixWav(p);
      downloadBlob(wav, `${p.name || "ztc"}-mix.wav`);
      toast("Audio mix downloaded", "ok");
    } catch (e) { toast(String(e.message || e), "bad"); }
    t?.remove();
  }

  function downloadCaptions(kind) {
    const text = kind === "srt" ? toSRT(p) : toVTT(p);
    if (!buildCues(p).length) { toast("Captions are off or empty — enable them in Settings", "warn"); return; }
    downloadText(text, `${p.name || "ztc"}.${kind}`);
    toast(`${kind.toUpperCase()} downloaded`, "ok");
  }

  async function downloadStoryboard() {
    const t = toast("Rendering storyboard…", "", 0);
    try {
      const sheet = await contactSheet(r, p);
      downloadBlob(sheet, `${p.name || "ztc"}-storyboard.png`);
      toast("Storyboard downloaded", "ok");
    } catch (e) { toast(String(e.message || e), "bad"); }
    t?.remove();
  }

  async function downloadBundle() {
    const t = toast("Building project bundle…", "", 0);
    try {
      const zip = await exportBundle({ project: p, renderer: r, videoBlob: blob, videoExt: ext });
      downloadBlob(zip, `${p.name || "ztc"}-bundle.zip`);
      toast("Bundle downloaded", "ok");
    } catch (e) { toast(String(e.message || e), "bad"); }
    t?.remove();
  }

  async function shareLink() {
    try {
      const url = await makeShareUrl(p);
      await copyText(url);
      const body = h("div", { class: "share-box" }, [
        h("p", { class: "note", text: "Anyone with this link gets the brief, settings and storyboard. Media stays on your device and is regenerated on their side." }),
        h("input", { type: "text", value: url, readonly: true, onclick: (e) => e.target.select() }),
        h("div", { class: "row end" }, [h("button", { class: "btn", type: "button", text: "Copy again", onclick: () => copyText(url).then(() => toast("Copied", "ok")) })]),
      ]);
      openModal({ title: "Share project", body, narrow: true });
    } catch (e) { toast(String(e.message || e), "warn", 7000); }
  }

  function downloadReport() {
    const report = buildReport(p, { renders: state.stats.renders || 0, lastRenderAt: state.stats.lastRenderAt || null });
    downloadText(JSON.stringify(report, null, 2), `${p.name || "ztc"}-report.json`, "application/json");
    toast("Report downloaded", "ok");
  }
}

/* ============================================================
   Settings
   ============================================================ */
export function openSettings() {
  const p = activeProject();
  const tabs = ["Providers", "Voice & music", "Captions", "Workspace"];
  let tab = "Providers";
  const panel = h("div");

  const tabSeg = segmented(tabs.map((t) => ({ value: t, label: t })), tab, (v) => { tab = v; paint(); }, { ariaLabel: "Settings sections" });
  const body = h("div", {}, [tabSeg, h("div", { style: { marginTop: "14px" } }, [panel])]);
  openModal({ title: "Settings", subtitle: "Nothing is sent anywhere unless you press a generate button.", body, wide: true });
  paint();

  function paint() {
    clear(panel);
    if (tab === "Providers") panel.append(providersTab());
    if (tab === "Voice & music") panel.append(voiceTab());
    if (tab === "Captions") panel.append(captionsTab());
    if (tab === "Workspace") panel.append(workspaceTab());
  }

  function providersTab() {
    const wrap = h("div");
    wrap.append(
      section("Account-based services", [
        checkbox("Allow Puter for voice and chat (free account, no developer key)", state.settings.allowPuter !== false, (v) => { state.settings.allowPuter = v; saveNow(); }, "Puter uses your own free Puter allowance. Sign in once — a popup will open."),
        h("div", { class: "row" }, [
          h("button", { class: "btn sm", type: "button", onclick: async (e) => {
            if (!window.puter?.auth) { toast("Puter.js is blocked or offline", "bad"); return; }
            try { e.target.disabled = true; await window.puter.auth.signIn(); toast("Puter connected", "ok"); }
            catch (err) { toast(`Puter sign-in failed: ${err.message || err}`, "bad"); }
            finally { e.target.disabled = false; }
          } }, "Connect Puter"),
          h("button", { class: "btn sm ghost", type: "button", onclick: () => { state.settings.keys = {}; saveNow(); paint(); toast("Saved keys removed", "ok"); } }, "Clear all keys"),
        ]),
      ], "Keys are stored in this browser only. They are never bundled into the code or sent to any server except the provider you chose."),
      section("API keys (optional — free tiers)", LLM_PROVIDERS.filter((x) => x.kind === "key").map((prov) => {
        const input = h("input", {
          type: "password", value: state.settings.keys[prov.keyRef] || "", placeholder: `Paste your ${prov.name} key`, autocomplete: "off", spellcheck: false,
          oninput: (e) => { state.settings.keys[prov.keyRef] = e.target.value.trim(); save(); },
        });
        const status = h("span", { class: "tag", text: state.settings.keys[prov.keyRef] ? "set" : "not set" });
        const test = h("button", { class: "btn sm ghost", type: "button", text: "Test", onclick: async (e) => {
          e.target.disabled = true;
          try { const res = await probeLlm(prov, state.settings); toast(`${prov.name}: “${res.sample}” in ${res.ms} ms`, "ok"); status.textContent = "ok"; status.className = "tag ok"; }
          catch (err) { toast(`${prov.name}: ${String(err.message || err).slice(0, 120)}`, "bad", 6000); status.textContent = "failed"; status.className = "tag bad"; }
          finally { e.target.disabled = false; }
        } });
        return h("div", { class: "card" }, [
          h("div", { class: "row between" }, [h("b", { class: "small", text: prov.name }), status]),
          h("div", { class: "row nowrap", style: { marginTop: "6px" } }, [input, test]),
          h("div", { class: "tiny faint", text: prov.note }),
        ]);
      }), "Keyless routes (OVHcloud, Pollinations, Kilo, LLMFaucet, G4F, AI Horde) are always tried first and need no keys."),
      section("Self-hosted endpoints", [
        field("Voice-over endpoint (Piper / Kokoro)", h("input", { type: "url", value: state.settings.ttsEndpoint, placeholder: "https://localhost:8880/v1/audio/speech", oninput: (e) => { state.settings.ttsEndpoint = e.target.value.trim(); save(); } }), "POST { text, voice } → audio bytes. Runs offline on your machine."),
        field("Endpoint token (optional)", h("input", { type: "password", value: state.settings.ttsEndpointToken, autocomplete: "off", oninput: (e) => { state.settings.ttsEndpointToken = e.target.value.trim(); save(); } })),
        field("Music endpoint (MusicGen / Stable Audio)", h("input", { type: "url", value: state.settings.musicEndpoint, placeholder: "https://localhost:7860/generate", oninput: (e) => { state.settings.musicEndpoint = e.target.value.trim(); save(); } }), "Check the model licence before commercial use."),
        field("AI Horde anonymous key", h("input", { type: "text", value: state.settings.hordeKey || "0000000000", oninput: (e) => { state.settings.hordeKey = e.target.value.trim(); save(); } }), "0000000000 is the public anonymous key. A personal key raises your queue priority."),
        field("Cloudflare account id", h("input", { type: "text", value: state.settings.cloudflareAccountId || "", oninput: (e) => { state.settings.cloudflareAccountId = e.target.value.trim(); save(); } })),
      ]),
      section("CORS relay (optional)", [
        checkbox("Route provider calls through my relay", state.settings.relayEnabled, (v) => { state.settings.relayEnabled = v; saveNow(); }, "Only needed when a provider blocks browser requests. The relay never adds credentials of its own."),
        field("Relay URL", h("input", { type: "url", value: state.settings.relayUrl || "", placeholder: "https://your-project.vercel.app/api/relay", oninput: (e) => { state.settings.relayUrl = e.target.value.trim(); save(); } })),
        field("Relay token", h("input", { type: "password", value: state.settings.relayToken || "", autocomplete: "off", oninput: (e) => { state.settings.relayToken = e.target.value.trim(); save(); } })),
        h("div", { class: "row" }, [
          h("button", { class: "btn sm ghost", type: "button", onclick: async (e) => {
            e.target.disabled = true;
            try {
              const health = await fetch(`${state.settings.relayUrl.replace(/\/$/, "")}?health=1`, { cache: "no-store" });
              if (!health.ok) throw new Error(`HTTP ${health.status}`);
              const j = await health.json();
              if (!j.ok) throw new Error("health check failed");
              toast("Relay reachable — provider calls will be proxied", "ok");
            } catch (err) { toast(`Relay test failed: ${err.message}`, "bad"); }
            finally { e.target.disabled = false; }
          } }, "Test relay"),
        ]),
      ], "Deploy api/relay.js (Vercel) or run server.mjs with RELAY_TOKEN. The bundled server also serves the static app."),
      section("Provider health", [
        h("div", { class: "row between" }, [
          h("span", { class: "small muted", text: `${healthSnapshot().filter((x) => x.ok || x.fail).length} providers used this session` }),
          h("button", { class: "btn sm ghost", type: "button", text: "Reset health", onclick: () => { resetHealth(); paint(); toast("Health reset", "ok"); } }),
        ]),
        h("div", { class: "table-wrap" }, [healthTable()]),
      ]),
    );
    return wrap;
  }

  function voiceTab() {
    return h("div", {}, [
      section("Voice-over", [
        field("Default voice", selectEl(
          [{ value: "Joanna", label: "Joanna · warm female" }, { value: "Matthew", label: "Matthew · calm male" }, { value: "Amy", label: "Amy · UK female" }, { value: "Brian", label: "Brian · UK male" }, { value: "Emma", label: "Emma · UK female" }, { value: "Olivia", label: "Olivia · AU female" }],
          p.settings.voice,
          (v) => { p.settings.voice = v; save(); },
        )),
        field("Voice volume", rangeInput(0, 1.5, 0.05, p.settings.voiceVolume, (v) => { p.settings.voiceVolume = v; save(); })),
        h("div", { class: "row" }, [
          h("button", { class: "btn sm", type: "button", onclick: async (e) => {
            e.target.disabled = true;
            const t = toast("Testing voice…", "", 0);
            try {
              const r = await generateVoice({ text: "ZTC Studio voice check. One, two, three.", voice: p.settings.voice, settings: state.settings });
              const a = new Audio(URL.createObjectURL(r.blob));
              await a.play();
              toast(`Voice ok · ${r.providerName}`, "ok");
            } catch (err) { toast(`Voice test failed: ${String(err.message || err).slice(0, 150)}`, "bad", 7000); }
            t?.remove(); e.target.disabled = false;
          } }, [iconEl("mic"), "Test voice"]),
        ]),
      ], "Order: Puter neural voices → StreamElements → your own endpoint. If all fail, the video still exports with captions; nothing is silently faked."),
      section("Music", [
        field("Mood", selectEl(
          [["cinematic", "Cinematic"], ["ambient", "Ambient"], ["lofi", "Lo-fi"], ["synthwave", "Synthwave"], ["tension", "Tension"], ["uplifting", "Uplifting"], ["minimal", "Minimal"], ["none", "None"]].map(([v, l]) => ({ value: v, label: l })),
          p.settings.musicMood,
          (v) => { p.settings.musicMood = v; save(); },
        )),
        field("Music volume", rangeInput(0, 1, 0.01, p.settings.musicVolume, (v) => { p.settings.musicVolume = v; save(); })),
        checkbox("Transition whooshes", p.settings.sfx !== false, (v) => { p.settings.sfx = v; save(); }),
      ], "The built-in composer synthesises chords, bass, arpeggio and drums with Web Audio — no samples, no licence issues, works offline."),
      section("Branding", [
        field("Brand name (watermark)", h("input", { type: "text", value: p.settings.branding.name || p.name, oninput: (e) => { p.settings.branding.name = e.target.value; save(); } })),
        field("Tagline", h("input", { type: "text", value: p.settings.branding.tagline || "", oninput: (e) => { p.settings.branding.tagline = e.target.value; save(); } })),
        h("div", { class: "grid-2" }, [
          field("Accent colour", h("input", { type: "color", value: p.settings.branding.color || "#ff304f", style: { height: "38px", padding: "3px" }, oninput: (e) => { p.settings.branding.color = e.target.value; save(); } })),
          field("Preset", selectEl(
            [{ value: "redline", label: "Redline" }, { value: "editorial", label: "Editorial" }, { value: "neon", label: "Neon Lab" }, { value: "minimal", label: "Minimal" }, { value: "bold", label: "Bold Drop" }],
            p.settings.branding.presetId, (v) => { p.settings.branding.presetId = v; save(); },
          )),
        ]),
        checkbox("Watermark", p.settings.branding.watermark, (v) => { p.settings.branding.watermark = v; save(); }),
        checkbox("Intro title card", p.settings.branding.intro, (v) => { p.settings.branding.intro = v; save(); }),
        checkbox("Outro card", p.settings.branding.outro, (v) => { p.settings.branding.outro = v; save(); }),
      ]),
    ]);
  }

  function captionsTab() {
    return h("div", {}, [
      section("Captions", [
        checkbox("Burn captions into the video", p.settings.captions.enabled, (v) => { p.settings.captions.enabled = v; save(); }),
        field("Position", selectEl([{ value: "bottom", label: "Lower third" }, { value: "middle", label: "Centre" }, { value: "top", label: "Upper third" }], p.settings.captions.position, (v) => { p.settings.captions.position = v; save(); })),
        field("Style", selectEl([{ value: "bar", label: "Solid bar" }, { value: "clean", label: "Clean with shadow" }, { value: "neon", label: "Neon glow" }], p.settings.captions.style, (v) => { p.settings.captions.style = v; save(); })),
        field("Max characters per line", rangeInput(32, 96, 2, p.settings.captions.maxChars, (v) => { p.settings.captions.maxChars = Math.round(v); save(); }), "Cues break on sentence and word boundaries, then are timed to the scene duration."),
      ], "Captions are burned in and also exported as SRT/VTT. They are on by default for accessibility."),
      section("Rendering", [
        field("Quality preset", selectEl(Object.values(QUALITY).map((q) => ({ value: q.id, label: `${q.label} — ${q.hint}` })), p.settings.quality, (v) => { p.settings.quality = v; save(); })),
        field("Aspect ratio", selectEl(Object.entries({ "16:9": "16:9 landscape", "9:16": "9:16 vertical", "1:1": "1:1 square", "4:5": "4:5 portrait", "21:9": "21:9 scope" }).map(([v, l]) => ({ value: v, label: l })), p.settings.aspect, (v) => { p.settings.aspect = v; p.brief.aspect = v; save(); })),
        checkbox("Add the 3D mesh layer", (p.settings.effects || []).includes("mesh3d"), (v) => {
          const set = new Set(p.settings.effects || []);
          if (v) set.add("mesh3d"); else set.delete("mesh3d");
          p.settings.effects = [...set];
          save();
        }),
        checkbox("Reduce motion (no ambient animation)", state.settings.reduceMotion, (v) => { state.settings.reduceMotion = v; document.documentElement.classList.toggle("reduce-motion", v); saveNow(); }),
      ]),
    ]);
  }

  function workspaceTab() {
    return h("div", {}, [
      section("This device", [
        h("p", { class: "note", text: "Projects, settings and keys live in localStorage; images and audio live in IndexedDB. Nothing is uploaded. Export a workspace backup before clearing browser data." }),
        h("div", { class: "row" }, [
          h("button", { class: "btn sm", type: "button", onclick: () => {
            downloadBlob(new Blob([JSON.stringify(exportWorkspace(), null, 2)], { type: "application/json" }), "ztc-workspace.json");
            toast("Workspace exported (keys removed)", "ok");
          } }, [iconEl("download"), "Export workspace"]),
          h("button", { class: "btn sm", type: "button", onclick: () => $("fileImport").click() }, [iconEl("upload"), "Import workspace"]),
          h("button", { class: "btn sm ghost", type: "button", onclick: () => { const url = `${location.origin}${location.pathname}`; location.href = url; } }, "Reload app"),
        ]),
      ]),
      section("Reference", [
        h("div", { class: "row" }, [
          h("button", { class: "btn sm ghost", type: "button", onclick: () => { closeModal(); openProviders(); } }, "Provider registry"),
          h("button", { class: "btn sm ghost", type: "button", onclick: () => { closeModal(); openHelp(); } }, "Shortcuts & limits"),
          h("button", { class: "btn sm ghost", type: "button", onclick: () => { closeModal(); openVersions(); } }, "Versions"),
        ]),
      ]),
      section("Danger zone", [
        h("div", { class: "row" }, [
          h("button", { class: "btn sm danger", type: "button", onclick: async () => {
            const ok = await confirmDialog({
              title: "Clear project media?",
              message: "Every generated image and voice-over for this project will be deleted. The brief, plan and settings are kept, and Repair can regenerate the media.",
              okLabel: "Clear media",
              danger: true,
            });
            if (!ok) return;
            const n = await clearProjectAssets(p.id);
            p.plan.scenes.forEach((s) => { s.imageId = null; s.voiceId = null; s.voiceDur = 0; s.status = {}; s.provider = {}; });
            saveNow();
            toast(`${n} media file(s) removed`, "ok");
          } }, "Clear project media"),
        ]),
        h("p", { class: "tiny faint", text: "Storage is local to this browser profile only." }),
      ]),
    ]);
  }

  function healthTable() {
    const rows = healthSnapshot();
    if (!rows.length) return h("p", { class: "note", text: "No provider has been used yet in this session." });
    return h("table", {}, [
      h("thead", {}, [h("tr", {}, ["Provider", "OK", "Fail", "Last ms", "Status"].map((t) => h("th", { text: t })))]),
      h("tbody", {}, rows.map((row) => {
        const prov = LLM_PROVIDERS.find((x) => x.id === row.id);
        return h("tr", {}, [
          h("td", { text: prov?.name || row.id }),
          h("td", { class: "mono", text: String(row.ok) }),
          h("td", { class: "mono", text: String(row.fail) }),
          h("td", { class: "mono", text: row.lastMs ? String(row.lastMs) : "—" }),
          h("td", { class: "mono", text: row.cooling ? "cooling" : row.lastError ? "error" : "ok" }),
        ]);
      })),
    ]);
  }
}

function rangeInput(min, max, step, value, onChange) {
  const out = h("span", { class: "mono small", text: String(value) });
  const input = h("input", { type: "range", min, max, step, value, oninput: (e) => { const v = Number(e.target.value); out.textContent = String(v); onChange(v); } });
  return h("div", {}, [h("div", { class: "row between" }, [input, out])]);
}

/* ============================================================
   Providers
   ============================================================ */
export function openProviders() {
  const list = (providers, settings) => h("div", { class: "modal-list" }, providers.map((prov) => {
    const r = readiness(prov, settings);
    return h("div", { class: "card" }, [
      h("div", { class: "row between" }, [
        h("b", { class: "small", text: prov.name }),
        h("div", { class: "row gap-4" }, [tag(prov.kind, prov.kind === "keyless" ? "ok" : prov.kind === "local" ? "info" : ""), tag(r.why, r.ready ? "ok" : "warn")]),
      ]),
      h("p", { class: "tiny muted", style: { marginTop: "4px" }, text: prov.note }),
      prov.license ? h("p", { class: "tiny faint", text: `Licence: ${prov.license}` }) : null,
    ]);
  }));

  const body = h("div", {}, [
    h("p", { class: "note", text: "Every capability resolves through this registry. The router sorts by health, skips providers in cooldown, and records each switch in the provider log." }),
    h("h4", { text: "Text / planning" }),
    h("div", { class: "table-wrap" }, [
      h("table", {}, [
        h("thead", {}, [h("tr", {}, ["Provider", "Type", "Status", "Model"].map((t) => h("th", { text: t })))]),
        h("tbody", {}, LLM_PROVIDERS.map((prov) => {
          const r = readiness(prov, state.settings);
          return h("tr", {}, [
            h("td", { text: prov.name }),
            h("td", { class: "mono", text: prov.kind }),
            h("td", { class: "mono", text: r.why }),
            h("td", { class: "mono", text: prov.model }),
          ]);
        })),
      ]),
    ]),
    h("h4", { text: "Images" }), list(IMAGE_PROVIDERS, state.settings),
    h("h4", { text: "Voice" }), list(VOICE_PROVIDERS, state.settings),
    h("h4", { text: "Music" }), list(MUSIC_PROVIDERS, state.settings),
    h("p", { class: "note", text: "Licensing: AI images belong to the provider that generated them and follow its terms. Music from the built-in composer is original synthesis (MIT). Optional external models are never bundled — MusicGen weights are non-commercial, Stable Audio Open has its own terms." }),
  ]);
  openModal({ title: "Provider registry", body, wide: true });
}

/* ============================================================
   Versions
   ============================================================ */
export function openVersions() {
  const p = activeProject();
  const body = h("div", {});
  const render = () => {
    clear(body);
    body.append(
      h("div", { class: "row between", style: { marginBottom: "10px" } }, [
        h("p", { class: "note", text: `${p.versions.length} saved version(s). Snapshots keep the brief, settings and storyboard; media is shared and never duplicated.` }),
        h("button", { class: "btn sm primary", type: "button", onclick: () => { snapshot("Manual save", p); saveNow(); render(); toast("Version saved", "ok"); } }, "Save version"),
      ]),
    );
    if (!p.versions.length) {
      body.append(h("p", { class: "note", text: "No versions yet. A snapshot is taken automatically before each generation." }));
      return;
    }
    body.append(h("div", { class: "modal-list" }, p.versions.map((v) => h("div", { class: "card" }, [
      h("div", { class: "row between" }, [
        h("b", { class: "small", text: v.name }),
        h("span", { class: "mono tiny muted", text: new Date(v.at).toLocaleString() }),
      ]),
      h("div", { class: "tiny muted", text: `${v.data?.plan?.scenes?.length || 0} scenes · ${v.data?.settings?.aspect || "16:9"} · ${v.data?.settings?.styleId || ""}` }),
      h("div", { class: "row gap-4", style: { marginTop: "8px" } }, [
        h("button", { class: "btn sm", type: "button", text: "Restore", onclick: () => {
          restoreVersion(v.id, p);
          p.plan.script = p.plan.script || "";
          saveNow();
          render();
          toast("Version restored", "ok");
        } }),
        h("button", { class: "btn sm danger", type: "button", text: "Delete", onclick: () => { deleteVersion(v.id, p); render(); } }),
      ]),
    ]))));
  };
  render();
  openModal({ title: "Versions", subtitle: p.name, body, wide: false });
}

/* ============================================================
   Help
   ============================================================ */
export function openHelp() {
  const rows = [
    ["⌘/Ctrl + K", "Command palette"],
    ["1 – 5", "Switch view (Studio, Storyboard, Timeline, Assets, Chat)"],
    ["Space", "Play / pause the preview"],
    ["⌘/Ctrl + Enter", "Generate plan + assets"],
    ["⌘/Ctrl + S", "Save a version"],
    ["⌘/Ctrl + E", "Open export"],
    ["Alt + ← / →", "Move the focused scene"],
    ["Esc", "Close dialog"],
  ];
  const body = h("div", {}, [
    h("h4", { text: "Keyboard" }),
    h("div", { class: "table-wrap" }, [h("table", {}, [
      h("tbody", {}, rows.map(([k, v]) => h("tr", {}, [h("td", { class: "mono", text: k }), h("td", { text: v })]))),
    ])]),
    h("h4", { text: "What is real, and what is not" }),
    h("ul", { class: "note", style: { paddingLeft: "18px", lineHeight: "1.7" } }, [
      h("li", { text: "Video is recorded from the live canvas with MediaRecorder — the file matches the preview." }),
      h("li", { text: "Images come from AI Horde → Pollinations → a built-in procedural renderer. The last one always works offline." }),
      h("li", { text: "Voice-over comes from Puter (free account) → StreamElements → your own Piper/Kokoro endpoint. Browser speech is preview-only and never recorded." }),
      h("li", { text: "Music is synthesised locally (chords, bass, arpeggio, drums). No samples, no licensing risk." }),
      h("li", { text: "AI text planning is optional: without a working LLM the built-in template writer still produces a complete script and shot list." }),
      h("li", { text: "No feature is simulated: if a provider fails, the app says so and uses the documented fallback." }),
    ]),
    h("h4", { text: "Known limits" }),
    h("ul", { class: "note", style: { paddingLeft: "18px", lineHeight: "1.7" } }, [
      h("li", { text: "Recording runs in real time: a 5-minute video takes about 5 minutes. Keep the tab focused." }),
      h("li", { text: "Free image tiers are rate-limited and queued; a 12-scene video can take several minutes." }),
      h("li", { text: "Motion is 2.5D (camera moves, parallax, effects), not generative full motion. True text-to-video needs a paid/GPU model — documented in docs/EXTENDING.md." }),
      h("li", { text: "WebM output is converted to MP4 with one ffmpeg command (shown in every bundle README)." }),
    ]),
    h("p", { class: "note", text: "Powered by Zeynar The Creator · ZTC AI Studio 3.1 · MIT" }),
  ]);
  openModal({ title: "Shortcuts & limits", body, wide: true });
}
