import { buildPdfLessonPlan } from "./pdfLessonPipeline";
import type { SuprnotesAsset, SuprnotesContentBlock, SuprnotesLessonInput } from "./suprnotes";

/**
 * Combine several independently-parsed uploads into the one flat `SuprnotesLessonInput` every
 * downstream consumer already expects — summarizeSourceDocumentForPlanning, focusPassages,
 * documentSectionTitles, and the full lecture-generation prompt all iterate `contentBlocks`
 * flatly and need no changes to read a merged document; only this function needs to exist.
 *
 * WHY MERGE RATHER THAN CARRY N DOCUMENTS. Nothing downstream has ever needed to know "this came
 * from file 2 specifically" as a first-class concept — the planning and lecture prompts already
 * reason over one body of source material. Tagging each block with `documentLabel` (see
 * SuprnotesContentBlock in lib/suprnotes.ts) preserves exactly the information a plural
 * `documents[]` field would have given for free — `new Set(blocks.map(b => b.documentLabel))`
 * reconstructs the file list — without every consumer needing a loop it does not otherwise need.
 *
 * IDS ARE REWRITTEN, NOT JUST BLOCKS TAGGED. Two independently parsed PDFs both number their own
 * blocks and assets from scratch (`pdf-1`, `pdf-2`, ...; see lib/pdfLessonPipeline.ts), so a naive
 * concatenation collides: "block 3 of document A" and "block 3 of document B" would become
 * indistinguishable to every id-keyed lookup (lib/suprnotes.ts uses `block.id` as a Map key in
 * several places). Prefixing every id — on blocks, on their cross-references
 * (assetIds/sourceBlockIds), and on assets — with the document's index keeps every existing
 * id-based lookup correct with zero changes to those lookups themselves.
 *
 * lessonPlan/suggestedLecturePlan ARE REBUILT, NOT REMAPPED. Remapping ids inside that structure
 * would mean parsing an effectively-untyped shape (`unknown` on the wire) defensively in two
 * places instead of one. Rebuilding it via the same `buildPdfLessonPlan` the parse routes
 * themselves call — over the now-merged, already-correctly-id-prefixed blocks and assets — is
 * both simpler and guaranteed self-consistent, since it is the single source of truth for that
 * structure's shape.
 */
export function mergeSourceDocuments(
  docs: { label: string; doc: SuprnotesLessonInput }[],
): SuprnotesLessonInput {
  if (docs.length === 1) return docs[0].doc;

  let sourceOrderOffset = 0;
  const allBlocks: SuprnotesContentBlock[] = [];
  const allAssets: SuprnotesAsset[] = [];

  docs.forEach(({ label, doc }, docIndex) => {
    const prefix = `d${docIndex}-`;
    const remapId = (id: string) => `${prefix}${id}`;

    const blocks = (doc.contentBlocks ?? []).map((block): SuprnotesContentBlock => ({
      ...block,
      id: remapId(block.id),
      assetIds: block.assetIds?.map(remapId),
      sourceOrder: (block.sourceOrder ?? 0) + sourceOrderOffset,
      documentLabel: label,
    }));
    sourceOrderOffset += blocks.length;

    const assets = (doc.assets ?? []).map((asset): SuprnotesAsset => ({
      ...asset,
      id: remapId(asset.id),
      sourceBlockIds: asset.sourceBlockIds?.map(remapId),
    }));

    allBlocks.push(...blocks);
    allAssets.push(...assets);
  });

  const lessonPlan = buildPdfLessonPlan(allBlocks, allAssets);
  const title = docs.length > 1 ? `${docs.length} sources` : docs[0].doc.lesson?.title;

  return {
    ...docs[0].doc,
    lesson: { ...docs[0].doc.lesson, title },
    contentBlocks: allBlocks,
    assets: allAssets,
    lessonPlan,
    suggestedLecturePlan: lessonPlan,
  };
}
