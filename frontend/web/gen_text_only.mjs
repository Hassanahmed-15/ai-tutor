// Step-1 only generation (gpt-4o text + sanitizer, NO images) — cheap (~$0.05) to inspect
// the WRITTEN/blackboard boards before paying for image generation. TEMP — delete after use.
import OpenAI from "openai";
import fs from "node:fs";

const WEB = new URL(".", import.meta.url).pathname;
for (const line of fs.readFileSync(`${WEB}.env.local`, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const { DRAW_LECTURE_SYSTEM_PROMPT } = await import("./lib/drawPrompt.ts");
const { sanitizeDrawLecture } = await import("./lib/drawSanitize.ts");

const topic = process.argv[2] || "supply and demand";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const completion = await client.chat.completions.create({
  model: process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o",
  messages: [
    { role: "system", content: DRAW_LECTURE_SYSTEM_PROMPT },
    { role: "user", content: `Teach this topic live: "${topic}". Build the COMPLETE lecture now following the full arc: 14-18 beats total. Produce ALL sections A through F as described — opening image, BLACKBOARD beats first, then image-led beats, then animation beats, then recap, then closing blackboard. Include 1-2 checkpoints. Teacher script, drawn boards, and checkpoints.` },
  ],
  temperature: 0.55,
  response_format: { type: "json_object" },
});
const raw = completion.choices[0]?.message?.content ?? "";
const parsed = JSON.parse(raw);
console.log("raw beats from model:", parsed.beats?.length);
fs.writeFileSync("/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/1e027143-56da-4fdf-b528-01bf78a59e6e/scratchpad/gen_unsanitized.json", JSON.stringify(parsed, null, 2));
const beats = sanitizeDrawLecture(parsed);
const u = completion.usage;
const cost = u ? u.prompt_tokens * 2.5e-6 + u.completion_tokens * 1e-5 : 0;
fs.writeFileSync(process.argv[3] || "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/1e027143-56da-4fdf-b528-01bf78a59e6e/scratchpad/gen_raw.json", JSON.stringify({ topic, beats, textCostUsd: cost }, null, 2));
console.log(`text cost ~$${cost.toFixed(4)}  beats=${beats.length}`);
