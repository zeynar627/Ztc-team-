import test from "node:test";
import assert from "node:assert/strict";

import { makeZip, crc32, encodeShare, decodeShare, parseJsonLoose, fmtTime, clamp, hashString, seeded } from "../src/util.js";
import { draftPlan, validatePlan, mergePlan, distribute, chaptersOf, topicOf, keywordsOf, sceneTimings, sceneAt, rebalance, buildScript } from "../src/generate.js";
import { buildCues, wrapLines, totalSeconds, timingsOf } from "../src/render.js";
import { toSRT, toVTT } from "../src/export.js";
import { TEMPLATES, STYLES } from "../src/catalog.js";

const brief = {
  text: "A 60 second launch film for a matte black ceramic coffee mug with a magnetic lid, for design-conscious commuters.",
  template: "product", tone: "confident", audience: "commuters", duration: 60, styleId: "cinematic3d",
};

const projectFrom = (plan, overrides = {}) => ({
  id: "p1", name: "Test",
  brief,
  settings: {
    aspect: "16:9", quality: "draft", duration: 60, fps: 30, styleId: "cinematic3d",
    captions: { enabled: true, position: "bottom", style: "bar", maxChars: 64 },
    branding: { name: "Test", color: "#ff304f", watermark: true, intro: true, outro: true },
    effects: ["grain"], musicMood: "cinematic", ...overrides,
  },
  plan,
});

test("distribute() sums to the requested total whenever it is feasible", () => {
  for (const total of [30, 60, 90, 120, 300]) {
    for (const n of [4, 5, 7, 12, 24]) {
      const parts = distribute(total, n, Array.from({ length: n }, (_, i) => (i === 0 ? 0.85 : 1)));
      assert.equal(parts.length, n);
      const sum = parts.reduce((a, b) => a + b, 0);
      assert.ok(parts.every((p) => p >= 2), "no scene shorter than 2s");
      if (total >= n * 2) assert.ok(Math.abs(sum - total) < 0.001, `${total}s across ${n} scenes gave ${sum}`);
    }
  }
});

test("distribute() honours the 2s floor instead of producing impossible scenes", () => {
  const parts = distribute(30, 24);
  assert.equal(parts.length, 24);
  assert.ok(parts.every((p) => p === 2));
});

const sumScenes = (plan) => plan.scenes.reduce((n, s) => n + s.duration, 0);

test("draftPlan() is deterministic for the same brief", () => {
  const a = draftPlan(brief);
  const b = draftPlan({ ...brief });
  assert.equal(a.scenes.length, b.scenes.length);
  assert.deepEqual(a.scenes.map((s) => s.narration), b.scenes.map((s) => s.narration));
  assert.deepEqual(a.scenes.map((s) => s.duration), b.scenes.map((s) => s.duration));
});

test("draftPlan() hits the target duration and produces usable scenes", () => {
  for (const duration of [60, 120, 180, 300]) {
    const plan = draftPlan({ ...brief, duration });
    const total = sumScenes(plan);
    assert.ok(Math.abs(total - duration) <= 0.5, `${duration}s target produced ${total}s`);
    assert.ok(plan.scenes.length >= 4 && plan.scenes.length <= 24);
    for (const s of plan.scenes) {
      assert.ok(s.narration.trim().length > 10, "scene has narration");
      assert.ok(s.visual.length > 20, "scene has a visual prompt");
      assert.ok(s.duration >= 2 && s.duration <= 30, "duration within bounds");
      assert.ok(s.id.startsWith("sc_"));
    }
    assert.ok(plan.chapters.length >= 1);
    assert.ok(plan.script.includes("# "));
  }
});

test("chapters cover every scene exactly once", () => {
  const plan = draftPlan(brief);
  const covered = plan.chapters.flatMap((c) => Array.from({ length: c.to - c.from + 1 }, (_, i) => c.from + i));
  assert.deepEqual(covered, plan.scenes.map((_, i) => i));
});

test("validatePlan() repairs out-of-range values", () => {
  const bad = {
    title: "Bad", logline: "", script: "",
    scenes: [
      { title: "a", narration: "hello", visual: "", duration: 99 },
      { title: "b", narration: "", visual: "shot", duration: -4 },
    ],
  };
  const { plan, issues } = validatePlan(bad, { duration: 60 });
  assert.equal(plan.scenes.length, 2);
  assert.ok(plan.scenes[0].duration <= 30);
  assert.ok(plan.scenes[1].duration >= 2);
  assert.ok(plan.scenes[0].visual.length > 0, "empty visual was filled");
  assert.ok(issues.length >= 2);
});

test("mergePlan() keeps finished assets when nothing changed, resets when it did", () => {
  const oldPlan = draftPlan(brief);
  oldPlan.scenes[0].imageId = "img_a";
  oldPlan.scenes[0].status = { image: "done" };
  oldPlan.scenes[1].imageId = "img_b";
  oldPlan.scenes[1].status = { image: "done" };

  const same = mergePlan(oldPlan, JSON.parse(JSON.stringify(oldPlan)));
  assert.equal(same.scenes[0].imageId, "img_a");
  assert.equal(same.scenes[1].imageId, "img_b");

  const changed = JSON.parse(JSON.stringify(oldPlan));
  changed.scenes[0].visual = "a completely different shot";
  const merged = mergePlan(oldPlan, changed);
  assert.equal(merged.scenes[0].imageId, null, "changed scene drops its stale image");
  assert.equal(merged.scenes[1].imageId, "img_b", "untouched scene keeps its image");
});

test("caption cues are ordered, inside the timeline and respect the character limit", () => {
  const plan = draftPlan(brief);
  const project = projectFrom(plan);
  const cues = buildCues(project);
  assert.ok(cues.length >= plan.scenes.length);
  let prevEnd = 0;
  for (const cue of cues) {
    assert.ok(cue.start >= prevEnd - 0.02, "cues do not overlap");
    assert.ok(cue.end > cue.start);
    assert.ok(cue.text.length <= 70, `cue too long: ${cue.text.length}`);
    prevEnd = cue.end;
  }
  assert.ok(prevEnd <= totalSeconds(project) + 0.1);
});

test("captions can be disabled", () => {
  const plan = draftPlan(brief);
  const project = projectFrom(plan, { captions: { enabled: false, maxChars: 64 } });
  assert.equal(buildCues(project).length, 0);
});

test("SRT and VTT are well formed", () => {
  const project = projectFrom(draftPlan(brief));
  const srt = toSRT(project);
  assert.match(srt, /^1\n\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}\n.+/);
  const vtt = toVTT(project);
  assert.ok(vtt.startsWith("WEBVTT"));
  assert.match(vtt, /\d{2}:\d{2}:\d{2}\.\d{3} --> /);
});

test("timeline helpers map time to scenes", () => {
  const scenes = [{ duration: 5 }, { duration: 5 }, { duration: 10 }];
  const timings = sceneTimings(scenes);
  assert.deepEqual(timings.map((t) => t.start), [0, 5, 10]);
  assert.equal(sceneAt(scenes, 0).index, 0);
  assert.equal(sceneAt(scenes, 4.99).index, 0);
  assert.equal(sceneAt(scenes, 5).index, 1);
  assert.equal(sceneAt(scenes, 19.9).index, 2);
});

test("rebalance() never cuts a generated voice-over short", () => {
  const scenes = [
    { narration: "a", duration: 4, voiceDur: 9 },
    { narration: "b", duration: 4, voiceDur: 0 },
    { narration: "c", duration: 4, voiceDur: 6 },
  ];
  rebalance(scenes, 60);
  assert.ok(scenes[0].duration >= 9.6);
  assert.ok(scenes[2].duration >= 6.6);
  const total = scenes.reduce((n, s) => n + s.duration, 0);
  assert.ok(Math.abs(total - 60) < 1, `rebalanced to ${total}`);
});

test("topic and keyword extraction beat the whole prompt", () => {
  assert.match(topicOf("Make a video about sourdough bread for beginners"), /sourdough bread/i);
  const kws = keywordsOf("sourdough bread baking starter bread", 3);
  assert.ok(kws.includes("bread") || kws.includes("sourdough"));
  assert.ok(!kws.includes("the"));
});

test("zip builder writes a valid archive with CRC32", () => {
  const entries = [
    { name: "a.txt", data: "hello" },
    { name: "nested/b.bin", data: new Uint8Array([1, 2, 3, 4]) },
  ];
  const bytes = makeZip(entries);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(dv.getUint32(0, true), 0x04034b50, "local header signature");
  assert.equal(dv.getUint32(bytes.length - 22, true), 0x06054b50, "EOCD signature");
  assert.equal(dv.getUint16(bytes.length - 22 + 10, true), 2, "two entries");
  assert.equal(crc32(new TextEncoder().encode("hello")), 0x3610a686);
});

test("share links round-trip", async () => {
  const payload = { v: 1, name: "Test", plan: { scenes: [{ title: "One" }] } };
  const code = await encodeShare(payload);
  assert.ok(code.length > 4);
  const back = await decodeShare(code);
  assert.deepEqual(back, payload);
});

test("loose JSON parsing survives fences and prose", () => {
  assert.deepEqual(parseJsonLoose('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('here { "b": [1,2] } done'), { b: [1, 2] });
  assert.equal(parseJsonLoose("no json here"), null);
});

test("catalog integrity: styles and templates are complete", () => {
  for (const s of STYLES) {
    assert.ok(s.id && s.name && s.suffix && s.palette?.bg1, `style ${s.id} incomplete`);
    assert.ok(Array.isArray(s.effects));
  }
  for (const t of TEMPLATES) {
    assert.ok(t.beats.length >= 4, `template ${t.id} needs beats`);
    assert.ok(STYLES.some((s) => s.id === t.style), `template ${t.id} points at a real style`);
  }
});

test("helpers behave", () => {
  assert.equal(fmtTime(65), "1:05");
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(typeof hashString("x"), "number");
  const r = seeded("seed");
  assert.equal(r(), seeded("seed")());
});

test("script export contains every scene", () => {
  const plan = draftPlan(brief);
  const script = buildScript(plan);
  assert.ok(script.includes(plan.scenes[0].narration));
  assert.ok(script.includes(plan.scenes[plan.scenes.length - 1].narration));
});
