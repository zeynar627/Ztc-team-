/**
 * ZTC AI Studio — zero-dependency static server + optional CORS relay.
 *
 *   node server.mjs                 # http://localhost:8080
 *   PORT=3000 node server.mjs
 *   RELAY_TOKEN=secret node server.mjs
 *
 * The relay is only needed when a provider blocks browser CORS. It forwards
 * requests to an allow-listed host and never injects credentials of its own.
 */

import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const RELAY_TOKEN = process.env.RELAY_TOKEN || "";

const DEFAULT_ALLOWED = [
  "text.pollinations.ai", "image.pollinations.ai", "aihorde.net", "r.jina.ai",
  "en.wikipedia.org", "api.streamelements.com",
  "oai.endpoints.kepler.ai.cloud.ovh.net", "api.kilo.ai", "api.llmfaucet.dev", "g4f.space",
  "api.groq.com", "generativelanguage.googleapis.com", "api.mistral.ai", "api.cerebras.ai",
  "openrouter.ai", "api.sambanova.ai", "api.siliconflow.com", "integrate.api.nvidia.com",
  "models.github.ai", "router.huggingface.co", "api.cloudflare.com",
];
const ALLOWED = new Set([...DEFAULT_ALLOWED, ...(process.env.ALLOWED_HOSTS || "").split(",").map((s) => s.trim()).filter(Boolean)]);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8", ".map": "application/json",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (url.pathname === "/api/relay" || url.pathname === "/api/relay/") {
      return handleRelay(req, res, url);
    }
    if (url.pathname === "/health") {
      return json(res, 200, { ok: true, service: "ztc-studio", relay: !!RELAY_TOKEN });
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" });
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    return json(res, 500, { error: "server error" });
  }
});

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const target = path.normalize(path.join(ROOT, pathname));
  if (!target.startsWith(ROOT)) return json(res, 403, { error: "forbidden" });

  let info = null;
  try { info = await stat(target); } catch { /* not found */ }
  if (!info || !info.isFile()) {
    // Single-page fallback
    const fallback = path.join(ROOT, "index.html");
    try {
      const html = await readFile(fallback);
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      return res.end(html);
    } catch {
      return json(res, 404, { error: "not found" });
    }
  }
  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".html" ? "no-store" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  if (req.method === "HEAD") return res.end();
  createReadStream(target).pipe(res);
}

async function handleRelay(req, res, url) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }
  if (url.searchParams.get("health") === "1") {
    return json(res, 200, { ok: true, relay: true, allowed: [...ALLOWED].length });
  }
  if (!RELAY_TOKEN) {
    return json(res, 503, { error: "relay disabled: set RELAY_TOKEN to enable it" });
  }
  if (req.headers["x-relay-token"] !== RELAY_TOKEN) {
    return json(res, 401, { error: "invalid relay token" });
  }
  const targetHeader = req.headers["x-target-url"];
  if (!targetHeader) return json(res, 400, { error: "missing X-Target-URL header" });

  let target;
  try { target = new URL(String(targetHeader)); } catch { return json(res, 400, { error: "invalid target url" }); }
  if (target.protocol !== "https:") return json(res, 400, { error: "only https targets are allowed" });
  if (!ALLOWED.has(target.hostname)) return json(res, 403, { error: `host not allowed: ${target.hostname}` });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;

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
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      signal: controller.signal,
      redirect: "follow",
    });
    const outHeaders = {
      ...corsHeaders(),
      "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
      "Cache-Control": "no-store",
    };
    res.writeHead(upstream.status, outHeaders);
    if (upstream.body) {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    }
    res.end();
  } catch (err) {
    json(res, 502, { error: `upstream failed: ${err.message}` });
  } finally {
    clearTimeout(timer);
  }
}

const corsHeaders = () => ({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Target-URL,X-Relay-Token",
  "Access-Control-Max-Age": "86400",
});

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...corsHeaders() });
  res.end(JSON.stringify(obj));
}

server.listen(PORT, HOST, () => {
  console.log(`ZTC AI Studio → http://localhost:${PORT}`);
  console.log(`relay: ${RELAY_TOKEN ? "enabled" : "disabled (set RELAY_TOKEN)"} · allowlist: ${ALLOWED.size} hosts`);
});
