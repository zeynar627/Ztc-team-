/* ZTC AI Studio — LLM calls: OpenAI-compatible, AI Horde and Puter adapters,
   plus streaming chat, strict JSON planning, research and multi-agent runs. */

import { LLM_PROVIDERS, withFailover, fetchWithTimeout, readErrorMessage, keyOf, isEnabled } from "./providers.js";
import { parseJsonLoose } from "./util.js";

const textModelsCache = { at: 0, models: [] };

/* ---------------- adapters ---------------- */
function normalizeMessages(messages) {
  return (messages || []).map((m) => ({
    role: m.role === "developer" ? "system" : m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
}

async function callHorde(provider, { messages, maxTokens, signal }) {
  const hh = { "Content-Type": "application/json", "Client-Agent": "ZTCStudio:3.1.0:browser", apikey: "0000000000" };
  if (Date.now() - textModelsCache.at > 600000 || !textModelsCache.models.length) {
    const r = await fetchWithTimeout("https://aihorde.net/api/v2/status/models?type=text&chat=true", {}, { timeout: 20000, signal });
    if (r.ok) {
      const cat = await r.json();
      const list = (Array.isArray(cat) ? cat : cat.models || [])
        .filter((m) => typeof m?.name === "string")
        .sort((a, b) => (b.performance || 0) - (a.performance || 0))
        .slice(0, 4)
        .map((m) => m.name);
      textModelsCache.models = list;
      textModelsCache.at = Date.now();
    }
  }
  const models = textModelsCache.models.length ? textModelsCache.models : ["koboldcpp/LLaMA2-13B-Tiefighter"];
  const start = await fetchWithTimeout(provider.url, {
    method: "POST", headers: hh,
    body: JSON.stringify({
      models,
      messages: normalizeMessages(messages),
      max_tokens: Math.min(2048, maxTokens || 800),
      horde: { availability_mode: "wait", context_fit: "truncate_oldest" },
    }),
  }, { timeout: 30000, signal });
  if (!start.ok) throw new Error(await readErrorMessage(start));
  const job = await start.json();
  const id = job.id || job.uuid;
  if (!id) throw new Error("AI Horde returned no job id");
  const deadline = Date.now() + 105000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1800));
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    const st = await fetchWithTimeout(`https://aihorde.net/api/v2/generate/chat/status/${encodeURIComponent(id)}`,
      { headers: { "Client-Agent": hh["Client-Agent"] } }, { timeout: 20000, signal });
    if (!st.ok) continue;
    const c = await st.json();
    if (c.fault_reason) throw new Error(`AI Horde: ${c.fault_reason}`);
    if (c.done) {
      const g = c.generations?.[0];
      const content = g?.message?.content;
      if (typeof content === "string" && content.trim()) return content;
      throw new Error("AI Horde returned an empty answer");
    }
  }
  throw new Error("AI Horde queue timed out");
}

async function callPuter(provider, { messages, temperature, maxTokens }) {
  if (typeof window === "undefined" || !window.puter?.ai?.chat) throw new Error("Puter.js is not available (script blocked or offline)");
  const r = await window.puter.ai.chat(normalizeMessages(messages), { model: provider.model, temperature });
  const content = typeof r === "string" ? r : r?.message?.content ?? r?.text ?? r?.toString?.();
  if (!content || typeof content !== "string" || !content.trim()) throw new Error("Puter returned an empty answer");
  return content;
}

async function readSseText(res) {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        out += j.choices?.[0]?.delta?.content || j.choices?.[0]?.message?.content || "";
      } catch { /* ignore malformed frame */ }
    }
  }
  return out;
}

async function callOpenAI(provider, { messages, temperature, maxTokens, json, signal, settings }) {
  const headers = { "Content-Type": "application/json", ...(provider.headers || {}) };
  const key = keyOf(provider, settings);
  if (key && !headers.Authorization) headers.Authorization = `Bearer ${key}`;
  const body = {
    model: provider.model,
    messages: normalizeMessages(messages),
    stream: false,
    temperature: temperature ?? 0.7,
  };
  if (maxTokens) body.max_tokens = maxTokens;
  if (json) body.response_format = { type: "json_object" };

  let res = await fetchWithTimeout(provider.url, { method: "POST", headers, body: JSON.stringify(body) },
    { timeout: provider.timeout || 45000, signal });

  // Some gateways reject response_format; retry once without it.
  if (!res.ok && json && (res.status === 400 || res.status === 422)) {
    delete body.response_format;
    res = await fetchWithTimeout(provider.url, { method: "POST", headers, body: JSON.stringify(body) },
      { timeout: provider.timeout || 45000, signal });
  }
  if (!res.ok) throw new Error(await readErrorMessage(res));

  // Reasoning models can spend a small token budget on hidden reasoning and
  // return empty content. Give them a real budget before failing over.
  const peek = await res.clone().json().catch(() => null);
  const peekMsg = peek?.choices?.[0]?.message;
  if (peekMsg && !String(peekMsg.content ?? "").trim() && peekMsg.reasoning) {
    body.max_tokens = Math.max(500, (maxTokens || 500) * 3);
    res = await fetchWithTimeout(provider.url, { method: "POST", headers, body: JSON.stringify(body) },
      { timeout: provider.timeout || 45000, signal });
    if (!res.ok) throw new Error(await readErrorMessage(res));
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("event-stream")) {
    const text = await readSseText(res);
    if (!text.trim()) throw new Error("provider returned an empty stream");
    return text;
  }
  const raw = await res.text();
  if (/^\s*data:/.test(raw)) {
    let out = "";
    for (const line of raw.split("\n")) {
      if (!line.trim().startsWith("data:")) continue;
      const p = line.trim().slice(5).trim();
      if (!p || p === "[DONE]") continue;
      try { out += JSON.parse(p).choices?.[0]?.delta?.content || ""; } catch { /* ignore */ }
    }
    if (out.trim()) return out;
  }
  let j;
  try { j = JSON.parse(raw); } catch { throw new Error(`non-JSON response: ${raw.slice(0, 140)}`); }
  if (j.error) throw new Error(j.error.message || JSON.stringify(j.error).slice(0, 160));
  const content = j.choices?.[0]?.message?.content ?? j.choices?.[0]?.text;
  const text = Array.isArray(content) ? content.map((p) => p?.text || "").join("") : content;
  if (!text || !String(text).trim()) throw new Error("provider returned an empty answer");
  return String(text);
}

async function callProvider(provider, opts) {
  if (provider.adapter === "horde") return callHorde(provider, opts);
  if (provider.adapter === "puter") return callPuter(provider, opts);
  return callOpenAI(provider, opts);
}

/* ---------------- public API ---------------- */
export async function chatText(messages, opts = {}) {
  const { settings, signal, onEvent, temperature = 0.7, maxTokens = 1200 } = opts;
  const { value, provider } = await withFailover({
    providers: LLM_PROVIDERS,
    settings,
    signal,
    onEvent,
    label: "LLM",
    run: (p, sig) => callProvider(p, { messages, temperature, maxTokens, signal: sig, settings }),
  });
  return { text: value.trim(), provider: provider.name, providerId: provider.id };
}

export async function chatJSON(messages, opts = {}) {
  const { settings, signal, onEvent, validate, temperature = 0.35, maxTokens = 2600 } = opts;
  const { value, provider } = await withFailover({
    providers: LLM_PROVIDERS,
    settings,
    signal,
    onEvent,
    label: "LLM",
    run: async (p, sig) => {
      const raw = await callProvider(p, { messages, temperature, maxTokens, json: true, signal: sig, settings });
      const parsed = parseJsonLoose(raw);
      if (!parsed) throw new Error(`response was not JSON: ${raw.slice(0, 120).replace(/\s+/g, " ")}`);
      if (validate) {
        const problem = validate(parsed);
        if (problem) throw new Error(`invalid structure: ${problem}`);
      }
      return parsed;
    },
  });
  return { data: value, provider: provider.name, providerId: provider.id };
}

/** Streaming chat with provider failover. Failover only happens before the first token. */
export async function streamChat({ messages, system, settings, signal, onDelta = () => {}, onEvent = () => {}, temperature = 0.75, maxTokens = 1400 }) {
  const full = system ? [{ role: "system", content: system }, ...messages] : messages;
  const list = LLM_PROVIDERS.filter((p) => isEnabled(p, settings));
  let lastError = null;

  for (const provider of list) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (provider.kind === "key" && !keyOf(provider, settings)) continue;
    const t0 = performance.now();
    let text = "";
    let first = true;
    try {
      if (provider.adapter) {
        // Non-streaming adapters: single call, then emit.
        const value = await callProvider(provider, { messages: full, temperature, maxTokens, signal, settings });
        onDelta(value);
        return { text: value.trim(), provider: provider.name, providerId: provider.id, ms: Math.round(performance.now() - t0) };
      }
      onEvent({ level: "info", text: `chat: ${provider.name}`, provider: provider.id });
      const headers = { "Content-Type": "application/json", ...(provider.headers || {}) };
      const key = keyOf(provider, settings);
      if (key && !headers.Authorization) headers.Authorization = `Bearer ${key}`;
      const res = await fetchWithTimeout(provider.url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: provider.model,
          messages: normalizeMessages(full),
          stream: true,
          temperature,
          max_tokens: maxTokens,
        }),
      }, { timeout: provider.timeout || 60000, signal });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      if (!res.body) {
        const t = await res.text();
        const j = safeJson(t);
        text = j?.choices?.[0]?.message?.content || t;
        if (!text.trim()) throw new Error("empty answer");
        onDelta(text);
        return { text: text.trim(), provider: provider.name, providerId: provider.id, ms: Math.round(performance.now() - t0) };
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          const j = safeJson(payload);
          const delta = j?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            text += delta;
            first = false;
            onDelta(delta);
          }
        }
      }
      if (!text.trim()) throw new Error("provider returned an empty answer");
      return { text: text.trim(), provider: provider.name, providerId: provider.id, ms: Math.round(performance.now() - t0), partial: false };
    } catch (err) {
      if (err?.name === "AbortError" || signal?.aborted) throw err;
      lastError = err;
      onEvent({ level: "fail", text: `${provider.name}: ${String(err.message || err).slice(0, 160)}`, provider: provider.id });
      if (!first) {
        // Mid-answer failure: keep what we have rather than restarting on another provider.
        return { text: text.trim(), provider: provider.name, providerId: provider.id, partial: true, error: String(err.message || err) };
      }
      onEvent({ level: "warn", text: "switching provider", provider: provider.id });
    }
  }
  throw lastError || new Error("No LLM provider is available. Add a key in Settings or use Local mode.");
}

function safeJson(t) { try { return JSON.parse(t); } catch { return null; } }

/* ---------------- research ---------------- */
export async function research(text, { deep = false, signal } = {}) {
  const sources = [];
  const chunks = [];
  const urls = (String(text).match(/https?:\/\/[^\s)"'<>]+/g) || []).slice(0, 2);

  for (const u of urls) {
    try {
      const r = await fetchWithTimeout(`https://r.jina.ai/${u}`, { headers: { Accept: "text/plain" } }, { timeout: 25000, signal });
      if (r.ok) {
        const body = (await r.text()).slice(0, 7000);
        chunks.push(`[Page: ${u}]\n${body}`);
        sources.push({ title: u, url: u });
      }
    } catch { /* research is best-effort */ }
  }

  const q = String(text).replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 180);
  if (q) {
    try {
      const limit = deep ? 6 : 4;
      const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(q)}` +
        `&gsrlimit=${limit}&prop=extracts|info&inprop=url&exintro=1&explaintext=1&exlimit=max&format=json&origin=*`;
      const r = await fetchWithTimeout(url, {}, { timeout: 20000, signal });
      if (r.ok) {
        const j = await r.json();
        const pages = Object.values(j.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
        for (const p of pages) {
          chunks.push(`[Source: ${p.title} (${p.fullurl})]\n${String(p.extract || "").slice(0, deep ? 1400 : 1200)}`);
          if (p.fullurl) sources.push({ title: p.title, url: p.fullurl });
        }
        if (deep) {
          await Promise.all(pages.slice(0, 2).filter((p) => p.fullurl).map(async (p) => {
            try {
              const rr = await fetchWithTimeout(`https://r.jina.ai/${p.fullurl}`, { headers: { Accept: "text/plain" } }, { timeout: 20000, signal });
              if (rr.ok) chunks.push(`[Full page: ${p.title}]\n${(await rr.text()).slice(0, 4000)}`);
            } catch { /* ignore */ }
          }));
        }
      }
    } catch { /* research is best-effort */ }
  }
  return { context: chunks.join("\n\n").slice(0, 22000), sources: dedupeSources(sources) };
}

function dedupeSources(list) {
  const seen = new Set();
  return list.filter((s) => s.url && !seen.has(s.url) && seen.add(s.url)).slice(0, 8);
}

/* ---------------- multi-agent runs (chat view) ---------------- */
const ROLE_PROMPTS = {
  planner: "You are the PLANNER agent. Produce a short numbered plan (max 8 steps) with concrete acceptance criteria for the request. Do not write the deliverable.",
  builder: "You are the BUILDER agent. Produce the complete deliverable. Be specific and complete. No placeholders.",
  reviewer: 'You are the REVIEWER agent. Check the deliverable against the task. Reply with JSON only: {"verdict":"PASS"|"REVISE","issues":["..."]}. Use REVISE only for real defects.',
  verifier: 'You are the VERIFIER agent. Independently check facts, logic and code correctness. Reply with JSON only: {"verdict":"PASS"|"WARN"|"FAIL","confidence":0-100,"issues":["..."]}.',
  synth: "You are the SYNTHESIZER agent. Produce the final answer, fixing every listed issue. Output only the final answer.",
};

export async function runAgents({ task, history = [], system, settings, signal, onStep = () => {}, onDelta, verify = true, light = false }) {
  const trace = [];
  const step = async (role, label, messages, maxTokens) => {
    const entry = { role, label, status: "running", provider: "", ms: 0, text: "", error: "", preview: "" };
    trace.push(entry);
    onStep(trace, true);
    const t0 = performance.now();
    try {
      const res = await chatText(messages, { settings, signal, temperature: role === "reviewer" || role === "verifier" ? 0.2 : 0.7, maxTokens });
      entry.text = res.text;
      entry.provider = res.provider;
      entry.status = "done";
      entry.preview = res.text.slice(0, 220);
      return res.text;
    } catch (e) {
      if (e?.name === "AbortError" || signal?.aborted) throw e;
      entry.status = "failed";
      entry.error = String(e.message || e).slice(0, 240);
      return "";
    } finally {
      entry.ms = Math.round(performance.now() - t0);
      onStep(trace, true);
    }
  };

  const sys = (p) => ({ role: "system", content: `${p}\n\n${system || ""}` });
  const base = [sys(ROLE_PROMPTS.builder), ...history.slice(0, -1)];
  let plan = "";
  if (!light) plan = await step("planner", "Planner", [sys(ROLE_PROMPTS.planner), { role: "user", content: task }], 500);
  let answer = await step("builder", "Builder", [...base, { role: "user", content: task + (plan ? `\n\nPlan:\n${plan}` : "") }], light ? 1400 : 3000);
  if (!answer) throw new Error("The builder produced no output.");

  let verdict = "";
  if (!light || verify) {
    const review = await step("reviewer", "Reviewer", [sys(ROLE_PROMPTS.reviewer), {
      role: "user", content: `TASK:\n${task}\n\nDELIVERABLE:\n${answer}`,
    }], 600);
    const rj = parseJsonLoose(review);
    if (rj && String(rj.verdict).toUpperCase() === "REVISE" && Array.isArray(rj.issues) && rj.issues.length) {
      const fixed = await step("builder", "Builder fix", [...base, {
        role: "user",
        content: `${task}\n\nPrevious deliverable:\n${answer}\n\nFix these issues:\n- ${rj.issues.join("\n- ")}\n\nReturn the full corrected deliverable.`,
      }], 3000);
      if (fixed) answer = fixed;
    }
    const v = await step("verifier", "Verifier", [sys(ROLE_PROMPTS.verifier), { role: "user", content: `TASK:\n${task}\n\nDELIVERABLE:\n${answer}` }], 500);
    const vj = parseJsonLoose(v);
    verdict = vj?.verdict ? String(vj.verdict).toUpperCase() : "";
    if ((verdict === "FAIL" || verdict === "WARN") && Array.isArray(vj?.issues) && vj.issues.length) {
      const fixed = await step("synth", "Synthesizer", [sys(ROLE_PROMPTS.synth), {
        role: "user", content: `TASK:\n${task}\n\nDELIVERABLE:\n${answer}\n\nFINDINGS:\n- ${vj.issues.join("\n- ")}\n\nOutput the corrected final answer only.`,
      }], 3000);
      if (fixed) answer = fixed;
    }
  }
  if (onDelta) onDelta(answer);
  return { text: answer, verdict, trace };
}

export async function runCouncil({ task, history = [], system, settings, signal, onStep = () => {} }) {
  const trace = [];
  const drafts = await Promise.all([0, 1, 2].map(async (i) => {
    const entry = { role: "draft", label: `Draft ${i + 1}`, status: "running", provider: "", ms: 0, text: "", error: "", preview: "" };
    trace.push(entry);
    onStep(trace, true);
    const t0 = performance.now();
    try {
      const res = await chatText([{ role: "system", content: system || "" }, ...history], { settings, signal, temperature: 0.8, maxTokens: 1600 });
      entry.text = res.text; entry.provider = res.provider; entry.status = "done"; entry.preview = res.text.slice(0, 200);
      return res.text;
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      entry.status = "failed"; entry.error = String(e.message || e).slice(0, 200);
      return "";
    } finally {
      entry.ms = Math.round(performance.now() - t0);
      onStep(trace, true);
    }
  }));
  const good = drafts.filter(Boolean);
  if (!good.length) throw new Error("No council draft produced output.");
  if (good.length === 1) return { text: good[0], trace };
  const entry = { role: "synth", label: "Synthesizer", status: "running", provider: "", ms: 0, text: "", error: "", preview: "" };
  trace.push(entry); onStep(trace, true);
  try {
    const res = await chatText([
      { role: "system", content: system || "" },
      { role: "user", content: `Several independent answers follow. Merge them into one complete answer, resolve disagreements, drop unsupported claims.\n\n${good.map((g, i) => `--- Answer ${i + 1} ---\n${g}`).join("\n\n")}\n\n--- Request ---\n${task}` },
    ], { settings, signal, maxTokens: 2800 });
    entry.text = res.text; entry.provider = res.provider; entry.status = "done"; entry.preview = res.text.slice(0, 200);
    return { text: res.text, trace };
  } catch (e) {
    entry.status = "failed"; entry.error = String(e.message || e).slice(0, 200);
    return { text: good[0], trace };
  } finally {
    onStep(trace, true);
  }
}

/**
 * Connectivity + auth check. A reasoning model may answer with reasoning only
 * when the budget is tiny, so this reports reachability rather than judging the
 * text — the first real generation is the quality test.
 */
export async function probeLlm(provider, settings) {
  const t0 = performance.now();
  if (provider.adapter) {
    const text = await callProvider(provider, {
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      maxTokens: 64, temperature: 0, settings,
    });
    return { ok: true, ms: Math.round(performance.now() - t0), sample: String(text).trim().slice(0, 40) };
  }
  const headers = { "Content-Type": "application/json", ...(provider.headers || {}) };
  const key = keyOf(provider, settings);
  if (key && !headers.Authorization) headers.Authorization = `Bearer ${key}`;
  const res = await fetchWithTimeout(provider.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
      max_tokens: 64,
      stream: false,
      temperature: 0,
    }),
  }, { timeout: Math.min(provider.timeout || 45000, 30000) });
  if (!res.ok) throw new Error(await readErrorMessage(res));
  const j = await res.json().catch(() => null);
  if (!j?.choices?.length) throw new Error("unexpected response shape");
  const msg = j.choices[0].message || {};
  const sample = String(msg.content || msg.reasoning || "").trim().slice(0, 40);
  return { ok: true, ms: Math.round(performance.now() - t0), sample: sample || "reachable" };
}
