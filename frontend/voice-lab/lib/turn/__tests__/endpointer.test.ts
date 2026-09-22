/**
 * The endpointer's two edges: a start that survives a cough, an end that survives a pause.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { Endpointer, type EndpointEvent } from "../endpointer";
import { silence } from "../signals";

function drive(pattern: string, opts: { hint?: (i: number) => boolean | undefined } = {}) {
  const events: EndpointEvent[] = [];
  const ep = new Endpointer((e) => events.push(e));
  // 'S' = speech frame, '.' = quiet frame, 20 ms each.
  for (let i = 0; i < pattern.length; i++) {
    const hint = opts.hint?.(i);
    if (hint !== undefined) ep.setContinuationHint(hint);
    ep.push(silence(), pattern[i] === "S", i * 20);
  }
  return { events, types: events.map((e) => e.type) };
}

test("a click is a blip: onset then abort, never a start", () => {
  const { types } = drive("S....................");
  assert.deepEqual(types, ["onset", "abort"]);
});

test("sustained speech is confirmed after onsetMs and hands over pre-roll", () => {
  const { events } = drive("S".repeat(20) + ".".repeat(60));
  const start = events.find((e) => e.type === "start");
  assert.ok(start && start.type === "start");
  assert.ok(start.preroll.length > 0, "pre-roll handed over");
  // Nine speech frames (180 ms of speech) confirm it; the ninth arrives at t=160.
  assert.ok(start.at >= 160 && start.at <= 180, `confirmed within the onset window, at ${start.at}`);
});

test("a 400 ms pause inside a sentence is a pause, not an end", () => {
  const { types } = drive("S".repeat(30) + ".".repeat(20) + "S".repeat(30) + ".".repeat(60));
  assert.deepEqual(types, ["onset", "start", "pause", "resume", "pause", "end"]);
});

test("700 ms of quiet ends the utterance; the duration counts speech only", () => {
  const { events } = drive("S".repeat(30) + ".".repeat(60));
  const end = events.find((e) => e.type === "end");
  assert.ok(end && end.type === "end");
  assert.equal(end.reason, "silence");
  assert.equal(end.durationMs, 29 * 20);
  assert.equal(end.at, 29 * 20 + 700);
});

test("an unfinished clause buys a longer pause: 900 ms of quiet after 'because' does not end it", () => {
  const pattern = "S".repeat(30) + ".".repeat(45) + "S".repeat(30) + ".".repeat(80);
  const { types } = drive(pattern, { hint: (i) => (i === 25 ? true : undefined) });
  assert.deepEqual(types, ["onset", "start", "pause", "resume", "pause", "end"], "one utterance, not two");
  const { types: without } = drive(pattern);
  assert.equal(without.filter((t) => t === "end").length, 2, "without the hint the same audio is two utterances");
});

test("speech shorter than minSpeechMs is aborted as too short even after confirmation", () => {
  const { types } = drive("S".repeat(11) + ".".repeat(60));
  assert.deepEqual(types, ["onset", "start", "pause", "abort"]);
});

test("nothing runs forever: maxUtteranceMs ends it", () => {
  const { events } = drive("S".repeat(1100));
  const end = events.find((e) => e.type === "end");
  assert.ok(end && end.type === "end" && end.reason === "max-utterance");
});

test("forceEnd closes a live utterance with reason 'forced'", () => {
  const events: EndpointEvent[] = [];
  const ep = new Endpointer((e) => events.push(e));
  for (let i = 0; i < 30; i++) ep.push(silence(), true, i * 20);
  ep.forceEnd(600, "microphone stalled");
  assert.equal(events[events.length - 1].type, "end");
  assert.equal((events[events.length - 1] as { reason: string }).reason, "forced");
});
