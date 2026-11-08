# Limitations (read this before promising anything)

This project is deliberately honest about what it does. Nothing is simulated, and where a capability has a ceiling the UI says so.

## Rendering

- **Animation is 2.5D, not generative motion.** Scenes are stills with camera moves (push, pull, pan, tilt, orbit, parallax, dolly), transitions, particles, light leaks, grain, chromatic split, scanlines, halftone, bloom and an optional real 3D mesh layer. There is no text-to-video model in the browser.
- **Export runs in real time.** `MediaRecorder` records the canvas and the live audio graph; a 5-minute film takes about 5 minutes. The tab must stay focused — background tabs throttle timers and can introduce dropped frames.
- **Container depends on the browser.** Chrome/Edge usually produce MP4; Firefox produces WebM. The app detects the container from the file header, not from the codec label. Convert with:
  ```bash
  ffmpeg -i video.webm -c:v libx264 -crf 20 -preset veryfast -c:a aac -b:a 160k video.mp4
  ```
- **Resolution is capped by the quality preset** (draft 50%, standard 75%, high 100% of the aspect's base size). 1080p at 30 fps is realistic on a modern laptop; 4K is not implemented.
- **Frame pacing is best-effort.** `canvas.captureStream(fps)` samples the canvas; on a slow machine the effective frame rate can drop below the target.

## AI providers

- **Free image tiers are slow and rate-limited.** Pollinations' keyless tier is roughly one image per 45 seconds at ≤768px with a logo; AI Horde is queue-based and may wait minutes. The procedural renderer is the always-available floor.
- **No uptime guarantee.** Community endpoints (Kilo, LLMFaucet, G4F, StreamElements) can disappear or change paths. Failover handles it; quality varies.
- **CORS can block a provider.** Use the bundled relay if needed.
- **Puter requires a free account.** Voice and Puter chat consume the user's own Puter allowance. No developer key is embedded.
- **Browser speech cannot be recorded.** It is offered as a preview only, and is clearly labelled.
- **LLM output is probabilistic.** JSON is validated and repaired, and a local planner exists as a fallback, but text quality varies by provider. Every provider actually used is recorded.

## Music and audio

- **The built-in composer is synthesis, not a neural model.** It produces coherent loop-based beds (chords, bass, arpeggio, drums) but it is not a generative music model.
- **Neural music is opt-in only.** MusicGen/AudioGen weights are non-commercial (CC-BY-NC); Stable Audio Open has its own terms. Nothing is bundled, and no paid API is used.
- **Loudness is mixed, not mastered.** A compressor and limiter-style gain structure are applied; broadcast loudness targets are not certified.
- **No voice cloning.** Cloning raises consent and licensing problems (XTTS-v2 weights are non-commercial). Not included.

## Editing and data

- **Projects live in this browser profile.** localStorage holds text/settings; IndexedDB holds media. Clearing site data deletes them. Export a bundle to keep a copy.
- **Storage quota** is typically a few hundred MB per origin; the footer shows usage. Large batches can hit the quota — the app warns instead of failing silently.
- **Share links carry the project, not the media.** Images and voice are regenerated on the recipient's device (or they can import a ZIP bundle).
- **Version history is capped at 20 snapshots per project** and stores text/settings/storyboard, not media copies.
- **No automatic publishing.** Nothing is uploaded to YouTube, TikTok or anywhere else. The app produces files plus a metadata-ready report.

## Scope not implemented

- Text-to-3D model generation (TripoSR/TRELLIS), generative motion (AnimateDiff/SVD), frame interpolation (RIFE), voice cloning, multi-language UI, collaborative editing, cloud sync, publishing integrations, and faster-than-realtime encoding. Each has a documented integration path in [EXTENDING.md](EXTENDING.md).
- Long-form (>5 min) is bounded by the duration control (1–5 min) and by real-time capture. Longer timelines work technically but take proportionally longer to record.

## Accessibility

Captions are on by default and can be burned in or exported. Keyboard navigation, focus trapping, ARIA live regions and reduced-motion support are implemented. A formal WCAG audit has **not** been performed; colour contrast in the light theme and caption contrast over bright footage should be checked for your specific content.
