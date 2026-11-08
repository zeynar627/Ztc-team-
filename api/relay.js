/**
 * Vercel serverless relay for ZTC AI Studio (optional).
 *
 * Deploy, then set the environment variables:
 *   RELAY_TOKEN   – a long random string you keep secret
 *   ALLOWED_HOSTS – optional extra comma-separated hostnames
 *
 * In the app: Settings → CORS relay → URL https://<project>.vercel.app/api/relay
 * and the same token. The relay only forwards to allow-listed HTTPS hosts and
 * never adds credentials of its own.
 */

const DEFAULT_ALLOWED = [
  "text.pollinations.ai", "image.pollinations.ai", "aihorde.net", "r.jina.ai",
  "en.wikipedia.org", "api.streamelements.com",
  "oai.endpoints.kepler.ai.cloud.ovh.net", "api.kilo.ai", "api.llmfaucet.dev", "g4f.space",
  "api.groq.com", "generativelanguage.googleapis.com", "api.mistral.ai", "api.cerebras.ai",
  "openrouter.ai", "api.sambanova.ai", "api.siliconflow.com", "integrate.api.nvidia.com",
  "models.github.ai", "router.huggingface.co", "api.cloudflare.com",
];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Target-URL,X-Relay-Token",
  "Access-Control-Max-Age": "86400",
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.query?.health === "1") return res.status(200).json({ ok: true, relay: true });

  const token = process.env.RELAY_TOKEN || "";
  if (!token) return res.status(503).json({ error: "relay disabled: set RELAY_TOKEN" });
  if (req.headers["x-relay-token"] !== token) return res.status(401).json({ error: "invalid relay token" });

  const targetHeader = req.headers["x-target-url"];
  if (!targetHeader) return res.status(400).json({ error: "missing X-Target-URL header" });

  let target;
  try { target = new URL(String(targetHeader)); } catch { return res.status(400).json({ error: "invalid target url" }); }
  if (target.protocol !== "https:") return res.status(400).json({ error: "only https targets are allowed" });

  const allowed = new Set([...DEFAULT_ALLOWED, ...(process.env.ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean)]);
  if (!allowed.has(target.hostname)) return res.status(403).json({ error: `host not allowed: ${target.hostname}` });

  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (["host", "x-target-url", "x-relay-token", "connection", "content-length", "origin", "referer"].includes(k)) continue;
    if (typeof v === "string") headers[k] = v;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    const upstream = await fetch(target.href, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      signal: controller.signal,
      redirect: "follow",
    });
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: `upstream failed: ${err.message}` });
  } finally {
    clearTimeout(timer);
  }
}
