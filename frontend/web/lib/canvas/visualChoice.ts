/**
 * WHAT EACH BOARD SHOWS — one focused decision, made after the lesson is planned (owner, 2026-10-17:
 * "fix the weak link"). The lesson planner wrote the visual choice among dozens of other rules and
 * reached for comparison tables far too often: three live lectures got six tables, one flow and no
 * picture. A short, separate call reads every board and names the KIND of visual it needs, by the idea
 * and never by the subject; the visual policy then follows it (lib/canvas/visualPolicy.ts).
 *
 * It does not force pictures: a board with nothing to draw is a "concept" and gets notes only.
 */
import type OpenAI from "openai";
import type { CanvasPlanBeat } from "./types";

export const VISUAL_TYPES = ["thing", "quantity", "math", "sequence", "comparison", "concept"] as const;
export type VisualType = (typeof VISUAL_TYPES)[number];

export const VISUAL_CHOICE_PROMPT = `You choose the visual for each board of a school lesson. Most boards — about nine in ten — are understood far better with a visual, so choose one whenever the idea can be SEEN, PLOTTED or WORKED. Return JSON only: {"boards": [{"id": string, "visual": "thing" | "quantity" | "math" | "sequence" | "comparison" | "concept", "show": string}]}.
- "thing": something that can be seen or drawn as it is — an organism, organ, cell, tissue, plant, animal, molecule as a model, apparatus or experiment set-up, machine, circuit, landform, building, artefact, map-free scene — or several such things side by side, or a structure with its parts. The board gets a checked textbook picture. "show": what the picture shows, in one line, naming its 2–4 key parts (e.g. "the liver with the hepatic portal vein and the bile duct", "a root hair cell, a red blood cell and a ciliated cell side by side"). A picture is ONE thing, or two or three things side by side: never arrows, steps, a sequence, a hierarchy, a cycle or things interacting — Aria tells those over the picture. An image model draws objects well and sequences badly.
- "quantity": how one amount depends on another, or data — rates, distributions, results, growth, a function, a probability distribution. The board gets a graph or chart. "show": what is plotted against what.
- "math": working, a formula being used, a calculation, algebra. Written as equations.
- "sequence": steps that happen to NOTHING the student could see — a method of calculation, an algorithm, events in history, a chain of ideas. A flow of text cards, which students do not count as a visual: use it only when no picture or graph can show the idea.
- A PROCESS THAT HAPPENS IN OR TO SOMETHING VISIBLE IS A "thing": show the structure where it happens, and Aria walks through the steps on it. Deamination → the liver with its blood vessels; urine formation → a nephron; transcription → DNA unzipping with mRNA forming; a tropism → a shoot bending towards light; an immune response → a white blood cell engulfing a pathogen; a reaction in a lab → the apparatus; the phases of the Moon → the Moon's shapes in order, lit from one side. A visible thing that changes how it LOOKS is a "thing" drawn in its stages, never cards with its stage names.
- "comparison": ONLY a point-by-point contrast of ideas that cannot be pictured or plotted (two theories, two policies, advantages against disadvantages). Two visible things contrasted are a "thing" (drawn side by side); two distributions are a "quantity"; genetic crosses are "math" (a Punnett square).
- "concept": an idea with genuinely nothing to see, plot or work — a definition, a principle stated in words. Use it rarely.
AIM: in a science lesson most boards are "thing" or "quantity"; in a maths lesson most are "math" or "quantity". A lesson of text cards and tables teaches badly.
Decide by the idea, never by the subject. Examples: "deamination in the liver" → thing (the liver and its blood supply, where amino acids are deaminated and urea formed); "amino acids become body proteins" → thing (amino acids carried in the blood to body cells that build proteins); "linear combinations of normal variables" → quantity (the two normal curves and their combination); "limiting factors" → quantity; "specialised cells" → thing; "the Krebs cycle" → sequence; "solving quadratics" → math; "causes of the First World War" → sequence; "what is a hormone?" → thing (a gland releasing a hormone into a blood vessel) unless it is purely a definition.
An exam-practice board keeps "concept".`;

/** The planner's beats with each board's visual type and picture subject chosen by the focused call. */
export async function chooseVisuals(
  call: (system: string, user: string, maxTokens: number) => Promise<{ json: unknown; costUsd: number }>,
  topic: string,
  beats: CanvasPlanBeat[],
): Promise<{ beats: CanvasPlanBeat[]; costUsd: number; log: string }> {
  const boards = beats.map((b) => ({ id: b.id, title: b.title, purpose: b.brief, exam: b.stage === "exam", says: b.script.slice(0, 600) }));
  const { json, costUsd } = await call(VISUAL_CHOICE_PROMPT, JSON.stringify({ lesson: topic, boards }), 1800);
  const chosen = new Map<string, { visual: VisualType; show: string }>();
  for (const item of ((json as { boards?: Array<{ id?: unknown; visual?: unknown; show?: unknown }> }).boards ?? [])) {
    const id = typeof item.id === "string" ? item.id : "";
    const visual = typeof item.visual === "string" ? item.visual.trim().toLowerCase() : "";
    if (!id || !(VISUAL_TYPES as readonly string[]).includes(visual)) continue;
    chosen.set(id, { visual: visual as VisualType, show: typeof item.show === "string" ? item.show.trim().slice(0, 240) : "" });
  }
  const out = beats.map((b) => {
    const c = chosen.get(b.id);
    if (!c || b.stage === "exam") return b;
    // The picture's subject goes into the brief, which the board writer and the picture step read.
    const brief = c.visual === "thing" && c.show && !b.brief.includes(c.show) ? `${b.brief} Picture: ${c.show}.`.trim() : c.visual === "quantity" && c.show ? `${b.brief} Graph: ${c.show}.`.trim() : b.brief;
    return { ...b, visualType: c.visual, brief };
  });
  return { beats: out, costUsd, log: out.map((b) => `${b.id} ${b.visualType ?? "-"}`).join(" | ") };
}
