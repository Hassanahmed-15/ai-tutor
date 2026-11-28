import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_MOUNT_WAIT_MS,
  MIN_TEXT_LEAD_MS,
  TEXT_LEAD_MS,
  TEXT_POLL_MS,
  TEXT_WAIT_MAX_MS,
  boardExpectsText,
  leadFromNow,
  leadFirstPieces,
  pieceSentences,
  clearTextStart,
  logSentenceCue,
  logSentenceVoice,
  markTextStart,
  reportBoardText,
  syncVerdict,
  textLeadMs,
  textStartOf,
  voiceWaitMs,
  type SyncRecord,
} from "../canvas/textLead";

test("the lead is TEXT_LEAD_MS at 1x, scaled by speed, never under 100 ms", () => {
  assert.equal(TEXT_LEAD_MS, 200);
  assert.equal(textLeadMs(1), 200);
  assert.equal(textLeadMs(1.5), 133);
  assert.equal(textLeadMs(2), 100);
  assert.equal(textLeadMs(4), MIN_TEXT_LEAD_MS, "floored at the minimum");
  assert.equal(textLeadMs(0.5), 400, "slower playback, a longer lead");
  assert.equal(textLeadMs(0), 200, "a bad speed is treated as 1x");
  assert.equal(textLeadMs(Number.NaN), 200);
  for (const speed of [0.5, 0.75, 1, 1.25, 1.5, 2, 3]) assert.ok(textLeadMs(speed) >= 100);
});

test("ordering rule: her voice waits for the writing, then the lead", () => {
  const base = { cuedAt: 1000, expectsText: true as const, speed: 1 };
  // Writing not started yet: keep waiting (a poll), whatever the clock says, until the cap.
  assert.equal(voiceWaitMs({ ...base, now: 1000, textStart: null }), TEXT_POLL_MS);
  assert.equal(voiceWaitMs({ ...base, now: 3000, textStart: null }), TEXT_POLL_MS);
  // Writing started at 1400: the voice at 1600, not a moment before.
  assert.equal(voiceWaitMs({ ...base, now: 1400, textStart: 1400 }), 200);
  assert.equal(voiceWaitMs({ ...base, now: 1550, textStart: 1400 }), 50);
  assert.equal(voiceWaitMs({ ...base, now: 1600, textStart: 1400 }), 0);
  assert.equal(voiceWaitMs({ ...base, now: 2600, textStart: 1400 }), 0);
  // At 2x the lead is 100 ms.
  assert.equal(voiceWaitMs({ ...base, speed: 2, now: 1400, textStart: 1400 }), 100);
});

test("nothing to write: the lead runs from the cue; an unknown board is waited for briefly", () => {
  assert.equal(voiceWaitMs({ now: 1000, cuedAt: 1000, textStart: null, expectsText: false, speed: 1 }), 200);
  assert.equal(voiceWaitMs({ now: 1250, cuedAt: 1000, textStart: null, expectsText: false, speed: 1 }), 0);
  // The board has not registered yet (it is mounting): waited for, then treated as writing nothing.
  assert.equal(voiceWaitMs({ now: 1100, cuedAt: 1000, textStart: null, expectsText: undefined, speed: 1 }), TEXT_POLL_MS);
  assert.equal(voiceWaitMs({ now: 1000 + BOARD_MOUNT_WAIT_MS, cuedAt: 1000, textStart: null, expectsText: undefined, speed: 1 }), 0);
});

test("writing that never starts does not stop the lecture: given up at the cap", () => {
  assert.equal(voiceWaitMs({ now: 1000 + TEXT_WAIT_MAX_MS - 1, cuedAt: 1000, textStart: null, expectsText: true, speed: 1 }), TEXT_POLL_MS);
  assert.equal(voiceWaitMs({ now: 1000 + TEXT_WAIT_MAX_MS, cuedAt: 1000, textStart: null, expectsText: true, speed: 1 }), 0);
  assert.equal(voiceWaitMs({ now: 1000 + TEXT_WAIT_MAX_MS / 2, cuedAt: 1000, textStart: null, expectsText: true, speed: 2 }), 0, "half as long at 2x");
});

test("simulated narration: whatever the writing's delay, voice starts lead..lead+poll after it, never first", () => {
  for (const speed of [1, 1.5, 2]) {
    // Any delay inside the cap (past it the lecture goes on: the test above).
    for (const textDelay of [0, 16, 90, 350, 1200, 2600].filter((d) => d < TEXT_WAIT_MAX_MS / speed - 50)) {
      const cuedAt = 5000;
      const textAt = cuedAt + textDelay;
      let now = cuedAt;
      // The narration's loop: ask, sleep what it says (in ≤40 ms steps), ask again.
      for (let guard = 0; guard < 10_000; guard++) {
        const w = voiceWaitMs({ now, cuedAt, textStart: now >= textAt ? textAt : null, expectsText: true, speed });
        if (w <= 0) break;
        now += Math.min(w, 40);
      }
      const lead = now - textAt;
      assert.ok(lead >= textLeadMs(speed), `speed ${speed} delay ${textDelay}: voice ${lead} ms after text`);
      assert.ok(lead <= textLeadMs(speed) + 40, `speed ${speed} delay ${textDelay}: voice ${lead} ms after text — too late`);
    }
  }
});

test("verdicts: voice first, in time, too late, no writing", () => {
  assert.equal(syncVerdict(1000, 999), "voice-first");
  assert.equal(syncVerdict(1000, 1200), "ok");
  assert.equal(syncVerdict(1000, 1600), "ok");
  assert.equal(syncVerdict(1000, 1601), "late-voice");
  assert.equal(syncVerdict(null, 1200), "no-text");
});

test("registry: the live board says which sentences write, the first start wins, a replay clears", () => {
  const off = reportBoardText("b1", (s) => s === 0 || s === 2);
  assert.equal(boardExpectsText("b1", 0), true);
  assert.equal(boardExpectsText("b1", 1), false);
  assert.equal(boardExpectsText("b2", 0), undefined, "another board is not live");
  markTextStart("b1", 2, 500);
  markTextStart("b1", 2, 900);
  assert.equal(textStartOf("b1", 2), 500);
  clearTextStart("b1", 2);
  assert.equal(textStartOf("b1", 2), null);
  off();
  assert.equal(boardExpectsText("b1", 0), undefined);
});

test("dev check: the sync logger records every sentence and warns on voice first or a long gap", () => {
  const store = new Map<string, string>([["aria.syncDebug", "1"]]);
  const g = globalThis as unknown as { window?: unknown };
  const had = g.window;
  const fake = { localStorage: { getItem: (k: string) => store.get(k) ?? null } } as unknown as { __textVoiceSync?: SyncRecord[] };
  g.window = fake;
  const warn = console.warn;
  const warned: string[] = [];
  console.warn = (m: string) => warned.push(m);
  try {
    logSentenceCue("bx", 0, 100);
    markTextStart("bx", 0, 150);
    logSentenceVoice("bx", 0, 350, 1);
    logSentenceCue("bx", 1, 1000);
    markTextStart("bx", 1, 1300);
    logSentenceVoice("bx", 1, 1200, 1);
    logSentenceCue("bx", 2, 2000);
    markTextStart("bx", 2, 2000);
    logSentenceVoice("bx", 2, 2900, 1);
    const recs = fake.__textVoiceSync ?? [];
    assert.deepEqual(recs.map((r) => [r.sentence, r.lead, r.verdict]), [[0, 200, "ok"], [1, -100, "voice-first"], [2, 900, "late-voice"]]);
    assert.equal(warned.length, 2);
    assert.match(warned[0], /voice-first/);
    assert.match(warned[1], /late-voice/);
    // Off without the flag.
    store.delete("aria.syncDebug");
    logSentenceCue("by", 0, 1);
    assert.equal((fake.__textVoiceSync ?? []).some((r) => r.key === "by"), false);
  } finally {
    console.warn = warn;
    g.window = had;
  }
});

test("a line shown as it is spoken: her voice waits the lead from the moment it was shown", async () => {
  const wait = leadFromNow(1);
  const first = wait();
  assert.ok(first > 150 && first <= 200, `waits about 200 ms at first (${first})`);
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(wait(), 0);
  assert.ok(leadFromNow(2)() <= 100);
});

test("word-timed pieces: each sentence's first piece moves to its sentence's start, the rest keep their words", () => {
  const units = [{ at: 0 }, { at: 0.4 }, { at: 1.15 }, { at: 1.6 }, { at: 3.05 }, { at: 3.9 }];
  assert.deepEqual(leadFirstPieces(units).map((u) => u.at), [0, 0.4, 1, 1.6, 3, 3.9]);
  assert.deepEqual([...pieceSentences(leadFirstPieces(units))], [0, 1, 3]);
  const moved = leadFirstPieces(units).map((u) => u.at);
  for (let i = 1; i < moved.length; i++) assert.ok(moved[i] >= moved[i - 1], "order kept");
  assert.deepEqual(leadFirstPieces([{ at: Number.POSITIVE_INFINITY }]).map((u) => u.at), [Number.POSITIVE_INFINITY]);
});
