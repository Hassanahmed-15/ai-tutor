/**
 * SCIENCE PROMPT TEST (owner, 2026-10-24, option A): the researched subject prompts
 * (scripts/pictures/science-diagram-prompts.json; report: ai-tutor/reports/Science diagram image prompts.md)
 * on six real boards — two each of biology, chemistry and physics — with gpt-image-1-mini at high
 * quality, labels drawn in the picture, no reference images.
 *   1. a planner (gpt-5.6-sol) fills the board's fields: the picture part only (code draws equations,
 *      flows, patterns), its view, parts, 3–6 must-be-true facts and at most 6 labels in the
 *      curriculum's spelling;
 *   2. the subject's JSON prompt is filled in and sent as JSON to gpt-image-1-mini;
 *   3. every label is read back verbatim and compared letter by letter in code (missing, misspelt, extra);
 *   4. a strict teacher checks the must-be-true facts and where each label's line ends.
 * Report: ~/aria-qa-images/<date>-science-prompt-test/index.html
 *
 *   node --import tsx scripts/pictures/science-prompt-test.mts
 *   … --model=gpt-image-2 --quality=medium --reuse=<earlier results.json>   (the same filled prompts, another model)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import OpenAI from "openai";
import sharp from "sharp";
import { costFor } from "../../lib/modelPricing";

const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const IMAGE = arg("model") ?? "gpt-image-1-mini";
const QUALITY = (arg("quality") ?? "high") as "low" | "medium" | "high";
const REUSE = arg("reuse");
const OUT = `${homedir()}/aria-qa-images/${new Date().toLocaleDateString("en-CA")}-science-prompt-test${IMAGE === "gpt-image-1-mini" ? "" : `-${IMAGE}-${QUALITY}`}`;
/** $ per 1M tokens (text in, image out): gpt-image-2 at the rate most listings agree on, 2026-10-24. */
const IMAGE_PRICE: Record<string, { input: number; output: number }> = { "gpt-image-1-mini": { input: 2.5, output: 8 }, "gpt-image-2": { input: 5, output: 30 } };
mkdirSync(OUT, { recursive: true });
const TEMPLATES = JSON.parse(readFileSync(new URL("./science-diagram-prompts.json", import.meta.url), "utf8"));
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const CHECK = "gpt-5.6-sol";
let spent = 0;

type Subject = "biology" | "chemistry" | "physics";
const BOARDS: Array<{ subject: Subject; curriculum: string; lecture: string; title: string; brief: string }> = [
  { subject: "biology", curriculum: "cambridge", lecture: "Transport in Animals IGCSE Biology", title: "Structure of the Mammalian Heart", brief: "A labelled four-chamber heart reveals the septum, unequal ventricle walls, and valves controlling direction." },
  { subject: "biology", curriculum: "cambridge", lecture: "Blood Vessel Structure", title: "Artery Structure", brief: "A labelled cross-section comparison identifies an artery by its thick wall, small lumen and lack of valves. Picture: a labelled artery cross-section showing its thick muscular and elastic wall, relatively small lumen and absence of valves." },
  { subject: "chemistry", curriculum: "cambridge", lecture: "Electrolysis (2)", title: "Molten ionic compounds", brief: "A labelled molten lead(II) bromide cell shows the power supply, positive anode, negative cathode, ions, equations, and visible products." },
  { subject: "chemistry", curriculum: "cambridge", lecture: "14.1 Alkanes", title: "Why crack crude oil fractions?", brief: "A refinery flow compares heavy, low-demand fractions with smaller alkane fuels and alkene feedstocks, while the decane equation checks both atom totals." },
  { subject: "physics", curriculum: "cambridge", lecture: "Stationary waves", title: "Three stationary-wave experiments", brief: "Three labelled experimental arrangements show transmitter and reflector, vibrator and fixed string, and loudspeaker and air column, with maxima and minima marked." },
  { subject: "physics", curriculum: "international", lecture: "Newton's Laws of Motion", title: "Forces Come in Pairs", brief: "A close physical view of a shoe on ground and a tire on road shows matched opposite force arrows acting on different objects." },
];

async function ask(system: string, content: OpenAI.Chat.ChatCompletionContentPart[] | string, effort = "low"): Promise<any> {
  const res = await openai.chat.completions.create({ model: CHECK, response_format: { type: "json_object" }, max_completion_tokens: 6000, reasoning_effort: effort, messages: [{ role: "system", content: system }, { role: "user", content }] } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  spent += costFor(CHECK, res.usage as never);
  return JSON.parse(res.choices[0]?.message?.content ?? "{}");
}

const presetOf = (name: string) => {
  let p = TEMPLATES.curriculum_presets[name];
  while (typeof p === "string") p = TEMPLATES.curriculum_presets[p.split(" ")[0]];
  return p;
};

/** 1. The planner fills the board's fields for its subject's template. */
async function fill(b: (typeof BOARDS)[number]) {
  const t = TEMPLATES[b.subject];
  const preset = presetOf(b.curriculum);
  return ask(
    `You plan the ONE picture an image model will draw for a lesson board. Only these picture types are drawn by the image model: ${t.image_types.join("; ")}. These are drawn by code, not in the picture: ${t.drawn_by_code_instead.join("; ")} — and also any equations, arrows, flows, graphs or patterns the board mentions. Describe only the picture part of the board.
Return JSON {"audience": string, "diagram_type": string, "view": string, "parts": [{"name": string, "where": string, "looks": string}], "must_be_true": [string], "labels": [{"text": string, "points_to": string, "position": string}]}:
- "audience": the student, e.g. "a 16-year-old Cambridge IGCSE student".
- "diagram_type": the picture, named specifically; "view": the conventional textbook view and its orientation, said outright.
- "parts": 3 to 8 parts the student's level names, each with where it sits in the frame and what it looks like (shape, size relative to neighbours, what it connects to).
- "must_be_true": 3 to 6 positive, visible facts that a correct picture shows (scientifically exact; counts, order, thickness, connections).
- "labels": at most 6, each exactly the words to write (spelling: ${preset.spelling}; ${preset.names_and_units}), the part it names, and its place: "left margin" or "right margin" plus "top", "upper", "middle", "lower" or "bottom", matching where the part sits.`,
    `Subject: ${b.subject}\nCurriculum: ${b.curriculum}\nLecture: ${b.lecture}\nBoard: ${b.title}\nWhat the board shows: ${b.brief}`,
  );
}

/** 2. The subject's JSON prompt with the board's fields put in. */
function promptFor(b: (typeof BOARDS)[number], f: any): Record<string, unknown> {
  const n = String(f.labels.length);
  const fields: Record<string, unknown> = {
    "{{audience}}": f.audience,
    "{{diagram_type}}": f.diagram_type,
    "{{view}}": f.view,
    "{{parts}}": f.parts.map((p: any) => `${p.name}: ${p.where}; ${p.looks}`),
    "{{must_be_true}}": f.must_be_true,
    "{{labels}}": f.labels,
    "{{curriculum}}": presetOf(b.curriculum),
  };
  const fillIn = (v: unknown): unknown => {
    if (typeof v === "string") {
      const whole = Object.keys(fields).find((k) => v.trim() === k || v.trim() === `${k}.`);
      if (whole) return fields[whole];
      return v.replace(/\{\{(\w+)\}\}/g, (m) => (m === "{{n}}" ? n : typeof fields[m] === "string" ? (fields[m] as string) : m));
    }
    if (Array.isArray(v)) return v.map(fillIn);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillIn(x)]));
    return v;
  };
  return fillIn(TEMPLATES[b.subject].prompt) as Record<string, unknown>;
}

const jpeg = async (file: string) => `data:image/jpeg;base64,${(await sharp(file).resize(1536, 1536, { fit: "inside" }).jpeg({ quality: 90 }).toBuffer()).toString("base64")}`;

/**
 * 3. Every piece of text read back verbatim, compared letter by letter in code. Each piece is also SPELT
 * OUT letter by letter: a plain transcription read the misspelt "separtor" back as "separator" (first run).
 */
async function readBack(file: string, labels: Array<{ text: string }>) {
  const r = await ask("Read EVERY piece of text visible in this image. For each, first spell it out letter by letter exactly as the pixels show, separated by hyphens (spaces as /), THEN write it. Do NOT correct spelling, do NOT complete words, do NOT guess hidden letters — a misspelt word must stay misspelt. Return JSON {\"texts\": [{\"letters\": string, \"text\": string}]} with one entry per separate piece of text.", [{ type: "image_url", image_url: { url: await jpeg(file) } }]);
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  // The spelt-out letters are the reading that counts.
  const read: string[] = (r.texts ?? []).map((t: { letters?: string; text?: string }) => (t.letters ? t.letters.split("/").map((w) => w.replace(/[-\s]/g, "")).join(" ") : String(t.text ?? "")));
  const left = [...read];
  const perLabel = labels.map((l) => {
    const i = left.findIndex((x) => norm(x) === norm(l.text));
    if (i >= 0) {
      left.splice(i, 1);
      return { label: l.text, ok: true, read: l.text };
    }
    return { label: l.text, ok: false, read: null as string | null };
  });
  return { read, perLabel, extra: left };
}

/** 4. The facts, and where each label's line ends. */
async function checkFacts(file: string, b: (typeof BOARDS)[number], f: any) {
  return ask(
    "You are a strict subject examiner checking ONE diagram for a lesson board. Judge only what is visible. Return JSON {\"facts\": [{\"fact\": string, \"true\": boolean, \"why\": string}], \"pointers\": [{\"label\": string, \"endsOnRightPart\": boolean, \"why\": string}], \"otherErrors\": [string], \"verdict\": \"correct\" | \"minor faults\" | \"wrong\"}. otherErrors: anything scientifically wrong that the facts do not cover (invented, missing or wrong structures, impossible apparatus).",
    [{ type: "text", text: `Subject: ${b.subject}\nBoard: ${b.title}\nThe picture should be: ${f.diagram_type}, ${f.view}\nFacts that must be true:\n${f.must_be_true.map((x: string) => `- ${x}`).join("\n")}\nLabels and the part each must point to:\n${f.labels.map((l: any) => `- "${l.text}" → ${l.points_to}`).join("\n")}` }, { type: "image_url", image_url: { url: await jpeg(file) } }],
    "medium",
  );
}

const results: any[] = [];
await Promise.all(BOARDS.map(async (b, k) => {
  const usd0 = spent;
  const r: any = { n: k + 1, board: b };
  try {
    const earlier = REUSE ? (JSON.parse(readFileSync(REUSE, "utf8")) as any[]).find((e) => e.n === k + 1 && e.fields) : null;
    r.fields = earlier?.fields ?? (await fill(b));
    r.prompt = earlier?.prompt ?? promptFor(b, r.fields);
    const img = await openai.images.generate({ model: IMAGE, prompt: JSON.stringify(r.prompt, null, 2), size: "1536x1024", quality: QUALITY } as never) as OpenAI.Images.ImagesResponse;
    const u = img.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    const price = IMAGE_PRICE[IMAGE] ?? IMAGE_PRICE["gpt-image-1-mini"];
    r.imageUsd = ((u?.input_tokens ?? 0) * price.input + (u?.output_tokens ?? 0) * price.output) / 1_000_000;
    spent += r.imageUsd;
    r.file = `${OUT}/${k + 1}-${b.subject}.png`;
    writeFileSync(r.file, Buffer.from(img.data![0].b64_json!, "base64"));
    [r.labels, r.check] = await Promise.all([readBack(r.file, r.fields.labels), checkFacts(r.file, b, r.fields)]);
  } catch (error) {
    r.error = (error as Error).message.split("\n")[0];
  }
  r.usd = spent - usd0;
  results.push(r);
  const okLabels = r.labels ? r.labels.perLabel.filter((x: any) => x.ok).length : 0;
  const okFacts = r.check ? r.check.facts.filter((x: any) => x.true).length : 0;
  console.log(`${k + 1}. ${b.subject.padEnd(9)} ${b.title.slice(0, 34).padEnd(34)} ${r.error ? `ERROR ${r.error}` : `labels ${okLabels}/${r.fields.labels.length} exact${r.labels.extra.length ? `, ${r.labels.extra.length} extra text` : ""} · facts ${okFacts}/${r.fields.must_be_true.length} · pointers ${r.check.pointers.filter((x: any) => x.endsOnRightPart).length}/${r.check.pointers.length} · ${r.check.verdict}`}`);
}));
results.sort((a, b) => a.n - b.n);

const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const sections = results.map((r) => {
  if (r.error) return `<section><h2>${r.n}. ${esc(r.board.title)}</h2><p class="bad">${esc(r.error)}</p></section>`;
  const labels = r.labels.perLabel.map((x: any) => `<li class="${x.ok ? "ok" : "bad"}">${x.ok ? "✓" : "✗"} “${esc(x.label)}”${x.ok ? "" : " — not found as written"}</li>`).join("");
  const facts = r.check.facts.map((x: any) => `<li class="${x.true ? "ok" : "bad"}">${x.true ? "✓" : "✗"} ${esc(x.fact)}${x.true ? "" : ` <small>— ${esc(x.why)}</small>`}</li>`).join("");
  const pointers = r.check.pointers.map((x: any) => `<li class="${x.endsOnRightPart ? "ok" : "bad"}">${x.endsOnRightPart ? "✓" : "✗"} ${esc(x.label)}${x.endsOnRightPart ? "" : ` <small>— ${esc(x.why)}</small>`}</li>`).join("");
  return `<section><h2>${r.n}. ${esc(r.board.title)} <small>${r.board.subject} · ${r.board.curriculum} · ${esc(r.board.lecture)}</small></h2>
<div class="grid"><img src="${r.file.split("/").pop()}"><div><p><b>Verdict: ${esc(r.check.verdict)}</b> · $${r.usd.toFixed(3)}</p>
<h3>Labels (read back letter by letter)</h3><ul>${labels}</ul>${r.labels.extra.length ? `<p class="bad">Extra text in the picture: ${r.labels.extra.map((t: string) => `“${esc(t)}”`).join(", ")}</p>` : ""}
<h3>Must be true</h3><ul>${facts}</ul><h3>Label lines end on the right part</h3><ul>${pointers}</ul>
${r.check.otherErrors?.length ? `<h3>Other errors</h3><ul>${r.check.otherErrors.map((e: string) => `<li class="bad">${esc(e)}</li>`).join("")}</ul>` : ""}</div></div>
<details><summary>The JSON prompt sent to ${IMAGE}</summary><pre>${esc(JSON.stringify(r.prompt, null, 2))}</pre></details></section>`;
});
const done = results.filter((r) => !r.error);
const allLabels = done.reduce((a, r) => a + r.fields.labels.length, 0), okLabels = done.reduce((a, r) => a + r.labels.perLabel.filter((x: any) => x.ok).length, 0);
const allFacts = done.reduce((a, r) => a + r.fields.must_be_true.length, 0), okFacts = done.reduce((a, r) => a + r.check.facts.filter((x: any) => x.true).length, 0);
const summary = `${IMAGE}, ${QUALITY} quality, labels in the picture, no reference images · labels exactly right ${okLabels}/${allLabels} · facts true ${okFacts}/${allFacts} · verdicts: ${done.map((r) => r.check.verdict).join(", ")} · spent $${spent.toFixed(2)}`;
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Science prompt test</title><style>:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#15171a;--card:#fff;--line:#d8dce2}@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e8eaed;--card:#1b1e22;--line:#30353c}}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}main{max-width:1280px;margin:auto}section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}.grid{display:grid;grid-template-columns:1.5fr 1fr;gap:16px}.grid img{width:100%;background:#fff;border-radius:8px}h3{margin:10px 0 4px;font-size:14px}ul{margin:0;padding-left:18px}.ok{color:#2b8a3e}.bad{color:#d9480f}pre{white-space:pre-wrap;font-size:12px}@media (max-width:760px){.grid{grid-template-columns:1fr}}</style><main><h1>Science prompt test</h1><p>${summary}</p>${sections.join("")}</main>`);
console.log(`\n${summary}\nreport: ${OUT}/index.html`);
