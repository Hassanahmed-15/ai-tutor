/**
 * WILL EVERY STRICT SLIDE GET A BOX ON THE PDF? — computed offline, no lecture generated.
 *
 * Parses a PDF through the running app (a parse costs cents), then runs the real strict planner
 * (`buildProgressivePlan`) and the panel's own state (`pdfTeachingState`) over it, from .test-build
 * (`npx tsc -p tsconfig.test.json`). Prints, per planned slide: its pages, its blocks, and how many
 * of them the panel can box (have a bbox) versus draw as the edge bar only.
 *
 *   node scripts/strict-box-audit.mjs <pdf> <email> <password-file> [--question "…"] [--save out.json]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildProgressivePlan } = require("../.test-build/lib/progressivePlan.js");
const { pdfTeachingState } = require("../.test-build/lib/pdfTeachingState.js");

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ""; };
const [pdf, email, pwFile] = args.filter((a, i) => !a.startsWith("--") && !["--question", "--save"].includes(args[i - 1]));
const question = flag("--question");
const save = flag("--save");

const login = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: fs.readFileSync(pwFile, "utf8").trim() }) });
const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
const form = new FormData();
form.append("file", new Blob([fs.readFileSync(pdf)], { type: "application/pdf" }), path.basename(pdf));
const res = await fetch(`${BASE}/api/parse-pdf`, { method: "POST", headers: { cookie }, body: form });
const parse = await res.json();
if (!res.ok) throw new Error(`parse failed: ${res.status} ${parse.error ?? ""}`);
if (save) fs.writeFileSync(save, JSON.stringify(parse));
const doc = parse.sourceDocument;
const blocks = doc.contentBlocks ?? [];
const withBox = blocks.filter((b) => b.bbox).length;
console.log(`parsed ${blocks.length} blocks on ${new Set(blocks.map((b) => b.pageNumber)).size} pages; ${withBox} have a bbox; lessonPlan beats: ${doc.lessonPlan?.beats?.length ?? 0}`);

const plan = buildProgressivePlan({
  topic: doc.lesson?.title ?? "Document",
  mood: "", sourceType: "pdf", mode: "standard",
  suprnotes: doc,
  sourceScope: { fidelity: "strict", breadth: question ? { kind: "question", focus: question } : { kind: "whole" }, documentLabels: [] },
  ...(question ? { focus: question } : {}),
  learnerProfile: { expertise: "intermediate", depth: "balanced", goal: "curiosity", codeExamples: false, preferredExamples: "mixed", rationale: "", confirmedAt: "" },
});
const beats = plan.map((b) => ({ sourceBlockIds: b.sourceBlockIds ?? [] }));
let noBox = 0;
console.log(`\nSTRICT plan${question ? ` for "${question}"` : " (all pages)"}: ${plan.length} slide(s)`);
plan.forEach((b, i) => {
  const state = pdfTeachingState(beats, i, doc);
  const boxed = state.highlights.filter((h) => h.rect).length;
  const edgeOnly = state.highlights.length - boxed;
  const pages = [...new Set(state.highlights.map((h) => h.pageNumber))].join(",");
  if (boxed === 0) noBox++;
  console.log(`${String(i + 1).padStart(2)}. "${b.title}"  pages ${pages || "-"}  blocks ${b.sourceBlockIds?.length ?? 0} → boxed ${boxed}, edge-bar only ${edgeOnly}${boxed === 0 ? "   <-- NO BOX" : ""}  [shown page ${state.activePage ?? "-"}]`);
});
console.log(`\n${noBox} of ${plan.length} slides would show no box.`);
