/**
 * Where a board's lab drawing shows its parts (client only): the living equation asks it for a part's
 * outline (a term flies out of it), its colour (the term is written in it) and to make it glow (as the
 * term arrives). Keyed by the board (lib/canvas/layout.ts labKeyOf), registered by LabDrawingView.
 */
export type LabParts = {
  /** The drawn SVG nodes of these objects (or groups), in the page. */
  nodes(ids: string[]): SVGGraphicsElement[];
  colour(ids: string[]): string | null;
  glow(ids: string[], on: boolean): void;
};

const registry = new Map<string, LabParts>();

export function registerLabParts(key: string, parts: LabParts): () => void {
  registry.set(key, parts);
  return () => { if (registry.get(key) === parts) registry.delete(key); };
}

export const labPartsFor = (key: string | undefined): LabParts | null => (key ? registry.get(key) ?? null : null);
