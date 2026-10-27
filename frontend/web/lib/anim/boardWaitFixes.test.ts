import test from "node:test";
import assert from "node:assert/strict";
import { runInSlots } from "../progressiveWorkerSlots";
import { applyReviewWording, clearWrongNotes, notesCalledWrong, parseBoardReview, wrongNoteKey } from "../canvas/boardReview";
import type { CanvasBoardSpec } from "../canvas/types";

// THE WAIT FOR BOARD 1 (owner, 2026-10-27): a blood lesson's first board appeared after 4 min 14 s — 56 s the
// worker starting, 14 s its boards queued behind the plan's knowledge graph, ~35 s two review rounds.

test("a free worker slot takes the next task at once: a long task never holds up the ones queued after it", async () => {
  const queue = ["plan", "b1", "b2", "b3"];
  const started: Record<string, number> = {};
  let running = 0;
  let most = 0;
  const t0 = Date.now();
  let stop = false;
  await runInSlots({
    slots: 4,
    stopping: () => stop,
    idleMs: 5,
    busyMs: 5,
    // The plan task arrives alone; the boards are queued by it 20 ms later, as the worker dispatches them.
    receive: async (max) => (Date.now() - t0 < 20 ? queue.splice(0, 1) : queue.splice(0, max)),
    handle: async (task) => {
      started[task] = Date.now() - t0;
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, task === "plan" ? 300 : 50));
      running--;
      if (!queue.length && Object.keys(started).length === 4) setTimeout(() => { stop = true; }, 10);
    },
  });
  assert.ok(started.b1 < 150, `board 1 started at ${started.b1} ms, while the plan task (300 ms) still ran`);
  assert.ok(most <= 4, "never more tasks at once than slots");
  assert.equal(running, 0, "stopping waits for the running tasks");
});

const board = (notes: string[]) => ({ v: 1, heading: "The four components of blood", notes: notes.map((text, i) => ({ id: `n${i + 1}`, text, s: i })), stage: { kind: "illustration", subject: "blood", parts: [], labels: [] }, cues: [] }) as unknown as CanvasBoardSpec;

test("the review's own rewording of a note is applied with no rewrite", () => {
  const review = parseBoardReview({ ship: false, problems: [{ kind: "factually-wrong", detail: 'The note "Complete blood cells" is not a biological category. Replace it with "Blood cells".', from: "Complete blood cells", to: "Blood cells" }] });
  const spec = board(["Four blood components", "Complete blood cells", "Platelets: cell fragments"]);
  const p = review.problems[0];
  assert.equal(applyReviewWording(spec, p.from!, p.to!), true);
  assert.deepEqual(spec.notes.map((n) => n.text), ["Four blood components", "Blood cells", "Platelets: cell fragments"]);
  assert.equal(applyReviewWording(spec, "Not on this board", "x"), false, "words no note has change nothing");
});

test("a note the review called wrong never ships, even when the rewrite kept it", () => {
  const spec = board(["Four blood components", "Complete blood cells", "Plasma: liquid part"]);
  // No rewording given: the note is quoted in the detail.
  const wrongs = notesCalledWrong(spec, { kind: "factually-wrong", detail: 'The note "Complete blood cells" is not a correct biological category.' });
  assert.deepEqual(wrongs, ["Complete blood cells"]);
  assert.deepEqual(notesCalledWrong(spec, { kind: "mislabelled", detail: 'There is no "White blood cell" label.' }), [], "a label problem never removes a note");
  const wrong = new Map(wrongs.map((w) => [wrongNoteKey(w), undefined]));
  const rewritten = board(["Four blood components", "Complete blood cells.", "Plasma: liquid part"]);
  assert.deepEqual(clearWrongNotes(rewritten, wrong), ['"Complete blood cells." removed']);
  assert.deepEqual(rewritten.notes.map((n) => n.text), ["Four blood components", "Plasma: liquid part"]);
  // With the review's rewording, the note is corrected instead.
  const reworded = board(["Complete blood cells"]);
  clearWrongNotes(reworded, new Map([[wrongNoteKey("Complete blood cells"), "Blood cells"]]));
  assert.deepEqual(reworded.notes.map((n) => n.text), ["Blood cells"]);
});

// ARIA GOES QUIET (owner, 2026-10-27): a stalled sentence at OpenAI was 6-12 s of silence; a slow call now gets a
// second call beside it and the first to finish is used (lib/ttsHedge.ts).
import { hedged, type SpeechCall } from "../ttsHedge";

const fakeCall = (answerMs: number | null, finishMs: number | null, value: string, log: string[]): SpeechCall<string> => {
  let abort = () => {};
  let answer = () => {};
  const answered = new Promise<void>((r) => { answer = r; });
  const result = new Promise<string>((resolve, reject) => {
    abort = () => { log.push(`${value} dropped`); reject(new Error("aborted")); };
    if (answerMs !== null) setTimeout(answer, answerMs);
    if (finishMs !== null) setTimeout(() => resolve(value), finishMs);
    else if (answerMs === null) setTimeout(() => reject(new Error("no answer")), 60);
  });
  return { result, answered, abort: () => abort() };
};

test("a healthy sentence is asked for once", async () => {
  const log: string[] = [];
  let calls = 0;
  const got = await hedged(() => (calls++, fakeCall(5, 15, "first", log)), { answerMs: 25, finishMs: 60 });
  assert.equal(got, "first");
  assert.equal(calls, 1);
});

test("a call with no answer gets a second one, and the first to finish is used", async () => {
  const log: string[] = [];
  const why: string[] = [];
  const queue = [fakeCall(null, null, "hung", log), fakeCall(5, 10, "second", log)];
  const t0 = Date.now();
  const got = await hedged(() => queue.shift()!, { answerMs: 25, finishMs: 60, onHedge: (w) => why.push(w) });
  assert.equal(got, "second");
  assert.ok(Date.now() - t0 < 55, "answered by the second call, not after the first one's failure");
  assert.match(why[0], /no answer/);
});

test("a call that stalls half-way gets a second one; the stalled one is dropped", async () => {
  const log: string[] = [];
  const queue = [fakeCall(5, null, "stalled", log), fakeCall(5, 10, "second", log)];
  const got = await hedged(() => queue.shift()!, { answerMs: 25, finishMs: 30 });
  assert.equal(got, "second");
  assert.deepEqual(log, ["stalled dropped"]);
});

test("when both calls fail, the failure goes up so the route can ask again", async () => {
  const log: string[] = [];
  const queue = [fakeCall(null, null, "a", log), fakeCall(null, null, "b", log)];
  await assert.rejects(hedged(() => queue.shift()!, { answerMs: 20, finishMs: 30 }), /no answer|aborted/);
});
