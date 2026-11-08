# Provider registry

Every capability resolves through `src/providers.js`. Providers are tried in health order; each attempt, failure and switch is written to the provider log and to `report.json`.

```
ordered(providers, settings)
  → readiness(): disabled? needs key? needs account id? cooling down?
  → score: reliability × 100 − latency − failure streak + kind bonus
  → withFailover(run): retry once, then next provider, abort-safe
```

Health is per-session (in memory): `ok`, `fail`, `streak`, `cool`, `lastMs`, `lastError`. Failures cool down for 8s × streak (max 120s). “Reset health” is in Settings.

---

## Text / planning

| Order | Provider | Access | Notes |
|---|---|---|---|
| 1 | OVHcloud AI Endpoints | keyless | Public OpenAI-compatible endpoint; rate-limited. |
| 2 | Pollinations Text | keyless | One free text request per 30s per IP. |
| 3 | Kilo (anonymous) | keyless | Bearer `anonymous`; model availability varies. |
| 4 | LLMFaucet | keyless | Bearer `free`; auto-routing. |
| 5 | G4F · Groq / Gemini | keyless | Community proxies; no SLA. |
| 6 | AI Horde (text) | keyless | Crowdsourced queue; anonymous key `0000000000`. |
| 7 | Puter AI | free account | Requires Puter sign-in; uses your Puter allowance. |
| 8+ | Groq, Gemini, Mistral, Cerebras, OpenRouter, SambaNova, SiliconFlow, NVIDIA, GitHub Models, Hugging Face, Cloudflare | your key | Free tiers where offered. |

Text providers are **optional**. Without any working route, the planner falls back to the deterministic template writer and the app still produces a complete script and shot list.

---

## Images

| Order | Provider | Access | Constraints |
|---|---|---|---|
| 1 | AI Horde | keyless | Crowdsourced SD/FLUX workers, queue-based. `0000000000` is the public anonymous key. Sizes are 64-px aligned. |
| 2 | Pollinations | keyless | **One image per ~45s per IP, ≤768px, single model (`sana`), small logo.** Returns HTTP 402 with `Retry-After` beyond the free slot. |
| 3 | Procedural canvas | local | Built-in generative art. No network, no quota, deterministic per seed. |

The procedural renderer is the guaranteed floor: a video can always be produced offline. It is real generated artwork (gradient fields, seeded geometry, grain, vignette), not a placeholder image.

Because the keyless image tier is slow, a 12-scene video can take several minutes. Assets are content-addressed, so nothing is regenerated twice.

**AI Horde model ids** are real worker model names. Verified examples used in the picker: `Flux.1-Schnell fp8 (Compact)`, `Z-Image-Turbo`, `Juggernaut XL`, `SDXL 1.0`, `Realistic Vision`, `DreamShaper XL`, `Anything v5`. Model availability changes; a missing model fails over automatically.

---

## Voice

| Order | Provider | Access | Notes |
|---|---|---|---|
| 1 | Puter TTS | free account | `puter.ai.txt2speech`, AWS Polly neural voices by default. Text limit 3,000 chars per call. Requires a free Puter sign-in. |
| 2 | StreamElements | keyless | Public endpoint, best-effort, no SLA. |
| 3 | Self-hosted endpoint | your server | `POST {text, voice}` → audio bytes. Piper or Kokoro recommended. |
| — | Browser speech | local | **Preview only.** Browsers do not expose the OS voice as a capture stream, so it is never used for export. |

If every voice provider fails, the pipeline keeps going: the video exports with captions and music, each scene is marked `voice: failed`, and the UI/report say so. Nothing is silently muted.

### Self-hosted TTS contract

```http
POST /v1/audio/speech
Authorization: Bearer <optional token>
Content-Type: application/json

{ "text": "…", "voice": "Joanna", "format": "wav" }
→ 200 audio/wav (or audio/mpeg)
```

Piper (MIT) runs comfortably on CPU; Kokoro-82M (Apache-2.0) is CPU-usable and higher quality. Both are commercial-safe.

---

## Music

| Order | Provider | Access | Notes |
|---|---|---|---|
| 1 | Built-in composer | local | 8 moods; chords, bass, arpeggio, drums rendered with Web Audio. MIT, original synthesis, no samples. |
| 2 | Self-hosted model endpoint | your server | Optional; `POST {prompt, duration}` → audio bytes. |

Neural music models are **not bundled**:

- **MusicGen** (Meta) — weights are **CC-BY-NC 4.0**, non-commercial. Do not use for monetised work.
- **Stable Audio Open** — Stability's own terms; check them at build time.
- **AudioGen** — CC-BY-NC, non-commercial.

See [LICENSING.md](LICENSING.md).

---

## CORS and the relay

Some providers block browser requests. `fetchWithTimeout()` can route through a relay you deploy:

1. Deploy `api/relay.js` (Vercel) or run `RELAY_TOKEN=… node server.mjs`.
2. Settings → Providers → CORS relay → URL + token.
3. The relay only forwards to an allow-list of HTTPS hosts and never adds credentials of its own. It is a transport, not an authentication bypass.

The relay does **not** make paid APIs free, and it does not remove provider rate limits.

---

## Adding a provider

1. Add an entry to the relevant array in `src/providers.js` (`LLM_PROVIDERS`, `IMAGE_PROVIDERS`, `VOICE_PROVIDERS`, `MUSIC_PROVIDERS`).
2. For an OpenAI-compatible text endpoint, no code is needed — `model`, `url`, optional `keyRef`/`headers` are enough.
3. For a different protocol, add an adapter branch in `callProvider()` (`src/llm.js`) or in `generateImage()` / `generateVoice()` (`src/media.js`).
4. Keep it honest: declare `kind` (`keyless`, `key`, `account`, `local`), a `note`, and a `license` where relevant.

The router, health tracking, UI and report pick it up automatically.
