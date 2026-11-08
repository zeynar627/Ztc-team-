/* ZTC AI Studio — bootstrap and shell wiring. */

import {
  state, subscribe, activeProject, addProject, deleteProject, selectProject, setView, setTheme,
  saveNow, save, snapshot, importWorkspace, importProject, storageUsage, scenesOf,
  setStorageErrorHandler, flushSave,
} from "./store.js";
import { pipeline, runPipeline, repairProject } from "./pipeline.js";
import { mountStudio, refreshStudio, studioRenderer, startStudioGeneration, stopStudioPlayback } from "./views-studio.js";
import { mountStoryboard, refreshBoard } from "./views-board.js";
import { mountTimeline, refreshTimeline, timelinePlaybackStop } from "./views-board.js";
import { mountAssets, refreshAssets } from "./views-assets.js";
import { mountChat, refreshChat } from "./views-chat.js";
import { openExportDialog, openSettings, openProviders, openVersions, openHelp } from "./views-dialogs.js";
import { $, $$, h, clear, fmtBytes, debounce, clamp, isTypingTarget, copyText } from "./util.js";
import { mountIcons, toast, setStatus, iconEl, confirmDialog, promptDialog, closeModal } from "./ui.js";
import { readShareFromHash } from "./export.js";
import { healthSnapshot, configureRelay } from "./providers.js";

const VIEWS = ["studio", "storyboard", "timeline", "assets", "chat"];
const mounted = new Set();
let paletteItems = [];
let paletteIndex = 0;

boot();

async function boot() {
  document.documentElement.dataset.theme = state.theme;
  if (state.settings.reduceMotion) document.documentElement.classList.add("reduce-motion");
  configureRelay({ enabled: state.settings.relayEnabled, url: state.settings.relayUrl, token: state.settings.relayToken });
  mountIcons(document);
  wireShell();
  renderProjects();
  syncNav();
  setProjectName();
  await loadShareIfPresent();
  await ensureView(VIEWS.includes(state.view) ? state.view : "studio");
  syncNav();
  setStatus("Ready", "");
  updateFooter();
  updateStorage();
  subscribe(onStateChange);
  pipeline.subscribe(onPipelineEvent);
  setStorageErrorHandler(() => {
    toast("Browser storage is full. Export a project bundle, then clear old media in Settings → Workspace.", "bad", 10000);
    setStatus("Storage full", "bad");
  });
  window.addEventListener("beforeunload", () => flushSave());
  setInterval(updateStorage, 20000);
  window.addEventListener("online", () => { if (!pipeline.running) setStatus("Online · ready", "ok"); });
  window.addEventListener("offline", () => { if (!pipeline.running) setStatus("Offline · free providers unavailable", "warn"); });
}

/* ---------------- shell ---------------- */
function wireShell() {
  $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => switchView(btn.dataset.view)));

  $("btnMenu").addEventListener("click", () => {
    const open = $("rail").classList.toggle("open");
    $("btnMenu").setAttribute("aria-expanded", String(open));
  });
  $("railClose").addEventListener("click", () => { $("rail").classList.remove("open"); $("btnMenu").setAttribute("aria-expanded", "false"); });

  $("btnTheme").addEventListener("click", () => {
    setTheme(state.theme === "dark" ? "light" : "dark");
    toast(`${state.theme === "dark" ? "Dark" : "Light"} theme`, "ok", 1800);
  });

  $("btnSettings").addEventListener("click", openSettings);
  $("btnPalette").addEventListener("click", openPalette);
  $("btnHelp").addEventListener("click", openHelp);
  $("btnExport").addEventListener("click", () => openExportDialog({ renderer: studioRenderer() }));
  $("btnNewProject").addEventListener("click", newProjectFlow);

  const name = $("projectName");
  name.addEventListener("change", () => {
    const p = activeProject();
    if (!p) return;
    p.name = name.value.trim().slice(0, 80) || p.name;
    name.value = p.name;
    saveNow();
    renderProjects();
  });
  name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); name.blur(); } });

  $("fileImport").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (Array.isArray(obj.projects)) {
        importWorkspace(obj);
        toast("Workspace imported", "ok");
        location.reload();
      } else if (obj.brief) {
        importProject(obj);
        toast("Project imported", "ok");
        refreshAll();
      } else {
        throw new Error("Unrecognised file — expected a ZTC workspace or project export");
      }
    } catch (err) {
      toast(`Import failed: ${err.message}`, "bad", 7000);
    }
  });

  $("overlay").addEventListener("mousedown", (e) => { if (e.target.id === "overlay") hideOverlay(); });
  $("palette").addEventListener("mousedown", (e) => { if (e.target.id === "palette") closePalette(); });
  $("paletteInput").addEventListener("input", (e) => filterPalette(e.target.value));
  $("paletteInput").addEventListener("keydown", onPaletteKey);

  document.addEventListener("keydown", onGlobalKey);
}

function onGlobalKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
  if (e.key === "Escape") {
    if (!$("palette").hidden) closePalette();
    else if (!$("overlay").hidden) hideOverlay();
    return;
  }
  if (isTypingTarget(e.target) || !$("overlay").hidden || !$("palette").hidden) return;

  if (/^[1-5]$/.test(e.key) && !mod && !e.altKey) {
    switchView(VIEWS[Number(e.key) - 1]);
    return;
  }
  if (e.code === "Space" && state.view === "studio") {
    if (e.target.closest?.("button, a, input, select, textarea, [role='button']")) return;
    e.preventDefault();
    const btn = $("view-studio")?.querySelector(".play-btn");
    btn?.click();
    return;
  }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); const p = activeProject(); if (p) { snapshot("Manual save", p); toast("Version saved", "ok"); } return; }
  if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); openExportDialog({ renderer: studioRenderer() }); return; }
  if (mod && e.key === "Enter") { e.preventDefault(); runQuick(); return; }
}

async function runQuick() {
  const p = activeProject();
  if (!p) return;
  if (!p.brief.text.trim()) { toast("Write a brief first", "warn"); switchView("studio"); return; }
  snapshot("Before generation", p);
  try {
    await runPipeline(p, {
      stages: ["plan", "assets"],
      onProgress: ({ stage, pct }) => setStatus(stage === "plan" ? "Planning…" : "Producing…", "run"),
    });
    setStatus("Ready", "ok");
    toast("Production finished", "ok");
  } catch (e) {
    setStatus("Failed", "bad");
    toast(String(e.message || e), "bad", 7000);
  }
  refreshAll();
}

async function runRepair() {
  const p = activeProject();
  if (!p?.plan?.scenes?.length) { toast("Generate a plan first", "warn"); return; }
  if (pipeline.running) { toast("A generation is already running", "warn"); return; }
  setStatus("Repairing missing media…", "run");
  try {
    await repairProject(p, { onProgress: () => {} });
    setStatus("Ready", "ok");
    toast("Repair finished — check the provider log for fallbacks", "ok");
  } catch (e) {
    if (e?.name !== "AbortError") { setStatus("Repair failed", "bad"); toast(String(e.message || e), "bad", 7000); }
  }
  refreshAll();
}

/* ---------------- views ---------------- */
async function switchView(view) {
  if (!VIEWS.includes(view)) return;
  if (state.view === "studio" && view !== "studio") stopStudioPlayback();
  if (state.view === "timeline" && view !== "timeline") timelinePlaybackStop();
  setView(view);
  syncNav();
  await ensureView(view);
  $("rail").classList.remove("open");
  $("main").focus({ preventScroll: true });
  if (view === "storyboard") refreshBoard();
  if (view === "timeline") refreshTimeline();
  if (view === "assets") refreshAssets();
  if (view === "studio") refreshStudio();
}

async function ensureView(view) {
  const root = $(`view-${view}`);
  if (!root) return;
  for (const v of VIEWS) {
    const node = $(`view-${v}`);
    if (node) node.hidden = v !== view;
  }
  if (mounted.has(view)) return;
  mounted.add(view);
  if (view === "studio") mountStudio(root);
  else if (view === "storyboard") mountStoryboard(root);
  else if (view === "timeline") mountTimeline(root);
  else if (view === "assets") mountAssets(root);
  else if (view === "chat") mountChat(root);
}

function syncNav() {
  $$(".nav-item").forEach((btn) => {
    const on = btn.dataset.view === state.view;
    btn.classList.toggle("on", on);
    if (on) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  $$(".view").forEach((v) => { v.hidden = v.id !== `view-${state.view}`; });
}

/* ---------------- state ---------------- */
const refreshSoon = debounce(() => refreshAll(), 120);
function onStateChange(_s, reason) {
  if (reason === "project" || reason === "import") {
    renderProjects();
    setProjectName();
  }
  if (reason === "theme") document.documentElement.dataset.theme = state.theme;
  refreshSoon();
}

function refreshAll() {
  renderProjects();
  setProjectName();
  if (state.view === "studio") refreshStudio();
  if (state.view === "storyboard") refreshBoard();
  if (state.view === "timeline") refreshTimeline();
  if (state.view === "assets") refreshAssets();
  if (state.view === "chat") refreshChat();
  updateFooter();
  updateStorage();
  updateVersionChip();
}

function onPipelineEvent(entry) {
  if (!entry) return;
  const cls = entry.level === "fail" ? "bad" : entry.level === "warn" ? "warn" : entry.level === "ok" ? "ok" : "run";
  if (entry.level === "ok" || entry.level === "fail" || entry.level === "warn") setStatus(entry.text.slice(0, 90), cls);
}

/* ---------------- projects ---------------- */
function renderProjects() {
  const list = $("projectList");
  if (!list) return;
  clear(list);
  state.projects.forEach((p) => {
    const item = h("div", {
      class: `project-item${p.id === state.activeProject ? " on" : ""}`,
      role: "listitem", tabindex: "0",
      onclick: () => {
        if (pipeline.running) { toast("Stop the current generation first", "warn"); return; }
        selectProject(p.id);
        renderProjects();
        setProjectName();
        refreshAll();
        switchView("studio");
      },
      onkeydown: (e) => { if (e.key === "Enter") e.currentTarget.click(); },
    }, [
      h("span", { class: "p-name", text: p.name }),
      h("span", { class: "p-count", text: String(p.plan?.scenes?.length || 0) }),
      h("button", {
        class: "p-del", type: "button", text: "×", "aria-label": `Delete ${p.name}`,
        onclick: async (e) => {
          e.stopPropagation();
          if (pipeline.running) { toast("Stop the current generation first", "warn"); return; }
          const ok = await confirmDialog({ title: "Delete project?", message: `“${p.name}” and its timeline will be removed. Generated media stays in browser storage until you clean it.`, okLabel: "Delete", danger: true });
          if (!ok) return;
          deleteProject(p.id);
          refreshAll();
          toast("Project deleted", "ok");
        },
      }),
    ]);
    list.appendChild(item);
  });
}

function setProjectName() {
  const p = activeProject();
  const input = $("projectName");
  if (p && input && document.activeElement !== input) input.value = p.name;
  updateVersionChip();
}

function updateVersionChip() {
  const p = activeProject();
  const chip = $("versionChip");
  if (!p || !chip) return;
  const v = p.versions?.[0];
  chip.hidden = !v;
  if (v) {
    chip.textContent = `${v.name} · ${new Date(v.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    chip.title = "Open versions";
    chip.onclick = openVersions;
    chip.style.cursor = "pointer";
  }
}

async function newProjectFlow() {
  const name = await promptDialog({ title: "New project", label: "Project name", value: `Project ${state.projects.length + 1}`, placeholder: "e.g. Spring product film" });
  if (!name) return;
  addProject(name);
  renderProjects();
  setProjectName();
  await switchView("studio");
  refreshStudio();
  toast("Project created", "ok");
}

async function updateStorage() {
  const meter = $("storageMeter");
  if (!meter) return;
  const { used, quota } = await storageUsage();
  const pct = quota ? clamp((used / quota) * 100, 1, 100) : 2;
  meter.querySelector("i").style.width = `${pct}%`;
  meter.querySelector("small").textContent = quota ? `${fmtBytes(used)} of ${fmtBytes(quota)}` : fmtBytes(used);
  meter.title = "Generated media is stored in this browser (IndexedDB). Export a bundle to keep a copy.";
}

function updateFooter() {
  const note = $("footNote");
  if (!note) return;
  const p = activeProject();
  const healthy = healthSnapshot().filter((x) => x.ok).length;
  const parts = [`${p?.plan?.scenes?.length || 0} scenes`, `${healthy} provider${healthy === 1 ? "" : "s"} responsive`, "no keys embedded"];
  note.textContent = parts.join(" · ");
}

/* ---------------- share import ---------------- */
async function loadShareIfPresent() {
  try {
    const data = await readShareFromHash();
    if (!data) return;
    importProject({ ...data, name: `${data.name || "Shared project"} (shared)` });
    history.replaceState(null, "", location.pathname + location.search);
    toast("Shared project loaded — media will regenerate on this device", "ok", 6000);
    renderProjects();
    setProjectName();
  } catch (e) {
    toast(`Could not open shared project: ${e.message}`, "bad", 7000);
  }
}

/* ---------------- command palette ---------------- */
function actions() {
  const p = activeProject();
  const list = [
    { label: "Studio", hint: "view", run: () => switchView("studio") },
    { label: "Storyboard", hint: "view", run: () => switchView("storyboard") },
    { label: "Timeline", hint: "view", run: () => switchView("timeline") },
    { label: "Assets", hint: "view", run: () => switchView("assets") },
    { label: "AI chat", hint: "view", run: () => switchView("chat") },
    { label: "Generate plan", hint: "action", run: () => { switchView("studio"); setTimeout(() => startStudioGeneration("plan"), 120); } },
    { label: "Generate everything (plan + assets)", hint: "action", run: runQuick },
    { label: "Repair missing media", hint: "action", run: runRepair },
    { label: "Export & render", hint: "action", run: () => openExportDialog({ renderer: studioRenderer() }) },
    { label: "Save version", hint: "action", run: () => { if (p) { snapshot("Manual save", p); toast("Version saved", "ok"); } } },
    { label: "Versions", hint: "action", run: openVersions },
    { label: "Settings", hint: "action", run: openSettings },
    { label: "Provider registry", hint: "action", run: openProviders },
    { label: "Shortcuts & limits", hint: "action", run: openHelp },
    { label: "New project", hint: "action", run: newProjectFlow },
    { label: "Import project or workspace", hint: "action", run: () => $("fileImport").click() },
    { label: `Switch to ${state.theme === "dark" ? "light" : "dark"} theme`, hint: "action", run: () => $("btnTheme").click() },
    { label: "Copy current brief", hint: "action", run: () => copyText(p?.brief?.text || "").then(() => toast("Brief copied", "ok")) },
    { label: "Copy script", hint: "action", run: () => copyText(p?.plan?.script || "").then(() => toast("Script copied", "ok")) },
  ];
  state.projects.forEach((pr) => list.push({ label: `Project: ${pr.name}`, hint: "project", run: () => { selectProject(pr.id); renderProjects(); refreshAll(); switchView("studio"); } }));
  (p?.plan?.scenes || []).forEach((s, i) => list.push({ label: `Scene ${i + 1}: ${s.title}`, hint: "scene", run: () => switchView("storyboard") }));
  return list;
}

function openPalette() {
  const box = $("palette");
  box.hidden = false;
  $("paletteInput").value = "";
  filterPalette("");
  setTimeout(() => $("paletteInput").focus(), 20);
}
function closePalette() { $("palette").hidden = true; }

function filterPalette(q) {
  const items = actions();
  const term = String(q || "").toLowerCase().trim();
  paletteItems = term ? items.filter((a) => a.label.toLowerCase().includes(term) || a.hint.includes(term)) : items;
  paletteIndex = 0;
  paintPalette();
}

function paintPalette() {
  const list = $("paletteList");
  list.replaceChildren();
  if (!paletteItems.length) {
    list.append(h("div", { class: "pal-item", text: "No matching command" }));
    return;
  }
  paletteItems.slice(0, 40).forEach((item, i) => {
    const row = h("div", {
      class: `pal-item${i === paletteIndex ? " sel" : ""}`, role: "option", "aria-selected": String(i === paletteIndex),
      onmousemove: () => { if (paletteIndex !== i) { paletteIndex = i; paintPalette(); } },
      onclick: () => { closePalette(); item.run(); },
    }, [h("span", { text: item.label }), h("span", { class: "pal-kind", text: item.hint })]);
    list.appendChild(row);
  });
}

function onPaletteKey(e) {
  if (e.key === "ArrowDown") { e.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, paletteItems.length - 1); paintPalette(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); paletteIndex = Math.max(paletteIndex - 1, 0); paintPalette(); }
  else if (e.key === "Enter") { e.preventDefault(); const item = paletteItems[paletteIndex]; closePalette(); item?.run(); }
}

function hideOverlay() {
  closeModal();
}
