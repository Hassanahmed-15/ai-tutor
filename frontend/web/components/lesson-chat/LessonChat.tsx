"use client";

import { MessageCircle, Mic, MicOff, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LiveSketch, type DrawScript } from "@/components/sketch/LiveSketch";
import { CodeBoard } from "@/components/sketch/CodeBoard";
import type { CodeSpec } from "@/lib/codeSpec";
import { ReactAnimationSandbox } from "@/components/sketch/ReactAnimationSandbox";
import { playNarration, unlockAudio, type NarrationHandle } from "@/lib/voice";
import { recordJsonCost } from "@/lib/costLedger";
import { asksForVisual, isAffirmative, isNegative } from "@/lib/drawConsent";
import { isCodeQuestion } from "@/lib/codeSpec";
import { captureVoice, isSpeechSupported, type VoiceCaptureHandle } from "@/lib/speech";
import { HudPanel, HudEyebrow } from "@/components/hud/HudKit";
import type { SourceScope } from "@/lib/sourceScope";
import type { BeatSourceGrounding } from "@/lib/sourceGrounding";

/**
 * The shared lesson chat + "Is this clear?" gate. Used by every player so they all behave
 * the same way: after each section the lecture pauses to check understanding, and the
 * student can ask a follow-up question (by typing OR by voice) which Aria answers on a fresh
 * marker-drawn board (/api/explain). The Blind player passes `voiceOnly` so only the mic is
 * shown.
 *
 * The hook owns ALL the chat state and the explain call/narration; it never touches the
 * player's beat loop — it only pauses the player's narration via the `stopVoice` callback.
 */

export interface ChatTurn {
  role: "you" | "aria";
  text: string;
  /**
   * Aria's offer of a drawing, as two buttons under her answer.
   *
   * Kept on the turn rather than in a banner so the log still reads back correctly: the chips stay
   * where they were asked and go quiet once used, the same way the planning chat's quick replies do.
   */
  chips?: { label: string; accept: boolean }[];
  /** Set when the student has answered, so the chips are disabled rather than removed. */
  answered?: boolean;
}

export interface LessonChatState {
  chat: ChatTurn[];
  explaining: boolean;
  explainBoard: { script: string; draw?: DrawScript } | null;
  drawProgress: number;
  /** A board answer is being generated (the "teacher is drawing" wait). */
  drawingBoard: boolean;
  listening: boolean;
  interim: string;
  voiceSupported: boolean;
  /** An offer of a drawing waiting on a yes or no. Exposed so a voice turn can answer it too. */
  pendingVisual: { question: string; what: string } | null;
  /** Answer the open offer. `true` builds the board; `false` leaves the spoken answer as the answer. */
  answerVisualOffer: (accept: boolean) => void;
  ask: (question: string) => void;
  startVoice: () => void;
  stopVoice: () => void;
  /** Stop her spoken answer now, keeping the chat log and any open offer. */
  stopSpeaking: () => void;
  closeExplanation: () => void;
  /** Append a finished conversation turn directly (used by the live voice tutor transcript). */
  appendTurn: (role: "you" | "aria", text: string) => void;
  /** True while either explaining or an explanation board is open — the lecture should hold. */
  busy: boolean;
}

export function useLessonChat(opts: {
  topic: string;
  getBeatContext: () => string;
  /**
   * The whole lesson and the student's document, read at ask time.
   *
   * Functions rather than values because the lecture moves: reading them when the question is asked
   * gives the beat the student is actually on, where a captured value would be whichever beat was
   * playing when the panel first mounted.
   *
   * Optional so every existing caller keeps working — a player that supplies neither asks exactly
   * the question it asked before.
   */
  getLessonContext?: () => string;
  getDocumentContext?: () => string;
  /**
   * Handle for the uploaded document's page images, parked server-side at parse time.
   *
   * A plain string rather than a getter because it does not change while a lecture plays. Empty for
   * a prompted lesson, and empty once the store has expired — the endpoint treats both as "no
   * pictures" and answers from text, so a stale handle costs nothing.
   */
  documentId?: string;
  /** The question the lecture was built to answer, when it was built from one. */
  lessonQuestion?: string;
  /**
   * How tightly answers must stay inside the student's document, and the current beat's own source.
   *
   * WHY. The ask box was the one place a strict lesson could still be answered from general
   * knowledge: it never sent the scope, so the endpoint ran its reference-mode prompt and drew a
   * fresh board from scratch. With these, a strict question is answered only from the document, the
   * endpoint says plainly when the document does not cover it, and the answer board is held to the
   * same source as the lesson's own boards (app/api/explain/route.ts).
   *
   * The beat source is a getter for the same reason the contexts above are: the lecture moves while
   * the panel is open. Both optional — a player that passes neither asks exactly as before.
   */
  sourceScope?: SourceScope;
  getBeatSource?: () => BeatSourceGrounding | null;
  /** Pause the player's own narration when a question starts. */
  pausePlayer: () => void;
  /**
   * A question an EARLIER slide already taught is answered on that slide (lib/revisit.ts): the
   * player shows it again and returns what Aria says over it, or null to answer as usual. Optional —
   * a player without it answers every question in place, as before.
   */
  revisit?: (question: string) => Promise<{ script: string } | null>;
  /** Lets the progressive planner learn from the question without adding separate adaptation UI. */
  onQuestionAsked?: (question: string) => void;
  /** Called when the explanation closes, so the player can re-open its clarity gate. */
  onExplanationClosed?: () => void;
  /** Surface autoplay-blocked so the player can show its banner. */
  onVoiceBlocked?: () => void;
}): LessonChatState {
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [explaining, setExplaining] = useState(false);
  const [explainBoard, setExplainBoard] = useState<{ script: string; draw?: DrawScript } | null>(null);
  const [drawProgress, setDrawProgress] = useState(0);
  const [drawingBoard, setDrawingBoard] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [pendingVisual, setPendingVisual] = useState<{ question: string; what: string } | null>(null);
  /**
   * She is speaking an answer that has no board behind it.
   *
   * A board used to hold the lecture on its own: three of the five players resume as soon as `busy`
   * clears, and `explaining` goes false the moment the fetch returns. Without this, a words-only answer
   * would have the lecture start up again over the top of her while she was still saying it.
   */
  const [narrating, setNarrating] = useState(false);
  const cancelRef = useRef<NarrationHandle | null>(null);
  const voiceRef = useRef<VoiceCaptureHandle | null>(null);
  const voiceSupported = isSpeechSupported();
  /*
   * Read through refs, not state, by the two callbacks that can fire from outside React's own
   * ordering — a spoken answer arriving through a transcript handler, and `ask` deciding whether the
   * message in front of it is a yes to an offer or a new question. A captured value would be whichever
   * offer was open when that callback was last rebuilt.
   */
  const pendingVisualRef = useRef<{ question: string; what: string } | null>(null);
  const answerVisualOfferRef = useRef<(accept: boolean) => void>(() => {});

  const stopNarration = useCallback(() => {
    cancelRef.current?.cancel();
    cancelRef.current = null;
    setNarrating(false);
  }, []);

  /**
   * One POST to /api/explain, with the retry that only covers a request which never arrived.
   *
   * `extra` selects the mode: `{ offer: true }` asks for words and at most a proposal, nothing asks
   * for the board exactly as this panel always did.
   */
  const requestExplain = useCallback(
    async (question: string, extra: Record<string, unknown>) => {
      const request = () => fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: opts.topic,
          beatContext: opts.getBeatContext(),
          lessonContext: opts.getLessonContext?.() ?? "",
          documentContext: opts.getDocumentContext?.() ?? "",
          // Lets the endpoint attach the page images themselves; see app/api/explain/route.ts.
          documentId: opts.documentId ?? "",
          lessonQuestion: opts.lessonQuestion ?? "",
          question,
          // Strict source: the endpoint answers from, and checks against, the document only.
          ...(opts.sourceScope ? { sourceScope: opts.sourceScope } : {}),
          ...(opts.getBeatSource ? { beatSource: opts.getBeatSource() } : {}),
          ...extra,
        }),
      });
      // One retry when the request never reached the server ("Failed to fetch" — a dropped
      // connection, not an answer). Measured: the student saw only that error, and the server
      // logged no request at all. An HTTP error response is NOT retried; it is a real answer.
      const res = await request().catch(async (error: unknown) => {
        if (!(error instanceof TypeError)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return request();
      });
      const data = await res.json().catch(() => ({}));
      recordJsonCost("questions", data);
      if (!res.ok || !data.script) throw new Error(data.error || "Couldn't explain that right now.");
      return data as { script: string; draw?: DrawScript; visual?: { what: string } | null };
    },
    [opts],
  );

  /** Speak an answer. `onDone` runs when she has finished and nothing is waiting on the student. */
  const narrate = useCallback(
    (script: string, onDone?: () => void) => {
      setNarrating(true);
      const handle = playNarration(script, {
        onStart: () => {},
        onSentenceStart: (si, _s, st) => setDrawProgress(st > 1 ? Math.min(1, (si + 1) / st) : 1),
        onEnd: () => {
          cancelRef.current = null;
          setDrawProgress(1);
          setNarrating(false);
          onDone?.();
        },
        onBlocked: () => {
          setNarrating(false);
          opts.onVoiceBlocked?.();
          onDone?.();
        },
        // `pausePlayer` has already frozen the current lecture. Preserve that audio handle while
        // this one-off answer speaks so "continue" can resume at its exact timestamp instead of
        // recreating the beat narration from the beginning.
        preserveActive: true,
      });
      cancelRef.current = handle;
    },
    [opts],
  );

  /** The board answer, exactly as this panel has always produced it. */
  const explainWithBoard = useCallback(
    async (question: string, extra: Record<string, unknown> = {}) => {
      setDrawingBoard(true);
      const data = await requestExplain(question, extra).finally(() => setDrawingBoard(false));
      setChat((c) => [...c, { role: "aria", text: data.script }]);
      setExplainBoard({ script: data.script, draw: data.draw });
      setDrawProgress(0);
      narrate(data.script);
    },
    [narrate, requestExplain],
  );

  const ask = useCallback(
    async (question: string) => {
      const trimmed = question.trim();
      if (!trimmed || explaining) return;

      /*
       * A yes or no while an offer is open answers the offer — it is not a new question. Anything
       * longer is: "yes, but why does it drop?" has to be answered, not treated as consent.
       */
      const open = pendingVisualRef.current;
      if (open && (isAffirmative(trimmed) || isNegative(trimmed))) {
        answerVisualOfferRef.current(isAffirmative(trimmed));
        return;
      }

      unlockAudio();
      opts.pausePlayer();
      opts.onQuestionAsked?.(trimmed);
      stopNarration();
      setChat((c) => [...c, { role: "you", text: trimmed }]);
      setExplaining(true);
      try {
        /*
         * WHO ASKED FOR A PICTURE. An outright request draws at once — asking "shall I draw?" after
         * "draw me a diagram" is a second question in the way. A code question does too, because
         * showing the code when code is asked for was a deliberate earlier fix. Everything else gets
         * words, and an offer only if the model thinks the answer genuinely needs one.
         */
        const documentContext = opts.getDocumentContext?.() ?? "";
        // Taught on an earlier slide: go back to it and answer there, instead of a new board.
        const back = asksForVisual(trimmed) ? null : await opts.revisit?.(trimmed).catch(() => null);
        if (back) {
          setChat((c) => [...c, { role: "aria", text: back.script }]);
          // The old slide stays up until the student says continue: nothing is released on end.
          narrate(back.script);
          return;
        }
        if (asksForVisual(trimmed) || isCodeQuestion(trimmed, documentContext)) {
          await explainWithBoard(trimmed);
          return;
        }
        const data = await requestExplain(trimmed, { offer: true });
        const offered = data.visual?.what ? { question: trimmed, what: data.visual.what } : null;
        setChat((c) => [
          ...c,
          offered
            ? { role: "aria", text: data.script, chips: [{ label: "Yes, draw it", accept: true }, { label: "No, thanks", accept: false }] }
            : { role: "aria", text: data.script },
        ]);
        setPendingVisual(offered);
        // No board, so nothing will be closed later: the answer itself has to release the lecture,
        // unless an offer is waiting on the student.
        narrate(data.script, offered ? undefined : () => opts.onExplanationClosed?.());
      } catch (err) {
        setChat((c) => [...c, { role: "aria", text: err instanceof Error ? err.message : "Something went wrong." }]);
      } finally {
        setExplaining(false);
      }
    },
    [explaining, explainWithBoard, narrate, opts, requestExplain, stopNarration]
  );

  const answerVisualOffer = useCallback(
    async (accept: boolean) => {
      const open = pendingVisualRef.current;
      if (!open) return;
      setPendingVisual(null);
      // The chips stay in the log and go quiet; only one offer is ever open, so this is unambiguous.
      setChat((c) => c.map((t) => (t.chips ? { ...t, answered: true } : t)));
      setChat((c) => [...c, { role: "you", text: accept ? "Yes, draw it" : "No, thanks" }]);
      if (!accept) {
        // Her words were the whole answer. Hand the lecture back.
        opts.onExplanationClosed?.();
        return;
      }
      stopNarration();
      setExplaining(true);
      try {
        await explainWithBoard(open.question, { visualHint: open.what });
      } catch (err) {
        setChat((c) => [...c, { role: "aria", text: err instanceof Error ? err.message : "Couldn't draw that." }]);
        opts.onExplanationClosed?.();
      } finally {
        setExplaining(false);
      }
    },
    [explainWithBoard, opts, stopNarration],
  );
  // Synced after the commit, the way the planning chat mirrors its own pending question: both are
  // read by handlers that fire outside React's ordering, and by then the refs are current.
  useEffect(() => {
    pendingVisualRef.current = pendingVisual;
    answerVisualOfferRef.current = answerVisualOffer;
  }, [pendingVisual, answerVisualOffer]);

  const startVoice = useCallback(() => {
    if (listening) {
      voiceRef.current?.stop();
      return;
    }
    unlockAudio();
    setInterim("");
    setListening(true);
    voiceRef.current = captureVoice({
      onInterim: (t) => setInterim(t),
      onFinal: (text) => {
        setListening(false);
        setInterim("");
        void ask(text);
      },
      onError: () => {
        setListening(false);
        setInterim("");
      },
    });
    if (!voiceRef.current) setListening(false);
  }, [listening, ask]);

  const stopVoiceCapture = useCallback(() => {
    voiceRef.current?.stop();
    setListening(false);
  }, []);

  const closeExplanation = useCallback(() => {
    stopNarration();
    setExplainBoard(null);
    setDrawProgress(0);
    setPendingVisual(null);
    opts.onExplanationClosed?.();
  }, [stopNarration, opts]);

  // Push a completed turn straight into the chat log. The live voice tutor calls this with each
  // finalized transcript line so the conversation shows up in the chat panel, not a separate bar.
  const appendTurn = useCallback((role: "you" | "aria", text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setChat((c) => {
      // Guard against duplicate final lines the realtime API can emit.
      const last = c[c.length - 1];
      if (last && last.role === role && last.text === trimmed) return c;
      return [...c, { role, text: trimmed }];
    });
  }, []);

  return {
    chat,
    explaining,
    explainBoard,
    drawProgress,
    drawingBoard,
    listening,
    interim,
    voiceSupported,
    pendingVisual,
    answerVisualOffer,
    ask,
    startVoice,
    stopVoice: stopVoiceCapture,
    stopSpeaking: stopNarration,
    closeExplanation,
    appendTurn,
    // A words-only answer has no board to hold the lecture, so her voice and an open offer hold it
    // instead: it would be odd for the lecture to start up again underneath either.
    busy: explaining || explainBoard !== null || pendingVisual !== null || narrating,
  };
}

/* ───────────────────────── UI pieces ───────────────────────── */

/** The fresh explanation board overlay (marker draws the answer to the question). */
export function ExplainOverlay({
  board,
  earlier = [],
  progress,
  autoReveal = false,
  onClose,
}: {
  board: { script: string; draw?: DrawScript };
  /** Sections already drawn on this same board (a follow-up continues under them). */
  earlier?: Array<{ script: string; draw?: DrawScript }>;
  progress: number;
  autoReveal?: boolean;
  onClose: () => void;
}) {
  const [automaticProgress, setAutomaticProgress] = useState(0);
  const currentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoReveal) return;
    let frame = 0;
    const startedAt = performance.now();
    const duration = Math.max(12_000, Math.min(24_000, board.draw?.durationMs ?? 18_000));
    const tick = (now: number) => {
      const next = Math.min(1, (now - startedAt) / duration);
      setAutomaticProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [autoReveal, board]);

  // A continued board brings its newest section into view as it starts drawing.
  useEffect(() => {
    if (earlier.length) currentRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [earlier.length, board]);

  const effectiveProgress = autoReveal ? automaticProgress : progress;
  const stacked = earlier.length > 0;

  return (
    <div data-explain-overlay className="hud-materialize absolute inset-0 z-40 flex flex-col bg-black/95 p-3 backdrop-blur-md lg:p-5">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <HudEyebrow>{stacked ? `Board extension · part ${earlier.length + 1}` : "Board extension"}</HudEyebrow>
          <p className="mt-1 text-xs font-semibold text-[var(--hud-text-faint)]">
            {stacked ? "Continued on the same board — scroll up for the earlier part." : "Aria kept the lesson context and added only what this question needs."}
          </p>
        </div>
        <button onClick={onClose} className="hud-btn-ghost rounded-full px-4 py-1.5 text-xs font-bold">
          Return to the lesson board
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {stacked ? (
          <div className="flex h-full flex-col gap-4">
            {earlier.map((section, i) => (
              <div key={`${i}:${section.script.slice(0, 24)}`} className="h-[88%] shrink-0 opacity-80">
                <BoardSection board={section} progress={1} />
              </div>
            ))}
            <div ref={currentRef} className="h-[88%] shrink-0">
              <BoardSection board={board} progress={effectiveProgress} />
            </div>
          </div>
        ) : (
          <BoardSection board={board} progress={effectiveProgress} />
        )}
      </div>
    </div>
  );
}

/** One drawn answer, at a given point in its drawing. */
function BoardSection({ board, progress }: { board: { script: string; draw?: DrawScript }; progress: number }) {
  const animationOp = board.draw?.ops.find(
    (op): op is Extract<typeof op, { kind: "reactAnimation" }> =>
      op.kind === "reactAnimation" && typeof op.code === "string"
  );
  const codeOp = board.draw?.ops.find(
    (op): op is Extract<typeof op, { kind: "codeBoard" }> => op.kind === "codeBoard" && Boolean(op.spec)
  );
  if (codeOp?.spec) return <CodeBoard key={board.script.slice(0, 24)} spec={codeOp.spec as CodeSpec} progress={progress} />;
  if (animationOp?.code) {
    return (
      <ReactAnimationSandbox
        key={board.script.slice(0, 24)}
        code={animationOp.code}
        assetIds={animationOp.assetIds}
        progress={progress}
        sentenceProgress={progress}
      />
    );
  }
  if (board.draw) return <LiveSketch key={board.script.slice(0, 24)} script={board.draw} progress={progress} />;
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <p className="max-w-lg text-lg font-medium text-[var(--hud-text-dim)]">{board.script}</p>
    </div>
  );
}

/**
 * THE WAIT, SAID OUT LOUD ON THE BOARD. A drawing takes several seconds to generate; the board used
 * to sit unchanged with the lecture frozen, which read as "it's stuck".
 */
export function TeacherDrawingNotice() {
  return (
    <div
      data-teacher-drawing
      role="status"
      aria-live="polite"
      className="hud-materialize absolute inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm"
    >
      <div className="flex max-w-sm flex-col items-center px-6 text-center">
        <span className="relative mb-5 grid h-16 w-16 place-items-center rounded-full border border-[var(--hud-cyan)]/40 bg-[var(--hud-cyan)]/10">
          <span className="absolute inset-0 animate-ping rounded-full border border-[var(--hud-cyan)]/30" />
          <svg viewBox="0 0 24 24" className="h-7 w-7 animate-pulse text-[var(--hud-cyan)]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </span>
        <p className="text-lg font-bold text-[var(--hud-text)]">Teacher is drawing for you</p>
        <p className="mt-1.5 text-sm font-medium text-[var(--hud-text-dim)]">Please wait — the board will explain itself as it draws.</p>
      </div>
    </div>
  );
}

/** The side chat panel. `voiceOnly` (Blind) hides the text input and shows only the mic. */
/**
 * Aria's offer of a drawing, as two buttons under her answer.
 *
 * They stay in the log once used and only go quiet, so scrolling back still shows what was asked and
 * what the student chose. Modelled on the planning chat's quick replies.
 */
function OfferChips({
  chips,
  disabled,
  onChoose,
}: {
  chips: { label: string; accept: boolean }[];
  disabled: boolean;
  onChoose: (accept: boolean) => void;
}) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-2">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          disabled={disabled}
          onClick={() => onChoose(chip.accept)}
          className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-default disabled:opacity-40 ${
            chip.accept
              ? "border-[var(--hud-cyan)]/40 bg-[var(--hud-cyan)]/15 text-[var(--hud-text)] enabled:hover:bg-[var(--hud-cyan)]/25"
              : "border-[var(--hud-line)] bg-[var(--hud-surface)] text-[var(--hud-text-dim)] enabled:hover:bg-[var(--hud-surface-2)]"
          }`}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}

export function ChatPanel({
  chat,
  explaining,
  listening,
  interim,
  voiceSupported,
  voiceOnly,
  onAsk,
  onVoice,
  onAnswerOffer,
  liveActive = false,
  liveReady = false,
  liveStatusLabel = "",
  liveMuted = false,
  onLiveMute,
  liveError = null,
  liveAlwaysOn = false,
  compact = false,
  inline = false,
}: {
  chat: ChatTurn[];
  explaining: boolean;
  listening: boolean;
  interim: string;
  voiceSupported: boolean;
  voiceOnly?: boolean;
  onAsk: (q: string) => void;
  onVoice: () => void;
  /** Answer an offered drawing. Absent for a panel whose owner does not use the offer. */
  onAnswerOffer?: (accept: boolean) => void;
  /** True while a live full-duplex tutor session is running (the mic toggles the call). */
  liveActive?: boolean;
  /** The realtime session is preconnected but may be privacy-muted while the lecture plays. */
  liveReady?: boolean;
  /** Status text shown while a live session is active (e.g. "Aria speaking…"). */
  liveStatusLabel?: string;
  /** Live-session mic muted state + toggle (shown only while live). */
  liveMuted?: boolean;
  onLiveMute?: () => void;
  /** Live-session error message (mic denied / connection dropped). */
  liveError?: string | null;
  /** Always-on mode (ADHD): the mic stays open; the button toggles mute instead of ending a call. */
  liveAlwaysOn?: boolean;
  /** Bottom-docked teaching-workspace variant: conversation remains visible without taking a column. */
  compact?: boolean;
  /**
   * INLINE: just the input and Ask, for a host bar that already owns the microphone (BoardDock).
   * Answers open in a small popover above the input, dismissible, instead of a panel's worth of height.
   */
  inline?: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [dismissedAt, setDismissedAt] = useState(-1);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [chat.length, explaining, listening, interim]);

  if (inline) {
    const showThread = (chat.length > 0 && dismissedAt !== chat.length) || listening || explaining || Boolean(liveError);
    return (
      <div className="relative">
        {showThread && (
          <div className="absolute inset-x-0 bottom-[calc(100%+12px)] z-30 max-h-56 overflow-y-auto rounded-xl border border-[var(--hud-line)] bg-[var(--hud-surface)] p-2.5 shadow-[var(--elev-2)] backdrop-blur-xl">
            <button type="button" onClick={() => setDismissedAt(chat.length)} aria-label="Hide the conversation" className="float-right -mr-1 -mt-1 grid size-6 place-items-center rounded-md text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]">×</button>
            {liveError && <p className="mb-1.5 text-xs font-semibold text-[var(--hud-danger)]">{liveError}</p>}
            {chat.slice(-4).map((t, i) => (
              <div key={i} className="mb-1.5 text-[0.8rem] leading-relaxed text-[var(--hud-text-dim)] last:mb-0">
                <span className={`mr-1.5 text-[10px] font-black uppercase tracking-wider ${t.role === "you" ? "text-[var(--hud-cyan)]" : "text-[var(--hud-text-faint)]"}`}>{t.role === "you" ? "You" : "Aria"}</span>
                {t.text}
                {t.chips && onAnswerOffer && <OfferChips chips={t.chips} disabled={t.answered === true} onChoose={onAnswerOffer} />}
              </div>
            ))}
            {listening && <p className="text-[0.8rem] text-[var(--listening)]">Listening… {interim}</p>}
            {explaining && <p className="text-[0.8rem] text-[var(--hud-cyan)]">Aria is answering…</p>}
            <div ref={endRef} />
          </div>
        )}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) {
              onAsk(question);
              setQuestion("");
            }
          }}
        >
          <input
            id="lesson-chat-input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={liveActive ? "Live conversation — just speak…" : "Ask Aria about this part…"}
            disabled={explaining || (liveActive && !liveAlwaysOn)}
            className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--hud-line)] bg-[var(--hud-surface)] px-3.5 text-sm text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)] focus:outline-none disabled:opacity-50"
          />
          <button type="submit" disabled={explaining || (liveActive && !liveAlwaysOn) || !question.trim()} className="hud-btn-primary h-11 shrink-0 rounded-xl px-4 text-sm font-black disabled:opacity-40">
            Ask
          </button>
        </form>
      </div>
    );
  }

  return (
    /*
     * COMPACT is one input line under the source and board. It used to be a titled card with a
     * subtitle and a placeholder sentence — a third of the screen spent saying "ask here" while the
     * PDF it sat under was cut to its header. Messages appear above the input only once there are some.
     */
    <HudPanel className={`flex min-h-0 flex-col overflow-hidden !rounded-[1.5rem] [&>div]:flex [&>div]:h-full [&>div]:min-h-0 [&>div]:flex-col ${compact ? "!rounded-xl" : ""}`}>
      {!compact && (
        <div className="flex items-center gap-2.5 border-b border-[var(--hud-line)] px-5 py-4">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--hud-cyan)]"><MessageCircle size={15} aria-hidden="true" /></span>
          <div>
            <p className="text-sm font-bold text-[var(--hud-text)]">Ask Aria anything</p>
            <p className="text-[11px] leading-tight text-[var(--hud-text-faint)]">
              {voiceOnly ? "Speak — she'll explain aloud." : "Type or speak — she answers in words, and offers a drawing when one would help."}
            </p>
          </div>
        </div>
      )}
      <div className={`min-h-0 overflow-y-auto ${compact ? `${chat.length || listening || explaining ? "flex" : "hidden"} max-h-24 items-center gap-2 space-y-0 px-3 pt-2` : "flex-1 space-y-3 p-4"}`}>
        {chat.length === 0 ? (
          compact ? null : <div className="h-full" aria-hidden="true" />
        ) : (
          (compact ? chat.slice(-3) : chat).map((t, i) => (
            <div
              key={i}
              className={`${compact ? "shrink-0 max-w-[42%] rounded-xl px-3 py-1.5 text-[0.72rem]" : "max-w-[90%] rounded-2xl px-4 py-3 text-sm"} leading-relaxed shadow-sm ${
                t.role === "you"
                  ? "ml-auto rounded-br-md bg-[var(--hud-cyan)]/20 text-[var(--hud-text)]"
                  : "rounded-bl-md border border-[var(--hud-line)] bg-[var(--hud-surface)] text-[var(--hud-text-dim)]"
              }`}
            >
              <span className={`${compact ? "mr-1 inline" : "mb-1 block"} text-[10px] font-black uppercase tracking-wider ${t.role === "you" ? "text-[var(--hud-cyan)]" : "text-[var(--hud-text-faint)]"}`}>
                {t.role === "you" ? "You" : "Aria"}
              </span>
              {t.text}
              {t.chips && onAnswerOffer && (
                <>
                  <p className="mt-2 text-[12px] font-semibold text-[var(--hud-text)]">Want me to draw it?</p>
                  <OfferChips chips={t.chips} disabled={t.answered === true} onChoose={onAnswerOffer} />
                </>
              )}
            </div>
          ))
        )}
        {listening && (
          <div className="flex items-center gap-2 rounded-2xl bg-[var(--listening-dim)] px-4 py-3 text-sm font-medium text-[var(--listening)]">
            <span className="size-2 animate-pulse rounded-full bg-[var(--listening)]" /> Listening… {interim && <span className="text-[var(--hud-text-dim)]">{interim}</span>}
          </div>
        )}
        {explaining && (
          <div className="flex items-center gap-2 rounded-2xl bg-[var(--hud-cyan)]/10 px-4 py-3 text-sm font-medium text-[var(--hud-cyan)]">
            <span className="size-2 animate-pulse rounded-full bg-[var(--hud-cyan)]" /> Drawing an explanation…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className={`mt-auto ${compact ? "p-1.5" : "border-t border-[var(--hud-line)] p-3"}`}>
        {(liveActive || liveReady) && (
          <div className="mb-2 flex items-center justify-between gap-2">
            {liveAlwaysOn ? (
              // Always listening: no call to start or end, only her state and the mute below.
              <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${liveMuted ? "bg-[var(--hud-surface)] text-[var(--hud-text-dim)]" : "bg-[var(--accent-soft)] text-[var(--hud-cyan)]"}`}>
                <span className={`size-2 rounded-full ${liveMuted ? "bg-[var(--hud-line-strong)]" : "animate-pulse bg-[var(--hud-cyan)]"}`} />
                {liveMuted ? "Muted" : liveStatusLabel || "Listening"}
              </div>
            ) : (
              <div className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] ${liveActive ? "bg-[var(--danger-dim)] text-[var(--hud-danger)]" : "bg-[var(--accent-soft)] text-[var(--hud-cyan)]"}`}>
                <span className={`size-2 rounded-full ${liveActive ? "animate-pulse bg-[var(--hud-danger)]" : "bg-[var(--hud-cyan)]"}`} />
                {liveActive ? liveStatusLabel || "Live — costs apply" : "Voice ready · muted"}
              </div>
            )}
            {onLiveMute && (
              <button
                type="button"
                onClick={onLiveMute}
                className="shrink-0 rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] px-3 py-1.5 text-[11px] font-bold text-[var(--hud-text-dim)] transition hover:bg-[var(--hud-surface-2)]"
              >
                <span className="inline-flex items-center gap-1.5">{liveMuted ? <MicOff size={12} aria-hidden="true" /> : <Mic size={12} aria-hidden="true" />}{liveMuted ? "Unmute" : "Mute"}</span>
              </button>
            )}
          </div>
        )}
        {liveError && <p className="mb-2 text-xs font-semibold text-[var(--hud-danger)]">{liveError}</p>}
        {voiceOnly ? (
          <button
            onClick={onVoice}
            disabled={(explaining || !voiceSupported) && !liveActive}
            className={`w-full rounded-full py-3 text-sm font-black transition disabled:opacity-40 ${
              liveActive || listening ? "bg-[var(--hud-danger)] text-[var(--accent-on)]" : "hud-btn-primary"
            }`}
          >
            <span className="inline-flex items-center justify-center gap-2">
              {liveActive || listening ? <Square size={13} fill="currentColor" aria-hidden="true" /> : voiceSupported ? <Mic size={15} aria-hidden="true" /> : null}
              {liveActive
                ? "End live conversation"
                : !voiceSupported
                  ? "Voice not supported here"
                  : listening
                    ? "Stop & ask"
                    : "Talk to Aria live"}
            </span>
          </button>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) {
                onAsk(question);
                setQuestion("");
              }
            }}
          >
            {/* Always listening with a Mute above: the mic button would be a second mute, so it goes. */}
            {voiceSupported && !(liveAlwaysOn && onLiveMute) && (
              <button
                type="button"
                onClick={onVoice}
                disabled={explaining && !liveActive}
                title={
                  liveAlwaysOn
                    ? liveMuted
                      ? "Unmute your mic"
                      : "Mute your mic"
                    : liveActive
                      ? "End live conversation"
                      : liveReady
                        ? "Unmute and talk to Aria"
                        : "Talk live with Aria"
                }
                className={`shrink-0 rounded-full px-3 py-2.5 text-sm font-black transition disabled:opacity-40 ${
                  liveAlwaysOn
                    ? liveMuted
                      ? "bg-[var(--hud-danger)] text-[var(--accent-on)]"
                      : "hud-btn-ghost"
                    : liveActive || listening
                      ? "bg-[var(--hud-danger)] text-[var(--accent-on)]"
                      : "hud-btn-ghost"
                }`}
              >
                {liveAlwaysOn ? (liveMuted ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />) : liveActive ? <Square size={14} fill="currentColor" aria-hidden="true" /> : liveReady && liveMuted ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
              </button>
            )}
            <input
              id="lesson-chat-input"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={
                liveAlwaysOn
                  ? "Speak anytime, or type here…"
                  : liveActive
                    ? "Live conversation — just speak…"
                    : "Ask about this part…"
              }
              disabled={explaining || (liveActive && !liveAlwaysOn)}
              className="min-w-0 flex-1 rounded-full border border-[var(--hud-line-strong)] bg-[var(--hud-surface)] px-4 py-2.5 text-sm text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)] focus:outline-none disabled:opacity-50"
            />
            <button type="submit" disabled={explaining || (liveActive && !liveAlwaysOn) || !question.trim()} className="hud-btn-primary shrink-0 rounded-full px-4 py-2.5 text-sm font-black disabled:opacity-40">
              Ask
            </button>
          </form>
        )}
      </div>
    </HudPanel>
  );
}
