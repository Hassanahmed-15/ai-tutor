import OpenAI from "openai";
import { nextId } from "@aria/lesson-graph";
import type {
  AnimatedScene,
  AnimationTemplate,
  DrawOp,
  DrawScript,
  DrawShape,
  LessonNode,
  LessonNodeType,
} from "@aria/lesson-graph";
import type { TutorReasoningProvider } from "../provider";
import { ProviderNotConfiguredError } from "../provider";

/**
 * Real LLM-backed Tutor Reasoning provider (OpenAI). Generates a full lesson for ANY
 * topic the student types — not just the seeded mock topics. Output is constrained to
 * the Lesson Graph shape (modality-agnostic beats + optional animated scenes) so the
 * existing renderers, lenses, and interrupt flow all work unchanged.
 *
 * Honesty (README Section 1): the model can still be wrong. For arbitrary typed topics
 * there is no curated corpus to ground against, so beats are not citation-backed and
 * groundingConfidence is left modest — the UI hedges rather than asserting certainty.
 */

const MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

const VALID_TEMPLATES: AnimationTemplate[] = ["process", "shrink", "cycle", "build", "compare", "transform"];
const VALID_NODE_TYPES: LessonNodeType[] = [
  "hook",
  "definition",
  "example",
  "diagram",
  "analogy",
  "checkpoint",
  "recap",
];

const LESSON_SYSTEM_PROMPT = `You are Aria, a live AI tutor that teaches OUT LOUD, like a great human teacher at a whiteboard — not a note-taker. You never dump a summary; you teach beat by beat, showing things that MOVE.

Produce a lesson as a JSON object: { "beats": LessonBeat[] }.

A LessonBeat is:
{
  "type": "hook" | "definition" | "example" | "diagram" | "analogy" | "checkpoint" | "recap",
  "narration": string,            // what the teacher SAYS for this beat — spoken, warm, concrete, 1-3 sentences
  "drawScript"?: DrawScript,      // PREFERRED visual: a live hand-drawn sketch, drawn piece by piece
  "scene"?: AnimatedScene,        // fallback visual: a generic animated template
  "checkpoint"?: { "prompt": string, "expectedAnswerKind": "free-response" | "prediction" | "yes-no" }
}

PREFER drawScript whenever the concept can be DRAWN — a diagram, a structure, a labeled
picture, a map, a timeline, a process you'd sketch on a whiteboard. This makes the board draw
itself live, like a real teacher. Only use "scene" for things that are purely sequential lists.
Put AT MOST ONE visual (drawScript OR scene) on a beat.

A DrawScript draws primitives in timed order on a 0..100 grid (x: left→right, y: top→bottom):
{
  "caption": string,              // short title, e.g. "Drawing a neuron"
  "durationMs": 11000,
  "ops": DrawOp[]                 // 6 to 14 ops, each with "at" = 0..1 (when it starts drawing)
}
DrawOp kinds:
- { "kind":"shape", "shape":"circle"|"rect"|"hexagon", "x","y","w","h", "color"?, "at" }   // an atom/node/box (w,h in grid units ~8-20)
- { "kind":"shape", "shape":"line", "points":[{"x","y"},{"x","y"}], "at" }                  // a bond/connector/edge
- { "kind":"label", "text": string, "x","y", "size":"sm"|"md"|"lg", "color"?, "at" }        // text written on the board (keep SHORT)
- { "kind":"arrow", "x1","y1","x2","y2", "curved"?: boolean, "color"?, "at" }               // a pointing/flow arrow
- { "kind":"note", "text": string, "x","y", "at" }                                          // a handwritten side annotation
- { "kind":"circleHighlight"|"underline", "x","y","w","h", "color"?, "at" }                 // emphasis mark

DrawScript rules:
- Order ops by "at" so it reads as drawn step by step: usually shape, then its label, then the next.
- Spread "at" values from ~0.02 to ~0.95 so the drawing paces out across the timeline.
- Keep within the grid (x,y roughly 10..90 so nothing clips). Center important things near 50,45.
- Use color to teach (e.g. different atoms different colors). Keep labels to 1-3 chars where possible.

An AnimatedScene (fallback only) is:
{
  "template": "process" | "shrink" | "cycle" | "build" | "compare" | "transform",
  "caption": string,
  "steps": [ { "id": string, "label": string (<= 14 chars), "detail"?: string, "emphasis"?: boolean, "side"?: "a" | "b" } ],
  "compareLabels"?: { "a": string, "b": string }
}
(process: sequential steps; shrink: elimination, mark survivor emphasis:true; cycle: a loop; build: assembly; compare: A/B with side+compareLabels; transform: stages.)

Rules:
- 6 to 8 beats total. Start with a "hook" (no visual, vivid spoken hook). Include 2-4 beats WITH a visual (prefer drawScript). Include exactly one "checkpoint" near the end (a question, no visual). End with a "recap" (no visual).
- narration is spoken language: "Watch this — ...", "Notice how ...". Never markdown, never bullet lists.
- Prefer a Socratic, encouraging tone. Be honest if something is uncertain.
- Output ONLY the JSON object. No prose around it.`;

interface RawBeat {
  type?: string;
  narration?: string;
  scene?: unknown;
  drawScript?: unknown;
  checkpoint?: { prompt?: string; expectedAnswerKind?: string };
}

export class OpenAITutorReasoningProvider implements TutorReasoningProvider {
  private client: OpenAI;

  constructor(apiKey: string | undefined = process.env.OPENAI_API_KEY) {
    if (!apiKey) {
      throw new ProviderNotConfiguredError(
        "OPENAI_API_KEY is not set. Add it to apps/web/.env.local to use the OpenAI provider."
      );
    }
    this.client = new OpenAI({ apiKey });
  }

  async planLesson({ subject, topic }: { subject: string; topic: string }): Promise<LessonNode[]> {
    const userPrompt = `Teach this topic live: "${topic}"${
      subject && subject !== "custom" ? ` (subject area: ${subject})` : ""
    }. Build the lesson now.`;

    const beats = await this.requestBeats(userPrompt);
    if (beats.length === 0) {
      throw new Error(`The model returned no usable beats for "${topic}". Try rephrasing the topic.`);
    }
    return beats.map((b) => this.toLessonNode(b, topic));
  }

  async resolveInterrupt({
    interruptedNode,
    studentUtterance,
  }: {
    interruptedNode: LessonNode;
    studentUtterance: string;
  }): Promise<LessonNode[]> {
    const completion = await this.client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are Aria, a live AI tutor. A student interrupted mid-lesson with a question. Answer it briefly and warmly in spoken language (2-4 sentences), staying anchored to what was just being taught. Prefer a concrete analogy. Output ONLY the answer text, no preamble.",
        },
        {
          role: "user",
          content: `You were just teaching about "${interruptedNode.concept}". The student asks: "${studentUtterance}". Answer.`,
        },
      ],
      temperature: 0.7,
    });

    const text = completion.choices[0]?.message?.content?.trim();
    return [
      {
        id: nextId("node"),
        type: "analogy",
        concept: interruptedNode.concept,
        narration: text || `Good question. Let's think about "${studentUtterance}" together.`,
        strategy: "analogy",
      },
    ];
  }

  async evaluateCheckpointResponse({
    node,
    studentResponse,
  }: {
    node: LessonNode;
    studentResponse: string;
  }): Promise<{ understood: boolean; feedback: string }> {
    const completion = await this.client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            'You are Aria, a live AI tutor evaluating a student\'s answer to a checkpoint question. Be encouraging and specific. Return JSON: { "understood": boolean, "feedback": string }. feedback is 1-2 spoken sentences — affirm what is right, gently correct what is missing.',
        },
        {
          role: "user",
          content: `Question asked: "${node.checkpoint?.prompt ?? node.concept}". Student answered: "${studentResponse}". Evaluate.`,
        },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    try {
      const parsed = JSON.parse(raw) as { understood?: boolean; feedback?: string };
      return {
        understood: Boolean(parsed.understood),
        feedback: parsed.feedback?.trim() || "Thanks for trying — let's keep going.",
      };
    } catch {
      return { understood: false, feedback: "Thanks for trying — let's keep going." };
    }
  }

  /** One model call that returns the lesson beats, parsed + retried once on malformed JSON. */
  private async requestBeats(userPrompt: string): Promise<RawBeat[]> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const completion = await this.client.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: LESSON_SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
        response_format: { type: "json_object" },
      });

      const raw = completion.choices[0]?.message?.content ?? "";
      try {
        const parsed = JSON.parse(raw) as { beats?: RawBeat[] };
        if (Array.isArray(parsed.beats) && parsed.beats.length > 0) {
          return parsed.beats;
        }
      } catch {
        // fall through to retry
      }
    }
    throw new Error("The model did not return a valid lesson. Please try again.");
  }

  private toLessonNode(beat: RawBeat, topic: string): LessonNode {
    const type: LessonNodeType = VALID_NODE_TYPES.includes(beat.type as LessonNodeType)
      ? (beat.type as LessonNodeType)
      : "example";

    const node: LessonNode = {
      id: nextId("node"),
      type,
      concept: topic,
      narration: typeof beat.narration === "string" && beat.narration.trim() ? beat.narration.trim() : "Let's keep going.",
      // No curated corpus for arbitrary topics → modest confidence so the UI hedges (honesty clause).
      groundingConfidence: 0.6,
    };

    // drawScript is the preferred visual; only fall back to a generic scene if there's no script.
    const drawScript = this.sanitizeDrawScript(beat.drawScript);
    if (drawScript) {
      node.drawScript = drawScript;
    } else {
      const scene = this.sanitizeScene(beat.scene);
      if (scene) node.scene = scene;
    }

    if (type === "checkpoint") {
      node.checkpoint = {
        prompt: beat.checkpoint?.prompt?.trim() || "What did you take away from this?",
        expectedAnswerKind:
          beat.checkpoint?.expectedAnswerKind === "prediction" ||
          beat.checkpoint?.expectedAnswerKind === "yes-no"
            ? beat.checkpoint.expectedAnswerKind
            : "free-response",
      };
    }

    return node;
  }

  /** Defensive: only keep a scene if it has a valid template and at least one step. */
  private sanitizeScene(raw: unknown): AnimatedScene | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const s = raw as Record<string, unknown>;
    const template = s.template as AnimationTemplate;
    if (!VALID_TEMPLATES.includes(template)) return undefined;
    if (!Array.isArray(s.steps) || s.steps.length === 0) return undefined;

    const steps = s.steps
      .map((step, i) => {
        if (!step || typeof step !== "object") return null;
        const st = step as Record<string, unknown>;
        const label = typeof st.label === "string" ? st.label : "";
        if (!label.trim()) return null;
        return {
          id: typeof st.id === "string" && st.id ? st.id : `step_${i}`,
          label: label.trim(),
          detail: typeof st.detail === "string" ? st.detail : undefined,
          emphasis: Boolean(st.emphasis),
          side: st.side === "a" || st.side === "b" ? (st.side as "a" | "b") : undefined,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (steps.length === 0) return undefined;

    const compareLabels =
      s.compareLabels && typeof s.compareLabels === "object"
        ? {
            a: String((s.compareLabels as Record<string, unknown>).a ?? "A"),
            b: String((s.compareLabels as Record<string, unknown>).b ?? "B"),
          }
        : undefined;

    return {
      template,
      caption: typeof s.caption === "string" ? s.caption : undefined,
      steps,
      compareLabels,
    };
  }

  /** Defensive: keep only valid draw ops; drop the script entirely if none survive. */
  private sanitizeDrawScript(raw: unknown): DrawScript | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const s = raw as Record<string, unknown>;
    if (!Array.isArray(s.ops) || s.ops.length === 0) return undefined;

    const num = (v: unknown, fallback = 50) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
    const validShapes: DrawShape[] = ["circle", "rect", "hexagon", "line", "chain"];

    const ops = s.ops
      .map((rawOp): DrawOp | null => {
        if (!rawOp || typeof rawOp !== "object") return null;
        const o = rawOp as Record<string, unknown>;
        const at = Math.max(0, Math.min(1, num(o.at, 0)));
        const color = typeof o.color === "string" ? o.color : undefined;
        const kind = o.kind;

        if (kind === "shape") {
          const shape = validShapes.includes(o.shape as DrawShape) ? (o.shape as DrawShape) : "circle";
          if ((shape === "line" || shape === "chain")) {
            const points = Array.isArray(o.points)
              ? o.points
                  .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
                  .map((p) => ({ x: num(p.x), y: num(p.y) }))
              : [];
            if (points.length < 2) return null;
            return { kind: "shape", shape, x: num(o.x), y: num(o.y), points, color, at };
          }
          return { kind: "shape", shape, x: num(o.x), y: num(o.y), w: num(o.w, 12), h: num(o.h, 12), color, at };
        }
        if (kind === "label" || kind === "note") {
          const text = typeof o.text === "string" ? o.text.trim() : "";
          if (!text) return null;
          if (kind === "note") return { kind: "note", text, x: num(o.x), y: num(o.y), color, at };
          const size = o.size === "sm" || o.size === "lg" ? o.size : "md";
          return { kind: "label", text, x: num(o.x), y: num(o.y), size, color, at };
        }
        if (kind === "arrow") {
          return { kind: "arrow", x1: num(o.x1), y1: num(o.y1), x2: num(o.x2), y2: num(o.y2), curved: Boolean(o.curved), color, at };
        }
        if (kind === "underline" || kind === "circleHighlight") {
          return { kind, x: num(o.x), y: num(o.y), w: num(o.w, 12), h: num(o.h, 12), color, at };
        }
        return null;
      })
      .filter((x): x is DrawOp => x !== null);

    if (ops.length === 0) return undefined;
    return {
      caption: typeof s.caption === "string" ? s.caption : undefined,
      durationMs: typeof s.durationMs === "number" ? s.durationMs : 11000,
      ops,
    };
  }
}
