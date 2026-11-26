import "server-only";
import { createOpenAI } from "./openaiClient";
import { progressiveBeats, replaceProgressiveSession } from "./progressiveLectureStore";
import type { LearnerInteraction, ProgressiveLectureSessionDoc } from "./progressiveLectureTypes";
import { applyReplan, proposeReplan } from "./canvas/replan";

/** On unless CANVAS_REPLAN=off. */
export function replanOn(): boolean {
  return process.env.CANVAS_REPLAN !== "off";
}

/** What the student just did, in words for the replanner. Pure. */
export function describeInteraction(interaction: LearnerInteraction): string {
  switch (interaction.kind) {
    case "checkpoint":
      return interaction.correct
        ? `Answered a check question correctly${interaction.detail ? ` (${interaction.detail})` : ""}.`
        : `Answered a check question WRONGLY${interaction.detail ? ` (${interaction.detail})` : ""}. A fix-up board that re-teaches THIS idea is already shown right after it: do not add another board on the same idea. Adapt what comes later instead — pitch a coming board that builds on it more simply, or add the foundation a coming board needs.`;
    case "question":
      return `Asked: "${interaction.detail ?? ""}"`;
    case "simpler":
      return "Asked for simpler explanations.";
    case "deeper":
      return "Asked to go deeper.";
    case "more-examples":
      return "Asked for more examples.";
    case "code":
      return "Asked to see code.";
    default:
      return interaction.kind;
  }
}

/**
 * The lecture's coming boards adapted to this interaction and saved. Only boards with nothing written for them
 * yet, past the next one, may change: a board being written keeps the plan it was given.
 */
export async function replanLecture(session: ProgressiveLectureSessionDoc, interaction: LearnerInteraction, firstMutable: number): Promise<ProgressiveLectureSessionDoc> {
  const docs = await progressiveBeats(session.id);
  const lastWritten = Math.max(-1, ...docs.map((d) => d.sequence));
  const editableFrom = Math.max(firstMutable, lastWritten + 2);
  if (editableFrom >= session.plan.length) return session;
  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const started = Date.now();
  const proposed = await proposeReplan(openai, { topic: session.topic, happened: describeInteraction(interaction), notes: session.adaptationNotes, plan: session.plan, editableFrom });
  const used = session.adaptiveEdits ?? { inserted: 0, skipped: 0, log: [] };
  const result = proposed.edits.length ? applyReplan(session.plan, proposed.edits, editableFrom, used) : null;
  console.log(`[replan] ${session.id.slice(0, 8)} ${interaction.kind}${interaction.kind === "checkpoint" ? (interaction.correct ? " right" : " wrong") : ""}: ${result?.applied.length ? result.applied.join("; ") : "no change"} — ${proposed.why} (${Math.round((Date.now() - started) / 1000)}s, $${proposed.costUsd.toFixed(4)})`);
  if (!result?.applied.length) return session;
  const next: ProgressiveLectureSessionDoc = {
    ...session,
    plan: result.plan,
    costUsd: session.costUsd + proposed.costUsd,
    adaptiveEdits: { inserted: used.inserted + result.inserted, skipped: used.skipped + result.skipped, log: [...used.log, ...result.applied].slice(-20) },
    updatedAt: new Date().toISOString(),
  };
  await replaceProgressiveSession(next);
  return next;
}
