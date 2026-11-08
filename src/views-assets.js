/* ZTC AI Studio — asset library. */

import { activeProject, listAssets, assetUrl, putAsset, deleteAsset, save, scenesOf, storageUsage } from "./store.js";
import { $, h, clear, fmtBytes, debounce } from "./util.js";
import { iconEl, emptyState, openModal, closeModal, toast } from "./ui.js";

let mounted = false;
let filterKind = "all";
let query = "";
let paintFn = null;
let paintSeq = 0;

export function mountAssets(root) {
  mounted = true;
  clear(root);
  const search = h("input", { type: "search", placeholder: "Search assets by name or prompt…", value: query, "aria-label": "Search assets", oninput: debounce((e) => { query = e.target.value; paint(); }, 160) });
  const kinds = h("div", { class: "seg", role: "group", "aria-label": "Asset type" }, [
    kindBtn("all", "All"), kindBtn("image", "Images"), kindBtn("voice", "Voice"), kindBtn("music", "Music"),
  ]);
  const head = h("div", { class: "asset-filters" }, [
    h("h2", { text: "Assets", style: { marginRight: "6px" } }),
    search,
    kinds,
    h("span", { class: "spacer" }),
    h("span", { class: "pill ghost", id: "assetUsage" }),
    h("button", { class: "btn sm ghost", type: "button", onclick: uploadAsset }, [iconEl("upload"), "Upload"]),
    h("button", { class: "btn sm ghost", type: "button", onclick: cleanUnused }, [iconEl("trash"), "Clean unused"]),
  ]);
  const grid = h("div", { class: "asset-grid" });
  root.append(head, grid);
  paintFn = paint;
  paint();

  function kindBtn(kind, label) {
    return h("button", {
      type: "button", text: label, "aria-pressed": filterKind === kind ? "true" : "false",
      onclick: (e) => {
        filterKind = kind;
        e.currentTarget.parentElement.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", b === e.currentTarget ? "true" : "false"));
        paint();
      },
    });
  }

  async function paint() {
    const p = activeProject();
    if (!p) return;
    const seq = ++paintSeq;
    let assets = [];
    try { assets = await listAssets(p.id); } catch { assets = []; }
    if (seq !== paintSeq) return; // a newer paint already started
    const usage = await storageUsage();
    const used = (p.plan.scenes || []).flatMap((s) => [s.imageId, s.voiceId]).filter(Boolean);
    const totalBytes = assets.reduce((n, a) => n + (a.size || 0), 0);
    const label = $("assetUsage");
    if (label) label.textContent = `${assets.length} files · ${fmtBytes(totalBytes)}${usage.quota ? ` · ${Math.round((usage.used / usage.quota) * 100)}% of device quota` : ""}`;

    const list = assets.filter((a) => {
      if (filterKind !== "all" && a.kind !== filterKind) return false;
      if (!query) return true;
      const hay = `${a.name} ${a.meta?.prompt || ""} ${a.meta?.provider || ""} ${a.meta?.text || ""}`.toLowerCase();
      return hay.includes(query.toLowerCase());
    });

    grid.replaceChildren();
    if (!list.length) {
      grid.append(emptyState({
        icon: "image",
        title: assets.length ? "No assets match this filter" : "No media yet",
        text: assets.length ? "Try another search term or switch the filter." : "Generated images and voice-overs appear here automatically. You can also upload your own.",
        actions: [h("button", { class: "btn primary", type: "button", text: "Upload media", onclick: uploadAsset })],
      }));
      return;
    }

    list.forEach((asset) => {
      const inUse = used.includes(asset.id);
      const thumb = h("div", { class: "a-thumb" });
      if (asset.kind === "image") {
        assetUrl(asset.id).then((url) => { if (url) thumb.prepend(h("img", { src: url, alt: asset.name, loading: "lazy" })); });
      } else {
        thumb.append(h("div", { class: "a-ico", html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>` }));
      }
      thumb.append(h("span", { class: "a-kind" }, [h("span", { class: "tag", text: asset.kind })]));
      const card = h("article", { class: "asset" }, [
        thumb,
        h("div", { class: "a-body" }, [
          h("div", { class: "a-name", title: asset.name, text: asset.name }),
          h("div", { class: "a-meta" }, [
            h("span", { text: fmtBytes(asset.size) }),
            h("span", { text: asset.meta?.provider || asset.mime?.split("/")[1] || "" }),
          ]),
          h("div", { class: "a-acts" }, [
            h("button", { class: "icon-btn", type: "button", title: "Preview", "aria-label": `Preview ${asset.name}`, html: iconEl("eye").outerHTML, onclick: () => preview(asset) }),
            h("button", { class: "icon-btn", type: "button", title: "Download", "aria-label": `Download ${asset.name}`, html: iconEl("download").outerHTML, onclick: () => download(asset) }),
            h("button", { class: "icon-btn", type: "button", title: inUse ? "Used in the current project" : "Delete", "aria-label": `Delete ${asset.name}`, html: iconEl("trash").outerHTML, onclick: () => remove(asset, inUse) }),
            inUse ? h("span", { class: "tag ok", text: "in use" }) : null,
          ]),
        ]),
      ]);
      grid.appendChild(card);
    });
  }

  async function preview(asset) {
    const url = await assetUrl(asset.id);
    if (!url) { toast("Asset data is missing", "bad"); return; }
    const body = h("div", { class: "stack" }, [
      asset.kind === "image"
        ? h("img", { src: url, alt: asset.name, style: { width: "100%", borderRadius: "10px", border: "1px solid var(--line)" } })
        : h("audio", { src: url, controls: true, style: { width: "100%" } }),
      h("div", { class: "small muted", style: { fontFamily: "var(--mono)", whiteSpace: "pre-wrap", lineHeight: "1.6" } }, [
        `${asset.kind} · ${fmtBytes(asset.size)} · ${asset.mime}\nprovider: ${asset.meta?.provider || "—"}\nmodel: ${asset.meta?.model || "—"}\nseed: ${asset.meta?.seed ?? "—"}\n${asset.meta?.prompt ? `prompt: ${asset.meta.prompt}` : ""}`,
      ]),
      h("div", { class: "row end" }, [
        h("button", { class: "btn", type: "button", onclick: () => download(asset) }, [iconEl("download"), "Download"]),
        h("button", { class: "btn ghost", type: "button", onclick: closeModal, text: "Close" }),
      ]),
    ]);
    openModal({ title: asset.name, body, wide: asset.kind === "image" });
  }

  async function download(asset) {
    const url = await assetUrl(asset.id);
    if (!url) return;
    const a = h("a", { href: url, download: asset.name || "asset" });
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function remove(asset, inUse) {
    if (inUse) { toast("This asset is used by a scene. Remove it from the scene first.", "warn"); return; }
    await deleteAsset(asset.id);
    toast("Asset deleted", "ok");
    paint();
  }

  async function uploadAsset() {
    const input = $("fileImage");
    input.multiple = true;
    input.accept = "image/*,audio/*";
    input.onchange = async () => {
      const files = [...(input.files || [])];
      input.value = "";
      input.multiple = false;
      input.accept = "image/*";
      const p = activeProject();
      for (const f of files) {
        if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is over 20 MB`, "warn"); continue; }
        const kind = f.type.startsWith("audio") ? "voice" : "image";
        await putAsset({ blob: f, kind, projectId: p.id, name: f.name, meta: { provider: "upload", mime: f.type } });
      }
      save();
      toast(`${files.length} file(s) added`, "ok");
      paint();
    };
    input.click();
  }

  async function cleanUnused() {
    const p = activeProject();
    const used = new Set(scenesOf(p).flatMap((s) => [s.imageId, s.voiceId]).filter(Boolean));
    const all = await listAssets(p.id);
    const unused = all.filter((a) => !used.has(a.id));
    if (!unused.length) { toast("Nothing to clean — every asset is in use", "ok"); return; }
    for (const a of unused) await deleteAsset(a.id);
    toast(`${unused.length} unused asset(s) removed`, "ok");
    paint();
  }
}

export function refreshAssets() { if (mounted && paintFn) paintFn(); }
