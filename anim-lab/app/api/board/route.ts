import { NextResponse } from "next/server";
import * as Babel from "@babel/standalone";
import { complete, LAB_MODEL, stripFences } from "../../../lib/openai";
import { boardPrompt, repairPrompt } from "../../../lib/prompts";
import { ENGINES, type Beat, type BoardResult, type Engine } from "../../../lib/lecture";

export const maxDuration = 300;

const MAIN_APP_URL = process.env.MAIN_APP_URL ?? "http://localhost:3000";
const ENTRY: Record<Exclude<Engine, "sandbox">, RegExp | null> = {
  motion: /function\s+Board\s*\(/,
  gsap: /function\s+build\s*\(/,
  remotion: /function\s+Scene\s*\(/,
  lottie: null,
};

/** Compile-time check, so a syntax slip costs one repair call instead of a blank column. */
function check(engine: Exclude<Engine, "sandbox">, code: string): string | null {
  if (engine === "lottie") {
    try {
      const json = JSON.parse(code) as { layers?: unknown[]; op?: number; w?: number };
      if (!Array.isArray(json.layers) || !json.layers.length) return "Lottie JSON has no layers";
      if (typeof json.op !== "number" || json.op <= 0) return "Lottie JSON has no positive op";
      return null;
    } catch (err) {
      return `JSON.parse failed: ${err instanceof Error ? err.message : err}`;
    }
  }
  if (!ENTRY[engine]!.test(code)) return `missing the required entry function (${ENTRY[engine]})`;
  try {
    Babel.transform(code, { presets: [["react", { runtime: "classic" }]], filename: "board.jsx" });
    return null;
  } catch (err) {
    return err instanceof Error ? err.message.slice(0, 800) : String(err);
  }
}

async function generate(engine: Exclude<Engine, "sandbox">, beat: Beat, repair?: { error: string; code: string }): Promise<BoardResult> {
  const prompt = boardPrompt(engine, beat);
  let costUsd = 0;
  let ms = 0;
  const call = async (user: string) => {
    const res = await complete(prompt.system, user, { json: prompt.json });
    costUsd += res.costUsd;
    ms += res.ms;
    if (!res.text.trim()) throw new Error(`empty reply (finish=${res.finish})`);
    return stripFences(res.text);
  };
  try {
    let code = await call(repair ? `${prompt.user}\n\n${repairPrompt(repair.error, repair.code)}` : prompt.user);
    let problem = check(engine, code);
    let repairs = 0;
    if (problem) {
      repairs++;
      code = await call(`${prompt.user}\n\n${repairPrompt(problem, code)}`);
      problem = check(engine, code);
    }
    return { engine, code, error: problem, ms, costUsd, model: LAB_MODEL, meta: { repairs, runtimeRepair: Boolean(repair) } };
  } catch (err) {
    return { engine, code: null, error: err instanceof Error ? err.message : String(err), ms, costUsd, model: LAB_MODEL };
  }
}

/** The production pipeline, untouched: the main app's dev-only /api/sandbox-board on the same model. */
async function sandbox(beat: Beat): Promise<BoardResult> {
  const started = Date.now();
  try {
    const res = await fetch(`${MAIN_APP_URL}/api/sandbox-board`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: beat.title, teachingPoint: beat.teachingPoint, script: beat.script, model: LAB_MODEL, beatId: `lab-${beat.id}` }),
    });
    const data = await res.json().catch(() => ({ error: `main app returned ${res.status}` }));
    return {
      engine: "sandbox",
      code: data.code ?? null,
      error: data.code ? null : data.error ?? `no code (status ${data.status ?? res.status})`,
      ms: Date.now() - started,
      costUsd: Number(data.stats?.costUsd ?? 0),
      model: data.model ?? LAB_MODEL,
      meta: { assetIds: data.assetIds ?? [], status: data.status, critique: data.critique, trial: data.trial, issues: data.stats?.issues },
    };
  } catch (err) {
    return {
      engine: "sandbox",
      code: null,
      error: `main app not reachable at ${MAIN_APP_URL} (run \`npm run dev\` in frontend/web): ${err instanceof Error ? err.message : err}`,
      ms: Date.now() - started,
      costUsd: 0,
      model: LAB_MODEL,
    };
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const engine = body.engine as Engine;
  const beat = body.beat as Beat | undefined;
  if (!ENGINES.includes(engine)) return NextResponse.json({ error: `engine must be one of ${ENGINES.join(", ")}` }, { status: 400 });
  if (!beat || typeof beat.title !== "string" || typeof beat.script !== "string") {
    return NextResponse.json({ error: "beat {title, teachingPoint, script} is required" }, { status: 400 });
  }
  const repair = body.repair && typeof body.repair.error === "string" && typeof body.repair.code === "string"
    ? { error: String(body.repair.error).slice(0, 1500), code: String(body.repair.code).slice(0, 60_000) }
    : undefined;
  const result = engine === "sandbox" ? await sandbox(beat) : await generate(engine, beat, repair);
  return NextResponse.json(result);
}
