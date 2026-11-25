import type { SuprnotesAsset, SuprnotesLessonInput } from "../suprnotes";
import type { CanvasPlanBeat } from "./types";

/**
 * THE STUDENT'S OWN FIGURES ON THE BOARD (owner, 2026-11-25: "for reference do show cropped also").
 *
 * An uploaded PDF's figures are found and cropped at 400 DPI when it is read (app/api/parse-pdf), and a
 * reference-mode lecture used to throw every crop away and redraw the figure instead. Now the planner is
 * shown the figures (`figureIndex`), names the one a board teaches in its "source.figure", and that board
 * puts up the crop itself (lib/canvas/pdfFigurePicture.ts), its parts pointed at as Aria names them.
 *
 * STRICT mode never shows a crop: its PDF is on screen beside the board already (owner, the same day).
 * Pure, so it is unit-tested (lib/anim/pdfFigures.test.ts).
 */

export type PdfFigure = {
  /** "F1", "F2" … in page order: what the planner writes in "source.figure". */
  id: string;
  assetId: string;
  pageNumber: number;
  caption: string;
  description: string;
};

const STOP = new Set("the a an and or of to in on for with by as at from is are be this that its it figure fig shows shown show before after two one side panel labeled labelled diagram diagrams".split(" "));
const stems = (t: string) => [...new Set((t.toLowerCase().match(/[a-z]{3,}|\d+/g) ?? []).filter((w) => !STOP.has(w)).map((w) => (/\d/.test(w) ? w : w.replace(/(ies|es|s|ed|ing)$/, "").slice(0, 6))))];

/** A crop the board can put up: an image the parser kept, of a figure, not a table or a whole page. */
function usable(asset: SuprnotesAsset): boolean {
  if (typeof asset.url !== "string" || !/^data:image\/(png|jpe?g);base64,/.test(asset.url)) return false;
  if (typeof asset.pageNumber !== "number") return false;
  if (asset.visionVerified === false) return false;
  // A table is taught as a table board, from its words.
  if (/table/i.test(`${asset.type ?? ""} ${asset.visualType ?? ""}`)) return false;
  const box = asset.bbox;
  // A crop of most of the page is the page, not a figure.
  if (box && box.width * box.height > 0.6) return false;
  return true;
}

/** The document's figures a reference board may show, in page order, numbered F1, F2 … */
export function documentFigures(doc: SuprnotesLessonInput | null | undefined): PdfFigure[] {
  return (doc?.assets ?? [])
    .filter(usable)
    .sort((a, b) => (a.pageNumber as number) - (b.pageNumber as number) || (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0))
    .slice(0, 12)
    .map((asset, i) => ({
      id: `F${i + 1}`,
      assetId: asset.id,
      pageNumber: asset.pageNumber as number,
      caption: (asset.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      description: (asset.description ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    }));
}

/** What the planner is told about the figures, and how to use them. */
export function figureIndex(figures: PdfFigure[]): string {
  if (!figures.length) return "";
  return [
    "THE DOCUMENT'S OWN FIGURES — cropped from its pages; a board can SHOW one exactly as printed:",
    ...figures.map((f) => `[${f.id}] page ${f.pageNumber} — ${f.caption || "(no caption)"}${f.description ? ` — it shows: ${f.description}` : ""}`),
    `- A board that teaches what one of these figures shows SHOWS it: put its id in that board's "source" ("figure": "F2"), make the board an "illustration", and walk through the figure itself in the script — what each part is, in the order you point at it (its labels, its panels (a) and (b), its values), so every part the student sees is named as it is pointed at. Never redraw a figure listed here, and never describe a figure the board does not show.`,
    "- The ids F1, F2 … are ONLY for \"source.figure\": never say or write them — the student's document does not use them. Name a figure as the document prints it (\"Figure 2\", \"the ear diagram\") or say \"this figure\".",
    "- Each figure goes on at most one board, and a board shows at most one figure. Code boards never take a figure. A figure no board needs is left out.",
    "- In a data-structures or algorithms lesson this is the one exception to \"never an illustration\": a board that SHOWS one of these figures (the book's own before-and-after trees, say) is an illustration board, and the boards that RUN an operation still draw the structure beside the code.",
  ].join("\n");
}

/** The board's own words, for matching it to a figure. */
const boardWords = (beat: Pick<CanvasPlanBeat, "title" | "brief" | "script">) => new Set(stems(`${beat.title} ${beat.brief} ${beat.script}`));

function share(figure: PdfFigure, words: Set<string>): number {
  const want = stems(`${figure.caption} ${figure.description}`);
  if (!want.length) return 0;
  return want.filter((w) => words.has(w)).length / Math.min(want.length, 12);
}

/**
 * Each figure on the board that teaches it: the planner's choice when it names a real figure that no
 * other board took; otherwise the board that teaches the figure's page and shares most of its words
 * (at least a third of them). Boards that show code, run an exam or refresh earlier learning never take one.
 * The chosen board becomes an illustration board showing that figure.
 */
export function assignFigures<T extends CanvasPlanBeat>(beats: T[], figures: PdfFigure[]): { beats: T[]; log: string[] } {
  if (!figures.length) return { beats, log: [] };
  const byId = new Map(figures.map((f) => [f.id.toUpperCase(), f]));
  const taken = new Map<string, string>();
  const log: string[] = [];
  const out = beats.map((b) => ({ ...b }));
  const eligible = (b: T) => !b.refresher && !b.overview && b.stage !== "code" && b.stage !== "exam";
  // The planner's choices first.
  for (const beat of out) {
    const asked = beat.source?.figure?.toUpperCase();
    const figure = asked ? byId.get(asked) : undefined;
    if (!figure || !eligible(beat) || [...taken.values()].includes(figure.id)) continue;
    taken.set(beat.id, figure.id);
  }
  // Then — only when the planner named no figure at all (it was not told of them, or ignored them) — each
  // figure on the board that plainly teaches it. A planner that chose some figures left the others out on
  // purpose: BST deletion's insertion figure went on the deletion overview by its words (replay, 2026-11-25).
  const plannerChose = taken.size > 0;
  for (const figure of plannerChose ? [] : figures) {
    if ([...taken.values()].includes(figure.id)) continue;
    let best: { id: string; score: number } | null = null;
    for (const beat of out) {
      // A board the planner gave a drawn structure keeps it: only the planner may swap a structure for a figure.
      if (!eligible(beat) || beat.stage === "structure" || taken.has(beat.id)) continue;
      const onPage = (beat.source?.pages ?? []).includes(figure.pageNumber);
      const score = share(figure, boardWords(beat)) + (onPage ? 0.2 : 0);
      if ((onPage || score >= 0.5) && score >= 0.34 && score > (best?.score ?? 0)) best = { id: beat.id, score };
    }
    if (best) {
      taken.set(best.id, figure.id);
      log.push(`${figure.id} (page ${figure.pageNumber}) matched to ${best.id} by its words`);
    }
  }
  for (const beat of out) {
    const id = taken.get(beat.id);
    const figure = id ? byId.get(id) : undefined;
    if (!figure) continue;
    if (beat.stage !== "illustration") log.push(`${beat.id}: ${beat.stage} → illustration (shows the document's ${figure.id}, page ${figure.pageNumber})`);
    else log.push(`${beat.id}: shows the document's ${figure.id} (page ${figure.pageNumber})`);
    Object.assign(beat, {
      stage: "illustration" as const,
      pdfFigure: { id: figure.id, assetId: figure.assetId, pageNumber: figure.pageNumber, caption: figure.caption, description: figure.description },
      figure: undefined,
      figureAsset: undefined,
      plannedFigure: undefined,
      mathsPicture: undefined,
      pictureBeside: undefined,
      written: false,
      ...(beat.interaction === "try" ? { interaction: null } : {}),
    });
    if (beat.source && !beat.source.pages.includes(figure.pageNumber)) beat.source = { ...beat.source, pages: [...beat.source.pages, figure.pageNumber] };
  }
  return { beats: out, log };
}

/** The name the document itself prints for a figure ("Figure 19.3"), or "the figure" when its caption has none. */
export function printedFigureName(figure: Pick<PdfFigure, "caption">): string {
  return figure.caption.match(/^\s*((?:fig(?:ure)?\.?|diagram|image)\s*\d+(?:\.\d+)?[a-z]?)/i)?.[1].replace(/^fig(?:ure)?\.?\s*/i, "Figure ").replace(/\s+/g, " ") ?? "the figure";
}

/**
 * THE PLANNER'S FIGURE IDS ARE NEVER SPOKEN (tester, 2026-11-25: Aria said "Figure F2", which the PDF does not
 * have): "Figure F2", "figure F2", "(F2)" and a bare "F2" become the name the document prints for that figure.
 */
export function speakableFigureRefs(text: string, figures: PdfFigure[], documentText = ""): string {
  if (!figures.length || !/\bF\d{1,2}\b/.test(text)) return text;
  const name = (id: string) => { const f = figures.find((x) => x.id === id.toUpperCase()); return f ? printedFigureName(f) : "the figure"; };
  // A bare "F1" the document itself uses is its own word (genetics' F1 generation, a keyboard's F2 key): kept.
  const ownWord = (id: string) => new RegExp(`\\b${id}\\b`).test(documentText);
  return text
    .replace(/\(\s*(F\d{1,2})\s*\)/g, (m, id: string) => (ownWord(id) ? m : ""))
    .replace(/\b(?:the\s+)?(?:figure|fig\.?|diagram)\s+(F\d{1,2})\b/gi, (_m, id: string) => name(id))
    .replace(/\b(F\d{1,2})\b/g, (m, id: string) => (ownWord(id) ? m : name(id)))
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1");
}

/** The lines a figure board's writer is given: the figure is the PDF's own, the board names its parts. */
export function figureBoardLines(figure: NonNullable<CanvasPlanBeat["pdfFigure"]>): string[] {
  return [
    `THIS BOARD SHOWS THE STUDENT'S OWN FIGURE, cropped from page ${figure.pageNumber} of their PDF: ${figure.caption || "(no caption)"}.${figure.description ? ` It shows: ${figure.description}` : ""}`,
    "It is an \"illustration\" board and the picture is that crop — nothing is drawn or generated. In \"parts\", list the parts of THIS figure that the script names, each named exactly as it is printed or drawn on it (a node's value such as \"5\", a panel such as \"(a)\", a printed label), each on the sentence that points at it. Leave \"labels\" empty: the figure's labels are already printed on it.",
  ];
}
