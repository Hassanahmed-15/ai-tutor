import { NextResponse } from "next/server";
import OpenAI from "openai";
import { currentUser } from "@/lib/auth";
import { createCostMeter } from "@/lib/costMeter";
import {
  MIND_MAP_STRICT_RULES,
  MIND_MAP_SYSTEM_PROMPT,
  mindMapTranscript,
  parseMindMap,
  type MindMapBeatInput,
} from "@/lib/mindMap";
import { sanitizeSourceScope } from "@/lib/sourceScope";

/**
 * The mind map of a finished lecture (lib/mindMap.ts): one model call organises what the beats
 * taught into a tree, as deep as the topic needs.
 *
 * Built like the one-slide summary (app/api/summarize-lecture): the client offers it only once the
 * lecture has been watched to the end, and the route maps exactly the beats it is sent.
 */
const MODEL = process.env.OPENAI_MIND_MAP_MODEL ?? process.env.OPENAI_SUMMARY_MODEL ?? process.env.OPENAI_EXPLAIN_MODEL ?? "gpt-4o";

export async function POST(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const topic = typeof body.topic === "string" ? body.topic.trim().slice(0, 200) : "";
  const request = typeof body.request === "string" ? body.request.trim().slice(0, 300) : "";
  const beats: MindMapBeatInput[] = Array.isArray(body.beats)
    ? body.beats
        .filter((b: unknown): b is Record<string, unknown> => Boolean(b) && typeof b === "object")
        .map((b: Record<string, unknown>) => ({
          title: typeof b.title === "string" ? b.title : "",
          script: typeof b.script === "string" ? b.script : "",
          points: Array.isArray(b.points) ? b.points.filter((p): p is string => typeof p === "string") : [],
          conceptId: typeof b.conceptId === "string" ? b.conceptId : undefined,
        }))
        .slice(0, 40)
    : [];
  const transcript = mindMapTranscript(beats);
  if (!transcript) return NextResponse.json({ error: "beats are required" }, { status: 400 });

  // STRICT SOURCE: a strict lecture's map is held to the student's own document, as its summary is.
  const sourceScope = sanitizeSourceScope(body.sourceScope);
  const source = typeof body.source === "string" ? body.source.trim().slice(0, 16_000) : "";
  const strict = sourceScope?.fidelity === "strict" && Boolean(source);

  const meter = createCostMeter();
  const client = meter.wrap(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
  const userMsg = [
    `Lecture subject: "${topic || "this lecture"}".`,
    request ? `What the student originally asked: "${request}".` : "",
    "The lecture, beat by beat:",
    transcript,
    strict ? `SOURCE — the student's own document, the text this lecture was taught from. The map may state only what SOURCE states:\n${source}` : "",
  ].filter(Boolean).join("\n\n");

  let issue = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: MODEL,
        temperature: strict ? 0.2 : 0.3,
        // Room for each node's slide numbers on top of the labels.
        max_tokens: 1800,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: strict ? `${MIND_MAP_SYSTEM_PROMPT}\n\n${MIND_MAP_STRICT_RULES}` : MIND_MAP_SYSTEM_PROMPT },
          { role: "user", content: issue ? `${userMsg}\n\nYour previous answer was rejected: ${issue}. Fix exactly that.` : userMsg },
        ],
      });
      const parsed = parseMindMap(JSON.parse(completion.choices[0]?.message?.content ?? "{}"), topic || "Lecture", beats.length);
      if (parsed.mindMap) return NextResponse.json({ mindMap: parsed.mindMap, costUsd: meter.totalUsd });
      issue = parsed.issue ?? "unusable mind map";
    } catch (err) {
      issue = err instanceof Error ? err.message : "mind map call failed";
    }
  }
  return NextResponse.json({ error: `Couldn't map the lecture: ${issue}`, costUsd: meter.totalUsd }, { status: 502 });
}
