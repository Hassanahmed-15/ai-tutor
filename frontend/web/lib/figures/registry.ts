import { titration } from "./components/titration";
import { distillation } from "./components/distillation";
import { filtration } from "./components/filtration";
import { chromatography } from "./components/chromatography";
import { gasCollection } from "./components/gasCollection";
import { heating } from "./components/heating";
import { atomicStructure } from "./components/atomicStructure";
import { energyProfile } from "./components/energyProfile";
import { particles } from "./components/particles";
import { punnettSquare } from "./components/punnettSquare";
import { pedigree } from "./components/pedigree";
import { dnaStructure } from "./components/dnaStructure";
import { circuit } from "./components/circuit";
import { rayLens } from "./components/rayLens";
import { fieldLines } from "./components/fieldLines";
import { wave } from "./components/wave";
import { circleTheorem } from "./components/circleTheorem";
import { triangle } from "./components/triangle";
import { vectors } from "./components/vectors";
import { probabilityTree } from "./components/probabilityTree";
import { venn } from "./components/venn";
import { inferenceDistribution } from "./components/inferenceDistribution";
import { photosynthesisExperiment } from "./components/photosynthesisExperiment";
import { standingWave } from "./components/standingWave";
import type { FigureComponent } from "./types";

/**
 * Every figure the board can draw by code. A component is general — one titration serves every
 * titration lesson, whatever the acid, alkali or indicator — and is chosen by what a board is about
 * (lib/canvas/visualPolicy.ts), never per lesson.
 */
// Order matters: the first component whose words match wins, so specific apparatus comes before
// general heating ("Bunsen" also appears on a distillation board), and specific maths before general.
export const FIGURE_COMPONENTS: FigureComponent[] = [
  titration, distillation, filtration, chromatography, gasCollection, heating,
  photosynthesisExperiment,
  atomicStructure, energyProfile, particles,
  punnettSquare, pedigree, dnaStructure,
  circuit, rayLens, fieldLines, standingWave, wave,
  inferenceDistribution,
  circleTheorem, triangle, vectors, probabilityTree, venn,
];

/** For tools that preview a component before it is registered (scripts/figures/preview.tsx). */
export function registerFigureComponent(c: FigureComponent): void {
  if (!FIGURE_COMPONENTS.some((x) => x.name === c.name)) FIGURE_COMPONENTS.push(c);
}

export function figureComponent(name: string): FigureComponent | undefined {
  return FIGURE_COMPONENTS.find((c) => c.name === name);
}

/** The component a board's words call for, if any. */
export function figureFor(text: string): FigureComponent | undefined {
  return FIGURE_COMPONENTS.find((c) => c.match.test(text));
}
