/**
 * GOOGLE PICTURE LAB (owner, 2026-10-24: "use google images and use ai to check if they are right and to
 * refine them … build it as a test on a lab and let's see the accuracy"). A standalone test, not the
 * live app: for real picture boards from saved lectures it
 *   1. writes a Google Images query from the board (gpt-5.6-luna);
 *   2. searches Google Images through Serper (SERPER_API_KEY) and downloads the best candidates;
 *   3. has a strict teacher (gpt-5.6-sol) check them and pick the most accurate one — a second search
 *      without "labelled" when none passes;
 *   4. refines the pick with gpt-image-1-mini: the same diagram, cleaned, every word and label line
 *      removed (Aria puts her own labels on, part by part, as she names them);
 *   5. checks the refined picture against the original (sol): nothing added, removed or moved;
 *   6. has an independent judge (Gemini, another company's model) score the original and the refined
 *      picture for the board, so the pipeline is not marking its own work;
 * and writes a side-by-side report to ~/aria-qa-images/<date>-google-lab/index.html.
 *
 * Every board keeps its BEST TWO distinct candidates (owner, 2026-10-24): free mode ranks them by
 * Google's rank, size, source, shape and title, with copies of the same picture on other sites removed;
 * the paid run ranks them by the checker's verdicts.
 *
 *   node --import tsx scripts/pictures/google-picture-lab.mts --free            (search + download only, no AI, $0)
 *   node --import tsx scripts/pictures/google-picture-lab.mts [--only=1,4] [--limit=3] [--set=scripts/pictures/chemistry-boards.json --name=chemistry]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { homedir } from "node:os";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { costFor } from "../../lib/modelPricing";

const env = Object.fromEntries(readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const args = process.argv.slice(2);
const FREE = args.includes("--free");
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const OUT = `${homedir()}/aria-qa-images/${new Date().toLocaleDateString("en-CA")}-google-lab${args.find((a) => a.startsWith("--name="))?.split("=")[1]?.replace(/^/, "-") ?? ""}`;
mkdirSync(`${OUT}/img`, { recursive: true });

const PICK_MODEL = "gpt-5.6-sol";
const QUERY_MODEL = "gpt-5.6-luna";
const IMAGE_MODEL = "gpt-image-1-mini";
const JUDGE_MODEL = "gemini-3.8-flash";
const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

/** Real picture boards from saved lectures (the first four from the manager's lecture); --set=<file.json> runs another set. */
const SET = args.find((a) => a.startsWith("--set="))?.split("=")[1];
const BOARDS: Array<{ lecture: string; title: string; brief: string }> = SET ? JSON.parse(readFileSync(SET, "utf8")) : [
  { lecture: "Transport in animals", title: "Artery Structure", brief: "An artery's wall in cross-section: the thick muscular and elastic middle layer, the outer layer and the narrow lumen that carry blood at high pressure." },
  { lecture: "Transport in animals", title: "Vein Structure Overview", brief: "A vein in cross-section: the thin wall, the wide lumen and the valves that stop blood flowing backwards at low pressure." },
  { lecture: "Transport in animals", title: "Capillary Structure and Function", brief: "A capillary one cell thick between an arteriole and a venule, where substances pass between blood and tissue." },
  { lecture: "Transport in Animals IGCSE Biology", title: "Components of Blood", brief: "A blood sample separates into red cells, white cells, platelets, and plasma, with each function." },
  { lecture: "Transport in Animals IGCSE Biology", title: "Structure of the Mammalian Heart", brief: "A labelled four-chamber heart reveals the septum, unequal ventricle walls, and valves controlling one-way flow." },
  { lecture: "Photosynthesis", title: "Chloroplast Structure", brief: "A clean labelled chloroplast picture identifies thylakoid membranes and stroma, with each part's role." },
  { lecture: "Cell Biology", title: "Prokaryotic Cell Structures", brief: "A labelled prokaryotic cell is built from its boundary, internal fluid, genetic region, and ribosomes." },
  { lecture: "Cell Biology", title: "Eukaryotic Cell Structures", brief: "A eukaryotic cell expands into labelled organelles, each linked to its main cellular role." },
  { lecture: "Cell Biology", title: "Fluid Mosaic Model", brief: "A phospholipid bilayer is drawn as a flexible boundary with embedded proteins." },
  { lecture: "Krebs Cycle", title: "A Cell's Energy Roundabout", brief: "A cutaway mitochondrion appears, with its folded inner membrane and central matrix identified." },
  { lecture: "Photosynthesis", title: "The Leaf's Energy Capture", brief: "A detailed leaf cross-section reveals green chloroplasts in its cells as sunlight streams in." },
  { lecture: "Electrolysis in IGCSE Chemistry", title: "Electrolytic Cell Components", brief: "A labelled electrolytic cell identifies the direct-current supply, electrolyte, anode, cathode and the ions moving to each electrode." },
  { lecture: "What is an atom", title: "Tiny Pieces of Matter", brief: "One atom is magnified so its protons, neutrons and electrons can be seen: a nucleus with electrons in shells around it." },
  { lecture: "What are molecules", title: "A Covalent Bond Refresher", brief: "Two simple atoms move together until their outer electron shells overlap and a shared electron pair forms a covalent bond." },
  { lecture: "Volcano Eruptions In Depth", title: "Volcano Eruptions", brief: "A cutaway volcano introduces the magma chamber as an underground reservoir and traces the magma rising through the vent to erupt." },
  { lecture: "Newton's Laws of Motion", title: "Forces Come in Pairs", brief: "A shoe pushing on the ground and the ground pushing back, as matched opposite force arrows." },
];

/** Stock-photo sites: watermarked previews, never the picture a lesson can show. */
const STOCK = /(shutterstock|alamy|dreamstime|istockphoto|gettyimages|depositphotos|123rf|vectorstock|stock\.adobe|canstockphoto|bigstockphoto|pond5|agefotostock)\./i;

/** Reposts, thumbnails and screenshots of someone else's diagram: a weaker source of the same picture. */
const REPOST = /(pinterest|pinimg|quizlet|youtube|ytimg|slideshare|scribd|coursehero|brainly|facebook|fbcdn|instagram|reddit|twitter|x\.com|tiktok|lookaside)\./i;
/** Reference and teaching publishers, and education or government sites. */
const REFERENCE = /(\.edu|\.gov|\.ac\.[a-z]{2}|\.edu\.[a-z]{2}|wikipedia\.org|wikimedia\.org|britannica\.com|libretexts\.org|openstax\.org|khanacademy\.org|bbc\.co\.uk|savemyexams\.com|rsc\.org|lumenlearning\.com|pressbooks|opentextbc\.ca|bioninja\.com\.au|sciencelearn\.org\.nz|nih\.gov|cambridge\.org|physicsclassroom\.com|chemguide\.co\.uk)(\/|$|:)/i;

let spent = 0;
/** Each board's own spend, while boards run side by side. */
const boardCost = new AsyncLocalStorage<{ usd: number }>();
const addCost = (usd: number) => {
  spent += usd;
  const own = boardCost.getStore();
  if (own) own.usd += usd;
};
type Candidate = { url: string; domain: string; title: string; file: string; w: number; h: number; rank: number; score: number; why: string[]; hash: bigint; verdict?: Record<string, unknown> };

/** A free score for how good a teaching picture this result is likely to be (no AI). */
function freeScore(c: Omit<Candidate, "score" | "why" | "hash">): { score: number; why: string[] } {
  const why: string[] = [];
  let score = 10 - c.rank;
  why.push(`Google #${c.rank + 1}`);
  const px = Math.min(1, (c.w * c.h) / (1100 * 800));
  score += px * 4;
  why.push(`${c.w}×${c.h}`);
  const host = `${c.domain}/`;
  if (REFERENCE.test(host) || REFERENCE.test(c.url)) (score += 4), why.push("reference/education source");
  if (REPOST.test(host) || REPOST.test(c.url)) (score -= 5), why.push("repost/thumbnail site");
  const ratio = c.w / c.h;
  if (ratio > 2.6 || ratio < 0.4) (score -= 3), why.push("odd shape");
  if (/\bdiagram\b|\blabell?ed\b|\bstructure\b/i.test(c.title)) (score += 1), why.push("titled as a diagram");
  return { score: Math.round(score * 10) / 10, why };
}

/** A 64-bit average hash: the same picture on two sites hashes (nearly) the same. */
async function aHash(file: string): Promise<bigint> {
  const px = await sharp(file).flatten({ background: "#ffffff" }).grayscale().resize(8, 8, { fit: "fill" }).raw().toBuffer();
  const mean = px.reduce((a, b) => a + b, 0) / px.length;
  let h = BigInt(0);
  for (const v of px) h = (h << BigInt(1)) | BigInt(v > mean ? 1 : 0);
  return h;
}
const hamming = (a: bigint, b: bigint) => {
  let x = a ^ b, n = 0;
  while (x) (n += Number(x & BigInt(1))), (x >>= BigInt(1));
  return n;
};

async function ask(model: string, system: string, content: OpenAI.Chat.ChatCompletionContentPart[], effort = "low"): Promise<Record<string, any>> {
  const res = await openai.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    max_completion_tokens: 6000,
    reasoning_effort: effort,
    messages: [{ role: "system", content: system }, { role: "user", content }],
  } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  addCost(costFor(model, res.usage as never));
  return JSON.parse(res.choices[0]?.message?.content ?? "{}");
}
const jpegPart = async (file: string, max = 1024): Promise<OpenAI.Chat.ChatCompletionContentPart> => ({
  type: "image_url",
  image_url: { url: `data:image/jpeg;base64,${(await sharp(file).flatten({ background: "#ffffff" }).resize(max, max, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()).toString("base64")}` },
});

async function writeQuery(b: (typeof BOARDS)[number], labelled: boolean): Promise<string> {
  if (FREE) return `${b.title} ${labelled ? "labelled " : ""}diagram`;
  const r = await ask(QUERY_MODEL, `Write the Google Images search query that finds a standard school-textbook diagram of exactly what this lesson board shows (the real subject, not the board's wording or metaphor). 3 to 7 words${labelled ? ', ending with "labelled diagram"' : ', ending with "diagram"'}. Return JSON {"query": string}.`, [{ type: "text", text: `Lesson: ${b.lecture}\nBoard: ${b.title}\nWhat it shows: ${b.brief}` }]);
  return String(r.query ?? `${b.title} diagram`).slice(0, 80);
}

async function search(q: string, n: number, tag: string): Promise<Candidate[]> {
  const res = await fetch("https://google.serper.dev/images", { method: "POST", headers: { "X-API-KEY": env.SERPER_API_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ q, num: 10 }) });
  if (!res.ok) throw new Error(`serper ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const images = ((await res.json()) as { images?: Array<{ imageUrl: string; imageWidth?: number; imageHeight?: number; domain?: string; title?: string }> }).images ?? [];
  const out: Candidate[] = [];
  for (const [k, im] of images.entries()) {
    if (out.length >= n) break;
    if (STOCK.test(im.imageUrl) || STOCK.test(im.domain ?? "")) continue;
    if ((im.imageWidth ?? 0) < 450 || (im.imageHeight ?? 0) < 300) continue;
    try {
      const r = await fetch(im.imageUrl, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36" }, signal: AbortSignal.timeout(12_000) });
      if (!r.ok || !/^image\//.test(r.headers.get("content-type") ?? "")) continue;
      const bytes = Buffer.from(await r.arrayBuffer());
      if (bytes.length > 8_000_000) continue;
      const meta = await sharp(bytes).metadata();
      if (!meta.width || !meta.height || meta.width < 450 || meta.height < 300) continue;
      const file = `${OUT}/img/${tag}-c${k}.png`;
      await sharp(bytes).flatten({ background: "#ffffff" }).resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toFile(file);
      const base = { url: im.imageUrl, domain: im.domain ?? new URL(im.imageUrl).hostname, title: im.title ?? "", file, w: meta.width, h: meta.height, rank: k };
      const hash = await aHash(file);
      // The same picture already found on another site: keep the better-scored copy only.
      const scored = { ...base, ...freeScore(base), hash };
      const twin = out.findIndex((o) => hamming(o.hash, hash) <= 6);
      if (twin >= 0) {
        if (out[twin].score < scored.score) out[twin] = scored;
        continue;
      }
      out.push(scored);
    } catch {
      /* a host that refuses or times out: the next result */
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

const PICK_PROMPT = `You are a strict school subject teacher choosing the diagram for ONE board of a lesson, from numbered images found on the web. Judge each image for THIS board:
- "correct": the structure, anatomy, apparatus or process is drawn correctly — nothing false, invented, or contradicting a standard O/A Level / IGCSE textbook; any labels on it are correct.
- "rightKind": it shows what the board shows (the same subject and view), as a diagram a teacher could teach this board from.
- "watermark": a watermark, stock-site branding or a website logo over the picture.
- "quality": 0-10 for clarity and resolution as a teaching picture.
Return JSON {"candidates": [{"i": number, "correct": boolean, "rightKind": boolean, "watermark": boolean, "labelled": boolean, "quality": number, "faults": [short strings]}], "best": number | null}. "best" is the most accurate clear one that is correct, of the right kind and without a watermark; null when none is.`;

async function pick(b: (typeof BOARDS)[number], cands: Candidate[]): Promise<number | null> {
  const content: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: "text", text: `Lesson: ${b.lecture}\nBoard: ${b.title}\nWhat the board shows: ${b.brief}` }];
  for (const [i, c] of cands.entries()) content.push({ type: "text", text: `Image ${i}:` }, await jpegPart(c.file));
  const r = await ask(PICK_MODEL, PICK_PROMPT, content);
  for (const v of (r.candidates ?? []) as Array<Record<string, unknown>>) if (cands[Number(v.i)]) cands[Number(v.i)].verdict = v;
  const best = r.best === null || r.best === undefined ? null : Number(r.best);
  const v = best !== null ? cands[best]?.verdict : undefined;
  return v && v.correct && v.rightKind && !v.watermark ? best : null;
}

const refineMode = new Map<string, string>();
const REFINE_PROMPT = "Redraw this exact diagram as a clean school-textbook illustration. Keep every structure exactly as it is — the same parts, the same number of each part, the same shapes, proportions, positions and colours — and add nothing. Remove ALL text: every word, letter, number, label, caption, label line (leader line) and pointer arrow, every watermark and logo. Where text or a label line covered the drawing, continue the drawing underneath it. Crisp outlines, flat clean colours, plain white background.";

async function refine(file: string, out: string): Promise<boolean> {
  const png = await sharp(file).resize(1536, 1536, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const meta = await sharp(png).metadata();
  const size = (meta.width ?? 1) >= (meta.height ?? 1) * 1.2 ? "1536x1024" : (meta.height ?? 1) >= (meta.width ?? 1) * 1.2 ? "1024x1536" : "1024x1024";
  // High input fidelity keeps the original's details where the model supports it; the plain edit otherwise.
  const edit = async (fidelity: boolean) => openai.images.edit({ model: IMAGE_MODEL, image: await toFile(png, "diagram.png", { type: "image/png" }), prompt: REFINE_PROMPT, size, quality: "medium", ...(fidelity ? { input_fidelity: "high" } : {}) } as never);
  let res;
  try {
    res = await edit(true);
    refineMode.set(out, "high fidelity");
  } catch (error) {
    console.log(`  refine: high fidelity refused (${(error as Error).message.slice(0, 90)}) — plain edit`);
    res = await edit(false);
    refineMode.set(out, "plain");
  }
  const usage = (res as { usage?: { input_tokens?: number; output_tokens?: number } }).usage;
  addCost(((usage?.input_tokens ?? 0) * 2.5 + (usage?.output_tokens ?? 0) * 8) / 1_000_000);
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) return false;
  writeFileSync(out, Buffer.from(b64, "base64"));
  return true;
}

const FAITHFUL_PROMPT = `Image 1 is a diagram from a textbook. Image 2 is a cleaned redraw that was meant to keep every structure of image 1 exactly and only remove its text and label lines. Compare them carefully, part by part. Return JSON {"faithful": boolean, "changes": [short strings], "introducedErrors": [short strings], "textLeft": boolean}. "faithful" is false when any structure was added, removed, merged, split, moved or reshaped in a way that changes what a student would learn, or when the redraw shows something false.`;

async function judge(b: (typeof BOARDS)[number], files: Array<{ name: string; file: string }>): Promise<Record<string, any> | null> {
  if (!env.GEMINI_API_KEY) return null;
  const parts: Array<Record<string, unknown>> = [{ text: `You are an examiner checking pictures for a school lesson board (O/A Level / IGCSE standard).\nLesson: ${b.lecture}\nBoard: ${b.title}\nWhat the board shows: ${b.brief}\nFor EACH image below say whether it is scientifically correct and fit to teach this board from. Labels are not required (the teacher adds her own). Return JSON {"images": [{"name": string, "correct": boolean, "fitForBoard": boolean, "score": 0-10, "faults": [short strings]}]}.` }];
  for (const f of files) parts.push({ text: `Image "${f.name}":` }, { inline_data: { mime_type: "image/jpeg", data: (await sharp(f.file).flatten({ background: "#ffffff" }).resize(1024, 1024, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer()).toString("base64") } });
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${JUDGE_MODEL}:generateContent`, { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json" } }) });
    const data = (await res.json().catch(() => ({}))) as any;
    if (res.ok) {
      const u = data.usageMetadata ?? {};
      addCost(costFor(JUDGE_MODEL, { prompt_tokens: u.promptTokenCount ?? 0, completion_tokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } as never));
      try {
        return JSON.parse((data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join(""));
      } catch {
        return null;
      }
    }
    console.log(`  judge: ${data?.error?.message?.slice(0, 120) ?? res.status}`);
    await new Promise((r) => setTimeout(r, 4000));
  }
  return null;
}

type Result = { n: number; paid?: boolean; refineMode?: string; board: (typeof BOARDS)[number]; queries: string[]; cands: Candidate[]; chosen: number | null; refined?: string; faithful?: Record<string, any>; judged?: Record<string, any> | null; used?: "refined" | "original" | null; ms: number; usd: number; error?: string };

const only = flag("only")?.split(",").map(Number);
const limit = Number(flag("limit") ?? BOARDS.length);
const todo = BOARDS.map((b, i) => ({ b, n: i + 1 })).filter(({ n }) => !only || only.includes(n)).slice(0, limit);
const results: Result[] = [];
const PARALLEL = Number(flag("parallel") ?? (FREE ? 1 : 4));
let nextBoard = 0;
await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, () => boardCost.run({ usd: 0 }, async () => { while (nextBoard < todo.length) {
  const { b, n } = todo[nextBoard++];
  const own = boardCost.getStore()!;
  own.usd = 0;
  const t0 = Date.now();
  const r: Result = { n, paid: !FREE, board: b, queries: [], cands: [], chosen: null, ms: 0, usd: 0 };
  try {
    for (const labelled of [true, false]) {
      const q = await writeQuery(b, labelled);
      r.queries.push(q);
      const cands = await search(q, FREE ? 10 : 6, `${n}${labelled ? "L" : "U"}`);
      r.cands.push(...(FREE ? cands.slice(0, 2) : cands));
      if (FREE || !cands.length) {
        if (FREE) break;
        continue;
      }
      const best = await pick(b, cands);
      if (best !== null) {
        r.chosen = r.cands.indexOf(cands[best]);
        break;
      }
    }
    // The best two: the checker's pick first, then what it judged best of the rest.
    if (!FREE) {
      const ok = (c: Candidate) => Boolean(c.verdict?.correct && c.verdict?.rightKind && !c.verdict?.watermark);
      const picked = r.chosen !== null ? r.cands[r.chosen] : null;
      r.cands = [...r.cands].sort((a, b) => Number(b === picked) - Number(a === picked) || Number(ok(b)) - Number(ok(a)) || Number(b.verdict?.quality ?? 0) - Number(a.verdict?.quality ?? 0) || b.score - a.score).slice(0, 2);
      r.chosen = picked ? 0 : null;
    }
    if (!FREE && r.chosen !== null) {
      const original = r.cands[r.chosen].file;
      const refined = `${OUT}/img/${n}-refined.png`;
      if (await refine(original, refined)) {
        r.refined = refined;
        r.faithful = await ask(PICK_MODEL, FAITHFUL_PROMPT, [{ type: "text", text: "Image 1:" }, await jpegPart(original), { type: "text", text: "Image 2:" }, await jpegPart(refined)]);
      }
      r.used = r.refined && r.faithful?.faithful ? "refined" : "original";
      r.judged = await judge(b, [{ name: "original", file: original }, ...(r.refined ? [{ name: "refined", file: r.refined }] : [])]);
    }
  } catch (error) {
    r.error = (error as Error).message.split("\n")[0];
  }
  r.ms = Date.now() - t0;
  r.usd = own.usd;
  r.refineMode = r.refined ? refineMode.get(r.refined) : undefined;
  results.push(r);
  const j = (name: string) => (r.judged?.images ?? []).find((x: { name: string }) => x.name === name);
  console.log(`${String(n).padStart(2)}. ${b.title.slice(0, 34).padEnd(34)} ${r.error ? `ERROR ${r.error}` : FREE ? `${r.cands.length} candidates (${[...new Set(r.cands.map((c) => c.domain))].slice(0, 4).join(", ")})` : `${r.chosen === null ? "NONE PASSED" : `picked ${r.cands[r.chosen].domain}`}  refine ${r.faithful ? (r.faithful.faithful ? "faithful" : "CHANGED") : "-"}  judge original ${j("original") ? `${j("original").correct ? "✓" : "✗"} ${j("original").score}` : "-"}  refined ${j("refined") ? `${j("refined").correct ? "✓" : "✗"} ${j("refined").score}` : "-"}  $${r.usd.toFixed(3)} ${(r.ms / 1000).toFixed(0)}s`}`);
}
})));
results.sort((a, b) => a.n - b.n);
// Boards checked in an earlier paid run of the same day stay in the report (a smoke test, then the rest).
if (!FREE && existsSync(`${OUT}/results.json`)) {
  const earlier = (JSON.parse(readFileSync(`${OUT}/results.json`, "utf8")) as Result[]).filter((e) => e.paid && !results.some((x) => x.n === e.n));
  results.push(...earlier);
  results.sort((a, b) => a.n - b.n);
}
// The report: every board, its candidates, the pick, the refined picture and every verdict.
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const rel = (f?: string) => (f ? f.replace(`${OUT}/`, "") : "");
const judgedOf = (r: Result, name: string) => (r.judged?.images ?? []).find((x: { name: string }) => x.name === name);
const done = results.filter((r) => !r.error);
const found = done.filter((r) => r.chosen !== null);
const finalOk = found.filter((r) => judgedOf(r, r.used ?? "original")?.correct && judgedOf(r, r.used ?? "original")?.fitForBoard);
const summary = FREE ? `${done.length} boards searched — the best two distinct pictures each, ranked without AI (Google rank, size, source, shape, title; copies of one picture on other sites removed). $0.` : `${found.length}/${done.length} boards found a picture the checker passed · refined kept faithful on ${found.filter((r) => r.used === "refined").length}/${found.length} · independent judge: the picture shown is correct and fit on ${finalOk.length}/${found.length} · spent $${results.reduce((a, r) => a + r.usd, 0).toFixed(2)}`;
const rows = results.map((r) => {
  const jo = judgedOf(r, "original"), jr = judgedOf(r, "refined");
  const verdict = (v?: Record<string, any>) => (v ? `${v.correct ? "✓ correct" : "✗ wrong"} · ${v.fitForBoard ? "fit" : "not fit"} · ${v.score}/10${v.faults?.length ? `<br><small>${esc(v.faults.join("; "))}</small>` : ""}` : "—");
  return `<section><h2>${r.n}. ${esc(r.board.title)} <small>${esc(r.board.lecture)}</small></h2><p class="brief">${esc(r.board.brief)}</p><p class="q">Searched: ${r.queries.map((q) => `“${esc(q)}”`).join(" → ")}${r.error ? ` <b class="bad">${esc(r.error)}</b>` : ""}</p>
<div class="cands">${r.cands.map((c, i) => `<figure class="${i === r.chosen ? "chosen" : ""}"><a href="${esc(c.url)}" target="_blank" rel="noopener"><img src="${rel(c.file)}" loading="lazy"></a><figcaption><b>#${i + 1}</b> ${esc(c.domain)} · score ${c.score}<br><small>${esc(c.why.join(" · "))}</small>${c.verdict ? `<br>${c.verdict.correct ? "✓" : "✗"} ${c.verdict.rightKind ? "" : "wrong kind "}${c.verdict.watermark ? "watermark " : ""}q${c.verdict.quality}${(c.verdict.faults as string[] | undefined)?.length ? `<br><small>${esc((c.verdict.faults as string[]).join("; "))}</small>` : ""}` : ""}</figcaption></figure>`).join("")}</div>
${r.chosen !== null && !FREE ? `<div class="pair"><figure><img src="${rel(r.cands[r.chosen].file)}"><figcaption><b>Google original</b> (${esc(r.cands[r.chosen].domain)})<br>Judge: ${verdict(jo)}</figcaption></figure><figure><img src="${rel(r.refined)}"><figcaption><b>Refined by ${IMAGE_MODEL}</b> — ${r.faithful ? (r.faithful.faithful ? "faithful to the original" : "<span class=bad>changed the diagram</span>") : "no refine"}${r.faithful?.changes?.length ? `<br><small>${esc(r.faithful.changes.join("; "))}</small>` : ""}<br>Judge: ${verdict(jr)}</figcaption></figure></div><p class="used">Shown to the student: <b>${r.used}</b> · $${r.usd.toFixed(3)} · ${(r.ms / 1000).toFixed(0)} s</p>` : r.chosen === null && !FREE ? `<p class="bad">No candidate passed the checker.</p>` : ""}</section>`;
});
writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Google picture lab</title><style>:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#15171a;--card:#fff;--line:#d8dce2;--muted:#5d6672}@media (prefers-color-scheme:dark){:root{--bg:#111316;--fg:#e8eaed;--card:#1b1e22;--line:#30353c;--muted:#9aa3ad}}body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}main{max-width:1180px;margin:auto}section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:16px 0}h2{margin:0 0 4px;font-size:18px}h2 small,.brief,.q,figcaption{color:var(--muted)}.cands{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cands img{width:100%;height:340px;object-fit:contain;background:#fff;border-radius:8px}@media (max-width:640px){.cands{grid-template-columns:1fr}}figure{margin:0}.chosen img{outline:3px solid #2f9e44}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}.pair img{width:100%;max-height:420px;object-fit:contain;background:#fff;border-radius:8px}.bad{color:#d9480f}figcaption{font-size:13px}@media (max-width:640px){.pair{grid-template-columns:1fr}}</style><main><h1>Google picture lab</h1><p>${summary}</p>${rows.join("\n")}</main>`);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, (_k, v) => (typeof v === "bigint" ? v.toString(16) : v), 1));
console.log(`\n${summary}\nreport: ${OUT}/index.html`);
