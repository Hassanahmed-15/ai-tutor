import type OpenAI from "openai";
import { jsonCall } from "./generate";
import { canvasSentences } from "./plan";
import { BLOCK_KINDS, CALLOUTS, plainBlocks, validateBlocks, type BoardBlock } from "./blocks";

/** The full board is on (course lessons only until the owner says otherwise). */
export function canvasBlocksOn(): boolean {
  return process.env.CANVAS_BLOCKS === "on";
}

const MODEL = process.env.CANVAS_BLOCKS_MODEL ?? "gpt-5.6-luna";

const PROMPT = `You write what goes on a teacher's board as typed blocks. You are given the numbered sentences the teacher will say.

THE BOARD IS THE WHOLE LESSON. Someone who reads only the board, with no sound, must learn the concept:
- Cover EVERY sentence. Never cut, abbreviate or summarise. Length is fine.
- Self-contained: never "this one", "as I said", "here", "pause and think". Name things explicitly.
- Define every term the first time. Under a formula, a "where" line for every symbol.
- Teacher talk that teaches nothing ("Let's begin", "Pause and think") is covered by the block around it and not written.
- Mark key terms with **bold**. Write inline maths as $...$ in KaTeX.
- Use the language of the sentences.

Reply as JSON: {"blocks":[{...}]}. Each block: "kind" (one of ${BLOCK_KINDS.join(", ")}), "s" (first sentence number it says), "e" (last), and "board_text" (its full words), plus:
- steps: "items" (each step in full, with its reason)
- formula: "tex", "where" (one line per symbol, e.g. "$v$ is the speed in m/s")
- chemical_equation: "tex" (e.g. "\\\\mathrm{2H_2 + O_2 \\\\to 2H_2O}")
- code: "code" (the lines)
- table, trace_table: "columns", "rows"
- callout: "callout" (one of ${CALLOUTS.join(", ")}: key_idea = the idea to take away; example = a worked or real example; mistake = a common mistake and why it is wrong; check = a question for the student; remember = a fact to keep)
- question: the question in board_text; answer_reveal: its answer with the reason
- quote: "source"; translation: "translation", "pronunciation"

Choose the kind the content really is. Use steps for a method, table for a comparison, formula for an equation; plain paragraph otherwise. Blocks are in teaching order. Two blocks may share a sentence (a paragraph and its formula).`;

/** The board's words as blocks: the writer's, checked and asked once more if wrong; else the script itself. */
export async function writeBoardBlocks(openai: OpenAI, beat: { id: string; title: string; script: string }, facts: string): Promise<{ blocks: BoardBlock[]; costUsd: number; log: string }> {
  const sentences = canvasSentences(beat.script);
  const user = `BOARD: ${beat.title}${facts ? `\nON THE BOARD BESIDE THE TEXT: ${facts}` : ""}\n\nSENTENCES:\n${sentences.map((t, i) => `${i}. ${t}`).join("\n")}`;
  let costUsd = 0;
  try {
    const first = await jsonCall(openai, MODEL, PROMPT, user, 8000);
    costUsd += first.costUsd;
    let checked = validateBlocks(first.json, beat.id, beat.script);
    if (checked.faults.length) {
      const again = await jsonCall(openai, MODEL, PROMPT, `${user}\n\nYour last reply could not be used: ${checked.faults.join("; ")}. Write all the blocks again.`, 8000);
      costUsd += again.costUsd;
      const second = validateBlocks(again.json, beat.id, beat.script);
      if (second.faults.length <= checked.faults.length) checked = second;
    }
    if (checked.blocks.length) return { blocks: checked.blocks, costUsd, log: `${checked.blocks.length} blocks${checked.faults.length ? ` (kept with: ${checked.faults[0]})` : ""}` };
  } catch (error) {
    return { blocks: plainBlocks(beat.id, beat.script), costUsd, log: `plain text — ${(error as Error).message.slice(0, 100)}` };
  }
  return { blocks: plainBlocks(beat.id, beat.script), costUsd, log: "plain text" };
}
