/* ZTC AI Studio — Storyboard and Timeline views. */

import { activeProject, updateScene, addScene, removeScene, moveScene, save, touch, scenesOf, putAsset, assetUrl, state } from "./store.js";
import { buildCues, timingsOf, totalSeconds, Renderer } from "./render.js";
import { generateSceneImage, generateSceneVoice } from "./pipeline.js";
import { rewriteLine, rebalance } from "./generate.js";
import { MOTIONS, TRANSITIONS, STYLES, MOODS } from "./catalog.js";
import { $, h, clear, fmtClock, fmtTime, clamp, uid } from "./util.js";
import { iconEl, field, tag, emptyState, openModal, closeModal, selectEl, toast } from "./ui.js";
import { studioAudio } from "./views-studio.js";

let boardFilter = "all";
let boardMounted = false;
let timelineMounted = false;
const TL = { zoom: 26, renderer: null, canvas: null, playing: false, playhead: 0, raf: null, drag: null };

/* ============================================================
   Storyboard
   ============================================================ */
export function mountStoryboard(root) {
  boardMounted = true;
  clear(root);
  const head = h("div", { class: "board-head" }, [
    h("h2", { text: "Storyboard" }),
    h("span", { class: "pill ghost", id: "boardCount" }),
    h("span", { class: "spacer" }),
    h("div", { class: "seg", role: "group", "aria-label": "Filter scenes" }, [
      filterBtn("all", "All"),
      filterBtn("missing", "Needs art"),
      filterBtn("voice", "Needs voice"),
    ]),
    h("button", { class: "btn sm ghost", type: "button", onclick: addAndRefresh }, [iconEl("plus"), "Scene"]),
    h("button", { class: "btn sm ghost", type: "button", onclick: () => openScript() }, [iconEl("text"), "Script"]),
  ]);
  const grid = h("div", { class: "board-grid" });
  root.append(head, grid);
  renderBoard(grid);

  function filterBtn(value, label) {
    return h("button", {
      type: "button", text: label, "aria-pressed": boardFilter === value ? "true" : "false",
      onclick: (e) => {
        boardFilter = value;
        e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b === e.currentTarget ? "true" : "false"));
        renderBoard(grid);
      },
    });
  }
}

function addAndRefresh() {
  const p = activeProject();
  if (!p) return;
  if (!p.plan.scenes.length) { toast("Generate a plan first — or use the Studio", "warn"); return; }
  const s = addScene(null, p);
  refreshBoard();
  openInspector(s.id);
}

export function refreshBoard() {
  if (!boardMounted) return;
  const grid = $("view-storyboard")?.querySelector(".board-grid");
  if (grid) renderBoard(grid);
}

function renderBoard(grid) {
  const p = activeProject();
  if (!p) return;
  const count = $("boardCount");
  const all = scenesOf(p);
  if (count) count.textContent = `${all.length} scenes · ${fmtTime(totalSeconds(p))}`;
  const scenes = all.filter((s) => {
    if (boardFilter === "missing") return !s.imageId;
    if (boardFilter === "voice") return !s.voiceId && s.narration;
    return true;
  });
  grid.replaceChildren();
  if (!all.length) {
    grid.append(emptyState({
      icon: "grid", title: "No scenes yet",
      text: "Generate a plan in Studio and each scene appears here with its image, narration and duration.",
      actions: [h("button", { class: "btn primary", type: "button", text: "Go to Studio", onclick: () => $("rail").querySelector('[data-view="studio"]').click() })],
    }));
    return;
  }
  scenes.forEach((scene) => {
    const idx = all.indexOf(scene);
    const card = h("article", { class: "scene-card", tabindex: "0", "aria-label": `Scene ${idx + 1}: ${scene.title}` }, [
      h("div", { class: "scene-thumb" }, [
        h("span", { class: "sc-num", text: `SC ${String(idx + 1).padStart(2, "0")}` }),
        h("span", { class: "sc-dur", text: `${scene.duration}s` }),
        h("span", { class: "sc-state" }, [
          h("i", { class: `img ${scene.imageId ? "ok" : ""}`, title: scene.imageId ? `Image: ${scene.provider?.image || "ready"}` : "No image yet" }),
          h("i", { class: `vo ${scene.voiceId ? "ok" : ""}`, title: scene.voiceId ? `Voice: ${scene.provider?.voice || "ready"}` : "No voice-over" }),
        ]),
      ]),
      h("div", { class: "scene-body" }, [
        h("div", { class: "scene-title" }, [
          h("span", { text: scene.title }),
          scene.beat && scene.beat.toLowerCase() !== scene.title.toLowerCase() ? h("span", { class: "beat", text: scene.beat }) : null,
        ]),
        h("p", { class: "scene-vo", text: scene.narration || "No narration for this scene." }),
        h("p", { class: "scene-vis", text: scene.visual ? scene.visual.split(",").slice(0, 6).join(", ") : "No visual prompt." }),
        h("div", { class: "scene-acts" }, [
          h("button", { class: "btn sm ghost", type: "button", onclick: () => openInspector(scene.id) }, "Edit"),
          h("button", { class: "btn sm ghost", type: "button", onclick: () => regenImage(scene.id) }, [iconEl("refresh"), "Art"]),
          h("button", { class: "btn sm ghost", type: "button", onclick: () => regenVoice(scene.id) }, [iconEl("mic"), "Voice"]),
          h("span", { class: "spacer" }),
          h("button", { class: "icon-btn sm", type: "button", title: "Move earlier", "aria-label": "Move scene earlier", onclick: () => { moveScene(scene.id, -1); refreshBoard(); refreshTimeline(); } }, "←"),
          h("button", { class: "icon-btn sm", type: "button", title: "Move later", "aria-label": "Move scene later", onclick: () => { moveScene(scene.id, 1); refreshBoard(); refreshTimeline(); } }, "→"),
        ]),
      ]),
    ]);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter") openInspector(scene.id); });
    card.addEventListener("click", (e) => { if (!e.target.closest("button")) openInspector(scene.id); });
    const thumb = card.querySelector(".scene-thumb");
    if (scene.imageId) {
      assetUrl(scene.imageId).then((url) => {
        if (!url) return;
        const img = h("img", { src: url, alt: scene.title, loading: "lazy" });
        thumb.prepend(img);
      });
    } else {
      const st = STYLES.find((x) => x.id === scene.styleId) || STYLES[0];
      thumb.style.background = `linear-gradient(140deg, ${st.palette.bg1}, ${st.palette.bg2})`;
      thumb.append(h("span", { class: "no-img", text: "no image yet" }));
    }
    grid.appendChild(card);
  });
}

export function openInspector(sceneId) {
  const p = activeProject();
  const scene = scenesOf(p).find((s) => s.id === sceneId);
  if (!scene) return;
  const idx = scenesOf(p).indexOf(scene);

  const title = h("input", { type: "text", value: scene.title, maxlength: 60, oninput: () => { scene.title = title.value; touch(p); refreshBoard(); refreshTimeline(); } });
  const narration = h("textarea", { rows: 4, value: scene.narration, oninput: () => { scene.narration = narration.value; scene.voiceId = null; scene.status = { ...(scene.status || {}), voice: "idle" }; touch(p); } });
  const visual = h("textarea", { rows: 3, value: scene.visual, oninput: () => { scene.visual = visual.value; scene.stale = true; touch(p); } });
  const dur = h("input", { type: "range", min: 2, max: 30, step: 0.5, value: scene.duration, oninput: () => { scene.duration = Number(dur.value); durLabel.textContent = `${dur.value}s`; touch(p); refreshBoard(); refreshTimeline(); } });
  const durLabel = h("span", { class: "mono small", text: `${scene.duration}s` });
  const motion = selectEl(Object.entries(MOTIONS).map(([k, m]) => ({ value: k, label: m.label })), scene.motion, (v) => { scene.motion = v; touch(p); });
  const transition = selectEl(Object.entries(TRANSITIONS).map(([k, m]) => ({ value: k, label: m.label })), scene.transition, (v) => { scene.transition = v; touch(p); });
  const thumb = h("div", { class: "ins-thumb" });
  if (scene.imageId) assetUrl(scene.imageId).then((u) => { if (u) thumb.append(h("img", { src: u, alt: scene.title })); });
  else thumb.append(h("div", { class: "empty", style: { padding: "20px" } }, [h("span", { class: "small", text: "No image generated yet" })]));

  const body = h("div", { class: "inspector" }, [
    h("div", { class: "ins-head" }, [
      h("h3", { text: `Scene ${idx + 1}` }),
      tag(scene.provider?.image ? `art · ${scene.provider.image}` : "art · pending"),
      tag(scene.provider?.voice ? `voice · ${scene.provider.voice}` : "voice · pending"),
    ]),
    thumb,
    field("Title", title),
    field("Narration (spoken)", narration, "Changing this clears the current voice-over so it can be regenerated."),
    field("Visual prompt", visual, "One still frame: subject, shot, light. Style suffix is applied automatically."),
    h("div", { class: "field" }, [h("div", { class: "row between" }, [h("label", { text: "Duration" }), durLabel]), dur]),
    h("div", { class: "grid-2" }, [field("Camera motion", motion), field("Transition in", transition)]),
    h("div", { class: "row gap-6", style: { marginTop: "6px", flexWrap: "wrap" } }, [
      h("button", { class: "btn sm", type: "button", onclick: async (e) => { e.target.disabled = true; await regenImage(scene.id, true); e.target.disabled = false; closeModal(); openInspector(scene.id); } }, [iconEl("refresh"), "Regenerate art"]),
      h("button", { class: "btn sm", type: "button", onclick: async (e) => { e.target.disabled = true; await regenVoice(scene.id, true); e.target.disabled = false; } }, [iconEl("mic"), "Regenerate voice"]),
      h("button", { class: "btn sm", type: "button", onclick: async () => {
        const next = await rewriteLine(scene.narration, { settings: state.settings, brief: p.brief.text, mode: "punchier" });
        narration.value = next;
        scene.narration = next;
        scene.voiceId = null;
        touch(p);
        toast("Narration rewritten — regenerate the voice", "ok");
      } }, [iconEl("wand"), "Rewrite"]),
      h("button", { class: "btn sm", type: "button", onclick: () => uploadImage(scene) }, [iconEl("upload"), "Upload art"]),
      h("button", { class: "btn sm", type: "button", onclick: () => uploadVoice(scene) }, [iconEl("upload"), "Upload voice"]),
    ]),
    h("div", { class: "row gap-6", style: { marginTop: "8px" } }, [
      h("button", { class: "btn sm ghost", type: "button", onclick: () => { const copy = { ...scene, id: uid("sc"), title: `${scene.title} copy`, imageId: null, voiceId: null, status: {}, provider: {} }; const list = scenesOf(p); list.splice(idx + 1, 0, copy); touch(p); closeModal(); refreshBoard(); refreshTimeline(); } }, "Duplicate"),
      h("button", { class: "btn sm danger", type: "button", onclick: () => { removeScene(scene.id); closeModal(); refreshBoard(); refreshTimeline(); } }, [iconEl("trash"), "Delete"]),
    ]),
  ]);
  openModal({ title: "Scene inspector", subtitle: `Scene ${idx + 1} of ${scenesOf(p).length}`, body, wide: false });
}

async function regenImage(sceneId, force = true) {
  const p = activeProject();
  const scene = scenesOf(p).find((s) => s.id === sceneId);
  if (!scene) return;
  const t = toast("Generating art…", "", 0);
  try {
    await generateSceneImage(p, scene, { force });
    save();
    t?.remove();
    toast(`Art ready · ${scene.provider?.image || "done"}`, "ok");
    refreshBoard(); refreshTimeline();
  } catch (e) {
    t?.remove();
    toast(String(e.message || e), "bad", 7000);
  }
}

async function regenVoice(sceneId, force = true) {
  const p = activeProject();
  const scene = scenesOf(p).find((s) => s.id === sceneId);
  if (!scene) return;
  if (!scene.narration?.trim()) { toast("Add narration first", "warn"); return; }
  const t = toast("Generating voice-over…", "", 0);
  try {
    const r = await generateSceneVoice(p, scene, {});
    save();
    t?.remove();
    if (r?.error) toast(`Voice unavailable: ${r.error.slice(0, 90)}`, "bad", 7000);
    else toast(`Voice ready · ${scene.provider?.voice || "done"}`, "ok");
    rebalance(scenesOf(p), Number(p.brief.duration) || totalSeconds(p));
    touch(p);
    refreshBoard(); refreshTimeline();
  } catch (e) {
    t?.remove();
    toast(String(e.message || e), "bad", 7000);
  }
}

function uploadImage(scene) {
  const input = $("fileImage");
  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Choose an image file", "warn"); return; }
    if (file.size > 12 * 1024 * 1024) { toast("Image is over 12 MB", "warn"); return; }
    const p = activeProject();
    const asset = await putAsset({ blob: file, kind: "image", projectId: p.id, name: file.name, meta: { provider: "upload", mime: file.type } });
    scene.imageId = asset.id;
    scene.status = { ...(scene.status || {}), image: "done" };
    scene.provider = { ...(scene.provider || {}), image: "uploaded" };
    touch(p); save();
    toast("Image attached", "ok");
    refreshBoard(); refreshTimeline();
  };
  input.click();
}

function uploadVoice(scene) {
  const input = $("fileAudio");
  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!file.type.startsWith("audio/")) { toast("Choose an audio file", "warn"); return; }
    const p = activeProject();
    const asset = await putAsset({ blob: file, kind: "voice", projectId: p.id, name: file.name, meta: { provider: "upload" } });
    scene.voiceId = asset.id;
    scene.status = { ...(scene.status || {}), voice: "done" };
    scene.provider = { ...(scene.provider || {}), voice: "uploaded" };
    try {
      const { decodeAudio } = await import("./media.js");
      scene.voiceDur = Math.round((await decodeAudio(file)).duration * 10) / 10;
    } catch { /* duration unknown */ }
    touch(p); save();
    toast("Voice-over attached", "ok");
    refreshBoard(); refreshTimeline();
  };
  input.click();
}

function openScript() {
  const p = activeProject();
  const text = p.plan.script || "No script yet.";
  const body = h("div", { class: "stack" }, [
    h("textarea", { rows: 18, value: text, readonly: true, style: { fontFamily: "var(--mono)", fontSize: "12px" } }),
    h("div", { class: "row end" }, [
      h("button", { class: "btn ghost", type: "button", onclick: async () => { await navigator.clipboard.writeText(text); toast("Script copied", "ok"); } }, [iconEl("copy"), "Copy"]),
      h("button", { class: "btn", type: "button", onclick: () => { const blob = new Blob([text], { type: "text/markdown" }); const a = h("a", { href: URL.createObjectURL(blob), download: "script.md" }); a.click(); } }, [iconEl("download"), "Download"]),
    ]),
  ]);
  openModal({ title: "Script", subtitle: `${p.plan.scenes.length} scenes · ${fmtTime(totalSeconds(p))}`, body, wide: true });
}

/* ============================================================
   Timeline
   ============================================================ */
export function mountTimeline(root) {
  timelineMounted = true;
  clear(root);
  const project = activeProject();
  const pxPerSec = { value: 26 };

  const canvas = h("canvas", { style: { width: "100%", maxWidth: "560px", borderRadius: "10px", border: "1px solid var(--line)", background: "#05060a" } });
  TL.canvas = canvas;
  TL.renderer = new Renderer(canvas);
  TL.renderer.setProject(project);

  const playBtn = h("button", { class: "btn primary", type: "button", onclick: toggleTimelinePlay }, [iconEl("play"), "Play"]);
  const time = h("span", { class: "mono small", text: "00:00.0" });
  const zoom = h("input", { type: "range", min: 12, max: 160, value: pxPerSec.value, style: { width: "140px" } });

  const toolbar = h("div", { class: "tl-toolbar" }, [
    playBtn, time,
    h("span", { class: "spacer" }),
    h("label", { class: "small muted", for: "tlZoom", text: "Zoom" }), zoom,
    h("button", { class: "btn sm ghost", type: "button", onclick: () => { const p = activeProject(); rebalance(scenesOf(p), Number(p.brief.duration) || 60); touch(p); refreshTimeline(); toast("Durations rebalanced to the target length", "ok"); } }, "Fit target"),
    h("button", { class: "btn sm ghost", type: "button", onclick: () => { const p = activeProject(); const s = addScene(null, p); touch(p); refreshTimeline(); openInspector(s.id); } }, [iconEl("plus"), "Scene"]),
  ]);
  zoom.id = "tlZoom";

  const labels = h("div", { class: "tl-labels" }, [
    tlLabel("film", "Visual"), tlLabel("mic", "Voice"), tlLabel("music", "Music"), tlLabel("text", "Captions"),
  ]);
  const ruler = h("div", { class: "tl-ruler", role: "slider", tabindex: "0", "aria-label": "Timeline position" });
  const trackVisual = h("div", { class: "tl-track visual" });
  const trackVoice = h("div", { class: "tl-track voice" });
  const trackMusic = h("div", { class: "tl-track music" });
  const trackCaption = h("div", { class: "tl-track captions" });
  const inner = h("div", { class: "tl-inner" }, [ruler, trackVisual, trackVoice, trackMusic, trackCaption]);
  const playhead = h("div", { class: "tl-playhead", style: { left: "0px" } });
  inner.appendChild(playhead);
  const area = h("div", { class: "tl-area" }, [inner]);
  const shell = h("div", { class: "tl-shell" }, [labels, area]);

  root.append(
    h("div", { class: "board-head" }, [h("h2", { text: "Timeline" }), h("span", { class: "pill ghost", id: "tlStats" })]),
    toolbar,
    h("div", { class: "grid-2", style: { gridTemplateColumns: "minmax(0,1fr) minmax(220px, 340px)", alignItems: "start" } }, [
      shell,
      h("div", { class: "panel" }, [
        h("div", { class: "panel-head" }, [h("h3", { text: "Frame" })]),
        h("div", { class: "panel-body" }, [canvas]),
      ]),
    ]),
    h("p", { class: "tl-help", text: "Click the ruler or a track to scrub. Drag a visual clip left or right to reorder scenes. Alt+←/→ moves the focused scene. Space plays from the playhead." }),
  );

  zoom.oninput = () => { pxPerSec.value = Number(zoom.value); draw(); };

  function tlLabel(ic, text) {
    return h("div", { class: "tl-label" }, [iconEl(ic), h("span", { text })]);
  }

  function width() {
    const total = totalSeconds(activeProject());
    return Math.max(area.clientWidth || 600, total * pxPerSec.value + 40);
  }

  function draw() {
    const p = activeProject();
    if (!p) return;
    TL.renderer.setProject(p);
    TL.renderer.prepare().then(() => TL.renderer.drawAt(TL.playhead)).catch(() => {});
    const scenes = scenesOf(p);
    const timings = timingsOf(p);
    const total = totalSeconds(p);
    const w = width();
    inner.style.width = `${w}px`;
    const px = pxPerSec.value;

    ruler.replaceChildren();
    const step = px > 60 ? 5 : px > 30 ? 10 : 30;
    for (let s = 0; s <= total + step; s += step) {
      const tick = h("div", { class: "tl-tick", style: { left: `${s * px}px` } }, [h("span", { text: fmtTime(s) })]);
      ruler.appendChild(tick);
    }

    trackVisual.replaceChildren();
    trackVoice.replaceChildren();
    trackMusic.replaceChildren();
    trackCaption.replaceChildren();

    scenes.forEach((scene, i) => {
      const tm = timings[i];
      const clip = h("div", {
        class: "tl-clip", tabindex: "0", role: "button",
        style: { left: `${tm.start * px}px`, width: `${Math.max(18, tm.duration * px - 2)}px` },
        title: `${scene.title} · ${tm.duration}s`,
        "aria-label": `Scene ${i + 1}, ${scene.title}, ${tm.duration} seconds`,
        onpointerdown: (e) => startClipDrag(e, i),
        onkeydown: (e) => {
          if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); moveScene(scene.id, -1); refreshTimeline(); }
          if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); moveScene(scene.id, 1); refreshTimeline(); }
          if (e.key === "Enter") openInspector(scene.id);
        },
      }, [
        h("span", { class: "cl-name", text: `${i + 1}. ${scene.title}` }),
        scene.imageId ? null : h("span", { class: "tag warn", text: "no art" }),
      ]);
      trackVisual.appendChild(clip);

      if (scene.voiceId) {
        const dur = scene.voiceDur || tm.duration;
        trackVoice.appendChild(h("div", {
          class: "tl-clip voice",
          style: { left: `${tm.start * px}px`, width: `${Math.max(14, Math.min(dur, tm.duration) * px - 2)}px` },
          title: `${scene.provider?.voice || "voice"} · ${dur.toFixed(1)}s`,
          onclick: () => openInspector(scene.id),
        }, [h("span", { class: "cl-name", text: `VO ${i + 1}` })]));
      }
    });

    if (p.settings.musicMood !== "none" && total > 0) {
      trackMusic.appendChild(h("div", {
        class: "tl-clip music", style: { left: "0px", width: `${total * px}px` },
        title: `${MOODS[p.settings.musicMood]?.label} · generated locally`,
      }, [h("span", { class: "cl-name", text: `${MOODS[p.settings.musicMood]?.label || "Music"} · loop` })]));
    }

    for (const cue of buildCues(p)) {
      trackCaption.appendChild(h("div", {
        class: "tl-clip captions",
        style: { left: `${cue.start * px}px`, width: `${Math.max(10, (cue.end - cue.start) * px - 2)}px` },
        title: cue.text,
      }, [h("span", { class: "cl-name", text: cue.text })]));
    }

    playhead.style.left = `${TL.playhead * px}px`;
    const stats = $("tlStats");
    if (stats) stats.textContent = `${scenes.length} scenes · ${fmtClock(total)} · ${p.settings.aspect}`;
    time.textContent = fmtClock(TL.playhead);
  }

  function seekFromEvent(e) {
    const rect = area.getBoundingClientRect();
    const x = e.clientX - rect.left + area.scrollLeft;
    const t = clamp(x / pxPerSec.value, 0, totalSeconds(activeProject()));
    TL.playhead = t;
    draw();
  }

  const seek = (e) => {
    if (TL.playing) pauseTimeline();
    seekFromEvent(e);
  };
  ruler.addEventListener("pointerdown", (e) => { seek(e); ruler.setPointerCapture(e.pointerId); });
  ruler.addEventListener("pointermove", (e) => { if (e.buttons === 1) seekFromEvent(e); });
  [trackVisual, trackVoice, trackMusic, trackCaption].forEach((tr) => {
    tr.addEventListener("pointerdown", (e) => { if (e.target === tr) seek(e); });
  });
  ruler.addEventListener("keydown", (e) => {
    const total = totalSeconds(activeProject());
    if (e.key === "ArrowRight") { TL.playhead = clamp(TL.playhead + 1, 0, total); draw(); e.preventDefault(); }
    if (e.key === "ArrowLeft") { TL.playhead = clamp(TL.playhead - 1, 0, total); draw(); e.preventDefault(); }
  });

  function startClipDrag(e, index) {
    if (e.button !== 0) return;
    const p = activeProject();
    const scenes = scenesOf(p);
    if (!scenes[index]) return;
    const clip = e.currentTarget;
    clip.classList.add("dragging");
    const rect = area.getBoundingClientRect();
    const startX = e.clientX;
    let target = index;
    const onMove = (ev) => {
      const x = ev.clientX - rect.left + area.scrollLeft;
      const t = x / pxPerSec.value;
      const timings = timingsOf(p);
      let idx = timings.findIndex((tm) => t < tm.end);
      if (idx < 0) idx = timings.length - 1;
      target = clamp(idx, 0, scenes.length - 1);
    };
    const onUp = () => {
      clip.classList.remove("dragging");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (Math.abs(e.clientX - startX) < 4) { openInspector(scenes[index].id); return; }
      const delta = target - index;
      if (delta) { moveScene(scenes[index].id, delta); refreshTimeline(); }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function toggleTimelinePlay() {
    if (TL.playing) { pauseTimeline(); return; }
    const p = activeProject();
    const total = totalSeconds(p);
    if (!total) { toast("Generate a plan first", "warn"); return; }
    TL.playing = true;
    playBtn.innerHTML = "";
    playBtn.append(iconEl("pause"), document.createTextNode("Pause"));
    const from = TL.playhead >= total - 0.1 ? 0 : TL.playhead;
    TL.renderer.setProject(p);
    TL.renderer.prepare();
    const audio = studioAudio();
    if (audio) {
      audio.load(p).then(() => audio.play(p, from)).catch(() => {});
    }
    TL.renderer.play(from, (t) => {
      TL.playhead = t;
      playhead.style.left = `${t * pxPerSec.value}px`;
      time.textContent = fmtClock(t);
      if (area.scrollLeft + area.clientWidth < t * pxPerSec.value + 40) area.scrollLeft = t * pxPerSec.value - area.clientWidth * 0.7;
    }, () => pauseTimeline());
  }

  function pauseTimeline() {
    const t = TL.renderer?.pause();
    if (typeof t === "number") TL.playhead = t;
    if (TL.playing) studioAudio()?.stop();
    TL.playing = false;
    playBtn.innerHTML = "";
    playBtn.append(iconEl("play"), document.createTextNode("Play"));
  }

  TL.draw = draw;
  TL.pause = pauseTimeline;
  draw();
  requestAnimationFrame(draw);
}

export function refreshTimeline() {
  if (timelineMounted && TL.draw) TL.draw();
}

export function timelinePlaybackStop() {
  if (TL.playing && TL.pause) TL.pause();
}
