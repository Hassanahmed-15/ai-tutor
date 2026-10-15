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
  figure?: "inferenceDistribution" | "photosynthesisExperiment" | "standingWave" | "wave";
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
  if (/\bwave (?:motion|features?|properties)\b|\b(?:crest|trough|wavelength|amplitude)\b.*\b(?:wave|crest|trough|wavelength|amplitude)\b|\btransverse wave\b|\blongitudinal wave\b/i.test(text)) {
    return {
      task: "wave-features", stage: "figure", figure: "wave",
      requiredParts: ["crest", "trough", "wavelength", "amplitude"],
      reason: "Wave features are spatial definitions: students must see crests, troughs, wavelength and amplitude attached to one wave.",
    };
  }
  const experimentalVerb = /\b(investigat\w*|experiment\w*|practical|method|apparatus|set[- ]?up|measure|control(?:led)? variables?|independent variable|dependent variable|fair test|repeat(?:ed)? readings?)\b/i;
  if (experimentalVerb.test(text) && /\bphotosynth\w*|pondweed|elodea|oxygen bubbles?|light intensity|starch test|destarch\w*|iodine\b/i.test(text)) {
    return {
      task: "experimental-method", stage: "figure", figure: "photosynthesisExperiment",
      requiredParts: ["light-source", "pondweed", "oxygen", "ruler"],
      reason: "The outcome is about carrying out and interpreting a photosynthesis investigation, so the apparatus and measured variable must be visible.",
    };
  }
  if (/\b(molecule|molecular|vsepr|bond angle|lone pair|covalent)\b/i.test(text)) return { task: "molecular-structure", stage: "molecule", reason: "Molecular geometry needs atoms, bonds and three-dimensional structure." };
  if (/\b(code|program|algorithm|loop|variable|function|python|javascript|trace table)\b/i.test(text)) return { task: "code-trace", stage: "code", reason: "The skill requires executable lines and a visible state trace." };
  if (/\b(equation|formula|calculate|solve|substitut|rearrange|algebra|derive)\b/i.test(text)) return { task: "calculation", stage: "equation", reason: "The skill requires visible worked steps." };
  if (/\b(graph|plot|gradient|slope|trend|correlation|relationship between|rate against|interpolat|extrapolat)\b/i.test(text)) return { task: "graph-interpretation", stage: "graph", reason: "The outcome requires a quantitative graph or interpretation." };
  if (/\b(conservation of (?:mass|matter)|atom count|balanced (?:chemical )?equation|reactants?\b.*\bproducts?)\b/i.test(text)) return { task: "matter-tracking", stage: "atom-map", reason: "The outcome tracks conserved atoms from reactants to products." };
  if (/\b(compare|difference|similarit|distinguish|versus|advantages?|disadvantages?|strengths?|limitations?)\b/i.test(text)) return { task: "comparison", stage: "compare", reason: "The outcome requires distinctions to be visible side by side." };
  if (/\b(process|cycle|sequence|pathway|steps?|cause and effect|flow)\b/i.test(text)) return { task: "process", stage: "flow", reason: "The outcome requires an ordered or causal relationship." };
  if (/\b(cell|organelle|organ|anatom|heart|lung|kidney|leaf|root|stem|flower|apparatus|circuit|cross[- ]section|internal structure)\b/i.test(text) && /\b(label|identify|structure|parts?|inside|diagram)\b/i.test(text)) return { task: "physical-structure", stage: "illustration", reason: "The outcome requires identifiable physical parts." };
  return { task: "concept", stage: "scene", reason: "A clear relationship board is sufficient for this conceptual outcome." };
}
