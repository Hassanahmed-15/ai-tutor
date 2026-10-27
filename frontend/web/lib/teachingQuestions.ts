/**
 * HOW SHOULD THIS LESSON BE TAUGHT? (owner, 2026-10-24: "ask users how they want the lecture to be taught
 * before generating the plan … questions tailored to the lecture topic, rather than the same generic
 * questions every time … only ask questions that meaningfully affect how the topic will be taught").
 *
 * One model call writes 2–4 questions for THIS topic (code and which language for a programming topic,
 * which subtopics to stress, overview or depth, practical or conceptual, checks or not, what to assume).
 * Each question carries a `kind` and each option a `value`, so the answers can be applied by code — the
 * lesson's depth, its code, its examples and its check cards — and not only read by a model. Every
 * question and answer also goes, as words, to the outline planner and the board planner.
 *
 * Pure (no network): shared by the planning route, the page and the lecture route; unit-tested.
 */

export type TeachingKind = "code" | "depth" | "focus" | "style" | "practice" | "prior" | "other";
export type TeachingQuestion = {
  id: string;
  kind: TeachingKind;
  header: string;
  question: string;
  multi?: boolean;
  options: Array<{ label: string; description?: string; value?: string }>;
};
/** What the student chose, as sent on to planning and the lecture. */
export type TeachingChoice = { kind: TeachingKind; question: string; answer: string; values: string[] };

export const TEACH_TAB_PREFIX = "teach-";

export const TEACHING_QUESTIONS_PROMPT = `You prepare a short set of questions a teacher asks a student BEFORE planning a lesson, to learn how they want THIS topic taught. Write 2 to 4 questions that would really change how this lesson is taught — its approach, depth and emphasis. Never ask what the student already knows of the topic's parts or their goal (other questions cover those), and never ask something the request already answers.

Pick from these kinds, only where they matter for this topic:
- "code": only for a topic that can be taught with code (programming, algorithms, data structures, systems): whether to include code and in which language. Options' value: "none" or a language in lowercase ("python", "java", "c++", "javascript", "pseudocode").
- "depth": a quick overview or a deep explanation. Option values: "overview", "balanced", "deep".
- "focus": which of the topic's subtopics should get more time — a multi-select of 3 to 5 real subtopics of THIS topic, named the way a textbook names them. Option value: the subtopic itself.
- "style": practical examples, concepts and reasons, visual demonstrations, or a mix. Option values: "practical", "conceptual", "visual", "mixed".
- "practice": whether to include quick questions to check understanding. Option values: "none", "some", "lots".
- "prior": what the lesson should assume the student can already do (e.g. "basic Python", "high-school algebra"). Option values: "beginner", "intermediate", "advanced".
- "other": anything else that would genuinely change the lesson for THIS topic (e.g. "which version of TLS", "proof or intuition"). Option value: a short word.

Rules:
- WORD EVERY QUESTION AND OPTION IN THIS TOPIC'S OWN TERMS — never a generic "What style of teaching do you prefer?". For Dijkstra: "Should we trace Dijkstra on a real map of roads, or on an abstract graph?", "Do you want the code beside the trace — in which language?"; for photosynthesis: "Should we follow one leaf through the day, or the chemistry step by step?".
- A topic that can be taught with code (programming, algorithms, data structures, systems) ALWAYS gets the "code" question; any other topic never does.
- At least one question is specific to this topic ("focus", "other", or "code"); at most two of "depth", "style" and "practice".
- Options are short (at most 6 words) with an optional one-line description; 2 to 5 options each; "focus" may be multi-select ("multi": true), every other kind is single-choice. Headers are 1 to 2 words ("Code", "Depth", "Focus", "Examples", "Practice", "Assume", or a short word for "other").
Return JSON only:
{"questions": [{"id": "short-id", "kind": one of the kinds, "header": string, "question": string, "multi": boolean, "options": [{"label": string, "description": string, "value": string}]}]}`;

const KINDS: TeachingKind[] = ["code", "depth", "focus", "style", "practice", "prior", "other"];
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);

/** The model's questions, kept only when usable; at most 4, one per kind except "other". */
export function sanitizeTeachingQuestions(raw: unknown): TeachingQuestion[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { questions?: unknown }).questions) ? (raw as { questions: unknown[] }).questions : [];
  const out: TeachingQuestion[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const kind = KINDS.includes(r.kind as TeachingKind) ? (r.kind as TeachingKind) : "other";
    if (kind !== "other" && out.some((q) => q.kind === kind)) continue;
    const question = clean(r.question, 160);
    const options = (Array.isArray(r.options) ? r.options : [])
      .map((o): Record<string, unknown> => (o && typeof o === "object" ? (o as Record<string, unknown>) : { label: o }))
      .map((o) => ({ label: clean(o.label, 48), description: clean(o.description, 90), value: clean(o.value, 40).toLowerCase() }))
      .filter((o, i, all) => o.label && all.findIndex((x) => x.label.toLowerCase() === o.label.toLowerCase()) === i)
      .slice(0, 5)
      .map((o) => ({ label: o.label, ...(o.description ? { description: o.description } : {}), ...(o.value ? { value: o.value } : {}) }));
    if (!question || options.length < 2) continue;
    const id = slug(clean(r.id, 40) || kind) || kind;
    out.push({ id: out.some((q) => q.id === id) ? `${id}-${out.length}` : id, kind, header: clean(r.header, 14) || kind[0].toUpperCase() + kind.slice(1), question, ...(kind === "focus" && r.multi !== false ? { multi: true } : {}), options });
    if (out.length >= 4) break;
  }
  return out;
}

/** The chosen labels as choices: each answer with the values its options carry (typed answers have none). */
export function teachingChoices(questions: TeachingQuestion[], answers: Record<string, string[]>): TeachingChoice[] {
  return questions.flatMap((q) => {
    const picked = (answers[q.id] ?? []).filter(Boolean);
    if (!picked.length) return [];
    const values = picked.map((label) => q.options.find((o) => o.label === label)?.value ?? "").filter(Boolean);
    return [{ kind: q.kind, question: q.question, answer: picked.join(", "), values }];
  });
}

export function sanitizeTeachingChoices(raw: unknown): TeachingChoice[] {
  return (Array.isArray(raw) ? raw : []).flatMap((c) => {
    if (!c || typeof c !== "object") return [];
    const r = c as Record<string, unknown>;
    const question = clean(r.question, 160);
    const answer = clean(r.answer, 300);
    if (!question || !answer) return [];
    return [{ kind: KINDS.includes(r.kind as TeachingKind) ? (r.kind as TeachingKind) : "other", question, answer, values: (Array.isArray(r.values) ? r.values : []).map((v) => clean(v, 40).toLowerCase()).filter(Boolean).slice(0, 6) }];
  }).slice(0, 6);
}

/** What the answers set by code: the lesson's depth, its code, its examples, its checks and its level. */
export type TeachingSettings = {
  depth?: "concise" | "balanced" | "deep";
  code?: { include: boolean; language?: string };
  examples?: "visual" | "real-world" | "worked" | "mixed";
  practice?: "none" | "some" | "lots";
  expertise?: "beginner" | "intermediate" | "advanced";
  focus?: string[];
};

export function teachingSettings(choices: TeachingChoice[]): TeachingSettings {
  const s: TeachingSettings = {};
  for (const c of choices) {
    const v = c.values[0];
    if (c.kind === "depth" && v) s.depth = v === "overview" ? "concise" : v === "deep" ? "deep" : "balanced";
    // "document": a reference PDF's own code, in its own language (no language is asked of a PDF's question).
    if (c.kind === "code" && v) s.code = v === "none" ? { include: false } : v === "document" ? { include: true } : { include: true, language: v };
    if (c.kind === "style" && v) s.examples = v === "practical" ? "real-world" : v === "visual" ? "visual" : v === "conceptual" ? "worked" : "mixed";
    if (c.kind === "practice" && (v === "none" || v === "some" || v === "lots")) s.practice = v;
    if (c.kind === "prior" && (v === "beginner" || v === "intermediate" || v === "advanced")) s.expertise = v;
    if (c.kind === "focus") s.focus = (c.values.length ? c.values : c.answer.split(/,\s*/)).slice(0, 5);
  }
  return s;
}

/**
 * The outline's parts the student asked to stress ("focus"): a part whose title shares a word with an
 * emphasised subtopic. The lecture route gives these the full board budget of a new part.
 */
export function emphasisedParts(titles: string[], focus: string[] | undefined): Set<number> {
  const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{4,}/g) ?? []).map((w) => w.replace(/(?:ation|ing|es|s)$/, "")));
  const wanted = (focus ?? []).map(words);
  const out = new Set<number>();
  titles.forEach((title, i) => {
    const have = words(title);
    if (wanted.some((w) => [...w].some((x) => have.has(x)))) out.add(i);
  });
  return out;
}

/** The answers as a rule for the outline planner and the board planner. */
export function teachingLine(choices: TeachingChoice[]): string {
  if (!choices.length) return "";
  const s = teachingSettings(choices);
  const rules = [
    s.depth === "concise" ? "Keep it to an overview: AT MOST 4 parts, the essentials and one example each, no side topics." : s.depth === "deep" ? "Go deep: up to 8 parts, each explained fully, with the reasons and the harder cases." : "",
    s.code?.include === false ? "Include NO code — teach it with pictures and words." : s.code?.language ? `Show code in ${s.code.language === "pseudocode" ? "pseudocode" : s.code.language} (never another language).` : "",
    s.examples === "real-world" ? "Teach through practical, real-world examples." : s.examples === "worked" ? "Lead with the concepts and the reasons behind them." : s.examples === "visual" ? "Show every idea with a visual demonstration." : "",
    s.practice === "none" ? "No practice questions." : s.practice === "lots" ? "Check understanding often, with a quick question after each part." : "",
    s.focus?.length ? `Give more time to: ${s.focus.join("; ")}.` : "",
  ].filter(Boolean);
  return `\nHOW THE STUDENT WANTS THIS LESSON TAUGHT (their answers before planning — follow them in the parts, their depth, the examples and the activities):\n${choices.map((c) => `Q: ${c.question}\nA: ${c.answer}`).join("\n")}${rules.length ? `\nSo: ${rules.join(" ")}` : ""}`;
}
