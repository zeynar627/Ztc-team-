# ZTC AI Studio

**Live:** https://zeynar627.github.io/Ztc-team-/ · **Repository:** https://github.com/zeynar627/Ztc-team-

**Prompt → script → storyboard → AI art → voice-over → music → captions → video.**  
A build-ready, single-page production studio that runs entirely in the browser. Free providers first, automatic failover, no secret keys, no backend required.

> Preserves the ZTC identity (red/black REDLINE palette, hexagon mark, "Powered by Zeynar The Creator") and the original workbench's multi-provider routing, while turning the old "video prompt pack" into a real, editable, renderable timeline.

---

## Quick start

```bash
cd ztc-studio
node server.mjs                 # → http://localhost:8080
```

No install step, no build step, no dependencies. `server.mjs` is a ~170-line Node static server (Node ≥ 20). Any static host works equally well — see [docs/DEPLOY.md](docs/DEPLOY.md).

Optional:

```bash
PORT=3000 RELAY_TOKEN=some-long-secret node server.mjs   # also enables the CORS relay
npm test                                                 # 19 logic tests, no network
```

First run: type a brief (or click an example) → **Generate plan** → **Auto-produce**. The plan and asset generation work with **zero configuration**; voice-over uses Puter's free sign-in, and every other step has a documented fallback.

---

## What it actually does

| Capability | Implementation | Needs a key? |
|---|---|---|
| Prompt correction | LLM pass (JSON, validated) → rule-based cleanup fallback | No |
| Prompt enhancement / expansion | LLM creative-brief pass → deterministic template expansion | No |
| Script, scenes, storyboard, chapters | LLM planner (strict schema) → offline template writer | No |
| Scene art | AI Horde → Pollinations → built-in procedural renderer | No |
| Voice-over | Puter neural TTS → StreamElements → your Piper/Kokoro endpoint | Free Puter account, or your own endpoint |
| Background music | Built-in Web Audio composer (8 moods) or your own model endpoint | No |
| Video | Canvas → `MediaRecorder` (MP4 where supported, else WebM) + live audio mix | No |
| Subtitles | Burned-in + SRT + VTT, timed to the audio track | No |
| Editing | Storyboard inspector, drag-reorder timeline, per-scene regenerate/upload | No |
| Export | Video, WAV mix, SRT/VTT, storyboard PNG, ZIP bundle, project JSON, share link | No |
| Versions | Automatic snapshot before each run + manual saves, restore | No |

Everything listed is wired end to end. There are no stub buttons.

---

## Requirements

- **Node ≥ 20** only if you use the bundled server (`node server.mjs`). The app itself is static files.
- A modern browser with **Canvas**, **Web Audio**, **IndexedDB** and **MediaRecorder** — Chrome/Edge 111+, Firefox 115+, Safari 16.4+.
- Optional: **FFmpeg** on your machine if you want `.mp4` from a `.webm` capture (one command, documented in every export ZIP).
- Optional: a **free Puter account** for neural voice-over, or a local Piper/Kokoro server.

No build tools, no bundler, no framework, no npm runtime dependencies.

---

## How the pipeline works

```
brief
  │  correct → enhance            (LLM, validated JSON; local rules fallback)
  ▼
plan ── scenes[] {narration, visual, duration, motion, transition}
  │  merge with existing plan     (finished assets are kept; changed shots are marked stale)
  ▼
assets ── per scene: image (hash-cached) + voice (hash-cached) + measured duration
  │  rebalance() keeps the target length without cutting voice-over
  ▼
timeline ── captions built from narration, timed to each scene
  ▼
render ── canvas frames + audio graph captured in real time
  ▼
MP4/WebM + SRT/VTT + WAV + storyboard PNG + report + ZIP
```

**Resumability.** Each stage writes `project.pipeline.<stage>.status`. Every generated asset is stored in IndexedDB under a content hash of `(prompt, model, style, size, seed)`. Re-running skips what exists; a failure never discards completed work.

**Failover.** `src/providers.js` keeps per-provider health, latency and cooldowns. `withFailover()` sorts by health, skips cooling/unauthorised providers, retries once, then switches — logging every attempt to the provider log and the exported report. A provider switch is visible in the UI, not silent.

---

## Project layout

```
ztc-studio/
├── index.html                 app shell (views, dialogs, a11y landmarks)
├── styles/
│   ├── tokens.css             design tokens, dark + light themes
│   ├── app.css                shell, rail, topbar, components
│   ├── studio.css             studio, storyboard, timeline, assets
│   └── chat.css               AI chat workbench
├── src/
│   ├── main.js                bootstrap, routing, palette, shortcuts
│   ├── util.js                DOM helpers, hashing, ZIP writer, share codec
│   ├── catalog.js             styles, templates, moods, aspects, effects
│   ├── store.js               state, localStorage, IndexedDB, versions
│   ├── providers.js           registry, health, failover, relay
│   ├── llm.js                 streaming chat, strict JSON, research, agents
│   ├── generate.js            brief work, deterministic planner, validation, merge
│   ├── media.js               images, voice, music synthesis, WAV
│   ├── audio.js               preview/record/mix audio engine
│   ├── render.js              canvas renderer, 2.5D camera, 3D mesh, captions
│   ├── pipeline.js            staged production, resume, batch variants
│   ├── export.js              recorder, SRT/VTT, contact sheet, bundle, share
│   ├── ui.js                  icons, toasts, accessible modal, progress
│   ├── views-studio.js        brief + preview + pipeline
│   ├── views-board.js         storyboard + timeline
│   ├── views-assets.js        asset library
│   ├── views-chat.js          streaming chat, agents, council
│   └── views-dialogs.js       export, settings, providers, versions, help
├── server.mjs                 static server + optional relay (zero deps)
├── api/relay.js               Vercel serverless relay (optional)
├── tests/core.test.mjs        logic tests (node --test)
└── docs/                      limitations, licensing, providers, extending, deploy
```

---

## Configuration

Everything is configured in the app (**Settings**), stored in `localStorage`. No `.env` is required and no key is compiled into the code.

| Setting | Default | Notes |
|---|---|---|
| Image model | `Flux.1-Schnell fp8 (Compact)` | AI Horde model id. Verified ids are offered in the picker. |
| Voice | `Joanna` | Puter/Polly voice; StreamElements accepts the same names. |
| Voice endpoint | empty | `POST {text, voice}` → audio bytes (Piper/Kokoro). |
| Music endpoint | empty | Optional MusicGen/Stable Audio server. |
| AI Horde key | `0000000000` | Public anonymous key; a personal key raises queue priority. |
| Relay URL / token | empty | Only needed for providers that block CORS. |
| LLM keys | empty | Groq, Gemini, Mistral, Cerebras, OpenRouter, SambaNova, SiliconFlow, NVIDIA, GitHub, Hugging Face, Cloudflare. |

Keyless text routes (OVHcloud, Pollinations, Kilo anonymous, LLMFaucet, G4F, AI Horde) are tried before any keyed provider.

---

## Deployment

### GitHub Pages (one click after the first push)

The repo ships `.github/workflows/pages.yml`. Push to `main`, then set **Settings → Pages → Source = GitHub Actions** once. Every later push redeploys automatically.

### Static host (recommended)

Upload the folder as-is to Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3 or nginx.

- **Vercel:** `vercel.json` sets headers and rewrites; `api/relay.js` becomes `/api/relay` automatically.
- **Netlify / Cloudflare Pages:** `netlify.toml` publishes the root; no build command.
- **GitHub Pages:** push the folder; the app is relative-path safe (no leading `/`).

### Self-hosted

```bash
PORT=8080 node server.mjs
```

Serve behind HTTPS if you use the relay or browser APIs that require a secure context (`getUserMedia`, some clipboard features).

Full details, headers and relay security notes: [docs/DEPLOY.md](docs/DEPLOY.md).

---

## Honest limitations

- **Animation is 2.5D**, not generative motion: camera moves, parallax, transitions and VFX over stills. True text-to-video needs a paid/GPU model; the integration path is documented in [docs/EXTENDING.md](docs/EXTENDING.md).
- **Rendering is real time.** A 5-minute video takes about 5 minutes; the tab must stay focused.
- **Free image tiers are queued and rate-limited.** Pollinations' keyless tier allows roughly one image per 45 seconds at ≤768px; AI Horde queues can be minutes long. The procedural renderer is the always-available floor.
- **Browser speech cannot be captured.** Preview uses the OS voice; export needs Puter, StreamElements, or your endpoint. If all fail, the video exports with captions and music, and the UI says so.
- **`.webm` vs `.mp4`.** MP4 is used when the browser supports recording it; otherwise WebM (one `ffmpeg` command converts).
- **No publishing.** The app never uploads to YouTube/TikTok; it produces files and metadata.

Full list: [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

---

## Licensing

- **This project:** MIT (see `LICENSE`). Do not bundle third-party model weights.
- **AI images:** governed by the provider that generated them (recorded per scene in `report.json`).
- **Music:** synthesised locally by this app — no samples, no external licence.
- **Voice:** from the selected TTS provider; check its terms before commercial use.
- **Optional models:** MusicGen weights are **CC-BY-NC** (non-commercial); XTTS-v2 is non-commercial; SDXL-Turbo is non-commercial; Stable Audio Open has its own terms. These are never bundled and never used by default.

Details: [docs/LICENSING.md](docs/LICENSING.md).

---

## Tests

```bash
npm test
```

19 tests cover: duration distribution, deterministic planning, plan validation and repair, asset-preserving merges, caption timing and character limits, SRT/VTT format, timeline mapping, voice-safe rebalancing, ZIP validity and CRC32, share-link round-trip, JSON extraction, catalog integrity.

Browser smoke test (optional, 22 checks including a real 6-second MP4 render):

```bash
npm i -D playwright
npx playwright install chromium
node tests/browser.test.mjs
```

It serves the app, mounts every view, generates a plan with all network calls blocked (proving the offline fallback), checks the canvas renders, and asserts zero console errors.

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md). 3.1 is a reliability and production pass: verified media existence, visible quota failures, unload-safe saves, Safari audio fixes, reduced-motion rendering, manifest/OG metadata, 404/robots, CI and Pages deployment.

## Credits

Built on the ZTC AI workbench lineage (multi-provider routing, agent/council modes, provider health) and the ZTC prompt-to-video plan.  
**Powered by Zeynar The Creator.**
