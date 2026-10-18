import { figureComponent, figureFor } from "../figures/registry";
import { classifyInstructionalTask } from "./instructionalTask";
import { namedIn } from "./labelPolicy";
import { boardWords, componentFitsSubject, GEOMETRY_FORM, hasVisualForm, isCircleGeometry, isGeometryOrMechanics, MECHANICS_FORM, isPhotographicAppearance, isPictureSubject, isPictureWorthy, isRealProcess, needsVectorDiagram } from "../diagrams/visualForm";
import type { CanvasPlanBeat, CanvasStage } from "./types";

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

/**
 * The component this board is about. One its title names wins over words its script mentions in
 * passing: "Water moves by osmosis" is a membrane board even though it describes the water molecule's
 * covalent bonds and lone pairs (audit replay 2026-10-17).
 */
function figureForBoard(beat: CanvasPlanBeat) {
  // A board about a circle's chords, tangents or angles is the circle theorem diagram, even when its
  // proof says "triangle" more often than "chord" ("The centre bisects a chord" was drawn as a bare
  // right triangle and rejected twice, QA 2026-10-17).
  const circle = figureComponent("circleTheorem");
  if (circle && isCircleGeometry(boardText(beat)) && circle.match.test(boardText(beat))) return circle;
  // What the board is ABOUT picks its diagram first. The narration may pick one only when it names
  // that subject at least twice: one passing word put a plasmid on "Risks and balanced discussion"
  // (audit 2026-10-17), while a terse title ("Transformations") still needs its script.
  const byTitle = figureFor(`${beat.title} ${beat.brief}`);
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
export const GRAPH_LIKE = new Set(["supplyDemand", "ppf", "adAs", "costRevenue", "scatterPlot", "histogram", "boxPlot", "cumulativeFrequency", "barChart", "pieChart", "inferenceDistribution", "motionGraph", "rateGraph", "decayCurve", "energyProfile", "functionGraph", "riemannSum", "slopeField", "coordinateGrid", "numberLine", "unitCircle", "argand", "punnettSquare", "probabilityTree", "venn", "sankey", "ecologicalPyramid", "sequences", "oxygenDebt", "sectorArc", "gelElectrophoresis", "oxygenDissociation", "microscopeGraticule"]);
/** Structures drawn differently per board from their params: a haploid view, then a diploid one. */
// Geometry kits draw a different construction per board from their params (one circle theorem per
// board): "circleTheorem is drawn on b1" turned the chord-bisector and tangent boards of a circle
// theorems lesson into a scene and an equation (QA 2026-10-17).
const MATH_KITS = new Set(["circleTheorem", "triangle", "vectors", "parallelLines", "bearings", "shapes3d"]);
const REPEATABLE = new Set(["chromosomeSets", "cellDivision", "punnettSquare", "pedigree", "electromagnetism", "titration", "circleTheorem", "triangle", "vectors", "parallelLines", "bearings", "shapes3d"]);
export const HUMANITIES = new Set(["timeline", "causeConsequence", "sourceCard", "evaluationScale", "conceptTable", "circularFlow"]);

const DATA_STRUCTURE_WORDS = /\b(?:linked list|binary (?:search )?tree|bst|avl|heap|stack|queue|array|hash ?(?:table|map)|node|pointer|vertex|vertices|adjacency|traversal|bfs|dfs|algorithm|data structure|binary search|sorting|sort)\b/i;

export function applyLessonVisualPolicy(
  input: CanvasPlanBeat[],
  options: {
    mode: VisualPolicyMode;
    aiPictures?: boolean;
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
  const changes: string[] = [];
  // A DATA-STRUCTURE BOARD IS FOR DATA STRUCTURES. An essay lesson drew "topic sentence → evidence →
  // because" as a linked list, its words cut to six characters (prompt bench, 2026-10-18): a board that
  // is not about a list, tree, stack, queue, array, graph, hash table or algorithm is a flow of steps.
  for (const beat of beats) {
    if (beat.stage !== "structure" || DATA_STRUCTURE_WORDS.test(`${beat.title} ${beat.brief} ${beat.script}`)) continue;
    beat.stage = "flow";
    changes.push(`${beat.id}: structure → flow (not a data structure)`);
  }
  // AI-generated pictures are off unless CANVAS_AI_PICTURES=on (owner, 2026-10-16: "I don't want any
  // vague diagram created by GPT image"): every picture board is drawn by code instead.
  // AI pictures (gpt-image-1-mini) are ON and work alongside the diagrams (owner, 2026-10-17: "a
  // combination of gpt image 1 mini and diagrams"): a picture shows what something looks like; a
  // board whose job is labelling a structure gets an exactly-labelled diagram. CANVAS_AI_PICTURES=off disables them.
  const aiPictures = options.aiPictures ?? !(typeof process !== "undefined" && process.env?.CANVAS_AI_PICTURES === "off");
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
    const byTitle = !GRAPH_LIKE.has(component.name) && titleWords.some((w) => component.title.toLowerCase().includes(w));
    const fits = (component.match.test(text) || byTitle) && componentFitsSubject(component.name, text);
    if (!fits) {
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

  const meaningfulVisuals = beats.filter((beat) => meaningful(beat.stage, apparatus.has(beat.id))).length;
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
