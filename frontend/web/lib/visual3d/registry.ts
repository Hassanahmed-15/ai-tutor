// All Tier 1 templates. The router sees this list (ids, titles, topics); the voice model never sees
// the templates themselves, only show_visual and visual_action.
import { z } from "zod/v4";
import type { Template } from "./contract.ts";
import { bstTemplate } from "./templates/cs/bst.ts";
import { sortingTemplate } from "./templates/cs/sorting.ts";
import { neuralNetworkTemplate } from "./templates/cs/neural_network.ts";
import { vectorCrossTemplate } from "./templates/math/vector_cross.ts";
import { surfacePlotTemplate } from "./templates/math/surface_plot.ts";
import { vectors3dTemplate, vectorAddTemplate, vectorDotTemplate } from "./templates/math/vectors.ts";
import { linearTransformTemplate } from "./templates/math/linear_transform.ts";
import { surfaceSlicesTemplate, gradientTemplate, gradientDescentTemplate } from "./templates/math/calculus.ts";
import { solidTemplate } from "./templates/math/solid.ts";
import { arrayMemoryTemplate, linkedListTemplate, stackTemplate } from "./templates/cs/linear.ts";
import { heapTemplate } from "./templates/cs/heap.ts";
import { hashTableTemplate } from "./templates/cs/hash_table.ts";
import { binarySearchTemplate, graphTraversalTemplate } from "./templates/cs/search_graph.ts";
import { eigenTemplate, spanTemplate, planesTemplate } from "./templates/math/la2.ts";
import { tangentPlaneTemplate, doubleIntegralTemplate, parametricTemplate, vectorFieldTemplate } from "./templates/math/calc2.ts";
import { pointsDistanceTemplate, crossSectionTemplate, netUnfoldTemplate } from "./templates/math/geo2.ts";
import { bivariateTemplate, scatterTemplate } from "./templates/math/stats.ts";
import { avlTemplate, trieTemplate } from "./templates/cs/trees2.ts";
import { graphTemplate, dijkstraTemplate, mstTemplate, topoTemplate } from "./templates/cs/graphs2.ts";
import { memoryTemplate, callStackTemplate, pipelineTemplate, osiTemplate } from "./templates/cs/systems.ts";
import { kmeansTemplate, embeddingsTemplate, cnnTemplate } from "./templates/cs/ml2.ts";

export const TEMPLATES: Template[] = [
  // math
  vectors3dTemplate, vectorAddTemplate, vectorDotTemplate, vectorCrossTemplate, linearTransformTemplate,
  surfacePlotTemplate, surfaceSlicesTemplate, gradientTemplate, solidTemplate,
  eigenTemplate, spanTemplate, planesTemplate, tangentPlaneTemplate, doubleIntegralTemplate, parametricTemplate, vectorFieldTemplate,
  pointsDistanceTemplate, crossSectionTemplate, netUnfoldTemplate, bivariateTemplate, scatterTemplate,
  // cs
  arrayMemoryTemplate, linkedListTemplate, stackTemplate, bstTemplate, heapTemplate, hashTableTemplate,
  sortingTemplate, binarySearchTemplate, graphTraversalTemplate, neuralNetworkTemplate, gradientDescentTemplate,
  avlTemplate, trieTemplate, graphTemplate, dijkstraTemplate, mstTemplate, topoTemplate,
  memoryTemplate, callStackTemplate, pipelineTemplate, osiTemplate, kmeansTemplate, embeddingsTemplate, cnnTemplate,
];

const byId = new Map(TEMPLATES.map((t) => [t.id, t]));
if (byId.size !== TEMPLATES.length) throw new Error("two templates share an id");

export const getTemplate = (id: string | null | undefined): Template | undefined => (id ? byId.get(id) : undefined);
export const templateIds = (): string[] => TEMPLATES.map((t) => t.id);

/** What the router's LLM classifier is shown (so it can only pick real ids). */
export const registryList = () => TEMPLATES.map((t) => ({ id: t.id, domain: t.domain, family: t.family, title: t.title, topics: t.topics }));

/** JSON Schema of a template's data, for tool descriptions and for the classifier. */
export function dataSchema(id: string): unknown {
  const t = byId.get(id);
  return t ? z.toJSONSchema(t.schema) : null;
}
