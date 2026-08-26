import type { SuprnotesLessonInput } from "./suprnotes";

export type DocumentPlanningOption = {
  label: string;
  instruction: string;
  /** Present only on the scope question. null means the complete selected source. */
  focus?: string | null;
};

export type DocumentPlanningQuestion = {
  kind: "scope" | "emphasis";
  question: string;
  options: DocumentPlanningOption[];
};

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? value as UnknownRecord : null;
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string") return "";
  const title = value.replace(/\s+/g, " ").trim();
  if (!title || /^(page|slide|section|figure|table)\s*[\d.:_-]*$/i.test(title)) return "";
  return title.slice(0, 100);
}

/** Ordered, human-readable concepts already present in the parser's grounded lesson plan. */
export function documentSectionTitles(sourceDocument: unknown): string[] {
  const doc = record(sourceDocument);
  if (!doc) return [];
  const plan = record(doc.lessonPlan) ?? record(doc.suggestedLecturePlan);
  const beats = Array.isArray(plan?.beats) ? plan.beats : [];
  const fromPlan = beats.flatMap((beat) => {
    const rec = record(beat);
    const title = cleanTitle(rec?.title);
    return title ? [title] : [];
  });
  const blocks = Array.isArray(doc.contentBlocks) ? doc.contentBlocks : [];
  const fromBlocks = blocks.flatMap((block) => {
    const rec = record(block);
    const title = cleanTitle(rec?.heading);
    return title ? [title] : [];
  });
  const seen = new Set<string>();
  return [...fromPlan, ...fromBlocks].filter((title) => {
    const key = title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isWholeDocumentRequest(value: string): boolean {
  const text = value.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
  return /\b(whole|entire|complete|all)\b/.test(text) && /\b(pdf|document|deck|presentation|slides?|pages?|thing|source|file)\b/.test(text);
}

/** A real question should bypass planning; a title or pointing phrase should not. */
export function isSpecificDocumentRequest(value: string, sourceDocument?: unknown): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || isWholeDocumentRequest(text)) return false;
  if (/^(this|that|these|those|it|the document|the pdf|the slides?|the presentation)$/i.test(text)) return false;
  if (/^(teach|explain|cover|go through|walk me through)\s+(this|that|it|the document|the pdf|the slides?|the presentation)[.!?]*$/i.test(text)) return false;

  const doc = record(sourceDocument);
  const lesson = record(doc?.lesson);
  const sourceTitle = cleanTitle(lesson?.title).toLowerCase();
  if (sourceTitle && text.toLowerCase() === sourceTitle) return false;

  const asksQuestion = /\?|\b(what|why|how|when|where|which|compare|difference|derive|prove|solve|explain how|explain why)\b/i.test(text);
  return asksQuestion || text.split(/\s+/).length >= 6;
}

/** Ask only when the selected source genuinely contains several teachable concepts. */
export function shouldPlanDocumentScope(sourceDocument: unknown, request: string): boolean {
  if (isWholeDocumentRequest(request) || isSpecificDocumentRequest(request, sourceDocument)) return false;
  const doc = record(sourceDocument);
  const blocks = Array.isArray(doc?.contentBlocks) ? doc.contentBlocks.length : 0;
  return documentSectionTitles(sourceDocument).length >= 4 || blocks >= 6;
}

/** Guaranteed scope question if the planning model returns malformed or generic output. */
export function fallbackDocumentScopeQuestion(sourceDocument: unknown): DocumentPlanningQuestion | null {
  const titles = documentSectionTitles(sourceDocument).slice(0, 3);
  if (titles.length < 2) return null;
  return {
    kind: "scope",
    question: `This source covers ${titles.join(", ")}${documentSectionTitles(sourceDocument).length > titles.length ? ", and more" : ""}. What should this lesson cover?`,
    options: [
      {
        label: "Whole source",
        instruction: "Teach the complete selected source in its existing order without omitting sections.",
        focus: null,
      },
      ...titles.map((title) => ({
        label: title.slice(0, 40),
        instruction: `Teach only the source material about ${title}, in depth, without unrelated sections.`,
        focus: title,
      })),
    ],
  };
}

export function sanitizeDocumentPlanningQuestions(
  raw: unknown,
  sourceDocument: SuprnotesLessonInput,
): DocumentPlanningQuestion[] {
  const obj = record(raw);
  const rawQuestions = Array.isArray(obj?.planningQuestions) ? obj.planningQuestions : [];
  const questions: DocumentPlanningQuestion[] = [];

  for (const item of rawQuestions) {
    const rec = record(item);
    const kind = rec?.kind === "scope" || rec?.kind === "emphasis" ? rec.kind : null;
    const question = typeof rec?.question === "string" ? rec.question.trim().slice(0, 220) : "";
    const rawOptions = Array.isArray(rec?.options) ? rec.options : [];
    const options: DocumentPlanningOption[] = [];
    for (const itemOption of rawOptions) {
      const option = record(itemOption);
      const label = typeof option?.label === "string" ? option.label.trim().slice(0, 50) : "";
      const instruction = typeof option?.instruction === "string" ? option.instruction.trim().slice(0, 360) : "";
      if (!label || !instruction) continue;
      if (kind === "scope") {
        const focus = option && Object.hasOwn(option, "focus")
          ? (typeof option.focus === "string" && option.focus.trim() ? option.focus.trim().slice(0, 240) : null)
          : undefined;
        if (focus === undefined) continue;
        options.push({
          label,
          instruction: focus === null
            ? "Teach the complete selected source in its existing order without omitting sections."
            : `Teach only the source material about ${focus}, in depth, without unrelated sections.`,
          focus,
        });
      } else {
        options.push({
          label,
          instruction: `${instruction.replace(/[.\s]+$/, "")}. Use only material present in the uploaded source.`,
        });
      }
      if (options.length >= 4) break;
    }
    if (kind && question && options.length >= 2) questions.push({ kind, question, options });
    if (questions.length >= 2) break;
  }

  const scope = questions.find((question) => question.kind === "scope");
  const validScope = scope?.options.some((option) => option.focus === null)
    && scope.options.some((option) => typeof option.focus === "string" && option.focus.length > 0);
  const fallback = fallbackDocumentScopeQuestion(sourceDocument);
  const result: DocumentPlanningQuestion[] = [];
  if (validScope && scope) {
    const namedFocuses = scope.options
      .flatMap((option) => typeof option.focus === "string" ? [option.focus] : [])
      .slice(0, 3);
    result.push({
      ...scope,
      question: `This source covers ${namedFocuses.join(", ")}${documentSectionTitles(sourceDocument).length > namedFocuses.length ? ", and more" : ""}. What should this lesson cover?`,
    });
  }
  else if (fallback) result.push(fallback);
  const emphasis = questions.find((question) => question.kind === "emphasis");
  if (emphasis) {
    const labels = emphasis.options.map((option) => option.label).slice(0, 3);
    result.push({
      ...emphasis,
      question: `Within ${labels.join(" and ")}, what should receive the most attention?`,
    });
  }
  return result;
}
