import { NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * THE REAL TEST: can gpt-4o generate a DiagramSpec (our typed shape/connector/enclosure
 * JSON) unassisted, from a topic + spoken script, well enough to render cleanly through
 * DiagramRough.tsx? No hand-tuning of coordinates on our end — whatever comes back is
 * what renders, exactly as a real lecture-generation pipeline would use it.
 */

const SYSTEM_PROMPT = `You are a diagram planner for an educational app. You NEVER draw SVG or write code — you only output a small JSON object describing WHAT to draw, using a fixed vocabulary. A separate renderer turns your JSON into a clean, hand-drawn-style diagram.

Return ONLY valid JSON matching this exact shape:
{
  "shapes": [
    { "id": string, "kind": "rect" | "circle", "x": number (0-100), "y": number (0-100), "w"?: number, "h"?: number, "r"?: number, "color": string (hex), "label": string, "labelPos"?: "inside" | "above" | "below" }
  ],
  "connectors": [
    { "from": string (shape id), "to": string (shape id), "flow"?: boolean, "flowColor"?: string (hex), "flowLabel"?: string }
  ],
  "enclosures": [
    { "id": string, "kind": "battery" | "box" | "circle", "x": number (0-100), "y": number (0-100), "w": number, "h": number, "label"?: string, "labelPos"?: "above" | "below" }
  ]
}

Rules:
- The coordinate system is 0-100 for both x and y (percentage of the frame). Keep everything within 8-92 so nothing clips.
- If a group of shapes conceptually belongs to one bigger object (e.g. two battery terminals ARE the battery, several body parts ARE an organ), wrap them in an "enclosure" so that relationship is visually obvious — don't just leave related shapes floating unconnected.
- Use "connectors" to show a real relationship or flow between two shapes (a wire, a causal link, a process step). Set "flow": true ONLY when something genuinely moves along that connection (electrons, blood, information) — give it a short flowLabel like "e⁻" or "O₂".
- Keep it to 3-6 shapes and at most 1-2 enclosures. This must be a SIMPLE, readable diagram — not a comprehensive textbook figure. Pick the ONE most important relationship the script is teaching and draw only that.
- Colors: use soft, distinguishable hex colors appropriate to a light, hand-drawn-style board (avoid pure black/white).
- Do not include any explanation, markdown, or text outside the JSON object.`;

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

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Topic: ${topic}\n\nSpoken script for this beat:\n${script}\n\nGenerate the DiagramSpec now.` },
      ],
      temperature: 0.4,
      response_format: { type: "json_object" },
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw);
    return NextResponse.json({
      spec: parsed,
      usage: completion.usage,
      raw, // keep the unedited raw text too, for honest inspection
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "generation failed" },
      { status: 502 }
    );
  }
}
