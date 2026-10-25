/**
 * WHAT THE EYES LOOK FOR (owner, 2026-10-23: "diagrams inaccurate, random and covering points or other
 * diagrams … I want a 100 percent accurate diagram and visuals system"). The manager's six lectures
 * showed what a description of a board cannot: boxes drawn empty with their labels pushed outside, a box
 * drawn on top of the working, a probability scale drawn as a y = x graph, a fake "reaction" whose two
 * sides were the same, an AI artery with a valve inside it, label lines through their own words, broken
 * equation rows ("P(not blue) = 1 −"). A vision model looks at the finished board, rendered by the real
 * board code (lib/canvas/boardLook.ts), with what Aria says on it, and names every such fault.
 *
 * Pure: the prompt and the reading of the answer (tested in lib/anim/boardLook.test.ts).
 */
import type { CanvasBoardSpec } from "./types";
import { dropRowsWhere, sameLine } from "./equationCheck";

export type LookProblem = {
  kind: LookKind;
  detail: string;
  /** Would mislead a student or cannot be read (owner, 2026-10-24: "loosen its check, it always rejects"). */
  serious: boolean;
  /** Where the fault is: inside the picture (a generated image), or in the board's own writing. */
  where?: "picture" | "writing";
  /** Every line of the board's writing that shows the fault, copied as written — what fix 1 removes. */
  lines?: string[];
};
export type LookKind = "wrong-fact" | "wrong-visual" | "meaningless" | "empty-shape" | "covers-writing" | "overlap" | "mislabelled" | "broken-maths" | "illegible";

const KINDS: LookKind[] = ["wrong-fact", "wrong-visual", "meaningless", "empty-shape", "covers-writing", "overlap", "mislabelled", "broken-maths", "illegible"];
const SERIOUS_KINDS = new Set<LookKind>(["wrong-fact", "mislabelled", "broken-maths", "covers-writing", "illegible"]);

export const BOARD_LOOK_PROMPT = `You are a strict subject teacher checking ONE board of a lesson before a student sees it. You see the finished board exactly as the student will, and you are told what the teacher (Aria) says while it is drawn.
Name every fault a teacher would refuse to show a class — and nothing else:
- "wrong-fact": the drawing or its writing shows something false or contradicting what Aria says (wrong structure, wrong numbers, wrong direction, a part that does not exist in the real thing).
- "wrong-visual": the wrong KIND of visual for the idea — a line graph for something that is not one quantity changing with another, a reaction diagram for something that is not a reaction, a flow of boxes for something that is not a process.
- "meaningless": shapes, boxes, arrows or circles that carry no meaning a student could read (arrows between things that do not lead to each other, a lone shape standing for an idea, decoration posing as a diagram).
- "empty-shape": a box or shape drawn empty while its label sits outside it, or a box that should hold something and holds nothing.
- "covers-writing": a drawing, box or picture on top of writing (notes, working, labels), hiding any part of it.
- "overlap": writing on writing, a line or arrow through words, two drawings on top of each other.
- "mislabelled": a label pointing at the wrong part, or a label for something not drawn.
- "broken-maths": a line of working that is incomplete (ending on an operator), garbled, or arithmetically false.
- "illegible": writing cut off, too small to read, or running off the board.
Do NOT fault a board for being simple, sparse, plain, or for its style or colours. Do not invent faults: if the board is correct and readable, say so.
Mark each problem "serious": true ONLY when it would teach a student something false or the board cannot be read: a false fact or wrong number, a label on a different part, a line of working that is broken or false, writing hidden under a drawing or cut off, a drawing that means nothing at all. Everything else is "serious": false — a slightly uneven layout, a label close to its part, a small overlap that hides no words, a missing detail the board does not need, a simplification normal for the student's level.
For each problem say "where" it is: "picture" when it is inside a picture or image on the board (including labels written inside the picture), "writing" when it is in the board's own writing (heading, notes, lines of working, labels on the board). For a fault in the writing, copy into "lines" EVERY line of the board that shows it, exactly as written there (each note or line of working whole, as it appears) — the same false statement may be written twice, in a note and in the working.
Return JSON only: {"ok": boolean, "problems": [{"kind": one of the kinds above, "detail": "what is wrong and where, in a few words, so it can be redrawn", "serious": boolean, "where": "picture" | "writing", "lines": [string]}]}. "ok" is true when no problem is serious.`;

export function lookUserText(input: { topic: string; title: string; script: string }): string {
  return `Lesson: ${input.topic.slice(0, 160)}\nBoard: ${input.title.slice(0, 160)}\nWhat Aria says while it is drawn: ${input.script.slice(0, 1800)}`;
}

/** The answer read strictly: only known kinds count; "ok" never stands beside a named fault. */
export function parseBoardLook(json: unknown): { ok: boolean; problems: LookProblem[] } {
  const raw = json && typeof json === "object" ? (json as { ok?: unknown; problems?: unknown }) : {};
  const problems = (Array.isArray(raw.problems) ? raw.problems : [])
    .map((p) => (p && typeof p === "object" ? (p as { kind?: unknown; detail?: unknown; serious?: unknown; where?: unknown; lines?: unknown }) : {}))
    .filter((p): p is { kind: LookKind; detail: unknown; serious?: unknown; where?: unknown; lines?: unknown } => KINDS.includes(p.kind as LookKind))
    // An answer that does not say is serious only for the faults that mislead or cannot be read.
    .map((p) => ({
      kind: p.kind,
      detail: String(p.detail ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
      serious: typeof p.serious === "boolean" ? p.serious : SERIOUS_KINDS.has(p.kind),
      ...(p.where === "picture" || p.where === "writing" ? { where: p.where as "picture" | "writing" } : {}),
      ...(Array.isArray(p.lines) && p.lines.length ? { lines: p.lines.map((l) => String(l ?? "").replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean).slice(0, 6) } : {}),
    }))
    .slice(0, 8);
  // Refused only for a serious fault; minor ones are noted and the board ships.
  return { ok: !problems.some((p) => p.serious), problems };
}

/** The redraw instruction a failed look becomes. */
export function lookFeedback(problems: LookProblem[]): string {
  const fix = problems.filter((p) => p.serious).length ? problems.filter((p) => p.serious) : problems;
  return `A teacher looked at the finished board and refused it: ${fix.map((p) => `${p.kind}: ${p.detail}`).join("; ")}. Draw it again so none of these remain — every shape meaningful and labelled inside or beside it, nothing on top of any writing, the right kind of visual for the idea, every line of working complete and true.`;
}

/**
 * FIX 1 — A FALSE LINE IS TAKEN OFF, NOT SHIPPED (owner, 2026-10-24): when a board's one redraw is refused
 * too, every line of its writing the look named as seriously wrong is removed — the note and the line of
 * working that said "Ca(OH)₂ → Ca²⁺ + OH⁻" went out with the rest of the board (Cambridge IGCSE "Formulae",
 * board 2). Lines are matched in a normal form (subscripts, superscripts, LaTeX and spaces made plain); the
 * heading is never removed, and a working board always keeps one line (its notes still carry the rest).
 */
export function removeNamedLines(spec: CanvasBoardSpec, problems: LookProblem[]): { spec: CanvasBoardSpec; removed: string[] } {
  const named = problems.filter((p) => p.serious && p.where !== "picture").flatMap((p) => p.lines ?? []).filter(Boolean);
  if (!named.length) return { spec, removed: [] };
  const hit = (text: string) => named.some((n) => sameLine(n, text));
  const removed: string[] = [];
  const gone = new Set<string>();
  const notes = spec.notes.filter((n) => {
    if (!hit(n.text)) return true;
    removed.push(n.text);
    gone.add(n.id);
    return false;
  });
  let stage = spec.stage;
  if (stage.kind === "equation") {
    const copy = structuredClone(stage);
    removed.push(...dropRowsWhere(copy, hit));
    stage = copy;
  }
  // A written board's lines (Aria's notes written as she speaks), keeping at least one.
  if (stage.kind === "sketch") {
    const lines = stage.items.filter((it) => it.type === "text");
    const wrong = lines.filter((it) => hit((it as { text: string }).text));
    if (wrong.length && wrong.length < lines.length) {
      removed.push(...wrong.map((it) => (it as { text: string }).text));
      const out = new Set<unknown>(wrong);
      stage = { ...stage, items: stage.items.filter((it) => !out.has(it)) };
      for (const it of wrong) gone.add(it.id);
    }
  }
  if (!removed.length) return { spec, removed };
  return { spec: { ...spec, notes, stage, cues: spec.cues.filter((c) => !c.target || !gone.has(c.target)) }, removed };
}

/**
 * The board alone: what it holds, without Aria's pointer, rings and underlines (her cues) or the glowing
 * "tap to explore" spots of a picture's parts — the student's controls, not the board. Both were refused
 * on a gpt-image-2 picture as "two orange target-like circles with no meaning" (2026-10-24), which would
 * redraw every picture board.
 */
export function boardAlone(spec: CanvasBoardSpec): CanvasBoardSpec {
  const quiet = <T extends { parts: Array<{ say?: string }> }>(stage: T): T => ({ ...stage, parts: stage.parts.map(({ say: _say, ...p }) => p) });
  const stage = spec.stage.kind === "illustration" ? quiet(spec.stage) : spec.stage.kind === "equation" && spec.stage.picture ? { ...spec.stage, picture: quiet(spec.stage.picture) } : spec.stage;
  return { ...spec, cues: [], stage };
}
