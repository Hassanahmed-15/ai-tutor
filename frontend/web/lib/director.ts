import OpenAI from "openai";

/**
 * The board director: one beat in, "what kind of visual is this, and which renderer owns it" out.
 *
 * WHY THE MODEL ONLY CLASSIFIES. Everything learned building this pipeline points the same way: a
 * model asked to obey a long list of board-selection rules ignores most of them (a quota changed
 * from "4-5" to "3-4" produced 5), but a model asked for ONE short classification answers
 * reliably. So the model picks a visual form from eight and nothing else; the form → renderer
 * mapping below is ordinary code and cannot drift.
 *
 * THE TAXONOMY IS NOT INVENTED. Clark & Lyons' communicative functions of instructional graphics
 * (representational, organizational, relational, transformational, interpretive, plus decorative
 * and mnemonic) is the standard carve-up in instructional design, and it maps almost one-to-one
 * onto what these renderers can actually draw.
 *
 * This is measured-in-the-lab work ported from anim-lab, and the mapping is now the same one: every
 * form reaches the renderer that is genuinely best at it, including Vega-Lite for charts and KaTeX
 * for derivations, both of which this codebase now has.
 */

export const VISUAL_FORMS = [
  "plot",
  "network",
  "equation",
  "transformation",
  "labelled-diagram",
  "construction",
  "animated-maths",
  "text",
] as const;
export type VisualForm = (typeof VISUAL_FORMS)[number];

/** The board kinds this codebase can actually fill and render. */
export type BoardKind = "manimScene" | "structureScene" | "morph" | "reactAnimation" | "chalkBoard" | "plotBoard" | "equationBoard";

/**
 * ONE renderer per form — the whole point of the routing.
 *
 *  - plot            Vega-Lite. A declarative grammar of graphics: axes, ticks, binning and
 *                    legends are DERIVED from data rather than drawn, so the chart is exact and
 *                    instant. Manim draws a handsome curve but spends seconds of Python on what is
 *                    usually a static picture.
 *  - network         ELK via structureScene. Layout is COMPUTED, so overlap and clipping are
 *                    unreachable states rather than faults to be caught afterwards.
 *  - equation        KaTeX. A derivation is READ line by line, so it needs typesetting, not video —
 *                    and KaTeX can be asked to throw on bad input, which is what lets the validator
 *                    guarantee that anything reaching the board renders.
 *  - transformation  Morph ops. The only renderer here that interpolates the path itself, so one
 *                    shape genuinely becomes another, and it scrubs both ways.
 *  - labelled-diagram  The React sandbox. The only engine that can draw a SPECIFIC subject — and
 *                    the only one still placing its own coordinates, which is why it needs the
 *                    artwork catalogue and the vision critic.
 *  - construction    Manim. Measured geometry, worth the render.
 *  - animated-maths  Manim. A curve being traced or transformed — where video earns its seconds.
 *  - text            The chalk board. Nothing moves; say so cleanly instead of inventing a diagram.
 */
export const BOARD_FOR: Record<VisualForm, BoardKind> = {
  plot: "plotBoard",
  network: "structureScene",
  equation: "equationBoard",
  transformation: "morph",
  "labelled-diagram": "reactAnimation",
  // MANIM IS NO LONGER A FIRST CHOICE — it is a last resort, reachable only through
  // lib/boardFallback.ts when the preferred engine fails.
  //
  // Its scene vocabulary is six geometric primitives (graph, rect, circle, vector, angle, brace).
  // That is a maths vocabulary, and anything outside it degrades to the nearest available shape:
  // a "Mechanics of Breathing" beat rendered as a bare orange rectangle, because a rectangle was
  // the only container the spec could express. The empty box was the correct answer to an
  // impossible ask.
  //
  // The React sandbox now draws these subjects properly — measured this session, the airways board
  // went from a refused 2/5 to 5/5 with cartilage rings and branching bronchi — and it costs no
  // Python render. So construction and animated-maths route there too. A geometry beat the sandbox
  // genuinely cannot draw still reaches Manim via the fallback chain, which is exactly "only when
  // it is the only choice".
  construction: "reactAnimation",
  "animated-maths": "reactAnimation",
  text: "chalkBoard",
};

/** Clark & Lyons' function each form corresponds to — logged so the routing stays auditable. */
export const FORM_FUNCTION: Record<VisualForm, string> = {
  plot: "relational — a quantitative relationship between variables",
  network: "organizational — how named parts relate to each other",
  equation: "symbolic — a derivation carried out step by step",
  transformation: "transformational — change across time or space",
  "labelled-diagram": "representational / interpretive — a real subject, annotated",
  construction: "interpretive — a measured geometric construction",
  "animated-maths": "transformational — maths that must move to be understood",
  text: "no graphic — a definition, comparison or list",
};

export type DirectorPlan = {
  form: VisualForm;
  board: BoardKind;
  reason: string;
  brief: string;
};

const MODEL = process.env.OPENAI_DIRECTOR_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o";

export const DIRECTOR_SYSTEM_PROMPT = `You classify a teaching beat into the ONE kind of visual it needs. Output ONLY JSON — no markdown, no commentary.

{ "form": "plot" | "network" | "equation" | "transformation" | "labelled-diagram" | "construction" | "animated-maths" | "text",
  "reason": string,
  "brief": string }

Pick by what the visual must DO:
- "plot"             a quantitative relationship between variables: a curve, growth or decay, a rate, a trend, two quantities on shared axes. Real numbers matter.
- "network"          named parts and how they connect: a cycle that returns to its start, a pipeline of stages, a flowchart, a state machine, a hierarchy.
- "equation"         a symbolic or numerical derivation worked step by step: applying a formula, rearranging, substituting values, solving. The MATHS is the content.
- "transformation"   ONE thing literally becoming another: a state change, an expression rewritten as an equivalent one, a shape becoming a different shape.
- "labelled-diagram" a specific real subject drawn and annotated: an organ, an apparatus, a molecule, a device cutaway, a scene.
- "construction"     a measured geometric construction: an angle, vectors adding, a labelled span, a geometric proof.
- "animated-maths"   maths that must MOVE to land: a curve being traced as a value grows, a shape transforming under a rule.
- "text"             a definition, a word comparison, a list, a history. Nothing moves, changes or is measured — a clean text board is the honest answer.

Distinguishing the near-misses:
- "equation" vs "plot": a derivation you READ is "equation"; a relationship you SEE the shape of is "plot". If the beat names a RANGE — over 20 years, from 0 to 10, as n grows — it is "plot", because nobody reads twenty worked lines. A formula applied ONCE to given values is "equation".
- "network" vs "labelled-diagram": boxes joined by arrows is "network"; one real object with parts named is "labelled-diagram". If the beat names a PHYSICAL thing — an organ, a cell, a device, an instrument — it is "labelled-diagram" even when the question is how it works, because its parts ARE the explanation. "network" is for stages that are not themselves objects.
- "transformation" vs "network": ONE thing becoming another is "transformation"; several stages connected is "network".

"reason": one plain sentence on why that form fits THIS beat.
"brief": one dense sentence describing the visual to build, naming the REAL content — actual stage names, actual quantities and ranges, actual before/after states, the actual equation. Never "a diagram about X".

Be honest with "text". Padding a definition with a diagram is worse than a clean text board.`;

/** Returns a clean plan, or null. Never throws — a bad classification must degrade to "no plan"
 *  and leave the beat's existing board alone, which is the pre-director behaviour. */
export function validateDirectorPlan(raw: unknown): DirectorPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const form = typeof o.form === "string" ? o.form.trim() : "";
  if (!(VISUAL_FORMS as readonly string[]).includes(form)) return null;

  const reason = typeof o.reason === "string" ? o.reason.trim().slice(0, 300) : "";
  const brief = typeof o.brief === "string" ? o.brief.trim().slice(0, 400) : "";
  if (!brief && form !== "text") return null;

  return { form: form as VisualForm, board: BOARD_FOR[form as VisualForm], reason, brief };
}

function parseJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export async function direct(
  client: OpenAI,
  beatText: string,
): Promise<{ plan: DirectorPlan | null; costUsd: number }> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 500,
    // Classification, not writing. At the default temperature the same beat drifted between forms
    // run to run — "compound interest over 20 years" came back as `plot` once and `equation` the
    // next — which makes the mapping impossible to judge, because a wrong library and a wrong
    // classification look identical from the outside. The brief is one sentence and loses nothing.
    temperature: 0,
    messages: [
      { role: "system", content: DIRECTOR_SYSTEM_PROMPT },
      { role: "user", content: beatText.slice(0, 2000) },
    ],
    response_format: { type: "json_object" },
  });
  const usage = completion.usage;
  const costUsd = usage ? (usage.prompt_tokens * 2.5) / 1_000_000 + (usage.completion_tokens * 10) / 1_000_000 : 0;
  return { plan: validateDirectorPlan(parseJson(completion.choices[0]?.message?.content ?? "")), costUsd };
}
