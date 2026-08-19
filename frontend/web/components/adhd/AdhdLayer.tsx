"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Beat } from "@/lib/lessonContent";
import { useAttentionMonitor } from "@/lib/useAttentionMonitor";
import { initialFocus, advanceFocus, hyperfocusMinutes, type FocusTracker } from "@/lib/adhd/focusState";
import { initialScore, applyScore, comboMultiplier, finalScore, SCORE_RULES, type ScoreState } from "@/lib/adhd/score";
import { initialLoot, onBeatForLoot, type LootReward } from "@/lib/adhd/loot";
import { onAdhdEvent, publishAdhdFace, publishAdhdScore, publishAdhdSpeech, resetAdhdScore } from "@/lib/adhd/events";
import { holdFor, lineFor } from "@/lib/adhd/reproach";
import { expressionFor } from "@/lib/adhd/expression";

/**
 * Everything the ADHD track adds, in one overlay.
 *
 * WHY AN OVERLAY AND NOT A SECOND PLAYER. The ADHD track used to render `AdhdLessonPlayer`, a whole
 * separate component. That meant a visually different lesson, two players to keep in step, and —
 * silently — no Gemini Live tutor, because only `LessonPlayer` wires that up. So ADHD now renders the
 * ORDINARY lesson and this layer sits on top of it. `LessonPlayer` gains one optional `adhd` prop;
 * with it absent, not one pixel changes for anybody else.
 *
 * THE CAMERA IS OPTIONAL AND DECLINING IS A FIRST-CLASS PATH. Consent is asked once, before the first
 * beat, and "Not now" is a complete answer: the lecture runs normally, the attention features simply
 * stay off, and nothing nags. A learner should never feel their lesson got worse for saying no.
 *
 * EVERY NEGATIVE SIGNAL GOES THROUGH THE COMPANION, NEVER AT THE LEARNER. "Pip looks sleepy" and
 * "you lost focus" carry identical information and land completely differently. Rejection sensitive
 * dysphoria means perceived failure registers as pain and drives avoidance of whatever caused it,
 * which here would be this app.
 */

type Consent = "unknown" | "granted" | "declined";

/** The neutral tracker shown whenever the camera is off. Built once; it never changes. */
const IDLE_FOCUS = initialFocus();

export function AdhdLayer({
  index,
  beat,
}: {
  index: number;
  beat: Beat | undefined;
}) {
  const [consent, setConsent] = useState<Consent>("unknown");
  const [focus, setFocus] = useState<FocusTracker>(initialFocus);
  const [score, setScore] = useState<ScoreState>(initialScore);
  const [cards, setCards] = useState<{ title: string; at: number }[]>([]);
  const [toast, setToast] = useState<{ text: string; tone: "card" | "loot" } | null>(null);
  const [captured, setCaptured] = useState<string[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [flash, setFlash] = useState<"correct" | "skipped" | "unanswered" | null>(null);

  const cameraOn = consent === "granted";
  const attention = useAttentionMonitor(cameraOn);
  const lastScoredBeat = useRef(-1);
  const focusMinuteRef = useRef(0);
  /**
   * The beat index a skip is about to land on, so the timer does not ALSO pay it as completed.
   *
   * Measured bug: skipping raised the score from 208 to 223. A skip advances `index`, and the timer
   * awards a beat purely on the index going up — so the −25 penalty and a +40×combo completion award
   * both fired, and skipping became the fastest way to earn. The timer cannot tell a skip from a
   * completion by watching `index` alone, so the skip tells it.
   */
  const skippedInto = useRef(-1);
  const focusRef = useRef(initialFocus());
  // Lazily seeded inside the timer: `Date.now()` during render is impure, and the seed is only
  // needed once the first beat completes anyway.
  const lootRef = useRef<ReturnType<typeof initialLoot> | null>(null);
  // Read by the timer so a beat advance is noticed without adding `index` to its dependencies —
  // re-creating the interval on every beat would restart the focus cadence mid-lecture and quietly
  // break the hyperfocus dwell. Synced in an effect rather than assigned during render, which is
  // the accepted shape for a latest-value ref.
  const indexRef = useRef(index);
  const beatRef = useRef(beat);
  const scoreRef = useRef(initialScore());
  // Rotates the line within an escalation tier so the same sentence never repeats back to back.
  const lineSeed = useRef(0);
  useEffect(() => {
    indexRef.current = index;
    beatRef.current = beat;
    scoreRef.current = score;
  });

  /**
   * One timer advances the focus machine AND applies its consequences.
   *
   * Three separate effects watching each other's state was the obvious first shape and the wrong
   * one: each `setState` ran synchronously in an effect body, which cascades renders, and the
   * transition ("began drifting") had to be re-derived from the value on every pass. Doing it in a
   * single tick means the transition is simply `prev.state !== next.state`, which is what it is.
   */
  /**
   * ONE timer drives everything, and it runs whether or not the camera is on.
   *
   * Beat awards and focus tracking both live here for the same reason: `setState` inside a timer
   * callback is fine, whereas calling it synchronously in an effect body cascades renders, and
   * doing it during render is impure. Earlier attempts at both were rejected — correctly.
   *
   * It reads `index` through a ref rather than taking it as a dependency: re-creating the interval
   * on every beat would restart the focus cadence mid-lecture and quietly break the hyperfocus dwell.
   */
  useEffect(() => {
    const TICK = 1000;
    const id = setInterval(() => {
      /* Beat completion — independent of the camera, so this works with consent declined. */
      const i = indexRef.current;
      const b = beatRef.current;
      // `>` and never `!==`: scrubbing BACK must not re-award a beat already paid for. Beat 0 has
      // been started, not completed.
      if (b && i > lastScoredBeat.current) {
        const wasSkippedInto = i === skippedInto.current;
        lastScoredBeat.current = i;
        skippedInto.current = -1;
        // A skipped beat was not completed: no XP, no card, no box. The penalty already landed when
        // the skip was emitted, and paying the completion award on top made skipping profitable.
        if (i > 0 && !wasSkippedInto) {
          lootRef.current ??= initialLoot(Date.now() & 0xffff);
          const { state: nextLoot, reward } = onBeatForLoot(lootRef.current);
          lootRef.current = nextLoot;

          setScore((s) => applyScore(s, { type: "beat-complete" }));
          setCards((c) => [...c, { title: b.title, at: Date.now() }]);
          // A box outranks the card toast when one lands — it is the rarer event.
          setToast(
            reward
              ? { text: describeReward(reward), tone: "loot" }
              : { text: `Concept card — ${b.title}`, tone: "card" },
          );
        }
      }

      /* Attention — only with consent. */
      if (!cameraOn) return;
      const raw = attention.error ? null : attention.engagement;
      const prev = focusRef.current;
      const next = advanceFocus(prev, Number.isFinite(raw) ? raw : null, TICK);
      focusRef.current = next;
      setFocus(next);

      // A drift breaks the combo — and does nothing else. Nothing already earned is taken back.
      if (next.state === "drifting" && prev.state !== "drifting") {
        setScore((s) => applyScore(s, { type: "drift" }));
      }
      // Sustained focus pays coins, once per whole minute of it.
      const mins = hyperfocusMinutes(next);
      if (mins > focusMinuteRef.current) {
        focusMinuteRef.current = mins;
        setScore((s) => applyScore(s, { type: "focus-minute" }));
      }
    }, TICK);
    return () => clearInterval(id);
  }, [cameraOn, attention.error, attention.engagement]);

  /**
   * Skips and quiz verdicts are emitted by the LESSON, which owns those controls, and scored here,
   * which owns the score. `flash` drives the teacher's face for a moment before falling back to the
   * steady state — reacting to what just happened is what makes a face read as responsive.
   */
  useEffect(() => {
    return onAdhdEvent((event) => {
      setScore((sc) => applyScore(sc, event));
      if (event.type === "answer-correct") setFlash("correct");
      if (event.type === "question-unanswered") setFlash("unanswered");
      if (event.type === "beat-skipped") {
        setFlash("skipped");
        // Emitted just BEFORE the lesson advances, so the beat being skipped into is the next one.
        skippedInto.current = indexRef.current + 1;
      }
      if (event.type === "beat-skipped") setToast({ text: `Skipped — −${SCORE_RULES.SKIP_PENALTY} XP`, tone: "card" });
    });
  }, []);

  /**
   * A reaction now HOLDS, and she says why.
   *
   * This was a flat 2200ms for every reaction, so the furious face was gone before it registered.
   * The duration is per-reaction data now (`holdFor`) — praise can be brief, being told off cannot.
   *
   * `scoreRef` rather than `score`: the line escalates with the skip count, but putting `score` in
   * the deps would restart the timer on every coin and cut the reaction short. The ref is synced by
   * the effect declared above this one, so it already holds the post-commit value when this runs.
   */
  useEffect(() => {
    if (!flash) {
      publishAdhdSpeech(null);
      return;
    }
    publishAdhdSpeech(lineFor(flash, scoreRef.current.skipped, lineSeed.current++));
    const id = setTimeout(() => setFlash(null), holdFor(flash));
    return () => clearTimeout(id);
  }, [flash]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3600);
    return () => clearTimeout(id);
  }, [toast]);

  /* ── Capture: one key, the lecture never pauses. ───────────────────────── */
  const capture = useCallback((thought: string) => {
    const text = thought.trim();
    if (!text) return;
    setCaptured((c) => [...c, text]);
    setToast({ text: `Saved — “${text.slice(0, 40)}”`, tone: "card" });
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      // Never steal the key from a real text field — the lesson has an "Ask Aria" box.
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.code !== "Space" || !e.shiftKey) return;
      e.preventDefault();
      setCapturing(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const combo = useMemo(() => comboMultiplier(score), [score]);
  // With no camera there is no signal, so the tracker is shown in its neutral state rather than
  // whatever it happened to hold before consent was withdrawn. Derived, not reset through an effect.
  const shownFocus = cameraOn ? focus : IDLE_FOCUS;
  const locked = shownFocus.state === "hyperfocus";
  const mins = hyperfocusMinutes(shownFocus);
  const face = expressionFor({ focus: shownFocus, streak: score.streak, flash });

  // The header avatar lives in LessonPlayer, above this component, so the face is published rather
  // than passed. Same reasoning as the event bus: the ADHD concern stays inside the ADHD module.
  useEffect(() => { publishAdhdFace(face); }, [face]);
  useEffect(() => {
    publishAdhdScore({
      xp: score.xp, coins: score.coins, combo, streak: score.streak,
      cards: cards.length, locked, lockedMins: mins,
    });
  }, [score, combo, cards.length, locked, mins]);
  /**
   * Send the session's total to the leaderboard — ONCE, when the session ends.
   *
   * This was the gap that made the whole board look broken: the GET was wired, the POST route
   * existed and was tested, and nothing in the app ever called it. So every real learner saw an
   * empty board forever. The browser test missed it because it posted through `page.request.post`,
   * which verifies the endpoint and skips the part that was actually missing — the caller.
   *
   * ONCE is load-bearing. The route ACCUMULATES (`xp: existing.xp + award`, `sessions + 1`), so a
   * post per beat would multiply both. `postedRef` guards the two paths below from double-firing.
   *
   * Two paths because neither covers the other: React cleanup runs on in-app navigation but not when
   * the tab is closed, and `pagehide` covers the close but not a route change. `keepalive` lets the
   * request outlive the page.
   */
  const postedRef = useRef(false);

  useEffect(() => {
    const submit = () => {
      if (postedRef.current) return;
      const total = finalScore(scoreRef.current);
      // Nothing earned means nothing to report — and posting would still bump `sessions`, so an
      // abandoned lecture would dilute the average of anyone looking at sessions-per-point.
      if (total <= 0) return;
      postedRef.current = true;
      void fetch("/api/adhd/leaderboard", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ xp: total }),
        keepalive: true,
      }).catch(() => {
        // A lost leaderboard write must never surface as an error during a lesson.
      });
    };

    window.addEventListener("pagehide", submit);
    return () => {
      window.removeEventListener("pagehide", submit);
      submit();
      publishAdhdFace("neutral");
      publishAdhdSpeech(null);
      resetAdhdScore();
    };
  }, []);

  return (
    <>
      {consent === "unknown" && <ConsentCard onChoose={setConsent} />}

      {/* The score used to live here as an absolutely-positioned overlay and clipped the board frame
          at every viewport. It is now rendered by the lesson header (AdhdScoreChip), where it is part
          of the layout rather than floating over it.
          The companion and the capture affordance stay as overlays but moved to the board's TOP-left:
          the bottom-centre belongs to the quiz panel and the caption bar, and a screenshot showed
          both of them buried behind a "Quick check" card. Top-left is free precisely because the
          score vacated it. */}
      {/*
        One flex row, so the browser does the spacing.
        These were two independently hand-placed absolutes at left-6 and left-[74px] — magic numbers
        tuned against each other, which held only until the "breather?" note appeared and pushed one
        under the other.

        top-[150px] sits BELOW the board's own RendererBadge, which occupies `left-3 top-3` and
        measures to a bottom edge of ~138px. 108px put this row straight through it. ADHD chrome
        must not damage the standard lesson chrome, so this row moves, not the badge.
      */}
      <div className="pointer-events-none absolute left-6 top-[150px] z-30 flex items-center gap-2">
        <FocusNote focus={shownFocus} cameraOn={cameraOn} />

        {/* The affordance has to be visible or nobody discovers the key. */}
        {!capturing && consent !== "unknown" && (
          <button
            onClick={() => setCapturing(true)}
            className="pointer-events-auto rounded-full border border-white/12 bg-black/55 px-3 py-1.5 text-[0.68rem] font-bold text-white/60 backdrop-blur transition hover:text-white/90"
            title="Park a distracting thought without stopping the lecture (Shift+Space)"
          >
            ⇧␣ park a thought{captured.length > 0 ? ` · ${captured.length}` : ""}
          </button>
        )}
      </div>

      {toast && (
        <div
          className={`pointer-events-none absolute bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-xl border px-4 py-2.5 text-[0.8rem] font-bold backdrop-blur beat-fade-in ${
            toast.tone === "loot"
              ? "border-amber-400/40 bg-amber-400/15 text-amber-100"
              : "border-white/15 bg-black/70 text-white/85"
          }`}
        >
          {toast.text}
        </div>
      )}

      {capturing && <CaptureBar onSave={capture} onClose={() => setCapturing(false)} />}
    </>
  );
}

function describeReward(r: LootReward): string {
  switch (r.kind) {
    case "coins": return `Mystery box — ${r.amount} coins`;
    case "card-upgrade": return "Mystery box — a card upgrade";
    case "power-up": return `Mystery box — ${r.id.replace("-", " ")} power-up`;
    case "streak-freeze": return "Mystery box — a streak freeze";
  }
}

/**
 * Asked once, before the first beat.
 *
 * States plainly what is measured and that video never leaves the device, because the honest version
 * of this question is the only one worth asking. "Not now" is a complete answer and is styled as a
 * real choice rather than a greyed-out afterthought.
 */
function ConsentCard({ onChoose }: { onChoose: (c: Consent) => void }) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/72 backdrop-blur-sm">
      <div className="mx-4 max-w-md rounded-2xl border border-white/12 bg-[#0e1119] p-6 shadow-2xl">
        <p className="text-[0.68rem] font-black uppercase tracking-[0.16em] text-teal-300">ADHD mode</p>
        <h2 className="mt-2 text-lg font-bold text-white">Use your camera to notice when focus slips?</h2>
        <p className="mt-3 text-sm leading-relaxed text-white/65">
          A face-tracking model reads head position and blink rate to estimate engagement.
          <strong className="text-white/85"> Everything runs on your device and no video is ever sent
          anywhere</strong> — not to us, not to anyone.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-white/65">
          It lets the lesson notice a drift and change how it explains, and it pauses check-ins while
          you are deep in something.
        </p>
        <div className="mt-5 flex gap-2.5">
          <button
            onClick={() => onChoose("granted")}
            className="flex-1 rounded-lg bg-teal-400 px-4 py-2.5 text-sm font-bold text-teal-950 transition hover:bg-teal-300"
          >
            Use my camera
          </button>
          <button
            onClick={() => onChoose("declined")}
            className="flex-1 rounded-lg border border-white/15 px-4 py-2.5 text-sm font-bold text-white/75 transition hover:bg-white/5"
          >
            Not now
          </button>
        </div>
        <p className="mt-3 text-center text-[0.72rem] text-white/40">
          The lecture works exactly the same either way.
        </p>
      </div>
    </div>
  );
}

/**
 * The focus-state cue — a word, not a face.
 *
 * This used to be `Companion`: a second `TeacherAvatar` at 88px on the board. There is now exactly
 * ONE teacher, rendered large in the sidebar by `LessonPlayer`, because two faces on screen made it
 * ambiguous which one was the teacher and the board copy covered the slide title.
 *
 * What is kept is the part the avatar could not say: a short status word. The rule it was built
 * under still holds — the cue describes the SESSION ("still here", "breather?"), never the learner.
 */
function FocusNote({ focus, cameraOn }: { focus: FocusTracker; cameraOn: boolean }) {
  const note =
    !cameraOn ? ""
    : focus.state === "drifting" ? "still here"
    : focus.state === "crashing" ? "breather?"
    : "";
  if (!note) return null;

  return (
    <span className="rounded-full border border-white/10 bg-black/60 px-2.5 py-1 text-[0.66rem] font-bold text-white/60 backdrop-blur">
      {note}
    </span>
  );
}

/** Type or dictate a thought; the lecture keeps playing behind it. */
function CaptureBar({ onSave, onClose }: { onSave: (t: string) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <div className="absolute bottom-4 left-1/2 z-50 w-[min(520px,90vw)] -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-xl border border-teal-400/30 bg-[#0e1119]/95 px-3 py-2.5 shadow-2xl backdrop-blur">
        <span className="text-[0.66rem] font-black uppercase tracking-wider text-teal-300">park</span>
        <input
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { onSave(text); onClose(); }
            if (e.key === "Escape") onClose();
          }}
          placeholder="reply to Sana about Friday…"
          className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
        />
        <button
          onClick={() => { onSave(text); onClose(); }}
          className="rounded-lg bg-teal-400 px-3 py-1.5 text-[0.72rem] font-bold text-teal-950"
        >
          Save
        </button>
      </div>
      <p className="mt-1.5 text-center text-[0.68rem] text-white/35">The lecture keeps playing.</p>
    </div>
  );
}
