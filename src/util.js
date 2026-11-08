/* ZTC AI Studio — shared utilities (DOM helpers, hashing, zip, share encoding). */

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const uid = (prefix = "id") =>
  `${prefix}_${(crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, "").slice(0, 12)}`;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const debounce = (fn, ms = 250) => {
  let t = null;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
};

export const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length) % arr.length];

/** 32-bit FNV-1a — deterministic seeds for procedural art and variants. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32 seeded PRNG — stable pseudo-random sequences. */
export function seeded(seed) {
  let a = (typeof seed === "string" ? hashString(seed) : seed) >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function sha256Hex(input) {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (crypto?.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return hashString(typeof input === "string" ? input : "bytes").toString(16).padStart(8, "0");
}

export const fmtTime = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
export const fmtClock = (sec) => {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};
export const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1073741824) return `${(v / 1048576).toFixed(1)} MB`;
  return `${(v / 1073741824).toFixed(2)} GB`;
};
export const slug = (s, max = 48) =>
  String(s || "untitled").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max) || "untitled";
export const safeFileName = (s) => String(s || "file").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").slice(0, 90);

/* ---------------- DOM ---------------- */
export const $ = (id, root = document) => root.getElementById?.(id) ?? root.querySelector(`#${id}`);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/**
 * Create an element.
 * h('div', {class:'x', text:'hi', html:'<b>x</b>', onclick, attrs:{}, style:{}}, [children])
 */
export function h(tag, props = null, children = null) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class" || k === "className") el.className = v;
      else if (k === "text") el.textContent = String(v);
      else if (k === "html") el.innerHTML = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "attrs") for (const [a, av] of Object.entries(v)) { if (av != null && av !== false) el.setAttribute(a, av === true ? "" : String(av)); }
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  if (children != null) {
    for (const c of [].concat(children)) {
      if (c == null || c === false) continue;
      el.append(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
  }
  return el;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const isTypingTarget = (t) =>
  !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/* ---------------- files ---------------- */
export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: safeFileName(name) });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}

export const downloadText = (text, name, type = "text/plain;charset=utf-8") =>
  downloadBlob(new Blob([text], { type }), name);

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const t = h("textarea", { style: { position: "fixed", opacity: "0", top: "0" } });
    t.value = text;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand?.("copy") ?? false;
    t.remove();
    return ok;
  }
}

export const fileToText = (file) => file.text();
export const fileToBuffer = (file) => file.arrayBuffer();

/* ---------------- JSON extraction ---------------- */
export function parseJsonLoose(text) {
  if (!text) return null;
  const s = String(text).replace(/^\uFEFF/, "").trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fenced) candidates.push(fenced[1]);
  candidates.push(s);
  const first = s.indexOf("{");
  const firstArr = s.indexOf("[");
  if (first >= 0) candidates.push(s.slice(first, s.lastIndexOf("}") + 1));
  if (firstArr >= 0) candidates.push(s.slice(firstArr, s.lastIndexOf("]") + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c);
      if (v && typeof v === "object") return v;
    } catch { /* keep trying */ }
  }
  return null;
}

/* ---------------- CRC32 + ZIP (store method) ---------------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Build a valid .zip (stored, no compression) from [{name, data}] where data is a
 * string or Uint8Array. Returns a Uint8Array. No external dependencies.
 */
export function makeZip(entries, date = new Date()) {
  const enc = new TextEncoder();
  const dosTime = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const dosDate = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = typeof e.data === "string" ? enc.encode(e.data) : e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameBytes.length);
    const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x0800, true); // UTF-8 names
    dv.setUint16(8, 0, true); // store
    dv.setUint16(10, dosTime, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    locals.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centrals.push(ch);
    offset += lh.length + data.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of locals) { out.set(part, p); p += part.length; }
  for (const part of centrals) { out.set(part, p); p += part.length; }
  out.set(eocd, p);
  return out;
}

export const zipBlob = (entries) => new Blob([makeZip(entries)], { type: "application/zip" });

/* ---------------- share link codec ---------------- */
const b64encode = (bytes) => {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64decode = (str) => {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export async function encodeShare(obj) {
  const json = JSON.stringify(obj);
  const raw = new TextEncoder().encode(json);
  if (typeof CompressionStream === "function") {
    try {
      const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const buf = await new Response(stream).arrayBuffer();
      return `z${b64encode(new Uint8Array(buf))}`;
    } catch { /* fall through */ }
  }
  return `r${b64encode(raw)}`;
}

export async function decodeShare(code) {
  const kind = code[0];
  const bytes = b64decode(code.slice(1));
  let raw = bytes;
  if (kind === "z") {
    if (typeof DecompressionStream !== "function") throw new Error("This browser cannot open compressed share links.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    raw = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(raw));
}

export const isUrl = (u) => /^https?:\/\/[^\s"'<>]+$/i.test(String(u || ""));
export const stripTags = (s) => String(s || "").replace(/<[^>]*>/g, "");
export const titleCase = (s) => String(s || "").replace(/\b[a-z]/g, (c) => c.toUpperCase());
