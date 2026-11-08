# Licensing and rights

Not legal advice. Licences change — verify at build and release time.

## This project

**MIT** (see `LICENSE`), copyright Zeynar The Creator. No third-party model weights, samples or media are bundled. The code contains no API keys.

## What you generate

| Asset | Rights | Where it is recorded |
|---|---|---|
| Scene images | Terms of the provider that produced them (AI Horde worker model, Pollinations, or this project's procedural renderer) | `scene.provider.image`, `report.json` |
| Voice audio | Terms of the TTS provider (Puter/AWS Polly, StreamElements, or your endpoint) | `scene.provider.voice`, `report.json` |
| Music | Original synthesis by this app — MIT, no samples | `report.json` |
| Captions, script, project JSON | Yours | Bundle |

**Do not assume "AI generated" means "rights cleared".** If you monetise a video, check the image provider's terms and, for AI Horde, the model that actually rendered each scene (it is in the report).

## Model licence snapshot

| Model | Licence | Commercial use |
|---|---|---|
| Piper (TTS) | MIT | Yes |
| Kokoro-82M (TTS) | Apache-2.0 | Yes |
| Whisper (alignment) | MIT | Yes |
| FLUX.1-schnell | Apache-2.0 | Yes |
| Stable Diffusion 1.5 | CreativeML OpenRAIL-M | Yes, with use restrictions |
| SDXL-Turbo | Stability non-commercial licence | **No** (research/non-commercial) |
| RIFE (interpolation) | MIT | Yes |
| AnimateDiff | Apache-2.0 (code) | Check motion-module weights |
| Stable Video Diffusion | Stability community licence | Yes under revenue threshold — verify |
| MusicGen / AudioGen | **CC-BY-NC 4.0** | **No** |
| Stable Audio Open | Stability terms | Verify current terms |
| XTTS-v2 (voice cloning) | Coqui CPML | **No** (non-commercial) |
| TripoSR (image→3D) | MIT | Yes |
| TRELLIS (image→3D) | MIT | Yes |
| Ollama models | Per model (Llama, Qwen, Mistral…) | Per model |

Models marked **No** are not used anywhere in this app and are not bundled. If you enable them through a self-hosted endpoint, that is your decision and your obligation.

## Services

- **Pollinations** — free keyless tier, rate-limited; outputs carry a small logo. Subject to Pollinations' terms.
- **AI Horde** — crowdsourced; anonymous key `0000000000`. Output rights follow the worker's model; be considerate of volunteer capacity.
- **Puter** — free account, user-paid allowance model. Subject to Puter's terms.
- **StreamElements** — public endpoint, no SLA. Best-effort fallback.
- **Community LLM gateways** (Kilo, LLMFaucet, G4F, OVHcloud) — no SLA; their terms govern.

## Brand

The ZTC name, the hexagon mark and "Powered by Zeynar The Creator" are part of the supplied identity. They are not a trademark registration and no exclusivity is claimed. If you rebrand, keep the MIT notice for the code.

## Third-party code

None at runtime. The app is dependency-free vanilla ES modules. Playwright is a **dev-only** dependency for the optional browser test.
