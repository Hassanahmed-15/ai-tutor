import { NextResponse } from "next/server";
import * as Babel from "@babel/standalone";
import { complete, LAB_MODEL, stripFences } from "../../../lib/openai";
import { variantById } from "../../../lib/variants";
import type { Beat } from "../../../lib/lecture";

export const maxDuration = 300;

function compileIssue(code: string): string | null {
  if (!/export\s+default\s+function\s+Animation\s*\(\s*\{[^}]*\bsentence\b/.test(code)) return "missing export default function Animation({ sentence, sentenceProgress })";
  try {
    Babel.transform(code, { presets: [["react", { runtime: "classic" }]], plugins: ["transform-modules-commonjs"], filename: "board.jsx" });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message.slice(0, 600) : String(err);
  }
}

/** One board from a candidate prompt: one shot plus at most one compile repair, like the lab. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const variant = variantById(String(body.variant ?? ""));
  const beat = body.beat as Beat | undefined;
  if (!variant || !beat?.script) return NextResponse.json({ error: "variant and beat are required" }, { status: 400 });
  let costUsd = 0;
  let ms = 0;
  const call = async (user: string) => {
    const res = await complete(variant.system, user, { maxTokens: 16_000 });
    costUsd += res.costUsd;
    ms += res.ms;
    return stripFences(res.text);
  };
  try {
    const user = variant.user(beat);
    let code = await call(user);
    let issue = compileIssue(code);
    if (issue) {
      code = await call(`${user}\n\nYour previous output failed: ${issue}\n\nPrevious output:\n${code}\n\nReturn the corrected complete component only.`);
      issue = compileIssue(code);
    }
    return NextResponse.json({ code, error: issue, ms, costUsd, model: LAB_MODEL });
  } catch (err) {
    return NextResponse.json({ code: null, error: err instanceof Error ? err.message : String(err), ms, costUsd, model: LAB_MODEL });
  }
}
