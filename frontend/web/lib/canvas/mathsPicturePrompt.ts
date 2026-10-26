import { createHash } from "node:crypto";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";
import { parsePictureFields, type PictureFields } from "./coursePicturePrompt";

/**
 * A MATHS BOARD'S PICTURE, IN THE BOARD'S OWN LOOK (owner, 2026-10-25: "for prompting and PDFs … only maths
 * … I don't think the maths fixed library is going to cover all the things, so I want to use gpt-image-2 …
 * black background, white diagram, white labels, textbook diagrams … the full board context shown while
 * generating the prompt and a good minimal image"). Only a maths lecture from a typed prompt or a PDF, and
 * only a board that needs a drawing no code figure fits (lib/canvas/visualPolicy.ts `mathsPicture`): a code
 * figure still comes first, and course lessons keep their own pictures (lib/canvas/coursePicture.ts).
 *
 * Pure: the board's context, the planner's instructions and the image prompt. The drawing, its checks and
 * where its labels point are lib/canvas/mathsPicture.ts.
 */

export type MathsBoardContext = {
  /** The lecture's topic, as the student asked it. */
  topic: string;
  board: string;
  brief: string;
  /** What the board's plan names. */
  objects: string[];
  /** What is written on the board beside the picture: heading, notes on their sentences. */
  written: string[];
  /** Every sentence Aria says on this board, in order. */
  sentences: string[];
  mustShow: string[];
  /** A PDF lecture: what the student's document says for this board. */
  source: string[];
  /** A strict PDF lecture: the picture may show only what the document says. */
  strict: boolean;
  /**
   * THE WHOLE LECTURE (owner, 2026-10-26: "give the full context of the lecture of what's going on to
   * gpt-image-2"): every board in order, where this one sits, what the boards before it wrote and drew —
   * so its figure uses the same letters, numbers and example — and what comes next.
   */
  lecture: { outline: string[]; position: string; earlier: string[]; next: string };
};

/** What one earlier board showed: its heading, what it wrote, and its picture's description. */
type EarlierBoard = { heading?: string; notes?: Array<{ text: string }>; stage?: { kind: string; description?: string; subject?: string; picture?: { description?: string; subject?: string } } } | undefined;

function lectureContext(plan: CanvasPlanBeat[], index: number, earlier: EarlierBoard[]): MathsBoardContext["lecture"] {
  const sentences = (script: string) => (script.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []).map((x) => x.trim()).filter(Boolean);
  const outline = plan.map((b, i) => `${i + 1}. ${b.title}${b.brief && b.brief !== b.title ? ` — ${b.brief.slice(0, 140)}` : ""}${i === index ? "  ← THIS BOARD" : ""}`).slice(0, 24);
  // The four boards before this one: what was written and drawn (as built), else what was planned.
  const before = plan.slice(Math.max(0, index - 4), index).map((b, k) => {
    const i = Math.max(0, index - 4) + k;
    const built = earlier[i];
    const picture = built?.stage?.kind === "illustration" ? built.stage.description || built.stage.subject : built?.stage?.picture ? built.stage.picture.description || built.stage.picture.subject : undefined;
    const wrote = (built?.notes ?? []).map((n) => n.text).filter(Boolean).slice(0, 6).join("; ");
    return `Board ${i + 1} "${built?.heading ?? b.title}": ${wrote ? `wrote ${wrote}` : `taught ${sentences(b.script).slice(0, 2).join(" ").slice(0, 300)}`}${picture ? `; its picture: ${String(picture).slice(0, 300)}` : ""}`;
  });
  const after = plan[index + 1];
  return { outline, position: `board ${index + 1} of ${plan.length}`, earlier: before, next: after ? `${after.title}${after.brief && after.brief !== after.title ? ` — ${after.brief.slice(0, 140)}` : ""}` : "this is the last board" };
}

export function mathsBoardContext(topic: string, beat: CanvasPlanBeat, options: { source?: string[]; strict?: boolean; plan?: CanvasPlanBeat[]; index?: number; earlier?: EarlierBoard[] } = {}): MathsBoardContext {
  const plan = options.plan?.length ? options.plan : [beat];
  const index = options.index ?? Math.max(0, plan.indexOf(beat));
  return {
    topic: topic.slice(0, 160),
    board: beat.title,
    brief: beat.brief,
    objects: (beat.objects ?? []).slice(0, 12).map((o) => o.replace(/[-_]+/g, " ").trim()).filter(Boolean),
    written: [],
    sentences: (beat.script.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean),
    mustShow: beat.requiredVisual?.mustShow ?? [],
    source: (options.source ?? []).map((s) => s.slice(0, 600)).slice(0, 8),
    strict: options.strict === true,
    lecture: lectureContext(plan, index, options.earlier ?? []),
  };
}

/** The context with what is written on the board: the picture matches it and never repeats it. */
export function withMathsBoardWriting(ctx: MathsBoardContext, spec: CanvasBoardSpec): MathsBoardContext {
  return { ...ctx, written: [`Heading: ${spec.heading}`, ...spec.notes.map((n) => `Note (sentence ${n.s}): ${n.text}`)].slice(0, 24) };
}

/** The planner: the one maths diagram this board needs, from the whole board. */
export function mathsFieldsPrompt(ctx: MathsBoardContext): { system: string; user: string } {
  const system = `You plan the ONE maths diagram an image model draws for a lesson board, from the board itself. It is an EXACT school-textbook maths figure — a geometry figure, a graph, a number line, a chart, a probability tree, a Venn diagram, a 3-D solid or net, a construction, a proof's figure — showing EXACTLY what this board explains with the board's own example, letters and numbers: never a different part of the topic, never more than Aria talks about. It is drawn white on black, so it never relies on colour to tell parts apart: use labels, dashed lines, tick marks and angle arcs instead.
MINIMAL (owner, 2026-10-25: "a good minimal image"): one figure, the fewest parts that teach it (2 to 6), nothing decorative — no scene, no characters, no inset panels, no second diagram, no working or answer the board does not give.${ctx.strict ? "\nSTRICT SOURCE: the student's document is the only source. Draw ONLY what the document and the board say — every shape, value and label must come from them; nothing added from general knowledge." : ""}
Return JSON {"family": "maths", "audience": string, "diagram_type": string, "exact": true, "scope": string, "view": string, "parts": [{"name": string, "where": string, "looks": string}], "must_be_true": [string], "labels": [{"text": string, "points_to": string, "position": string, "sentence": number}], "exact_text": [string], "arrows": string}:
- "audience": the student, e.g. "a 15-year-old secondary-school student".
- "diagram_type": the figure, named specifically ("right-angled triangle ABC with a square on each side", "graph of y = x² − 4 from x = −3 to 3").
- "scope": what of it is drawn, following the narration; "view": its standard textbook orientation, said outright.
- "parts": 2 to 6 parts the narration names, each with where it sits in the frame and what it looks like (lengths and angles relative to each other, what it touches, solid or dashed).
- "must_be_true": 3 to 6 exact, visible facts a correct figure shows (a right angle at C, the square on AB is the largest, the line crosses the y-axis at −4, three branches from each node).
- "labels": at most 5 — each a vertex letter, a length, an angle, a point, a line or a short name (1 to 4 words, at most 28 characters) exactly as the board writes it. Textbook naming: vertices are CAPITAL letters (A, B, C); a side's lowercase letter names the side OPPOSITE its vertex (side a is BC, opposite A); a new point (the foot of a perpendicular, a midpoint) gets its own capital letter (D). One label per thing — never both "a" and "side a"; "points_to" the part; "position" beside what it names ("beside vertex A, outside the triangle", "at the end of the curve", "under the midpoint of AB"); "sentence" the 0-based sentence that names it.
- "exact_text": every OTHER piece of text the figure must contain exactly — values, units, angle sizes, coordinates, axis names, scale values, probabilities — at most 8, each at most 40 characters; only what the board says or writes, never an answer it does not give.
- "arrows": the arrows drawn and which way each points (axes' arrowheads, vectors, a transformation's direction), or "" for none.`;
  const user = [
    `Lecture: ${ctx.topic} — this is ${ctx.lecture.position}`,
    `The whole lecture, board by board:\n${ctx.lecture.outline.join("\n")}`,
    ctx.lecture.earlier.length ? `What the boards before this one wrote and drew (use the SAME letters, numbers, orientation and example in this figure):\n${ctx.lecture.earlier.join("\n")}` : "",
    `Next board: ${ctx.lecture.next}`,
    `Board: ${ctx.board}`,
    `What it teaches: ${ctx.brief}`,
    `What Aria says, sentence by sentence (0-based):\n${ctx.sentences.map((s, i) => `${i}. ${s}`).join("\n")}`,
    ctx.written.length ? `Written on the board beside the figure (never repeat it in the figure):\n${ctx.written.join("\n")}` : "",
    ctx.objects.length ? `Things the board's plan names: ${ctx.objects.join(", ")}` : "",
    ctx.mustShow.length ? `It must show: ${ctx.mustShow.join("; ")}` : "",
    ctx.source.length ? `What the student's document says for this board:\n${ctx.source.join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
  return { system, user };
}

/** The planner's answer as fields, or null when it planned no figure. Always the maths family. */
export function parseMathsFields(json: unknown, ctx: MathsBoardContext): PictureFields | null {
  const fields = parsePictureFields({ ...(json && typeof json === "object" ? json : {}), family: "maths" }, ctx.sentences.length, "maths", ctx.written);
  return fields ? { ...fields, family: "maths", exact: true } : null;
}

/** THE LOOK (owner, 2026-10-25): the board's own colours — white on black, a textbook figure, minimal. */
export const MATHS_BOARD_LOOK = "Pure black background (#000000) edge to edge, like the lesson's blackboard. Every line, curve, arc, point, tick, arrow, label and number is clean bright white. No colour at all, no grey fills, no paper, no frame, no border, no glow, no shadow, no texture, no chalk smudges.";

/** The image prompt (JSON): the whole board's context, the figure, its exact text and labels, the look. */
export function mathsPicturePrompt(ctx: MathsBoardContext, f: PictureFields, corrections: string[] = []): Record<string, unknown> {
  const n = f.labels.length;
  return {
    purpose: `An exact, correctly labelled school-textbook maths diagram for one lesson board, drawn white on a black board. For ${f.audience || "a secondary-school student"}.`,
    lecture_context: {
      lecture: ctx.topic,
      this_board: ctx.lecture.position,
      the_whole_lecture_board_by_board: ctx.lecture.outline,
      ...(ctx.lecture.earlier.length ? { what_the_boards_before_this_one_wrote_and_drew: ctx.lecture.earlier } : {}),
      next_board: ctx.lecture.next,
      keep_consistent: "This figure belongs to the same lecture as the boards before it: use the same letters, numbers, orientation and worked example they use, unless this board starts a new one.",
    },
    board_context: {
      lecture: ctx.topic,
      board: ctx.board,
      what_the_board_teaches: ctx.brief,
      what_the_teacher_says: ctx.sentences.join(" "),
      ...(ctx.written.length ? { written_on_the_board_beside_it: ctx.written } : {}),
      ...(ctx.source.length ? { what_the_students_document_says: ctx.source } : {}),
      draw_exactly_this: `${f.diagramType}: ${f.scope || "the whole of it"}. The board's own example, letters and numbers. Nothing from other parts of the topic, nothing the teacher does not talk about.`,
    },
    look: MATHS_BOARD_LOOK,
    canvas: "Landscape 3:2. The figure fills the central 70% of the frame, centred, with even black space around it.",
    minimal: "One figure and nothing else: only the parts listed, thin even white lines, plenty of black space. No title, no caption, no scene, no characters, no inset panel, no second diagram, no working or answer that is not listed.",
    subject_and_view: `${f.diagramType}, ${f.view}.`,
    parts_and_layout: f.parts.map((p) => `${p.name}: ${p.where}; ${p.looks}`),
    must_be_true: f.mustBeTrue,
    maths_rules: [
      "A precise textbook figure, not a sketch: straight ruled lines, true circles and arcs, accurate proportions and angles as listed.",
      "Every number, letter, angle, length, coordinate and value is exactly as listed: nothing rounded, nothing extra.",
      "Geometry conventions in white: a right angle marked with a small square, equal sides with matching tick marks, parallel lines with matching arrow marks, angles with arcs, vertices named with the capital letters listed, hidden edges dashed.",
      "Naming: vertices are capital letters; a side's lowercase letter is written beside the side OPPOSITE the vertex of the same letter (a beside BC); every point the board names (the foot of a perpendicular, a midpoint) is marked and lettered.",
      "Graphs: ruled x and y axes with arrowheads, the origin marked 0, scale values exactly as listed and evenly spaced, the axis names listed, each line or curve passing exactly through the listed points; a second line or curve is told apart by a dashed stroke and its label, never by colour.",
      "Counts are exact: the number of branches, sections, dots, bars or squares equals the listed number.",
    ],
    labels: {
      count: `Exactly ${n} label${n === 1 ? "" : "s"}.`,
      rules: [
        "Write each label EXACTLY as given, once, with no extra characters.",
        "Clean white sans-serif, large and easy to read, set right beside what it names; a thin straight white line with no arrowhead joins it to its part only where it cannot sit beside it.",
        "Labels never touch a line of the figure, and no label or label line crosses another.",
      ],
      draw_exactly: f.labels.map((l) => ({ text: l.text, points_to: l.pointsTo, position: l.position })),
    },
    ...(f.exactText.length ? { exact_text: f.exactText } : {}),
    ...(f.arrows ? { arrows: f.arrows } : {}),
    ...(ctx.strict ? { strict_source: "Draw only what the student's document and the board say. Nothing added." } : {}),
    ...(corrections.length ? { corrections: `An earlier drawing was rejected. Correct these: ${corrections.join("; ")}` } : {}),
    never: [
      "Never any colour other than white on black.",
      "Never a white or paper background, a frame or a border.",
      "Never decoration, clip-art, characters, hands, pencils or 3-D shading (a 3-D solid is drawn as a clean line drawing with dashed hidden edges).",
      "Never handwriting or a chalk texture: crisp printed lines and type.",
    ],
    text_and_exclusions: `The only text anywhere in the image is ${[n ? `the ${n} label${n === 1 ? "" : "s"}` : "", f.exactText.length ? `the ${f.exactText.length} piece${f.exactText.length === 1 ? "" : "s"} of exact text` : ""].filter(Boolean).join(" and ") || "none"}. No title, caption, legend, watermark or other text.`,
  };
}

/** One remembered picture per figure, label set and text (a student's own document's figure is never shared). */
export function mathsPictureKey(f: PictureFields): string {
  const signature = JSON.stringify({ v: "maths-board-picture-v1", model: "gpt-image-2", type: f.diagramType.toLowerCase(), scope: f.scope.toLowerCase(), labels: f.labels.map((l) => l.text.toLowerCase()).sort(), text: f.exactText.map((t) => t.toLowerCase()).sort() });
  return `asset-${createHash("sha256").update(signature).digest("hex").slice(0, 32)}`;
}
