import { test } from "node:test";
import assert from "node:assert/strict";
import { cutMp3, speechEndSecs } from "../narrationTail";

const RATE = 24000;
/** A clip from parts: [seconds, frequency in Hz (0 = silence), level]. */
function clip(parts: Array<[number, number, number]>): Float32Array {
  const out: number[] = [];
  for (const [secs, hz, level] of parts) for (let i = 0; i < secs * RATE; i++) out.push(hz ? level * Math.sin((2 * Math.PI * hz * i) / RATE) : 0);
  return new Float32Array(out);
}
const VOICE = 0.15, TEXT = "A sentence of about four seconds when it is read out at her pace by the teacher.".slice(0, 54);

test("a low hum after the sentence is cut off, a moment after her last word", () => {
  const end = speechEndSecs(clip([[4, 600, VOICE], [1, 0, 0], [2.5, 110, 0.03]]), RATE, TEXT);
  assert.ok(end !== null && end > 4 && end < 4.5, String(end));
});

test("a burst much louder than her voice after the sentence is cut off", () => {
  const end = speechEndSecs(clip([[4, 600, VOICE], [0.6, 0, 0], [1.5, 900, 0.9]]), RATE, TEXT);
  assert.ok(end !== null && end > 4 && end < 4.5, String(end));
});

test("a pause in the middle of the sentence is left alone", () => {
  assert.equal(speechEndSecs(clip([[0.6, 600, VOICE], [0.5, 0, 0], [3.4, 600, VOICE], [0.2, 0, 0]]), RATE, TEXT), null);
});

test("more words after a late pause are left alone", () => {
  assert.equal(speechEndSecs(clip([[3.6, 600, VOICE], [0.5, 0, 0], [1.5, 600, VOICE], [0.2, 0, 0]]), RATE, TEXT), null);
});

test("a long silence at the end is shortened, a normal one is kept", () => {
  const long = speechEndSecs(clip([[4, 600, VOICE], [1.6, 0, 0]]), RATE, TEXT);
  assert.ok(long !== null && long < 4.5, String(long));
  assert.equal(speechEndSecs(clip([[4, 600, VOICE], [0.5, 0, 0]]), RATE, TEXT), null);
});

test("an MP3 is cut on a frame boundary", () => {
  // MPEG-2 Layer III, 64 kbit/s, 24 kHz: 192 bytes and 24 ms a frame.
  const frame = new Uint8Array(192);
  frame.set([0xff, 0xf3, 0x84, 0x00]);
  const mp3 = new Uint8Array(100 * 192);
  for (let i = 0; i < 100; i++) mp3.set(frame, i * 192);
  assert.equal(cutMp3(mp3, 1.2).length, 50 * 192);
  assert.equal(cutMp3(mp3, 99).length, mp3.length);
});
