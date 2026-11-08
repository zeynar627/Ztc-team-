# Changelog

## 3.1.0 — production pass

### Reliability fixes

- **Dangling media detection.** A stored `imageId`/`voiceId` is now verified in IndexedDB before it is trusted. If a blob was evicted (quota pressure, “clear site data”, Safari ITP), the scene is marked idle and regenerated instead of exporting a blank frame.
- **Quota failures are visible.** `localStorage` write failures now surface a toast and a status badge with a recovery path, instead of failing silently.
- **Edits survive a closed tab.** Pending debounced saves are flushed on `beforeunload`.
- **Contact sheets use the requested project.** `contactSheet()` now calls `renderer.setProject(project)` and awaits image decoding, so exporting a project other than the active one produces the right frames.
- **Safari audio.** `MediaRecorder` capture resumes the audio context before scheduling the mix, and tolerates a missing audio engine.
- **Stage restored after render.** The preview returns to frame 0 when recording stops instead of freezing on the tail frame.
- **Native `confirm()` removed** from the destructive “clear media” action; it now uses the themed, focus-trapped dialog.

### UX improvements

- **Repair** and **copy provider log** buttons in the Production panel; repair only fills what is genuinely missing.
- **Command palette:** “Repair missing media”.
- **Reduced motion** now applies to canvas camera moves, not just CSS.
- Empty/error states, progress and provider reporting unchanged but now also cover evicted media.

### Production readiness

- Web app manifest, maskable SVG icon, `theme-color`, Open Graph/Twitter metadata.
- Branded `404.html`, `robots.txt`, `.nojekyll`.
- GitHub Actions: `ci.yml` (logic tests + repository checks) and `pages.yml` (deploy to GitHub Pages).
- Repository self-check extended to the new files.
- Version bumped to 3.1.0 across the report, user agent and UI.

### Verified

- 19 logic tests pass.
- 22 browser checks pass, zero console errors, with all external requests blocked (forces every fallback), including a real 6-second MP4, WAV mixdown and subtitles.
- Live provider checks: JSON planning via OVHcloud, 5-scene plan summing exactly 45 s, Pollinations JPEG that draws to canvas untainted.

## 3.0.0 — rewrite

- Replaced the single-file chat workbench with a modular ES-module studio.
- Real render pipeline: canvas + camera moves + transitions + effects + captions → MediaRecorder with the live audio mix.
- Staged, resumable production pipeline with provider failover and content-addressed asset cache.
- Storyboard, timeline, asset library, versions, export bundle, share links.
- Built-in music composer, procedural art floor, offline deterministic planner.
