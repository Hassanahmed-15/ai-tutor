import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { costFor } from "./modelPricing";

/**
 * Stage one of board planning: what must this beat's visual actually CONTAIN?
 *
 * WHY THIS EXISTS. Until now every downstream engine was briefed with one sentence derived from the
 * beat title and script, and the classifier read the raw script. That is too little grounding for
 * either job, and it produced a failure worth remembering: a lecture on Support Vector Machines
 * rendered a photograph of a stamp vending machine, labelled "Coin Return Mechanism", because the
 * word "machine" appeared in the beat text. Nothing in the pipeline had ever been asked to state,
 * plainly, what the picture was supposed to be OF.
 *
 * So this asks exactly that, and the answer is used twice: the classifier picks a visual form from
 * it, and whichever engine wins is briefed with it. The `subject` field is the one that closes the
 * SVM hole — it names the thing to depict AND the wrong reading to avoid, so the disambiguation
 * travels with the beat instead of living in a keyword list that cannot tell a support vector
 * machine from a machine.
 */

const MODEL = process.env.OPENAI_VISUAL_SPEC_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o";


export type BeatVisualSpec = {
  /** The exact thing to depict, with the plausible wrong reading ruled out. */
  subject: string;
  /** Named entities, quantities and relationships that must appear. */
  mustShow: string[];
  /** The wrong picture someone could reasonably draw from this beat's words. */
  mustNotShow: string;
  /** True only for a real physical object. Gates the stock-photo path entirely. */
  isPhysical: boolean;
};

export const VISUAL_SPEC_SYSTEM_PROMPT = `You state what ONE teaching beat's picture must contain. Output ONLY JSON — no markdown, no commentary.

{ "subject": string,
  "mustShow": [string, string, string],
  "mustNotShow": string,
  "isPhysical": boolean }

"subject" — the exact thing the picture depicts, in one phrase, WITH the wrong reading ruled out
whenever the words are ambiguous. Technical names collide with everyday objects constantly, and the
picture must never follow the everyday one:
  "Support Vector Machine" -> "the SVM decision boundary and margin between two classes — a machine-learning concept, NOT a physical machine"
  "Random Forest"          -> "an ensemble of decision trees voting — NOT a forest of real trees"
  "Neural Network"         -> "layers of artificial neurons and their weighted connections — NOT computer networking hardware"
  "Kernel trick"           -> "mapping points into a higher-dimensional space so they become separable — NOT a seed or grain"

"mustShow" — 2 to 4 concrete things that have to be visible, naming REAL content from this beat:
actual quantities and ranges, actual stage names, actual before/after states, the actual equation.
Never "a diagram of X", never "relevant labels".

"mustNotShow" — the plausible WRONG picture, in one phrase. If nothing is ambiguous, write "".

"isPhysical" — true ONLY when the subject is a real physical object, organism, organ or apparatus
that could be photographed (a nephron, a volcano, a lathe). An algorithm, a formula, a data trend, a
process of reasoning, a schedule, a proof and a data structure are all false. When in doubt, false:
a photograph of the wrong thing teaches worse than a drawing of the right thing.`;

function costOf(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return costFor(MODEL, usage);
}

/** Returns a clean spec, or null. Never throws — planning must degrade, never break a lecture. */
export function validateBeatVisualSpec(raw: unknown): BeatVisualSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  const subject = typeof o.subject === "string" ? o.subject.trim().slice(0, 300) : "";
  if (!subject) return null;

  const mustShow = (Array.isArray(o.mustShow) ? o.mustShow : [])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim().slice(0, 200))
    .slice(0, 4);
  if (mustShow.length === 0) return null;

  return {
    subject,
    mustShow,
    mustNotShow: typeof o.mustNotShow === "string" ? o.mustNotShow.trim().slice(0, 200) : "",
    // Anything other than an explicit `true` is false. The default has to be the safe one: this
    // flag is what allows a stock photograph, and the failure it guards against was a photo.
    isPhysical: o.isPhysical === true,
  };
}

/** The specification as a single block, for briefing a classifier or an engine. */
export function specToBrief(spec: BeatVisualSpec): string {
  return [
    `Subject: ${spec.subject}`,
    `Must show: ${spec.mustShow.join("; ")}`,
    spec.mustNotShow ? `Must NOT show: ${spec.mustNotShow}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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

export async function planBeatVisual(
  client: OpenAI,
  beat: Beat,
): Promise<{ spec: BeatVisualSpec | null; costUsd: number }> {
  const completion = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 500,
    // A specification, not prose. The same reasoning as the director: at the default temperature
    // the same beat produced different subjects run to run, which makes every downstream decision
    // unreproducible and the classification impossible to judge.
    temperature: 0,
    messages: [
      { role: "system", content: VISUAL_SPEC_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Lecture beat title: ${beat.title}\n\nSpoken script: ${String(beat.script ?? "").slice(0, 1800)}`,
      },
    ],
    response_format: { type: "json_object" },
  });
  return {
    spec: validateBeatVisualSpec(parseJson(completion.choices[0]?.message?.content ?? "")),
    costUsd: costOf(completion.usage),
  };
}
