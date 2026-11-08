/* ZTC AI Studio — prompt correction, expansion and scene planning.

   Two independent paths:
   1. LLM planning (higher quality, needs any working text provider).
   2. Deterministic template writer (always available, offline, no quota).
   Both produce the same validated plan schema, so the rest of the app never
   cares which one ran. */

import { TEMPLATES, STYLES, MOODS, ASPECTS, MOTIONS, TRANSITIONS, CHAPTER_SIZE } from "./catalog.js";
import { chatJSON, chatText } from "./llm.js";
import { clamp, hashString, seeded, uid, stripTags, titleCase } from "./util.js";

const STOP = new Set(`a an the and or but if then than that this these those of in on at to for from with without into over under about as by is are was were be been being do does did doing have has had having i you he she it we they me him her us them my your his its our their what which who whom when where why how all any both each few more most other some such no nor not only own same so too very can will just don should now use using make made create make video videos about want need help best top new`.split(/\s+/));

export const ANGLE_LABELS = ["Direct outcome", "Story-led", "Contrarian", "Curiosity gap", "Numbered"];

/* ---------------- text analysis ---------------- */
export function topicOf(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  t = t.replace(/^(please\s+)?(make|create|generate|build|produce|write|give me|i want|i need)\b[^.]*?\b(video|reel|clip|short|ad|animation)\b(\s+(about|on|for|of|showing))?\s*/i, "");
  t = t.replace(/^(a|an|the)\s+(video|reel|clip|short|ad)\s+(about|on|for|of)\s+/i, "");
  // "A 60 second launch film for a matte mug" → "a matte mug"
  t = t.replace(/^(a|an|the)?\s*\d+(?:\.\d+)?[-\s]?(?:second|sec|minute|min)s?\s+/i, "");
  t = t.replace(/^(launch\s+)?(film|video|reel|clip|short|ad|commercial|animation|teaser|trailer|story)\s+(for|about|on|of|showing|that\s+shows)\s+/i, "");
  t = t.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  if (!t) t = String(text || "").trim();
  const firstSentence = t.split(/[.!?\n]/)[0].trim();
  // Drop trailing qualifiers ("..., aimed at commuters") but keep hyphenated detail.
  const clause = firstSentence.split(/,\s+(?:aimed|targeted|designed|for|with|using|to)\b/i)[0].trim();
  const short = clause.length > 72 ? clause.slice(0, 69).replace(/[,;:\s]+\S*$/, "") : clause;
  return short || "your idea";
}

export function keywordsOf(text, n = 5) {
  const words = String(text || "").toLowerCase().match(/[a-z][a-z'+-]{2,}/g) || [];
  const counts = new Map();
  for (const w of words) {
    if (STOP.has(w) || w.length < 3) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length).slice(0, n).map(([w]) => w);
}

export function guessTemplate(text) {
  const t = String(text).toLowerCase();
  if (/\b(product|launch|sku|shop|store|sale|offer|pricing|packshot)\b/.test(t)) return "product";
  if (/\b(tutorial|how to|guide|walkthrough|step by step|learn)\b/.test(t)) return "tutorial";
  if (/\b(brand|company|story|founder|mission|about us)\b/.test(t)) return "brand";
  if (/\b(travel|destination|city|trip|island|hotel|resort)\b/.test(t)) return "travel";
  if (/\b(teaser|trailer|coming soon|launching|announce)\b/.test(t)) return "teaser";
  if (/\b(documentary|investigation|history|report|case study)\b/.test(t)) return "documentary";
  if (/\b(tiktok|reel|shorts|viral|hook|social)\b/.test(t)) return "social";
  if (/\b(explain|why|what is|how does|concept|science|idea)\b/.test(t)) return "explainer";
  return "explainer";
}

const templateById = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[1];
const styleById = (id) => STYLES.find((s) => s.id === id) || STYLES[0];

/* ---------------- local correction ---------------- */
export function correctLocally(text) {
  const issues = [];
  let t = String(text || "").replace(/\r\n/g, "\n");
  if (/\s{3,}/.test(t)) { issues.push("collapsed repeated spaces"); t = t.replace(/[ \t]{2,}/g, " "); }
  if (/^\s+|\s+$/.test(t)) { issues.push("trimmed surrounding whitespace"); t = t.trim(); }
  if (/\bteh\b/i.test(t)) { issues.push("fixed a common typo"); t = t.replace(/\bteh\b/gi, "the"); }
  if (/\bseperate\b/i.test(t)) { issues.push("fixed a common typo"); t = t.replace(/\bseperate\b/gi, "separate"); }
  if (!/[.!?]$/.test(t) && t.length > 24) { issues.push("added a closing period"); t = `${t}.`; }
  if (t.length < 18) issues.push("the brief is very short — add subject, audience or angle for better results");
  return { text: t, issues };
}

/** Expand a thin brief with the specifics the video needs (offline). */
export function expandLocally(text, { template, tone, audience, duration }) {
  const topic = topicOf(text);
  const kws = keywordsOf(text, 4);
  const tpl = templateById(template || guessTemplate(text));
  const parts = [
    `A ${Math.round(duration / 60 * 10) / 10}-minute ${tone || tpl.tone} video about ${topic}.`,
    kws.length ? `Core motifs: ${kws.join(", ")}.` : "",
    `Structure: ${tpl.beats.map((b) => b.label.toLowerCase()).join(" → ")}.`,
    `Audience: ${audience || "a general online audience"}.`,
    `Every shot must be self-explanatory with narration carrying the argument.`,
  ];
  return parts.filter(Boolean).join(" ");
}

/* ---------------- LLM brief work ---------------- */
export async function correctBrief(text, { settings, signal, onEvent }) {
  const local = correctLocally(text);
  try {
    const { data, provider } = await chatJSON([
      { role: "system", content: "You fix video briefs. Reply with JSON only: {\"corrected\":\"...\",\"issues\":[\"short issue\"],\"topic\":\"3-8 word subject\"}. Keep the author's intent and language. Fix grammar, ambiguity and missing specifics without inventing facts." },
      { role: "user", content: local.text },
    ], { settings, signal, onEvent, maxTokens: 400, validate: (d) => (typeof d.corrected === "string" && d.corrected.trim() ? null : "missing corrected text") });
    return { text: String(data.corrected).slice(0, 4000), issues: Array.isArray(data.issues) ? data.issues.slice(0, 6) : [], topic: String(data.topic || topicOf(text)), provider, ai: true };
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    return { ...local, topic: topicOf(local.text), provider: "local rules", ai: false };
  }
}

export async function enhanceBrief(text, { settings, signal, onEvent, template, tone, audience, duration }) {
  try {
    const { data, provider } = await chatJSON([
      { role: "system", content: "You are a video creative director. Expand the brief into a focused production brief. Reply with JSON only: {\"enhanced\":\"2-4 sentences with concrete visual and narrative direction\",\"hooks\":[\"3 opening line options\"]}. No invented facts, statistics or brand claims." },
      { role: "user", content: `Brief: ${text}\nTemplate: ${template}\nTone: ${tone}\nAudience: ${audience || "general"}\nTarget length: ${duration} seconds` },
    ], { settings, signal, onEvent, maxTokens: 700, validate: (d) => (typeof d.enhanced === "string" ? null : "missing enhanced") });
    return { text: String(data.enhanced).slice(0, 3000), hooks: Array.isArray(data.hooks) ? data.hooks.slice(0, 3) : [], provider, ai: true };
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    return { text: expandLocally(text, { template, tone, audience, duration }), hooks: [], provider: "local rules", ai: false };
  }
}

/* ---------------- plan construction ---------------- */
export function newPlanShell(brief) {
  return { title: titleCase(topicOf(brief.text)).slice(0, 70), logline: "", script: "", scenes: [], chapters: [] };
}

export function distribute(total, n, weights) {
  // Every scene needs at least 2s. When the target cannot fit, honour the floor
  // and let the caller report a longer total rather than producing 1s scenes.
  if (total < n * 2) return Array.from({ length: n }, () => 2);
  const w = weights || Array.from({ length: n }, () => 1);
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  const raw = w.map((x) => (x / sum) * total);
  const rounded = raw.map((x) => Math.max(2, Math.round(x * 2) / 2));
  let diff = Math.round((total - rounded.reduce((a, b) => a + b, 0)) * 2) / 2;
  let i = 0;
  while (Math.abs(diff) >= 0.5 && i < 400) {
    const idx = i % n;
    if (diff > 0) { rounded[idx] += 0.5; diff -= 0.5; }
    else if (rounded[idx] > 2) { rounded[idx] -= 0.5; diff += 0.5; }
    i++;
  }
  return rounded;
}

function fill(str, ctx) {
  return String(str)
    .replace(/\{topic\}/g, ctx.topic)
    .replace(/\{Topic\}/g, titleCase(ctx.topic))
    .replace(/\{kw\}/g, ctx.kw)
    .replace(/\{audience\}/g, ctx.audience || "people")
    .replace(/\{brand\}/g, ctx.brand || "the brand");
}

function beatsFor(tpl, n) {
  const base = tpl.beats;
  if (n <= base.length) {
    const keep = [base[0], ...base.slice(1, base.length - 1).slice(0, Math.max(0, n - 2)), base[base.length - 1]];
    return keep.slice(0, n);
  }
  const mid = base.slice(1, base.length - 1);
  const out = [base[0]];
  for (let i = 0; i < n - 2; i++) out.push(mid[i % mid.length]);
  out.push(base[base.length - 1]);
  return out;
}

/** Deterministic plan: works with zero network, zero quota. */
export function draftPlan(brief, { variant = 0 } = {}) {
  const topic = topicOf(brief.text);
  const kws = keywordsOf(brief.text, 6);
  const tpl = templateById(brief.template || guessTemplate(brief.text));
  const style = styleById(brief.styleId || tpl.style);
  const duration = clamp(Number(brief.duration) || 60, 20, 300);
  const rnd = seeded(hashString(`${brief.text}|${brief.tone}|${variant}|${duration}`));

  const targetScenes = clamp(Math.round(duration / (duration <= 70 ? 8.5 : 11)), 4, 24);
  const beats = beatsFor(tpl, targetScenes);
  const weights = beats.map((b, i) => (i === 0 ? 0.85 : i === beats.length - 1 ? 0.75 : 1));
  const durations = distribute(duration, beats.length, weights);
  const ctx = { topic, kw: kws[0] || "this", audience: brief.audience, brand: brief.brand };

  // Angle rotates the hook and the emphasis, which is what makes variants differ.
  const angle = variant % 5;
  const hookPrefix = [
    "",
    "",
    "Nobody talks about this part. ",
    "Here is the question worth asking. ",
    "Three things, in order. ",
  ][angle];

  const scenes = beats.map((beat, i) => {
    const styleShot = style.shots[(i + variant) % style.shots.length];
    const lines = beat.lines.map((l) => fill(l, ctx));
    const lineCount = Math.min(lines.length, durations[i] > 13 ? 3 : durations[i] > 8 ? 2 : 1);
    // Pick distinct lines: repeating the same sentence reads like a bug.
    const order = lines.map((_, k) => k).sort(() => rnd() - 0.5).slice(0, lineCount);
    let narration = order.map((k) => lines[k]).join(" ");
    if (i === 0 && hookPrefix) narration = hookPrefix + narration.charAt(0).toLowerCase() + narration.slice(1);
    return {
      id: uid("sc"),
      title: beat.label,
      beat: beat.label,
      narration,
      visual: `${styleShot} of ${topic}, ${beat.visual}, ${style.suffix}`,
      duration: durations[i],
      motion: motionFor(style, i, variant),
      transition: i === beats.length - 1 ? "none" : style.transition,
      styleId: style.id,
    };
  });

  if (variant > 0) {
    // Give each batch variant a distinct visual seed while keeping the story arc.
    scenes.forEach((s, i) => { s.visual += `, variant ${variant + 1} interpretation`; s.motion = motionFor(style, i + variant, variant); });
  }

  const plan = {
    title: titleCase(topic).slice(0, 70),
    logline: `${titleCase(topic)} — ${tpl.name.toLowerCase()} in ${beats.length} scenes, ${style.name.toLowerCase()} look, ${Math.round(duration)}s.`,
    script: "",
    scenes,
    chapters: chaptersOf(scenes),
  };
  plan.script = buildScript(plan);
  return plan;
}

function motionFor(style, i, variant) {
  const pool = style.id === "cinematic3d" || style.id === "scifi"
    ? ["zoom-in", "orbit", "dolly", "pan-right", "parallax", "zoom-out"]
    : ["zoom-in", "pan-left", "parallax", "zoom-out", "pan-right", "dolly"];
  return pool[(i + variant) % pool.length];
}

export function chaptersOf(scenes, size = CHAPTER_SIZE) {
  const out = [];
  for (let i = 0; i < scenes.length; i += size) {
    const slice = scenes.slice(i, i + size);
    out.push({ title: titleCase(slice[0].title || `Part ${out.length + 1}`), from: i, to: Math.min(i + size - 1, scenes.length - 1) });
  }
  return out;
}

export function buildScript(plan) {
  const lines = [`# ${plan.title}`, "", plan.logline, ""];
  let t = 0;
  for (const ch of plan.chapters || []) {
    lines.push(`## ${ch.title}`, "");
    for (let i = ch.from; i <= ch.to && i < plan.scenes.length; i++) {
      const s = plan.scenes[i];
      const mm = String(Math.floor(t / 60)).padStart(2, "0");
      const ss = String(Math.round(t % 60)).padStart(2, "0");
      lines.push(`**${mm}:${ss} · ${s.title}** (${s.duration}s)`);
      lines.push(s.narration || "_(silent)_");
      lines.push(`> Visual: ${String(s.visual || "").split(",").slice(0, 4).join(",")}`);
      lines.push("");
      t += s.duration;
    }
  }
  return lines.join("\n");
}

/* ---------------- LLM plan ---------------- */
export async function aiPlan(brief, { settings, signal, onEvent, variant = 0, existing = null } = {}) {
  const tpl = templateById(brief.template || guessTemplate(brief.text));
  const style = styleById(brief.styleId || tpl.style);
  const duration = clamp(Number(brief.duration) || 60, 20, 300);
  const sceneCount = clamp(Math.round(duration / 10), 4, 20);
  const angle = ANGLE_LABELS[variant % 5];

  const system = `You are ZTC, a video director and scriptwriter. Reply with JSON only, no prose.
Schema: {"title":"string","logline":"one sentence","scenes":[{"title":"beat label","beat":"Hook|Problem|Product|Proof|Payoff|CTA|...","narration":"spoken line, no stage directions","visual":"image prompt, 15-35 words, concrete subject + shot + light","duration":number}]}
Rules:
- exactly ${sceneCount} scenes
- durations sum to ${duration} seconds, each between 3 and 20
- narration is spoken aloud: short sentences, no emoji, no markdown, no scene numbers
- visual prompts describe ONE still frame, never a sequence or text overlay
- every visual must show the same subject as the brief; never change its colour, material, count or defining details
- style: ${style.name} (${style.suffix})
- narrative template: ${tpl.name}; use these beats in order: ${tpl.beats.map((b) => b.label).join(" > ")}
- angle: ${angle}
- do not invent statistics, quotes, prices or sources.`;

  const user = `Brief: ${brief.text}\nTopic: ${topicOf(brief.text)}\nAudience: ${brief.audience || "general"}\nTone: ${brief.tone || tpl.tone}\nLanguage: ${brief.language || "English"}${brief.direction ? `\nCreative direction: ${brief.direction}` : ""}${existing ? `\nKeep these scene ideas where they still work: ${existing.scenes.slice(0, 6).map((s) => s.title).join(", ")}` : ""}`;

  const { data, provider } = await chatJSON([{ role: "system", content: system }, { role: "user", content: user }], {
    settings, signal, onEvent, maxTokens: 3200, temperature: 0.6,
    validate: (d) => {
      if (!Array.isArray(d.scenes) || !d.scenes.length) return "scenes array missing";
      if (d.scenes.length < 2) return "needs at least 2 scenes";
      return null;
    },
  });

  const scenes = data.scenes.slice(0, 24).map((s, i) => ({
    id: existing?.scenes?.[i]?.id || uid("sc"),
    title: stripTags(String(s.title || `Scene ${i + 1}`)).slice(0, 60),
    beat: stripTags(String(s.beat || s.title || "Beat")).slice(0, 40),
    narration: stripTags(String(s.narration || "")).replace(/\s+/g, " ").slice(0, 420),
    visual: stripTags(String(s.visual || "")).slice(0, 420),
    duration: clamp(Number(s.duration) || duration / sceneCount, 2, 30),
    motion: MOTIONS[motionFor(style, i, variant)] ? motionFor(style, i, variant) : "zoom-in",
    transition: i === data.scenes.length - 1 ? "none" : style.transition,
    styleId: style.id,
  }));

  const plan = {
    title: stripTags(String(data.title || topicOf(brief.text))).slice(0, 80),
    logline: stripTags(String(data.logline || "")).slice(0, 240),
    script: "",
    scenes,
    chapters: [],
  };
  const fixed = validatePlan(plan, { duration });
  fixed.plan.script = buildScript(fixed.plan);
  return { plan: fixed.plan, issues: fixed.issues, provider };
}

/* ---------------- validation & merge ---------------- */
export function validatePlan(plan, { duration = 60 } = {}) {
  const issues = [];
  if (!plan || typeof plan !== "object") return { plan: draftPlan({ text: "Untitled", duration }), issues: ["plan was empty — rebuilt from defaults"] };
  if (!Array.isArray(plan.scenes) || !plan.scenes.length) {
    return { plan: draftPlan({ text: plan.title || "Untitled", duration }), issues: ["no scenes — rebuilt from defaults"] };
  }
  plan.scenes = plan.scenes.slice(0, 30).map((s, i) => {
    const out = {
      id: s.id || uid("sc"),
      title: String(s.title || `Scene ${i + 1}`).slice(0, 60),
      beat: String(s.beat || s.title || "Beat").slice(0, 40),
      narration: String(s.narration || "").replace(/\s+/g, " ").slice(0, 600),
      visual: String(s.visual || "").slice(0, 600),
      duration: clamp(Number(s.duration) || 6, 2, 30),
      motion: MOTIONS[s.motion] ? s.motion : "zoom-in",
      transition: TRANSITIONS[s.transition] ? s.transition : "fade",
      styleId: s.styleId,
      imageId: s.imageId || null,
      voiceId: s.voiceId || null,
      voiceDur: Number(s.voiceDur) || 0,
      status: s.status || {},
      provider: s.provider || {},
      stale: !!s.stale,
    };
    if (!out.visual) { out.visual = `cinematic still illustrating ${out.narration.slice(0, 80)}`; issues.push(`scene ${i + 1}: visual prompt was empty`); }
    if (!out.narration) issues.push(`scene ${i + 1}: no narration (silent scene)`);
    if (out.narration.length > 420) issues.push(`scene ${i + 1}: narration trimmed to fit one caption block`);
    return out;
  });
  const total = plan.scenes.reduce((n, s) => n + s.duration, 0);
  if (total < 10) issues.push("total duration is very short");
  plan.chapters = chaptersOf(plan.scenes);
  plan.script = buildScript(plan);
  return { plan, issues };
}

export function mergePlan(oldPlan, nextPlan) {
  const next = JSON.parse(JSON.stringify(nextPlan));
  if (!oldPlan?.scenes?.length) return next;
  let kept = 0, reset = 0;
  next.scenes = next.scenes.map((s, i) => {
    const prev = oldPlan.scenes[i];
    if (!prev) return s;
    const sameVisual = (prev.visual || "") === (s.visual || "");
    const sameNarration = (prev.narration || "") === (s.narration || "");
    const merged = { ...s };
    if (sameVisual && prev.imageId) {
      merged.imageId = prev.imageId;
      merged.status = { ...(s.status || {}), image: "done" };
      merged.provider = { ...(s.provider || {}), image: prev.provider?.image };
      kept++;
    } else {
      // The shot changed: never keep an image that no longer matches the script.
      merged.imageId = null;
      merged.status = { ...(merged.status || {}), image: "idle" };
      if (prev.imageId) { merged.stale = true; reset++; }
    }
    if (sameNarration && prev.voiceId) {
      merged.voiceId = prev.voiceId;
      merged.voiceDur = prev.voiceDur;
      merged.status = { ...(merged.status || {}), voice: "done" };
      merged.provider = { ...(merged.provider || {}), voice: prev.provider?.voice };
      kept++;
    } else {
      merged.voiceId = null;
      merged.voiceDur = 0;
      merged.status = { ...(merged.status || {}), voice: "idle" };
      if (prev.voiceId) { merged.stale = true; reset++; }
    }
    return merged;
  });
  return next;
}

/* ---------------- variants & remix ---------------- */
export function variantBrief(brief, i) {
  const angle = ANGLE_LABELS[i % ANGLE_LABELS.length];
  const prefixes = [
    "",
    "Tell it as a short story with a clear before and after.",
    "Challenge the common assumption first, then prove the point visually.",
    "Open with a question the viewer cannot ignore, answer it by the end.",
    "Structure it as a numbered list of three concrete points.",
  ];
  return {
    ...brief,
    text: `${brief.text}${prefixes[i % prefixes.length] ? `\n\nAngle: ${prefixes[i % prefixes.length]}` : ""}`,
    angle,
    variant: i,
  };
}

export async function rewriteLine(text, { settings, signal, onEvent, brief, mode = "shorter" }) {
  const instruction = mode === "shorter" ? "Make it shorter and punchier, same meaning."
    : mode === "punchier" ? "Make it sharper and more concrete, keep the meaning."
    : mode === "warmer" ? "Make it warmer and more human, keep the meaning."
    : "Rewrite it with a different phrasing, keep the meaning.";
  try {
    const { data } = await chatJSON([
      { role: "system", content: `You rewrite one narration line for a video. ${instruction} Reply with JSON only: {"line":"..."} Keep it under 30 words, spoken style.` },
      { role: "user", content: `${text}\n\nContext: ${brief || ""}` },
    ], { settings, signal, onEvent, maxTokens: 200, validate: (d) => (typeof d.line === "string" && d.line.trim() ? null : "missing line") });
    return String(data.line).trim();
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    const parts = String(text).split(/(?<=[.!?])\s+/).filter(Boolean);
    return parts.length > 1 ? parts.slice(0, Math.max(1, parts.length - 1)).join(" ") : text;
  }
}

/* ---------------- timeline helpers ---------------- */
export const totalDuration = (scenes) => (scenes || []).reduce((n, s) => n + (Number(s.duration) || 0), 0);

export function sceneTimings(scenes) {
  let t = 0;
  return (scenes || []).map((s, i) => {
    const start = t;
    t += Number(s.duration) || 0;
    return { index: i, start, end: t, duration: Number(s.duration) || 0 };
  });
}

export function sceneAt(scenes, time) {
  const timings = sceneTimings(scenes);
  for (let i = 0; i < timings.length; i++) {
    if (time < timings[i].end || i === timings.length - 1) return { scene: scenes[i], timing: timings[i], index: i };
  }
  return { scene: scenes[0], timing: timings[0], index: 0 };
}

/** Keep the requested total while never cutting a generated voice-over short. */
export function rebalance(scenes, target) {
  if (!scenes.length) return scenes;
  const min = scenes.map((s) => Math.max(2.5, (Number(s.voiceDur) || 0) + 0.6));
  const minSum = min.reduce((a, b) => a + b, 0);
  if (target <= minSum) {
    scenes.forEach((s, i) => { s.duration = Math.round(min[i] * 2) / 2; });
    return scenes;
  }
  const spare = target - minSum;
  const weightSum = scenes.reduce((a, s) => a + (s.narration ? 1 : 0.5), 0) || 1;
  scenes.forEach((s, i) => {
    const w = (s.narration ? 1 : 0.5) / weightSum;
    s.duration = Math.round((min[i] + spare * w) * 2) / 2;
  });
  return scenes;
}

export function estimateSpeechSeconds(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  return words / 2.6;
}

export function briefLabel(brief) {
  const aspect = ASPECTS[brief.aspect] || ASPECTS["16:9"];
  const mood = MOODS[brief.musicMood]?.label || "music";
  return `${aspect.id} · ${Math.round(brief.duration)}s · ${mood}`;
}

export { templateById, styleById };
