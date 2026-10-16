import type { CanvasPlanBeat } from "../canvas/types";

/**
 * Does this board's idea have a visual form? Used to route leftover boards to a vector diagram
 * instead of an icon chain or a text table. General — never a per-topic list.
 */

const PROCESS = /\b(then|next|leads? to|results? in|causes?|steps?|stages? of (the )?(process|cycle|reaction)|cycle|process|sequence|flows?|becomes|turns? into|produces?|→)\b/i;
const PHOTOGRAPHIC = /\b(looks? like|appearance|photograph|what .+ looks like|habitat|in situ|artefact|artifact|landform's look|organism)\b/i;
const STRUCTURAL = /\b(label|identify|parts?|structure|inside|cross[- ]section|cutaway|anatomy|diagram of|model of|set[- ]?up)\b/i;
const SPATIAL = /\b(maps?|ocean currents?|winds?|weather systems?|ITCZ|pressure belts?|hadley|ferrel|polar cell|three[- ]cell|atmospheric circulation|latitude|longitude|globes?|world (map|ocean)|currents? of the (atlantic|pacific|ocean))\b/i;
const DATA = /\b(graphs?|charts?|plots?|axis|axes|curves?|surplus|deficit|supply and demand|number line|bounds?|scatter|histogram|against (time|latitude|price|quantity))\b/i;
const COUNTS = /\b(\d{1,3}\s*(chromosomes?|pairs?|cells?|copies)|n\s*=\s*\d+|2n\s*=\s*\d+|haploid|diploid|exact counts?|sets? of chromosomes?)\b/i;
const EXPERIMENT = /\b(scattering|gold foil|alpha particles?|apparatus|set[- ]?up|paths? of|deflect)\b/i;
const MATH_ONLY = new Set(["shapes3d", "triangle", "vectors", "parallelLines", "bearings", "unitCircle", "fractionModel", "sectorArc", "argand"]);
const MATHS = /\b(cuboids?|cubes?|prisms?|pyramids?|nets? of|volume of|surface area|3[- ]?d (shapes?|solids?)|complex numbers?|argand|unit circle|bearings?|vectors?|parallel lines|fractions? of a (shape|bar|circle)|sector|arc length)\b/i;

export function boardWords(beat: Pick<CanvasPlanBeat, "title" | "brief" | "script" | "objects">): string {
  return `${beat.title} ${beat.brief} ${beat.script} ${(beat.objects ?? []).join(" ")}`;
}

export function isRealProcess(text: string): boolean {
  return PROCESS.test(text) && !SPATIAL.test(text) && !DATA.test(text) && !COUNTS.test(text) && !EXPERIMENT.test(text);
}

export function isPhotographicAppearance(text: string): boolean {
  return PHOTOGRAPHIC.test(text) && !STRUCTURAL.test(text) && !SPATIAL.test(text) && !DATA.test(text) && !COUNTS.test(text);
}

export function hasVisualForm(text: string): boolean {
  return STRUCTURAL.test(text) || SPATIAL.test(text) || DATA.test(text) || COUNTS.test(text) || EXPERIMENT.test(text) || /\b(diagram|labelled|cross[- ]section|model)\b/i.test(text);
}

/** Maps, counts, data, labelled models: never a generated photograph. */
export function needsVectorDiagram(text: string): boolean {
  return SPATIAL.test(text) || DATA.test(text) || COUNTS.test(text) || EXPERIMENT.test(text) || (STRUCTURAL.test(text) && !isPhotographicAppearance(text));
}

export function isMathsSolidBoard(text: string): boolean {
  return MATHS.test(text);
}

export function componentFitsSubject(name: string, text: string): boolean {
  if (MATH_ONLY.has(name) && !isMathsSolidBoard(text)) return false;
  return true;
}

export { MATH_ONLY };
