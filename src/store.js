/* ZTC AI Studio — state, persistence, media store and versioning.

   Project data (small) lives in localStorage. Generated media (large) lives in
   IndexedDB and is referenced by id, so autosave stays fast and exports can
   bundle the real files. */

import { clamp, uid, debounce } from "./util.js";
import { STYLES, ASPECTS, MOODS } from "./catalog.js";

export const APP_KEY = "ztc.studio.v1";
const DB_NAME = "ztc-studio";
const DB_VERSION = 1;
const HAS_STORAGE = (() => { try { return typeof localStorage !== "undefined" && !!localStorage; } catch { return false; } })();

const styleOf = (id) => STYLES.find((s) => s.id === id) || STYLES[0];

export const DEFAULT_SETTINGS = {
  aspect: "16:9",
  quality: "standard",
  fps: 30,
  duration: 60,
  quantity: 1,
  variants: 1,
  styleId: "cinematic3d",
  template: "explainer",
  tone: "clear",
  audience: "",
  language: "English",
  imageModel: "Flux.1-Schnell fp8 (Compact)",
  voice: "Joanna",
  voiceRate: 1,
  musicMood: "cinematic",
  musicVolume: 0.2,
  voiceVolume: 1,
  transition: "fade",
  effects: ["grain", "vignette", "bloom"],
  captions: { enabled: true, position: "bottom", style: "bar", maxChars: 64 },
  branding: { presetId: "redline", name: "", tagline: "", color: "#ff304f", watermark: true, intro: true, outro: true },
  autoEnhance: true,
  aiPlan: true,
  autoAssets: true,
};

export const newProject = (overrides = {}) => {
  const now = Date.now();
  return {
    id: uid("prj"),
    name: overrides.name || "Untitled project",
    createdAt: now,
    updatedAt: now,
    brief: {
      text: "",
      template: "explainer",
      tone: "clear",
      audience: "",
      language: "English",
      duration: 60,
      quantity: 1,
      variants: 1,
      aspect: "16:9",
      styleId: "cinematic3d",
    },
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    plan: { title: "", logline: "", script: "", scenes: [], chapters: [] },
    pipeline: {},
    versions: [],
    chat: [],
    ...overrides,
  };
};

const DEFAULT_STATE = () => ({
  schema: 1,
  theme: "dark",
  view: "studio",
  activeProject: null,
  projects: [],
  settings: {
    keys: {},
    enabled: {},
    allowPuter: true,
    ttsEndpoint: "",
    ttsEndpointToken: "",
    musicEndpoint: "",
    hordeKey: "0000000000",
    cloudflareAccountId: "",
    relayEnabled: false,
    relayUrl: "",
    relayToken: "",
    reduceMotion: false,
    keepAudio: true,
  },
  stats: { renders: 0, lastRenderAt: 0 },
});

function normalizeProject(p) {
  const base = newProject();
  const out = { ...base, ...p };
  out.brief = { ...base.brief, ...(p?.brief || {}) };
  out.settings = { ...base.settings, ...(p?.settings || {}) };
  out.settings.captions = { ...base.settings.captions, ...(p?.settings?.captions || {}) };
  out.settings.branding = { ...base.settings.branding, ...(p?.settings?.branding || {}) };
  out.settings.duration = clamp(Number(out.settings.duration) || 60, 20, 300);
  out.settings.fps = [24, 30, 60].includes(Number(out.settings.fps)) ? Number(out.settings.fps) : 30;
  out.brief.duration = clamp(Number(out.brief.duration) || out.settings.duration, 20, 300);
  out.plan = { title: "", logline: "", script: "", scenes: [], chapters: [], ...(p?.plan || {}) };
  out.plan.scenes = Array.isArray(out.plan.scenes) ? out.plan.scenes : [];
  out.plan.chapters = Array.isArray(out.plan.chapters) ? out.plan.chapters : [];
  out.pipeline = p?.pipeline && typeof p.pipeline === "object" ? p.pipeline : {};
  out.versions = Array.isArray(p?.versions) ? p.versions.slice(0, 20) : [];
  out.chat = Array.isArray(p?.chat) ? p.chat.slice(-120) : [];
  if (!ASPECTS[out.settings.aspect]) out.settings.aspect = "16:9";
  if (!MOODS[out.settings.musicMood]) out.settings.musicMood = "cinematic";
  out.settings.styleId = styleOf(out.settings.styleId).id;
  out.updatedAt = Number(out.updatedAt) || Date.now();
  return out;
}

function normalize(raw) {
  const base = DEFAULT_STATE();
  const src = raw && typeof raw === "object" ? raw : {};
  const out = { ...base, ...src };
  out.settings = { ...base.settings, ...(src.settings || {}), keys: { ...(src.settings?.keys || {}) }, enabled: { ...(src.settings?.enabled || {}) } };
  out.projects = (Array.isArray(src.projects) ? src.projects : []).filter((p) => p && typeof p.id === "string").slice(0, 30).map(normalizeProject);
  if (!out.projects.length) out.projects = [newProject({ name: "First project" })];
  if (!out.projects.some((p) => p.id === out.activeProject)) out.activeProject = out.projects[0].id;
  if (!["studio", "storyboard", "timeline", "assets", "chat"].includes(out.view)) out.view = "studio";
  if (!["dark", "light"].includes(out.theme)) out.theme = "dark";
  return out;
}

export let state = load();
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emit(reason = "change") {
  for (const fn of listeners) {
    try { fn(state, reason); } catch (e) { console.error(e); }
  }
}

function load() {
  if (!HAS_STORAGE) return normalize(null);
  try {
    const raw = localStorage.getItem(APP_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn("Could not read saved state:", e);
  }
  return normalize(null);
}

export let storageError = null;
let onStorageError = null;
let storageErrorReported = false;

/** Register a one-shot handler so a quota failure is visible, not silent. */
export function setStorageErrorHandler(fn) { onStorageError = fn; }

export const saveNow = () => {
  if (!HAS_STORAGE) return true;
  try {
    localStorage.setItem(APP_KEY, JSON.stringify(state));
    storageError = null;
    storageErrorReported = false;
    return true;
  } catch (e) {
    storageError = e;
    console.warn("Save failed:", e);
    if (!storageErrorReported && onStorageError) {
      storageErrorReported = true;
      try { onStorageError(e); } catch { /* handler must not throw */ }
    }
    return false;
  }
};
export const save = debounce(saveNow, 320);
/** Flush pending edits (used on unload and before exports). */
export const flushSave = () => { try { save.flush(); } catch { saveNow(); } };

export const activeProject = () => state.projects.find((p) => p.id === state.activeProject) || state.projects[0] || null;

export function touch(project = activeProject()) {
  if (project) project.updatedAt = Date.now();
  save();
}

export function addProject(name) {
  const p = newProject({ name: name || `Project ${state.projects.length + 1}` });
  state.projects.unshift(p);
  state.activeProject = p.id;
  saveNow();
  emit("project");
  return p;
}

export function deleteProject(id) {
  state.projects = state.projects.filter((p) => p.id !== id);
  if (!state.projects.length) state.projects = [newProject({ name: "First project" })];
  if (state.activeProject === id) state.activeProject = state.projects[0].id;
  saveNow();
  emit("project");
}

export function selectProject(id) {
  if (!state.projects.some((p) => p.id === id)) return;
  state.activeProject = id;
  saveNow();
  emit("project");
}

export function setView(view) {
  state.view = view;
  save();
  emit("view");
}

export function setTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  if (typeof document !== "undefined") document.documentElement.dataset.theme = state.theme;
  saveNow();
  emit("theme");
}

/* ---------------- scenes ---------------- */
export const scenesOf = (project = activeProject()) => project?.plan?.scenes || [];

export function updateScene(id, patch, project = activeProject()) {
  const s = scenesOf(project).find((x) => x.id === id);
  if (!s) return null;
  Object.assign(s, patch);
  touch(project);
  return s;
}

export function addScene(afterId = null, project = activeProject()) {
  const scenes = scenesOf(project);
  const idx = afterId ? scenes.findIndex((s) => s.id === afterId) + 1 : scenes.length;
  const scene = {
    id: uid("sc"), title: `Scene ${scenes.length + 1}`, beat: "Beat",
    narration: "", visual: "", duration: 6, motion: "zoom-in", transition: "fade",
    styleId: project.settings.styleId, imageId: null, voiceId: null, voiceDur: 0, status: {}, provider: {},
  };
  scenes.splice(idx, 0, scene);
  touch(project);
  emit("scenes");
  return scene;
}

export function removeScene(id, project = activeProject()) {
  project.plan.scenes = scenesOf(project).filter((s) => s.id !== id);
  touch(project);
  emit("scenes");
}

export function moveScene(id, delta, project = activeProject()) {
  const scenes = scenesOf(project);
  const i = scenes.findIndex((s) => s.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= scenes.length) return false;
  const [s] = scenes.splice(i, 1);
  scenes.splice(j, 0, s);
  touch(project);
  emit("scenes");
  return true;
}

/* ---------------- versions ---------------- */
export function snapshot(name = "", project = activeProject()) {
  if (!project) return null;
  const data = {
    name: project.name,
    brief: JSON.parse(JSON.stringify(project.brief)),
    settings: JSON.parse(JSON.stringify(project.settings)),
    plan: JSON.parse(JSON.stringify(project.plan)),
  };
  const v = { id: uid("v"), name: name || `Version ${project.versions.length + 1}`, at: Date.now(), data };
  project.versions.unshift(v);
  if (project.versions.length > 20) project.versions.length = 20;
  saveNow();
  emit("versions");
  return v;
}

export function restoreVersion(versionId, project = activeProject()) {
  const v = project?.versions?.find((x) => x.id === versionId);
  if (!v) return false;
  project.brief = JSON.parse(JSON.stringify(v.data.brief));
  project.settings = JSON.parse(JSON.stringify(v.data.settings));
  project.plan = JSON.parse(JSON.stringify(v.data.plan));
  project.name = v.data.name || project.name;
  touch(project);
  emit("versions");
  return true;
}

export function deleteVersion(versionId, project = activeProject()) {
  project.versions = project.versions.filter((v) => v.id !== versionId);
  saveNow();
  emit("versions");
}

/* ---------------- assets (IndexedDB) ---------------- */
let dbPromise = null;
let memoryFallback = null;
const urlCache = new Map();

function openDb() {
  if (memoryFallback) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { memoryFallback = new Map(); resolve(null); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("assets")) {
        const store = db.createObjectStore("assets", { keyPath: "id" });
        store.createIndex("projectId", "projectId");
        store.createIndex("cacheKey", "cacheKey");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { memoryFallback = new Map(); resolve(null); };
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction("assets", mode);
    const store = t.objectStore("assets");
    let result;
    try { result = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function putAsset({ blob, kind, name, projectId, meta = {}, cacheKey = "" }) {
  const asset = {
    id: uid("as"), kind, name: name || `${kind}-${Date.now()}`,
    mime: blob?.type || meta.mime || "application/octet-stream",
    size: blob?.size || 0, blob, projectId: projectId || state.activeProject,
    meta, cacheKey, createdAt: Date.now(),
  };
  const db = await openDb();
  if (!db) {
    memoryFallback = memoryFallback || new Map();
    memoryFallback.set(asset.id, asset);
    return asset;
  }
  await tx("readwrite", (store) => { store.put(asset); });
  return asset;
}

export async function getAsset(id) {
  if (!id) return null;
  if (memoryFallback) return memoryFallback.get(id) || null;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const req = db.transaction("assets", "readonly").objectStore("assets").get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function assetUrl(id) {
  if (!id) return "";
  if (urlCache.has(id)) return urlCache.get(id);
  const a = await getAsset(id);
  if (!a?.blob) return "";
  const url = URL.createObjectURL(a.blob);
  urlCache.set(id, url);
  return url;
}

export async function findCached(cacheKey) {
  if (!cacheKey) return null;
  if (memoryFallback) return [...memoryFallback.values()].find((a) => a.cacheKey === cacheKey) || null;
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const req = db.transaction("assets", "readonly").objectStore("assets").index("cacheKey").get(cacheKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function listAssets(projectId) {
  if (memoryFallback) return [...memoryFallback.values()].filter((a) => !projectId || a.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve, reject) => {
    const store = db.transaction("assets", "readonly").objectStore("assets");
    const req = projectId ? store.index("projectId").getAll(projectId) : store.getAll();
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.createdAt - a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAsset(id) {
  const url = urlCache.get(id);
  if (url) { URL.revokeObjectURL(url); urlCache.delete(id); }
  if (memoryFallback) { memoryFallback.delete(id); return; }
  await tx("readwrite", (store) => { store.delete(id); });
}

export async function clearProjectAssets(projectId) {
  const list = await listAssets(projectId);
  for (const a of list) await deleteAsset(a.id);
  return list.length;
}

/** True only when the asset really exists — guards against dangling ids. */
export async function hasAsset(id) {
  if (!id) return false;
  try { return !!(await getAsset(id))?.blob; } catch { return false; }
}

export async function storageUsage() {
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) return { used: est.usage || 0, quota: est.quota || 0 };
  } catch { /* ignore */ }
  return { used: new Blob([JSON.stringify(state)]).size, quota: 5 * 1024 * 1024 };
}

/* ---------------- backup / import ---------------- */
export function exportWorkspace() {
  const copy = JSON.parse(JSON.stringify(state));
  copy.settings.keys = {};
  copy.settings.ttsEndpointToken = "";
  return copy;
}

export function importWorkspace(obj) {
  const next = normalize(obj);
  state = next;
  document.documentElement.dataset.theme = state.theme;
  saveNow();
  emit("import");
  return state;
}

export function importProject(obj) {
  if (!obj || typeof obj !== "object" || !obj.brief) throw new Error("Not a ZTC project file");
  const p = normalizeProject({ ...obj, id: uid("prj"), versions: [], chat: [] });
  p.name = obj.name || p.name || "Imported project";
  state.projects.unshift(p);
  state.activeProject = p.id;
  saveNow();
  emit("project");
  return p;
}

export function ensureSceneDefaults(project = activeProject()) {
  if (!project) return;
  const style = styleOf(project.settings.styleId);
  for (const s of scenesOf(project)) {
    if (!s.motion) s.motion = "zoom-in";
    if (!s.transition) s.transition = style.transition;
    if (!s.status) s.status = {};
    if (!s.provider) s.provider = {};
  }
}
