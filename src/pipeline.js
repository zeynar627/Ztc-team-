/* ZTC AI Studio — production pipeline.

   Stages: brief → plan → images → voices → music → ready.
   Every stage is resumable, every generated asset is content-addressed and
   reused, and any provider failure is repaired by falling back to the next
   provider without discarding finished work. */

import { state, putAsset, findCached, touch, saveNow, emit, hasAsset } from "./store.js";
import { generateImage, generateVoice, decodeAudio, imageCacheKey, voiceCacheKey } from "./media.js";
import { aiPlan, draftPlan, mergePlan, validatePlan, correctBrief, enhanceBrief, variantBrief, rebalance, ANGLE_LABELS, styleById, templateById, topicOf } from "./generate.js";
import { frameSize } from "./render.js";
import { ASPECTS, TEMPLATES, STYLES } from "./catalog.js";
import { clamp, hashString, uid, sleep } from "./util.js";

const MAX_LOG = 240;

export const pipeline = {
  running: false,
  stage: "",
  ctl: null,
  log: [],
  listeners: new Set(),
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
  emit(evt) {
    const entry = { at: Date.now(), level: evt.level || "info", text: String(evt.text || "") };
    this.log.push(entry);
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
    for (const fn of this.listeners) {
      try { fn(entry, this.log); } catch (e) { console.error(e); }
    }
  },
  reset() { this.log = []; for (const fn of this.listeners) fn(null, this.log); },
  abort() {
    if (this.ctl) this.ctl.abort();
    this.running = false;
    this.stage = "";
    this.emit({ level: "warn", text: "cancelled by user — completed steps are kept" });
  },
};

const newCtl = () => {
  if (pipeline.ctl) pipeline.ctl.abort();
  pipeline.ctl = new AbortController();
  return pipeline.ctl;
};

const stageState = (project, key, state) => {
  project.pipeline = project.pipeline || {};
  project.pipeline[key] = { ...(project.pipeline[key] || {}), ...state, at: Date.now() };
  touch(project);
};

export const stageStatus = (project, key) => project?.pipeline?.[key]?.status || "idle";

/* ---------------- planning ---------------- */
export async function runPlan(project, { ai = null, enhance = null, signal } = {}) {
  const useAi = ai ?? project.settings.aiPlan;
  const useEnhance = enhance ?? project.settings.autoEnhance;
  if (!String(project.brief.text || "").trim()) throw new Error("Write a brief first — one or two sentences is enough.");

  pipeline.emit({ level: "info", text: "brief: checking for gaps and ambiguity" });
  const corrected = await correctBrief(project.brief.text, { settings: state.settings, signal });
  project.brief.corrected = corrected.text;
  stageState(project, "brief", { status: "done", provider: corrected.provider, issues: corrected.issues });

  if (useEnhance) {
    pipeline.emit({ level: "info", text: `brief: expanding direction (${corrected.ai ? "AI" : "local rules"})` });
    const enhanced = await enhanceBrief(project.brief.text, {
      settings: state.settings, signal,
      template: project.brief.template, tone: project.brief.tone,
      audience: project.brief.audience, duration: project.brief.duration,
    });
    project.brief.enhanced = enhanced.text;
    project.brief.hooks = enhanced.hooks || [];
    pipeline.emit({ level: enhanced.ai ? "ok" : "warn", text: enhanced.ai ? `brief expanded by ${enhanced.provider}` : "brief expanded with local rules (no LLM available)" });
  }

  // The topic always comes from the author's brief, never from the expansion
  // text — otherwise the subject turns into "a 1-minute video about your brief".
  const planBrief = {
    ...project.brief,
    text: project.brief.corrected || project.brief.text,
    direction: project.brief.enhanced || "",
  };

  pipeline.emit({ level: "info", text: useAi ? "plan: writing script and storyboard with AI" : "plan: writing script with the local template writer" });
  let result = null;
  let provider = "local writer";
  let issues = [];

  if (useAi) {
    try {
      const r = await aiPlan(planBrief, {
        settings: state.settings, signal, existing: project.plan, variant: 0,
        onEvent: (e) => pipeline.emit(e),
      });
      result = r.plan;
      provider = r.provider;
      issues = r.issues || [];
      pipeline.emit({ level: "ok", text: `plan written by ${provider}` });
    } catch (e) {
      if (e?.name === "AbortError" || signal?.aborted) throw e;
      pipeline.emit({ level: "fail", text: `AI planning failed: ${String(e.message || e).slice(0, 180)}` });
      pipeline.emit({ level: "warn", text: "falling back to the built-in template writer — no work lost" });
    }
  }

  if (!result) {
    result = draftPlan(planBrief);
    pipeline.emit({ level: "ok", text: `plan written locally · ${result.scenes.length} scenes` });
  }

  const merged = mergePlan(project.plan, result);
  const validated = validatePlan(merged, { duration: project.brief.duration });
  project.plan = validated.plan;
  project.settings.duration = Math.round(validated.plan.scenes.reduce((n, s) => n + s.duration, 0));
  if (!project.settings.branding.name) project.settings.branding.name = project.name;
  stageState(project, "plan", { status: "done", provider, sceneCount: project.plan.scenes.length, issues: validated.issues });
  project.plan.scenes.forEach((s) => { if (!s.seed) s.seed = hashString(`${s.id}-${s.visual}`); });
  saveNow();
  return { provider, issues: validated.issues.concat(issues) };
}

/* ---------------- assets ---------------- */
function sizeFor(project) {
  const aspect = ASPECTS[project.settings.aspect] || ASPECTS["16:9"];
  const base = 1024;
  const ratio = aspect.w / aspect.h;
  return ratio >= 1 ? { width: base, height: Math.round(base / ratio) } : { width: Math.round(base * ratio), height: base };
}

export async function generateSceneImage(project, scene, { signal, force = false } = {}) {
  const style = styleById(scene.styleId || project.settings.styleId);
  const { width, height } = sizeFor(project);
  const seed = force ? Math.floor(Math.random() * 1e6) : Number(scene.seed) || hashString(scene.id) % 100000;
  if (force) scene.seed = seed;
  const prompt = String(scene.visual || scene.title || project.brief.text || "").slice(0, 1200);
  const cacheKey = imageCacheKey({ prompt, styleId: style.id, model: project.settings.imageModel, width, height, seed });

  if (!force) {
    const cached = await findCached(cacheKey);
    if (cached) {
      scene.imageId = cached.id;
      scene.status = { ...(scene.status || {}), image: "done" };
      scene.provider = { ...(scene.provider || {}), image: `${cached.meta?.provider || "cache"} (cached)` };
      touch(project);
      return { cached: true, provider: "cache" };
    }
  }

  scene.status = { ...(scene.status || {}), image: "running" };
  touch(project);
  const result = await generateImage({
    prompt, negative: style.negative, width, height, seed,
    model: project.settings.imageModel, styleId: style.id,
    settings: state.settings, signal,
    onEvent: (e) => pipeline.emit({ ...e, text: `image: ${e.text}` }),
  });

  const asset = await putAsset({
    blob: result.blob, kind: "image", projectId: project.id,
    name: `${scene.title || "scene"} ${seed}`,
    meta: { prompt, style: style.id, seed, provider: result.providerName, model: result.meta?.model, width: width, height: height },
    cacheKey,
  });
  scene.imageId = asset.id;
  scene.status = { ...(scene.status || {}), image: "done" };
  scene.provider = { ...(scene.provider || {}), image: result.providerName };
  scene.stale = false;
  touch(project);
  return { provider: result.providerName, asset };
}

export async function generateSceneVoice(project, scene, { signal } = {}) {
  const text = String(scene.narration || "").trim();
  if (!text) {
    scene.status = { ...(scene.status || {}), voice: "skipped" };
    touch(project);
    return { skipped: true };
  }
  const voice = project.settings.voice || "Joanna";
  const cacheKey = voiceCacheKey({ text, voice });
  const cached = await findCached(cacheKey);
  if (cached) {
    scene.voiceId = cached.id;
    scene.voiceDur = Number(cached.meta?.duration) || 0;
    scene.status = { ...(scene.status || {}), voice: "done" };
    scene.provider = { ...(scene.provider || {}), voice: `${cached.meta?.provider || "cache"} (cached)` };
    touch(project);
    return { cached: true };
  }

  scene.status = { ...(scene.status || {}), voice: "running" };
  touch(project);
  try {
    const result = await generateVoice({
      text, voice, settings: state.settings, signal,
      onEvent: (e) => pipeline.emit({ ...e, text: `voice: ${e.text}` }),
    });
    let duration = 0;
    try { duration = (await decodeAudio(result.blob)).duration; } catch { duration = 0; }
    const asset = await putAsset({
      blob: result.blob, kind: "voice", projectId: project.id,
      name: `${scene.title || "scene"} · ${voice}`,
      meta: { text, voice, duration, provider: result.providerName },
      cacheKey,
    });
    scene.voiceId = asset.id;
    scene.voiceDur = Math.round(duration * 10) / 10;
    scene.status = { ...(scene.status || {}), voice: "done" };
    scene.provider = { ...(scene.provider || {}), voice: result.providerName };
    touch(project);
    return { provider: result.providerName, duration };
  } catch (e) {
    if (e?.name === "AbortError" || signal?.aborted) throw e;
    scene.status = { ...(scene.status || {}), voice: "failed" };
    scene.provider = { ...(scene.provider || {}), voice: "unavailable" };
    scene.error = String(e.message || e).slice(0, 240);
    touch(project);
    pipeline.emit({ level: "fail", text: `voice for “${scene.title}” unavailable: ${String(e.message || e).slice(0, 140)}` });
    return { error: String(e.message || e) };
  }
}

/**
 * Generate images and/or voices for the project.
 * onlyMissing skips scenes that already have the asset; force regenerates.
 */
export async function runAssets(project, { images = true, voices = true, onlyMissing = true, force = false, signal, onProgress = () => {} } = {}) {
  const scenes = project.plan?.scenes || [];
  if (!scenes.length) throw new Error("Generate a plan first — there are no scenes to illustrate.");
  // IndexedDB can evict blobs (quota pressure, "clear site data", Safari ITP).
  // Treat a dangling id as missing instead of silently shipping a broken scene.
  const jobs = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (images) {
      const present = s.imageId ? await hasAsset(s.imageId) : false;
      if (!present) {
        if (s.imageId) pipeline.emit({ level: "warn", text: `scene ${i + 1}: stored image is gone — regenerating` });
        s.imageId = null;
        s.status = { ...(s.status || {}), image: "idle" };
      }
      if (force || !present) jobs.push({ type: "image", scene: s, i });
    }
    if (voices && String(s.narration || "").trim()) {
      const present = s.voiceId ? await hasAsset(s.voiceId) : false;
      if (!present && s.voiceId) {
        pipeline.emit({ level: "warn", text: `scene ${i + 1}: stored voice-over is gone — regenerating` });
        s.voiceId = null;
        s.voiceDur = 0;
        s.status = { ...(s.status || {}), voice: "idle" };
      }
      if (force || !present) jobs.push({ type: "voice", scene: s, i });
    }
  }

  if (!jobs.length) {
    pipeline.emit({ level: "info", text: "all assets already exist — reusing them" });
    return { done: 0, total: 0 };
  }

  let done = 0;
  const failures = [];
  for (const job of jobs) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      if (job.type === "image") await generateSceneImage(project, job.scene, { signal, force });
      else await generateSceneVoice(project, job.scene, { signal });
      done++;
    } catch (e) {
      if (e?.name === "AbortError" || signal?.aborted) throw e;
      failures.push({ scene: job.scene.title, type: job.type, error: String(e.message || e) });
      pipeline.emit({ level: "fail", text: `${job.type} ${job.i + 1}/${scenes.length} failed: ${String(e.message || e).slice(0, 150)}` });
      done++;
    }
    onProgress(done / jobs.length, job.i + 1, scenes.length, job.type);
    saveNow();
    await sleep(120);
  }

  const imgs = scenes.filter((s) => s.imageId).length;
  const vo = scenes.filter((s) => s.voiceId).length;
  stageState(project, "images", { status: imgs === scenes.length ? "done" : imgs ? "partial" : "failed", done: imgs, total: scenes.length });
  stageState(project, "voices", { status: vo === scenes.length ? "done" : vo ? "partial" : "failed", done: vo, total: scenes.length });
  if (vo) {
    rebalance(scenes, Number(project.brief.duration) || project.settings.duration || 60);
    project.settings.duration = Math.round(scenes.reduce((n, s) => n + s.duration, 0));
  }
  touch(project);
  saveNow();
  pipeline.emit({
    level: failures.length ? "warn" : "ok",
    text: `assets ready · ${imgs}/${scenes.length} images · ${vo}/${scenes.length} voice-overs${failures.length ? ` · ${failures.length} failed (fallbacks used where possible)` : ""}`,
  });
  return { done, total: jobs.length, failures };
}

/* ---------------- full run ---------------- */
export async function runPipeline(project, { stages = ["plan", "assets"], force = false, onProgress = () => {} } = {}) {
  if (pipeline.running) throw new Error("A generation is already running");
  pipeline.running = true;
  const ctl = newCtl();
  const signal = ctl.signal;
  const started = Date.now();
  try {
    if (stages.includes("plan")) {
      pipeline.stage = "plan";
      onProgress({ stage: "plan", pct: 0.05 });
      await runPlan(project, { signal });
      onProgress({ stage: "plan", pct: 0.2 });
    }
    if (stages.includes("assets")) {
      pipeline.stage = "assets";
      await runAssets(project, {
        signal, force, onlyMissing: !force,
        onProgress: (p) => onProgress({ stage: "assets", pct: 0.2 + p * 0.75 }),
      });
    }
    pipeline.emit({ level: "ok", text: `pipeline finished in ${Math.round((Date.now() - started) / 1000)}s` });
    onProgress({ stage: "ready", pct: 1 });
    return { ok: true };
  } catch (e) {
    if (e?.name === "AbortError") {
      pipeline.emit({ level: "warn", text: "stopped — completed steps are saved and can be resumed" });
      return { ok: false, aborted: true };
    }
    pipeline.emit({ level: "fail", text: `pipeline stopped: ${String(e.message || e).slice(0, 220)}` });
    throw e;
  } finally {
    pipeline.running = false;
    pipeline.stage = "";
    pipeline.ctl = null;
    saveNow();
  }
}

/* ---------------- variants / batch ---------------- */
export function cloneProject(source, { name, variant = 0 } = {}) {
  const clone = JSON.parse(JSON.stringify(source));
  clone.id = uid("prj");
  clone.name = name || `${source.name} · v${variant + 1}`;
  clone.createdAt = Date.now();
  clone.updatedAt = Date.now();
  clone.versions = [];
  clone.pipeline = {};
  clone.chat = [];
  clone.plan.scenes = clone.plan.scenes.map((s) => ({ ...s, id: uid("sc"), imageId: null, voiceId: null, voiceDur: 0, status: {}, provider: {}, stale: false, seed: null }));
  return clone;
}

export async function buildVariant(source, i, { ai = false, signal } = {}) {
  const brief = variantBrief(source.brief, i);
  const clone = cloneProject(source, { variant: i, name: `${source.name} · ${ANGLE_LABELS[i % ANGLE_LABELS.length]}` });
  clone.brief = { ...clone.brief, ...brief, angle: ANGLE_LABELS[i % ANGLE_LABELS.length] };
  clone.plan = { title: "", logline: "", script: "", scenes: [], chapters: [] };
  if (ai) {
    await runPlan(clone, { ai: true, enhance: false, signal });
  } else {
    const plan = draftPlan(clone.brief, { variant: i });
    clone.plan = validatePlan(plan, { duration: clone.brief.duration }).plan;
    stageState(clone, "plan", { status: "done", provider: "local writer" });
  }
  clone.plan.scenes.forEach((s) => { s.seed = hashString(`${s.id}-${s.visual}-${i}`) % 100000; });
  return clone;
}

/** Create N angle variants as separate projects, ready for asset generation. */
export async function createVariants(source, quantity, { onProgress = () => {}, signal, ai = false } = {}) {
  const out = [];
  for (let i = 0; i < quantity; i++) {
    onProgress(i / quantity, `Building variant ${i + 1} of ${quantity}`);
    const v = await buildVariant(source, i, { ai, signal });
    addProjectObject(v);
    out.push(v);
  }
  onProgress(1, "Variants ready");
  return out;
}

function addProjectObject(project) {
  state.projects.unshift(project);
  saveNow();
  emit("project");
}

/* ---------------- repair ---------------- */
export async function repairProject(project, { onProgress = () => {}, signal } = {}) {
  const scenes = project.plan?.scenes || [];
  const missingImages = scenes.filter((s) => !s.imageId);
  const missingVoices = scenes.filter((s) => !s.voiceId && s.narration);
  pipeline.emit({
    level: "info",
    text: `repair: ${missingImages.length} missing images · ${missingVoices.length} missing voice-overs`,
  });
  return runAssets(project, { images: true, voices: true, onlyMissing: true, signal, onProgress });
}

export function pipelineSummary(project) {
  const st = project?.pipeline || {};
  const scenes = project?.plan?.scenes || [];
  return {
    scenes: scenes.length,
    images: scenes.filter((s) => s.imageId).length,
    voices: scenes.filter((s) => s.voiceId).length,
    plan: st.plan?.status || "idle",
    imagesStatus: st.images?.status || "idle",
    voicesStatus: st.voices?.status || "idle",
    ready: scenes.length > 0 && scenes.every((s) => s.imageId) && scenes.every((s) => s.voiceId || !s.narration),
  };
}

export { topicOf, TEMPLATES, STYLES, styleById, templateById, clamp };
