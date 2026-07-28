import type { DrawScript } from "@/components/sketch/LiveSketch";

/**
 * A real ~5-minute photosynthesis lecture, second pass. Improvements over the first cut:
 *  - One running analogy (the leaf as a kitchen) threaded through hook -> ingredients ->
 *    chloroplast -> mechanism -> outputs, instead of a metaphor stated once and dropped.
 *  - Varied pacing: the three ingredients are now ONE fast, punchy beat (rapid delivery,
 *    not three identically-paced beats back to back); the mechanism beat is slower and
 *    lingers, because it's the hardest idea; the chloroplast beat reads more casually.
 *  - The mechanism beat's drawing is an actual ANIMATION (morph ops: water physically
 *    splits and its pieces travel to recombine with CO2 into glucose), not a static reveal.
 *  - Checkpoints are real: the player now requires a correct answer (with retries) before
 *    advancing, rather than showing a hint and continuing regardless.
 */

export type SlideKind = "intro" | "definition" | "checkpoint" | "compare" | "recap";

export interface CheckpointSpec {
  prompt: string;
  /** Loose keyword sets — any one full set matching the student's typed answer counts as correct. */
  acceptableKeywords: string[][];
  correctFeedback: string;
  hintFeedback: string;
  /** Shown verbatim if the student gives up after repeated attempts. */
  revealAnswer: string;
}

export interface Beat {
  id: string;
  title: string;
  teacherMove: string;
  stepLabel: string;
  slideKind: SlideKind;
  points: string[];
  definitionTerm?: string;
  definitionMeaning?: string;
  compareLeft?: { label: string; points: string[] };
  compareRight?: { label: string; points: string[] };
  checkpoint?: CheckpointSpec;
  script: string;
  /** Source-document provenance. PDF lessons use this to guarantee ordered block coverage and
   *  attach each extracted figure to the exact beat that teaches its page content. */
  sourceBlockIds?: string[];
  draw?: DrawScript;
  /** Full-bleed real photo behind the slide (scene-setting beats only — hook/recap). Path under /public. */
  photoBackdrop?: string;
}

const GREEN = "#15803d";
const SUN = "#d97706";
const BLUE = "#2563eb";
const SLATE = "#1e293b";
const SUGAR = "#b45309";
const RED = "#be123c";

export const beats: Beat[] = [
  {
    id: "hook",
    title: "Why a leaf doesn't need to eat",
    teacherMove: "I open with the puzzle, and set up the kitchen frame.",
    stepLabel: "1 · Hook",
    slideKind: "intro",
    photoBackdrop: "/lecture-assets/photosynthesis-leaf-lab.png",
    points: ["A plant never hunts, never eats", "So where does its energy come from?"],
    script:
      "Here is a puzzle. You eat meals because your body needs fuel from outside. A tree does not eat that way; it stays rooted in one place. So where does a plant get the energy to grow, make leaves, and make fruit? Here is the idea to carry with you: a leaf is a tiny kitchen. It makes its own food, using sunlight as the stove. That process is called photosynthesis.",
    draw: {
      caption: "A plant never eats. So how does it live?",
      durationMs: 9000,
      ops: [
        { kind: "shape", shape: "leaf", x: 50, y: 50, w: 34, h: 44, color: GREEN, at: 0.05 },
        { kind: "label", text: "?", x: 50, y: 52, size: "lg", color: SLATE, at: 0.45 },
        { kind: "note", text: "the leaf is a kitchen", x: 50, y: 88, at: 0.65 },
      ],
    },
  },
  {
    id: "define-photosynthesis",
    title: "The word itself",
    teacherMove: "I define the term before using it.",
    stepLabel: "2 · Vocabulary",
    slideKind: "definition",
    points: [],
    definitionTerm: "Photosynthesis",
    definitionMeaning: "\"Photo\" = light. \"Synthesis\" = putting together. Literally: using light to build something.",
    script:
      "Let's break the word apart, because the word actually tells you the answer. Photosynthesis. Photo means light — like a photograph is a light-picture. Synthesis means putting things together, building something. So photosynthesis, literally, means using light to build something. That's the whole kitchen, in one word: light powers the cooking.",
    draw: {
      caption: "Photo + synthesis",
      durationMs: 7000,
      ops: [
        { kind: "label", text: "PHOTO", x: 30, y: 45, size: "lg", color: SUN, at: 0.06 },
        { kind: "note", text: "= light", x: 30, y: 62, at: 0.22 },
        { kind: "label", text: "+", x: 50, y: 45, size: "lg", color: SLATE, at: 0.4 },
        { kind: "label", text: "SYNTHESIS", x: 74, y: 45, size: "lg", color: GREEN, at: 0.55 },
        { kind: "note", text: "= building", x: 74, y: 62, at: 0.72 },
        { kind: "note", text: "light-powered cooking", x: 50, y: 85, at: 0.88 },
      ],
    },
  },
  {
    id: "ingredients-fast",
    title: "Three ingredients, fast",
    teacherMove: "Quick delivery, then a slower mechanism beat.",
    stepLabel: "3 · The delivery truck",
    slideKind: "intro",
    points: ["Sunlight — the stove", "Water — from the roots", "CO₂ — from the air"],
    script:
      "Let's do a quick delivery of the three ingredients. Sunlight is the stove, the energy source. Water comes up from the roots, through the stem. Carbon dioxide drifts in from the air through tiny pores. Sunlight, water, and CO2: that is everything the leaf kitchen needs before it starts cooking.",
    draw: {
      caption: "Sun, water, CO₂ — delivered",
      durationMs: 6500,
      ops: [
        { kind: "shape", shape: "sun", x: 18, y: 20, w: 18, h: 18, color: SUN, at: 0.04 },
        { kind: "label", text: "sun", x: 18, y: 21, size: "sm", color: SUN, at: 0.12 },
        { kind: "shape", shape: "droplet", x: 18, y: 52, w: 14, h: 18, color: BLUE, at: 0.2 },
        { kind: "label", text: "H₂O", x: 18, y: 53, size: "sm", color: BLUE, at: 0.28 },
        { kind: "label", text: "CO₂", x: 18, y: 80, size: "md", color: SLATE, at: 0.36 },
        { kind: "shape", shape: "stove", x: 64, y: 54, w: 30, h: 30, color: GREEN, at: 0.5 },
        { kind: "label", text: "kitchen", x: 64, y: 74, size: "sm", color: GREEN, at: 0.66 },
        { kind: "arrow", x1: 28, y1: 26, x2: 50, y2: 44, color: SUN, at: 0.74 },
        { kind: "arrow", x1: 30, y1: 52, x2: 50, y2: 52, color: BLUE, at: 0.82 },
        { kind: "arrow", x1: 30, y1: 78, x2: 50, y2: 60, color: SLATE, at: 0.9 },
      ],
    },
  },
  {
    id: "checkpoint-1",
    title: "Quick check",
    teacherMove: "I pause and check before going further.",
    stepLabel: "Checkpoint 1",
    slideKind: "checkpoint",
    points: [],
    script:
      "Let's pause right here before moving on. No pressure: can you name the three ingredients a leaf needs? Take a second and answer in your own words.",
    checkpoint: {
      prompt: "What are the three ingredients a leaf needs for photosynthesis?",
      acceptableKeywords: [
        ["sun", "water", "carbon"],
        ["light", "water", "co2"],
        ["sunlight", "water", "co2"],
        ["light", "water", "carbon dioxide"],
      ],
      correctFeedback: "Exactly right — sunlight, water, and carbon dioxide. That's the full delivery.",
      hintFeedback: "Close — think back: one comes from the sky, one from the roots, one from the air.",
      revealAnswer: "The three ingredients are sunlight, water, and carbon dioxide.",
    },
  },
  {
    id: "chloroplast",
    title: "Where the cooking happens",
    teacherMove: "I keep this conversational before the slower mechanism beat.",
    stepLabel: "4 · Meet the kitchen",
    slideKind: "definition",
    points: [],
    definitionTerm: "Chloroplast",
    definitionMeaning: "The tiny kitchen inside a leaf cell — this is literally where the cooking happens.",
    script:
      "Okay, so where is the little kitchen in all this? It is inside leaf cells, in tiny structures called chloroplasts. A chloroplast is where the leaf captures light and starts building sugar. There is a useful clue in the name, too: chloro connects to chlorophyll, the green pigment in leaves. That green color is part of the kitchen equipment.",
    draw: {
      caption: "Inside the leaf: the chloroplast",
      durationMs: 8000,
      ops: [
        { kind: "shape", shape: "leaf", x: 50, y: 48, w: 46, h: 60, color: GREEN, at: 0.04 },
        { kind: "label", text: "leaf cell", x: 50, y: 18, size: "sm", color: GREEN, at: 0.2 },
        { kind: "shape", shape: "stove", x: 50, y: 52, w: 20, h: 18, color: SUN, at: 0.4 },
        { kind: "label", text: "chloroplast", x: 50, y: 72, size: "sm", color: SUN, at: 0.58 },
        { kind: "note", text: "= the kitchen", x: 50, y: 90, at: 0.76 },
      ],
    },
  },
  {
    id: "mechanism",
    title: "Watch the cooking happen",
    teacherMove: "I slow down and guide the hardest idea step by step.",
    stepLabel: "5 · The cooking, in slow motion",
    slideKind: "intro",
    points: ["Light energy splits water apart", "The pieces travel and combine with CO₂", "Result: a sugar molecule, glucose"],
    script:
      "Now let's slow down, because this is the key step. Notice the water molecule. Captured light energy helps split it into smaller pieces. Those pieces do not disappear; they move and combine with the carbon dioxide that arrived earlier. Nothing gets destroyed here; the atoms are rearranged. When the pieces come together, the leaf builds a sugar called glucose. That is the heart of the leaf kitchen: atoms changing partners to store energy.",
    draw: {
      caption: "Water splits, travels, becomes sugar",
      durationMs: 13000,
      ops: [
        { kind: "shape", shape: "droplet", x: 18, y: 28, w: 14, h: 18, color: BLUE, at: 0.03 },
        { kind: "label", text: "H₂O", x: 18, y: 30, size: "sm", color: BLUE, at: 0.1 },
        { kind: "shape", shape: "circle", x: 18, y: 68, w: 16, h: 14, color: SLATE, at: 0.18 },
        { kind: "label", text: "CO₂", x: 18, y: 69, size: "sm", color: SLATE, at: 0.25 },
        { kind: "shape", shape: "sun", x: 50, y: 16, w: 16, h: 16, color: SUN, at: 0.32 },
        { kind: "label", text: "light", x: 50, y: 17, size: "sm", color: SUN, at: 0.4 },
        {
          kind: "morph",
          shape: "droplet",
          x: 18,
          y: 28,
          toX: 50,
          toY: 48,
          w: 14,
          h: 18,
          text: "H₂O",
          toText: "H+H",
          color: BLUE,
          toColor: BLUE,
          at: 0.48,
          morphAt: 0.66,
        },
        {
          kind: "morph",
          shape: "circle",
          x: 18,
          y: 68,
          toX: 50,
          toY: 48,
          w: 16,
          h: 14,
          text: "CO₂",
          toText: "CO₂",
          color: SLATE,
          toColor: SLATE,
          at: 0.55,
          morphAt: 0.7,
        },
        {
          kind: "morph",
          shape: "circle",
          x: 50,
          y: 48,
          toX: 84,
          toY: 48,
          w: 22,
          h: 18,
          text: "···",
          toText: "glucose",
          color: SLATE,
          toColor: SUGAR,
          at: 0.72,
          morphAt: 0.92,
        },
        { kind: "circleHighlight", x: 84, y: 48, w: 26, h: 22, color: SUGAR, at: 0.96 },
      ],
    },
  },
  {
    id: "checkpoint-2",
    title: "Quick check",
    teacherMove: "Second pause, on the harder idea.",
    stepLabel: "Checkpoint 2",
    slideKind: "checkpoint",
    points: [],
    script:
      "Second check. In your own words, what does the light energy do inside the chloroplast? Try to be specific: what action does it help make happen?",
    checkpoint: {
      prompt: "What does the light energy actually do inside the chloroplast?",
      acceptableKeywords: [["split", "water"], ["break", "water"], ["energy", "rearrange"], ["power", "reaction"]],
      correctFeedback: "Yes — the light energy splits water apart, and powers the rearrangement of those atoms with CO₂ into sugar.",
      hintFeedback: "Think about water specifically: the light energy splits it apart so its pieces can combine with CO₂.",
      revealAnswer: "The light energy splits water apart, and powers the rearrangement of those pieces with CO₂ into sugar.",
    },
  },
  {
    id: "outputs",
    title: "What leaves the kitchen",
    teacherMove: "Back to a quicker pace — two outputs, delivered together, mirroring the fast ingredients beat.",
    stepLabel: "6 · Order up",
    slideKind: "intro",
    points: ["Sugar — the meal, kept by the plant", "Oxygen — the exhaust, vented outside"],
    script:
      "Every kitchen produces something useful, and something left over. In the leaf kitchen, the useful product is sugar, called glucose. The plant keeps that sugar, uses it to grow, or stores it for later. Oxygen is left over from splitting water apart, so it leaves the leaf and enters the air. That oxygen is the gas you and I breathe.",
    draw: {
      caption: "Sugar kept, oxygen vented",
      durationMs: 8000,
      ops: [
        { kind: "shape", shape: "leaf", x: 30, y: 50, w: 30, h: 40, color: GREEN, at: 0.04 },
        { kind: "label", text: "kitchen", x: 30, y: 22, size: "sm", color: GREEN, at: 0.16 },
        { kind: "label", text: "glucose", x: 30, y: 80, size: "sm", color: SUGAR, at: 0.3 },
        { kind: "label", text: "O₂", x: 80, y: 24, size: "lg", color: BLUE, at: 0.5 },
        { kind: "arrow", x1: 46, y1: 42, x2: 70, y2: 28, color: BLUE, curved: true, at: 0.64 },
        { kind: "note", text: "the air we breathe", x: 80, y: 40, at: 0.8 },
      ],
    },
  },
  {
    id: "compare-respiration",
    title: "The mirror process: respiration",
    teacherMove: "I contrast it with the opposite process to lock it in.",
    stepLabel: "7 · The reverse kitchen",
    slideKind: "compare",
    points: [],
    compareLeft: { label: "Photosynthesis (plant)", points: ["Light + water + CO₂", "→ builds sugar", "releases oxygen"] },
    compareRight: { label: "Respiration (you)", points: ["Sugar + oxygen", "→ releases energy", "produces CO₂"] },
    script:
      "Here is a helpful way to lock this in. Your body runs almost the reverse recipe. Photosynthesis takes light, water, and carbon dioxide, then builds sugar and releases oxygen. Respiration, which your body is doing right now, takes sugar and oxygen, then releases energy and carbon dioxide. Plants and people are connected by this exchange: what one releases, the other can use.",
    draw: {
      caption: "Photosynthesis vs. respiration",
      durationMs: 9000,
      ops: [
        { kind: "label", text: "PLANT", x: 26, y: 18, size: "sm", color: GREEN, at: 0.04 },
        { kind: "label", text: "light + H₂O + CO₂", x: 26, y: 38, size: "sm", color: SLATE, at: 0.16 },
        { kind: "arrow", x1: 26, y1: 46, x2: 26, y2: 58, color: GREEN, at: 0.3 },
        { kind: "label", text: "sugar + O₂", x: 26, y: 70, size: "sm", color: SUGAR, at: 0.42 },
        { kind: "label", text: "YOU", x: 76, y: 18, size: "sm", color: RED, at: 0.54 },
        { kind: "label", text: "sugar + O₂", x: 76, y: 38, size: "sm", color: SUGAR, at: 0.64 },
        { kind: "arrow", x1: 76, y1: 46, x2: 76, y2: 58, color: RED, at: 0.76 },
        { kind: "label", text: "energy + CO₂", x: 76, y: 70, size: "sm", color: SLATE, at: 0.88 },
      ],
    },
  },
  {
    id: "checkpoint-3",
    title: "Quick check",
    teacherMove: "Third pause — apply the contrast.",
    stepLabel: "Checkpoint 3",
    slideKind: "checkpoint",
    points: [],
    script:
      "Last check before we wrap up. The oxygen a plant releases: where did that oxygen come from originally? Take your time and think back to the mechanism.",
    checkpoint: {
      prompt: "Where does the oxygen a plant releases actually come from?",
      acceptableKeywords: [["water"], ["h2o"], ["splitting water"]],
      correctFeedback: "Right — it comes from splitting water apart. The oxygen atoms were part of the water molecule.",
      hintFeedback: "Go back to the mechanism step: what did the light energy split apart? The oxygen comes from there.",
      revealAnswer: "The oxygen comes from splitting water apart. The oxygen atoms were part of the water molecule.",
    },
  },
  {
    id: "why-it-matters",
    title: "Why this one kitchen matters this much",
    teacherMove: "I zoom out to the bigger picture.",
    stepLabel: "8 · Bigger picture",
    slideKind: "intro",
    points: ["Nearly all food chains start in this kitchen", "Nearly all breathable oxygen came from this kitchen"],
    script:
      "Zoom out for a second. Almost every food chain on Earth traces back to this leaf kitchen. Even an animal eating another animal is, a few steps back, using energy a plant captured from sunlight. Much of the oxygen in our atmosphere also comes from this process, built up over a very long time. One quiet process inside green leaves helps support the food we eat and the air we breathe.",
    draw: {
      caption: "One kitchen, the foundation of nearly everything",
      durationMs: 8500,
      ops: [
        { kind: "shape", shape: "leaf", x: 50, y: 32, w: 24, h: 30, color: GREEN, at: 0.05 },
        { kind: "label", text: "kitchen", x: 50, y: 10, size: "sm", color: GREEN, at: 0.2 },
        { kind: "arrow", x1: 50, y1: 46, x2: 30, y2: 68, color: SLATE, at: 0.36 },
        { kind: "label", text: "food chains", x: 22, y: 78, size: "sm", color: SLATE, at: 0.5 },
        { kind: "arrow", x1: 50, y1: 46, x2: 70, y2: 68, color: BLUE, at: 0.64 },
        { kind: "label", text: "oxygen", x: 78, y: 78, size: "sm", color: BLUE, at: 0.78 },
      ],
    },
  },
  {
    id: "recap",
    title: "The whole kitchen, one more time",
    teacherMove: "I tie it all together with the full sequence.",
    stepLabel: "Recap",
    slideKind: "recap",
    photoBackdrop: "/lecture-assets/photosynthesis-leaf-lab.png",
    points: [
      "Delivered: sunlight + water + CO₂",
      "Kitchen: the chloroplast",
      "Cooking: light splits water, pieces recombine",
      "Served: glucose (the meal) + oxygen (the exhaust)",
    ],
    script:
      "Let's run the whole kitchen one final time, start to finish. Sunlight, water, and carbon dioxide get delivered to the leaf. Inside the chloroplast, light energy helps split water apart, and those pieces recombine with carbon dioxide into glucose, the meal. Oxygen is left over from splitting water, and it leaves the leaf into the air. Delivery, cooking, sugar, oxygen. That is photosynthesis, and now you understand the recipe, not just the name.",
    draw: {
      caption: "Photosynthesis, start to finish",
      durationMs: 11000,
      ops: [
        { kind: "shape", shape: "sun", x: 14, y: 18, w: 14, h: 14, color: SUN, at: 0.02 },
        { kind: "label", text: "sun", x: 14, y: 19, size: "sm", color: SUN, at: 0.06 },
        { kind: "shape", shape: "droplet", x: 14, y: 48, w: 11, h: 14, color: BLUE, at: 0.1 },
        { kind: "label", text: "H₂O", x: 14, y: 49, size: "sm", color: BLUE, at: 0.16 },
        { kind: "label", text: "CO₂", x: 14, y: 76, size: "sm", color: SLATE, at: 0.21 },
        { kind: "arrow", x1: 22, y1: 22, x2: 40, y2: 46, color: SUN, at: 0.3 },
        { kind: "arrow", x1: 22, y1: 48, x2: 40, y2: 48, color: BLUE, at: 0.37 },
        { kind: "arrow", x1: 22, y1: 74, x2: 40, y2: 50, color: SLATE, at: 0.44 },
        { kind: "shape", shape: "leaf", x: 50, y: 48, w: 24, h: 32, color: GREEN, at: 0.52 },
        { kind: "label", text: "kitchen", x: 50, y: 24, size: "sm", color: GREEN, at: 0.62 },
        { kind: "arrow", x1: 60, y1: 42, x2: 80, y2: 26, color: SUGAR, at: 0.72 },
        { kind: "label", text: "glucose", x: 88, y: 24, size: "sm", color: SUGAR, at: 0.82 },
        { kind: "arrow", x1: 60, y1: 54, x2: 80, y2: 70, color: BLUE, at: 0.88 },
        { kind: "label", text: "O₂", x: 88, y: 72, size: "sm", color: BLUE, at: 0.95 },
      ],
    },
  },
];
