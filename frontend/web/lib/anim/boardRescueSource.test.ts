import test from "node:test";
import assert from "node:assert/strict";
import { hasUsableBoard, rescueEmptyBoards } from "../boardFallback";
import type { Beat } from "../lessonContent";
import { labelIsGrounded, sourceVocabulary, type BeatSourceGrounding } from "../sourceGrounding";

/**
 * THE RESCUE OF A REFUSED BOARD, with the beat's source.
 *
 * A strict board the critic refused used to drop to a written board drawn by a model from a brief
 * that never saw the source, with the grounding critics off. Now the source rides along: an opening
 * beat (the student is waiting) goes straight to the written board of its own grounded script — no
 * model call at all — and a later beat keeps the model chain, with the critics on.
 */

const SCRIPT =
  "The photosynthesis reaction needs a supply of energy to make it happen. This energy comes from light. " +
  "The energy is stored in the glucose that is made.";
const SOURCE: BeatSourceGrounding = {
  // As scopedBlockText writes it: the section's heading once, then its text.
  text: `[page 1] Energy transfer\n${SCRIPT} The glucose is a store of chemical potential energy.`,
  labels: ["cell wall", "vacuole"],
  strict: true,
};

function refusedBeat(): Beat {
  return {
    id: "b0",
    title: "Energy transfer",
    script: SCRIPT,
    points: [],
    draw: { caption: "Energy transfer", durationMs: 30_000, ops: [{ kind: "reactAnimation", teachingPoint: "energy", at: 0, endAt: 1, status: "failed" }] },
  } as unknown as Beat;
}

function countingClient() {
  const calls: unknown[] = [];
  const client = {
    chat: {
      completions: {
        create: async (body: unknown) => {
          calls.push(body);
          throw new Error("offline");
        },
      },
    },
  };
  return { client: client as never, calls };
}

test("a STRICT opening beat is rescued with its own written board and no model call", async () => {
  const { client, calls } = countingClient();
  const beat = refusedBeat();
  const stats = await rescueEmptyBoards(client, [beat], new Map(), new Map([["b0", "labelled-diagram" as const]]), {
    sources: new Map([["b0", SOURCE]]),
    blocksPlayback: true,
  });
  assert.equal(calls.length, 0, "nothing on the path to the first board waits on a model");
  assert.equal(stats.rescued, 1);
  assert.equal(stats.costUsd, 0);
  assert.ok(hasUsableBoard(beat));
  const written = JSON.stringify(beat.draw);
  assert.match(written, /This energy comes from light/, "the board is the beat's own (grounded) script");
  // THE BUG: the old last resort was topic-templated — for this very paragraph it wrote
  // "6CO₂ + 6H₂O", "+ light →", a "Rule:" footer and a corner sketch ending in "ATP".
  assert.doesNotMatch(written, /CO₂|ATP|Rule:|☼/);
  const vocab = sourceVocabulary(SOURCE);
  const texts = (beat.draw?.ops ?? []).map((op) => ("text" in op && typeof op.text === "string" ? op.text : "")).filter(Boolean);
  assert.ok(texts.length >= 3, "title plus the spoken sentences");
  for (const text of texts) assert.ok(labelIsGrounded(text, vocab), `"${text}" is in the source`);
});

test("a reference-mode last resort keeps the richer templated board", async () => {
  const { client } = countingClient();
  const beat = refusedBeat();
  await rescueEmptyBoards(client, [beat], new Map(), new Map([["b0", "text" as const]]), {
    sources: new Map([["b0", { ...SOURCE, strict: false }]]),
  });
  assert.ok(hasUsableBoard(beat));
  assert.doesNotMatch(JSON.stringify(beat.draw), /"This energy comes from light\."/, "not the strict source-only board");
});

test("a strict LATER beat keeps the model chain (written ahead of the student)", async () => {
  const { client, calls } = countingClient();
  const beat = refusedBeat();
  await rescueEmptyBoards(client, [beat], new Map(), new Map([["b0", "text" as const]]), { sources: new Map([["b0", SOURCE]]) });
  assert.ok(calls.length > 0, "the chalk board was attempted");
  assert.ok(hasUsableBoard(beat), "and the deterministic board still catches its failure");
});

test("a reference-mode opening beat keeps the model chain, as before", async () => {
  const { client, calls } = countingClient();
  const beat = refusedBeat();
  await rescueEmptyBoards(client, [beat], new Map(), new Map([["b0", "text" as const]]), {
    sources: new Map([["b0", { ...SOURCE, strict: false }]]),
    blocksPlayback: true,
  });
  assert.ok(calls.length > 0);
  assert.ok(hasUsableBoard(beat));
});
