import { figureComponent, figureFor } from "../figures/registry";
import { classifyInstructionalTask } from "./instructionalTask";
import { namedIn } from "./labelPolicy";
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

export const PHYSICAL = /\b(cell|organelle|organ|anatom|heart(?!\s+rate)|lung|kidney|leaf|(?<!(?:square|cube|nth|complex|real|repeated|equal|distinct) )root(?!s? of)|stem|flower|plant part|animal|skeleton|muscle|eye|ear|brain|neuron|alveol\w*|nephron|apparatus|equipment|machine|engine|circuit|battery|magnet|rock layer|volcano|landform|weather system|planet|telescope|microscope|cross[- ]section|cutaway|internal structure|burette|pipette|conical flask|beaker|test[- ]tube|bunsen|thermometer|measuring cylinder|condenser|filter funnel|evaporating basin|cuvette|colorimeter|gas syringe|delivery tube|electrode|building|monument|mosque|ka[ʿ'’]?ba|kaaba|temple|church|cathedral|castle|fort|pyramid|palace|tomb|artefact|artifact|statue|ship|landscape|river|mountain|coastline|glacier|desert)(?:e?s)?\b/i;
const STRUCTURAL = /\b(label|identify|part|structure|inside|cross[- ]section|cutaway|anatomy|location)\b/i;
const NON_PICTURE = /\b(equation|formula|calculate|solve|graph|plot|gradient|slope|code|program|algorithm|loop|variable|molecule|molecular|vsepr|bond angle|lone pair|atom count|balanced equation)\b/i;

function boardText(beat: CanvasPlanBeat): string {
  return `${beat.title} ${beat.brief} ${beat.script} ${beat.objects.join(" ")}`;
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
  if (byTitle) return byTitle;
  const byScript = figureFor(boardText(beat));
  if (!byScript) return undefined;
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
  return stages.find((stage): stage is CanvasStage => ["illustration", "flow", "equation", "graph", "compare", "scene", "code", "molecule", "atom-map", "figure"].includes(stage)) ?? null;
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
 * A normal lesson may introduce at most two generated base pictures. More are retained only when
 * separate syllabus contracts explicitly require labelled physical structures. The remaining
 * visual load is carried by deterministic renderers: flows, graphs, equations, molecules and code.
 */
const GRAPH_LIKE = new Set(["supplyDemand", "ppf", "adAs", "costRevenue", "scatterPlot", "histogram", "boxPlot", "cumulativeFrequency", "barChart", "pieChart", "inferenceDistribution", "motionGraph", "rateGraph", "decayCurve", "energyProfile", "functionGraph", "riemannSum", "slopeField", "coordinateGrid", "numberLine", "unitCircle", "argand", "punnettSquare", "probabilityTree", "venn", "sankey", "ecologicalPyramid", "sequences", "oxygenDebt", "sectorArc", "gelElectrophoresis", "oxygenDissociation", "microscopeGraticule"]);
const HUMANITIES = new Set(["timeline", "causeConsequence", "sourceCard", "evaluationScale", "conceptTable", "circularFlow"]);

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
  const changes: string[] = [];
  // AI-generated pictures are off unless CANVAS_AI_PICTURES=on (owner, 2026-10-16: "I don't want any
  // vague diagram created by GPT image"): every picture board is drawn by code instead.
  // AI pictures (gpt-image-1-mini) are ON and work alongside the diagrams (owner, 2026-10-17: "a
  // combination of gpt image 1 mini and diagrams"): a picture shows what something looks like; a
  // board whose job is labelling a structure gets an exactly-labelled diagram. CANVAS_AI_PICTURES=off disables them.
  const aiPictures = options.aiPictures ?? !(typeof process !== "undefined" && process.env?.CANVAS_AI_PICTURES === "off");
  // Pictures are generated, checked by a textbook editor and remembered (lib/canvas/textbookDiagram.ts),
  // so a lesson may show up to four; a verified one costs nothing the next time it is used.
  const maxIllustrations = !aiPictures || options.mode === "strict" ? 0 : beats.length <= 1 ? 1 : 4;
  const pictureRoom = () => beats.filter((b) => b.stage === "illustration").length < maxIllustrations;

  // A deterministic curriculum contract wins over a model's decorative stage choice.
  for (const beat of beats) {
    const required = firstRequiredStage(beat);
    if (required && beat.requiredVisual && !beat.requiredVisual.stages.includes(beat.stage)) {
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
  const QUANTITY = /\d+(?:\.\d+)?\s?(%|°|°C|cm|mm|km|kg|mg|ml|kPa|mmHg|mol|ms|min|kJ|J|N|V|Hz|m\/s|g\/|s\b|h\b|m\b|g\b|K\b)|\b(rate|per|percent|proportion|increase|decrease|rise|fall|price|cost|revenue|demand|supply|speed|velocity|acceleration|distance|temperature|mass|volume|pressure|concentration|over time|against time|data|measure\w*|function|curve|axis|axes|variable|quantity|population|growth|frequency|probability|gradient|slope|correlation)\b/i;
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
    } else if (PHYSICAL.test(text) || /\b(atoms?|nucle(us|i)|electrons?|protons?|neutrons?|isotopes?)\b/i.test(text) && STRUCTURAL.test(text) || /\bexperiment\b/i.test(text)) {
      changes.push(`${beat.id}: atom-map → illustration (a physical structure, not an atom-conservation board)`);
      beat.stage = "illustration";
      if (beat.requiredVisual) beat.requiredVisual.stages = ["illustration"];
    } else {
      changes.push(`${beat.id}: atom-map → flow (not an atom-conservation board)`);
      beat.stage = "flow";
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
    if (options.mode === "strict" || beat.refresher || !beat.plannedFigure || beat.figure) continue;
    const component = figureComponent(beat.plannedFigure);
    if (!component) continue;
    if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.some((st) => st === "figure" || st === beat.stage)) continue;
    const text = boardText(beat);
    const titleWords = (`${beat.title} ${beat.brief}`.toLowerCase().match(/[a-z]{5,}/g) ?? []).map((w) => w.replace(/(es|s)$/, ""));
    const fits = component.match.test(text) || titleWords.some((w) => component.title.toLowerCase().includes(w));
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
    if (options.mode === "strict" || beat.refresher || (beat.plannedFigure && beat.figure === beat.plannedFigure)) continue;
    const decision = classifyInstructionalTask(beat);
    const semantic = decision.figure ? figureComponent(decision.figure) : undefined;
    // A semantic decision may replace a generic graph/flow because the figure is a stricter form of
    // that representation. Other library figures replace only picture-like stages.
    const component = semantic ?? figureForBoard(beat);
    if (!component) continue;
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

  // Every other physical subject — no component, no library diagram — whose board LABELS a structure is
  // drawn as checked textbook line art the board writer describes (lib/figures/drawn.ts): its labels are
  // exact, where an AI picture's would be guessed. With AI pictures off, every physical board is drawn.
  // Strict source mode teaches only what the student's pages show, so it never invents one.
  if (options.mode !== "strict") {
    for (const beat of beats) {
      if (beat.refresher || beat.stage === "figure") continue;
      const physical = PHYSICAL.test(boardText(beat)) || pictureNeedScore(beat) >= 3;
      const pictureLike = beat.stage === "illustration" || (beat.stage === "scene" && nativeStageFor(beat) === "scene");
      if (!physical || !pictureLike) continue;
      if (isElectrolyticCellBeat(beat) || isFreeBodyBeat(beat)) continue;
      if (beat.requiredVisual?.stages.length && !beat.requiredVisual.stages.some((st) => st === "illustration" || st === "scene" || st === "figure")) continue;
      // With AI pictures on, a real thing with no exact diagram is GENERATED as a textbook diagram and
      // checked before release; the writer-described line art (blobs and empty boxes in the 2026-10-17
      // audits) is used only when pictures are switched off.
      if (aiPictures) {
        if (beat.stage !== "illustration" && pictureRoom()) {
          changes.push(`${beat.id}: ${beat.stage} → illustration (generated textbook diagram)`);
          beat.stage = "illustration";
          if (beat.requiredVisual) beat.requiredVisual.stages = ["illustration"];
        }
        continue;
      }
      changes.push(`${beat.id}: ${beat.stage} → figure (drawn textbook diagram)`);
      beat.stage = "figure";
      beat.figure = "drawn";
      if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
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
  // illustration. Never replace a board whose curriculum contract requires a different renderer.
  if (maxIllustrations > 0 && !beats.some((beat) => beat.stage === "illustration")) {
    const candidate = beats
      .filter((beat) => !beat.requiredVisual?.stages.length || beat.requiredVisual.stages.includes("illustration") || beat.requiredVisual.stages.includes("scene"))
      .map((beat) => ({ beat, score: pictureNeedScore(beat) }))
      .sort((a, b) => b.score - a.score)[0];
    // A board that labels a structure is a diagram now; the guaranteed picture is a "what it looks like" board.
    if (candidate && candidate.score >= 3 && candidate.beat.stage !== "figure" && !STRUCTURAL.test(boardText(candidate.beat))) {
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
      beat.stage = "figure";
      beat.figure = "drawn";
      if (beat.requiredVisual) beat.requiredVisual.stages = ["figure"];
      changes.push(`${beat.id}: illustration → figure (drawn; lesson picture budget)`);
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
  const DIAGRAM_STAGES = new Set(["figure", "illustration", "graph", "molecule", "atom-map", "equation", "code"]);
  if (options.mode !== "strict" && beats.length && !beats.some((beat) => DIAGRAM_STAGES.has(beat.stage) || apparatus.has(beat.id))) {
    const candidates = beats.filter((beat) => !beat.refresher && !beat.overview && ["compare", "flow", "scene"].includes(beat.stage));
    const pick = (test: (beat: CanvasPlanBeat) => boolean) => candidates.find(test);
    const choose: Array<[CanvasPlanBeat | undefined, string]> = [
      [pick((beat) => datedSequence(boardText(beat))), "timeline"],
      [pick((beat) => /\b(led to|leading to|caused?|causes|resulted in|consequences?|effects? of|sparked|triggered|why did)\b/i.test(boardText(beat))), "causeConsequence"],
      [pick((beat) => /\b(evaluat\w*|assess\w*|to what extent|how far|judge\w*|argue\w*|for and against|advantages and disadvantages|strengths and (weaknesses|limitations))\b/i.test(boardText(beat)) && !/\b(integral|integrat|derivative|differentiat|limit|algebra|quadratic|complet\w* the square)\b/i.test(boardText(beat))), "evaluationScale"],
      [pick((beat) => /\b(source|speech|letter|diary|cartoon|extract|document|propaganda|poster|account by)\b/i.test(boardText(beat))), "sourceCard"],
      [pick((beat) => PHYSICAL.test(boardText(beat)) && !NON_PICTURE.test(boardText(beat))), aiPictures ? "picture" : "drawn"],
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
    const isDiagram = (beat: CanvasPlanBeat) => DIAGRAM_STAGES.has(beat.stage) || apparatus.has(beat.id);
    const target = Math.ceil(teaching.length * (2 / 3));
    const contractAllows = (beat: CanvasPlanBeat) => !beat.requiredVisual?.stages.length || beat.requiredVisual.stages.some((st) => st === "figure" || st === "illustration" || st === "scene" || st === beat.stage);
    const fits = (beat: CanvasPlanBeat): string | null => {
      const text = boardText(beat);
      if (datedSequence(text)) return "timeline";
      const component = figureForBoard(beat);
      if (component && !HUMANITIES.has(component.name)) return component.name;
      if (/\b(advantages?|disadvantages?|benefits? and (drawbacks?|costs?)|pros and cons|strengths?|weakness(es)?|limitations?|for and against|evaluat\w*|to what extent|how far|weigh\w*|benefits? (and|versus|vs\.?|against) (risks?|concerns?|harms?|costs?)|(risks?|costs?|harms?) (and|versus|against) benefits?|ethical (concerns?|choices?|dilemmas?)|(is|be) (it |this )?(ethically )?acceptable)\b/i.test(text) && !/\b(integral|integrat|derivative|differentiat|limit|algebra|quadratic|complet\w* the square)\b/i.test(text)) return "evaluationScale";
      if (/\b(speech|letter|diary|cartoon|extract|propaganda|poster|account by|primary source|hadith|verse|surah)\b/i.test(text)) return "sourceCard";
      if (/\b(led to|leading to|causes?d?|resulted in|consequences?|effects? of|sparked|triggered|why did|because of)\b/i.test(text) && beat.stage !== "compare") return "causeConsequence";
      // A program's "memory cell" or a formula's "variable" is not a thing to draw.
      if (PHYSICAL.test(text) && !NON_PICTURE.test(text)) return aiPictures ? (pictureRoom() ? "picture" : null) : "drawn";
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
      if (!key || GRAPH_LIKE.has(key) || HUMANITIES.has(key) || beat.refresher) continue;
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
      for (const beat of list) {
        if (beat === keep) continue;
        const text = boardText(beat);
        beat.figure = undefined;
        beat.figureAsset = undefined;
        beat.objects = [];
        // Its syllabus labels are drawn on the board that keeps the diagram.
        beat.requiredVisual = undefined;
        if (aiPictures && pictureRoom() && PHYSICAL.test(text) && !MATHS.test(text)) {
          beat.stage = "illustration";
          changes.push(`${beat.id}: figure → illustration (${key} is drawn on ${keep.id}; this board shows its own picture)`);
        } else {
          const routed = nativeStageFor(beat);
          beat.stage = routed === "figure" || routed === "illustration" ? "flow" : routed;
          changes.push(`${beat.id}: figure → ${beat.stage} (${key} is drawn on ${keep.id})`);
        }
      }
    }
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
