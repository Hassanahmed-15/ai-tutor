import { titration } from "./components/titration";
import { distillation } from "./components/distillation";
import { filtration } from "./components/filtration";
import { chromatography } from "./components/chromatography";
import { gasCollection } from "./components/gasCollection";
import { heating } from "./components/heating";
import { photosynthesisExperiment } from "./components/photosynthesisExperiment";
import { bonding } from "./components/bonding";
import { latticeStructure } from "./components/latticeStructure";
import { atomicStructure } from "./components/atomicStructure";
import { periodicTable } from "./components/periodicTable";
import { energyProfile } from "./components/energyProfile";
import { rateGraph } from "./components/rateGraph";
import { decayCurve } from "./components/decayCurve";
import { particles } from "./components/particles";
import { heart } from "./components/heart";
import { geneticTech } from "./components/geneticTech";
import { proteinSynthesis } from "./components/proteinSynthesis";
import { antibody } from "./components/antibody";
import { leafCrossSection } from "./components/leafCrossSection";
import { oxygenDebt } from "./components/oxygenDebt";
import { enzymeAction } from "./components/enzymeAction";
import { membraneTransport } from "./components/membraneTransport";
import { cellDivision } from "./components/cellDivision";
import { punnettSquare } from "./components/punnettSquare";
import { pedigree } from "./components/pedigree";
import { dnaStructure } from "./components/dnaStructure";
import { foodWeb } from "./components/foodWeb";
import { ecologicalPyramid } from "./components/ecologicalPyramid";
import { electromagnetism } from "./components/electromagnetism";
import { circuit } from "./components/circuit";
import { rayLens } from "./components/rayLens";
import { reflectionRefraction } from "./components/reflectionRefraction";
import { fieldLines } from "./components/fieldLines";
import { standingWave } from "./components/standingWave";
import { wave } from "./components/wave";
import { motionGraph } from "./components/motionGraph";
import { moments } from "./components/moments";
import { sankey } from "./components/sankey";
import { supplyDemand } from "./components/supplyDemand";
import { ppf } from "./components/ppf";
import { adAs } from "./components/adAs";
import { costRevenue } from "./components/costRevenue";
import { circularFlow } from "./components/circularFlow";
import { scatterPlot } from "./components/scatterPlot";
import { histogram } from "./components/histogram";
import { boxPlot } from "./components/boxPlot";
import { cumulativeFrequency } from "./components/cumulativeFrequency";
import { barChart } from "./components/barChart";
import { pieChart } from "./components/pieChart";
import { inferenceDistribution } from "./components/inferenceDistribution";
import { riemannSum } from "./components/riemannSum";
import { slopeField } from "./components/slopeField";
import { unitCircle } from "./components/unitCircle";
import { argand } from "./components/argand";
import { circleTheorem } from "./components/circleTheorem";
import { parallelLines } from "./components/parallelLines";
import { bearings } from "./components/bearings";
import { coordinateGrid } from "./components/coordinateGrid";
import { numberLine } from "./components/numberLine";
import { shapes3d } from "./components/shapes3d";
import { triangle } from "./components/triangle";
import { vectors } from "./components/vectors";
import { probabilityTree } from "./components/probabilityTree";
import { venn } from "./components/venn";
import { fractionModel } from "./components/fractionModel";
import { sequences } from "./components/sequences";
import { sectorArc } from "./components/sectorArc";
import { functionGraph } from "./components/functionGraph";
import { timeline } from "./components/timeline";
import { causeConsequence } from "./components/causeConsequence";
import { sourceCard } from "./components/sourceCard";
import { evaluationScale } from "./components/evaluationScale";
import { conceptTable } from "./components/conceptTable";
import type { FigureComponent } from "./types";

/**
 * Every figure the board can draw by code. A component is general — one titration serves every
 * titration lesson, whatever the acid, alkali or indicator — and is chosen by what a board is about
 * (lib/canvas/visualPolicy.ts), never per lesson.
 */
// Order matters: the first component whose words match wins, so specific apparatus comes before
// general heating ("Bunsen" also appears on a distillation board), electromagnetism before field lines
// and circuits, the data charts before general graphs, and specific maths before general.
export const FIGURE_COMPONENTS: FigureComponent[] = [
  titration, distillation, filtration, chromatography, gasCollection, heating, photosynthesisExperiment, oxygenDebt,
  bonding, latticeStructure, atomicStructure, periodicTable, energyProfile, rateGraph, decayCurve, particles,
  enzymeAction, membraneTransport, cellDivision, punnettSquare, pedigree, geneticTech, proteinSynthesis, antibody, dnaStructure, leafCrossSection, foodWeb, ecologicalPyramid, heart,
  electromagnetism, circuit, rayLens, reflectionRefraction, fieldLines, standingWave, wave, motionGraph, moments, sankey,
  supplyDemand, ppf, adAs, costRevenue, circularFlow,
  scatterPlot, histogram, boxPlot, cumulativeFrequency, barChart, sectorArc, pieChart, inferenceDistribution,
  riemannSum, slopeField, argand, unitCircle, circleTheorem, sequences, parallelLines, bearings, coordinateGrid, numberLine, shapes3d, triangle, vectors, probabilityTree, venn, fractionModel, functionGraph,
  timeline, causeConsequence, sourceCard, evaluationScale, conceptTable,
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
  // The component whose words the board uses MOST wins (ties go to the earlier, more specific one):
  // first-match let one chemistry phrase win an osmosis board (audit 2026-10-17).
  let best: FigureComponent | undefined;
  let bestCount = 0;
  for (const c of FIGURE_COMPONENTS) {
    if (!c.match.test(text)) continue;
    const count = Math.max(1, (text.match(new RegExp(c.match.source, c.match.flags.includes("g") ? c.match.flags : `${c.match.flags}g`)) ?? []).length);
    if (count > bestCount) { best = c; bestCount = count; }
  }
  return best;
}
