/**
 * READY-MADE PICTURE FIGURES AND LIBRARY DIAGRAMS ARE OFF IN COURSE LESSONS (owner, 2026-10-24: "remove
 * these … store them, don't delete them"). A course lesson's picture board is drawn by gpt-image-2 with
 * its labels (lib/canvas/coursePicture.ts) instead of a code-drawn anatomy, cell or apparatus figure or a
 * library textbook diagram. The figures stay where they are, untouched, and other lessons keep using
 * them; CANVAS_COURSE_READY_FIGURES=on brings them back to course lessons.
 *
 * Later the same day the owner switched EVERY code diagram off in course lessons, exact ones included
 * (courseCodeDiagramsOff below): this list now only matters with CANVAS_COURSE_CODE_DIAGRAMS=on.
 */
export const PICTURE_FIGURES = new Set([
  // biology: organs, tissues, cells
  "heart", "bloodVessels", "bloodCells", "leafCrossSection", "nephron", "placenta", "rootHairCell", "sarcomere", "seedStructure", "skinSection",
  "synapse", "teeth", "villus", "xylemPhloem", "guardCells", "endocrineGlands", "reflexArc", "chromosome",
  "gametes", "antibody", "enzymeAction",
  // (chromosome sets and cell division are counts — n and 2n, chromosomes per stage — and stay drawn by code)
  // chemistry: laboratory apparatus
  "distillation", "filtration", "chromatography", "gasCollection", "titration", "heating",
  // biology experiment set-up and physics device
  "photosynthesisExperiment", "electromagnetism",
]);

export function readyFiguresOffForCourses(): boolean {
  return process.env.CANVAS_COURSE_READY_FIGURES !== "on";
}

/** A ready-made picture figure (or a library diagram) that a course lesson no longer uses. */
export function offInCourses(figure: string | undefined): boolean {
  return readyFiguresOffForCourses() && Boolean(figure) && (figure === "library" || PICTURE_FIGURES.has(figure!));
}

/**
 * NO CODE DIAGRAMS IN COURSE LESSONS (owner, 2026-10-24: "I'm not allowing any code diagrams to enter now,
 * completely off them; I'm relying on gpt-image-2 for everything"). Every board stage that is a drawing —
 * a figure, graph, flow, molecule, atom map, structure, scene, vector diagram or live sketch — becomes a
 * picture board drawn by gpt-image-2 (lib/canvas/coursePicture.ts), exact diagrams included. Writing stays
 * writing: lines of working, tables, code listings and the exam board. A working board that had a figure
 * beside it gets a gpt-image-2 picture beside it instead. The figures stay where they are, untouched, for
 * typed-prompt and PDF lessons; CANVAS_COURSE_CODE_DIAGRAMS=on brings them back to course lessons.
 */
export const CODE_DIAGRAM_STAGES = new Set(["figure", "graph", "flow", "molecule", "atom-map", "structure", "scene", "diagram", "sketch"]);

export function courseCodeDiagramsOff(): boolean {
  return process.env.CANVAS_COURSE_CODE_DIAGRAMS !== "on" && process.env.CANVAS_COURSE_PICTURES !== "off" && process.env.CANVAS_AI_PICTURES !== "off";
}
