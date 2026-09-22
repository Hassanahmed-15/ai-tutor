/**
 * GENERATE REAL LESSONS AND AUDIT THEM FOR REPETITION.
 *
 * Builds the plan exactly as the progressive worker does (lib/progressivePlan.ts), writes each
 * board's script with the IDENTICAL prompt the worker uses (lib/beatScriptPrompt.ts), and runs the
 * same auditor the worker enforces (lib/lessonRepetition.ts) — regenerate once with the offending
 * sentences named, then strip what still repeats. Prints a per-topic report and writes every
 * script to a Markdown file so the lecture can be read end to end.
 *
 *   npx tsc -p tsconfig.test.json && node scripts/audit-lesson-generation.mjs ["topic" ...]
 *
 * Costs real money: one script call per board (gpt-4o-mini by default), plus one more per board
 * that had to be regenerated. Visuals are NOT generated — they are not where repetition lives.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(new URL(".", import.meta.url).pathname, "..");

// .env.local, by hand: this runs outside Next.
for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("OPENAI_API_KEY missing from .env.local");
const MODEL = process.env.OPENAI_PROGRESSIVE_MODEL ?? process.env.OPENAI_LECTURE_MODEL ?? "gpt-4o-mini";

const { buildProgressivePlan } = require(path.join(root, ".test-build/lib/progressivePlan.js"));
const { buildBeatScriptMessages, keyClaimsFrom } = require(path.join(root, ".test-build/lib/beatScriptPrompt.js"));
const { auditBeat, subjectTerms, repairScript, describeFinding, noveltyRatio } = require(path.join(root, ".test-build/lib/lessonRepetition.js"));
const { descends } = require(path.join(root, ".test-build/lib/lessonLadder.js"));
const { depthBudget } = require(path.join(root, ".test-build/lib/lectureDepth.js"));
const OpenAI = require(path.join(root, "../../node_modules/openai")).default;

const client = new OpenAI({ apiKey });
const topics = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["What is overfitting?", "photosynthesis", "how linear regression works", "the TCP three-way handshake", "the Krebs cycle", "supply and demand"];
const depth = process.env.AUDIT_DEPTH ?? "balanced";

const outDir = path.join(process.env.AUDIT_OUT ?? path.join(root, ".lesson-audit"));
fs.mkdirSync(outDir, { recursive: true });

async function writeBoard(topic, planned, plan, taught, repetitionFeedback) {
  const budget = depthBudget(depth);
  const { system, user } = buildBeatScriptMessages({
    topic,
    planned,
    plan,
    taught,
    wordRange: `${budget.wordRange[0]}-${budget.wordRange[1]}`,
    movements: budget.movements,
    learnerProfile: { expertise: "beginner", depth, goal: "understand the idea", codeExamples: false },
    isCheckpoint: false,
    repetitionFeedback,
  });
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_object" },
    temperature: 0.35,
    max_tokens: 2000,
  });
  const payload = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  const script = typeof payload.script === "string" ? payload.script.trim() : "";
  return { script, keyClaims: keyClaimsFrom(payload, script), usage: completion.usage };
}

const summary = [];
for (const topic of topics) {
  const plan = buildProgressivePlan({
    topic,
    mood: "",
    sourceType: "prompt",
    mode: "standard",
    learnerProfile: { expertise: "beginner", depth, goal: "understand the idea", codeExamples: false, preferredExamples: [] },
  });
  const subject = subjectTerms(topic);
  const beats = [];
  const taught = [];
  const report = [`# ${topic}`, "", `model: ${MODEL} · depth: ${depth} · boards: ${plan.length}`, "", "## Plan", ""];
  for (const p of plan) report.push(`${p.sequence + 1}. **${p.title}** _(${p.role ?? "?"}${p.conceptPasses > 1 ? `, pass ${p.conceptPass}/${p.conceptPasses}` : ""})_ — ${p.objective}`);
  report.push("", "## Boards", "");

  let firstPassFindings = 0;
  let afterRegen = 0;
  let afterRepair = 0;
  let regenerated = 0;
  let repaired = 0;
  let tokens = 0;

  for (const planned of plan) {
    const priors = beats.map((b) => ({ title: b.title, script: b.script, role: b.role }));
    let attempt = await writeBoard(topic, planned, plan, taught);
    tokens += attempt.usage?.total_tokens ?? 0;
    let findings = auditBeat({ title: planned.title, script: attempt.script, role: planned.role }, priors, subject, planned.sequence);
    firstPassFindings += findings.length;
    const firstFindings = findings;
    let stage = "clean";
    if (findings.length > 0) {
      regenerated += 1;
      const feedback = findings.map((finding) => ({ finding, matchedTitle: finding.matchBeatIndex !== undefined ? plan[finding.matchBeatIndex]?.title : undefined }));
      attempt = await writeBoard(topic, planned, plan, taught, feedback);
      tokens += attempt.usage?.total_tokens ?? 0;
      findings = auditBeat({ title: planned.title, script: attempt.script, role: planned.role }, priors, subject, planned.sequence);
      afterRegen += findings.length;
      stage = findings.length ? "regenerated-still-repeats" : "regenerated-clean";
      if (findings.length > 0) {
        const fixed = repairScript(attempt.script, findings);
        if (fixed.repaired) {
          repaired += 1;
          attempt = { ...attempt, script: fixed.script };
          findings = auditBeat({ title: planned.title, script: attempt.script, role: planned.role }, priors, subject, planned.sequence);
          stage = findings.length ? "repaired-still-overlaps" : "repaired-clean";
        }
      }
      afterRepair += findings.length;
    }
    const beat = { title: planned.title, script: attempt.script, role: planned.role };
    beats.push(beat);
    taught.push({ sequence: planned.sequence, title: planned.title, keyClaims: attempt.keyClaims, previousScript: attempt.script });
    // Only the immediately previous board carries its full script forward.
    for (const t of taught.slice(0, -1)) delete t.previousScript;

    report.push(`### ${planned.sequence + 1}. ${planned.title} _(${planned.role ?? "?"})_ — ${stage}`, "");
    report.push(attempt.script, "");
    report.push(`_established:_ ${attempt.keyClaims.map((c) => `"${c}"`).join("; ")}`, "");
    if (firstFindings.length) {
      report.push("_first attempt repeated:_", ...firstFindings.map((f) => `- ${describeFinding(f, [...priors, beat])}`), "");
    }
    if (findings.length) {
      report.push("_STILL FLAGGED after repair:_", ...findings.map((f) => `- ${describeFinding(f, [...priors, beat])}`), "");
    }
    const novelty = noveltyRatio(beat, findings);
    process.stdout.write(`  ${topic} · board ${planned.sequence + 1}/${plan.length} ${planned.role ?? "?"} · ${stage} · novelty ${novelty.toFixed(2)}\n`);
  }

  // Descent is judged over first passes: a new subtopic may start below the previous one's last pass.
  const roles = plan.filter((p) => (p.conceptPass ?? 1) === 1).map((p) => p.role).filter(Boolean);
  const line = {
    topic,
    boards: plan.length,
    descends: descends(roles),
    firstPassFindings,
    regenerated,
    afterRegen,
    repaired,
    afterRepair,
    tokens,
  };
  summary.push(line);
  report.push("## Result", "", "```json", JSON.stringify(line, null, 2), "```");
  const file = path.join(outDir, `${topic.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`);
  fs.writeFileSync(file, report.join("\n"));
  console.log(`  → ${file}`);
}

console.log("\nSUMMARY");
console.table(summary);
const shipped = summary.reduce((n, s) => n + s.afterRepair, 0);
console.log(shipped === 0 ? "\nEvery board shipped clean: no restated sentence, re-definition, re-analogy, return to basics or beat overlap survived." : `\n${shipped} finding(s) survived repair — see the reports.`);
