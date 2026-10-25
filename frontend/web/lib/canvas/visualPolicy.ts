import { isMathsTopic } from "./predictCard";
import { spokenEquations } from "./equationCheck";
import { canvasSentences } from "./plan";
import { isCsTopic, isLabLookTopic } from "./subjectLook";
import { csMechanismBoard, csMechanismStage, isTypedOsTopic } from "./csLessons";
import { osStageFor } from "./osDiagrams";
import { domainIsCs, type SubjectDomain } from "./subjectDomain";
import { FIGURE_COMPONENTS, figureComponent, figureFor } from "../figures/registry";
import { classifyInstructionalTask } from "./instructionalTask";
import { namedIn } from "./labelPolicy";
import { boardWords, componentFitsSubject, GEOMETRY_FORM, hasVisualForm, isGeometryOrMechanics, MECHANICS_FORM, isPhotographicAppearance, isPictureSubject, isPictureWorthy, isRealProcess, needsVectorDiagram } from "../diagrams/visualForm";
import type { CanvasPlanBeat, CanvasStage } from "./types";
import type { FigureComponent } from "../figures/types";

/** How freely the lesson may add visuals beyond a supplied source. */
export type VisualPolicyMode = "course" | "prompt" | "reference" | "strict";

export type VisualPolicyAudit = {
  mode: VisualPolicyMode;
  illustrations: number;
  meaningfulVisuals: number;
  targetMeaningfulVisuals: number;
  changes: string[];
};

export const PHYSICAL = /\b(cell|organelle|organ|anatom|heart(?!\s+rate)|lung|kidney|leaf|(?<!(?:square|cube|nth|complex|real|repeated|equal|distinct) )root(?!s? of)|stem|flower|plant part|animal|skeleton|muscle|eye|ear|brain|neuron|alveol\w*|nephron|apparatus|equipment|machine|engine|circuit|battery|magnet|rock layer|volcano|landform|weather systems?|planet|telescope|microscope|cross[- ]section|cutaway|internal structure|burette|pipette|conical flask|beaker|test[- ]tube|bunsen|thermometer|measuring cylinder|condenser|filter funnel|evaporating basin|cuvette|colorimeter|gas syringe|delivery tube|electrode|building|monument|mosque|ka[ʿ'’]?ba|kaaba|temple|church|cathedral|castle|fort|pyramid|palace|tomb|artefact|artifact|statue|ship|landscape|river|mountain|coastline|glacier|desert|world maps?|ocean currents?|ocean|currents? of the|trade winds?|prevailing winds?|pressure belts?|hadley|ferrel cell|polar cell|ITCZ|atmospheric circulation|latitude bands?)(?:e?s)?\b/i;

// Only real charts and tables refuse a picture (owner, 2026-10-17); abstract boards (arguments,
// frameworks) are already kept from pictures by the abstract-content pass.
const PICTURE_CHART = /\b(graphs?|charts?|bar charts?|axis|axes|legend|tables?|plots?|histograms?|pie charts?|timelines?)\b|%/i;

/** Why an image model cannot draw this subject. Null means a photograph of a real thing is OK. */
export function pictureRequestProblem(subject: string, parts: string[]): string | null {
  const text = `${subject} ${parts.join(" ")}`;
  if (/\b(world maps?|ocean currents?|maps? of|weather systems?|trade winds?|ITCZ|pressure belts?|atmospheric circulation|latitude)\b/i.test(text)) return "a map or spatial model";
  if (PICTURE_CHART.test(text)) return "a chart, table or argument";
  if (/\b\d{2,}\b|\b(pairs? of|sets? of|number of|counts?|twice as many|half as many)\b/i.test(text)) return "an exact count or number";
  if (/\b(questions?|marks?|marking|command words?|labels?|text|words?|notation|symbols?|formula|equation|card)\b|\b2?n\s*=/i.test(text)) return "words, symbols or an exam card";
  // Working, conversions and units are maths, whatever the subject ("Units of measure" was sent to the
  // image model and rejected for drawing its own numbers; diagram lab, 2026-10-17).
  if (/\b(worked examples?|conversions?|convert\w*|units? of|calculat\w*|rearrang\w*|substitut\w*|logarithms?|indices|powers? of)\b/i.test(text)) return "working or units";
  const abstract = parts.filter((p) => /\b(evidence|judgement|judgment|costs?|benefits?|arguments?|reasons?|effects?|impacts?|factors?|advantages?|disadvantages?|limitations?|strengths?|conclusion|evaluation)\b/i.test(p));
  if (abstract.length) return `ideas rather than visible parts (${abstract.slice(0, 3).join(", ")})`;
  if (!PHYSICAL.test(text)) return "not a physical thing";
  return null;
}
const STRUCTURAL = /\b(label|identify|part|structure|inside|cross[- ]section|cutaway|anatomy|location)\b/i;
const NON_PICTURE = /\b(equation|formula|calculate|solve|graph|plot|gradient|slope|code|program|algorithm|loop|variable|molecule|molecular|vsepr|bond angle|lone pair|atom count|balanced equation)\b/i;

function boardText(beat: CanvasPlanBeat): string {
  return boardWords(beat);
}

/** A board about an organ, cell, plant, animal, apparatus, landscape or building — judged by its title and brief. */
function pictureBoard(beat: CanvasPlanBeat): boolean {
  return isPictureSubject(`${beat.title} ${beat.brief}`);
}

/** A board that should GET a picture: the thing anywhere in its content, its title not a process (visualForm isPictureWorthy). */
function pictureWorthy(beat: CanvasPlanBeat): boolean {
  // Title, brief and named objects — not the narration, which mentions blood or a leaf in passing:
  // "From absorption to assimilation" and "Two routes of photophosphorylation" were sent to the image
  // model that way, failed its check and became text cards (diagram lab, 2026-10-17).
  return isPictureWorthy(beat.title, `${beat.brief} ${(beat.objects ?? []).join(" ")}`);
}

/** Biology and the human body: pictured, never the coordinate vector diagram (owner, 2026-10-17). */
export const LIFE_SCIENCE = /\b(cells?|tissues?|organs?|organelles?|membranes?|nucle(?:us|i)|mitochondri\w*|chloroplasts?|ribosomes?|enzymes?|bacteri\w*|virus\w*|pathogens?|blood|heart|lungs?|alveol\w*|kidneys?|nephrons?|liver|intestin\w*|ileum|villi|villus|stomach|digest\w*|absorb\w*|absorption|nutrients?|glands?|hormones?|neurones?|neurons?|nerves?|nervous|endocrine|adrenaline|insulin|glucagon|brain|eyes?|ears?|muscles?|bones?|skeleton|skin|plants?|leaf|leaves|roots?|stems?|flowers?|seeds?|pollen|xylem|phloem|stomata|animals?|organisms?|species|insects?|fish|birds?|mammals?|fung(?:us|i)|DNA|chromosomes?|genes?|photosynthesis|respiration|immun\w*|antibod\w*|vaccin\w*|reproduct\w*|sperm|eggs?|ovar\w*|uterus|placenta|fetus|embryo|food (?:chains?|webs?)|producers?|consumers?|predators?|prey|ecosystems?|trophic|decomposers?|habitats?|populations?|synapses?|sarcomeres?|axons?|myelin|refractory|action potentials?|impulses?)\b/i;

/** A named biological or earth cycle: drawn as a loop of steps (a cycle flow). */
const CYCLE_BOARD = /\b(krebs|calvin|carbon|nitrogen|water|cell|menstrual|cardiac|life|rock|ornithine|urea|citric acid) cycle\b/i;

/** Figures that draw a PROCESS rather than a structure. */
const PROCESS_KITS = new Set(["proteinSynthesis", "geneticTech", "membraneTransport", "enzymeAction", "cellDivision", "chromosomeSets", "antibody", "dnaStructure", "photosynthesisExperiment", "oxygenDebt"]);

/**
 * A process figure on a board about a cell, organ, plant or animal, when the title does not name that
 * process: a bacterial-cell board whose brief lists "ribosomes" got the protein-synthesis figure
 * (live test, 2026-10-17). Structure figures (heart, leaf section) still win on their own subject.
 */
function processKitOffSubject(beat: CanvasPlanBeat, kit: string): boolean {
  if (!PROCESS_KITS.has(kit) || !pictureBoard(beat)) return false;
  const component = figureComponent(kit);
  return !component || !component.match.test(beat.title);
}

/** How many of a figure's parts the board's narration names. */
function partsNamed(beat: CanvasPlanBeat, component: FigureComponent): number {
  return component.parts.filter((p) => namedIn(beat.script, p.name)).length;
}

/** A maths figure the board's words describe better than `picked`: its trigger matches, more parts named. */
function describedFigure(beat: CanvasPlanBeat, picked: FigureComponent): FigureComponent | undefined {
  const text = boardText(beat);
  const floor = Math.max(2, partsNamed(beat, picked) + 1);
  let best: FigureComponent | undefined;
  let bestNamed = 0;
  for (const c of FIGURE_COMPONENTS) {
    if (c === picked || !MATH_KITS.has(c.name) || !c.match.test(text) || !componentFitsSubject(c.name, text)) continue;
    const n = partsNamed(beat, c);
    if (n >= floor && n > bestNamed) {
      best = c;
      bestNamed = n;
    }
  }
  return best;
}

/**
 * The component this board is about. One its title names wins over words its script mentions in
 * passing: "Water moves by osmosis" is a membrane board even though it describes the water molecule's
 * covalent bonds and lone pairs (audit replay 2026-10-17).
 */
function figureForBoard(beat: CanvasPlanBeat) {
  // What the board is ABOUT picks its diagram first. The narration may pick one only when it names
  // that subject at least twice: one passing word put a plasmid on "Risks and balanced discussion"
  // (audit 2026-10-17), while a terse title ("Transformations") still needs its script.
  const byTitle = figureFor(`${beat.title} ${beat.brief}`);
  // THE FIGURE THE BOARD DESCRIBES BEATS THE ONE A TITLE WORD PICKED. When the title picks a maths
  // figure, another maths figure whose own trigger matches the whole board and whose parts the
  // narration names more often (at least two) is what the board is about: "Arranging four triangles
  // inside a square" picked a bare triangle by its title word while its narration described the four
  // triangles and the large square of a rearrangement proof (2026-10-21).
  const described = byTitle && MATH_KITS.has(byTitle.name) ? describedFigure(beat, byTitle) : undefined;
  if (described) return described;
  if (byTitle && componentFitsSubject(byTitle.name, boardText(beat)) && !processKitOffSubject(beat, byTitle.name)) return byTitle;
  // A board about a cell, organ, plant or animal is drawn as itself: its narration naming a process
  // ("ribosomes carry out protein synthesis") put the protein-synthesis figure on an animal-cell board
  // (live test, 2026-10-17). Only a figure its title or brief names may draw it; else it is a picture.
  if (pictureBoard(beat)) return undefined;
  const byScript = figureFor(boardText(beat));
  if (!byScript || !componentFitsSubject(byScript.name, boardText(beat))) return undefined;
  const hits = boardText(beat).match(new RegExp(byScript.match.source, byScript.match.flags.includes("g") ? byScript.match.flags : `${byScript.match.flags}g`)) ?? [];
  if (hits.length >= 2) return byScript;
  // One mention is enough when the board's own title names the diagram's subject ("Transformations"
  // and a coordinate grid that draws transformations).
  const named = (beat.title.toLowerCase().match(/[a-z]{5,}/g) ?? []).map((w) => w.replace(/s$/, "")).filter((w) => !/^(about|using|their|these|which|where|while|after|before)$/.test(w));
  return named.some((w) => byScript.title.toLowerCase().includes(w)) ? byScript : undefined;
}

/** Maths content: never a generated picture. */
const MATHS = /\b(complex numbers?|square roots?|roots? of (an? |the )?(equation|polynomial|quadratic)|equations?|modulus|argand|integra(l|ls|tion|te)|derivatives?|differentiat\w*|matri(x|ces)|algebra\w*|theorem|polynomials?|quadratics?|logarithms?|trigonometr\w*|inequalit(y|ies)\b(?! (between|in|of) (groups|people|income|wealth|health))|loci|locus|cis|simultaneous|surds?|indices)\b/i;

/** Words too general to tie a textbook picture to a board. */
const GENERIC_PICTURE_WORDS = new Set(["the", "and", "cell", "cells", "diagram", "structure", "system", "human", "complete", "simple", "labelled", "label", "part", "parts", "body", "view", "section", "cross", "model", "type", "process", "edit", "edited", "version", "with", "how", "work", "showing", "show", "basic"]);

/**
 * A chronology worth a timeline: three or more dates, or two in a historical account. Two study
 * dates (Asch 1951, Milgram 1963) on a psychology sampling board are citations, not a sequence of
 * events (audit 2026-10-17).
 */
function datedSequence(text: string): boolean {
  const years = new Set(text.match(/\b1[0-9]{3}\b|\b20[0-9]{2}\b/g) ?? []).size;
  return years >= 3 || (years >= 2 && /\b(wars?|reign\w*|revolution\w*|treat(y|ies)|empires?|dynast\w*|independence|partition|caliph\w*|kings?|queens?|emperors?|battles?|invasions?|era|century|period|began|ended|founded|declared|signed|elect\w*|seced\w*|secession|rebel\w*|uprising|coup|coloni\w*|crisis|abolish\w*|passed|ruled?|conquer\w*)\b/i.test(text));
}

/** Higher means a textbook picture carries information that a symbolic renderer cannot. */
/** The vector diagram pipeline is on unless CANVAS_VECTOR_DIAGRAMS=off. */
const VECTOR_DIAGRAMS = () => !(typeof process !== "undefined" && process.env?.CANVAS_VECTOR_DIAGRAMS === "off");

/**
 * Ideas whose textbook visual is a map, a cross-section, a circulation or data — drawn exactly by the
 * vector grammar (lib/diagrams/grammar.ts), never by an image model or as boxes and arrows.
 */
export const VECTOR_FORM = /\b(maps?|ocean currents?|(warm|cold|surface) currents?|gulf stream|trade winds?|prevailing winds?|global winds?|jet streams?|itcz|inter-?tropical convergence|latitudes?|longitudes?|hemispheres?|climate zones?|biomes? (of|around) the world|plate boundar\w*|tectonic plates?|ring of fire|global distribution|world distribution|trade routes?|migration routes?|cross[- ]sections?|soil profiles?|soil horizons?|rock strata|strata|layers of the (atmosphere|earth|skin|soil)|atmospheric (circulation|layers)|three[- ]cell model|hadley cells?|ferrel cells?|polar cells?|climate graphs?|population pyramids?|supply and demand|demand curves?|supply curves?|equilibrium price|bar charts?|line graphs?|histograms?|scatter (graphs?|plots?)|frequency (tables?|diagrams?|polygons?)|number lines?|(graph|chart|table) of (the )?data|insolation|solar radiation (by|with|and) latitude)\b/i;

/** Essay and argument boards: their visuals are the humanities kit's (balance, cause map, source card). */
const ESSAY_BOARD = /\b(evaluat\w*|to what extent|how far|assess\w*|for and against|arguments?|judgements?|essay)\b/i;

/**
 * Is this board about what something LOOKS like — the one thing a generated picture shows best? An
 * organism, a specimen, a landform, a building or artefact, its appearance — not its labelled layers,
 * not a map, not data, not a count.
 */
export function photographic(beat: CanvasPlanBeat): boolean {
  const text = boardText(beat);
  if (VECTOR_FORM.test(text) || /\b\d{2,}\b|\b(pairs? of|number of|counts?)\b/i.test(`${beat.title} ${beat.brief}`)) return false;
  // ONE predicate for "a picture of what it looks like": the guaranteed lesson picture (below) used
  // isPhotographicAppearance while this pass used only the subject list, so the one picture the
  // policy guaranteed could be redrawn as a vector diagram by the last pass.
  if (isPhotographicAppearance(text) || pictureBoard(beat) || pictureWorthy(beat)) return true;
  return /\b(looks? like|appearance|photo\w*|specimens?|organisms?|animals?|birds?|insects?|fish|mammals?|reptiles?|amphibians?|flowers?|leaf|leaves|plants?|fruits?|seeds?|fung(us|i)|mushrooms?|trees?|forests?|rainforests?|coral reefs?|volcano(es)?|glaciers?|landscapes?|mountains?|deserts?|waterfalls?|canyons?|coastlines?|cliffs?|beach(es)?|deltas?|buildings?|monuments?|mosques?|temples?|churches|cathedrals?|castles?|forts?|pyramids?|palaces?|tombs?|artefacts?|artifacts?|statues?|paintings?|ships?|crystals?|minerals?|rock samples?)\b/i.test(text)
    && !/\b(label(led)? (the )?(parts|structure)|internal structure|cross[- ]section|cutaway|tissues?|layers?|inside (of|the))\b/i.test(text);
}

export function pictureNeedScore(beat: CanvasPlanBeat): number {
  const text = boardText(beat);
  let score = 0;
  if (PHYSICAL.test(text)) score += 3;
  if (STRUCTURAL.test(text)) score += 2;
  if (beat.requiredVisual?.stages.includes("illustration")) score += 4;
  if (NON_PICTURE.test(text) || MATHS.test(text)) score -= 5;
  return score;
}

/** Prefer exact native renderers whenever the lesson is symbolic, sequential or quantitative. */
export function nativeStageFor(beat: CanvasPlanBeat): CanvasStage {
  const stage = classifyInstructionalTask(beat).stage;
  // "Native" means a renderer that does not call the image model. A physical-structure task still
  // falls back to a labelled scene when pictures are disabled or forbidden in strict mode.
  return stage === "illustration" ? "scene" : stage;
}

/**
 * An electrolysis board about the cell itself. Its words ("cell", "apparatus") scored it as a
 * picture and its half-equations as an equation board, so the native wired-cell renderer (power
 * supply, electrodes, polarity, ions moving — lib/canvas/layout.ts electrolyticCellParts) never ran
 * in a real lesson (O Level audit 2026-10-15); a generated picture cannot be trusted to wire it right.
 */
export function isElectrolyticCellBeat(beat: CanvasPlanBeat): boolean {
  const text = boardText(beat);
  return /\belectroly(?:sis|tic|te)\b/i.test(text) && /\banode\b/i.test(text) && /\bcathode\b/i.test(text) && /\b(cell|apparatus|set[- ]?up|circuit|power supply|battery|electrodes?|diagram)\b/i.test(text);
}

/** A board about the forces on one object: drawn as a free-body diagram (lib/canvas/layout.ts freeBodyParts). */
export function isFreeBodyBeat(beat: CanvasPlanBeat): boolean {
  const text = boardText(beat);
  return /\bfree[- ]body\b|\bforces? (?:acting )?on (?:the|a|an)\b|\b(?:balanced|unbalanced) forces\b|\bresultant force\b/i.test(text) && /\b(weight|gravity)\b/i.test(text);
}

/** The ids the wired-cell renderer recognises (lib/canvas/prompts.ts asks for them too). */
export const ELECTROLYTIC_CELL_OBJECTS = ["power-supply", "electrolyte", "anode", "cathode"];

/** Required ids first, so aorta is labelled even when the heart kit has more than six parts. */
export function labelledFigureParts(component: { parts: Array<{ id: string }> }, required: string[] = []): string[] {
  const have = new Set(component.parts.map((p) => p.id));
  const need = required.filter((id) => have.has(id) && !/\s/.test(id));
  const rest = component.parts.map((p) => p.id).filter((id) => !need.includes(id));
  return [...need, ...rest].slice(0, 6);
}

function firstRequiredStage(beat: CanvasPlanBeat): CanvasStage | null {
  const stages = beat.requiredVisual?.stages ?? [];
  return stages.find((stage): stage is CanvasStage => ["illustration", "flow", "equation", "graph", "compare", "scene", "code", "molecule", "atom-map", "figure", "diagram"].includes(stage)) ?? null;
}

function meaningful(stage: CanvasStage, apparatus = false): boolean {
  // A generic scene is useful as a last resort, but it is not counted as textbook-grade visual
  // evidence. Every other stage has a renderer with a specific explanatory grammar — and so does a
  // scene the wired-cell renderer draws.
  return stage !== "scene" || apparatus;
}

/**
 * Makes the lesson visual by outcome, not by decoration.
 *
 * A normal lesson may introduce at most four generated base pictures (one in a one-board lesson —
 * maxIllustrations below; lib/canvas/prompts.ts tells the planner the same). More are retained only
 * when separate syllabus contracts explicitly require labelled physical structures. The remaining
 * visual load is carried by deterministic renderers: flows, graphs, equations, molecules and code.
 */
export const GRAPH_LIKE = new Set(["supplyDemand", "ppf", "adAs", "costRevenue", "scatterPlot", "histogram", "boxPlot", "dotPlot", "cumulativeFrequency", "barChart", "pieChart", "inferenceDistribution", "motionGraph", "rateGraph", "decayCurve", "energyProfile", "functionGraph", "riemannSum", "slopeField", "coordinateGrid", "numberLine", "unitCircle", "argand", "punnettSquare", "probabilityTree", "venn", "sankey", "ecologicalPyramid", "sequences", "oxygenDebt", "sectorArc", "gelElectrophoresis", "oxygenDissociation", "microscopeGraticule"]);
/** Structures drawn differently per board from their params: a haploid view, then a diploid one. */
// Geometry kits draw a different construction per board from their params (one circle theorem per
// board): "circleTheorem is drawn on b1" turned the chord-bisector and tangent boards of a circle
// theorems lesson into a scene and an equation (QA 2026-10-17).
const MATH_KITS = new Set(["circleTheorem", "triangle", "vectors", "parallelLines", "bearings", "shapes3d", "pythagorasProof", "pythagorasGarfield", "pythagorasSimilar", "pythagorasSquares", "areaModel", "logicCircuit"]);
/** Code-drawn maths figures that working can be written beside (lib/canvas/layout.ts). */
const WORKING_FIGURES = new Set([...MATH_KITS, "functionGraph", "coordinateGrid", "numberLine", "unitCircle", "sectorArc", "argand", "calculusKit", "riemannSum", "dotPlot", "boxPlot", "cumulativeFrequency", "probabilityTree", "venn", "sequences"]);

/** Does this narration work something out — two or more equations said, or three sentences of numbers and operations? */
function worksSomethingOut(script: string): boolean {
  if (spokenEquations(script).length >= 2) return true;
  return canvasSentences(script).filter((s) => /\d/.test(s) && /[=+×÷−\-^²³√]|\b(times|plus|minus|divided by|squared|equals|gives)\b/i.test(s)).length >= 3;
}

/** Maths figures whose shapes move with the narration (lib/figures/types.ts ShapeTiming). */
const MOTION_MATHS = new Set(["pythagorasProof", "areaModel"]);
const REPEATABLE = new Set(["logicCircuit", "chromosomeSets", "cellDivision", "punnettSquare", "pedigree", "electromagnetism", "titration", "circleTheorem", "triangle", "vectors", "parallelLines", "bearings", "shapes3d"]);
export const HUMANITIES = new Set(["timeline", "causeConsequence", "sourceCard", "evaluationScale", "conceptTable", "circularFlow"]);

/** What a structure board draws: a sketch naming two of these on a typed CS lesson becomes one. */
const STRUCTURE_WORDS = /\b(?:graphs?|vert(?:ex|ices)|edges?|nodes?|trees?|bsts?|heaps?|linked lists?|arrays?|queues?|stacks?|hash tables?|states?|transitions?|automat(?:on|a)|dfas?|nfas?)\b/g;
const DATA_STRUCTURE_WORDS = /\b(?:linked list|binary (?:search )?tree|bst|avl|heap|stack|queue|array|hash ?(?:table|map)|node|pointer|vertex|vertices|adjacency|traversal|bfs|dfs|algorithm|data structure|binary search|sorting|sort)\b/i;

export function applyLessonVisualPolicy(
  input: CanvasPlanBeat[],
  options: {
    mode: VisualPolicyMode;
    aiPictures?: boolean;
    /** The lecture's topic: a maths or computer-science lecture never gets a generated picture (owner, 2026-10-20). */
    topic?: string;
    /** A typed lesson's asked subject (lib/canvas/subjectDomain.ts): decides the maths and CS rules below. */
    domain?: SubjectDomain;
    /**
     * The textbook diagram library (lib/figures/library.ts findLibraryFigure), passed in so this
     * policy stays pure: a board's words (and what the syllabus says it must show) → a diagram, or null.
     */
    findAsset?: (text: string, mustShow?: string[]) => NonNullable<CanvasPlanBeat["figureAsset"]> | null;
  },
): { beats: CanvasPlanBeat[]; audit: VisualPolicyAudit } {
  const beats = input.map((beat) => ({ ...beat, requiredVisual: beat.requiredVisual ? { stages: [...beat.requiredVisual.stages], mustShow: [...beat.requiredVisual.mustShow] } : undefined }));
  // The exam-practice board is the lesson's mark scheme (lib/canvas/examBoard.ts): no routing rule
  // may turn it into a diagram ("b6: exam → figure (numberLine)" shipped a demo number line in place
  // of the exam question, audit 2026-10-17). It is put back exactly as planned at the end.
  const examIds = new Set(beats.filter((beat) => beat.stage === "exam").map((beat) => beat.id));
  // A board that redraws a reference page's diagram (lib/canvas/sourceDiagrams.ts), or a message sequence,
  // keeps its stage whatever the rules below decide: the TLS lecture's two handshake boards, matched to
  // Cloudflare's diagram, were turned into a "vector diagram" and then a flow chart (2026-10-24). Put back at the end.
  const keptStages = new Map(beats.filter((beat) => beat.sourceDiagram || beat.stage === "sequence").map((beat) => [beat.id, beat.stage]));
  const changes: string[] = [];
  // A DATA-STRUCTURE BOARD IS FOR DATA STRUCTURES. An essay lesson drew "topic sentence → evidence →
  // because" as a linked list, its words cut to six characters (prompt bench, 2026-10-18): a board that
  // is not about a list, tree, stack, queue, array, graph, hash table or algorithm is a flow of steps.
  // A typed CS lesson's mechanism board (a protocol's servers, a Bloom filter's bits) is a structure even
  // without these words: Raft planned six structure boards and all six became flows (CS test, 2026-10-23).
  const domain = options.mode === "prompt" ? options.domain : undefined;
  const csLessonText = options.mode === "prompt" && (!domain || domain === "cs") ? [options.topic ?? "", ...input.map((b) => b.title)].join(" ") : "";
  for (const beat of beats) {
    const words = `${beat.title} ${beat.brief} ${beat.script}`;
    if (beat.stage !== "structure" || DATA_STRUCTURE_WORDS.test(words) || (csLessonText && csMechanismBoard(csLessonText, words))) continue;
    beat.stage = "flow";
    changes.push(`${beat.id}: structure → flow (not a data structure)`);
  }
  // AI-generated pictures are off unless CANVAS_AI_PICTURES=on (owner, 2026-10-16: "I don't want any
  // vague diagram created by GPT image"): every picture board is drawn by code instead.
  // AI pictures (gpt-image-1-mini) are ON and work alongside the diagrams (owner, 2026-10-17: "a
  // combination of gpt image 1 mini and diagrams"): a picture shows what something looks like; a
  // board whose job is labelling a structure gets an exactly-labelled diagram. CANVAS_AI_PICTURES=off disables them.
  // Generated pictures do not suit maths or computer science (owner, 2026-10-20: "gpt image generated
  // pics won't look good for computer science and mathematics"): those lectures draw everything by code.
  // The subject is read from the lecture itself — the student's words AND the planner's board titles
  // and briefs: a student who typed "pythogaras theorm" still gets a maths lecture (owner, 2026-10-20:
  // "can't see the change locally" — the misspelt topic matched no maths word).
  // Maths is decided by keywords as on the parent branch; only a "cs" answer adds to it (lib/canvas/subjectDomain.ts).
  const labLecture = domain === "cs" || (options.topic !== undefined && isLabLookTopic([options.topic, ...input.map((b) => `${b.title} ${b.brief}`)].join(" ")));
  const aiPictures = labLecture ? false : options.aiPictures ?? !(typeof process !== "undefined" && process.env?.CANVAS_AI_PICTURES === "off");
  // Pictures are generated, checked by a textbook editor and remembered (lib/canvas/textbookDiagram.ts),
  // so a lesson may show up to four; a verified one costs nothing the next time it is used.
  // Up to six checked pictures a lesson (owner, 2026-10-17: "AI generated images would be better").
  const maxIllustrations = !aiPictures || options.mode === "strict" ? 0 : beats.length <= 1 ? 1 : 8;
  const pictureRoom = () => beats.filter((b) => b.stage === "illustration").length < maxIllustrations;

  // A deterministic curriculum contract wins over a model's decorative stage choice.
  for (const beat of beats) {
    const required = firstRequiredStage(beat);
    const genericOnly = beat.requiredVisual && beat.requiredVisual.stages.every((st) => ["compare", "scene", "flow", "illustration"].includes(st));
    if (required && beat.requiredVisual && (!beat.requiredVisual.stages.includes(beat.stage) || (genericOnly && beat.stage !== "illustration" && aiPictures && pictureWorthy(beat)))) {
      // A planner's picture of a cell, organ, plant or animal stands against a contract that only asks
      // for a generic table, scene or flow: the contract's table replaced every picture of a cells
      // lesson (live test, 2026-10-17). A contract naming a specific renderer still wins.
      // The same when the planner did not ask: a fish, forest or food board kept a table where a
      // checked picture teaches (diagram lab, 2026-10-17) — within the lesson's picture budget.
      if (aiPictures && pictureWorthy(beat) && ["compare", "scene", "flow"].includes(required) && (beat.stage === "illustration" || pictureRoom())) {
        if (beat.stage !== "illustration") changes.push(`${beat.id}: ${beat.stage} → illustration (a picture of what it looks like, over a generic ${required} contract)`);
        beat.stage = "illustration";
        beat.requiredVisual.stages = ["illustration", ...beat.requiredVisual.stages];
        continue;
      }
      changes.push(`${beat.id}: ${beat.stage} → ${required} (curriculum visual contract)`);
      beat.stage = required;
    }
  }

  // A picture has no words, so a table, grid or framework drawn as one cannot be read. Abstract
  // content goes to a native comparison board instead (audit 2026-10-15: a "perspective grid").
  for (const beat of beats) {
    if (beat.stage !== "illustration" || PHYSICAL.test(boardText(beat))) continue;
    if (!/\b(grid|table|chart|matrix|columns?|rows?|framework|perspectives?|viewpoints?|criteria|strengths?|limitations?|evaluat\w*|argument|theor(?:y|ies)|concept)\b/i.test(boardText(beat))) continue;
    changes.push(`${beat.id}: illustration → compare (abstract content cannot be a picture)`);
    beat.stage = "compare";
    if (beat.requiredVisual) beat.requiredVisual.stages = ["compare"];
  }

  // A graph needs quantities. "Clarity score against paragraph order" was invented to give a writing
  // lesson a graph (Urdu audit 2026-10-17): a board with no numbers and no measured quantity is a
  // sequence or a structure, so it is drawn as a flow.
  // A bare digit is not a quantity ("Following a nephron" plotted an invented "relative depth",
  // audit 2026-10-17): a number needs a unit, or the board must name what is measured.
  const QUANTITY = /\d+(?:\.\d+)?\s?(%|°|°C|cm|mm|km|kg|mg|ml|kPa|mmHg|mol|ms|min|kJ|J|N|V|Hz|m\/s|g\/|s\b|h\b|m\b|g\b|K\b|units?|degrees?)|\b(rate|per|percent|proportion|increase|decrease|rise|fall|price|cost|revenue|demand|supply|speed|velocity|acceleration|distance|temperature|mass|volume|pressure|concentration|over time|against time|data|measure\w*|function|curve|axis|axes|variable|quantity|population|growth|frequency|probability|gradient|slope|correlation|surplus|deficit|latitude)\b/i;
  for (const beat of beats) {
    if (beat.stage !== "graph" || QUANTITY.test(boardText(beat))) continue;
    if (beat.requiredVisual?.stages.includes("graph")) continue;
    changes.push(`${beat.id}: graph → flow (nothing on the board is a quantity)`);
    beat.stage = "flow";
  }

  // A generated picture has no numbers or symbols: a maths board is never one ("The two square roots"
  // of a complex number was sent to the image model, audit 2026-10-17).
  for (const beat of beats) {
    // "Each root has modulus √r": in maths a root is a solution, not part of a plant.
    if (beat.stage !== "illustration" || PHYSICAL.test(boardText(beat).replace(/\broots?\b/gi, "")) || !(MATHS.test(boardText(beat)) || NON_PICTURE.test(boardText(beat)))) continue;
    if (beat.requiredVisual?.stages.includes("illustration")) continue;
    const routed = nativeStageFor(beat);
    const stage = routed === "illustration" || routed === "scene" ? "equation" : routed;
    changes.push(`${beat.id}: illustration → ${stage} (a maths idea is not a picture)`);
    beat.stage = stage;
  }

  // An atom map is for a REACTION whose atom counts are the idea. "Catalysts speed reactions" drew
  // A×2, B×2 → A×2, B×2, and a physics lesson on the structure of the atom drew "Atom → Helium atom"
  // with "atoms conserved" (audits 2026-10-17). Any other atom-map board gets the diagram its subject
  // has, a picture of a physical structure, or a plain flow.
  for (const beat of beats) {
    if (options.mode === "strict" || beat.stage !== "atom-map" || beat.requiredVisual?.stages.includes("atom-map")) continue;
    const text = boardText(beat);
    // Judged on what Aria says: the planner's brief describes the atom map it already chose.
    const reaction = /\b(conserv\w*|balanc\w*|atom counts?|atoms? (are |is )?(conserved|rearranged)|reactants?|products? of|react(s|ion|ions)?\b|word equation|chemical equation|combust\w*|photosynthesis|respiration|neutrali[sz]\w*|oxidi[sz]\w*|displacement)\b/i.test(beat.script);
    const enzymeBoard = /\b(catalys\w*|enzymes?)\b/i.test(text);
    if (reaction && !enzymeBoard) continue;
    const enzyme = enzymeBoard && /\benzymes?\b/i.test(text) ? figureComponent("enzymeAction") : undefined;
    const component = enzyme ?? figureForBoard(beat);
    if (component) {
      changes.push(`${beat.id}: atom-map → figure (${component.name}; not an atom-conservation board)`);
      beat.stage = "figure";
      beat.figure = component.name;
      beat.objects = labelledFigureParts(component, beat.requiredVisual?.mustShow ?? []);
      if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
    } else if (needsVectorDiagram(text) || PHYSICAL.test(text) || /\b(atoms?|nucle(us|i)|electrons?|protons?|neutrons?|isotopes?)\b/i.test(text) && STRUCTURAL.test(text) || /\bexperiment\b/i.test(text)) {
      const photo = isPhotographicAppearance(text) && aiPictures;
      changes.push(`${beat.id}: atom-map → ${photo ? "illustration" : "diagram"} (not an atom-conservation board)`);
      beat.stage = photo ? "illustration" : "diagram";
      if (beat.requiredVisual) beat.requiredVisual.stages = [beat.stage];
    } else if (isRealProcess(text)) {
      changes.push(`${beat.id}: atom-map → flow (not an atom-conservation board)`);
      beat.stage = "flow";
    } else {
      changes.push(`${beat.id}: atom-map → scene (not an atom-conservation board)`);
      beat.stage = "scene";
    }
  }

  // A board whose subject a code-drawn component draws exactly (lib/figures) becomes a figure board:
  // the titration audited at 3/10 as gear icons on a flow chart is drawn as the apparatus itself.
  // Strict source mode teaches only what the student's pages show, so it never swaps in a stock diagram.
  // THE PLANNER'S CHOICE FIRST. The planner picked this board's diagram from the catalogue before it
  // wrote the script around it; that is honoured when the diagram fits the board's own words — its
  // trigger matches them, or the board's title names the diagram's subject. Keyword routing below is
  // then only a backstop for boards the planner left without a diagram.
  for (const beat of beats) {
    if (options.mode === "strict" || beat.refresher || examIds.has(beat.id) || !beat.plannedFigure || beat.figure) continue;
    const component = figureComponent(beat.plannedFigure);
    if (!component) continue;
    if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.some((st) => st === "figure" || st === beat.stage)) continue;
    const text = boardText(beat);
    const titleWords = (`${beat.title} ${beat.brief}`.toLowerCase().match(/[a-z]{5,}/g) ?? []).map((w) => w.replace(/(es|s)$/, ""));
    // A data graph needs its own trigger in the board's words: a title word shared with its description
    // ("different", "conditions", "against") put the chemistry rate-of-reaction graph on photoelectric
    // and enzyme boards (2026-10-18). A structure may still be matched by its subject in the title.
    // A shared title word counts only when no other diagram's own trigger claims the board: "square"
    // (square-based pyramid) put the 3D-solids cube on "Arranging four triangles inside a square", the
    // Pythagoras rearrangement proof; rejected twice, it shipped as a bare text board (2026-10-21).
    const rival = component.match.test(text) ? undefined : figureForBoard(beat);
    const byTitle = !GRAPH_LIKE.has(component.name) && (!rival || rival.name === component.name) && titleWords.some((w) => component.title.toLowerCase().includes(w));
    const fits = (component.match.test(text) || byTitle) && componentFitsSubject(component.name, text);
    if (!fits) {
      // The planner wanted a diagram here and named the wrong one: the maths kit that draws this
      // board's words takes its place (the Pythagoras proof for the cube above).
      const better = figureForBoard(beat);
      if (better && better.name !== component.name && MATH_KITS.has(better.name) && componentFitsSubject(better.name, text)) {
        changes.push(`${beat.id}: planner's ${component.name} → ${better.name} (it fits the board's words)`);
        beat.stage = "figure";
        beat.figure = better.name;
        beat.objects = labelledFigureParts(better, beat.requiredVisual?.mustShow ?? []);
        if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
        continue;
      }
      changes.push(`${beat.id}: planner's ${component.name} ignored (it does not fit the board's words)`);
      continue;
    }
    changes.push(`${beat.id}: ${beat.stage} → figure (${component.name}, chosen by the planner)`);
    beat.stage = "figure";
    beat.figure = component.name;
    beat.objects = labelledFigureParts(component, beat.requiredVisual?.mustShow ?? []);
    if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
  }

  for (const beat of beats) {
    if (options.mode === "strict" || beat.refresher || examIds.has(beat.id) || beat.stage === "diagram" || (beat.plannedFigure && beat.figure === beat.plannedFigure)) continue;
    const decision = classifyInstructionalTask(beat);
    const decided = decision.figure ? figureComponent(decision.figure) : undefined;
    // On a cell, organ, plant or animal board the task's figure must be what the title or brief is
    // about, not a process its narration mentions (protein synthesis on an animal-cell board).
    const semantic = decided && processKitOffSubject(beat, decided.name) ? undefined : decided;
    // A semantic decision may replace a generic graph/flow because the figure is a stricter form of
    // that representation. Other library figures replace only picture-like stages.
    const component = semantic ?? figureForBoard(beat);
    if (!component || !componentFitsSubject(component.name, boardText(beat))) continue;
    // The function plotter labels roots, asymptotes and "y = f(x)": a biology antibody-response graph
    // drawn by it read "Curve y = Primar(x)", "Root x = 0" (audit 2026-10-17). It draws maths only.
    if (component.name === "functionGraph" && !/\bf\s*\(\s*x\s*\)|\bfunctions?\b|\by\s*=|\bequations?\b|\broots?\b|\basymptotes?\b|\bturning points?\b|\bpolynomials?\b|\bquadratics?\b|\bgradient\b/i.test(boardText(beat))) continue;
    // Algebraic calculus rules and numerical integration are not sketches of y = f(x).
    if (component.name === "functionGraph" && /\b(trapezium|trapezoid|riemann|product rule|quotient rule|chain rule|parametric differentiat|implicit differentiat)\b/i.test(boardText(beat)) && !/\bturning points?|stationary points?\b/i.test(boardText(beat))) continue;
    // "A transformation chain" of an integrand is not a geometric object/image on a grid.
    if (component.name === "coordinateGrid" && /\b(integrat\w*|double[- ]angle|trig(onometric)? identit)\b/i.test(boardText(beat)) && !/\b(reflect|rotat|enlarg|mirror line|scale factor|column vector)\b/i.test(boardText(beat))) continue;
    // A computed chart replaces a generic graph, comparison or equation board — it is the stricter form
    // of the same thing (a supply-shift board planned as "graph" never got the supply–demand diagram,
    // audit 2026-10-17). Humanities visuals may replace a comparison. Pictures of things replace only
    // picture-like boards.
    const replaces = GRAPH_LIKE.has(component.name) ? ["illustration", "scene", "flow", "graph", "compare", "equation"]
      : HUMANITIES.has(component.name) ? ["illustration", "scene", "flow", "compare"]
      : ["illustration", "scene", "flow"];
    // Maths figures whose shapes move with the narration (MOTION_MATHS) carry the algebra themselves:
    // one replaces an equation or comparison board whose title asks for the picture ("Completing the
    // square as an area") or whose narration describes it (two or more of its parts named).
    if (MOTION_MATHS.has(component.name) && (component.match.test(`${beat.title} ${beat.brief}`) || partsNamed(beat, component) >= 2)) replaces.push("equation", "compare");
    // (see below for atom maps that no component title names)
    // An atom-count board that is not about conserving atoms ("catalysts speed reactions" drew A×2,
    // B×2 → A×2, B×2; audit 2026-10-17) gives way to the diagram its subject has.
    if (beat.stage === "atom-map" && !/\b(conserv\w*|balanc\w*|atom counts?|atoms? (are |is )?(conserved|rearranged)|law of conservation)\b/i.test(boardText(beat)) && !beat.requiredVisual?.stages.includes("atom-map")) replaces.push("atom-map");
    if (!semantic && !replaces.includes(beat.stage)) continue;
    changes.push(`${beat.id}: ${beat.stage} → figure (${component.name}, drawn by code)`);
    beat.stage = "figure";
    beat.figure = component.name;
    beat.objects = labelledFigureParts(component, [...(decision.requiredParts ?? []), ...(beat.requiredVisual?.mustShow ?? [])]);
    if (beat.requiredVisual) {
      beat.requiredVisual.stages = ["figure"];
      if (decision.requiredParts?.length) beat.requiredVisual.mustShow = [...new Set([...beat.requiredVisual.mustShow, ...decision.requiredParts])];
    }
  }
  // A picture board — or a board that would otherwise be a plain scene — whose subject the library
  // has a real textbook diagram for shows that diagram, its parts labelled exactly (lib/figures/library.ts).
  // Strict source mode teaches only from the student's own pages, so it never adds one.
  if (options.findAsset && options.mode !== "strict") {
    for (const beat of beats) {
      if (beat.refresher || beat.stage === "figure") continue;
      if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.some((st) => st === "illustration" || st === "scene" || st === "figure")) continue;
      // The wired cell and the free-body diagram have renderers of their own.
      if (isElectrolyticCellBeat(beat) || isFreeBodyBeat(beat)) continue;
      const plainScene = beat.stage === "scene" && nativeStageFor(beat) === "scene";
      if (beat.stage !== "illustration" && !plainScene) continue;
      // Like a code-drawn diagram, a textbook picture is chosen by what the board is ABOUT (its title
      // and brief): "Egg-cell structure" was given a neuron because its narration said "cell" and
      // "nucleus" (audit 2026-10-17).
      const about = `${beat.title} ${beat.brief}`;
      let asset = options.findAsset(about, beat.requiredVisual?.mustShow ?? []);
      if (!asset) {
        // Found only in the narration: accepted when the picture's own title names what the board is
        // about ("Eye diagram" for "The human eye"), never on a generic word ("cell", "diagram").
        const fromScript = options.findAsset(boardText(beat), beat.requiredVisual?.mustShow ?? []);
        const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{3,}/g) ?? []).map((w) => w.replace(/s$/, "")).filter((w) => !GENERIC_PICTURE_WORDS.has(w)));
        const named = fromScript ? [...words(fromScript.id.replace(/-/g, " "))].some((w) => words(about).has(w)) : false;
        if (fromScript && named) asset = fromScript;
      }
      if (!asset) continue;
      // One textbook picture once per lesson: the same respiratory-system picture on three boards in a
      // row taught breathing mechanics with a static body outline (audit 2026-10-17). A later board on
      // the same subject gets its own visual (a described diagram of what it teaches).
      if (beats.some((other) => other !== beat && other.figureAsset?.id === asset.id)) {
        changes.push(`${beat.id}: library diagram ${asset.id} already used earlier in this lesson`);
        continue;
      }
      changes.push(`${beat.id}: ${beat.stage} → figure (library diagram ${asset.id})`);
      beat.stage = "figure";
      beat.figure = "library";
      beat.figureAsset = asset;
      // The parts the board says first, then the rest — what the board writer may label.
      const text = boardText(beat).toLowerCase();
      const said = asset.parts.filter((p) => text.includes(p.name.toLowerCase().replace(/\s*\(.*\)$/, "")));
      beat.objects = [...new Set([...said, ...asset.parts].map((p) => p.id))].slice(0, 6);
      if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
    }
  }

  // A board whose idea has a visual form — a map, a count, a labelled model, data — and no kit or
  // library diagram gets a generated VECTOR diagram (lib/diagrams). Photographs are only for what a
  // thing looks like. Strict source mode never invents one.
  if (options.mode !== "strict") {
    for (const beat of beats) {
      if (beat.refresher || beat.stage === "figure" || beat.stage === "diagram" || beat.stage === "exam") continue;
      if (["graph", "equation", "molecule", "atom-map", "code", "structure"].includes(beat.stage)) continue;
      if (isElectrolyticCellBeat(beat) || isFreeBodyBeat(beat)) continue;
      const text = boardText(beat);
      const native = nativeStageFor(beat);
      if (["graph", "equation", "molecule", "atom-map", "code"].includes(native)) continue;
      if (isPhotographicAppearance(text)) continue;
      // A cycle (Krebs, Calvin, carbon, nitrogen, cell cycle) is drawn as a loop of cards, a flow: the
      // scene grammar drew the Krebs cycle as overlapping ellipses with doubled labels (live test, 2026-10-17).
      if (CYCLE_BOARD.test(`${beat.title} ${beat.brief}`) && !/\b(maps?|graphs?|data)\b/i.test(`${beat.title} ${beat.brief}`)) {
        if (beat.stage !== "flow") { changes.push(`${beat.id}: ${beat.stage} → flow (a cycle is a loop of steps)`); beat.stage = "flow"; if (beat.requiredVisual) beat.requiredVisual.stages = ["flow"]; }
        continue;
      }
      if (!needsVectorDiagram(text) && !hasVisualForm(text)) continue;
      // An organ, cell, plant, animal, apparatus, landscape or building is a picture rather than a
      // generic vector diagram (owner, 2026-10-17), within the lesson's picture budget.
      if (pictureWorthy(beat) && aiPictures && (beat.stage === "illustration" || pictureRoom())) {
        if (beat.stage !== "illustration") changes.push(`${beat.id}: ${beat.stage} → illustration (a picture of what it looks like)`);
        beat.stage = "illustration";
        if (beat.requiredVisual) beat.requiredVisual.stages = ["illustration"];
        continue;
      }
      if (beat.stage === "flow" && isRealProcess(text) && !needsVectorDiagram(text)) continue;
      if (beat.stage === "compare" && !needsVectorDiagram(text)) continue;
      if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.some((st) => st === "illustration" || st === "scene" || st === "figure" || st === "diagram" || st === beat.stage)) continue;
      changes.push(`${beat.id}: ${beat.stage} → diagram (vector textbook diagram)`);
      beat.stage = "diagram";
      beat.figure = undefined;
      if (beat.requiredVisual) beat.requiredVisual.stages = ["diagram"];
    }
  }

  // Every other physical subject — no component, no library, no vector diagram — whose appearance
  // matters is a generated photograph. Labelled structures already became diagrams above.
  if (options.mode !== "strict") {
    for (const beat of beats) {
      if (beat.refresher || beat.stage === "figure" || beat.stage === "diagram") continue;
      const physical = PHYSICAL.test(boardText(beat)) || pictureNeedScore(beat) >= 3;
      const pictureLike = beat.stage === "illustration" || (beat.stage === "scene" && nativeStageFor(beat) === "scene");
      if (!physical || !pictureLike) continue;
      if (isElectrolyticCellBeat(beat) || isFreeBodyBeat(beat)) continue;
      if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.some((st) => st === "illustration" || st === "scene" || st === "figure" || st === "diagram")) continue;
      if (needsVectorDiagram(boardText(beat)) && !isPhotographicAppearance(boardText(beat)) && !(pictureBoard(beat) && aiPictures)) {
        changes.push(`${beat.id}: ${beat.stage} → diagram (labelled structure, not a photograph)`);
        beat.stage = "diagram";
        if (beat.requiredVisual) beat.requiredVisual.stages = ["diagram"];
        continue;
      }
      if (aiPictures) {
        if (beat.stage !== "illustration" && pictureRoom()) {
          changes.push(`${beat.id}: ${beat.stage} → illustration (generated textbook diagram)`);
          beat.stage = "illustration";
          if (beat.requiredVisual) beat.requiredVisual.stages = ["illustration"];
        }
        continue;
      }
      changes.push(`${beat.id}: ${beat.stage} → diagram (vector textbook diagram)`);
      beat.stage = "diagram";
      if (beat.requiredVisual) beat.requiredVisual.stages = ["diagram"];
    }
  }

  if (!aiPictures) {
    for (const beat of beats) {
      if (beat.stage !== "illustration") continue;
      const routed = nativeStageFor(beat);
      changes.push(`${beat.id}: illustration → ${routed} (AI pictures are off)`);
      beat.stage = routed;
      if (beat.requiredVisual) beat.requiredVisual.stages = [routed];
    }
  }

  // Strict source mode may clean and annotate supplied figures, but it must not generate a new
  // factual picture. Until a source figure is attached to the canvas, use a grounded native board.
  if (options.mode === "strict") {
    for (const beat of beats) {
      if (beat.stage !== "illustration") continue;
      const replacement = nativeStageFor(beat);
      // A kit figure would invent a diagram the source page did not supply.
      beat.stage = replacement === "scene" || replacement === "figure" || replacement === "illustration" ? "scene" : replacement;
      if (beat.requiredVisual?.stages.includes("illustration")) beat.requiredVisual.stages = [beat.stage];
      changes.push(`${beat.id}: illustration → ${beat.stage} (strict source mode)`);
    }
  }

  // If a course/reference lesson teaches a physical structure, ensure at least one real textbook
  // illustration. Never replace a board whose curriculum contract requires a different renderer,
  // and never overwrite a vector diagram, graph, or other purpose-built visual (a three-cell model
  // became a generated picture because this pass ignored "diagram").
  const KEEP_FROM_PICTURE = new Set(["figure", "diagram", "graph", "equation", "molecule", "atom-map", "code", "exam", "structure"]);
  if (maxIllustrations > 0 && !beats.some((beat) => beat.stage === "illustration")) {
    const candidate = beats
      .filter((beat) => !KEEP_FROM_PICTURE.has(beat.stage) && (!beat.requiredVisual?.stages.length || beat.requiredVisual.stages.includes("illustration") || beat.requiredVisual.stages.includes("scene")))
      .map((beat) => ({ beat, score: pictureNeedScore(beat) }))
      .sort((a, b) => b.score - a.score)[0];
    // A board that labels a structure is a diagram now; the guaranteed picture is a "what it looks like" board.
    const text = candidate ? boardText(candidate.beat) : "";
    if (candidate && candidate.score >= 3 && !STRUCTURAL.test(text) && !needsVectorDiagram(text) && !hasVisualForm(text) && photographic(candidate.beat)) {
      changes.push(`${candidate.beat.id}: ${candidate.beat.stage} → illustration (physical structure needs a textbook view)`);
      candidate.beat.stage = "illustration";
      if (candidate.beat.requiredVisual?.stages.includes("scene")) candidate.beat.requiredVisual.stages = ["illustration"];
    }
  }

  // Keep the strongest pictures. A third picture is allowed only when a distinct syllabus
  // contract explicitly requires it; this is the exception for anatomy-heavy lessons.
  const pictures = beats.filter((beat) => beat.stage === "illustration");
  const protectedIds = new Set(pictures.filter((beat) => beat.requiredVisual?.stages.includes("illustration")).map((beat) => beat.id));
  const keep = new Set(
    pictures
      .sort((a, b) => Number(protectedIds.has(b.id)) - Number(protectedIds.has(a.id)) || pictureNeedScore(b) - pictureNeedScore(a))
      .slice(0, Math.max(maxIllustrations, protectedIds.size))
      .map((beat) => beat.id),
  );
  for (const beat of pictures) {
    if (keep.has(beat.id)) continue;
    // Over the picture budget, a physical subject is drawn as a described diagram only when pictures
    // are off; with pictures on it becomes a plain board (never the writer's blobs).
    if (!aiPictures && options.mode !== "strict" && (PHYSICAL.test(boardText(beat)) || pictureNeedScore(beat) >= 3)) {
      beat.stage = "diagram";
      if (beat.requiredVisual) beat.requiredVisual.stages = ["diagram"];
      changes.push(`${beat.id}: illustration → diagram (lesson picture budget)`);
      continue;
    }
    const replacement = nativeStageFor(beat);
    beat.stage = replacement === "illustration" ? "scene" : replacement;
    changes.push(`${beat.id}: illustration → ${beat.stage} (lesson picture budget)`);
  }

  // The first board about the electrolytic cell is drawn by the wired-cell renderer, unless its
  // curriculum contract asks for a different kind of board.
  const apparatus = new Set<string>();
  const cell = beats.find((beat) => !beat.refresher && isElectrolyticCellBeat(beat) && (!beat.requiredVisual?.stages.length || beat.requiredVisual.stages.some((st) => st === "scene" || st === "illustration")));
  if (cell) {
    if (cell.stage !== "scene") changes.push(`${cell.id}: ${cell.stage} → scene (wired electrolytic cell)`);
    cell.stage = "scene";
    if (cell.requiredVisual) cell.requiredVisual.stages = ["scene"];
    cell.objects = [...new Set([...ELECTROLYTIC_CELL_OBJECTS, ...cell.objects])].slice(0, 6);
    apparatus.add(cell.id);
  }

  // The first board about the forces on an object is a free-body diagram.
  const forces = beats.find((beat) => !beat.refresher && !apparatus.has(beat.id) && isFreeBodyBeat(beat) && (!beat.requiredVisual?.stages.length || beat.requiredVisual.stages.some((st) => st === "scene" || st === "illustration")));
  if (forces) {
    if (forces.stage !== "scene") changes.push(`${forces.id}: ${forces.stage} → scene (free-body diagram)`);
    forces.stage = "scene";
    if (forces.requiredVisual) forces.requiredVisual.stages = ["scene"];
    forces.objects = [...new Set(["body", ...forces.objects])].slice(0, 6);
    apparatus.add(forces.id);
  }

  // Replace generic card-like scenes when the content clearly names a purpose-built renderer.
  // Strict source mode keeps the scene: a kit figure would invent a diagram the page did not show.
  for (const beat of beats) {
    if (options.mode === "strict" || beat.stage !== "scene" || apparatus.has(beat.id)) continue;
    const routed = nativeStageFor(beat);
    if (routed === "scene") continue;
    if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.includes(routed)) continue;
    beat.stage = routed;
    changes.push(`${beat.id}: scene → ${routed} (purpose-built visual renderer)`);
  }

  // A calculation taught as a flow chart drew three empty circles ("Frequency table → Mean formula →
  // Variance formula", audit 2026-10-17): a board that works numbers through a formula is an equation.
  for (const beat of beats) {
    if (options.mode === "strict" || beat.stage !== "flow" || beat.refresher) continue;
    const text = boardText(beat);
    if (nativeStageFor(beat) !== "equation" || !/\d/.test(beat.script) || !/\b(formula|calculat\w*|substitut\w*|work(ed)? out|mean|variance|standard deviation|σ|Σ)\b|=/i.test(text)) continue;
    if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.includes("equation")) continue;
    beat.stage = "equation";
    changes.push(`${beat.id}: flow → equation (a calculation is worked, not drawn as boxes)`);
  }

  // EVERY LESSON GETS A VISUAL. A lesson whose boards all came out as text — comparisons, flows,
  // scenes — has its best-suited board drawn as one (owner, 2026-10-17: "every lesson covered"): a
  // timeline for dated history, a cause map for causal accounts, a balance for evaluation, a source
  // card for sources, a described diagram for a physical subject, else a real table or cause map.
  // Worked equations and executable code are purpose-built visuals of their own.
  const DIAGRAM_STAGES = new Set(["figure", "illustration", "graph", "molecule", "atom-map", "equation", "code", "diagram"]);
  if (options.mode !== "strict" && beats.length && !beats.some((beat) => DIAGRAM_STAGES.has(beat.stage) || apparatus.has(beat.id))) {
    const candidates = beats.filter((beat) => !beat.refresher && !beat.overview && ["compare", "flow", "scene"].includes(beat.stage));
    const pick = (test: (beat: CanvasPlanBeat) => boolean) => candidates.find(test);
    const choose: Array<[CanvasPlanBeat | undefined, string]> = [
      [pick((beat) => datedSequence(boardText(beat))), "timeline"],
      [pick((beat) => /\b(led to|leading to|caused?|causes|resulted in|consequences?|effects? of|sparked|triggered|why did)\b/i.test(boardText(beat))), "causeConsequence"],
      [pick((beat) => /\b(evaluat\w*|assess\w*|to what extent|how far|judge\w*|argue\w*|for and against|advantages and disadvantages|strengths and (weaknesses|limitations))\b/i.test(boardText(beat)) && !/\b(integral|integrat|derivative|differentiat|limit|algebra|quadratic|complet\w* the square)\b/i.test(boardText(beat))), "evaluationScale"],
      [pick((beat) => /\b(source|speech|letter|diary|cartoon|extract|document|propaganda|poster|account by)\b/i.test(boardText(beat))), "sourceCard"],
      // Geometry and mechanics are drawn (a collision, a circle theorem), never tabled.
      [pick((beat) => isGeometryOrMechanics(boardText(beat)) && !ESSAY_BOARD.test(boardText(beat))), "diagram"],
      [pick((beat) => PHYSICAL.test(boardText(beat)) && !NON_PICTURE.test(boardText(beat)) && (isPhotographicAppearance(boardText(beat)) || pictureBoard(beat))), aiPictures ? "picture" : "diagram"],
      [pick((beat) => PHYSICAL.test(boardText(beat)) && !NON_PICTURE.test(boardText(beat))), "diagram"],
      [candidates.find((beat) => beat.stage === "compare"), "conceptTable"],
      [candidates.find((beat) => beat.stage === "flow"), "causeConsequence"],
      // Last resort — a plain scene (vocabulary, grammar, definitions) becomes a real table.
      [candidates.find((beat) => beat.stage === "scene"), "conceptTable"],
    ];
    const [beat, figure] = choose.find(([b]) => b) ?? [undefined, ""];
    if (beat && figure === "picture") {
      changes.push(`${beat.id}: ${beat.stage} → illustration (generated textbook diagram; the lesson had no visual)`);
      beat.stage = "illustration";
      if (beat.requiredVisual) beat.requiredVisual.stages = ["illustration"];
    } else if (beat && figure === "diagram") {
      changes.push(`${beat.id}: ${beat.stage} → diagram (vector textbook diagram; the lesson had no visual)`);
      beat.stage = "diagram";
      if (beat.requiredVisual) beat.requiredVisual.stages = ["diagram"];
    } else if (beat) {
      changes.push(`${beat.id}: ${beat.stage} → figure (${figure}; the lesson had no visual)`);
      beat.stage = "figure";
      beat.figure = figure;
      if (figure !== "drawn") {
        const component = figureComponent(figure);
        if (component) beat.objects = component.parts.slice(0, 6).map((p) => p.id);
      }
      if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
    }
  }

  // MOST BOARDS ARE DIAGRAMS. One visual per lesson still left lessons of tables: 12 of 17 boards in
  // the 2026-10-16 audit were comparison tables, scored 2–5 for diagrams. Text boards are drawn as the
  // diagram that fits them until two boards in three are diagrams. Each choice must fit the board's
  // own words; a board nothing fits stays as it is, and one comparison table is kept when the lesson
  // has one — contrast point by point can be the idea.
  if (options.mode !== "strict") {
    const teaching = beats.filter((beat) => !beat.refresher && !beat.overview);
    // A flow the visual choice asked for (a cycle, a pathway) IS the diagram that board needs.
    const isDiagram = (beat: CanvasPlanBeat) => DIAGRAM_STAGES.has(beat.stage) || apparatus.has(beat.id) || (beat.stage === "flow" && beat.visualType === "diagram");
    const target = Math.ceil(teaching.length * (2 / 3));
    const contractAllows = (beat: CanvasPlanBeat) => !beat.requiredVisual?.stages.length || beat.requiredVisual.stages.some((st) => st === "figure" || st === "illustration" || st === "scene" || st === beat.stage);
    const fits = (beat: CanvasPlanBeat): string | null => {
      const text = boardText(beat);
      // A cycle stays its loop of steps (see CYCLE_BOARD above).
      if (CYCLE_BOARD.test(`${beat.title} ${beat.brief}`) && beat.stage === "flow") return null;
      if (datedSequence(text)) return "timeline";
      const component = figureForBoard(beat);
      if (component && !HUMANITIES.has(component.name) && componentFitsSubject(component.name, text)) return component.name;
      // A collision, a construction, a field: a vector diagram (lib/diagrams/grammarKinds.ts), not a table.
      if (isGeometryOrMechanics(text) && !ESSAY_BOARD.test(text)) return "diagram";
      // Essay templates only where the subject is an essay subject (lib/diagrams/visualForm.ts componentFitsSubject).
      const essayOk = componentFitsSubject("causeConsequence", text);
      if (/\b(advantages?|disadvantages?|benefits? and (drawbacks?|costs?)|pros and cons|strengths?|weakness(es)?|limitations?|for and against|evaluat\w*|to what extent|how far|weigh(?:s|ed|ing)?\b|benefits? (and|versus|vs\.?|against) (risks?|concerns?|harms?|costs?)|(risks?|costs?|harms?) (and|versus|against) benefits?|ethical (concerns?|choices?|dilemmas?)|(is|be) (it |this )?(ethically )?acceptable)\b/i.test(text) && !/\b(integral|integrat|derivative|differentiat|limit|algebra|quadratic|complet\w* the square)\b/i.test(text) && essayOk) return "evaluationScale";
      if (/\b(speech|letter|diary|cartoon|extract|propaganda|poster|account by|primary source|hadith|verse|surah)\b/i.test(text) && essayOk) return "sourceCard";
      if (/\b(led to|leading to|causes?d?|resulted in|consequences?|effects? of|sparked|triggered|why did|because of)\b/i.test(text) && beat.stage !== "compare" && !needsVectorDiagram(text) && essayOk) return "causeConsequence";
      // A picture subject is a picture before it is a generic vector diagram (owner, 2026-10-17).
      // Only a board the visual choice called a "thing" becomes a picture here: a comparison of two
      // pathways was sent to the image model to fill the quota (Krebs lecture, 2026-10-18).
      const mayPicture = !beat.visualType || beat.visualType === "thing";
      if (mayPicture && pictureWorthy(beat) && aiPictures && pictureRoom() && !NON_PICTURE.test(beat.title)) return "picture";
      if (needsVectorDiagram(text) || hasVisualForm(text)) return "diagram";
      if (mayPicture && PHYSICAL.test(text) && !NON_PICTURE.test(text) && (isPhotographicAppearance(text) || pictureBoard(beat))) return aiPictures ? (pictureRoom() ? "picture" : null) : "diagram";
      return null;
    };
    let diagrams = teaching.filter(isDiagram).length;
    // Comparisons first (the weakest visual), then plain scenes, then flows.
    const order = ["compare", "scene", "flow"];
    const candidates = teaching.filter((beat) => order.includes(beat.stage) && !apparatus.has(beat.id) && contractAllows(beat)).sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
    for (const beat of candidates) {
      if (diagrams >= target) break;
      const figure = fits(beat);
      if (!figure) continue;
      // One of each essay diagram per lesson: three evaluation balances in one geography lesson (on
      // "Measuring development", "How globalisation works" and a case study) read as one template
      // stamped on every board (audit 2026-10-17). A board whose own subject a diagram draws is exempt.
      if (HUMANITIES.has(figure) && beats.some((other) => other !== beat && other.figure === figure)) continue;
      if (figure === "picture") {
        changes.push(`${beat.id}: ${beat.stage} → illustration (generated textbook diagram; two boards in three are diagrams)`);
        beat.stage = "illustration";
        if (beat.requiredVisual) beat.requiredVisual.stages = ["illustration"];
        diagrams++;
        continue;
      }
      if (figure === "diagram") {
        changes.push(`${beat.id}: ${beat.stage} → diagram (vector textbook diagram; two boards in three are diagrams)`);
        beat.stage = "diagram";
        beat.figure = undefined;
        if (beat.requiredVisual) beat.requiredVisual.stages = ["diagram"];
        diagrams++;
        continue;
      }
      changes.push(`${beat.id}: ${beat.stage} → figure (${figure}; two boards in three are diagrams)`);
      beat.stage = "figure";
      beat.figure = figure;
      if (figure !== "drawn") {
        const component = figureComponent(figure);
        if (component) beat.objects = component.parts.slice(0, 6).map((p) => p.id);
      }
      if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
      diagrams++;
    }
  }

  // ONE STRUCTURAL DIAGRAM, ONE BOARD. A leaf lesson drew the same leaf section on all three of its
  // boards (audit 2026-10-17): the student saw one picture three times. A structure is drawn once,
  // on the board whose own title is about it; every other board on the same thing shows its own
  // focus — a generated textbook picture (the whole leaf, a close-up, the apparatus in use) when it
  // is a physical thing, else the visual its content calls for. Graphs and essay diagrams may
  // repeat with different data (a second supply-and-demand diagram showing a shift is normal).
  if (options.mode !== "strict") {
    const keyOf = (beat: CanvasPlanBeat) => (beat.stage !== "figure" || !beat.figure || beat.figure === "drawn" ? null : beat.figure === "library" ? (beat.figureAsset ? `library:${beat.figureAsset.id}` : null) : beat.figure);
    const groups = new Map<string, typeof beats>();
    for (const beat of beats) {
      const key = keyOf(beat);
      // Diagrams whose content changes with the board (which stage of division, which set) may repeat.
      if (!key || GRAPH_LIKE.has(key) || HUMANITIES.has(key) || REPEATABLE.has(key) || beat.refresher) continue;
      groups.set(key, [...(groups.get(key) ?? []), beat]);
    }
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      // The board that is most about the structure keeps it: its title names it, then the most
      // parts its syllabus contract asks to be labelled, then the earliest.
      // The board that names the most of the diagram's parts is the one that labels it.
      const parts = key.startsWith("library:") ? (list[0].figureAsset?.parts ?? []) : (figureComponent(key)?.parts ?? []);
      const fit = (beat: (typeof beats)[number]) => parts.filter((p) => namedIn(beat.script, p.name)).length * 2 + (figureFor(beat.title)?.name === key ? 3 : 0) + (/\b(label|identify|structure|parts?|tissues?|layers?|cross[- ]section)\b/i.test(beat.title) ? 2 : 0);
      const keep = [...list].sort((a, b) => fit(b) - fit(a) || beats.indexOf(a) - beats.indexOf(b))[0];
      // THE FIGURE COMES BACK, ZOOMED (owner, 2026-10-18: more visuals): up to two more boards show it
      // again when each teaches parts the earlier ones did not — labelled and zoomed to those parts,
      // never the same picture three times (the leaf audit above).
      const reused = new Set<CanvasPlanBeat>();
      const seen = new Set(parts.filter((p) => namedIn(keep.script, p.name)).map((p) => p.id));
      for (const beat of list) {
        if (beat === keep || reused.size >= 2) continue;
        const own = parts.filter((p) => namedIn(beat.script, p.name));
        const fresh = own.filter((p) => !seen.has(p.id));
        if (!fresh.length) continue;
        reused.add(beat);
        for (const p of own) seen.add(p.id);
        beat.objects = own.map((p) => p.id).slice(0, 6);
        beat.brief = `${beat.brief} This board shows the ${key.replace(/^library:/, "")} figure again (first drawn on ${keep.id}): label only the parts THIS board teaches (${fresh.map((p) => p.name).join(", ")}) and zoom to the first of them as it is named.`.trim();
        changes.push(`${beat.id}: ${key} again, zoomed to ${fresh.map((p) => p.name).join(", ")} (first drawn on ${keep.id})`);
      }
      for (const beat of list) {
        if (beat === keep || reused.has(beat)) continue;
        const text = boardText(beat);
        beat.figure = undefined;
        beat.figureAsset = undefined;
        beat.objects = [];
        // Its syllabus labels are drawn on the board that keeps the diagram.
        beat.requiredVisual = undefined;
        if (aiPictures && pictureRoom() && PHYSICAL.test(text) && !MATHS.test(text) && !needsVectorDiagram(text)) {
          beat.stage = "illustration";
          changes.push(`${beat.id}: figure → illustration (${key} is drawn on ${keep.id}; this board shows its own picture)`);
        } else if (needsVectorDiagram(text) || hasVisualForm(text)) {
          beat.stage = "diagram";
          changes.push(`${beat.id}: figure → diagram (${key} is drawn on ${keep.id}; this board has its own vector diagram)`);
        } else {
          const routed = nativeStageFor(beat);
          beat.stage = routed === "figure" || routed === "illustration" || routed === "flow" ? (isRealProcess(text) ? "flow" : "scene") : routed;
          changes.push(`${beat.id}: figure → ${beat.stage} (${key} is drawn on ${keep.id})`);
        }
      }
    }
  }

  // Icon-flow only for a real step-by-step process. Anything else that was left as a chain of
  // icons is a labelled scene, or a vector diagram when the idea has a visual form.
  if (options.mode !== "strict") {
    for (const beat of beats) {
      if (beat.stage !== "flow" || beat.refresher || examIds.has(beat.id)) continue;
      const text = boardText(beat);
      if (isRealProcess(text) && !needsVectorDiagram(text)) continue;
      if (needsVectorDiagram(text) || hasVisualForm(text)) {
        changes.push(`${beat.id}: flow → diagram (not a process — a vector diagram)`);
        beat.stage = "diagram";
        if (beat.requiredVisual) beat.requiredVisual.stages = ["diagram"];
      } else {
        changes.push(`${beat.id}: flow → scene (not a step-by-step process)`);
        beat.stage = "scene";
      }
    }
  }

  // VECTOR DIAGRAMS BY DEFAULT (lib/diagrams/). A generated picture shows what a real thing LOOKS
  // like — an organism, a landform, a building; it cannot get a structure's layers, a map's currents,
  // a graph's data or an exact count right (8 of 10 picture requests were rejected, audit 2026-10-17).
  // Every other picture board, and every board whose idea is a map, a cross-section, a circulation or
  // data, is drawn as a vector diagram: real coastlines, plotted numbers, exact counts, checked by code
  // and by eye. Maths and essay boards keep their own visuals; a syllabus contract wins.
  // The coordinate grammar is FIRST for maps, data, geometry and mechanics: a board an earlier pass
  // sent to the scene grammar ("diagram") with one of those forms is drawn by it, and the scene
  // grammar, a code figure or a plain board is the automatic fallback when it cannot pass
  // (lib/canvas/generate.ts plainBeat). Geometry and mechanics boards are vector diagrams even though
  // they are maths: the rule "maths is never a picture" is about generated pictures. A momentum
  // lesson drew no trolleys and a circle-theorems board no circle (QA 2026-10-17).
  if (options.mode !== "strict" && VECTOR_DIAGRAMS()) {
    for (const beat of beats) {
      if (beat.refresher || beat.overview || examIds.has(beat.id) || apparatus.has(beat.id)) continue;
      const text = boardText(beat);
      const shaped = isGeometryOrMechanics(text);
      // Exact geometry named by the board itself (title and brief), not a word in passing in its narration.
      const form = VECTOR_FORM.test(`${beat.title} ${beat.brief}`) || isGeometryOrMechanics(`${beat.title} ${beat.brief}`);
      if (beat.stage === "illustration") {
        // A life-science picture stays a picture: the vector diagram drew "Where nutrients enter the
        // body" as blobs and boxes, while the checked picture of the same subject was a clean
        // textbook drawing at $0.015 (owner, 2026-10-17: "vector images are too pathetic").
        // A picture stays a picture unless its board is exact geometry (a map, data, a construction).
        if (beat.requiredVisual?.stages.includes("illustration") || photographic(beat) || !(VECTOR_FORM.test(`${beat.title} ${beat.brief}`) || isGeometryOrMechanics(`${beat.title} ${beat.brief}`))) continue;
        changes.push(`${beat.id}: illustration → figure (vector diagram; a picture cannot draw ${VECTOR_FORM.test(text) ? "a map, section or data" : shaped ? "geometry or mechanics" : "a labelled structure"} exactly)`);
      } else if (["scene", "flow", "compare", "diagram"].includes(beat.stage) && form && (shaped || !MATHS.test(text)) && !ESSAY_BOARD.test(text)
        && !(LIFE_SCIENCE.test(`${beat.title} ${beat.brief}`) && !VECTOR_FORM.test(`${beat.title} ${beat.brief}`) && !isGeometryOrMechanics(`${beat.title} ${beat.brief}`))
        && (!beat.requiredVisual?.stages.length || beat.requiredVisual.stages.some((st) => st === "figure" || st === "illustration" || st === "scene" || st === "diagram"))) {
        // A geometry kit that draws this construction exactly (a circle theorem) beats a described one.
        const kit = figureForBoard(beat);
        if (kit && REPEATABLE.has(kit.name) && MATH_KITS.has(kit.name) && componentFitsSubject(kit.name, text)) {
          changes.push(`${beat.id}: ${beat.stage} → figure (${kit.name}, drawn by code)`);
          Object.assign(beat, { stage: "figure", figure: kit.name, figureAsset: undefined, objects: labelledFigureParts(kit, beat.requiredVisual?.mustShow ?? []) });
          if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
          continue;
        }
        changes.push(`${beat.id}: ${beat.stage} → figure (vector diagram: ${(text.match(VECTOR_FORM) ?? text.match(GEOMETRY_FORM) ?? text.match(MECHANICS_FORM))![0]})`);
      } else continue;
      beat.stage = "figure";
      beat.figure = "drawn";
      beat.figureAsset = undefined;
      if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
    }
  }

  for (const beat of beats) {
    if (!examIds.has(beat.id) || beat.stage === "exam") continue;
    changes.push(`${beat.id}: kept as the exam board (a routing rule had made it ${beat.stage})`);
    Object.assign(beat, { stage: "exam", figure: undefined, figureAsset: undefined, objects: [], requiredVisual: undefined });
  }

  // THE SCENE-GRAMMAR DIAGRAM IS RETIRED (owner, 2026-10-17). Every messy board of a day of live tests
  // and diagram-lab runs — the Krebs cycle, the plant cell, tropisms, HIV, deamination, enzyme action —
  // was a stage "diagram". A board still headed there becomes a checked picture (a thing), a clean flow
  // (a process), or the coordinate vector diagram (maps, data, structures, geometry and mechanics).
  // FREE-FORM VECTOR AND SCENE DIAGRAMS ARE RETIRED (owner, 2026-10-17: "retire this and use AI
  // generated image"). They drew boxes, blobs and box chains with labels on empty space. Any board still
  // headed to one — a scene-grammar "diagram", or a described "drawn" figure that is not exact geometry
  // (a map, a data plot, a construction, a mechanics set-up) — becomes a checked AI picture, or, when it
  // cannot be one (maths, a chart, the picture budget is spent), a clean flow or set of cards.
  // General by design: no subject lists decide it.
  for (const beat of beats) {
    const tb = `${beat.title} ${beat.brief}`;
    const exact = VECTOR_FORM.test(tb) || isGeometryOrMechanics(tb);
    const freeForm = beat.stage === "diagram" || (beat.stage === "figure" && beat.figure === "drawn" && !exact);
    if (!freeForm || beat.refresher || examIds.has(beat.id)) continue;
    const text = boardText(beat);
    // No list of "physical" words decides it: anything but a map, chart, count, formula or argument may
    // be pictured, and the picture's own check refuses what cannot be drawn.
    const problem = pictureRequestProblem(tb, []);
    const picture = aiPictures && pictureRoom() && options.mode !== "strict" && !MATHS.test(tb) && (!problem || problem === "not a physical thing");
    const next: CanvasStage = picture ? "illustration"
      : beat.stage === "diagram" && exact && VECTOR_DIAGRAMS() ? "figure"
      : isRealProcess(text) || /\b(steps?|stages?|then|leads? to|causes?)\b/i.test(text) ? "flow" : "scene";
    changes.push(`${beat.id}: ${beat.stage === "figure" ? "vector diagram" : "diagram"} → ${next === "figure" ? "figure (exact vector diagram)" : next} (free-form diagrams retired)`);
    Object.assign(beat, { stage: next, figure: next === "figure" ? "drawn" : undefined, figureAsset: undefined });
    if (beat.requiredVisual) beat.requiredVisual.stages = [next];
  }

  // THE PLANNER'S VISUAL TYPE DECIDES, LAST (owner, 2026-10-17: "I don't want it to be subject
  // specific, I want a working pipeline"). Word lists picked the visual for ten runs and kept missing:
  // "Limiting factors" became an atom count, "Specialised cells" text cards. The planner, which reads
  // the whole board, names the KIND of visual; code only keeps an exact figure that already fits.
  for (const beat of beats) {
    const want = beat.visualType;
    if (!want || beat.refresher || beat.overview || examIds.has(beat.id) || beat.stage === "exam" || beat.stage === "code" || beat.stage === "structure") continue;
    const contract = beat.requiredVisual?.stages ?? [];
    if (contract.length && !contract.every((st) => ["compare", "scene", "flow", "illustration", "figure", "diagram"].includes(st))) continue;
    const kit = beat.stage === "figure" && beat.figure && beat.figure !== "drawn" ? beat.figure : undefined;
    // The Visuals Lab maths figures ARE the board's diagram, sequence and maths at once (the proof's
    // triangles slide, the square is completed as you watch): whatever the label, a fitting one stays.
    if (kit && MOTION_MATHS.has(kit) && figureComponent(kit)?.match.test(boardText(beat))) continue;
    const tb = `${beat.title} ${beat.brief}`;
    const kitFits = kit === "library" || Boolean(kit && figureComponent(kit)?.match.test(tb));
    let next: CanvasStage = beat.stage;
    let figure: string | undefined = beat.figure;
    // A cycle is drawn as its loop of steps, never as a picture (the Krebs cycle was sent to the image
    // model on four boards, failed its check every time and became text cards — bench, 2026-10-18).
    const cycle = CYCLE_BOARD.test(tb) && !/\b(maps?|graphs?|data)\b/i.test(tb);
    if (want === "diagram" || (want === "thing" && cycle)) {
      // A schematic drawn by code: a process figure that fits stays; anything else is a flow of
      // labelled boxes and arrows (a loop for a cycle).
      if (beat.stage === "flow" || (kitFits && PROCESS_KITS.has(kit!))) continue;
      next = "flow"; figure = undefined;
    } else if (want === "thing") {
      // An exact figure stays only when the board's TITLE is its subject: a root hair cell kit on
      // "Specialised cells" showed one of the three cells the board teaches.
      if (kit && (kit === "library" || figureComponent(kit)?.match.test(beat.title)) && !PROCESS_KITS.has(kit)) continue;
      if (beat.stage === "illustration") continue;
      if (aiPictures && pictureRoom() && options.mode !== "strict") { next = "illustration"; figure = undefined; }
      else if (beat.stage === "diagram" || figure === "drawn") { next = "scene"; figure = undefined; }
      else continue;
    } else if (want === "quantity") {
      if (beat.stage === "graph" || (kit && GRAPH_LIKE.has(kit))) continue;
      next = "graph"; figure = undefined;
    } else if (want === "math") {
      if (beat.stage === "equation" || (kit && (GRAPH_LIKE.has(kit) || MATH_KITS.has(kit))) || (figure === "drawn" && isGeometryOrMechanics(tb))) continue;
      next = "equation"; figure = undefined;
    } else if (want === "sequence") {
      if (beat.stage === "flow" || (kitFits && PROCESS_KITS.has(kit!)) || (kit && HUMANITIES.has(kit))) continue;
      next = "flow"; figure = undefined;
    } else if (want === "comparison") {
      if (beat.stage === "compare" || kit === "conceptTable" || kit === "evaluationScale") continue;
      next = "compare"; figure = undefined;
    } else if (want === "concept") {
      if (!["illustration", "diagram", "atom-map"].includes(beat.stage) && figure !== "drawn") continue;
      next = "scene"; figure = undefined;
    }
    if (next === beat.stage && figure === beat.figure) continue;
    changes.push(`${beat.id}: ${beat.stage}${beat.figure ? ` (${beat.figure})` : ""} → ${next} (planner's visual: ${want})`);
    Object.assign(beat, { stage: next, figure, figureAsset: next === "figure" ? beat.figureAsset : undefined });
    if (beat.requiredVisual) beat.requiredVisual.stages = [next];
  }

  // A biology "equation" with no numbers or formula is words strung with arrows ("absolute refractory
  // period → sodium channels inactivated"; diagram lab, 2026-10-17): it is a flow of cards.
  for (const beat of beats) {
    if (beat.stage !== "equation") continue;
    const tb = `${beat.title} ${beat.brief}`;
    if (!LIFE_SCIENCE.test(tb) || /\b(calculat\w*|formula|equations?|magnification|percentage|ratio|rate of|mean|estimate|balanc\w*)\b|\d/i.test(`${tb} ${beat.script}`)) continue;
    changes.push(`${beat.id}: equation → flow (biology words, not a calculation)`);
    beat.stage = "flow";
    if (beat.requiredVisual) beat.requiredVisual.stages = ["flow"];
  }

  // MATHS AND COMPUTER SCIENCE ARE DRAWN AS SKETCH BOARDS (owner, 2026-10-20: "why can't I get these
  // visuals generated live"): every board that would be cards, a scene, a comparison table, a picture
  // or a described diagram is drawn the Visuals Lab's way instead — writing, worked maths, shapes that
  // move, graphs, tables and code, placed by code and written by the marker (lib/canvas/sketch.ts).
  // Equation, graph, code, data-structure, exam and exact figure boards keep their own renderers.
  if (labLecture) {
    for (const beat of beats) {
      if (examIds.has(beat.id) || beat.overview) continue;
      // A maths lesson that is not about programming has no code board: a probability lecture's third
      // board was planned as "code" (maths benchmark R7). Its working is an equation board.
      if (beat.stage === "code" && isMathsTopic(`${options.topic ?? ""} ${beat.title}`) && !/\b(code|coding|program\w*|python|java\w*|pseudo-?code|algorithm|function\s+in|loop|variable|array|recursion|computer)\b/i.test(`${options.topic ?? ""} ${beat.title} ${beat.brief}`)) {
        changes.push(`${beat.id}: code → equation (a maths lesson, not programming)`);
        Object.assign(beat, { stage: "equation", figure: undefined, figureAsset: undefined });
        if (beat.requiredVisual) beat.requiredVisual.stages = ["equation"];
        continue;
      }
      // Named points with coordinates (three or more, or a collinearity proof) are plotted where they
      // are: free vectors drawn from O showed neither A(1, 2), B(3, 5) nor C(5, 8) on "proving three
      // points are collinear" (maths benchmark, 2026-10-21).
      const named = (boardText(beat).match(/\b[A-Z]\s*\(\s*[−-]?\d+(?:\.\d+)?\s*,\s*[−-]?\d+(?:\.\d+)?\s*\)/g) ?? []).length;
      const grid = figureComponent("coordinateGrid");
      if (grid && (named >= 3 || (/\bcollinear\b/i.test(boardText(beat)) && named >= 2)) && !(beat.stage === "figure" && beat.figure === "coordinateGrid") && !beat.rejectedFigures?.includes("coordinateGrid") && ["figure", "flow", "compare", "scene", "illustration", "diagram", "sketch"].includes(beat.stage)) {
        changes.push(`${beat.id}: ${beat.stage}${beat.figure ? ` (${beat.figure})` : ""} → figure (coordinateGrid: named points are plotted)`);
        Object.assign(beat, { stage: "figure", figure: "coordinateGrid", figureAsset: undefined, objects: labelledFigureParts(grid, beat.requiredVisual?.mustShow ?? []) });
        if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
        continue;
      }
      // History and essay figures (cause and consequence, timelines, sources) never teach maths or CS:
      // a logic-gates board was given "cause and consequence" (QA batch 2, 2026-10-21).
      const essayFigure = beat.stage === "figure" && Boolean(beat.figure && HUMANITIES.has(beat.figure));
      const drawnFigure = beat.stage === "figure" && (beat.figure === "drawn" || !beat.figure || essayFigure);
      // A board about what a graph shows is drawn with its graph, not as lines of algebra: "The
      // graphical meaning" of simultaneous equations shipped with no graph (QA batch 1, 2026-10-21).
      const graphBoard = beat.stage === "equation" && /\bgraph(?:s|ical(?:ly)?)?\b|\bplot(?:s|ted|ting)?\b|\bintersect\w*|\bstraight lines?\b|\bcross(?:es|ing)? at\b/i.test(`${beat.title} ${beat.brief}`);
      // Flows (a route, a process, a sequence of steps) and comparison tables keep their own boards:
      // those lay out every box and fit every word inside it by code. As free sketches the writer hand-
      // placed tiny circles holding "advanced methods" and "complex numbers" with arrows through them —
      // the owner's "a lot of text overlap" (2026-10-21, a 15-board Pythagoras lecture).
      // A free graph of a data set invents its curves: "A (SD 0.71)" and "B (SD 2.83)" came out as one
      // curve twice, and the board fell back (maths benchmark round 1). The data's own figure draws it.
      const dataBoard = beat.stage === "graph" && ["dotPlot", "boxPlot", "histogram", "cumulativeFrequency"].includes(figureForBoard(beat)?.name ?? "");
      // A sketch planned for a figure the catalogue draws exactly (the angle in a semicircle) uses it:
      // a hand-drawn semicircle came out as a polygon (maths benchmark round 2).
      if (!["flow", "compare", "scene", "illustration", "diagram", "sketch"].includes(beat.stage) && !drawnFigure && !graphBoard && !dataBoard) continue;
      // An exact maths figure that fits the board beats free drawing: a live vectors sketch drew
      // b = (−2, 5) as an arrow 2 right and 3 up, and a probability tree came out in two loose
      // pieces (QA batch 2, 2026-10-21). Code computes every point of a catalogue figure.
      // The board's own words first, then the lecture's topic with the board's title ("Building the
      // tree" in a lecture on probability tree diagrams) when the board's script backs it up.
      const byTopic = figureFor(`${options.topic ?? ""} ${beat.title}`);
      const backed = byTopic && new RegExp(byTopic.match.source, byTopic.match.flags).test(`${options.topic ?? ""} ${boardText(beat)}`) && /\b(tree|branch|vector|graph|curve|axis|axes|triangle|circle|angle|line|grid|plot|chart|gates?\b|circuit|truth table|logic)/i.test(boardText(beat));
      // The planner's own choice of catalogue figure first ("diagram:triangle" was sketched by hand).
      const planned = beat.plannedFigure ? figureComponent(beat.plannedFigure) : undefined;
      const exact = [planned, figureForBoard(beat), backed ? byTopic : undefined].find((c) => c && (GRAPH_LIKE.has(c.name) || MATH_KITS.has(c.name)) && componentFitsSubject(c.name, boardText(beat)) && !beat.rejectedFigures?.includes(c.name));
      if (exact) {
        changes.push(`${beat.id}: ${beat.stage} → figure (${exact.name}, exact maths figure)`);
        Object.assign(beat, { stage: "figure", figure: exact.name, figureAsset: undefined, objects: labelledFigureParts(exact, beat.requiredVisual?.mustShow ?? []) });
        if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
        continue;
      }
      // No exact figure: a flow or a comparison keeps its own board (it lays out and fits every word).
      if (beat.stage === "flow" || beat.stage === "compare" || beat.stage === "sketch") continue;
      changes.push(`${beat.id}: ${beat.stage}${beat.figure ? ` (${beat.figure})` : ""} → sketch (maths/CS, drawn live)`);
      Object.assign(beat, { stage: "sketch", figure: undefined, figureAsset: undefined });
      if (beat.requiredVisual) beat.requiredVisual.stages = ["sketch"];
    }
  }

  // WORKING BESIDE ITS FIGURE (owner, 2026-10-22: "there are no graphs or images or drawings on the
  // screen that should be shown while showing the working"). In a maths lesson a figure board whose
  // narration works a calculation writes that working beside the figure, and a working board whose
  // words a maths figure draws gets that figure beside its lines (lib/canvas/layout.ts). A figure that
  // is drawn once per lesson (not a graph, not a construction kit) is not added to a second board.
  if (options.mode !== "strict" && isMathsTopic([options.topic ?? "", ...beats.map((b) => `${b.title} ${b.brief}`)].join(" "))) {
    const used = new Set(beats.map((b) => b.figure).filter(Boolean));
    for (const beat of beats) {
      if (beat.refresher || beat.overview || examIds.has(beat.id)) continue;
      const text = boardText(beat);
      if (beat.stage === "figure" && beat.figure && WORKING_FIGURES.has(beat.figure) && worksSomethingOut(beat.script)) {
        changes.push(`${beat.id}: figure (${beat.figure}) → working beside the figure`);
        beat.stage = "equation";
        if (beat.requiredVisual) beat.requiredVisual.stages = [...new Set([...beat.requiredVisual.stages, "equation" as CanvasStage])];
      } else if (beat.stage === "equation" && !beat.figure && worksSomethingOut(beat.script)) {
        const c = figureForBoard(beat);
        if (!c || !WORKING_FIGURES.has(c.name) || !componentFitsSubject(c.name, text) || beat.rejectedFigures?.includes(c.name)) continue;
        if (!REPEATABLE.has(c.name) && !GRAPH_LIKE.has(c.name) && used.has(c.name)) continue;
        changes.push(`${beat.id}: equation → working beside the ${c.name} figure`);
        beat.figure = c.name;
        used.add(c.name);
      }
    }
  }

  // CODE IS WRITTEN ON A CODE BOARD (CS round 4): a board that writes or traces code — "we now express
  // that pattern as pseudocode and trace it" — went on a sketch, where no line is ever lit as Aria speaks.
  // A typed prompt also counts the niche CS topics the shared check misses (lib/canvas/csLessons.ts).
  const lessonTitles = [options.topic ?? "", ...beats.map((b) => b.title)].join(" ");
  if (options.mode !== "strict" && (options.mode === "prompt" ? domainIsCs(domain, lessonTitles) : isCsTopic(lessonTitles))) {
    for (const beat of beats) {
      if (beat.refresher || beat.overview || examIds.has(beat.id) || (beat.stage !== "sketch" && beat.stage !== "flow" && beat.stage !== "scene")) continue;
      const text = `${beat.title} ${beat.brief} ${beat.script}`;
      if (/\b(?:pseudocode|python|code|function|procedure)\b/i.test(text) && /\b(?:writ\w*|trac\w*|line (?:\d+|one|two|three|four|five)|the \w+ line)\b/i.test(beat.script)) {
        changes.push(`${beat.id}: ${beat.stage} → code (it writes or traces code)`);
        beat.stage = "code";
        beat.figure = undefined;
      }
    }
  }

  // A TYPED CS LESSON SHOWS ITS MECHANISM ON THE STRUCTURE (lib/canvas/csLessons.ts): a protocol's servers
  // and messages, a Bloom filter's bits, KMP's pattern sliding — Raft was six flow charts of concepts and
  // no server was ever drawn (CS test, 2026-10-23). The opening map board stays a flow.
  if (options.mode === "prompt" && (!domain || domain === "cs")) {
    const lessonText = lessonTitles;
    beats.forEach((beat, i) => {
      if (i === 0 || beat.refresher || beat.overview || examIds.has(beat.id)) return;
      if (beat.sourceDiagram) return;
      const target = csMechanismStage(lessonText, `${beat.title} ${beat.brief} ${beat.script}`);
      if (!target) return;
      // A message exchange is a sequence even when the plan drew it as a graph of two machines (TCP lecture, 2026-10-24).
      if (beat.stage !== "flow" && beat.stage !== "scene" && beat.stage !== "sketch" && beat.stage !== "illustration" && !(target === "sequence" && beat.stage === "structure")) return;
      changes.push(`${beat.id}: ${beat.stage} → ${target} (the mechanism at work)`);
      beat.stage = target;
      beat.figure = undefined;
    });
  }

  // FEWER FREE SKETCHES (owner, 2026-10-25: "I don't wanna see such petty issues again"). Every unreadable
  // board of the CS rating run was a free sketch, where the model places each shape itself; a structure is
  // laid out by code. On a typed CS lesson, a sketch of a graph, tree, list, array, queue, stack, heap or
  // state machine (two such words on the board) is drawn as a structure.
  if (options.mode === "prompt" && domainIsCs(domain, lessonTitles)) {
    for (const beat of beats) {
      // A sketch, or a maths figure (the odd cycle came out as a geometry triangle with angle arcs, 2026-10-25).
      if ((beat.stage !== "sketch" && beat.stage !== "figure") || beat.figureAsset || beat.refresher || beat.overview || examIds.has(beat.id) || keptStages.has(beat.id)) continue;
      const found = new Set((`${beat.title} ${beat.brief} ${beat.script}`.toLowerCase().match(STRUCTURE_WORDS) ?? []).map((w) => w.replace(/(?:es|s)$/, "")));
      if (found.size < 2) continue;
      changes.push(`${beat.id}: ${beat.stage} → structure (${[...found].slice(0, 3).join(", ")}: drawn by code, not placed by hand)`);
      beat.stage = "structure";
      beat.figure = undefined;
    }
  }

  for (const beat of beats) {
    const kept = keptStages.get(beat.id);
    if (!kept || beat.stage === kept) continue;
    changes.push(`${beat.id}: ${beat.stage} → ${kept} (kept: ${beat.sourceDiagram ? "redraws the page's diagram" : "a message sequence"})`);
    Object.assign(beat, { stage: kept, figure: undefined, figureAsset: undefined });
    if (beat.requiredVisual) beat.requiredVisual.stages = [kept];
  }

  // AN OPERATING-SYSTEMS LESSON DRAWS THE PICTURES OS TEXTS DRAW (owner, 2026-10-25: "precision was
  // literally zero" — a multithreading lecture's state, sharing and model boards were forced into graphs,
  // failed, and shipped as free sketches with arrows from nowhere). A lifecycle is a state diagram, an
  // address space a memory layout, a schedule a Gantt chart, two threads racing a sequence — all placed by
  // code (lib/canvas/osDiagrams.ts). A page's state machine or layer stack is redrawn the same way. A free
  // sketch is never kept: it becomes a flow, which code lays out.
  if (options.mode === "prompt" && domainIsCs(domain, lessonTitles) && isTypedOsTopic(lessonTitles)) {
    beats.forEach((beat, i) => {
      if (beat.refresher || beat.overview || examIds.has(beat.id) || beat.stage === "code" || beat.stage === "exam") return;
      const page = beat.sourceDiagram?.kind;
      const target = page === "state-machine" ? "states"
        : page === "layers" ? "memory"
        : page || beat.stage === "sequence" ? null
        : (i > 0 ? osStageFor(`${beat.title} ${beat.brief} ${beat.script}`, `${beat.brief} — ${beat.title}`) : null) ?? (beat.stage === "sketch" ? "flow" : null);
      if (!target || target === beat.stage) return;
      changes.push(`${beat.id}: ${beat.stage} → ${target} (operating systems: ${target === "flow" ? "laid out by code, not placed by hand" : `a ${target} picture`})`);
      Object.assign(beat, { stage: target, figure: undefined, figureAsset: undefined });
      if (beat.requiredVisual) beat.requiredVisual.stages = [target];
    });
  }

  // NO FREE SKETCHES IN COMPUTER SCIENCE (owner, 2026-10-25: "there should not be free sketches for CS"). A
  // sketch, or a free-hand vector diagram, is placed by the model shape by shape: crowded parts and labels with
  // no room were the first cause of boards failing every attempt. Every typed CS board is one code lays out — a
  // structure, sequence, state diagram, memory layout, Gantt chart, mapping, code or flow. What is left after
  // the rules above becomes a flow. Maths keeps its sketches (equations and graphs need them).
  if (options.mode === "prompt" && domainIsCs(domain, lessonTitles)) {
    for (const beat of beats) {
      if (examIds.has(beat.id)) continue;
      const freeHand = beat.stage === "sketch" || beat.stage === "diagram" || (beat.stage === "figure" && (beat.figure === "drawn" || !beat.figure) && !beat.figureAsset);
      if (!freeHand) continue;
      changes.push(`${beat.id}: ${beat.stage}${beat.figure ? ` (${beat.figure})` : ""} → flow (computer science: laid out by code, never a free sketch)`);
      Object.assign(beat, { stage: "flow", figure: undefined, figureAsset: undefined });
      if (beat.requiredVisual) beat.requiredVisual.stages = ["flow"];
    }
  }

  // EACH PROOF ON ITS OWN FIGURE (owner, 2026-10-25: "it did derivation of trapezoid but there was no trapezoid
  // drawn"). A Pythagoras lecture taught Garfield's trapezoid and the similar-triangles proof over a plain right
  // triangle, and its cancelling board lost the four-triangle square it was cancelling. A board whose words name
  // a particular proof (a trapezoid, the altitude and similar triangles) gets that proof's figure in place of the
  // general triangle; a board that continues the previous board's proof keeps its figure.
  if (options.mode !== "strict" && isMathsTopic([options.topic ?? "", ...beats.map((b) => `${b.title} ${b.brief}`)].join(" "))) {
    const SPECIFIC = ["pythagorasGarfield", "pythagorasSimilar", "pythagorasSquares"];
    const PROOF_FIGURES = new Set([...SPECIFIC, "pythagorasProof"]);
    const CONTINUES = /\b(?:continu\w*|same proof|this proof|the previous (?:board|proof|step|equation)s?|the (?:two|first|second) (?:ratio|similarity|area)\w*|we now (?:expand|cancel|add|subtract|translate|combine|make the previous)|from the (?:first|second|previous))\b/i;
    beats.forEach((beat, i) => {
      if (beat.refresher || examIds.has(beat.id) || (beat.stage !== "equation" && beat.stage !== "figure")) return;
      const text = boardText(beat);
      const specific = SPECIFIC.map((n) => figureComponent(n)!).find((c) => c.match.test(text));
      if (specific && beat.figure !== specific.name && (!beat.figure || beat.figure === "triangle" || PROOF_FIGURES.has(beat.figure))) {
        changes.push(`${beat.id}: ${beat.figure ?? beat.stage} → ${specific.name} (the proof this board names)`);
        Object.assign(beat, { figure: specific.name, figureAsset: undefined, objects: labelledFigureParts(specific, beat.requiredVisual?.mustShow ?? []) });
        return;
      }
      const prev = beats[i - 1];
      // Its opening says so ("We continue the same proof…"), in its first two sentences.
      const first = canvasSentences(beat.script).slice(0, 2).join(" ");
      if (i > 0 && prev?.figure && PROOF_FIGURES.has(prev.figure) && beat.figure !== prev.figure && (!beat.figure || beat.figure === "triangle") && CONTINUES.test(`${beat.title} ${first}`)) {
        const kept = figureComponent(prev.figure)!;
        changes.push(`${beat.id}: ${beat.figure ?? beat.stage} → ${kept.name} (continues the proof on the board before)`);
        Object.assign(beat, { figure: kept.name, figureAsset: undefined, objects: labelledFigureParts(kept, beat.requiredVisual?.mustShow ?? []) });
      }
    });
  }

  const meaningfulVisuals =beats.filter((beat) => meaningful(beat.stage, apparatus.has(beat.id))).length;
  const targetMeaningfulVisuals = Math.min(beats.length, beats.length <= 1 ? 1 : Math.max(2, Math.ceil(beats.length * 0.6)));
  return {
    beats,
    audit: {
      mode: options.mode,
      illustrations: beats.filter((beat) => beat.stage === "illustration").length,
      meaningfulVisuals,
      targetMeaningfulVisuals,
      changes,
    },
  };
}
