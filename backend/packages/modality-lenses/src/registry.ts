import type { ModalityLens } from "./contract";
import { defaultLens } from "./lenses/default";
import { dyslexiaLens } from "./lenses/dyslexia";

/**
 * The Modality Lens Selector (README 5.1, 5.3). For MVP this is a simple lookup by
 * student-chosen track; the Confusion-Radar-driven dynamic switching described in
 * README 4.3 is Phase 1 — this registry is the seam that feature plugs into later.
 */
export const lensRegistry: Record<ModalityLens["id"], ModalityLens> = {
  default: defaultLens,
  dyslexia: dyslexiaLens,
  // Visual impairment, hearing impairment, ADHD: not yet implemented.
  // Registering them here (pointing at defaultLens) would misrepresent them as built —
  // per README Section 1's honesty clause, they're left out until real lenses exist.
} as Record<ModalityLens["id"], ModalityLens>;

export function getLens(id: ModalityLens["id"]): ModalityLens {
  const lens = lensRegistry[id];
  if (!lens) {
    throw new Error(
      `Modality lens "${id}" is not implemented yet. Implemented: ${Object.keys(lensRegistry).join(", ")}.`
    );
  }
  return lens;
}
