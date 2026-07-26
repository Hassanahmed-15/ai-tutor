import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { boardToSvg } from "./boardSvgSerializer";

/**
 * Vision board critic — the Clarix-paper idea (multimodal LLMs read boards at F1≈0.85 vs OCR≈0.33):
 * render the generated board to a PNG and have a vision model LOOK at it and reject overlaps,
 * clipped/illegible text, or off-topic content. This is a real rendered-output critic, unlike the
 * shape-count heuristics — it catches the exact overlap/legibility failures we kept hitting.
 *
 * Rasterization uses @resvg/resvg-js (Rust, no headless browser). Both the resvg native binary AND
 * the vision call are wrapped defensively: any failure returns { ok: true } so the critic can NEVER
 * block or crash generation — it only ever REJECTS a board it positively judged bad.
 *
 * Env: BOARD_VISION_CRITIC=1 (default on). OPENAI_VISION_MODEL (default gpt-4o).
 */

const ENABLED = process.env.BOARD_VISION_CRITIC !== "0";
const MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o";
const REJECT_BELOW = Number(process.env.BOARD_VISION_MIN_SCORE ?? 3); // 1-5 scale; reject if below
const INPUT_PRICE = 2.5 / 1_000_000;
const OUTPUT_PRICE = 10.0 / 1_000_000;

export function boardVisionCriticEnabled(): boolean {
  return ENABLED;
}

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return usage ? usage.prompt_tokens * INPUT_PRICE + usage.completion_tokens * OUTPUT_PRICE : 0;
}

// Lazily load the native rasterizer so a missing/incompatible binary degrades gracefully (same
// class of native-dep risk as lightningcss) instead of crashing the route at import time.
let resvgMod: typeof import("@resvg/resvg-js") | null | undefined;
async function rasterize(svg: string): Promise<string | null> {
  try {
    if (resvgMod === undefined) {
      resvgMod = await import("@resvg/resvg-js").catch((e) => {
        console.error(`[board-vision] resvg unavailable, critic disabled: ${e instanceof Error ? e.message : "import failed"}`);
        return null;
      });
    }
    if (!resvgMod) return null;
    const r = new resvgMod.Resvg(svg, { fitTo: { mode: "width", value: 1000 } });
    const png = r.render().asPng();
    return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
  } catch (err) {
    console.error(`[board-vision] rasterize failed: ${err instanceof Error ? err.message : "error"}`);
    return null;
  }
}

const SYSTEM_PROMPT =
  "You are a strict teaching-board reviewer. You are shown a rendered lesson board. Judge ONLY what " +
  "you can see. Reply JSON: { \"score\": 1-5, \"legible\": boolean, \"issues\": string }. Score 5 = " +
  "clean, readable, well-spaced, nothing overlapping or clipped. Lower the score for: text " +
  "overlapping other text or the image, text running off/clipped at any edge, unreadable clutter, or " +
  "content that doesn't match the stated topic. In \"issues\", name the SPECIFIC problem to fix " +
  "(e.g. 'the note under the heading overlaps the next line'); empty string if score is 5.";

export type BoardCritique = { ok: boolean; score: number; issue?: string; costUsd: number };

/**
 * Critique a beat's board. Returns ok=true (never blocks) unless the vision model positively rates
 * it below the reject threshold, in which case ok=false with a concrete issue to feed the retry.
 */
export async function critiqueBoard(client: OpenAI, beat: Beat): Promise<BoardCritique> {
  if (!ENABLED || !beat.draw) return { ok: true, score: 5, costUsd: 0 };
  const svg = boardToSvg(beat.draw);
  if (!svg) return { ok: true, score: 5, costUsd: 0 };
  const png = await rasterize(svg);
  if (!png) return { ok: true, score: 5, costUsd: 0 }; // rasterizer unavailable -> skip, don't block

  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: `Board topic: "${beat.title}". Review this rendered board.` },
            { type: "image_url", image_url: { url: png, detail: "low" } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });
    const cost = costUsd(completion.usage);
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const score = typeof parsed.score === "number" ? parsed.score : 5;
    const issue = typeof parsed.issues === "string" ? parsed.issues.trim() : "";
    const ok = score >= REJECT_BELOW;
    if (!ok) console.error(`[board-vision] beat=${beat.id} score=${score} REJECT: ${issue}`);
    else console.error(`[board-vision] beat=${beat.id} score=${score} OK`);
    return { ok, score, issue: ok ? undefined : issue || "the board is cluttered or overlapping; re-space it", costUsd: cost };
  } catch (err) {
    console.error(`[board-vision] beat=${beat.id} critic failed (skipping): ${err instanceof Error ? err.message : "error"}`);
    return { ok: true, score: 5, costUsd: 0 };
  }
}
