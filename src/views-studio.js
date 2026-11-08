/* ZTC AI Studio — Studio view: brief, live preview, staged production. */

import { activeProject, state, save, touch, snapshot, scenesOf } from "./store.js";
import { Renderer, totalSeconds, frameSize } from "./render.js";
import { AudioEngine } from "./audio.js";
import { pipeline, runPipeline, runPlan, runAssets, pipelineSummary, stageStatus } from "./pipeline.js";
import { ASPECTS, STYLES, TEMPLATES, MOODS, VOICES, QUALITY, MOTIONS, TRANSITIONS, TONES } from "./catalog.js";
import { $, h, clear, fmtClock, fmtTime, clamp, copyText, titleCase } from "./util.js";
import { field, icon, iconEl, toast, emptyState, progressBlock, segmented, selectEl, tag, setStatus, setProviderPill, openModal } from "./ui.js";
import { openExportDialog } from "./views-dialogs.js";

const S = {
  built: false,
  renderer: null,
  audio: null,
  canvas: null,
  refs: {},
  playing: false,
  playhead: 0,
  busy: false,
};

const EXAMPLES = [
  { label: "Product launch", text: "Launch video for a matte-black ceramic coffee mug with a magnetic lid, aimed at design-conscious commuters. Show the lid mechanism and the weight in hand.", template: "product" },
  { label: "Explain a concept", text: "Explain why vector databases matter for AI search, for developers who already know SQL. Use one concrete example and no marketing language.", template: "explainer" },
  { label: "Travel reel", text: "A 45-second travel reel for Lisbon in November: wet tram tracks, tiled facades, early light, quiet streets before the crowds.", template: "travel" },
];

export function mountStudio(root) {
  if (S.built) { refreshStudio(); return; }
  S.built = true;
  clear(root);

  const project = activeProject();
  const side = h("div", { class: "studio-side" });
  const main = h("div", { class: "studio-main" });

  /* ---------- brief panel ---------- */
  const ta = h("textarea", {
    id: "briefText", rows: 5, maxlength: 4000, spellcheck: true,
    placeholder: "Describe the video in a sentence or two. Subject, audience, and the feeling you want. Then generate a plan.",
    "aria-label": "Video brief",
    oninput: () => {
      const p = activeProject(); if (!p) return;
      p.brief.text = ta.value;
      counter.textContent = `${ta.value.length} / 4000`;
      save();
      refreshStages();
    },
    onblur: () => { if (ta.value.trim() && !activeProject()?.name.includes("·")) autoName(); },
  });
  const counter = h("span", { class: "muted", text: "0 / 4000" });

  const examples = h("div", { class: "template-row" },
    EXAMPLES.map((ex) => h("button", {
      class: "chip", type: "button", text: ex.label,
      onclick: () => {
        ta.value = ex.text;
        const p = activeProject();
        p.brief.text = ex.text;
        p.brief.template = ex.template;
        const tpl = TEMPLATES.find((t) => t.id === ex.template);
        if (tpl) { p.brief.styleId = tpl.style; p.settings.styleId = tpl.style; p.settings.musicMood = tpl.mood; }
        save(); refreshStudio();
        toast("Example loaded — edit it or generate a plan", "ok");
      },
    })));

  const tplRow = h("div", { class: "template-row", role: "group", "aria-label": "Narrative template" },
    TEMPLATES.map((t) => h("button", {
      class: "chip", type: "button", text: t.name, title: t.blurb,
      "data-template": t.id,
      onclick: () => {
        const p = activeProject();
        p.brief.template = t.id;
        p.brief.styleId = t.style;
        p.settings.styleId = t.style;
        p.settings.musicMood = t.mood;
        p.brief.tone = t.tone;
        save(); refreshStudio();
      },
    }))
  );

  const toneSel = selectEl(TONES.map((t) => ({ value: t, label: titleCase(t) })), project.brief.tone, (v) => { activeProject().brief.tone = v; save(); }, { ariaLabel: "Tone" });
  const audience = h("input", { type: "text", value: project.brief.audience || "", placeholder: "e.g. first-time buyers", maxlength: 90, "aria-label": "Audience", oninput: () => { activeProject().brief.audience = audience.value; save(); } });

  const durOut = h("span", { class: "duration-value", text: fmtTime(project.brief.duration) });
  const dur = h("input", {
    type: "range", min: 60, max: 300, step: 15, value: project.brief.duration,
    "aria-label": "Target duration in seconds",
    oninput: () => { durOut.textContent = fmtTime(dur.value); activeProject().brief.duration = Number(dur.value); activeProject().settings.duration = Number(dur.value); save(); },
  });
  const durPresets = h("div", { class: "row gap-4" }, [60, 120, 180, 300].map((s) => h("button", {
    class: "chip", type: "button", text: fmtTime(s), "data-dur": s,
    onclick: () => { dur.value = s; dur.dispatchEvent(new Event("input")); },
  })));

  const qty = h("input", { type: "number", min: 1, max: 10, step: 1, value: project.settings.quantity || 1, "aria-label": "Batch quantity", onchange: () => { activeProject().settings.quantity = clamp(Number(qty.value) || 1, 1, 10); qty.value = activeProject().settings.quantity; save(); } });
  const variants = h("input", { type: "number", min: 1, max: 5, step: 1, value: project.settings.variants || 1, "aria-label": "Style variants", onchange: () => { activeProject().settings.variants = clamp(Number(variants.value) || 1, 1, 5); variants.value = activeProject().settings.variants; save(); } });

  const aspectSeg = segmented(
    Object.values(ASPECTS).map((a) => ({ value: a.id, label: a.id, hint: `${a.hint} · ${a.w}×${a.h}` })),
    project.settings.aspect,
    (v) => { const p = activeProject(); p.settings.aspect = v; p.brief.aspect = v; save(); touch(p); refreshStudio(); renderFrame(); },
    { ariaLabel: "Aspect ratio" }
  );

  const styleSel = selectEl(STYLES.map((s) => ({ value: s.id, label: s.name })), project.settings.styleId, (v) => {
    const p = activeProject();
    p.settings.styleId = v; p.brief.styleId = v;
    const st = STYLES.find((s) => s.id === v);
    if (st) { p.settings.effects = [...st.effects]; p.settings.transition = st.transition; p.settings.musicMood = st.music; }
    save(); refreshStudio(); renderFrame();
  }, { ariaLabel: "Visual style" });

  const voiceSel = selectEl(VOICES.map((v) => ({ value: v.id, label: v.label })), project.settings.voice, (v) => { activeProject().settings.voice = v; save(); }, { ariaLabel: "Narration voice" });

  const moodSel = selectEl(Object.entries(MOODS).map(([k, m]) => ({ value: k, label: m.label })), project.settings.musicMood, (v) => { activeProject().settings.musicMood = v; save(); refreshStages(); }, { ariaLabel: "Music mood" });

  const modelSel = selectEl([
    { value: "Flux.1-Schnell fp8 (Compact)", label: "Flux.1 Schnell" },
    { value: "Z-Image-Turbo", label: "Z-Image Turbo" },
    { value: "Juggernaut XL", label: "Juggernaut XL" },
    { value: "SDXL 1.0", label: "SDXL 1.0" },
    { value: "Realistic Vision", label: "Realistic Vision" },
    { value: "DreamShaper XL", label: "DreamShaper XL" },
    { value: "Anything v5", label: "Anything v5" },
  ], project.settings.imageModel, (v) => { activeProject().settings.imageModel = v; save(); }, { ariaLabel: "Image model" });

  const btnPlan = h("button", { class: "btn primary wide", type: "button", onclick: () => start("plan") }, [iconEl("wand"), "Generate plan"]);
  const btnProduce = h("button", { class: "btn wide", type: "button", onclick: () => start("all") }, [iconEl("bolt"), "Auto-produce"]);
  const btnBatch = h("button", { class: "btn wide", type: "button", onclick: openBatch }, [iconEl("layers"), "Batch produce"]);
  const btnStop = h("button", { class: "btn danger wide", type: "button", hidden: true, onclick: () => { pipeline.abort(); } }, [iconEl("stop"), "Stop"]);

  const briefBody = h("div", { class: "panel-body brief" }, [
    ta,
    h("div", { class: "brief-meta" }, [h("span", { text: "Brief" }), counter]),
    examples,
    h("div", { class: "field", style: { marginBottom: "0" } }, [h("label", { text: "Narrative template" }), tplRow]),
    h("div", { class: "grid-2" }, [field("Tone", toneSel), field("Audience", audience)]),
    h("div", { class: "field" }, [
      h("div", { class: "row between" }, [h("label", { text: "Target duration" }), durOut]),
      dur, durPresets,
      h("div", { class: "hint", text: "1–5 minutes. Scene count and pacing adapt automatically." }),
    ]),
    h("div", { class: "grid-2" }, [
      field("Quantity", qty, "Videos to produce (1–10)"),
      field("Options", variants, "Style/model variants (1–5)"),
    ]),
    h("div", { class: "field" }, [h("label", { text: "Aspect ratio" }), aspectSeg]),
    h("div", { class: "grid-2" }, [field("Visual style", styleSel), field("Voice", voiceSel)]),
    h("div", { class: "grid-2" }, [field("Music", moodSel), field("Image model", modelSel)]),
    h("div", { class: "row gap-6", style: { marginTop: "4px" } }, [btnPlan, btnProduce]),
    h("div", { class: "row gap-6" }, [btnBatch]),
    btnStop,
  ]);

  const briefPanel = h("section", { class: "panel", "aria-label": "Video brief" }, [
    h("div", { class: "panel-head" }, [
      h("h3", { text: "Brief" }),
      h("span", { class: "spacer" }),
      tag("free-first", "info"),
    ]),
    briefBody,
  ]);

  /* ---------- preview ---------- */
  const canvas = h("canvas", { id: "previewCanvas", role: "img", "aria-label": "Video preview" });
  S.canvas = canvas;
  const idle = h("div", { class: "preview-idle" }, [
    h("h3", { text: "Your film starts here" }),
    h("p", { text: "Write a brief, generate a plan, then produce images and voice-over. Everything runs on free providers first, and degrades gracefully when they are busy." }),
    h("button", { class: "btn primary", type: "button", onclick: () => start("all") }, [iconEl("spark"), "Generate everything"]),
  ]);
  const badges = h("div", { class: "preview-badge" });
  const preview = h("div", { class: "preview" }, [canvas, badges, idle]);

  const playBtn = h("button", { class: "play-btn", type: "button", "aria-label": "Play preview", onclick: togglePlay }, [iconEl("play")]);
  const scrub = h("input", { type: "range", min: 0, max: 1000, value: 0, step: 1, "aria-label": "Timeline position", oninput: () => { pause(); const total = totalSeconds(activeProject()); seekTo((Number(scrub.value) / 1000) * total); } });
  const tcNow = h("b", { text: "00:00.0" });
  const tcTotal = h("span", { text: "00:00.0" });
  const timecode = h("div", { class: "timecode" }, [tcNow, " / ", tcTotal]);
  const transport = h("div", { class: "transport" }, [playBtn, h("div", { class: "scrub" }, [scrub]), timecode]);

  const stats = h("div", { class: "proj-stats" });

  /* ---------- pipeline ---------- */
  const stageList = h("div", { class: "pipeline" });
  const progress = progressBlock("Idle");
  progress.el.hidden = true;
  const runlog = h("div", { class: "runlog", role: "log", "aria-live": "polite" }, [h("div", { class: "lg info" }, [h("time", { text: "—" }), h("span", { text: "provider log appears here during generation" })])]);

  const pipelinePanel = h("section", { class: "panel", "aria-label": "Production pipeline" }, [
    h("div", { class: "panel-head" }, [
      h("h3", { text: "Production" }),
      h("span", { class: "spacer" }),
      h("button", { class: "btn sm ghost", type: "button", title: "Regenerate only what is missing", onclick: () => runStageAssets(true, true), text: "Repair" }),
      h("button", {
        class: "btn sm ghost", type: "button", title: "Copy the provider log",
        onclick: async () => {
          const text = pipeline.log.map((e) => `${new Date(e.at).toISOString()} [${e.level}] ${e.text}`).join("\n");
          const ok = await copyText(text || "no log entries yet");
          toast(ok ? "Provider log copied" : "Copy failed", ok ? "ok" : "bad");
        }, text: "Log",
      }),
      h("button", { class: "btn sm ghost", type: "button", onclick: () => openExportDialog({ renderer: S.renderer }), text: "Export" }),
    ]),
    h("div", { class: "panel-body", style: { display: "grid", gap: "10px" } }, [progress.el, stageList, runlog]),
  ]);

  main.append(h("div", { class: "preview-wrap" }, [preview, transport, stats]), pipelinePanel);
  side.append(briefPanel);
  root.append(h("div", { class: "studio" }, [side, main]));

  S.refs = { ta, counter, examples, tplRow, toneSel, audience, dur, durOut, qty, variants, aspectSeg, styleSel, voiceSel, moodSel, modelSel, playBtn, scrub, tcNow, tcTotal, badges, idle, stats, stageList, progress, runlog, btnPlan, btnProduce, btnBatch, btnStop };

  S.renderer = new Renderer(canvas);
  S.audio = new AudioEngine();
  S.start = start;
  pipeline.subscribe((entry, log) => {
    paintLog(log);
    refreshStages();
  });

  refreshStudio();
  refreshStages();
  paintLog(pipeline.log);
  requestAnimationFrame(() => { renderFrame(); });

  /* ---------- functions ---------- */
  function autoName() {
    const p = activeProject();
    if (!p) return;
    if (p.name.startsWith("Untitled") || p.name === "First project") {
      const first = p.brief.text.split(/[.!?\n]/)[0].trim().slice(0, 60);
      p.name = (first.charAt(0).toUpperCase() + first.slice(1)) || p.name;
      const input = $("projectName");
      if (input) input.value = p.name;
      save();
    }
  }

  function renderFrame() {
    const p = activeProject();
    if (!p || !S.renderer) return;
    S.renderer.setProject(p);
    // Draw immediately with procedural art so the stage is never a black hole,
    // then swap in the generated stills once they are decoded.
    S.renderer.drawAt(Math.min(S.playhead, Math.max(0, totalSeconds(p) - 0.01)));
    S.renderer.prepare().then(() => {
      S.renderer.drawAt(Math.min(S.playhead, Math.max(0, totalSeconds(p) - 0.01)));
    }).catch(() => {});
    const total = totalSeconds(p);
    S.refs.tcTotal.textContent = fmtClock(total);
    S.refs.scrub.max = 1000;
    S.refs.scrub.value = total ? (S.playhead / total) * 1000 : 0;
    S.refs.idle.hidden = total > 0;
    S.refs.badges.replaceChildren(
      tag(`${p.settings.aspect}`, "info"),
      tag(`${frameSize(p).w}×${frameSize(p).h}`),
      tag(`${p.settings.fps} fps`),
    );
    const s = pipelineSummary(p);
    S.refs.stats.replaceChildren(
      stat("Scenes", String(s.scenes)),
      stat("Duration", fmtTime(total)),
      stat("Images", `${s.images}/${s.scenes}`),
      stat("Voice", `${s.voices}/${s.scenes}`),
    );
  }

  function refreshStudio() {
    const p = activeProject();
    if (!p) return;
    if (document.activeElement !== ta) ta.value = p.brief.text || "";
    counter.textContent = `${(p.brief.text || "").length} / 4000`;
    for (const chip of tplRow.querySelectorAll("[data-template]")) {
      chip.setAttribute("aria-pressed", chip.dataset.template === p.brief.template ? "true" : "false");
    }
    toneSel.value = p.brief.tone;
    if (document.activeElement !== audience) audience.value = p.brief.audience || "";
    dur.value = p.brief.duration;
    durOut.textContent = fmtTime(p.brief.duration);
    for (const chip of durPresets.querySelectorAll("[data-dur]")) {
      chip.setAttribute("aria-pressed", Number(chip.dataset.dur) === Number(p.brief.duration) ? "true" : "false");
    }
    qty.value = p.settings.quantity || 1;
    variants.value = p.settings.variants || 1;
    aspectSeg.setValue(p.settings.aspect);
    styleSel.value = p.settings.styleId;
    voiceSel.value = p.settings.voice;
    moodSel.value = p.settings.musicMood;
    modelSel.value = p.settings.imageModel;
    renderFrame();
  }

  async function start(kind) {
    if (S.busy) return;
    const p = activeProject();
    if (!p.brief.text.trim()) {
      toast("Write a brief first — one sentence is enough", "warn");
      ta.focus();
      return;
    }
    S.busy = true;
    setRunning(true);
    snapshot("Before generation", p);
    const stages = kind === "plan" ? ["plan"] : ["plan", "assets"];
    try {
      await runPipeline(p, {
        stages,
        onProgress: ({ stage, pct }) => {
          progress.el.hidden = false;
          progress.set(pct, stage === "plan" ? "Writing script and storyboard…" : stage === "assets" ? "Generating images and voice-over…" : "Finishing");
          setStatus(stage === "plan" ? "Planning…" : "Producing…", "run");
        },
      });
      setStatus("Ready", "ok");
      toast(kind === "plan" ? "Plan ready — review the storyboard" : "Production finished", "ok");
      refreshStudio();
    } catch (e) {
      setStatus("Failed", "bad");
      toast(String(e.message || e), "bad", 7000);
    } finally {
      S.busy = false;
      setRunning(false);
      progress.el.hidden = true;
      refreshStages();
      renderFrame();
    }
  }

  function setRunning(running) {
    btnPlan.disabled = running;
    btnProduce.disabled = running;
    btnBatch.disabled = running;
    btnStop.hidden = !running;
  }

  function paintLog(log) {
    if (!log?.length) return;
    const rows = log.slice(-40).map((e) => h("div", { class: `lg ${e.level}` }, [
      h("time", { text: new Date(e.at).toTimeString().slice(0, 8) }),
      h("span", { text: e.text }),
    ]));
    runlog.replaceChildren(...rows);
    runlog.scrollTop = runlog.scrollHeight;
  }

  function refreshStages() {
    const p = activeProject();
    if (!p) return;
    const s = pipelineSummary(p);
    const stages = [
      {
        key: "brief", label: "Brief & correction",
        status: stageStatus(p, "brief"), meta: p.pipeline?.brief?.provider ? `${p.pipeline.brief.provider} · ${(p.pipeline.brief.issues || []).length} note(s)` : "not run",
        run: async () => start("plan"),
      },
      { key: "plan", label: "Script & storyboard", status: s.plan, meta: `${s.scenes} scenes · ${p.pipeline?.plan?.provider || "—"}`, run: () => start("plan") },
      { key: "images", label: "Images", status: p.pipeline?.images?.status || (s.images ? "partial" : "idle"), meta: `${s.images}/${s.scenes} ready`, run: () => runStageAssets(true, false) },
      { key: "voices", label: "Voice-over", status: p.pipeline?.voices?.status || (s.voices ? "partial" : "idle"), meta: `${s.voices}/${s.scenes} ready`, run: () => runStageAssets(false, true) },
      { key: "music", label: "Music bed", status: p.settings.musicMood === "none" ? "skip" : "ready", meta: MOODS[p.settings.musicMood]?.label || "—", run: previewMusic },
      { key: "render", label: "Export", status: p.pipeline?.render?.status || "idle", meta: p.pipeline?.render?.file || "not rendered", run: () => openExportDialog({ renderer: S.renderer }) },
    ];
    stageList.replaceChildren(...stages.map((st) => {
      const cls = st.status === "done" || st.status === "ready" ? "done" : st.status === "running" ? "run" : st.status === "failed" ? "fail" : st.status === "skip" ? "skip" : "";
      const glyph = cls === "done" ? "✓" : cls === "fail" ? "!" : cls === "skip" ? "–" : "";
      return h("div", { class: `stage-row ${cls}` }, [
        h("span", { class: "st-dot", text: glyph }),
        h("span", { class: "st-main" }, [
          h("span", { class: "st-name", text: st.label }),
          h("span", { class: "st-meta", text: st.meta }),
        ]),
        h("span", { class: "st-act" }, [
          h("button", { class: "btn sm ghost", type: "button", text: cls === "done" ? "Redo" : "Run", onclick: st.run }),
        ]),
      ]);
    }));
  }

  async function runStageAssets(images, voices) {
    if (S.busy) return;
    const p = activeProject();
    if (!scenesOf(p).length) { toast("Generate a plan first", "warn"); return; }
    S.busy = true; setRunning(true);
    progress.el.hidden = false;
    try {
      await runAssets(p, {
        images, voices, onlyMissing: true,
        onProgress: (pct, idx, total, type) => {
          progress.set(pct, `${type === "image" ? "Image" : "Voice"} ${idx}/${total}`);
          setStatus(`${type === "image" ? "Images" : "Voice"} ${idx}/${total}`, "run");
        },
      });
      setStatus("Ready", "ok");
      toast("Assets updated", "ok");
    } catch (e) {
      if (e?.name !== "AbortError") toast(String(e.message || e), "bad", 7000);
    } finally {
      S.busy = false; setRunning(false); progress.el.hidden = true;
      refreshStages(); renderFrame();
    }
  }

  async function previewMusic() {
    const p = activeProject();
    if (p.settings.musicMood === "none") { toast("Music is set to None", "warn"); return; }
    try {
      await S.audio.load(p);
      S.renderer.prepare();
      S.audio.play(p, 0);
      toast(`Previewing ${MOODS[p.settings.musicMood]?.label} bed — generated locally`, "ok");
      setTimeout(() => S.audio.stop(), 6000);
    } catch (e) { toast(String(e.message || e), "bad"); }
  }

  function seekTo(t) {
    S.playhead = clamp(t, 0, Math.max(0, totalSeconds(activeProject()) - 0.001));
    S.renderer?.drawAt(S.playhead);
    S.refs.tcNow.textContent = fmtClock(S.playhead);
    const total = totalSeconds(activeProject());
    S.refs.scrub.value = total ? (S.playhead / total) * 1000 : 0;
  }

  async function togglePlay() {
    if (S.playing) { pause(); return; }
    const p = activeProject();
    const total = totalSeconds(p);
    if (!total) { toast("Generate a plan first", "warn"); return; }
    try {
      playBtn.innerHTML = "";
      playBtn.appendChild(iconEl("pause"));
      playBtn.setAttribute("aria-label", "Pause preview");
      await S.renderer.prepare();
      await S.audio.load(p);
      const from = S.playhead >= total - 0.08 ? 0 : S.playhead;
      S.renderer.setProject(p);
      S.audio.play(p, from);
      S.playing = true;
      S.renderer.play(from, (t) => {
        S.playhead = t;
        S.refs.tcNow.textContent = fmtClock(t);
        S.refs.scrub.value = (t / total) * 1000;
      }, () => { pause(); });
    } catch (e) {
      toast(String(e.message || e), "bad");
      pause();
    }
  }

  S.pause = pause;
  function pause() {
    if (S.renderer) {
      const t = S.renderer.pause();
      S.playhead = typeof t === "number" ? t : S.playhead;
    }
    S.audio?.stop();
    S.playing = false;
    playBtn.innerHTML = "";
    playBtn.appendChild(iconEl("play"));
    playBtn.setAttribute("aria-label", "Play preview");
    S.refs.tcNow.textContent = fmtClock(S.playhead);
  }

  function openBatch() {
    const p = activeProject();
    const q = clamp(Number(qty.value) || 1, 1, 10);
    const v = clamp(Number(variants.value) || 1, 1, 5);
    const body = h("div", { class: "stack" }, [
      h("p", { class: "modal-sub", text: `Create ${q} video${q > 1 ? "s" : ""} with ${v} style option${v > 1 ? "s" : ""}. Each variant is a separate project with its own plan, images and voice-over.` }),
      h("div", { class: "grid-2" }, [
        field("Videos", h("input", { type: "number", min: 1, max: 10, value: q, onchange: (e) => { qty.value = clamp(Number(e.target.value) || 1, 1, 10); } })),
        field("Style options", h("input", { type: "number", min: 1, max: 5, value: v, onchange: (e) => { variants.value = clamp(Number(e.target.value) || 1, 1, 5); } })),
      ]),
      h("p", { class: "note", text: "Batch planning runs locally for speed and quota safety. Images and voice-over are fetched with automatic failover. Rendering each video still happens in real time from the Export dialog." }),
      h("div", { class: "row end" }, [
        h("button", { class: "btn ghost", type: "button", text: "Cancel", onclick: () => document.getElementById("overlay").hidden = true }),
        h("button", {
          class: "btn primary", type: "button", text: "Create variants",
          onclick: async (e) => {
            e.target.disabled = true;
            document.getElementById("overlay").hidden = true;
            await doBatch(p, clamp(Number(qty.value) || 1, 1, 10), clamp(Number(variants.value) || 1, 1, 5));
          },
        }),
      ]),
    ]);
    openModal({ title: "Batch production", body, narrow: true });
  }

  async function doBatch(source, quantity, variantCount) {
    if (S.busy) return;
    S.busy = true; setRunning(true);
    progress.el.hidden = false;
    try {
      const { createVariants } = await import("./pipeline.js");
      setStatus(`Batch · building ${quantity} variants`, "run");
      const projects = await createVariants(source, Math.max(quantity, variantCount), {
        onProgress: (pct, text) => progress.set(pct, text),
      });
      // Style sweep across variants so the batch explores genuinely different looks
      projects.forEach((pr, i) => {
        if (variantCount > 1) {
          const st = STYLES[i % STYLES.length];
          pr.settings.styleId = st.id;
          pr.brief.styleId = st.id;
          pr.settings.effects = [...st.effects];
          pr.settings.musicMood = st.music;
          pr.settings.transition = st.transition;
        }
      });
      save();
      setStatus("Batch planned", "ok");
      toast(`${projects.length} variants created — open one to produce its assets`, "ok");
    } catch (e) {
      toast(String(e.message || e), "bad", 7000);
    } finally {
      S.busy = false; setRunning(false); progress.el.hidden = true;
      refreshStudio();
    }
  }
}

function stat(k, v) {
  return h("div", { class: "stat" }, [h("div", { class: "k", text: k }), h("div", { class: "v", text: v })]);
}

export function refreshStudio() {
  if (!S.built) return;
  const root = $("view-studio");
  if (!root) return;
  const p = activeProject();
  if (!p) return;
  const r = S.refs;
  if (document.activeElement !== r.ta) r.ta.value = p.brief.text || "";
  r.counter.textContent = `${(p.brief.text || "").length} / 4000`;
  for (const chip of r.tplRow.querySelectorAll("[data-template]")) {
    chip.setAttribute("aria-pressed", chip.dataset.template === p.brief.template ? "true" : "false");
  }
  r.toneSel.value = p.brief.tone;
  if (document.activeElement !== r.audience) r.audience.value = p.brief.audience || "";
  r.dur.value = p.brief.duration;
  r.durOut.textContent = fmtTime(p.brief.duration);
  r.qty.value = p.settings.quantity || 1;
  r.variants.value = p.settings.variants || 1;
  r.aspectSeg.setValue(p.settings.aspect);
  r.styleSel.value = p.settings.styleId;
  r.voiceSel.value = p.settings.voice;
  r.moodSel.value = p.settings.musicMood;
  r.modelSel.value = p.settings.imageModel;
  if (S.renderer) {
    S.renderer.setProject(p);
    S.renderer.prepare().then(() => S.renderer.drawAt(Math.min(S.playhead, Math.max(0, totalSeconds(p) - 0.01)))).catch(() => {});
  }
  const total = totalSeconds(p);
  r.tcTotal.textContent = fmtClock(total);
  r.idle.hidden = total > 0;
  if (!S.playing) r.tcNow.textContent = fmtClock(S.playhead);
  const s = pipelineSummary(p);
  r.stats.replaceChildren(
    stat("Scenes", String(s.scenes)),
    stat("Duration", fmtTime(total)),
    stat("Images", `${s.images}/${s.scenes}`),
    stat("Voice", `${s.voices}/${s.scenes}`),
  );
}

export function studioRenderer() { return S.renderer; }
export function studioAudio() { return S.audio; }
export function stopStudioPlayback() { if (S.built && S.pause) S.pause(); }
export function startStudioGeneration(kind = "all") { if (S.built && S.start) S.start(kind); }
