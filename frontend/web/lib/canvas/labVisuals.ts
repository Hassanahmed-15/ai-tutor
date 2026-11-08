/**
 * THE LAB VISUALS SWITCH (owner, 2026-11-08: "implement my new 2D pencils and 3D work … without disturbing
 * visual-clarity-labels"). With CANVAS_LAB_VISUALS=on, a maths or CS lecture's drawings come from the two
 * lab engines instead of gpt-image-2 or a code figure:
 * - the pencil engine (lib/mathsEngine, from maths-lab/): a checked JSON scene drawn step by step, each
 *   step on the sentence that names it;
 * - the 3-D templates (lib/visual3d, from visual3d-lab/): chosen by the planner where depth carries
 *   information, filled with the board's own numbers.
 * Off, nothing here is used and every lecture is built as before.
 */
import RULES from "../visual3d/router/rules.json";
import { TEMPLATES } from "../visual3d/registry";

export function labVisualsOn(): boolean {
  return process.env.CANVAS_LAB_VISUALS === "on";
}

/** Each 3-D template's usual renderer from the router's rules: "3d" when depth is the point, "both" when 2-D comes first. */
const KIND = new Map<string, string>();
for (const r of (RULES as { rules: Array<{ kind: string; template?: string | null }> }).rules) if (r.template && !KIND.has(r.template)) KIND.set(r.template, r.kind);

/** The templates a planner may put on a board: only those where 3-D carries real information. */
export function view3dTemplates(): Array<{ id: string; title: string; topics: string[] }> {
  return TEMPLATES.filter((t) => KIND.get(t.id) !== "both").map((t) => ({ id: t.id, title: t.title, topics: t.topics.slice(0, 5) }));
}

export function isView3dTemplate(id: unknown): id is string {
  return typeof id === "string" && view3dTemplates().some((t) => t.id === id);
}

/** The planner's line: which boards may be shown in 3-D, and with which template. */
export function view3dPlanSection(): string {
  return [
    "3-D VIEWS: a board whose idea lives in three dimensions — a solid and its faces or diagonals, distance or angles in 3-D, a 3-D vector, a plane, a surface z = f(x, y), a network's layers — may be shown as a turnable 3-D model instead of a flat picture. Then set \"view3d\" on that board to ONE id below and keep its script about that model with the board's own numbers. Never for a flat idea (a single triangle, a graph of y against x, a table): leave \"view3d\" out there. At most two boards in a lecture.",
    ...view3dTemplates().map((t) => `- ${t.id}: ${t.title} (${t.topics.join(", ")})`),
  ].join("\n");
}
