import { createHash } from "node:crypto";
import { DIAGRAM_STYLE_VERSION } from "./spec";

/** Shared-store key for a verified vector diagram. Same subject + parts + numbers → one drawing. */
export function diagramCacheKey(subject: string, parts: string[], numbers: Array<number | string> = []): string {
  const signature = JSON.stringify({
    style: DIAGRAM_STYLE_VERSION,
    subject: subject.trim().toLowerCase().replace(/\s+/g, " "),
    parts: [...parts].map((p) => p.trim().toLowerCase()).sort(),
    numbers: [...numbers].map(String).sort(),
  });
  return `asset-${createHash("sha256").update(signature).digest("hex").slice(0, 32)}`;
}
