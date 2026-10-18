import { figureComponent } from "../figures/registry";
import { canvasSentences } from "./plan";
import type { CanvasBoardSpec, CanvasPlanBeat, FigureStage } from "./types";

/**
 * ONLY THE LABELS THAT MATTER. A diagram is not a labelling exercise: the owner asked for labels on
 * the parts that are mandatory, not on everything drawn (2026-10-17). A part is labelled when
 *   - the syllabus requires this board to show it (the curriculum visual contract's mustShow), or
 *   - Aria names it in what she says over this board.
 * Every other part stays drawn (and tappable in a picture's explore mode) but is not written.
 */

// A syllabus point can list eight structures to identify (a dicot leaf: cuticle, stomata, guard cells,
// mesophyll, air spaces, vascular bundles, chloroplasts, epidermis); six left two of them unlabelled.
// Labels are what the board teaches, not everything drawn (owner, 2026-10-17: "why do you have to
// label each and everything"): at most five named parts, more only when the syllabus lists them.
const MAX_LABELS = 5;

const core = (name: string) => name.replace(/\s*\(.*?\)\s*/g, " ").toLowerCase().replace(/[^a-z0-9α-ω'’ -]+/g, " ").replace(/\s+/g, " ").trim();
const words = (t: string) => core(t).split(/[\s-]+/).filter((w) => w.length >= 4 && !/^(with|from|into|that|this|their|layers?|parts?)$/.test(w));

/**
 * One spelling per part name, for matching a located part back to the part asked for: case,
 * punctuation, a bracketed aside ("Burette (hydrochloric acid)"), a leading "the" and plurals do not
 * matter ("The Alveoli" = "alveoli", "guard cell" = "Guard cells", "arteries" = "artery").
 */
export function partNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[’']s\b/g, "")
    .replace(/[^a-z0-9α-ω]+/g, " ")
    .trim()
    .replace(/^(?:the|a|an)\s+/, "")
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .join(" ");
}

function singular(w: string): string {
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(?:ss|us|is|as)$/.test(w)) return w;
  if (/(?:ches|shes|xes|sses|zes)$/.test(w)) return w.slice(0, -2);
  return w.replace(/s$/, "");
}

/** Do two part names name the same part (see partNameKey)? */
export function samePartName(a: string, b: string): boolean {
  const ka = partNameKey(a);
  return ka.length > 0 && ka === partNameKey(b);
}

/** A part as the label policy sees it: `aliases` are other names the narration may use for it. */
type Part = { id: string; name: string; aliases?: string[] };

/**
 * Names textbooks and teachers use for the same structure: Aria says "the main artery" over a heart
 * whose part is "Aorta". A part may also declare its own `aliases`, and a bracketed aside in its name
 * ("Petiole (leaf stalk)") is one. (Names are matched by word prefix, so a short alias that starts
 * another word — "stoma" in "stomach", "nuclei" in "nucleic" — is left out.)
 */
const SYNONYMS: string[][] = [
  ["aorta", "main artery"],
  ["vena cava", "venae cavae", "main vein"],
  ["trachea", "windpipe"],
  ["oesophagus", "esophagus", "gullet", "food pipe"],
  ["alveoli", "alveolus", "air sacs"],
  ["stomata", "leaf pores"],
  ["red blood cells", "erythrocytes"],
  ["white blood cells", "leucocytes", "leukocytes"],
  ["platelets", "thrombocytes"],
  ["cell membrane", "plasma membrane", "cell surface membrane"],
  ["mitochondria", "mitochondrion"],
  ["grana", "granum"],
  ["villi", "villus"],
  ["lamina", "leaf blade"],
  ["petiole", "leaf stalk"],
  ["small intestine", "ileum"],
  ["tympanic membrane", "eardrum"],
  ["magma", "molten rock"],
  // School and textbook names for the same structure (a syllabus's "sperm duct" is the vas deferens):
  // a label using either names the part.
  ["vas deferens", "sperm duct"],
  ["capillary bed", "capillary network"],
  ["oviduct", "fallopian tube", "uterine tube"],
  ["uterus", "womb"],
  ["testis", "testes", "testicle"],
  ["larynx", "voice box"],
  ["pharynx", "throat"],
  ["bicuspid valve", "mitral valve", "left atrioventricular valve"],
  ["tricuspid valve", "right atrioventricular valve"],
  ["semilunar valve", "pocket valve"],
  ["bowman's capsule", "renal capsule", "glomerular capsule"],
  ["loop of henle", "nephron loop"],
  ["golgi apparatus", "golgi body", "golgi complex"],
  ["rough endoplasmic reticulum", "rough er"],
  ["smooth endoplasmic reticulum", "smooth er"],
  ["vacuole", "sap vacuole", "permanent vacuole"],
  ["ciliary muscle", "ciliary body"],
  ["suspensory ligament", "suspensory ligaments"],
  ["ossicles", "ear bones"],
  ["eustachian tube", "auditory tube"],
  ["pinna", "outer ear", "auricle"],
  ["large intestine", "colon"],
  ["neurone", "neuron", "nerve cell"],
  ["axon", "nerve fibre", "nerve fiber"],
  ["synaptic cleft", "synaptic gap"],
  ["myelin sheath", "fatty sheath"],
  ["nucleoid", "bacterial chromosome"],
  ["xylem", "xylem vessel"],
  ["phloem", "sieve tube"],
];

/** Every name a part may be called by: its own, its bracketed aside, its declared aliases, its synonyms. */
export function partNames(part: { name: string; aliases?: string[] }): string[] {
  const aside = [...part.name.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]);
  const own = [part.name, ...aside, ...(Array.isArray(part.aliases) ? part.aliases : [])].filter((n) => typeof n === "string" && n.trim());
  const keys = new Set(own.map(partNameKey));
  const synonyms = SYNONYMS.filter((group) => group.some((g) => keys.has(partNameKey(g)))).flat();
  return [...new Set([...own, ...synonyms])];
}

/**
 * Does the narration name this part? Its whole name, or most of its distinctive words — under any of
 * its names (partNames), or the extra `aliases` given.
 */
export function namedIn(script: string, name: string, aliases: string[] = []): boolean {
  return partNames({ name, aliases }).some((n) => namedAs(script, n));
}

function namedAs(script: string, name: string): boolean {
  const said = ` ${core(script)} `;
  const whole = core(name);
  if (whole && said.includes(` ${whole} `)) return true;
  const ws = words(name);
  if (!ws.length) return false;
  // The words must be said together — within a few words of each other — so "right side" in one
  // sentence and "left ventricle" in another do not name the right ventricle.
  const need = Math.max(1, Math.ceil(ws.length * 0.67));
  const matches = (token: string, w: string) => token.startsWith(w.replace(/s$/, ""));
  for (const sentence of script.split(/(?<=[.!?;])\s+/)) {
    const tokens = core(sentence).split(/[\s-]+/);
    for (let i = 0; i < tokens.length; i++) {
      if (!ws.some((w) => matches(tokens[i], w))) continue;
      const window = tokens.slice(i, i + ws.length + 3);
      if (ws.filter((w) => window.some((t) => matches(t, w))).length >= need) return true;
    }
  }
  return false;
}

// A head noun this general names nothing on its own ("the cells", "the layer").
const GENERIC_HEADS = /^(cell|layer|part|region|area|side|structure|system|tissue|end|surface|space|line|arrow|zone)$/;

/**
 * The part's head noun ("artery" of "pulmonary artery"), when it alone can name the part: the name has
 * more than one word, the noun is specific, and no other part on the board shares it ("ventricle"
 * names neither ventricle of a heart that has two).
 */
function headNoun(part: Part, all: Part[]): string | null {
  const ws = core(part.name).split(/[\s-]+/).filter(Boolean);
  if (ws.length < 2) return null;
  const head = partNameKey(ws[ws.length - 1]);
  if (head.length < 4 || GENERIC_HEADS.test(head)) return null;
  const shared = all.some((q) => q !== part && partNames(q).some((n) => { const qw = core(n).split(/[\s-]+/).filter(Boolean); return qw.length > 0 && partNameKey(qw[qw.length - 1]) === head; }));
  return shared ? null : head;
}

/** Said bare — "the artery", "an artery", "this artery" — not with another word in front ("coronary artery"). */
function saidBare(script: string, head: string): boolean {
  const stem = head.replace(/[^a-z0-9]/g, "");
  const noun = /y$/.test(stem) ? `${stem.slice(0, -1)}(?:y|ies)` : `${stem}(?:s|es)?`;
  const re = new RegExp(`(?:^|[.!?;:,]\\s*|\\b(?:the|a|an|this|that|its|each|every|one)\\s+)${noun}\\b`, "i");
  return re.test(script.replace(/\s+/g, " "));
}

/** Is the part named — under any of its names, (when unambiguous) by its head noun alone, or in a plural that names its kind? */
function partNamed(script: string, part: Part, all: Part[]): boolean {
  if (namedIn(script, part.name, part.aliases)) return true;
  const head = headNoun(part, all);
  if (head && saidBare(script, head)) return true;
  return saidAsKind(script, part, all);
}

/**
 * "THE VENTRICLES CONTRACT" NAMES BOTH VENTRICLES. A singular "the ventricle" names neither of a
 * heart's two, but the plural names every part sharing that head noun: a heartbeat board said "into
 * ventricles" and labelled neither, on the board about them (prompt bench, 2026-10-18).
 */
function saidAsKind(script: string, part: Part, all: Part[]): boolean {
  const ws = core(part.name).split(/[\s-]+/).filter(Boolean);
  if (ws.length < 2) return false;
  const head = ws[ws.length - 1];
  if (head.length < 4 || GENERIC_HEADS.test(partNameKey(head))) return false;
  const kin = all.filter((q) => q !== part && core(q.name).split(/[\s-]+/).filter(Boolean).pop() === head);
  if (!kin.length) return false;
  const plural = /um$/.test(head) ? `${head.slice(0, -2)}a` : /us$/.test(head) ? `${head.slice(0, -2)}i` : /is$/.test(head) ? `${head.slice(0, -2)}es` : /y$/.test(head) ? `${head.slice(0, -1)}ies` : /(?:s|x|ch|sh)$/.test(head) ? `${head}es` : `${head}s`;
  return new RegExp(`\\b${plural}\\b`, "i").test(script);
}

/** The sentence (numbered as the player numbers them) that first names a part; 0 when none does. */
function firstNamed(script: string, part: Part, all: Part[]): number {
  return Math.max(0, canvasSentences(script).findIndex((sentence) => partNamed(sentence, part, all)));
}

/** Is this part required by the board's curriculum contract? */
function required(beat: Pick<CanvasPlanBeat, "requiredVisual">, id: string, name: string): boolean {
  return (beat.requiredVisual?.mustShow ?? []).some((m) => {
    const want = core(m);
    return want === id.toLowerCase() || want === core(name) || (want.length > 3 && core(name).includes(want));
  });
}

/**
 * The labelled parts, in the order the narration first names them; required ones always kept.
 *
 * WHEN ARIA NAMES MORE PARTS THAN THERE ARE LABELS, THE IMPORTANT ONES WIN, not the first ones said.
 * A heart board walked the right side first and its five labels all went there: the left ventricle —
 * the board's key point, "Left ventricle: thickest wall" — was left unlabelled (prompt bench,
 * 2026-10-17). A part counts once for every sentence that names it, and twice more when a note on the
 * board names it (the notes are what the teacher chose to write). Between equals, the part farthest
 * from the labels already chosen wins on a located picture, so the labels cover the picture instead of
 * crowding one side; otherwise the one said first.
 */
export function mandatoryLabels(beat: Pick<CanvasPlanBeat, "script" | "requiredVisual">, parts: Part[], written: string[] = []): string[] {
  const said = core(beat.script);
  const at = (part: Part) => {
    const head = headNoun(part, parts);
    const found = [...partNames(part).map(core), ...(head ? [head] : [])].map((n) => said.indexOf(n)).filter((i) => i >= 0);
    return found.length ? Math.min(...found) : Number.MAX_SAFE_INTEGER;
  };
  const must = parts.filter((p) => required(beat, p.id, p.name));
  const named = parts.filter((p) => !must.includes(p) && partNamed(beat.script, p, parts)).sort((a, b) => at(a) - at(b));
  const slots = Math.max(0, MAX_LABELS - must.length);
  if (named.length <= slots) return [...must, ...named].map((p) => p.id);
  const sentences = canvasSentences(beat.script);
  const weight = (p: Part) => sentences.filter((s) => partNamed(s, p, parts)).length + (written.some((w) => partNamed(w, p, parts)) ? 2 : 0);
  const spot = (p: Part) => { const q = p as Part & { x?: number; y?: number }; return typeof q.x === "number" && typeof q.y === "number" ? { x: q.x, y: q.y } : null; };
  const chosen: Part[] = [...must];
  const left = [...named];
  while (chosen.length < must.length + slots && left.length) {
    const spread = (p: Part) => {
      const here = spot(p);
      const others = chosen.map(spot).filter((o): o is { x: number; y: number } => Boolean(o));
      return here && others.length ? Math.min(...others.map((o) => Math.hypot(o.x - here.x, o.y - here.y))) : 0;
    };
    // `left` is in the order said, so the first of equals is the one said first.
    const best = left.reduce((a, b) => (weight(b) > weight(a) || (weight(b) === weight(a) && spread(b) > spread(a) + 1e-9) ? b : a));
    chosen.push(best);
    left.splice(left.indexOf(best), 1);
  }
  const keep = new Set(chosen.slice(must.length));
  return [...must, ...named.filter((p) => keep.has(p))].map((p) => p.id);
}

/**
 * The parts a figure actually DRAWS for its parameters: a library diagram's, a described drawing's,
 * or the component built with the board's params. A component's full part list includes parts a
 * given set of params leaves out, and the layout drops a label whose part is not drawn — so choosing
 * from the full list could land the narration's part, and the three-label minimum, on nothing.
 * null when unknown (the writer's parts are taken as drawn).
 */
function drawnParts(stage: FigureStage): Part[] | null {
  if (stage.asset?.parts?.length) return stage.asset.parts;
  if (stage.drawing?.parts?.length) return stage.drawing.parts;
  const component = figureComponent(stage.component);
  if (!component) return null;
  const declared = (id: string) => (component.parts.find((p) => p.id === id) as Part | undefined)?.aliases;
  try {
    const built = component.build(stage.params ?? {}).parts;
    if (built.length) return built.map((p) => ({ id: p.id, name: p.name, ...(declared(p.id) ? { aliases: declared(p.id) } : {}) }));
  } catch {
    // A component that cannot build these params is reported by the validator; fall back to its list.
  }
  return component.parts;
}

/**
 * The board with only its mandatory labels written. A picture keeps every located part (still
 * tappable) but writes only those labels; a drawn figure labels only those parts, and pen cues that
 * pointed at an unlabelled part are dropped.
 */
export function withMandatoryLabels(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "script" | "requiredVisual">): CanvasBoardSpec {
  const stage = spec.stage;
  if (stage.kind === "illustration") {
    const keep = new Set(mandatoryLabels(beat, stage.parts, spec.notes.map((n) => n.text)));
    return { ...spec, stage: { ...stage, labels: stage.parts.filter((p) => keep.has(p.id)).map((p) => p.id) } };
  }
  if (stage.kind === "diagram" || stage.kind === "figure") {
    // Every part the figure DRAWS is a candidate, not only those the board writer chose: Aria named
    // chloroplasts, air spaces, phloem and guard cells over a leaf section that labelled three other
    // parts (audit 2026-10-17). A named part the writer left out is added on the sentence that first
    // names it. A writer's part the figure does not draw is not a candidate at all.
    const drawn: Part[] | null = stage.kind === "diagram" ? (stage.drawing?.parts?.length ? stage.drawing.parts : null) : drawnParts(stage);
    const own = drawn ? stage.parts.filter((p) => drawn.some((d) => d.id === p.id)) : stage.parts;
    const aliasesOf = (id: string) => drawn?.find((d) => d.id === id)?.aliases;
    const extra = (drawn ?? []).filter((a) => !own.some((p) => p.id === a.id));
    const all: Part[] = [...own.map((p) => ({ id: p.id, name: p.name, aliases: aliasesOf(p.id) })), ...extra];
    const candidates = [...own, ...extra.map((a) => ({ id: a.id, name: a.name, s: firstNamed(beat.script, a, all) }))];
    const keep = new Set(mandatoryLabels(beat, all, spec.notes.map((n) => n.text)));
    // A labelled diagram needs a few labels: when Aria names fewer than three parts, the writer's own
    // (drawn) choices fill it up to three, then the figure's other drawn parts. Keeping only one made
    // every attempt fail "a figure needs at least two labelled parts" and sent two boards of a biology
    // lesson to the backup (audit 2026-10-17).
    const parts = candidates.filter((p) => keep.has(p.id));
    const minimum = Math.min(2, candidates.length);
    const kept = parts.length >= minimum ? parts : [...parts, ...candidates.filter((p) => !parts.some((q) => q.id === p.id))].slice(0, Math.max(minimum, parts.length));
    const ids = new Set(kept.map((p) => p.id));
    return { ...spec, stage: { ...stage, parts: kept }, cues: spec.cues.filter((c) => !c.target || !stage.parts.some((p) => p.id === c.target) || ids.has(c.target)) };
  }
  return spec;
}
