// ACCURACY OF THE SUBJECT CALL (lib/canvas/subjectClassifier.ts) — paid: ~$0.0005 per lecture.
//   NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json scripts/qa/.probe/subjecteval.mts [passes=1]   (0 = only build the cases, free)
// 1) every stored typed/PDF/video lecture, with a true subject marked by hand (scratchpad labels.json);
// 2) hard typed prompts: sciences with calculations, economics and accounting maths, CS that looks like maths.
import { readFileSync, writeFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient } from "@azure/storage-blob";
import { classifySubject, type SubjectEvidence } from "../../../lib/canvas/subjectClassifier";
import { client, jsonCall, PLAN_MODEL, bounded } from "../../../lib/canvas/generate";
import { referenceDocumentOf, strictDocumentOf, videoDocumentOf } from "../../../lib/canvas/lessonRequest";
import { documentSections } from "../../../lib/canvas/documentContext";
const S = "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/2735a389-20f1-4b4d-94c6-1e1ea98cc81e/scratchpad";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const passes = Number(process.argv[2] ?? 1);
const labels = JSON.parse(readFileSync(`${S}/labels.json`, "utf8")) as Record<string, { label: string; kind: string; topic: string }>;
const sessions = JSON.parse(readFileSync(`${S}/sessions.json`, "utf8")) as any[];
const decided = JSON.parse(readFileSync(`${S}/decided.json`, "utf8")) as any[];
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const blobs = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING).getContainerClient(env.AZURE_STORAGE_CONTAINER);
type Case = { name: string; label: string; evidence: SubjectEvidence };
const retry = async <T,>(work: () => Promise<T>): Promise<T> => { for (let k = 0; ; k++) { try { return await work(); } catch (e) { if (k >= 4) throw e; await new Promise((r) => setTimeout(r, 2000)); } } };
const CACHE = `${S}/subject-cases.json`;
let cases: Case[] = [];
try { cases = JSON.parse(readFileSync(CACHE, "utf8")); } catch { /* built below */ }
const built = cases.length > 0;
const seen = new Set<string>();
for (let i = 0; i < (built ? 0 : sessions.length); i++) {
  const key = `${decided[i].kind}|${decided[i].topic.toLowerCase()}`;
  const lab = labels[key];
  if (!lab || seen.has(key)) continue;
  seen.add(key);
  const s = sessions[i];
  const evidence: SubjectEvidence = { topic: s.topic, parts: s.plan.map((b: any) => b.title) };
  if (s.sourceType === "pdf" || s.sourceType === "youtube") {
    const meta = (await retry(() => db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.inputBlobName FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: s.id }] }).fetchAll())).resources[0] as any;
    const input = await retry(() => blobs.getBlobClient(meta.inputBlobName).downloadToBuffer()).then((b) => JSON.parse(b.toString("utf8"))).catch(() => null);
    const doc = input && (referenceDocumentOf(input) ?? strictDocumentOf(input) ?? videoDocumentOf(input));
    if (input?.focus) evidence.request = input.focus;
    if (doc) Object.assign(evidence, { documentTitle: doc.lesson?.title, headings: documentSections(doc), excerpt: (doc.contentBlocks ?? []).map((b: any) => b.text ?? "").join(" ").slice(0, 900) });
  }
  cases.push({ name: `${lab.kind}: ${s.topic}`, label: lab.label, evidence });
}
// Hard typed prompts. Codes: M maths, C computer science, O other, G maths or CS, MO maths or other.
const HARD: Array<[string, string]> = [
  ["Calculating moles from mass", "O"], ["Balancing chemical equations", "O"], ["Rates of reaction graphs", "O"], ["Titration calculations", "O"], ["Electrolysis half equations", "O"],
  ["Hardy-Weinberg equation", "O"], ["Punnett squares and genetic ratios", "O"], ["Magnification calculations in biology", "O"], ["Osmosis in potato cells: percentage change in mass", "O"],
  ["Ohm's law calculations", "O"], ["Specific heat capacity calculations", "O"], ["Projectile motion in physics", "O"], ["Hooke's law and the spring constant", "O"], ["Half-life and radioactive decay", "O"], ["Vectors and scalars in physics", "O"],
  ["Supply and demand graphs", "O"], ["Price elasticity of demand formula", "O"], ["Accounting ratios: gross profit margin", "O"], ["Break-even analysis", "O"], ["Inflation and interest rates", "O"],
  ["Population pyramids", "O"], ["Climate graphs", "O"], ["Music theory: time signatures and note values", "O"], ["Perspective drawing and vanishing points", "O"], ["Causes of the French Revolution", "O"],
  ["Themes in Macbeth", "O"], ["Persuasive writing techniques", "O"], ["Photosynthesis equation", "O"], ["photosynthesis kia hai", "O"], ["Factors affecting enzyme activity", "O"],
  ["Solve 2x + 3 = 11", "M"], ["Differentiate x³ sin x", "M"], ["Simultaneous equations word problems", "M"], ["Probability of rolling two sixes", "M"], ["Mean, median and mode", "M"],
  ["Standard form", "M"], ["Bearings and scale drawings", "M"], ["Position vectors and midpoints", "M"], ["Hypothesis testing with the binomial distribution", "M"], ["Matrix transformations", "M"],
  ["nth term of a sequence", "M"], ["Compound interest", "M"], ["Loci and constructions", "M"], ["The normal distribution", "M"], ["Integration with partial fractions", "M"],
  ["quadratic equation kaise solve karte hain", "M"], ["Constant acceleration (suvat) equations", "MO"], ["Speed, distance and time graphs", "MO"], ["Graph colouring", "G"], ["Boolean algebra simplification", "G"],
  ["How RSA encryption works", "C"], ["SHA-256 hashing", "C"], ["TCP vs UDP", "C"], ["How DNS works", "C"], ["Subnetting IP addresses", "C"],
  ["SQL joins", "C"], ["Database normalisation", "C"], ["Binary to denary conversion", "C"], ["How pixels store colour", "C"], ["Sound sampling and bit depth", "C"],
  ["Logic gates: NAND and NOR", "C"], ["The fetch-decode-execute cycle", "C"], ["Virtual memory and paging", "C"], ["Deadlock in operating systems", "C"], ["Git branching and merging", "C"],
  ["Agile vs waterfall", "C"], ["Big O of nested loops", "C"], ["Recursion vs iteration", "C"], ["Hash maps in Java", "C"], ["React components and props", "C"],
  ["HTML and CSS basics", "C"], ["Firewalls and malware", "C"], ["Huffman coding", "C"], ["binary search samjhao", "C"], ["Convolutional neural networks", "G"],
  ["K-means clustering", "G"], ["Number bases in computing", "C"], ["Floating point representation", "C"], ["Caesar cipher", "C"], ["Packet switching", "C"],
];
if (!built) {
  for (const [topic, label] of HARD) cases.push({ name: `hard: ${topic}`, label, evidence: { topic } });
  writeFileSync(CACHE, JSON.stringify(cases));
}
const ok = (label: string, got: string | null) => (label === "G" ? got === "maths" || got === "cs" : label === "MO" ? got === "maths" || got === "other" : label === "OC" ? got === "other" || got === "cs" : got === { M: "maths", C: "cs", O: "other" }[label]);
const openai = client();
let cost = 0;
const wrong: string[] = [];
const flips: string[] = [];
for (let p = 1; p <= passes; p++) {
  const got: Array<string | null> = new Array(cases.length).fill(null);
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < cases.length) {
      const i = next++;
      const r = await bounded(classifySubject((s, u, m) => jsonCall(openai, PLAN_MODEL, s, u, m), cases[i].evidence), 30_000, "subject").catch(() => ({ subject: null, costUsd: 0 }));
      cost += r.costUsd;
      got[i] = r.subject;
    }
  }));
  cases.forEach((c, i) => { if (!ok(c.label, got[i])) wrong.push(`pass ${p}: [${c.label}] ${c.name.slice(0, 70)} → ${got[i]}`); });
  (cases as any[]).forEach((c, i) => { if (p > 1 && c.prev !== got[i]) flips.push(`${c.name.slice(0, 60)}: ${c.prev} / ${got[i]}`); c.prev = got[i]; });
}
console.log(`${cases.length} lectures × ${passes} pass(es): ${cases.length * passes - wrong.length} right, ${wrong.length} wrong; $${cost.toFixed(3)}`);
for (const w of wrong) console.log("  WRONG", w);
for (const f of flips) console.log("  CHANGED BETWEEN PASSES", f);
