import test from "node:test";
import assert from "node:assert/strict";
import { connectToEarlier } from "../canvas/connect";
import { validateCanvasSpec } from "../canvas/validate";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../canvas/types";

/*
 * BOARDS ARE WRITTEN THREE AT A TIME (owner, 2026-10-22: "the board is finished before the next board is
 * written and then the user has to wait"). A board may be finished before the one it hangs on, so its ties
 * — what carries across, a close-up inside an earlier board — are trusted until that board is written,
 * then checked against it (lib/canvas/connect.ts, lib/progressiveLectureWorker.ts reconnectLaterBoards).
 */
const flow = (nodes: string[]): CanvasBoardSpec => validateCanvasSpec({ heading: "Water cycle", notes: [], stage: { kind: "flow", nodes: nodes.map((id) => ({ id, label: id })), arrows: nodes.slice(1).map((to, i) => ({ from: nodes[i], to })) }, cues: [] }, 4)!;
const beat = (id: string, over: Partial<CanvasPlanBeat> = {}): CanvasPlanBeat => ({ id, title: id, script: "One. Two. Three. Four.", stage: "flow", brief: "", objects: [], inside: null, carry: [], interaction: null, overview: false, ...over });

test("what carries across is trusted until the board before is written, then kept only if that board drew it", () => {
  const plan = [beat("b1"), beat("b2", { carry: ["cloud", "sun"] })];
  const spec = flow(["sea", "cloud", "rain"]);
  assert.equal(connectToEarlier(spec, plan, 1, [undefined, undefined], "s"), true);
  assert.deepEqual(spec.carry, ["cloud"], "only what is on this board: sun is not");
  assert.equal(connectToEarlier(spec, plan, 1, [flow(["sea", "cloud"]), undefined], "s"), false, "the board before drew the cloud: nothing changes");
  assert.equal(connectToEarlier(spec, plan, 1, [flow(["river", "lake"]), undefined], "s"), true, "the board before has no cloud");
  assert.equal(spec.carry, undefined);
});

test("a close-up inside an earlier board keeps its place until that board is written without the object", () => {
  const plan = [beat("b1"), beat("b2"), beat("b3", { inside: { beat: "b1", object: "cloud" } })];
  const spec = flow(["drop", "ice"]);
  connectToEarlier(spec, plan, 2, [undefined, undefined, undefined], "s");
  assert.deepEqual(spec.inside, { beat: "cv-s-b1", id: "cloud" });
  assert.equal(connectToEarlier(spec, plan, 2, [flow(["sea", "cloud"]), undefined, undefined], "s"), false);
  assert.equal(connectToEarlier(spec, plan, 2, [flow(["sea", "rain"]), undefined, undefined], "s"), true);
  assert.equal(spec.inside, undefined);
});
