/**
 * SUBJECT PROMPT LAB (owner, 2026-10-24): one prompt for every subject is not good enough — classify the
 * subject, give the image model that subject's own prompt as JSON, and a real example image to draw from.
 * The image model only draws; the deciding is done by a vision model:
 *   - a checker (gpt-5.6-sol) looks at the Google candidates and chooses a path: USE one as it is,
 *     REDRAW one as the reference (with what to change), or DRAW NEW (none is right) — and lists what the
 *     board must show;
 * and for the test, every board gets all three pictures so the paths can be compared:
 *   A  the Google original, as it is;
 *   B  gpt-image-1-mini redrawing the reference, with the subject's JSON prompt (images.edit);
 *   C  gpt-image-1-mini from the subject's JSON prompt alone (images.generate);
 * scored blind by an independent judge (Gemini) — the three shuffled, so it cannot tell which is which.
 *
 *   node --import tsx scripts/pictures/subject-prompt-lab.mts --show      the JSON prompts for sample topics ($0)
 *   node --import tsx scripts/pictures/subject-prompt-lab.mts             the two-board test (≈ $0.15–0.20)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { costFor } from "../../lib/modelPricing";

const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const OUT = `${homedir()}/aria-qa-images/${new Date().toLocaleDateString("en-CA")}-subject-prompt-lab`;
mkdirSync(OUT, { recursive: true });

type Subject = "biology" | "chemistry" | "physics" | "earth science";
type Pack = { view: string; conventions: string[]; palette: string; avoid: string[] };

/** Each subject's own way of drawing a textbook diagram (school syllabus conventions; no topic named). */
const PACKS: Record<Subject, Pack> = {
  biology: {
    view: "The standard textbook view for the topic: a cross-section, longitudinal section or cut-away when the topic is about internal structure; the outside when it is about a whole organism or organ as seen; a flat 2D schematic for cells, tissues and membranes.",
    conventions: [
      "Show only structures the real tissue, cell or organ has at the stage shown — never add a nucleus, valve, layer, chamber or organelle it does not have.",
      "Draw the correct number, order and relative thickness of layers, chambers and parts, as a standard textbook draws them.",
      "Membranes and cell walls as clear continuous lines; neighbouring tissues in clearly different tones.",
      "Oxygenated blood red and deoxygenated blood blue — only in diagrams of circulation.",
      "Plant tissues containing chloroplasts green; cell walls pale beige or brown.",
    ],
    palette: "Flat natural textbook colours: soft reds and pinks for muscle, cream for connective tissue, pale blue for outer coverings, green for photosynthetic plant tissue.",
    avoid: ["photorealism or microscope-photo textures", "3D renders and glossy highlights", "decorative backgrounds", "structures the topic does not need"],
  },
  chemistry: {
    view: "A flat 2D school diagram: apparatus as a side-on line drawing in the standard textbook layout; particles as simple circles; atoms as a nucleus with concentric electron shells; molecules as ball-and-stick.",
    conventions: [
      "Glassware as clean outlines with the liquid shown as a tinted fill and a flat surface line.",
      "Electrodes as vertical rods dipping into the electrolyte, wired to a DC power supply above; every wire connects to something.",
      "Electron shells as concentric circles with electrons evenly spaced, the correct number in each shell.",
      "Ball-and-stick models in standard atom colours: carbon dark grey, hydrogen white, oxygen red, nitrogen blue, chlorine green, sulfur yellow.",
      "Heating shown with a Bunsen burner flame under the apparatus, where the method heats it.",
      "Correct proportions; nothing floating or unconnected.",
    ],
    palette: "Clean line art in dark grey on white, with pale tinted liquids and standard atom colours.",
    avoid: ["photographic glassware or lab photos", "people or hands", "decorative bubbles, sparkles or glows", "chemical formulas, symbols or charge signs drawn as text"],
  },
  physics: {
    view: "A clean 2D schematic: ray diagrams, circuits, force diagrams or apparatus side-on, as an exam paper draws them.",
    conventions: [
      "Light rays as straight lines with arrowheads showing direction; normals as dashed lines at right angles to the surface.",
      "Circuits drawn with standard circuit symbols and straight wires meeting at right angles.",
      "Forces as straight arrows starting from the point where they act, their lengths in proportion to their sizes.",
    ],
    palette: "Black line work on white with one or two accent colours for the rays, fields or forces.",
    avoid: ["photorealism", "decorative scenery", "symbols or values drawn as text"],
  },
  "earth science": {
    view: "A cutaway cross-section or block diagram of the landform, structure or process, as a geography textbook draws it.",
    conventions: [
      "Rock layers as distinct bands in different earth tones; the ground surface as a clear line.",
      "Movement of magma, water or plates shown with simple broad arrows.",
      "The correct order and relative size of layers and features.",
    ],
    palette: "Earth tones for rock and soil, blue for water, red and orange for magma.",
    avoid: ["photorealism", "people, buildings or vehicles unless the topic is about them"],
  },
};

const STYLE = {
  look: "a clean, accurate, high-contrast modern school-textbook illustration",
  lines: "crisp dark outlines",
  colour: "flat colours, clearly different tones for neighbouring parts, minimal shading",
  accuracy: "scientifically correct proportions, positions and connections",
};
const NEVER = ["any text: words, letters, numbers, symbols, formulas or labels", "label lines or pointer arrows", "watermarks, logos, captions or borders", "anything the board does not need"];

type Board = { subject: Subject; lesson: string; title: string; shows: string; mustShow: string[]; corrections?: string[] };

/** The JSON prompt the image model receives (`reference`: a real diagram is attached to redraw). */
function jsonPrompt(b: Board, reference: boolean): Record<string, unknown> {
  const pack = PACKS[b.subject];
  return {
    task: reference
      ? "Redraw the attached reference diagram as one clean school-textbook diagram for a lesson board. The teacher adds every label herself, so draw no text at all."
      : "Draw one school-textbook diagram for a lesson board. The teacher adds every label herself, so draw no text at all.",
    subject: b.subject,
    level: "Cambridge IGCSE / O Level / A Level",
    topic: { lesson: b.lesson, board: b.title, shows: b.shows },
    must_show: b.mustShow,
    ...(reference ? { reference_image: { use: "Keep its structure exactly: the same parts, number of parts, positions, proportions and connections.", drop: "Its text, labels, label lines, logos, watermark and any panel the board does not need." } } : {}),
    ...(b.corrections?.length ? { corrections: b.corrections } : {}),
    subject_rules: { view: pack.view, conventions: pack.conventions, palette: pack.palette, avoid: pack.avoid },
    style: STYLE,
    never: NEVER,
    output: { background: "plain very light off-white", framing: "the subject centred, filling about 78% of the frame", orientation: "landscape" },
  };
}

// ---------- --show: the JSON prompt for sample topics (no AI) ----------
if (process.argv.includes("--show")) {
  const samples: Board[] = [
    { subject: "biology", lesson: "Excretion in humans", title: "Structure of a Nephron", shows: "One nephron from glomerulus to collecting duct, with its blood supply.", mustShow: ["Bowman's capsule", "glomerulus", "proximal convoluted tubule", "loop of Henle", "distal convoluted tubule", "collecting duct"] },
    { subject: "chemistry", lesson: "Petroleum and fuels", title: "Fractional Distillation of Crude Oil", shows: "A fractionating column heated at the bottom, cooler at the top, with fractions drawn off at different heights.", mustShow: ["furnace heating the crude oil", "fractionating column", "temperature gradient from hot bottom to cool top", "fractions drawn off at different heights", "bitumen residue at the bottom"] },
    { subject: "physics", lesson: "Light", title: "Refraction Through a Glass Block", shows: "A ray entering a rectangular glass block, bending towards the normal, and leaving parallel to its first direction.", mustShow: ["rectangular glass block", "incident ray", "normals at both surfaces", "refracted ray inside the block", "emergent ray parallel to the incident ray"] },
    { subject: "earth science", lesson: "Rivers", title: "Formation of an Oxbow Lake", shows: "A meander neck being cut through until the old loop is sealed off as a lake.", mustShow: ["meander loop", "narrowing neck", "new straight channel", "deposited sediment sealing the loop", "oxbow lake"] },
  ];
  const all = samples.map((b) => ({ board: b.title, withoutReference: jsonPrompt(b, false), withReference: jsonPrompt(b, true) }));
  writeFileSync(`${OUT}/sample-prompts.json`, JSON.stringify(all, null, 2));
  for (const s of all) console.log(`\n===== ${s.board} (no reference) =====\n${JSON.stringify(s.withoutReference, null, 2)}`);
  console.log(`\nall in ${OUT}/sample-prompts.json`);
  process.exit(0);
}

// ---------- the two-board test ----------
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
let spent = 0;
const BIO = `${homedir()}/aria-qa-images/2026-10-24-google-lab`;
const CHEM = `${homedir()}/aria-qa-images/2026-10-24-google-lab-chemistry`;
const pickFiles = (dir: string, n: number) => (JSON.parse(readFileSync(`${dir}/results.json`, "utf8")) as Array<{ n: number; cands: Array<{ file: string }> }>).find((r) => r.n === n)!.cands.map((c) => c.file);
const TESTS: Array<Omit<Board, "mustShow" | "corrections"> & { candidates: string[] }> = [
  { subject: "biology", lesson: "Transport in animals", title: "Artery Structure", shows: "An artery's wall in cross-section: the thick muscular and elastic middle layer, the outer layer and the narrow lumen that carry blood at high pressure.", candidates: pickFiles(BIO, 1) },
  { subject: "chemistry", lesson: "Electrolysis (2)", title: "Molten ionic compounds", shows: "A labelled molten lead(II) bromide cell shows the power supply, positive anode, negative cathode, the ions moving to each electrode and what forms there.", candidates: pickFiles(CHEM, 9) },
];

const jpeg = async (file: string, max = 1024) => `data:image/jpeg;base64,${(await sharp(file).flatten({ background: "#ffffff" }).resize(max, max, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()).toString("base64")}`;

const DECIDE_PROMPT = `You are a strict school subject teacher preparing the diagram for ONE board of a lesson. You see the board and numbered diagrams found on the web. Decide what to do:
- "use": one candidate is correct, of the right kind, clean (no watermark, no clutter, nothing the board does not need) — show it as it is;
- "redraw": one candidate is correct in structure but is messy (text clutter, watermark, extra panels, photo or wrong style) — it will be redrawn from it; say exactly what to change in "corrections" (e.g. which panel to keep);
- "new": no candidate is correct — the diagram will be drawn from scratch.
Also list "mustShow": the parts this board's diagram must show (3–8 short names). Return JSON {"path": "use"|"redraw"|"new", "candidate": number|null, "corrections": [short strings], "mustShow": [short strings], "faults": [{"i": number, "faults": [short strings]}]}.`;

async function decide(t: (typeof TESTS)[number]) {
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: "text", text: `Subject: ${t.subject}\nLesson: ${t.lesson}\nBoard: ${t.title}\nWhat the board shows: ${t.shows}` }];
  for (const [i, f] of t.candidates.entries()) content.push({ type: "text", text: `Candidate ${i}:` }, { type: "image_url", image_url: { url: await jpeg(f) } });
  const res = await openai.chat.completions.create({ model: "gpt-5.6-sol", response_format: { type: "json_object" }, max_completion_tokens: 5000, reasoning_effort: "low", messages: [{ role: "system", content: DECIDE_PROMPT }, { role: "user", content }] } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  spent += costFor("gpt-5.6-sol", res.usage as never);
  return JSON.parse(res.choices[0]?.message?.content ?? "{}") as { path: string; candidate: number | null; corrections: string[]; mustShow: string[]; faults: unknown };
}

const imageCost = (usage?: { input_tokens?: number; output_tokens?: number }) => ((usage?.input_tokens ?? 0) * 2.5 + (usage?.output_tokens ?? 0) * 8) / 1_000_000;

async function drawWithReference(board: Board, reference: string, out: string) {
  const png = await sharp(reference).flatten({ background: "#ffffff" }).resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const res = await openai.images.edit({ model: "gpt-image-1-mini", image: await toFile(png, "reference.png", { type: "image/png" }), prompt: JSON.stringify(jsonPrompt(board, true), null, 2), size: "1536x1024", quality: "medium" } as never);
  spent += imageCost((res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage);
  writeFileSync(out, Buffer.from(res.data![0].b64_json!, "base64"));
}
async function drawNew(board: Board, out: string) {
  const res = await openai.images.generate({ model: "gpt-image-1-mini", prompt: JSON.stringify(jsonPrompt(board, false), null, 2), size: "1536x1024", quality: "medium" });
  spent += imageCost(res.usage as never);
  writeFileSync(out, Buffer.from(res.data![0].b64_json!, "base64"));
}

/** Blind: the judge sees the pictures as 1, 2, 3 in a shuffled order. */
async function judge(board: Board, pictures: Array<{ arm: string; file: string }>) {
  const order = [...pictures].sort(() => Math.random() - 0.5);
  const parts: Array<Record<string, unknown>> = [{ text: `You are an examiner checking pictures for a school lesson board (Cambridge IGCSE / O / A Level).\nSubject: ${board.subject}\nLesson: ${board.lesson}\nBoard: ${board.title}\nWhat the board shows: ${board.shows}\nIt must show: ${board.mustShow.join("; ")}.\nFor EACH numbered picture: is it scientifically correct, and fit to teach this board from? Labels are not needed (the teacher adds her own); text inside a picture is a fault only if it is wrong or garbled. Return JSON {"pictures": [{"n": number, "correct": boolean, "fitForBoard": boolean, "score": 0-10, "faults": [short strings]}]}.` }];
  for (const [i, p] of order.entries()) parts.push({ text: `Picture ${i + 1}:` }, { inline_data: { mime_type: "image/jpeg", data: (await jpeg(p.file)).split(",")[1] } });
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent", { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json" } }) });
    const data = (await res.json().catch(() => ({}))) as any;
    if (res.ok) {
      const u = data.usageMetadata ?? {};
      spent += costFor("gemini-3.8-flash", { prompt_tokens: u.promptTokenCount ?? 0, completion_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } as never);
      const verdict = JSON.parse((data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("")) as { pictures: Array<{ n: number } & Record<string, unknown>> };
      return Object.fromEntries(order.map((p, i) => [p.arm, verdict.pictures.find((v) => v.n === i + 1) ?? null]));
    }
    console.log(`  judge: ${String(data?.error?.message ?? res.status).slice(0, 100)} — again in 5 s`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  return {};
}

const rows: string[] = [];
const results: unknown[] = [];
for (const [k, t] of TESTS.entries()) {
  const d = await decide(t);
  const board: Board = { ...t, mustShow: d.mustShow ?? [], corrections: d.corrections ?? [] };
  const reference = t.candidates[d.candidate ?? 0];
  const tag = `${k + 1}-${t.subject}`;
  const A = `${OUT}/${tag}-A-original.png`, B = `${OUT}/${tag}-B-reference.png`, C = `${OUT}/${tag}-C-new.png`;
  await sharp(reference).png().toFile(A);
  await Promise.all([drawWithReference(board, reference, B), drawNew(board, C)]);
  const v = await judge(board, [{ arm: "A", file: A }, { arm: "B", file: B }, { arm: "C", file: C }]);
  results.push({ board: t.title, decision: d, verdicts: v, promptB: jsonPrompt(board, true), promptC: jsonPrompt(board, false) });
  const line = (arm: string) => {
    const x = v[arm] as Record<string, any> | null | undefined;
    return x ? `${x.correct ? "✓ correct" : "✗ wrong"} · ${x.fitForBoard ? "fit" : "not fit"} · ${x.score}/10` : "not judged";
  };
  console.log(`${t.title}: checker chose "${d.path}"${d.corrections?.length ? ` (${d.corrections.join("; ")})` : ""}\n  A original  ${line("A")}\n  B reference ${line("B")}\n  C new       ${line("C")}`);
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const fig = (arm: string, file: string, name: string) => {
    const x = v[arm] as Record<string, any> | null | undefined;
    return `<figure><img src="${file.split("/").pop()}"><figcaption><b>${name}</b><br>${line(arm)}${x?.faults?.length ? `<br><small>${esc(x.faults.join("; "))}</small>` : ""}</figcaption></figure>`;
  };
  rows.push(`<section><h2>${esc(t.title)} <small>${t.subject}</small></h2><p>The checker chose <b>${esc(d.path)}</b>${d.corrections?.length ? ` — ${esc(d.corrections.join("; "))}` : ""}. Must show: ${esc((d.mustShow ?? []).join("; "))}</p><div class="three">${fig("A", A, "A · Google original")}${fig("B", B, "B · gpt-image-1-mini from the reference + JSON")}${fig("C", C, "C · gpt-image-1-mini from the JSON alone")}</div><details><summary>JSON prompt (B, with the reference)</summary><pre>${esc(JSON.stringify(jsonPrompt(board, true), null, 2))}</pre></details></section>`);
}
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Subject prompt lab</title><style>:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#15171a;--card:#fff;--line:#d8dce2}@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e8eaed;--card:#1b1e22;--line:#30353c}}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}main{max-width:1280px;margin:auto}section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}.three{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.three img{width:100%;height:320px;object-fit:contain;background:#fff;border-radius:8px}figure{margin:0}figcaption{font-size:13px}pre{white-space:pre-wrap;font-size:12px}@media (max-width:760px){.three{grid-template-columns:1fr}}</style><main><h1>Subject prompt lab</h1><p>Spent $${spent.toFixed(3)}. The judge (Gemini) scored the three pictures blind, in shuffled order.</p>${rows.join("")}</main>`);
console.log(`\nspent $${spent.toFixed(3)}\nreport: ${OUT}/index.html`);
