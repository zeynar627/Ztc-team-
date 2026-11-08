/* ZTC AI Studio — AI chat workbench (streaming, agents, council, research). */

import { activeProject, save, state, setView } from "./store.js";
import { streamChat, runAgents, runCouncil, research, chatText } from "./llm.js";
import { $, h, clear, uid, downloadText, copyText } from "./util.js";
import { iconEl, toast, setStatus, tag, segmented } from "./ui.js";

let C = { built: false, busy: false, ctl: null, mode: "single", research: false, verify: false, live: null };

const SUGGESTIONS = [
  { label: "Improve my brief", text: "Rewrite this video brief so it is sharper and more visual, and suggest three different opening hooks:" },
  { label: "Shot list", text: "Turn my brief into a 6-shot list with lens, camera move and lighting notes:" },
  { label: "Caption pass", text: "Tighten these captions so each one fits on a single line and stays under 64 characters:" },
];

export function mountChat(root) {
  if (C.built) { C.render?.(); return; }
  C.built = true;
  clear(root);
  const p = activeProject();

  const modeSeg = segmented([
    { value: "auto", label: "Auto" },
    { value: "agents", label: "Agents" },
    { value: "council", label: "Council" },
    { value: "single", label: "Single" },
  ], C.mode, (v) => { C.mode = v; modeSeg.setValue(v); }, { ariaLabel: "Answer mode" });

  const researchToggle = h("label", { class: "switch" }, [
    (() => { const i = h("input", { type: "checkbox", onchange: () => { C.research = i.checked; } }); i.checked = C.research; return i; })(),
    h("span", { text: "Web research" }),
  ]);
  const verifyToggle = h("label", { class: "switch" }, [
    (() => { const i = h("input", { type: "checkbox", onchange: () => { C.verify = i.checked; } }); i.checked = C.verify; return i; })(),
    h("span", { text: "Verify" }),
  ]);

  const bar = h("div", { class: "chat-bar" }, [
    modeSeg, researchToggle, verifyToggle,
    h("span", { class: "spacer" }),
    h("button", { class: "btn sm ghost", type: "button", onclick: () => exportChat() }, [iconEl("download"), "Export"]),
    h("button", { class: "btn sm ghost", type: "button", onclick: clearChat }, [iconEl("trash"), "Clear"]),
  ]);

  const log = h("div", { id: "chatLog", role: "log", "aria-live": "polite" });
  const input = h("textarea", {
    id: "chatInput", rows: 2, maxlength: 8000,
    placeholder: "Ask for help with the script, hook, captions, or anything else. Enter sends, Shift+Enter adds a line.",
    "aria-label": "Message",
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  });

  const sendBtn = h("button", { class: "btn primary", type: "button", onclick: send }, "Send");
  const stopBtn = h("button", { class: "btn danger", type: "button", hidden: true, onclick: stop }, "Stop");
  const composer = h("div", { class: "composer" }, [
    h("div", { class: "inwrap" }, [input]),
    h("div", { class: "crow" }, [
      h("span", { class: "small muted", text: "Runs on free providers, switches automatically when one is busy." }),
      h("span", { class: "sp" }),
      stopBtn, sendBtn,
    ]),
  ]);

  root.append(h("div", { class: "chat-wrap" }, [bar, log, composer]));
  C.render = renderChat;
  renderChat();

  async function send() {
    if (C.busy) return;
    const p = activeProject();
    const text = input.value.trim();
    if (!text) return;
    p.chat.push({ id: uid("m"), role: "user", content: text, at: Date.now() });
    input.value = "";
    input.style.height = "auto";
    save();
    renderChat();
    await respond(p, text);
  }

  async function respond(p, text) {
    C.busy = true;
    sendBtn.hidden = true;
    stopBtn.hidden = false;
    C.ctl = new AbortController();
    const signal = C.ctl.signal;
    const mode = C.mode === "auto" ? autoMode(text) : C.mode;
    setStatus(`${mode} · working`, "run");

    const bubble = h("div", { class: "msg assistant streaming" });
    const traceBox = h("div");
    const bodyEl = h("div", { class: "body md" });
    bubble.append(traceBox, bodyEl);
    log.appendChild(bubble);
    log.scrollTop = log.scrollHeight;

    let trace = [];
    let answer = "";
    let provider = "";
    let verdict = "";
    let sources = [];
    let error = "";

    const paintTrace = (steps) => {
      traceBox.replaceChildren(traceNodes(steps));
    };

    try {
      if (C.research) {
        const r = await research(text, { deep: mode === "council", signal });
        sources = r.sources;
        if (r.context) text = `Use the research below when relevant and name the sources you use.\n\n${r.context}\n\nRequest:\n${text}`;
      }

      const history = p.chat.filter((m) => m.role === "user" || m.role === "assistant").slice(-12).map((m) => ({ role: m.role, content: m.content }));
      if (history.length && history[history.length - 1].role === "user") history[history.length - 1].content = text;

      if (mode === "agents") {
        const res = await runAgents({
          task: text, history, system: state.settings.systemPrompt || undefined,
          settings: state.settings, signal, verify: C.verify, light: false,
          onStep: (steps) => { trace = steps; paintTrace(steps); },
        });
        answer = res.text;
        verdict = res.verdict;
        provider = [...new Set(trace.map((s) => s.provider).filter(Boolean))].slice(0, 3).join(" → ");
      } else if (mode === "council") {
        const res = await runCouncil({ task: text, history, settings: state.settings, signal, onStep: (steps) => { trace = steps; paintTrace(steps); } });
        answer = res.text;
        provider = "council · 3 drafts";
      } else {
        const res = await streamChat({
          messages: history, settings: state.settings, signal,
          onDelta: (chunk) => {
            answer += chunk;
            renderMarkdown(bodyEl, answer);
            log.scrollTop = log.scrollHeight;
          },
          onEvent: (e) => {
            trace.push({ role: "route", label: e.text, status: e.level === "fail" ? "failed" : "done", provider: e.provider || "", ms: 0 });
            paintTrace(trace);
          },
        });
        answer = res.text;
        provider = res.provider;
        if (res.partial) verdict = "PARTIAL";
      }

      if (C.verify && mode === "single" && answer) {
        const v = await chatText([
          { role: "system", content: 'Check this answer for factual or logical errors. Reply with JSON only: {"verdict":"PASS"|"WARN"|"FAIL","issues":["..."]}' },
          { role: "user", content: `Task: ${text}\n\nAnswer:\n${answer}` },
        ], { settings: state.settings, signal, maxTokens: 400, temperature: 0.1 });
        try {
          const j = JSON.parse(v.text.slice(v.text.indexOf("{"), v.text.lastIndexOf("}") + 1));
          verdict = String(j.verdict || "").toUpperCase();
        } catch { verdict = "UNPARSED"; }
      }
    } catch (e) {
      if (e?.name === "AbortError" || signal.aborted) {
        if (answer) verdict = "STOPPED";
      } else {
        error = String(e.message || e);
      }
    }

    bubble.remove();
    C.busy = false;
    sendBtn.hidden = false;
    stopBtn.hidden = true;
    C.ctl = null;

    if (error) {
      p.chat.push({ id: uid("m"), role: "error", content: `Error: ${error}`, at: Date.now() });
      setStatus("Failed", "bad");
    } else if (answer.trim()) {
      p.chat.push({
        id: uid("m"), role: "assistant", content: answer, provider, verdict,
        sources, trace: trace.map((s) => ({ label: s.label, route: s.provider, status: s.status, ms: s.ms, error: s.error })), at: Date.now(),
      });
      setStatus("Ready", "ok");
    } else {
      setStatus("No output", "warn");
      toast("The models returned nothing. Try Single mode.", "warn");
    }
    save();
    renderChat();
  }

  function stop() { C.ctl?.abort(); }

  function clearChat() {
    const p = activeProject();
    if (!p.chat.length) return;
    p.chat = [];
    save();
    renderChat();
    toast("Chat cleared", "ok");
  }

  function exportChat() {
    const p = activeProject();
    const md = p.chat.map((m) => `## ${m.role === "user" ? "You" : m.role === "error" ? "Error" : "Assistant"}${m.provider ? ` · ${m.provider}` : ""}\n\n${m.content}`).join("\n\n");
    downloadText(md || "Empty chat", "ztc-chat.md", "text/markdown");
  }

  function renderChat() {
    const p = activeProject();
    clear(log);
    if (!p.chat.length) {
      log.append(h("div", { class: "chat-empty" }, [
        h("h3", { text: "A second pair of eyes" }),
        h("p", { text: "Use the chat for script polish, hooks, captions, research, or a full multi-agent pass. Responses stream from free providers and switch provider automatically when one is rate-limited." }),
        h("div", { class: "row", style: { justifyContent: "center", flexWrap: "wrap" } },
          SUGGESTIONS.map((s) => h("button", {
            class: "chip", type: "button", text: s.label,
            onclick: () => { input.value = s.text; input.focus(); input.dispatchEvent(new Event("input")); },
          }))),
      ]));
      return;
    }
    p.chat.forEach((m, i) => log.appendChild(messageNode(m, i)));
    log.scrollTop = log.scrollHeight;
  }

  function messageNode(m, i) {
    if (m.role === "error") {
      return h("div", { class: "msg error" }, [
        h("div", { text: m.content }),
        h("div", { class: "acts" }, [
          h("button", { class: "btn sm", type: "button", text: "Retry", onclick: () => { const p = activeProject(); const prev = [...p.chat].slice(0, i).reverse().find((x) => x.role === "user"); p.chat = p.chat.slice(0, i); if (prev) respond(p, prev.content); else renderChat(); } }),
        ]),
      ]);
    }
    if (m.role === "user") {
      return h("div", { class: "msg user" }, [
        h("div", { text: m.content }),
        h("div", { class: "acts" }, [
          h("button", { class: "btn sm", type: "button", text: "Copy", onclick: () => copyText(m.content).then(() => toast("Copied", "ok")) }),
          h("button", { class: "btn sm", type: "button", text: "Edit", onclick: () => { input.value = m.content; input.focus(); } }),
        ]),
      ]);
    }
    const body = h("div", { class: "body md" });
    renderMarkdown(body, m.content || "");
    const meta = h("div", { class: "meta" });
    if (m.provider) meta.appendChild(tag(m.provider));
    if (m.verdict) meta.appendChild(tag(`verifier ${String(m.verdict).toLowerCase()}`, m.verdict === "PASS" ? "ok" : m.verdict === "FAIL" ? "bad" : "warn"));
    for (const s of m.sources || []) {
      if (!s.url) continue;
      meta.appendChild(h("a", { class: "tag", href: s.url, target: "_blank", rel: "noopener noreferrer", text: String(s.title || s.url).slice(0, 34) }));
    }
    const acts = h("div", { class: "acts" }, [
      h("button", { class: "btn sm", type: "button", text: "Copy", onclick: () => copyText(m.content || "").then(() => toast("Copied", "ok")) }),
      h("button", { class: "btn sm", type: "button", text: "Use as brief", onclick: () => {
        const p = activeProject();
        p.brief.text = String(m.content || "").slice(0, 1800);
        save();
        setView("studio");
        toast("Sent to the Studio brief", "ok");
      } }),
      h("button", { class: "btn sm", type: "button", text: "Speak", onclick: () => speak(m.content || "") }),
      h("button", { class: "btn sm", type: "button", text: "Delete", onclick: () => { const p = activeProject(); p.chat = p.chat.filter((x) => x.id !== m.id); save(); renderChat(); } }),
    ]);
    return h("div", { class: "msg assistant" }, [m.trace?.length ? traceNodes(m.trace) : null, body, meta, acts]);
  }
}

function autoMode(text) {
  const t = String(text).toLowerCase();
  if (/\b(build|implement|refactor|debug|code|architecture|plan|multi-step)\b/.test(t)) return "agents";
  if (/\b(compare|options|decide|trade-?off|council)\b/.test(t)) return "council";
  return "single";
}

function traceNodes(trace) {
  if (!trace?.length) return document.createDocumentFragment();
  const pipe = h("div", { class: "pipe" }, trace.map((s) => h("span", { class: `stage ${s.status === "done" ? "done" : s.status === "failed" ? "fail" : "run"}` }, [
    h("i"), h("span", { text: s.label }), s.provider ? h("span", { class: "vd", text: String(s.provider).split(" · ").pop() }) : null,
  ])));
  const rows = trace.filter((s) => s.error).slice(0, 4).map((s) => h("div", { class: "tstep" }, [
    h("span", { class: "tn", text: s.label }),
    h("span", { class: "tr", text: s.route || "" }),
    h("pre", { text: s.error }),
  ]));
  const det = h("details", { class: "trace" }, [
    h("summary", { text: `Agent trace · ${trace.length} step${trace.length === 1 ? "" : "s"}` }),
    ...rows,
  ]);
  return h("div", {}, [pipe, rows.length ? det : null]);
}

/* ---------------- markdown ---------------- */
export function renderMarkdown(container, raw) {
  clear(container);
  const re = /```([\w+#.-]*)\r?\n?([\s\S]*?)```/g;
  let last = 0, m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) appendProse(container, raw.slice(last, m.index));
    container.appendChild(codeBlock((m[1] || "txt").toLowerCase(), m[2]));
    last = m.index + m[0].length;
  }
  if (last < raw.length) appendProse(container, raw.slice(last));
}

function appendProse(root, text) {
  const lines = String(text).split("\n");
  let list = null;
  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      list = null;
      const el = h(heading[1].length <= 1 ? "h3" : heading[1].length === 2 ? "h4" : "h5");
      inline(el, heading[2]);
      root.appendChild(el);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) {
      if (!list) { list = h("ul"); root.appendChild(list); }
      const li = h("li"); inline(li, bullet[1]); list.appendChild(li);
      continue;
    }
    if (!line.trim()) { list = null; continue; }
    list = null;
    const p = h("p"); inline(p, line); root.appendChild(p);
  }
}

function inline(node, s) {
  const re = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\n]+\*)/g;
  let last = 0, m;
  while ((m = re.exec(s)) !== null) {
    if (m.index > last) node.appendChild(document.createTextNode(s.slice(last, m.index)));
    const t = m[0];
    if (t.startsWith("**")) node.appendChild(h("strong", { text: t.slice(2, -2) }));
    else if (t.startsWith("`")) node.appendChild(h("code", { text: t.slice(1, -1) }));
    else node.appendChild(h("em", { text: t.slice(1, -1) }));
    last = m.index + t.length;
  }
  if (last < s.length) node.appendChild(document.createTextNode(s.slice(last)));
}

function codeBlock(lang, code) {
  const copy = h("button", { class: "btn sm", type: "button", text: "Copy", onclick: () => copyText(code).then(() => toast("Copied", "ok")) });
  const wrap = h("div", { class: "code" }, [
    h("div", { class: "codebar" }, [h("span", { class: "lang", text: lang || "txt" }), copy]),
    h("textarea", { readonly: true, spellcheck: false, value: code, style: { height: `${Math.min(360, Math.max(70, code.split("\n").length * 18 + 20))}px` } }),
  ]);
  return wrap;
}

function speak(text) {
  try {
    speechSynthesis.cancel();
    speechSynthesis.speak(new SpeechSynthesisUtterance(String(text).replace(/[*`#_]/g, "").slice(0, 3000)));
  } catch { toast("Speech is not available in this browser", "warn"); }
}

export function refreshChat() { if (C.built) C.render?.(); }
