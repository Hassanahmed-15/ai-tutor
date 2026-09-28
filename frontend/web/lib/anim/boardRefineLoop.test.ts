/**
 * The generator end to end — candidates, gates, refine loop, trial log — against a scripted fake of
 * the OpenAI client, so every model call is counted and every prompt can be read.
 *
 * What is pinned here is what changed about COST and ORDER, because that is where latency lives:
 *   - a known fault goes straight to the refiner (no vision call to rediscover it),
 *   - a revision that regresses on the deterministic gates is rejected BEFORE a rescore is paid for,
 *   - an accepted rescore is reused as the next critique (never a second look at the same code),
 *   - an opening beat's tight budget skips a refine round it could not finish,
 * and, for strict source mode, that the source reaches every prompt and an invented word is repaired.
 *
 * The trial log is written relative to the working directory, so this file moves into a temp
 * directory BEFORE the generator is loaded (dynamic imports below) and never touches the real log.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ENERGY_SCRIPT, ENERGY_SOURCE, FAITHFUL_TEXTS, fixtureBoard, type FixtureText } from "./boardFixtures";

const WORKDIR = mkdtempSync(path.join(tmpdir(), "board-refine-"));
process.chdir(WORKDIR);

type Kind = "generate" | "refine" | "shape" | "critic";
type Call = { kind: Kind; request: { model: string; temperature?: number; messages: Array<{ role: string; content: unknown }> } };

function fakeClient(respond: (kind: Kind, n: number) => string) {
  const calls: Call[] = [];
  const client = {
    chat: {
      completions: {
        create: async (request: Call["request"]) => {
          const system = String(request.messages?.[0]?.content ?? "");
          const kind: Kind = system.startsWith("You revise")
            ? "refine"
            : system.startsWith("You are a strict scientific illustrator")
              ? "shape"
              : system.startsWith("You review a teaching whiteboard")
                ? "critic"
                : "generate";
          const n = calls.filter((call) => call.kind === kind).length;
          calls.push({ kind, request });
          return {
            choices: [{ message: { content: respond(kind, n) }, finish_reason: "stop" }],
            usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
          };
        },
      },
    },
  };
  const count = (kind: Kind) => calls.filter((call) => call.kind === kind).length;
  const text = (call: Call) =>
    call.request.messages
      .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)))
      .join("\n");
  return { client, calls, count, text };
}

const fence = (code: string) => "```jsx\n" + code + "\n```";

function beatFor(id: string, title = "Energy Transfer") {
  return {
    id,
    title,
    script: ENERGY_SCRIPT,
    teacherMove: "explain",
    points: [],
    slideKind: "concept",
    draw: { caption: title, durationMs: 25_000, ops: [{ kind: "reactAnimation", teachingPoint: "Energy transfer in a palisade cell", at: 0, endAt: 1 }] },
  };
}

const opOf = (beat: ReturnType<typeof beatFor>) => beat.draw.ops[0] as { code?: string; status?: string; trial?: { refineTrail?: string } };

const invented: FixtureText[] = FAITHFUL_TEXTS.map((row, i) => (i === 1 ? { ...row, text: "Sunlight powers the cell" } : row));
// "nucleus" moved onto "vacuole": a revision that introduces an overlap.
const overlapped: FixtureText[] = FAITHFUL_TEXTS.map((row) => (row.text === "nucleus" ? { ...row, y: 252, x: 694 } : row));

test("strict: an invented word is repaired from the known fault — no vision call to find it, source in every prompt", async () => {
  const gen = await import("../reactAnimationGen");
  const fake = fakeClient((kind) =>
    kind === "generate" ? fence(fixtureBoard(invented))
    : kind === "refine" ? fence(fixtureBoard(FAITHFUL_TEXTS))
    : kind === "shape" ? '{"recognizable": true, "score": 4, "issue": ""}'
    : '{"score": 5, "defects": []}',
  );
  const beat = beatFor("strict-1");
  const stats = await gen.fillReactAnimationOps(fake.client as never, [beat as never], { sourceByBeatId: { "strict-1": ENERGY_SOURCE } });

  const op = opOf(beat);
  assert.equal(stats.filled, 1);
  assert.equal(op.status, "ready");
  assert.match(op.code ?? "", /This energy comes from light\./);
  assert.doesNotMatch(op.code ?? "", /Sunlight/, "the shipped board writes only source words");

  // The source reached the generator, with the strict override last in the system prompt.
  const generation = fake.calls.find((call) => call.kind === "generate")!;
  assert.match(String(generation.request.messages[0].content), /SOURCE-FAITHFUL MODE/);
  assert.match(fake.text(generation), /PARTS THE SOURCE FIGURE SHOWS[^\n]*chloroplast containing chlorophyll/);

  // The refiner got the numbered script, the source, and the exact fault.
  assert.equal(fake.count("refine"), 1);
  const refine = fake.text(fake.calls.find((call) => call.kind === "refine")!);
  assert.match(refine, /\[0\] The photosynthesis reaction/);
  assert.match(refine, /SOURCE — the student's own material/);
  assert.match(refine, /"Sunlight powers the cell" is not in the source/);

  // No candidate paid for a shape look (each had a known fault); the only looks are after the fix.
  assert.equal(fake.count("shape"), 1, "one shape look: the refusal gate on the repaired board");
  assert.equal(fake.count("critic"), 1);
  const critic = fake.calls.find((call) => call.kind === "critic")!;
  assert.equal(critic.request.temperature, 0, "scores that decide acceptance are not sampled");
  assert.match(String(critic.request.messages[0].content), /faithfully/, "the strict rubric, not the textbook one");

  const trials = readFileSync(path.join(WORKDIR, ".animation-trials", "trials.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const trial = trials.find((t) => t.beatId === "strict-1");
  assert.equal(trial.strict, true);
  assert.equal(trial.grounded, true);
  assert.equal(trial.layout, "clean");
  assert.match(trial.refineTrail, /seed=deterministic/);
});

test("an opening beat's tight budget ships a passing board without a refine round it could not finish", async () => {
  const gen = await import("../reactAnimationGen");
  const fake = fakeClient((kind) =>
    kind === "generate" ? fence(fixtureBoard(FAITHFUL_TEXTS, { rich: true }))
    : kind === "shape" ? '{"recognizable": true, "score": 4, "issue": ""}'
    : '{"score": 3, "defects": [{"what": "x", "where": "y", "fix": "z"}]}',
  );
  const beat = beatFor("starter-1", "Palisade cell");
  const stats = await gen.fillReactAnimationOps(fake.client as never, [beat as never], { refineTimeBudgetMs: 10_000 });
  assert.equal(stats.filled, 1);
  assert.equal(stats.timings?.[0]?.outcome, "shipped");
  assert.equal(fake.count("critic"), 0, "no critique started that the budget could not follow through");
  assert.equal(fake.count("refine"), 0);
  assert.equal(fake.count("shape"), 1, "identical candidates share one memoised shape look");
});

test("a revision that regresses on the deterministic gates is rejected before any rescore is paid for", async () => {
  const gen = await import("../reactAnimationGen");
  const original = fixtureBoard(FAITHFUL_TEXTS, { rich: true });
  const fake = fakeClient((kind) =>
    kind === "generate" ? fence(original)
    : kind === "refine" ? fence(fixtureBoard(overlapped, { rich: true }))
    : kind === "shape" ? '{"recognizable": true, "score": 4, "issue": ""}'
    : '{"score": 3, "defects": [{"what": "the labels sit far from the cell", "where": "right", "fix": "move the labels closer"}]}',
  );
  const beat = beatFor("regress-1", "Palisade cell");
  await gen.fillReactAnimationOps(fake.client as never, [beat as never]);
  assert.equal(fake.count("refine"), 1);
  assert.equal(fake.count("critic"), 1, "the regressed revision was never rescored");
  assert.equal(opOf(beat).code?.trim(), original.trim(), "the original board ships");
  assert.match(opOf(beat).trial?.refineTrail ?? "", /regressed/);
});

test("an accepted rescore is reused as the next critique — never a second look at the same code", async () => {
  const gen = await import("../reactAnimationGen");
  const revised = fixtureBoard(FAITHFUL_TEXTS, { rich: true, cellX: 396 });
  const fake = fakeClient((kind, n) =>
    kind === "generate" ? fence(fixtureBoard(FAITHFUL_TEXTS, { rich: true }))
    : kind === "refine" ? fence(revised)
    : kind === "shape" ? '{"recognizable": true, "score": 4, "issue": ""}'
    : n === 0
      ? '{"score": 3, "defects": [{"what": "the wall is thin", "where": "cell", "fix": "thicken the wall stroke"}]}'
      : '{"score": 5, "defects": []}',
  );
  const beat = beatFor("reuse-1", "Palisade cell");
  await gen.fillReactAnimationOps(fake.client as never, [beat as never]);
  assert.equal(fake.count("refine"), 1);
  assert.equal(fake.count("critic"), 2, "critique, rescore — and no third look at the accepted code");
  assert.equal(opOf(beat).code?.trim(), revised.trim());
});

test("a board the student is waiting on makes no refine call; a strict one still loses its invented word", async () => {
  const gen = await import("../reactAnimationGen");
  const fake = fakeClient((kind) =>
    kind === "generate" ? fence(fixtureBoard(invented))
    : kind === "shape" ? '{"recognizable": true, "score": 4, "issue": ""}'
    : kind === "refine" ? fence(fixtureBoard(FAITHFUL_TEXTS))
    : '{"score": 5, "defects": []}',
  );
  const beat = beatFor("starter-strict-1");
  const stats = await gen.fillReactAnimationOps(fake.client as never, [beat as never], {
    sourceByBeatId: { "starter-strict-1": ENERGY_SOURCE },
    blocksPlayback: true,
    refineTimeBudgetMs: 20_000,
  });
  assert.equal(fake.count("refine"), 0);
  assert.equal(fake.count("critic"), 0);
  assert.equal(fake.count("shape"), 1, "one shape look, shared by the identical candidates");
  const code = opOf(beat).code ?? "";
  assert.doesNotMatch(code, /Sunlight/, "the invented line was deleted at zero model cost");
  assert.match(code, /chloroplast containing/, "the source's labels stay");
  // Deleted on arrival, so the candidate PASSED and ended the round instead of waiting for the others.
  assert.equal(stats.timings?.[0]?.outcome, "shipped");
  assert.match(opOf(beat).trial?.refineTrail ?? "", /starter:no-refine/);
});

test("a strict opening board whose invented word cannot be removed cleanly still ships stripped after the round", async () => {
  const gen = await import("../reactAnimationGen");
  // The invented line ALSO overlaps a label, so it is not the only fault: no strip-to-pass.
  const tangled: FixtureText[] = FAITHFUL_TEXTS.map((row, i) => (i === 1 ? { ...row, text: "Sunlight powers the cell" } : row))
    .concat([{ text: "vacuole", x: 692, y: 252, size: 20, sentence: 3 }]);
  const fake = fakeClient((kind) =>
    kind === "generate" ? fence(fixtureBoard(tangled))
    : kind === "shape" ? '{"recognizable": true, "score": 4, "issue": ""}'
    : '{"score": 5, "defects": []}',
  );
  const beat = beatFor("starter-strict-2");
  const stats = await gen.fillReactAnimationOps(fake.client as never, [beat as never], {
    sourceByBeatId: { "starter-strict-2": ENERGY_SOURCE },
    blocksPlayback: true,
  });
  assert.equal(fake.count("refine"), 0);
  assert.equal(stats.timings?.[0]?.outcome, "sub-floor");
  assert.doesNotMatch(opOf(beat).code ?? "", /Sunlight/);
  assert.match(opOf(beat).trial?.refineTrail ?? "", /starter:no-refine -> stripped/);
});

test("strict with no source figure: no recognisability judge to refuse the sparse faithful board", async () => {
  const gen = await import("../reactAnimationGen");
  const wordEquation = {
    text: "Photosynthesis is the way that plants make food. They use carbon dioxide and water to make glucose and oxygen. " +
      "Photosynthesis is a chemical reaction. We can summarise it using a word equation: carbon dioxide + water → glucose + oxygen",
    labels: [],
    strict: true,
  };
  const texts: FixtureText[] = [
    { text: "Photosynthesis", x: 76, y: 78, size: 34, sentence: 0, kind: "write" },
    { text: "carbon dioxide + water", x: 76, y: 160, size: 22, sentence: 1, kind: "write" },
    { text: "glucose + oxygen", x: 76, y: 220, size: 22, sentence: 1, kind: "write" },
    { text: "a chemical reaction", x: 76, y: 280, size: 22, sentence: 2, kind: "write" },
    { text: "word equation", x: 690, y: 300, size: 20, sentence: 3 },
  ];
  const fake = fakeClient((kind) =>
    kind === "generate" ? fence(fixtureBoard(texts))
    : kind === "shape" ? '{"recognizable": false, "score": 1, "issue": "no plant is drawn"}'
    : '{"score": 5, "defects": []}',
  );
  const beat = { ...beatFor("strict-text-1", "Photosynthesis"), script: "Photosynthesis is the way that plants make food. They use carbon dioxide and water to make glucose and oxygen. Photosynthesis is a chemical reaction. We can summarise it using a word equation." };
  const stats = await gen.fillReactAnimationOps(fake.client as never, [beat as never], {
    sourceByBeatId: { "strict-text-1": wordEquation },
    blocksPlayback: true,
  });
  assert.equal(fake.count("shape"), 0, "never asked, so never refused");
  assert.equal(stats.filled, 1);
  assert.equal(stats.timings?.[0]?.outcome, "shipped");
});

test("the trial log was written in the temp directory, not the repo", () => {
  assert.ok(existsSync(path.join(WORKDIR, ".animation-trials", "trials.jsonl")));
});
