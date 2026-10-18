export { DIAGRAM_STYLE_VERSION, parseDiagramSpec, flattenElements, numbersInSpec, type DiagramSpec, type DiagramElement } from "./spec";
export { project, clampLat, clampLon, validLonLat } from "./project";
export { checkDiagram, type DiagramCheck } from "./check";
export { compileDiagram, repeatPlacements } from "./render";
export { diagramCacheKey } from "./cache";
export { DIAGRAM_GUIDE, acceptDiagram, diagramUserExtra } from "./write";
export { hasVisualForm, needsVectorDiagram, isRealProcess, isPhotographicAppearance, isPictureSubject, isPictureWorthy, componentFitsSubject, MATH_ONLY, boardWords, GEOMETRY_FORM, MECHANICS_FORM, isGeometryOrMechanics, isCircleGeometry } from "./visualForm";
export { FIXTURES, fixtureBoard, fixtureById, type FixtureBoard } from "./fixtures";
export { baseShapes, worldMapShapes, WORLD_MAP_BOX } from "./bases";
