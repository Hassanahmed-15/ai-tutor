import type { CanvasPlanBeat, CanvasStage } from "./types";

/**
 * The learning action a board must support.  This is intentionally smaller than a subject
 * taxonomy: the same actions recur in every course, while their renderers and invariants are
 * deterministic.  Classification uses the whole board (title, objective, narration, objects and
 * curriculum obligations), so one ambiguous noun cannot choose a visual on its own.
 */
export type InstructionalTask =
  | "statistical-inference"
  | "experimental-method"
  | "stationary-wave"
  | "wave-features"
  | "molecular-structure"
  | "code-trace"
  | "calculation"
  | "graph-interpretation"
  | "matter-tracking"
  | "comparison"
  | "process"
  | "physical-structure"
  | "concept";

export type InstructionalTaskDecision = {
  task: InstructionalTask;
  stage: CanvasStage;
  /** A renderer whose geometry and label anchors are owned by code, not by the model. */
  figure?: "inferenceDistribution" | "photosynthesisExperiment" | "standingWave" | "wave" | "heart" | "sequences" | "sectorArc" | "geneticTech" | "oxygenDebt" | "electromagnetism" | "coordinateGrid" | "enzymeAction" | "cellDivision" | "leafCrossSection" | "proteinSynthesis" | "antibody" | "numberLine" | "functionGraph" | "riemannSum";
  requiredParts?: string[];
  reason: string;
};

export function instructionalText(beat: Pick<CanvasPlanBeat, "title" | "brief" | "script" | "objects" | "requiredVisual">): string {
  return [beat.title, beat.brief, beat.script, beat.objects.join(" "), ...(beat.requiredVisual?.mustShow ?? [])].join(" ");
}

export function classifyInstructionalTask(beat: Pick<CanvasPlanBeat, "title" | "brief" | "script" | "objects" | "requiredVisual">): InstructionalTaskDecision {
  const text = instructionalText(beat);

  // Meaning beats vocabulary: an investigation of photosynthesis is an experimental method, not an
  // atom-conservation diagram merely because the word "photosynthesis" appears.
  if (/\b(p[- ]?value|null (?:hypothesis|distribution)|alternative hypothesis|significance (?:test|level)|test statistic|one[- ]tailed|two[- ]tailed|rejection region)\b/i.test(text)) {
    return {
      task: "statistical-inference", stage: "figure", figure: "inferenceDistribution",
      requiredParts: ["null-distribution", "observed-statistic", "p-value-region"],
      reason: "Statistical inference must show the null distribution, observed statistic and relevant tail area together.",
    };
  }
  if (/\b(stationary|standing) waves?\b|\bnodes? and antinodes?\b|\badjacent nodes?\b/i.test(text)) {
    return {
      task: "stationary-wave", stage: "figure", figure: "standingWave",
      requiredParts: ["node", "antinode", "wavelength"],
      reason: "A stationary wave needs fixed nodes, antinodes and the node-spacing/wavelength relationship.",
    };
  }
  // A colorimeter's "wavelength" is the light it selects, not a wave to draw (audit replay 2026-10-17).
  if (!/\b(colorimet\w*|spectrophotomet\w*|absorbance|cuvettes?)\b/i.test(text) && /\bwave (?:motion|features?|properties)\b|\b(?:crest|trough|wavelength|amplitude)\b.*\b(?:wave|crest|trough|wavelength|amplitude)\b|\btransverse wave\b|\blongitudinal wave\b/i.test(text)) {
    return {
      task: "wave-features", stage: "figure", figure: "wave",
      requiredParts: ["crest", "trough", "wavelength", "amplitude"],
      reason: "Wave features are spatial definitions: students must see crests, troughs, wavelength and amplitude attached to one wave.",
    };
  }
  if (/\boxygen debt\b|\bEPOC\b|\boxygen (uptake|consumption) (during|after) (exercise|recovery)\b/.test(text)) {
    return { task: "graph-interpretation", stage: "figure", figure: "oxygenDebt", requiredParts: ["resting", "exercise", "debt"], reason: "Oxygen debt is the shaded area between recovery uptake and the resting rate." };
  }
  // "heart rate" is circulation, not a chamber-labelling outcome. Oxygen-debt boards are classified above.
  if (/\bheart\b(?!\s+rate)/i.test(text) && /\b(chambers?|atria|atrium|ventricle|aorta|valve|septum|cardiac|label|structure|diagram)\b/i.test(text)) {
    return { task: "physical-structure", stage: "figure", figure: "heart", requiredParts: ["right-atrium", "left-ventricle", "aorta"], reason: "A heart-structure outcome needs the chambers and a named vessel labelled on one diagram." };
  }
  if (/\btransformers?\b|\bturns ratio\b|\bstep[- ](up|down) transformers?\b/.test(text)) {
    return { task: "physical-structure", stage: "figure", figure: "electromagnetism", requiredParts: ["primary-coil", "secondary-coil", "core"], reason: "A transformer board must show primary and secondary coils on a shared core, not a solenoid." };
  }
  if (/\b(arithmetic|geometric) sequences?\b|\bnth[- ]terms?\b|\bcommon (difference|ratio)\b|\bsequences?\b(?=[\s\S]{0,80}\b(term|nth|position-to-term)\b)/.test(text)) {
    return { task: "calculation", stage: "figure", figure: "sequences", requiredParts: ["first-term", "nth-term", "step"], reason: "A sequence board must show terms and the nth-term formula computed from a and d or r." };
  }
  if (/\b(arc length|area of (a |the )?sector|arcs? and sectors?|circles?, arcs and sectors)\b/.test(text)) {
    return { task: "calculation", stage: "figure", figure: "sectorArc", requiredParts: ["radius", "sector", "arc", "angle"], reason: "Arc length and sector area are read off one labelled circle with θ at the centre." };
  }
  if (/\b(genetic technolog\w*|recombinant DNA|restriction enzymes?|plasmids?|PCR|polymerase chain reaction)\b/.test(text)) {
    return { task: "process", stage: "figure", figure: "geneticTech", requiredParts: ["plasmid", "restriction-site", "insert"], reason: "Genetic technology is a process whose parts (plasmid, cut, insert, or PCR steps) must sit on one figure." };
  }
  if (/\b(translation|reflection|rotation|enlargement)s?\b(?=[\s\S]{0,80}\b(shape|triangle|object|image|grid|vector)\b)|\b(geometric |combined |single )?transformations?\b(?=[\s\S]{0,80}\b(shape|triangle|polygon|object|image|column vector|mirror line|scale factor)\b)/.test(text) && !/\bcomplet\w* the square|discriminant|vertex|quadratic|integrat|derivative|double[- ]angle|identit|product rule|quotient rule|chain rule\b/i.test(text)) {
    return { task: "graph-interpretation", stage: "figure", figure: "coordinateGrid", requiredParts: ["object", "image"], reason: "A transformation is the object and its computed image on a coordinate grid." };
  }
  if (/\bmode of action of enzymes\b|\benzyme action\b|\benzymes?\b(?=[\s\S]{0,200}\b(active site|substrate|lock[- ]and[- ]key|induced[- ]fit|denatur)\b)|\block[- ]and[- ]key\b|\binduced[- ]fit\b/.test(text)) {
    return { task: "process", stage: "figure", figure: "enzymeAction", requiredParts: ["enzyme", "active-site", "substrate"], reason: "Enzyme action is the shape of the active site relative to the substrate." };
  }
  if (/\b(mitosis|meiosis|cell division|(pro|meta|ana|telo)phase)\b/.test(text)) {
    return { task: "process", stage: "figure", figure: "cellDivision", requiredParts: ["chromosome", "daughter-cells"], reason: "Nuclear division is a sequence of chromosome arrangements, not a generic cycle of icons." };
  }
  if (/\bleaf\b(?=[\s\S]{0,200}\b(cross[- ]section|palisade|spongy|mesophyll|stomata?|cuticle|xylem|phloem|epidermis|photosynthes|structure)\b)|\b(palisade|spongy mesophyll)\b/.test(text)) {
    return { task: "physical-structure", stage: "figure", figure: "leafCrossSection", requiredParts: ["palisade", "stoma", "xylem"], reason: "A leaf-as-organ outcome needs palisade, a stoma and the vascular bundle on one section." };
  }
  if (/\bprotein synthes\w*\b|\btranscription and translation\b|\b(transcri(be|ption)|translat(e|ion))\b(?=[\s\S]{0,120}\b(mRNA|ribosome|polypeptide|amino acid|codon)\b)/.test(text)) {
    return { task: "process", stage: "figure", figure: "proteinSynthesis", requiredParts: ["dna", "mrna", "ribosome"], reason: "Protein synthesis is DNA → mRNA → polypeptide on one labelled process figure." };
  }
  if (/\bantibod\w*\b|\bimmunoglobulin\b|\b(active|passive) immunit\w*\b/.test(text)) {
    return { task: "physical-structure", stage: "figure", figure: "antibody", requiredParts: ["binding-site", "antigen"], reason: "An immunity board must show the Y-shaped antibody and its antigen-binding site." };
  }
  if (/\binequalit(y|ies)\b/.test(text) && !/\bcode|program|python\b/i.test(text)) {
    return { task: "graph-interpretation", stage: "figure", figure: "numberLine", requiredParts: ["number-line", "solution-set"], reason: "An inequality is the solution set on a number line, not a paragraph of inequalities." };
  }
  if (/\bprobability density\b|\bpdf\b|\bcontinuous random variable\b/.test(text)) {
    return { task: "graph-interpretation", stage: "figure", figure: "functionGraph", requiredParts: ["curve"], reason: "A PDF is a non-negative curve whose area is 1, drawn as a function graph." };
  }
  if (/\btrapezium rule\b|\btrapezoid(al)? rule\b|\briemann (sum|sums)\b|\barea under (a|the) curve\b.*\b(rectangles?|strips?|approximat|ordinate)/i.test(text)) {
    return { task: "graph-interpretation", stage: "figure", figure: "riemannSum", requiredParts: ["curve"], reason: "A trapezium rule / Riemann sum is the strips under y = f(x), not a sketch of turning points." };
  }
  // Product/quotient/chain/parametric/implicit are algebraic rules. Only curve-reading boards
  // (turning points, sketching dy/dx) belong on functionGraph.
  if ((/\bapplications? of differentiat\w*\b|\bturning points?\b|\bstationary points?\b/.test(text) || (/\bdy\/dx\b/.test(text) && /\b(graph|curve|sketch|tangent|turning)\b/i.test(text))) && !/\bintegrat|product rule|quotient rule|chain rule|parametric|implicit differentiat\b/i.test(text)) {
    return { task: "graph-interpretation", stage: "figure", figure: "functionGraph", requiredParts: ["curve"], reason: "Differentiation applications are read off the graph of y = f(x): gradient, turning point, tangent." };
  }
  if (/\bfunctions?\b(?=[\s\S]{0,80}\b(f\s*\(|domain|range|composite|inverse|mapping)\b)|\bf\s*\(\s*x\s*\)/.test(text) && !/\bpython|javascript|program|code|trapezium|trapezoid|riemann|product rule|quotient rule|chain rule|parametric|implicit differentiat\b/i.test(text)) {
    return { task: "graph-interpretation", stage: "figure", figure: "functionGraph", requiredParts: ["curve"], reason: "A function board is y = f(x) on axes, not a code trace." };
  }
  const experimentalVerb = /\b(investigat\w*|experiment\w*|practical|method|apparatus|set[- ]?up|measure|control(?:led)? variables?|independent variable|dependent variable|fair test|repeat(?:ed)? readings?)\b/i;
  if (experimentalVerb.test(text) && (/\bphotosynth\w*|pondweed|elodea|oxygen bubbles?|light intensity|destarch\w*/i.test(text) || (/\bstarch test|iodine\b/i.test(text) && /\bleaf|leaves|variegated\b/i.test(text) && !/\b(amylase|enzyme)\b/i.test(text)))) {
    return {
      task: "experimental-method", stage: "figure", figure: "photosynthesisExperiment",
      requiredParts: ["light-source", "pondweed", "oxygen", "ruler"],
      reason: "The outcome is about carrying out and interpreting a photosynthesis investigation, so the apparatus and measured variable must be visible.",
    };
  }
  if (/\b(molecular (shape|geometry|structure)|shapes? of (a |the |simple )?molecules?|vsepr|bond angle|lone pairs?|covalent bond)/i.test(text)) return { task: "molecular-structure", stage: "molecule", reason: "Molecular geometry needs atoms, bonds and three-dimensional structure." };
  if (/\b(code|program|algorithm|loop|python|javascript|trace table)\b/i.test(text) || (/\bvariable\b/i.test(text) && /\b(code|program|loop)\b/i.test(text))) return { task: "code-trace", stage: "code", reason: "The skill requires executable lines and a visible state trace." };
  if (/\b(equation|formula|calculate|solve|substitut|rearrange|algebra|derive)\b/i.test(text)) return { task: "calculation", stage: "equation", reason: "The skill requires visible worked steps." };
  if (/\b(graph|plot|gradient|slope|trend|correlation|relationship between|rate against|interpolat|extrapolat)\b/i.test(text)) return { task: "graph-interpretation", stage: "graph", reason: "The outcome requires a quantitative graph or interpretation." };
  if (/\b(conservation of (?:mass|matter)|atom count|balanced (?:chemical )?equation|reactants?\b.*\bproducts?\b(?=[\s\S]*\b(atoms?|conserv\w*|balanc\w*|mass)\b))/i.test(text)) return { task: "matter-tracking", stage: "atom-map", reason: "The outcome tracks conserved atoms from reactants to products." };
  if (/\b(compare|difference|similarit|distinguish|versus|advantages?|disadvantages?|strengths?|limitations?)\b/i.test(text)) return { task: "comparison", stage: "compare", reason: "The outcome requires distinctions to be visible side by side." };
  if (/\b(process|cycle|pathway|steps?|cause and effect|flow)\b|\bsequence of\b/i.test(text)) return { task: "process", stage: "flow", reason: "The outcome requires an ordered or causal relationship." };
  if (/\b(cell|organelle|organ|anatom|heart|lung|kidney|leaf|root|stem|flower|apparatus|circuit|cross[- ]section|internal structure)\b/i.test(text) && /\b(label|identify|structure|parts?|inside|diagram)\b/i.test(text)) return { task: "physical-structure", stage: "illustration", reason: "The outcome requires identifiable physical parts." };
  return { task: "concept", stage: "scene", reason: "A clear relationship board is sufficient for this conceptual outcome." };
}
