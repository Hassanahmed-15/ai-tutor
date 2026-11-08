// All Tier 1 templates. The router sees this list (ids, titles, topics); the voice model never sees
// the templates themselves, only show_visual and visual_action.
import { z } from "zod/v4";
import type { Template } from "./contract";
import { bstTemplate } from "./templates/cs/bst";
import { sortingTemplate } from "./templates/cs/sorting";
import { neuralNetworkTemplate } from "./templates/cs/neural_network";
import { vectorCrossTemplate } from "./templates/math/vector_cross";
import { surfacePlotTemplate } from "./templates/math/surface_plot";
import { vectors3dTemplate, vectorAddTemplate, vectorDotTemplate } from "./templates/math/vectors";
import { linearTransformTemplate } from "./templates/math/linear_transform";
import { surfaceSlicesTemplate, gradientTemplate, gradientDescentTemplate } from "./templates/math/calculus";
import { solidTemplate } from "./templates/math/solid";
import { arrayMemoryTemplate, linkedListTemplate, stackTemplate } from "./templates/cs/linear";
import { heapTemplate } from "./templates/cs/heap";
import { hashTableTemplate } from "./templates/cs/hash_table";
import { binarySearchTemplate, graphTraversalTemplate } from "./templates/cs/search_graph";
import { eigenTemplate, spanTemplate, planesTemplate } from "./templates/math/la2";
import { tangentPlaneTemplate, doubleIntegralTemplate, parametricTemplate, vectorFieldTemplate } from "./templates/math/calc2";
import { pointsDistanceTemplate, crossSectionTemplate, netUnfoldTemplate } from "./templates/math/geo2";
import { bivariateTemplate, scatterTemplate } from "./templates/math/stats";
import { avlTemplate, trieTemplate } from "./templates/cs/trees2";
import { graphTemplate, dijkstraTemplate, mstTemplate, topoTemplate } from "./templates/cs/graphs2";
import { memoryTemplate, callStackTemplate, pipelineTemplate, osiTemplate } from "./templates/cs/systems";
import { kmeansTemplate, embeddingsTemplate, cnnTemplate } from "./templates/cs/ml2";

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
