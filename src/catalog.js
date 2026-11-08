/* ZTC AI Studio — content catalog.
   Styles, narrative templates, brand presets, aspect ratios, motions, transitions, effects.
   All of this is data: adding a style or a template never requires touching the renderer. */

export const ASPECTS = {
  "16:9": { id: "16:9", label: "16:9 · landscape", w: 1920, h: 1080, hint: "YouTube, web, presentations" },
  "9:16": { id: "9:16", label: "9:16 · vertical", w: 1080, h: 1920, hint: "Shorts, Reels, TikTok" },
  "1:1": { id: "1:1", label: "1:1 · square", w: 1080, h: 1080, hint: "Feed posts, carousels" },
  "4:5": { id: "4:5", label: "4:5 · portrait", w: 1080, h: 1350, hint: "Instagram portrait" },
  "21:9": { id: "21:9", label: "21:9 · scope", w: 1920, h: 822, hint: "Cinematic letterbox" },
};

export const QUALITY = {
  draft: { id: "draft", label: "Draft", scale: 0.5, fps: 24, bitrate: 3_000_000, hint: "Fast preview render" },
  standard: { id: "standard", label: "Standard", scale: 0.75, fps: 30, bitrate: 6_000_000, hint: "Balanced quality" },
  high: { id: "high", label: "High", scale: 1, fps: 30, bitrate: 10_000_000, hint: "Full resolution" },
};

export const STYLES = [
  {
    id: "cinematic3d", name: "Cinematic 3D", blurb: "Octane-render look: soft key light, shallow depth, matte surfaces.",
    suffix: "cinematic 3D render, octane render, subsurface scattering, rim light, shallow depth of field, 35mm lens, ultra detailed, physically based materials",
    negative: "flat lighting, low resolution, text, watermark, deformed",
    palette: { bg1: "#0a0c13", bg2: "#1c2436", accent: "#ff5a6e", ink: "#f5f1f3" },
    effects: ["grain", "vignette", "bloom", "lightleak"], transition: "fade", music: "cinematic", caption: "bar",
    shots: ["wide establishing shot", "medium shot, slow dolly", "close-up on detail", "low angle hero shot", "overhead top-down"],
  },
  {
    id: "product", name: "Clean Product", blurb: "Studio sweep, crisp highlights, e-commerce ready.",
    suffix: "professional product photography, seamless studio backdrop, softbox lighting, crisp specular highlight, minimal composition, commercial advertising quality",
    negative: "clutter, harsh shadows, text artifacts, extra limbs",
    palette: { bg1: "#f5f3f0", bg2: "#ddd8d1", accent: "#d5183a", ink: "#17120f" },
    effects: ["vignette", "bloom"], transition: "slide", music: "uplifting", caption: "clean",
    shots: ["hero product shot centered", "three-quarter angle", "macro detail shot", "floating levitation shot", "lifestyle context shot"],
  },
  {
    id: "neon", name: "Neon Cyber", blurb: "Rain-slick streets, magenta and cyan rim light.",
    suffix: "cyberpunk neon lighting, magenta and cyan rim light, wet reflective surfaces, volumetric haze, anamorphic flare, ultra sharp, cinematic",
    negative: "daylight, washed out, low contrast, text",
    palette: { bg1: "#07060f", bg2: "#1b0b2b", accent: "#8be9ff", ink: "#f7f2ff" },
    effects: ["bloom", "chromatic", "scanlines", "particles"], transition: "glitch", music: "synthwave", caption: "neon",
    shots: ["wide neon street", "close-up reflective surface", "silhouette against glow", "low angle looking up", "tracking shot through haze"],
  },
  {
    id: "documentary", name: "Warm Documentary", blurb: "Available light, honest texture, film grain.",
    suffix: "documentary photography, available window light, natural skin tones, 50mm lens, subtle film grain, candid composition, photojournalistic",
    negative: "studio lighting, plastic skin, oversaturated, text",
    palette: { bg1: "#191310", bg2: "#2c211a", accent: "#e8b46a", ink: "#f6eee3" },
    effects: ["grain", "vignette", "lightleak"], transition: "dip", music: "ambient", caption: "clean",
    shots: ["candid wide shot", "over-shoulder medium shot", "hands detail", "environmental portrait", "slow pan across scene"],
  },
  {
    id: "paper", name: "Paper & Ink", blurb: "Editorial collage: cut paper, printed texture.",
    suffix: "papercut collage illustration, layered construction paper, printed halftone texture, bold flat shapes, editorial art direction",
    negative: "photorealistic, glossy 3D, text errors",
    palette: { bg1: "#f7f2e6", bg2: "#e5dac4", accent: "#b2321f", ink: "#241c14" },
    effects: ["grain", "halftone"], transition: "wipe", music: "minimal", caption: "clean",
    shots: ["flat lay composition", "layered cut-paper scene", "bold graphic close-up", "isometric paper diorama", "typographic poster"],
  },
  {
    id: "clay", name: "Clay Render", blurb: "Soft 3D claymation: rounded forms, warm light.",
    suffix: "3D clay render, claymation, soft rounded forms, matte clay material, warm studio light, isometric diorama, blender render, ambient occlusion",
    negative: "photoreal, sharp metal, text, harsh contrast",
    palette: { bg1: "#efe5db", bg2: "#d8c6b4", accent: "#e2653f", ink: "#2b211b" },
    effects: ["grain", "vignette"], transition: "fade", music: "lofi", caption: "bar",
    shots: ["isometric diorama wide", "close-up clay texture", "toy-scale perspective", "floating objects", "top-down arrangement"],
  },
  {
    id: "ink", name: "Anime Ink", blurb: "Line art, cel shading, dramatic key frames.",
    suffix: "anime key visual, clean line art, cel shading, dramatic rim light, detailed background, studio quality animation frame",
    negative: "3D render, photo, blurry lines, text",
    palette: { bg1: "#fbfbf8", bg2: "#e6e5df", accent: "#111318", ink: "#14161a" },
    effects: ["halftone", "vignette"], transition: "wipe", music: "uplifting", caption: "clean",
    shots: ["wide anime background", "character mid-shot", "dramatic close-up eyes", "action line frame", "quiet still frame"],
  },
  {
    id: "retro", name: "Retro VHS", blurb: "Tape wear, CRT bloom, 1987 title card energy.",
    suffix: "1980s analog video still, VHS tape artifacts, chromatic aberration, CRT bloom, grainy film, retro color grade, soft focus",
    negative: "digital sharpness, modern UI, text",
    palette: { bg1: "#150d1f", bg2: "#2b1030", accent: "#ff4fd8", ink: "#ffe9fb" },
    effects: ["scanlines", "chromatic", "grain", "vignette"], transition: "glitch", music: "synthwave", caption: "neon",
    shots: ["static wide shot", "slow push through smoke", "neon sign close-up", "silhouette in doorway", "pan across skyline"],
  },
  {
    id: "minimal", name: "Minimal Type", blurb: "Type-led motion graphics, one accent colour, lots of air.",
    suffix: "minimalist graphic design composition, generous negative space, single accent colour, geometric layout, swiss typography influence, flat lighting",
    negative: "busy texture, gradient mesh, photo realism",
    palette: { bg1: "#0e0f11", bg2: "#191b1f", accent: "#ff304f", ink: "#f2f2f2" },
    effects: ["grid", "vignette"], transition: "slide", music: "minimal", caption: "bar",
    shots: ["centered geometric composition", "type-led layout", "single object still life", "grid system detail", "negative space wide"],
  },
  {
    id: "scifi", name: "Epic Sci-Fi", blurb: "Vast scale, atmosphere, teal and amber light.",
    suffix: "epic science fiction concept art, colossal scale, volumetric atmosphere, teal and amber lighting, detailed greebles, cinematic matte painting",
    negative: "flat, cartoon, low detail, text",
    palette: { bg1: "#03070f", bg2: "#0b1a2b", accent: "#5ff0d0", ink: "#e8fbff" },
    effects: ["bloom", "particles", "lightleak", "vignette"], transition: "fade", music: "cinematic", caption: "bar",
    shots: ["vast establishing wide", "human-scale foreground", "orbital view", "close-up on technology", "silhouette against horizon"],
  },
];

export const MOODS = {
  cinematic: { label: "Cinematic", tempo: 76, key: 0, scale: "minor", pad: "saw", drums: "soft", hint: "Slow build, strings-like pad" },
  ambient: { label: "Ambient", tempo: 62, key: 2, scale: "dorian", pad: "sine", drums: "none", hint: "Drifting pads, no beat" },
  lofi: { label: "Lo-fi", tempo: 84, key: -2, scale: "dorian", pad: "triangle", drums: "lofi", hint: "Dusty keys, laid-back swing" },
  synthwave: { label: "Synthwave", tempo: 104, key: -3, scale: "minor", pad: "saw", drums: "four", hint: "Arpeggio, gated drums" },
  tension: { label: "Tension", tempo: 90, key: 1, scale: "phrygian", pad: "square", drums: "pulse", hint: "Pulsing low drone" },
  uplifting: { label: "Uplifting", tempo: 112, key: 3, scale: "major", pad: "triangle", drums: "four", hint: "Bright chords, forward motion" },
  minimal: { label: "Minimal", tempo: 96, key: 0, scale: "major", pad: "sine", drums: "click", hint: "Single motif, sparse" },
  none: { label: "No music", tempo: 0, key: 0, scale: "major", pad: "sine", drums: "none", hint: "Silent bed (voice only)" },
};

export const EFFECTS = [
  { id: "grain", label: "Film grain", cost: 1 },
  { id: "vignette", label: "Vignette", cost: 1 },
  { id: "bloom", label: "Bloom", cost: 2 },
  { id: "lightleak", label: "Light leak", cost: 1 },
  { id: "particles", label: "Particles", cost: 2 },
  { id: "chromatic", label: "Chromatic split", cost: 2 },
  { id: "glitch", label: "Glitch", cost: 2 },
  { id: "scanlines", label: "Scanlines", cost: 1 },
  { id: "halftone", label: "Halftone", cost: 2 },
  { id: "grid", label: "Technical grid", cost: 1 },
  { id: "letterbox", label: "Letterbox", cost: 1 },
  { id: "mesh3d", label: "3D mesh layer", cost: 2 },
];

export const MOTIONS = {
  "zoom-in": { label: "Slow push in" },
  "zoom-out": { label: "Pull back" },
  "pan-left": { label: "Pan left" },
  "pan-right": { label: "Pan right" },
  "tilt-up": { label: "Tilt up" },
  orbit: { label: "2.5D orbit" },
  parallax: { label: "Parallax drift" },
  static: { label: "Locked off" },
  dolly: { label: "Dolly + rack focus" },
};

export const TRANSITIONS = {
  fade: { label: "Crossfade", ms: 600 },
  slide: { label: "Slide", ms: 550 },
  wipe: { label: "Wipe", ms: 500 },
  dip: { label: "Dip to black", ms: 650 },
  glitch: { label: "Glitch cut", ms: 420 },
  none: { label: "Hard cut", ms: 0 },
};

export const BRAND_PRESETS = [
  {
    id: "redline", name: "Redline", color: "#ff304f", ink: "#ffffff",
    caption: "bar", font: "sans", watermark: "ZTC · REDLINE", intro: "title", outro: "cta",
  },
  {
    id: "editorial", name: "Editorial", color: "#d5183a", ink: "#17120f",
    caption: "clean", font: "sans", watermark: "", intro: "title", outro: "none",
  },
  {
    id: "neon", name: "Neon Lab", color: "#8be9ff", ink: "#f7f2ff",
    caption: "neon", font: "mono", watermark: "SIGNAL", intro: "glitch", outro: "cta",
  },
  {
    id: "minimal", name: "Minimal", color: "#ffffff", ink: "#111111",
    caption: "clean", font: "mono", watermark: "", intro: "none", outro: "none",
  },
  {
    id: "bold", name: "Bold Drop", color: "#f7b955", ink: "#140f08",
    caption: "bar", font: "sans", watermark: "ZTC", intro: "hook", outro: "cta",
  },
];

/* Narrative templates: each beat supplies a visual directive and narration lines.
   {topic} {kw} {audience} {brand} are replaced by the deterministic writer. */
export const TEMPLATES = [
  {
    id: "product", name: "Product launch", blurb: "Hook → problem → product → proof → CTA",
    style: "product", mood: "uplifting", tone: "confident",
    beats: [
      { label: "Hook", visual: "a single product hero object on a seamless backdrop, dramatic highlight", lines: ["You have probably seen {kw} done badly.", "Most {kw} looks the same. This does not.", "This is what {topic} should feel like."] },
      { label: "Problem", visual: "cluttered, unfinished alternative products, cool grey light", lines: ["The usual version is slow, loud and forgettable.", "Cheap materials. Loose details. No point of view.", "So people stop paying attention."] },
      { label: "Product", visual: "the product rotating slowly, precise studio lighting, macro details", lines: ["So we rebuilt it around one idea: {topic}.", "Every surface earns its place.", "Nothing extra. Nothing missing."] },
      { label: "Proof", visual: "hands using the product in a real environment, warm daylight", lines: ["It survives real use, not just a photoshoot.", "Details you feel before you notice them.", "Built to be used daily."] },
      { label: "Payoff", visual: "wide lifestyle shot, product in context, sun flare", lines: ["This is {topic} — quietly better.", "One object. Zero noise.", "The difference you keep noticing."] },
      { label: "CTA", visual: "clean end card with the product silhouette and space for a call to action", lines: ["Available now.", "Start with {brand}.", "Link below."] },
    ],
  },
  {
    id: "explainer", name: "Explainer", blurb: "Question → context → mechanism → example → takeaway",
    style: "minimal", mood: "minimal", tone: "clear",
    beats: [
      { label: "Question", visual: "a bold geometric composition posing a visual question", lines: ["What actually happens with {topic}?", "Here is the short version.", "Three steps. No jargon."] },
      { label: "Context", visual: "a wide abstract system diagram made of simple shapes", lines: ["Start with the basics.", "{topic} is a system, not a single trick.", "Once you see the parts, the whole thing makes sense."] },
      { label: "Mechanism", visual: "close-up of connected components, clean technical lighting", lines: ["First, the input arrives.", "Then the rule is applied.", "Then the result is checked."] },
      { label: "Example", visual: "a concrete scenario shown as a simple before-and-after layout", lines: ["Here is a real example.", "Same input, two different rules.", "The output changes completely."] },
      { label: "Takeaway", visual: "one bold statement in negative space", lines: ["That is the whole model.", "Change the rule, change the result.", "Keep the rule, keep the result."] },
      { label: "Close", visual: "quiet end frame with generous space", lines: ["That is {topic}, in under a minute.", "Save this for later."] },
    ],
  },
  {
    id: "brand", name: "Brand story", blurb: "Origin → belief → craft → people → invitation",
    style: "documentary", mood: "ambient", tone: "warm",
    beats: [
      { label: "Origin", visual: "a quiet workshop at dawn, dust in window light", lines: ["It started with one stubborn idea.", "That {topic} could be simpler.", "And better."] },
      { label: "Belief", visual: "hands working with material, close detail", lines: ["We believe the details are the product.", "Not the logo. Not the launch.", "The thing you touch every day."] },
      { label: "Craft", visual: "tools, sketches and material samples on a workbench", lines: ["So we make less, and finish it properly.", "Fewer pieces. Longer life.", "Repairable by design."] },
      { label: "People", visual: "environmental portrait of a maker, honest natural light", lines: ["The people who make it care who uses it.", "That is not marketing. It is the process.", "You can feel it in the finish."] },
      { label: "Invitation", visual: "wide landscape shot at golden hour", lines: ["This is {brand}.", "Made slowly, on purpose.", "Come see the difference."] },
    ],
  },
  {
    id: "travel", name: "Travel reel", blurb: "Arrival → texture → discovery → feeling → memory",
    style: "cinematic3d", mood: "cinematic", tone: "warm",
    beats: [
      { label: "Arrival", visual: "sweeping aerial arrival over the destination at golden hour", lines: ["The first thing you notice is the light.", "{topic} does not look like the photos.", "It looks better."] },
      { label: "Texture", visual: "close-up of local material, food or craft in warm light", lines: ["Then the details arrive.", "Warm stone. Wet pavement. Someone laughing nearby.", "Small things you cannot photograph properly."] },
      { label: "Discovery", visual: "a narrow street leading somewhere unexpected", lines: ["Walk without a plan for an hour.", "Turn where it looks less interesting.", "That is usually the good part."] },
      { label: "Feeling", visual: "a quiet moment of someone watching the view", lines: ["Somewhere in the middle, you stop checking your phone.", "That is the actual souvenir.", "A slower sense of time."] },
      { label: "Memory", visual: "wide horizon at dusk, silhouette, fading light", lines: ["You will forget the itinerary.", "You will remember how it felt.", "{topic} — go while it is still quiet."] },
    ],
  },
  {
    id: "tutorial", name: "Tutorial", blurb: "Goal → setup → steps → check → next",
    style: "minimal", mood: "lofi", tone: "clear",
    beats: [
      { label: "Goal", visual: "clean screen-space layout with one clear objective", lines: ["By the end of this, you will have {topic} working.", "No prior setup assumed.", "Follow along in order."] },
      { label: "Setup", visual: "a tidy workspace with the required tools laid out", lines: ["You need two things.", "The tool, and five minutes.", "That is it."] },
      { label: "Steps", visual: "step-by-step detail shots with clear focus", lines: ["Step one: open the file.", "Step two: change the setting that matters.", "Step three: run it once before you trust it."] },
      { label: "Check", visual: "a verification moment, green confirmation light", lines: ["Now verify, do not assume.", "Run the check.", "If it fails, the message tells you where."] },
      { label: "Next", visual: "a wide shot of the finished result", lines: ["That is the whole workflow.", "Change one variable at a time.", "Then it stays working."] },
    ],
  },
  {
    id: "social", name: "Social hook", blurb: "Pattern interrupt → tension → reveal → loop",
    style: "retro", mood: "synthwave", tone: "punchy",
    beats: [
      { label: "Interrupt", visual: "an unexpected visual jolt, high contrast, motion blur", lines: ["Stop scrolling.", "This takes eight seconds.", "Watch what happens."] },
      { label: "Tension", visual: "a tight close-up with rising visual tension", lines: ["Everyone does this the same way.", "That is the problem.", "Here is why."] },
      { label: "Reveal", visual: "a clean reveal shot, single subject, strong light", lines: ["Do it backwards.", "Start from the result.", "Then fill in only what is needed."] },
      { label: "Loop", visual: "a frame that visually rhymes with the opening shot", lines: ["That is it.", "Try it once.", "Then send this to someone who needs it."] },
    ],
  },
  {
    id: "documentary", name: "Mini documentary", blurb: "Scene → context → conflict → insight → close",
    style: "documentary", mood: "ambient", tone: "measured",
    beats: [
      { label: "Scene", visual: "wide environmental shot establishing a real place", lines: ["This is where {topic} happens.", "It does not look dramatic.", "That is the point."] },
      { label: "Context", visual: "archival-feeling detail, texture, documents", lines: ["For years, the assumption was simple.", "It was also wrong.", "The cost only showed up later."] },
      { label: "Conflict", visual: "two opposing forces in one frame, cool and warm light", lines: ["Two groups wanted different things.", "Both had a fair argument.", "Only one outcome was measured."] },
      { label: "Insight", visual: "a quiet portrait, direct eye contact", lines: ["The people closest to it saw it first.", "They were ignored, politely.", "Then the numbers agreed with them."] },
      { label: "Close", visual: "wide dusk shot, slow fade", lines: ["The lesson is not the headline.", "It is the thing nobody measured.", "That is still true."] },
    ],
  },
  {
    id: "teaser", name: "Teaser", blurb: "Cold open → fragments → name → date",
    style: "neon", mood: "tension", tone: "punchy",
    beats: [
      { label: "Cold open", visual: "near-black frame with one sliver of light", lines: ["Something is coming.", "You are not ready for the shape of it.", "Nobody is."] },
      { label: "Fragments", visual: "quick fragments of detail, motion blur, incomplete forms", lines: ["A signal. A door. A countdown.", "Three pieces.", "None of them fit yet."] },
      { label: "Name", visual: "bold title treatment emerging from darkness", lines: ["Then the name arrives.", "{topic}.", "Remember where you were."] },
      { label: "Date", visual: "minimal end card, single line of type", lines: ["Soon.", "Watch this space.", "You will know."] },
    ],
  },
];

export const CAPTION_POSITIONS = {
  bottom: { id: "bottom", label: "Lower third" },
  middle: { id: "middle", label: "Centre" },
  top: { id: "top", label: "Upper third" },
};

export const VOICES = [
  { id: "Joanna", label: "Joanna · warm female", lang: "en-US", gender: "f" },
  { id: "Matthew", label: "Matthew · calm male", lang: "en-US", gender: "m" },
  { id: "Amy", label: "Amy · bright female (UK)", lang: "en-GB", gender: "f" },
  { id: "Brian", label: "Brian · deep male (UK)", lang: "en-GB", gender: "m" },
  { id: "Emma", label: "Emma · soft female (UK)", lang: "en-GB", gender: "f" },
  { id: "Olivia", label: "Olivia · natural female (AU)", lang: "en-AU", gender: "f" },
  { id: "Aria", label: "Aria · narration female (NZ)", lang: "en-NZ", gender: "f" },
  { id: "Kajal", label: "Kajal · female (IN)", lang: "en-IN", gender: "f" },
  { id: "Zhiyu", label: "Zhiyu · female (CN)", lang: "cmn-CN", gender: "f" },
  { id: "Takumi", label: "Takumi · male (JP)", lang: "ja-JP", gender: "m" },
  { id: "Camila", label: "Camila · female (BR)", lang: "pt-BR", gender: "f" },
  { id: "Lupe", label: "Lupe · female (ES-US)", lang: "es-US", gender: "f" },
  { id: "Daniel", label: "Daniel · male (DE)", lang: "de-DE", gender: "m" },
  { id: "Léa", label: "Léa · female (FR)", lang: "fr-FR", gender: "f" },
];

export const TONES = ["confident", "warm", "clear", "punchy", "measured", "playful", "premium"];

export const CHAPTER_SIZE = 4;
