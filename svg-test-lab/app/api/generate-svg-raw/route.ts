import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * SECOND PASS on the raw-SVG test: the one-shot version drew a battery that read as an
 * oval soap bar, not a battery — but a side-by-side ChatGPT-web example (same underlying
 * model family) produced a genuinely recognizable battery. The likely difference isn't
 * capability, it's ITERATION — ChatGPT's canvas tooling effectively lets the model
 * generate-then-revise. This version replicates that with an explicit two-pass loop:
 * generate a draft, then have the model critique its OWN draft against a concrete visual
 * checklist and produce a revised SVG. No primitive vocabulary either way — still raw SVG,
 * still unedited by us — the only change is one self-review round.
 */

const SYSTEM_PROMPT = `You are an expert scientific illustrator who draws clean, premium-quality educational diagrams as raw SVG — the kind of clean, professional infographic you'd see in a well-produced textbook or a polished explainer video, NOT a sketchy doodle. You draw REAL, RECOGNIZABLE objects.

OUTPUT: Return ONLY a single valid <svg>...</svg> element. No markdown fences, no explanation, no text outside the SVG.

STYLE RULES:
- viewBox="0 0 600 400". Light background as a <rect> (a very soft tint is fine, e.g. #fdfbf6 or a pale blue).
- Objects must be IMMEDIATELY RECOGNIZABLE as the real thing. A battery has a rectangular body with rounded corners and a small terminal bump on ONE short end — it is NOT an oval, NOT a capsule, NOT a pill shape. A device/load is a recognizable object appropriate to context (a lightbulb, a small appliance silhouette, a labeled box) — never an abstract blob. A plant has a visible stem, distinct leaf shapes, and roots. If you are unsure what the real object looks like, default to a simple, clearly-labeled geometric silhouette that still reads as that object's actual proportions (e.g. battery = tall rounded rectangle + small bump, never a horizontal oval).
- Use gradients (<linearGradient>) on major fills for a polished, dimensional look — flat single colors read as cheap.
- Use a clean, readable sans-serif font, bold for key labels, with a light backing box behind any label sitting on top of a colored fill so nothing overlaps or becomes illegible.
- Every arrow uses a real <marker> arrowhead definition, consistent size, never a freehand triangle guessed at each use.
- Show the REAL structure of the thing being taught, with 2-4 clearly labeled key parts and at most one flow/process indicator (small dots along a real curved path, or directional arrows).
- Include a small legend/key at the bottom if there are colored dots or symbols whose meaning isn't obvious from labels alone.
- Everything must stay fully inside the 600x400 frame with margin — nothing clipped at the edges. No two labels overlap each other or any shape.
- No JavaScript, no <script>, no <foreignObject>, no external image references (no <image> tags) — pure SVG shapes, paths, gradients, markers, and text only.`;

const CRITIQUE_PROMPT = `You will be shown an SVG diagram you just drew, plus the original brief. Critique your own draft honestly against this checklist, then output a REVISED, IMPROVED version of the SVG that fixes every issue you find:

1. Does the main object's silhouette actually look like the real thing (correct proportions, recognizable shape) — or does it read as an abstract blob/oval/generic shape standing in for it?
2. Do any labels overlap each other or overlap a shape in a way that hurts legibility?
3. Are fills flat and cheap-looking, or do they have real dimension (gradients, shading)?
4. Are arrows consistent, using proper arrowhead markers, following sensible curved paths (not crossing awkwardly)?
5. Does anything clip outside the 600x400 frame?
6. Is there anything a viewer would find confusing or unrecognizable at a glance?

Fix every real issue you find. If the silhouette doesn't read as the real object, REDRAW it with correct proportions — this is the most important fix. Output ONLY the final revised <svg>...</svg> element, nothing else — no explanation, no markdown fences, no notes about what you changed.`;

export async function POST(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const script = typeof body.script === "string" ? body.script.trim() : "";
  if (!topic || !script) {
    return NextResponse.json({ error: "topic and script are required" }, { status: 400 });
  }

  const model = process.env.OPENAI_SVG_MODEL || "gpt-5.2";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const isGpt5 = /^(gpt-5|o[0-9])/.test(model);
  const tokenParam = isGpt5 ? { max_completion_tokens: 6000 } : { temperature: 0.5, max_tokens: 6000 };
  // The revision pass has to fit the ORIGINAL draft + a full redrawn SVG in its output —
  // 4000 tokens truncated it mid-tag last run. Give it real headroom.
  const revisionTokenParam = isGpt5 ? { max_completion_tokens: 8000 } : { temperature: 0.5, max_tokens: 8000 };

  const stripFences = (raw: string) =>
    raw.replace(/^```(?:svg|xml|html)?\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    // PASS 1 — draft.
    const draftMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Topic: ${topic}\n\nSpoken script for this beat:\n${script}\n\nDraw the SVG now.` },
    ];
    const draftCompletion = await client.chat.completions.create({ model, messages: draftMessages, ...tokenParam });
    const draftRaw = draftCompletion.choices[0]?.message?.content ?? "";
    const draftSvg = stripFences(draftRaw);

    // PASS 2 — the model critiques and revises its OWN draft (replicates the iteration a
    // canvas-style tool gives implicitly; a bare one-shot completion has no such loop).
    const critiqueMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Topic: ${topic}\n\nSpoken script for this beat:\n${script}\n\nDraw the SVG now.` },
      { role: "assistant", content: draftSvg },
      { role: "user", content: CRITIQUE_PROMPT },
    ];
    const revisedCompletion = await client.chat.completions.create({ model, messages: critiqueMessages, ...revisionTokenParam });
    const revisedRaw = revisedCompletion.choices[0]?.message?.content ?? "";
    let revisedSvg = stripFences(revisedRaw);

    // Honest truncation check — don't silently ship broken XML. If the revision got cut off
    // (finish_reason "length" or doesn't close the </svg> tag), fall back to the draft rather
    // than pretend the revision succeeded.
    const revisionTruncated =
      revisedCompletion.choices[0]?.finish_reason === "length" || !revisedSvg.trim().endsWith("</svg>");
    if (revisionTruncated || !revisedSvg) {
      revisedSvg = draftSvg;
    }

    const usage = {
      draft: draftCompletion.usage,
      revision: revisedCompletion.usage,
    };

    return NextResponse.json({
      svg: revisedSvg,
      draftSvg,
      revisionTruncated,
      raw: revisedRaw,
      usage,
      model,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 502 }
    );
  }
}
