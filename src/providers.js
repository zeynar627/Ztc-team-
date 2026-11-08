/* ZTC AI Studio — provider registry, health tracking and capability failover.

   Every capability (llm, image, voice, music) resolves through this router.
   Nothing here hard-codes a secret: keyed providers read the user's own key from
   local settings, and every free provider degrades to the next one automatically. */

export const LLM_PROVIDERS = [
  {
    id: "ovh", name: "OVHcloud AI Endpoints", cap: "llm", kind: "keyless",
    url: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    model: "gpt-oss-120b", timeout: 45000,
    note: "Free public OpenAI-compatible endpoint. No key. Rate-limited.",
  },
  {
    id: "pollinations-text", name: "Pollinations Text", cap: "llm", kind: "keyless",
    url: "https://text.pollinations.ai/openai/chat/completions",
    model: "openai-fast", timeout: 45000,
    note: "Free, no signup. One request per 30s per IP; heavy rate limits.",
  },
  {
    id: "kilo", name: "Kilo (anonymous)", cap: "llm", kind: "keyless",
    url: "https://api.kilo.ai/api/openrouter/chat/completions",
    model: "kilo-auto/free", timeout: 45000, headers: { Authorization: "Bearer anonymous" },
    note: "Anonymous free tier. Model availability varies.",
  },
  {
    id: "llmfaucet", name: "LLMFaucet", cap: "llm", kind: "keyless",
    url: "https://api.llmfaucet.dev/v1/chat/completions",
    model: "auto", timeout: 50000, headers: { Authorization: "Bearer free" },
    note: "Public free faucet with auto routing.",
  },
  {
    id: "g4f-groq", name: "G4F · Groq", cap: "llm", kind: "keyless",
    url: "https://g4f.space/api/groq/chat/completions",
    model: "openai/gpt-oss-120b", timeout: 45000,
    note: "Community proxy. No key.",
  },
  {
    id: "g4f-gemini", name: "G4F · Gemini", cap: "llm", kind: "keyless",
    url: "https://g4f.space/api/gemini/chat/completions",
    model: "gemini-2.5-flash", timeout: 45000,
    note: "Community proxy. No key.",
  },
  {
    id: "aihorde-text", name: "AI Horde (text)", cap: "llm", kind: "keyless",
    url: "https://aihorde.net/api/v2/generate/chat/async", model: "horde", adapter: "horde",
    timeout: 120000, note: "Crowdsourced. Anonymous key 0000000000. Queue waits apply.",
  },
  {
    id: "puter-llm", name: "Puter AI (free account)", cap: "llm", kind: "account",
    url: "puter://ai.chat", model: "gpt-5-nano", adapter: "puter", timeout: 90000,
    note: "Requires a free Puter sign-in. Uses the user's own Puter allowance, not a developer key.",
  },
  {
    id: "groq", name: "Groq", cap: "llm", kind: "key", keyRef: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions", model: "openai/gpt-oss-120b", timeout: 40000,
    note: "Free tier with your own key.",
  },
  {
    id: "gemini", name: "Google Gemini", cap: "llm", kind: "key", keyRef: "gemini",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: "gemini-2.5-flash", timeout: 45000, note: "Free tier with your own key.",
  },
  {
    id: "mistral", name: "Mistral", cap: "llm", kind: "key", keyRef: "mistral",
    url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest", timeout: 45000,
    note: "Free experiment tier with your own key.",
  },
  {
    id: "cerebras", name: "Cerebras", cap: "llm", kind: "key", keyRef: "cerebras",
    url: "https://api.cerebras.ai/v1/chat/completions", model: "llama3.1-8b", timeout: 40000,
    note: "Free tier with your own key.",
  },
  {
    id: "openrouter", name: "OpenRouter (free models)", cap: "llm", kind: "key", keyRef: "openrouter",
    url: "https://openrouter.ai/api/v1/chat/completions", model: "meta-llama/llama-3.3-70b-instruct:free",
    timeout: 50000, headers: { "HTTP-Referer": "https://ztc-studio.local", "X-Title": "ZTC AI Studio" },
    note: "Free `:free` models with your own key.",
  },
  {
    id: "sambanova", name: "SambaNova", cap: "llm", kind: "key", keyRef: "sambanova",
    url: "https://api.sambanova.ai/v1/chat/completions", model: "Meta-Llama-3.3-70B-Instruct", timeout: 45000,
    note: "Free tier with your own key.",
  },
  {
    id: "siliconflow", name: "SiliconFlow", cap: "llm", kind: "key", keyRef: "siliconflow",
    url: "https://api.siliconflow.com/v1/chat/completions", model: "Qwen/Qwen3-8B", timeout: 45000,
    note: "Free small models with your own key.",
  },
  {
    id: "nvidia", name: "NVIDIA NIM", cap: "llm", kind: "key", keyRef: "nvidia",
    url: "https://integrate.api.nvidia.com/v1/chat/completions", model: "meta/llama-3.3-70b-instruct", timeout: 45000,
    note: "Free credits with your own key.",
  },
  {
    id: "github", name: "GitHub Models", cap: "llm", kind: "key", keyRef: "github",
    url: "https://models.github.ai/inference/chat/completions", model: "openai/gpt-4.1-mini", timeout: 45000,
    note: "Free with a GitHub token.",
  },
  {
    id: "huggingface", name: "Hugging Face Router", cap: "llm", kind: "key", keyRef: "huggingface",
    url: "https://router.huggingface.co/v1/chat/completions", model: "meta-llama/Llama-3.3-70B-Instruct",
    timeout: 45000, note: "Free monthly credits with your own token.",
  },
  {
    id: "cloudflare", name: "Cloudflare Workers AI", cap: "llm", kind: "key", keyRef: "cloudflare",
    url: "https://api.cloudflare.com/client/v4/accounts/{accountId}/ai/v1/chat/completions",
    model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", timeout: 45000,
    note: "Free daily allocation with your own key + account id.",
  },
];

export const IMAGE_PROVIDERS = [
  {
    id: "horde", name: "AI Horde", cap: "image", kind: "keyless",
    note: "Crowdsourced Stable Diffusion / FLUX workers. Free, anonymous allowed, queue-based.",
    license: "Model-dependent (check the worker's model card).",
  },
  {
    id: "pollinations", name: "Pollinations", cap: "image", kind: "keyless",
    note: "Free keyless image endpoint. One request per 45s, 768px max area, small logo.",
    license: "Pollinations terms.",
  },
  {
    id: "procedural", name: "Procedural canvas (offline)", cap: "image", kind: "local",
    note: "Built-in generative art renderer. No network, no quota, deterministic by seed.",
    license: "MIT (this project).",
  },
];

export const VOICE_PROVIDERS = [
  {
    id: "puter", name: "Puter TTS (free account)", cap: "voice", kind: "account",
    note: "Free sign-in, neural voices (AWS Polly / OpenAI / Gemini). Speech is generated in the browser session.",
    license: "Puter terms; voices via the selected engine.",
  },
  {
    id: "streamelements", name: "StreamElements TTS", cap: "voice", kind: "keyless",
    note: "Public keyless endpoint. No SLA; used as an automatic fallback.",
    license: "Third-party service, best-effort.",
  },
  {
    id: "endpoint", name: "Self-hosted TTS (Piper / Kokoro)", cap: "voice", kind: "local",
    note: "Point at your own HTTP TTS server. Fully offline and licence-clean.",
    license: "Piper MIT · Kokoro-82M Apache-2.0.",
  },
  {
    id: "device", name: "Browser speech (preview only)", cap: "voice", kind: "local",
    note: "Instant preview through the OS voices. Browsers do not allow capturing it into a file, so it is never used for export.",
    license: "OS voices.",
  },
];

export const MUSIC_PROVIDERS = [
  {
    id: "procedural", name: "Built-in composer", cap: "music", kind: "local",
    note: "Real-time synthesised score: chords, bass, arpeggio and drums rendered with Web Audio.",
    license: "MIT (this project).",
  },
  {
    id: "endpoint", name: "Self-hosted music model", cap: "music", kind: "local",
    note: "Optional HTTP endpoint for MusicGen / Stable Audio Open running on your own hardware.",
    license: "MusicGen weights are CC-BY-NC (non-commercial) — do not use for monetised work. Stable Audio Open: check Stability's current terms.",
  },
];

/* ---------------- health ---------------- */
const health = new Map();

export function healthOf(id) {
  if (!health.has(id)) health.set(id, { ok: 0, fail: 0, streak: 0, cool: 0, lastError: "", lastMs: 0, lastAt: 0 });
  return health.get(id);
}

export function markOk(id, ms) {
  const s = healthOf(id);
  s.ok += 1; s.streak = 0; s.cool = 0; s.lastError = ""; s.lastMs = ms; s.lastAt = Date.now();
}
export function markFail(id, err, cooldownMs) {
  const s = healthOf(id);
  s.fail += 1; s.streak += 1;
  s.lastError = String(err?.message || err || "unknown error").slice(0, 200);
  s.lastAt = Date.now();
  s.cool = Date.now() + (cooldownMs ?? Math.min(120000, 8000 * s.streak));
}
export const isCooling = (id) => healthOf(id).cool > Date.now();
export function resetHealth() { health.clear(); }
export function healthSnapshot() {
  return [...health.entries()].map(([id, s]) => ({ id, ...s, cooling: s.cool > Date.now() }));
}

/* ---------------- selection ---------------- */
export const keyOf = (provider, settings) => {
  if (!provider.keyRef) return "";
  return String(settings?.keys?.[provider.keyRef] || "").trim();
};

export function isEnabled(provider, settings) {
  const over = settings?.enabled || {};
  if (over[provider.id] === false) return false;
  if (provider.id === "puter-llm" && settings?.allowPuter === false) return false;
  return true;
}

export function readiness(provider, settings) {
  if (!isEnabled(provider, settings)) return { ready: false, why: "disabled" };
  if (provider.kind === "key" && !keyOf(provider, settings)) return { ready: false, why: "needs key" };
  if (provider.url?.includes("{accountId}") && !settings?.cloudflareAccountId) return { ready: false, why: "needs account id" };
  if (isCooling(provider.id)) return { ready: false, why: "cooling down" };
  return { ready: true, why: "ready" };
}

export function ordered(providers, settings) {
  const list = providers.filter((p) => isEnabled(p, settings));
  const withState = list.map((p, i) => {
    const r = readiness(p, settings);
    return { p, i, ready: r.ready, why: r.why, score: scoreOf(p) };
  });
  const ready = withState.filter((x) => x.ready).sort((a, b) => b.score - a.score || a.i - b.i);
  const cooling = withState.filter((x) => !x.ready && x.why === "cooling down").sort((a, b) => healthOf(a.p.id).cool - healthOf(b.p.id).cool);
  // Non-ready entries are only used when nothing else is available.
  const blocked = withState.filter((x) => !x.ready && x.why !== "cooling down");
  return [...ready, ...cooling, ...blocked].map((x) => x.p);
}

function scoreOf(provider) {
  const s = healthOf(provider.id);
  const total = s.ok + s.fail;
  const reliability = total ? s.ok / total : 0.6;
  const latencyPenalty = s.lastMs ? Math.min(s.lastMs, 60000) / 3000 : 6;
  const streakPenalty = Math.min(s.streak, 5) * 8;
  // Free/keyless providers are preferred over account/key providers, all else equal.
  const kindBonus = provider.kind === "keyless" ? 14 : provider.kind === "local" ? 10 : provider.kind === "account" ? 4 : 0;
  return reliability * 100 - latencyPenalty - streakPenalty + kindBonus;
}

/* ---------------- failover ---------------- */
/**
 * Try providers in order until one resolves. Records health, reports each switch.
 * run(provider, signal) must throw on failure.
 */
export async function withFailover({ providers, settings, run, signal, onEvent = () => {}, label = "request", retryPerProvider = 1 }) {
  const list = ordered(providers, settings);
  if (!list.length) throw new Error(`No ${label} provider is configured.`);
  const attempts = [];
  const isReady = (p) => readiness(p, settings).ready;

  for (let idx = 0; idx < list.length; idx++) {
    const provider = list[idx];
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (!isReady(provider)) {
      attempts.push({ provider: provider.name, error: readiness(provider, settings).why, skipped: true });
      continue;
    }
    const tries = provider.kind === "local" ? 1 : retryPerProvider;
    for (let t = 0; t < tries; t++) {
      const t0 = performance.now();
      try {
        onEvent({ level: "info", text: `${label}: trying ${provider.name}${t ? ` (retry ${t})` : ""}`, provider: provider.id });
        const value = await run(provider, signal);
        const ms = Math.round(performance.now() - t0);
        markOk(provider.id, ms);
        onEvent({ level: "ok", text: `${provider.name} responded in ${ms} ms`, provider: provider.id });
        return { value, provider, attempts, ms };
      } catch (err) {
        if (err?.name === "AbortError" || signal?.aborted) throw err;
        const msg = String(err?.message || err).slice(0, 220);
        markFail(provider.id, err, provider.kind === "local" ? 0 : undefined);
        attempts.push({ provider: provider.name, error: msg });
        onEvent({ level: "fail", text: `${provider.name} failed: ${msg}`, provider: provider.id });
        const next = list.slice(idx + 1).find(isReady);
        if (next) onEvent({ level: "warn", text: `switching to ${next.name}`, provider: next.id });
      }
    }
  }
  const detail = attempts.filter((a) => !a.skipped).map((a) => `${a.provider}: ${a.error}`).slice(0, 3).join(" · ");
  const skipped = attempts.filter((a) => a.skipped).map((a) => `${a.provider} (${a.error})`).slice(0, 3).join(" · ");
  const err = new Error(`${label} failed on every provider${detail ? ` — ${detail}` : ""}${skipped ? ` · skipped: ${skipped}` : ""}`);
  err.attempts = attempts;
  throw err;
}

/* ---------------- low-level HTTP ---------------- */
const RELAY = { enabled: false, url: "", token: "" };
export function configureRelay({ enabled, url, token } = {}) {
  RELAY.enabled = !!enabled && /^https:\/\//i.test(String(url || ""));
  RELAY.url = String(url || "");
  RELAY.token = String(token || "");
}

function viaRelay(url, init) {
  if (!RELAY.enabled || !RELAY.url) return [url, init];
  try {
    const target = new URL(String(url));
    const relay = new URL(RELAY.url);
    if (target.protocol !== "https:" || target.origin === relay.origin) return [url, init];
    const headers = new Headers(init.headers || {});
    headers.set("X-Target-URL", target.href);
    if (RELAY.token) headers.set("X-Relay-Token", RELAY.token);
    return [relay.href, { ...init, headers }];
  } catch {
    return [url, init];
  }
}

export async function fetchWithTimeout(url, init = {}, { timeout = 30000, signal } = {}) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const [finalUrl, finalInit] = viaRelay(url, init);
  try {
    const res = await fetch(finalUrl, { ...finalInit, signal: ctrl.signal });
    return res;
  } catch (e) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (e.name === "AbortError") throw new Error(`timed out after ${Math.round(timeout / 1000)}s`);
    if (/Failed to fetch|NetworkError|Load failed/i.test(e.message)) {
      throw new Error("network/CORS blocked — check your connection or use a relay");
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

export async function readErrorMessage(res) {
  let body = "";
  try { body = (await res.text()).slice(0, 400); } catch { /* ignore */ }
  const hint = res.status === 402 ? "quota/payment required" : res.status === 429 ? "rate limited" : res.status === 401 || res.status === 403 ? "unauthorised" : "";
  return `HTTP ${res.status}${hint ? ` (${hint})` : ""}${body ? ` — ${body.replace(/\s+/g, " ").trim()}` : ""}`;
}
