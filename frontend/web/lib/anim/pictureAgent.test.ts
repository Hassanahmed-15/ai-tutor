import test from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { MAX_TYPED_PICTURES, choosePictures } from "../canvas/pictureAgent";
import type { CanvasPlanBeat, CanvasStage } from "../canvas/types";

/* The picture agent (owner, 2026-11-26): a typed lecture's pictures are chosen board by board, at most four. */

const beat = (id: string, title: string, stage: CanvasStage): CanvasPlanBeat => ({ id, title, stage, script: `${title}.`, brief: title, objects: [] }) as unknown as CanvasPlanBeat;
/** An OpenAI client that answers the agent's one call with `reply`. */
const fake = (reply: unknown, seen: string[] = []) => ({
  chat: { completions: { create: async (body: { messages: Array<{ content: string }> }) => { seen.push(body.messages.map((m) => m.content).join("\n")); return { choices: [{ message: { content: JSON.stringify(reply) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }; } } },
}) as unknown as OpenAI;

const lecture = [
  beat("b1", "The route to World War I", "flow"),
  beat("b2", "The Sarajevo assassination", "flow"),
  beat("b3", "Trench warfare on the Western Front", "compare"),
  beat("b4", "The alliance system", "illustration"),
  beat("b5", "Binary search in Python", "code"),
];

test("the boards it picks get a picture, drawn from what it says to show; the rest keep their diagram", async () => {
  const seen: string[] = [];
  const { beats } = await choosePictures(fake({
    boards: [
      { id: "b2", picture: true, why: "an event to see", show: "A street in Sarajevo, 1914, the archduke's open car", parts: ["Franz Ferdinand", "open car"] },
      { id: "b3", picture: true, why: "what the trenches looked like", show: "A muddy front-line trench with soldiers", parts: ["trench", "barbed wire"] },
      { id: "b1", picture: false, why: "a route of causes" },
      { id: "b4", picture: false, why: "a network of alliances is a diagram" },
    ],
    ranking: ["b3", "b2"],
  }, seen), "The causes of World War I", lecture, new Map(lecture.map((b) => [b.id, b.id === "b4" ? "flow" : b.stage])));
  assert.deepEqual(beats.map((b) => b.stage), ["flow", "illustration", "illustration", "flow", "code"]);
  assert.match(beats[1].brief, /Picture: A street in Sarajevo/);
  assert.ok(beats[2].objects.includes("barbed wire"));
  // A code board is never offered: its drawing is the lesson.
  assert.doesNotMatch(seen[0], /Binary search in Python/);
});

test("never more than four pictures, the most needed first", async () => {
  const many = Array.from({ length: 7 }, (_, i) => beat(`b${i + 1}`, `Scene ${i + 1}`, "flow"));
  const { beats } = await choosePictures(fake({
    boards: many.map((b) => ({ id: b.id, picture: true, why: "a scene", show: `scene ${b.id}` })),
    ranking: ["b7", "b6", "b5", "b4", "b3", "b2", "b1"],
  }), "Scenes", many, new Map(many.map((b) => [b.id, b.stage])));
  const pictured = beats.filter((b) => b.stage === "illustration").map((b) => b.id);
  assert.equal(pictured.length, MAX_TYPED_PICTURES);
  assert.deepEqual(pictured.sort(), ["b4", "b5", "b6", "b7"]);
});

test("when the agent fails, the plan is left as the word lists made it", async () => {
  const broken = { chat: { completions: { create: async () => { throw new Error("timeout"); } } } } as unknown as OpenAI;
  const { beats, log } = await choosePictures(broken, "x", lecture, new Map(lecture.map((b) => [b.id, b.stage])));
  assert.deepEqual(beats.map((b) => b.stage), lecture.map((b) => b.stage));
  assert.match(log, /word lists' choice stands/);
});
