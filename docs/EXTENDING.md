# Extending ZTC AI Studio

The code is deliberately data-driven: styles, templates, transitions and providers are registries, not forks. This guide covers the extensions people actually ask for, with the real constraints.

---

## 1. Add a style

`src/catalog.js` → `STYLES`:

```js
{
  id: "blueprint",
  name: "Blueprint",
  blurb: "Technical drawing on cyanotype paper.",
  suffix: "cyanotype blueprint, white line work, technical annotation, grid paper, high contrast",
  negative: "photo, colour, soft focus, text artifacts",
  palette: { bg1: "#06182b", bg2: "#0d2c4a", accent: "#bfe9ff", ink: "#eaf7ff" },
  effects: ["grid", "grain", "vignette"],
  transition: "wipe",
  music: "minimal",
  caption: "clean",
  shots: ["flat technical elevation", "exploded view", "detail callout", "isometric assembly", "full schematic"],
}
```

It appears in the Studio picker immediately. `palette` also drives the procedural renderer, so the style still looks intentional with no AI provider.

## 2. Add a narrative template

`TEMPLATES` entries are beats with narration lines. Placeholders: `{topic}`, `{kw}`, `{audience}`, `{brand}`.

```js
{
  id: "case-study", name: "Case study", blurb: "Situation → complication → result",
  style: "documentary", mood: "ambient", tone: "measured",
  beats: [
    { label: "Situation", visual: "wide shot of the client's environment", lines: ["{brand} started with a simple problem.", "The numbers were not the issue."] },
    // … at least 4 beats
  ],
}
```

The planner maps beats to scenes, expands or trims them to hit the target duration, and distributes time with a 2-second floor.

## 3. Add an effect, transition or camera move

1. Register it: `EFFECTS`, `TRANSITIONS` or `MOTIONS` in `src/catalog.js`.
2. Implement it:
   - effect → `Renderer._postEffects()` in `src/render.js`
   - transition → `Renderer._composite()` switch
   - motion → `Renderer._drawScene()` switch (compute zoom/pan from scene progress `p`)

Keep effects cheap: they run on every frame. Prefer one `drawImage` over per-pixel loops. Bloom already draws the canvas onto itself with a blur filter; a new effect should have a similar cost profile.

## 4. Add a provider

See [PROVIDERS.md](PROVIDERS.md). The short version: an OpenAI-compatible text endpoint needs only a registry entry; a new protocol needs one branch in `callProvider()` (text), `generateImage()` or `generateVoice()` (media).

---

## 5. Real generative motion (RIFE / AnimateDiff / SVD)

Current motion is 2.5D. To add true motion you need a local GPU service; there is no free browser model.

**Recommended path**

1. Run a local service (ComfyUI, or a small FastAPI wrapper) exposing:
   ```http
   POST /animate  { "image": "<base64>", "prompt": "…", "seconds": 3, "fps": 24 }
   → 200 video/mp4
   ```
2. Add a `motionEndpoint` setting and a `generateClip()` function in `src/media.js` that posts the scene image and stores the result as a `clip` asset.
3. Store `scene.clipId` and teach `Renderer._drawScene()` to draw a `<video>` element instead of an `<img>` (create one per clip, `preload="auto"`, seek by `currentTime` before drawing).
4. Fall back to the still when the service is unavailable — the current renderer already handles that.

**Hardware:** 8 GB VRAM for AnimateDiff at 512–768px and short clips; 12–24 GB for SVD; RIFE interpolation is light (MIT) and works on modest GPUs.

**Licensing:** RIFE MIT. AnimateDiff code is Apache-2.0 but motion modules vary. Stable Video Diffusion uses Stability's community licence — verify the commercial scope. Never ship weights.

**Expectation setting:** generative clips are slow (seconds to minutes per scene) and can flicker between scenes. Keep the deterministic path as the default.

## 6. Text-to-3D (TripoSR, TRELLIS)

TripoSR and TRELLIS are MIT-licensed image→3D models that run locally with a GPU.

1. Host either behind `POST /to3d { image } → model/gltf-binary`.
2. Save the GLB as an asset (`kind: "model"`).
3. Render it with three.js in an offscreen canvas, or bake a turntable to frames at build time.
4. Either composite the WebGL canvas into the scene, or pre-render a transparent PNG sequence and feed it to the existing image pipeline.

The app already contains a genuine 3D renderer (`Renderer._mesh3d`, an icosahedron with per-face lighting and depth sorting). It is real 3D math, not AI — useful for logo stings and abstract intros without any dependency.

## 7. Local, commercial-safe voice (Piper / Kokoro)

Both run on CPU and are licence-clean. Minimal Piper server:

```python
# pip install fastapi uvicorn piper-tts
import subprocess, tempfile, pathlib
from fastapi import FastAPI, Response
from pydantic import BaseModel

app = FastAPI()
VOICES = {"Joanna": "/models/en_US-amy-medium.onnx"}   # map app voices to your models

class Req(BaseModel):
    text: str
    voice: str = "Joanna"

@app.post("/v1/audio/speech")
def speech(req: Req):
    model = VOICES.get(req.voice, next(iter(VOICES.values())))
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        out = pathlib.Path(f.name)
    subprocess.run(["piper", "--model", model, "--output_file", str(out)],
                   input=req.text.encode(), check=True)
    data = out.read_bytes(); out.unlink()
    return Response(data, media_type="audio/wav")
```

```bash
uvicorn app:app --port 8880
```

Then Settings → Voice & music → “Voice-over endpoint” = `http://localhost:8880/v1/audio/speech`. Kokoro-FastAPI exposes a compatible `/v1/audio/speech` route, so the same setting works.

The app measures each clip with Web Audio and rebalances scene durations so voice-over is never cut off.

## 8. Local music model

Point **Music endpoint** at a service with this contract:

```http
POST /generate { "prompt": "cinematic instrumental, loopable", "duration": 24 }
→ 200 audio/wav
```

- **MusicGen** weights are CC-BY-NC — non-commercial only.
- **Stable Audio Open** has its own commercial terms; verify.
- The built-in composer stays the default because it is original, instant and licence-clean.

## 9. Faster-than-realtime export (WebCodecs)

`MediaRecorder` is real time. For long videos, encode with `VideoEncoder` and mux yourself:

1. Draw each frame to an `OffscreenCanvas`, `new VideoFrame(canvas, { timestamp })`, `encoder.encode(frame)`.
2. Encode audio with `AudioEncoder` (AAC/Opus).
3. Mux into MP4 with `mp4-muxer` or WebM with `webm-muxer` (small, MIT/ISC).

This removes the 1× time constraint and gives frame-accurate pacing, at the cost of a muxing dependency and more code. `Renderer.drawAt(t)` is already deterministic and stateless per frame, so it can be driven at any speed.

## 10. Exact caption timing (Whisper)

Caption cues are currently distributed proportionally to character count inside each scene, which is stable but not word-accurate. For exact timings:

1. Send each voice clip to a local Whisper (MIT) or `whisper.cpp` service with word timestamps.
2. Map word timestamps to absolute scene time.
3. Replace `buildCues()` output with the aligned cues; keep the character-limit splitting for line breaks.

The export pipeline is unchanged — SRT/VTT and burned-in captions both read `buildCues()`.

## 11. Publishing

Not included, by design. If you add it:

- YouTube Data API v3 requires OAuth per user and has a daily upload quota. Never ship a client secret in a static app — use a backend you control.
- TikTok and Instagram have their own review processes and content policies.
- Keep the report (`report.json`) as the record of what was generated and by which provider.

## 12. Localisation and fonts

- `brief.language` is passed to the LLM planner; the local writer is English-only. Add per-language template variants to `TEMPLATES` if you need offline localisation.
- Canvas text uses the system font stack. For CJK/RTL, load a webfont and set it in `Renderer._captions()`; verify line breaking with `measureText` for the scripts you support.
- Puter TTS supports many languages; map voices in `VOICES` (`src/catalog.js`).

## 13. Tests and CI

```bash
npm test                      # 19 logic tests, no network
node tests/browser.test.mjs   # full UI + real 6s MP4 render (needs Playwright)
```

The browser test blocks all external requests, which forces every AI step onto its fallback — the harshest realistic check. Add a golden-frame test by rendering `drawAt(t)` to an `OffscreenCanvas` and hashing the pixels if you change the renderer.

## 14. Performance

- Lower **quality** to draft for iteration; recording time does not change but encode cost drops.
- Images and voice are cached by content hash — re-running a project is nearly free.
- Avoid adding per-pixel effects; the grain pass is already the most expensive one.
- Storyboard thumbnails are lazy-loaded; timelines redraw only on change.
- Batch variants are planned locally to avoid hammering free LLM quotas.
