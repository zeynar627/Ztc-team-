#!/usr/bin/env node
/**
 * Repository self-check — no dependencies.
 *   npm run check
 *
 * Verifies: required files, module syntax, local asset references, and that no
 * API-key-shaped secret was committed.
 */
import { readFile, stat, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const problems = [];
const notes = [];

const REQUIRED = [
  "index.html", "server.mjs", "README.md", "LICENSE", "CHANGELOG.md",
  "manifest.webmanifest", "icon.svg", "404.html", "robots.txt", ".nojekyll",
  ".github/workflows/ci.yml", ".github/workflows/pages.yml",
  "styles/tokens.css", "styles/app.css", "styles/studio.css", "styles/chat.css",
  "src/main.js", "src/util.js", "src/catalog.js", "src/store.js", "src/providers.js",
  "src/llm.js", "src/generate.js", "src/media.js", "src/audio.js", "src/render.js",
  "src/pipeline.js", "src/export.js", "src/ui.js", "src/views-studio.js",
  "src/views-board.js", "src/views-assets.js", "src/views-chat.js", "src/views-dialogs.js",
  "api/relay.js", "tests/core.test.mjs", "docs/LIMITATIONS.md", "docs/LICENSING.md",
  "docs/PROVIDERS.md", "docs/EXTENDING.md", "docs/DEPLOY.md",
];

for (const rel of REQUIRED) {
  try {
    const s = await stat(path.join(ROOT, rel));
    if (!s.isFile()) problems.push(`not a file: ${rel}`);
  } catch {
    problems.push(`missing: ${rel}`);
  }
}

const jsFiles = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", "tests/screenshots", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(mjs|js)$/.test(entry.name)) jsFiles.push(full);
  }
}
await walk(ROOT);

for (const file of jsFiles) {
  const res = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (res.status !== 0) problems.push(`syntax: ${path.relative(ROOT, file)} — ${(res.stderr || "").split("\n").slice(0, 2).join(" ")}`);
}
notes.push(`${jsFiles.length} modules syntax-checked`);

const index = await readFile(path.join(ROOT, "index.html"), "utf8");
const refs = [...index.matchAll(/(?:href|src)="((?!data:|https?:|#)[^"]+)"/g)].map((m) => m[1]);
for (const ref of refs) {
  try { await stat(path.join(ROOT, ref)); }
  catch { problems.push(`index.html references missing file: ${ref}`); }
}
notes.push(`${refs.length} local references resolved`);

const SECRET_PATTERNS = [
  [/\bsk-[A-Za-z0-9]{20,}\b/, "OpenAI-style key"],
  [/\bAIza[0-9A-Za-z\-_]{30,}\b/, "Google API key"],
  [/\bghp_[A-Za-z0-9]{30,}\b/, "GitHub token"],
  [/\bhf_[A-Za-z0-9]{30,}\b/, "Hugging Face token"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, "Slack token"],
  [/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
];
let scanned = 0;
for (const file of jsFiles.concat([path.join(ROOT, "index.html")])) {
  const text = await readFile(file, "utf8");
  scanned++;
  for (const [re, label] of SECRET_PATTERNS) {
    if (re.test(text)) problems.push(`possible ${label} in ${path.relative(ROOT, file)}`);
  }
}
notes.push(`${scanned} files scanned for secret patterns`);

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
if (pkg.dependencies && Object.keys(pkg.dependencies).length) {
  problems.push("runtime dependencies found — the app is meant to be dependency-free");
} else {
  notes.push("no runtime dependencies");
}

console.log(notes.map((n) => `  ✓ ${n}`).join("\n"));
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  problems.forEach((p) => console.error(`  ✗ ${p}`));
  process.exit(1);
}
console.log("\ncheck passed");
