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

export const VISUAL_TYPES = ["thing", "diagram", "quantity", "math", "sequence", "comparison", "concept"] as const;
export type VisualType = (typeof VISUAL_TYPES)[number];

export const VISUAL_CHOICE_PROMPT = `You choose the visual for each board of a school lesson. Most boards — about nine in ten — are understood far better with a visual, so choose one whenever the idea can be SEEN, DIAGRAMMED, PLOTTED or WORKED. Return JSON only: {"boards": [{"id": string, "visual": "thing" | "diagram" | "quantity" | "math" | "sequence" | "comparison" | "concept", "show": string}]}.
- "thing": what something LOOKS like — an organism, organ, cell, tissue, plant, animal, apparatus or experiment set-up, machine, circuit, landform, building, artefact — or two or three such things side by side, or a structure with its parts. The board gets a checked textbook picture. Choose it only when the board teaches the thing's appearance, its parts or where something is on it. "show": what the picture shows, in one line, naming its 2–4 key parts (e.g. "the liver with the hepatic portal vein and the bile duct", "a root hair cell, a red blood cell and a ciliated cell side by side"). A picture is ONE thing, or two or three things side by side: never arrows, steps, a sequence, a cycle, molecules reacting or things interacting. An image model draws objects well and processes badly.
- "diagram": a schematic drawn by code — labelled boxes and short names joined by arrows: a CYCLE (the Calvin cycle, the cardiac cycle, the carbon or nitrogen cycle, the cell cycle), a PATHWAY of stages with what goes in and comes out of each (the light-dependent reactions, nerve impulse transmission across a synapse, blood clotting as steps), a feedback loop, a food chain or web, a chain of cause and effect in science, a hierarchy or classification. Choose it whenever what the student must learn is the ORDER, the LINKS, or what goes IN and comes OUT — even when it happens inside a visible structure: the Calvin cycle happens in a chloroplast, but the board teaches the cycle, so it is a "diagram". "show": its shape (a cycle, a chain, or inputs → process → outputs) and its 3–6 boxes in order (e.g. "a cycle: CO₂ + RuBP → GP → triose phosphate → RuBP regenerated, using ATP and reduced NADP").
- "quantity": how one amount depends on another, or data — rates, distributions, results, growth, a function, a probability distribution. The board gets a graph or chart. "show": what is plotted against what. Only when there IS a relationship or data to plot: two numbers side by side (the boiling points of two liquids) are not a graph — draw the thing they describe instead.
- "math": working, a formula being used, a calculation, algebra. Written as equations.
- "sequence": steps with nothing physical in them — a method of calculation, an algorithm, events in history, a chain of ideas or arguments. Drawn as a flow of short cards.
- A PROCESS IS A "thing" ONLY WHEN ITS STAGES CHANGE HOW SOMETHING LOOKS: a shoot bending towards light, a cell dividing (mitosis stages drawn in order), a white blood cell engulfing a pathogen, the phases of the Moon, a lab set-up. Molecules reacting, energy or electrons being transferred, and chemical pathways are a "diagram". Deamination → thing (the liver and its blood vessels); urine formation → thing (a nephron); the Calvin cycle → diagram (a cycle); synaptic transmission → diagram (impulse → transmitter released → receptors → new impulse); photosynthesis as an equation → math; limiting factors → quantity.
- SHOW WHERE IT HAPPENS: when a lesson's process happens IN a visible structure (photosynthesis in the chloroplast, the light-dependent reactions in the thylakoid membrane, digestion along the gut, a reflex arc through the spinal cord, gas exchange in the alveoli), the board that first says WHERE gets a "thing" — the structure with the places each stage happens marked on it — and Aria walks the steps over it; the boards that teach the steps' order are "diagram". One such picture per structure.
- "comparison": ONLY a point-by-point contrast of ideas that cannot be pictured or plotted (two theories, two policies, advantages against disadvantages). Two visible things contrasted are a "thing" (drawn side by side); two distributions are a "quantity"; genetic crosses are "math" (a Punnett square).
- "concept": an idea with genuinely nothing to see, diagram, plot or work — a definition, a principle stated in words. Use it rarely.
AIM: in a science lesson most boards are "thing", "diagram" or "quantity" — and at least one board in four is a "thing" whenever the lesson has anything visible in it (an organ, a cell, an organism, apparatus, a structure where the process happens); in a maths lesson most are "math" or "quantity". A lesson of text cards and tables teaches badly; so does a lesson where every board is a picture.
Decide by the idea, never by the subject. Examples: "deamination in the liver" → thing; "amino acids become body proteins" → diagram (amino acids → blood → body cells → proteins); "linear combinations of normal variables" → quantity; "limiting factors" → quantity; "specialised cells" → thing; "the Calvin cycle", "the nitrogen cycle", "the stages of blood clotting" → diagram; "solving quadratics" → math; "causes of the First World War" → sequence; "what is a hormone?" → thing (a gland releasing a hormone into a blood vessel) unless it is purely a definition; "why a straw looks bent in a glass of water" → thing (the straw in the glass, light bending at the water surface).
An exam-practice board keeps "concept".`;

/**
 * A COURSE LESSON'S VISUALS (owner, 2026-10-24: "not every lecture gets a diagram, only those which are
 * necessary … simple diagrams"). Every course picture is drawn by an image model (lib/canvas/courseFigures.ts)
 * — it costs money and a wrong one misleads — so the "nine in ten boards" aim above is not used: a board
 * gets a picture only when the student cannot understand it without SEEING something. A decision tree for
 * a logical-reasoning lesson, a list of fermenter products and a page of equilibrium graphs were all drawn
 * as busy pictures under the old aim (course bench, 2026-10-24).
 */
export const COURSE_VISUAL_CHOICE_PROMPT = `You decide, board by board, whether each board of a school course lesson needs a picture. Pictures are drawn by an image model. A picture is drawn whenever SEEING something helps the student understand or remember the board — there is NO limit: some lessons need a picture on most boards, some on one, some on none. A picture is NOT drawn when it would only decorate the board, or repeat its words as boxes and arrows. Return JSON only: {"boards": [{"id": string, "visual": "thing" | "diagram" | "quantity" | "math" | "sequence" | "comparison" | "concept", "show": string, "why": string}]} — "why": a few words saying why this board does or does not need a picture.
Ask of every board on its own: would a good textbook put a figure here, and would the student understand this better by seeing it? Yes → a picture. No → no picture.
IN SCIENCE, SEEING USUALLY HELPS (owner, 2026-10-24: "chemistry sometimes misses the images"): a board about a substance, a reaction, an experiment, a structure or particles gets a picture of what it looks like — in the test tube, in the apparatus, at the particle level, or where the elements sit on the periodic table. A science board goes without a picture only when there is truly nothing to see.
A PICTURE:
- "thing": a real thing whose look, parts or set-up the board teaches — an organism, organ, cell, tissue, apparatus or experiment set-up, machine, landform, building, artefact; or two or three such things side by side. A REACTION is a "thing" too, drawn as it looks in the lab — what the student would see (fizzing, a colour change, a precipitate, a flame, a solid dissolving) — or at the particle level; so is a substance or material and what it looks like, and two visible things or reactions contrasted side by side (a metal bending beside a brittle non-metal; an oxide dissolving in acid in one test tube and in alkali in another). A process whose stages CHANGE HOW SOMETHING LOOKS is a "thing" too (the stages of mitosis, a shoot bending to light, a white blood cell engulfing a pathogen), and so is a board that teaches how to DRAW or READ a structure (displayed formulas of its examples, a dot-and-cross diagram, a circuit). "show": ONE simple picture in one line, naming its 2–4 key parts or at most three examples side by side.
- "quantity": a graph or chart that shows what the board teaches — data, results, a rate or amount changing with something (the antibody level in a first and second response, a rate against temperature). "show": ONE graph, what is plotted against what.
- "diagram": ONLY something that physically MOVES between real places the student follows with their eyes, or a real cycle in nature — the carbon, water or nitrogen cycle, blood through the heart, energy from the Sun to Earth and back to space. "show": the 3–5 places and what moves between them. NOT links between ideas — causes and effects, strategies and outcomes, controls and their effects, inputs and products: an image model draws those as busy boxes with wrong arrows (2026-10-24), so they are written as Aria speaks ("sequence").
NO PICTURE — written on the board as Aria speaks:
- "math": working, a formula, a calculation.
- "sequence": steps or reasoning told in words — a method, a decision, an argument, events, causes told as sentences — when a drawing would only be boxes of the same words.
- "comparison": a point-by-point contrast of IDEAS that cannot be pictured. A table. Visible things or reactions contrasted are a "thing", drawn side by side.
- "concept": a definition or principle with nothing to see, a list of uses, advantages or ways to do something, a summary — anything a picture would only decorate. Never a board about a reaction, a substance, an experiment or particles.
A picture is SIMPLE whenever there is one: one idea, the fewest parts that teach it — never a busy flowchart of the board's sentences.
Examples: "a fermenter and its parts" → thing; "metaphase and anaphase" → thing (chromosomes on the equator, then pulled apart); "naming and drawing hydrocarbons" → thing (displayed formulas of the board's examples); "the secondary immune response" → quantity (antibody level against time, first and second exposure); "the greenhouse effect" → diagram; "products made by microorganisms (insulin, penicillin, mycoprotein)" → concept; "ways to reduce acid rain" → concept; "deciding a course of action" → sequence; "controlling conditions in a fermenter and their effects" → thing (the fermenter with the parts that control them), never a flow of causes; "physical properties of metals and non-metals" → thing (a metal wire bending and conducting beside a brittle, dull non-metal); "acidic, basic and amphoteric oxides" → thing (test tubes: each oxide with acid and with alkali, what is seen); "reactions of metals with water and acids" → thing (the metals in water or acid, fizzing at different rates); "products made by microorganisms" → concept.
An exam-practice board keeps "concept".`;

/** The planner's beats with each board's visual type and picture subject chosen by the focused call. */
export async function chooseVisuals(
  call: (system: string, user: string, maxTokens: number) => Promise<{ json: unknown; costUsd: number }>,
  topic: string,
  beats: CanvasPlanBeat[],
  options: { course?: boolean } = {},
): Promise<{ beats: CanvasPlanBeat[]; costUsd: number; log: string }> {
  const boards = beats.map((b) => ({ id: b.id, title: b.title, purpose: b.brief, exam: b.stage === "exam", says: b.script.slice(0, 600) }));
  const { json, costUsd } = await call(options.course ? COURSE_VISUAL_CHOICE_PROMPT : VISUAL_CHOICE_PROMPT, JSON.stringify({ lesson: topic, boards }), 1800);
  const chosen = new Map<string, { visual: VisualType; show: string; why: string }>();
  for (const item of ((json as { boards?: Array<{ id?: unknown; visual?: unknown; show?: unknown; why?: unknown }> }).boards ?? [])) {
    const id = typeof item.id === "string" ? item.id : "";
    const visual = typeof item.visual === "string" ? item.visual.trim().toLowerCase() : "";
    if (!id || !(VISUAL_TYPES as readonly string[]).includes(visual)) continue;
    chosen.set(id, { visual: visual as VisualType, show: typeof item.show === "string" ? item.show.trim().slice(0, 240) : "", why: typeof item.why === "string" ? item.why.replace(/\s+/g, " ").trim().slice(0, 120) : "" });
  }
  const out = beats.map((b) => {
    const c = chosen.get(b.id);
    if (!c || b.stage === "exam") return b;
    // The picture's subject goes into the brief, which the board writer and the picture step read.
    const brief = c.visual === "thing" && c.show && !b.brief.includes(c.show) ? `${b.brief} Picture: ${c.show}.`.trim()
      : c.visual === "diagram" && c.show && !b.brief.includes(c.show) ? `${b.brief} Diagram: ${c.show}.`.trim()
      : c.visual === "quantity" && c.show ? `${b.brief} Graph: ${c.show}.`.trim() : b.brief;
    return { ...b, visualType: c.visual, brief };
  });
  // Each board's decision with its reason, so a lesson's pictures can be read back from the log.
  return { beats: out, costUsd, log: out.map((b) => { const why = chosen.get(b.id)?.why; return `${b.id} ${b.visualType ?? "-"}${why ? ` (${why})` : ""}`; }).join(" | ") };
}
