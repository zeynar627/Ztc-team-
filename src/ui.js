/* ZTC AI Studio — shared UI primitives. */

import { $, h, clear, clamp } from "./util.js";

const ICONS = {
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/><circle cx="12" cy="12" r="3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  timeline: '<path d="M3 6h11M3 12h7M3 18h15"/><circle cx="17" cy="6" r="2"/><circle cx="13" cy="12" r="2"/><circle cx="20" cy="18" r="2"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 17 5-5 4 4 3-2 4 4"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 0 1 8-8h2a8 8 0 0 1 8 4z"/><path d="M8 11h8M8 15h5"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 20h16"/>',
  upload: '<path d="M12 16V4M7 8l5-5 5 5M4 20h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5 15.4 6.5M8.6 13.5l6.8 4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/>',
  music: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  wand: '<path d="m4 20 10-10M14 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM19 12l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  alert: '<path d="M12 3 2 20h20L12 3zM12 9v5M12 17h.01"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.4-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4z"/>',
  film: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 4v16M17 4v16M2 9h5M2 15h5M17 9h5M17 15h5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  record: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  route: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6H14a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3H9a3 3 0 0 0-3 3v.5"/>',
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  arrowRight: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  arrowLeft: '<path d="M20 12H4M10 6l-6 6 6 6"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="m8 8 12 10M20 6 8 16"/>',
  text: '<path d="M4 6h16M9 6v13M15 6v13"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.4-2-.5-1 .2-2 1.4-2H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3z"/><circle cx="8" cy="9" r="1.2"/><circle cx="12" cy="7" r="1.2"/><circle cx="16" cy="9" r="1.2"/>',
};

export function icon(name, cls = "ico") {
  const body = ICONS[name] || ICONS.spark;
  return `<span class="${cls}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body}</svg></span>`;
}

export function iconEl(name, cls = "ico") {
  const span = h("span", { class: cls, "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.spark}</svg>`;
  return span;
}

export function mountIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    const name = node.dataset.icon;
    if (node.dataset.iconDone === name) return;
    node.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.spark}</svg>`;
    node.dataset.iconDone = name;
  });
}

/* ---------------- toast ---------------- */
const TOAST_LIMIT = 3;
export function toast(message, kind = "", ms = 4200) {
  const box = $("toaster");
  if (!box) return;
  while (box.children.length >= TOAST_LIMIT) box.firstElementChild?.remove();
  const glyph = kind === "bad" ? "!" : kind === "ok" ? "✓" : kind === "warn" ? "!" : "i";
  const el = h("div", { class: `toast ${kind}`, role: kind === "bad" ? "alert" : "status" }, [
    h("span", { class: "t-ico", text: glyph, "aria-hidden": "true" }),
    h("span", { class: "t-msg", text: message }),
    h("button", {
      class: "t-x", text: "✕", "aria-label": "Dismiss", onclick: () => el.remove(),
    }),
  ]);
  box.appendChild(el);
  if (ms > 0) setTimeout(() => el.remove(), ms);
  return el;
}

/* ---------------- modal ---------------- */
let modalCleanup = null;
export function openModal({ title, subtitle = "", body, wide = false, narrow = false, actions = null, onClose = null }) {
  const overlay = $("overlay");
  const modal = $("modal");
  clear(modal);
  modal.className = `modal${wide ? " wide" : ""}${narrow ? " narrow" : ""}`;
  modal.setAttribute("aria-label", title || "Dialog");
  const head = h("div", { class: "modal-head" }, [
    h("div", { style: { flex: "1", minWidth: "0" } }, [
      h("h2", { id: "modalTitle", text: title || "" }),
      subtitle ? h("div", { class: "modal-sub", text: subtitle }) : null,
    ]),
    h("button", { class: "icon-btn", "aria-label": "Close dialog", html: icon("close"), onclick: () => closeModal() }),
  ]);
  modal.append(head, body);
  if (actions) modal.appendChild(h("div", { class: "row end", style: { marginTop: "16px" }, }, actions));
  overlay.hidden = false;
  const previous = document.activeElement;
  modal.focus();
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeModal(); return; }
    if (e.key !== "Tab") return;
    const focusables = [...modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener("keydown", onKey, true);
  const onOverlay = (e) => { if (e.target === overlay) closeModal(); };
  overlay.addEventListener("mousedown", onOverlay);
  modalCleanup = () => {
    document.removeEventListener("keydown", onKey, true);
    overlay.removeEventListener("mousedown", onOverlay);
    if (previous && previous.focus) { try { previous.focus(); } catch { /* ignore */ } }
    if (onClose) onClose();
  };
  const first = modal.querySelector("input, textarea, button");
  if (first && !/close dialog/i.test(first.getAttribute("aria-label") || "")) first.focus();
  return modal;
}

export function closeModal() {
  $("overlay").hidden = true;
  if (modalCleanup) { const c = modalCleanup; modalCleanup = null; c(); }
}

export function confirmDialog({ title = "Are you sure?", message = "", okLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; closeModal(); resolve(v); };
    const body = h("div", [
      h("p", { class: "modal-sub", style: { fontSize: "13px", lineHeight: "1.6" }, text: message }),
      h("div", { class: "row end", style: { marginTop: "18px" } }, [
        h("button", { class: "btn ghost", text: "Cancel", onclick: () => finish(false) }),
        h("button", { class: `btn ${danger ? "danger" : "primary"}`, text: okLabel, onclick: () => finish(true) }),
      ]),
    ]);
    openModal({ title, body, narrow: true, onClose: () => finish(false) });
  });
}

export function promptDialog({ title = "Enter a value", label = "Value", value = "", placeholder = "", multiline = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => { if (settled) return; settled = true; closeModal(); resolve(v); };
    const input = multiline
      ? h("textarea", { value, placeholder, rows: 4 })
      : h("input", { type: "text", value, placeholder, maxlength: 400 });
    const body = h("div", [
      h("div", { class: "field" }, [h("label", { text: label }), input]),
      h("div", { class: "row end", style: { marginTop: "12px" } }, [
        h("button", { class: "btn ghost", text: "Cancel", onclick: () => finish(null) }),
        h("button", { class: "btn primary", text: "Save", onclick: () => finish(input.value.trim() || null) }),
      ]),
    ]);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !multiline) { e.preventDefault(); finish(input.value.trim() || null); }
    });
    openModal({ title, body, narrow: true, onClose: () => finish(null) });
    setTimeout(() => input.focus(), 30);
  });
}

/* ---------------- small builders ---------------- */
export function field(label, control, hint = "", extra = null) {
  return h("div", { class: "field" }, [
    h("label", { text: label }),
    control,
    hint ? h("div", { class: "hint", text: hint }) : null,
    extra,
  ]);
}

export function emptyState({ icon: ic = "spark", title, text, actions = [] }) {
  return h("div", { class: "empty" }, [
    h("div", { class: "empty-ico", html: icon(ic) }),
    h("h3", { text: title }),
    text ? h("p", { text }) : null,
    actions.length ? h("div", { class: "row" }, actions) : null,
  ]);
}

export function progressBlock(label = "") {
  const bar = h("i");
  const wrap = h("div", { class: "progress" }, [bar]);
  const pct = h("span", { text: "" });
  const lbl = h("span", { text: label });
  const meta = h("div", { class: "progress-label" }, [lbl, pct]);
  const el = h("div", {}, [wrap, meta]);
  return {
    el,
    set(value, text) {
      const v = clamp(Math.round(value * 100), 0, 100);
      bar.style.width = `${v}%`;
      pct.textContent = `${v}%`;
      if (text != null) lbl.textContent = text;
      wrap.classList.toggle("indeterminate", value < 0);
    },
    label(text) { lbl.textContent = text; },
    indeterminate(on = true) { wrap.classList.toggle("indeterminate", on); },
  };
}

export function tag(text, kind = "") {
  return h("span", { class: `tag ${kind}`, text });
}

export function segmented(options, value, onChange, { ariaLabel = "Options" } = {}) {
  const wrap = h("div", { class: "seg", role: "group", "aria-label": ariaLabel });
  for (const opt of options) {
    const btn = h("button", {
      type: "button", text: opt.label, title: opt.hint || "",
      "aria-pressed": opt.value === value ? "true" : "false",
      onclick: () => { onChange(opt.value); },
    });
    btn.dataset.value = opt.value;
    wrap.appendChild(btn);
  }
  wrap.setValue = (v) => {
    wrap.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.value === v ? "true" : "false"));
  };
  return wrap;
}

export function selectEl(options, value, onChange, { ariaLabel = "" } = {}) {
  const sel = h("select", { "aria-label": ariaLabel, onchange: () => onChange(sel.value) });
  for (const o of options) {
    const opt = h("option", { value: o.value, text: o.label });
    if (String(o.value) === String(value)) opt.selected = true;
    sel.appendChild(opt);
  }
  return sel;
}

export function checkbox(label, checked, onChange, hint = "") {
  const input = h("input", { type: "checkbox", onchange: () => onChange(input.checked) });
  input.checked = !!checked;
  const wrap = h("label", { class: "switch" }, [input, h("span", { text: label })]);
  if (!hint) return wrap;
  return h("div", {}, [wrap, h("div", { class: "hint", style: { marginTop: "4px" }, text: hint })]);
}

export function setStatus(text, kind = "") {
  const p = $("statusPill");
  if (!p) return;
  p.textContent = text;
  p.className = `pill ${kind}`.trim();
}

export function setProviderPill(text) {
  const p = $("providerPill");
  if (!p) return;
  p.textContent = text || "";
  p.hidden = !text;
}

export function busyButton(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.textContent = label || "Working…";
  } else {
    btn.disabled = false;
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
  }
}
