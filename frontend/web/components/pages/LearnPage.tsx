"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { HudCorners, HudEyebrow, HudButton, type PageName } from "@/components/hud/HudKit";
import { LessonPlayer } from "@/components/LessonPlayer";
import { LectureSummarySlide } from "@/components/LectureSummarySlide";
import type { LectureSummary } from "@/lib/lectureSummary";
import { BlindLessonPlayer } from "@/components/BlindLessonPlayer";
import { LessonDesignMode, type DesignProgress } from "@/components/design/LessonDesignMode";
import { applyDiagnostic, conceptMap, emptyProfile, hasEnoughSignal, learnerInstruction, profileSummary, resolveDepth, DEPTH_NAMES, type ConceptMapEntry, type DepthLevel, type LearnerProfile } from "@/lib/learnerProfile";
import { memoryWasUsed, personaForPrompt, profileHasSignal, rememberedLine, seedProfile, snapshotFrom, type LearnerMemory } from "@/lib/learnerModel";
import { PLAN_CHOICES, planMessage, shouldAddVoiceLine } from "@/lib/planningTranscript";
import { openingSentence, topicKeywords } from "@/lib/beatPresentation";
import { warmNarration } from "@/lib/useNarrationPrefetch";
import { splitNarrationSentences } from "@/lib/voice";
import { LearnerMemoryPanel } from "@/components/memory/LearnerMemoryPanel";
import { DEPTH_OPTIONS, depthQuestion, openingQuestion, wantsToStart } from "@/lib/diagnosticPrompt";
import { AdhdLessonPlayer } from "@/components/AdhdLessonPlayer";
import { DyslexiaLessonPlayer } from "@/components/DyslexiaLessonPlayer";
import { TestWrittenView } from "@/components/TestWrittenView";
import { TestOralView } from "@/components/TestOralView";
import { TestResultsView } from "@/components/TestResultsView";
import { type TrackMeta } from "@/components/hud/tracks";
import { useAuth } from "@/components/auth/AuthGate";
import { trackForProfile, isAdhdLearner } from "@/lib/adhd/gate";
import { getSpeechRecognition, type SpeechRecognitionLike } from "@/lib/speech";
import { takePendingBrief } from "@/lib/pendingBrief";
import type { DocumentPage, NormalisedRect, PageSelection } from "@/components/upload/PageSelector";
import { PageStack } from "@/components/upload/PageStack";
import { PageStackSkeleton } from "@/components/upload/PageStackSkeleton";
import { VoicePromptButton } from "@/components/upload/VoicePromptButton";
import { Loader2 } from "lucide-react";
import { isPointingPhrase, subjectFromTranscript } from "@/lib/pdfFocus";
import { lectureSubject } from "@/lib/lectureSubject";
import { buildDocumentContext } from "@/lib/lessonChatContext";
import { useGeminiLiveTutor } from "@/lib/useGeminiLiveTutor";
import { PLANNING_TOOLS, buildPlanningVoiceInstruction } from "@/lib/planningVoiceContract";
import type { Beat } from "@/lib/lessonContent";
import type { LectureMode } from "@/lib/db/cosmos";
import {
  shouldIncludeCodeExamples,
  type LearnerAdaptiveSignal,
  type LearnerProfileSnapshot,
  type ProgressiveLectureSnapshot,
} from "@/lib/progressiveLectureTypes";
import { takePendingLecture } from "@/lib/pendingLecture";
import { DEMO_HARDCODED, demoLectureBeats, demoLectureTopic } from "@/lib/demo/demoLecture";
import type { TestBank, TestGradeResult } from "@/lib/testPrompt";
import { addCost, recordJsonCost, resetCostLedger, setCost } from "@/lib/costLedger";
import { LectureCostBadge } from "@/components/LectureCostBadge";
import { buildLessonInputFromMarkdown, relevantImageKeys, assetKey, type UploadedImage } from "@/lib/markdownSource";
import { isSuprnotesLessonInput, type SuprnotesLessonInput } from "@/lib/suprnotes";
import { mergeSourceDocuments } from "@/lib/mergeSourceDocuments";
import { readStreamedPages } from "@/lib/streamedPages";
import { emptySourceScope, type PdfFidelity, type SourceScope } from "@/lib/sourceScope";
import {
  fallbackDocumentScopeQuestion,
  isSpecificDocumentRequest,
  isWholeDocumentRequest,
  shouldPlanDocumentScope,
  type DocumentPlanningOption,
} from "@/lib/documentLessonPlanning";

/**
 * The "teach me anything" entry. After the user picks a mode, this asks what they want to
 * learn, starts a progressively generated lecture, then mounts the same LessonPlayer used by the
 * curated demo as soon as the opening buffer is ready. Hud-styled chat-style intro.
 */
const SUGGESTIONS = ["How vaccines work", "Why the sky is blue", "How a black hole forms", "Supply and demand", "How memory works"];

type ModeId = TrackMeta["id"];
// An early visual estimate only; the streamed outline itself has no upper subtopic limit. It gives
// the drafting progress bar a denominator, and the visible count can continue beyond it.
const ESTIMATED_SUBTOPICS = 7;
type PlanningAngleId = "standard" | "historical" | "first-principles" | "failure-case" | "analogy";
const PLANNING_ANGLES: { id: PlanningAngleId; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "historical", label: "Historical" },
  { id: "first-principles", label: "First principles" },
  { id: "failure-case", label: "Through a failure" },
  { id: "analogy", label: "Through an analogy" },
];
const DEFAULT_LEARNER_PROFILE: LearnerProfileSnapshot = {
  expertise: "intermediate",
  depth: "balanced",
  goal: "curiosity",
  codeExamples: false,
  preferredExamples: "mixed",
  rationale: "Aria suggested a balanced lesson from the planning conversation.",
  confirmedAt: "",
};
type ScopingQuestion = {
  kind?: "scope" | "emphasis" | "fidelity" | "depth";
  question: string;
  options: DocumentPlanningOption[];
};
type PlanSafetyNet = {
  prerequisite: string;
  diagnostic: string;
  masterySignal: string;
  rescueMove: string;
  reinforceAfter: 1 | 2 | 3;
  reinforcementPrompt: string;
};
type PlanOutline = {
  topic: string;
  subtopics: { title: string; caption: string; reason?: string; confidence?: "low"; safetyNet?: PlanSafetyNet; scopingQuestion?: ScopingQuestion }[];
  angle?: PlanningAngleId;
};
type ClarifyQuestion = { question: string; options: string[] };
type OutlineStreamEvent =
  | { type: "thought"; text?: string }
  | { type: "subtopic"; index?: number; subtopic?: PlanOutline["subtopics"][number] }
  | { type: "scoping-question"; subtopicIndex?: number; question?: string; options?: { label: string; instruction: string }[] }
  | { type: "outline"; topic?: string; subtopics?: PlanOutline["subtopics"]; costUsd?: number }
  | { type: "error"; error?: string };
type LecturePayload = {
  topic: string;
  mood: string;
  sourceType: "prompt" | "pdf" | "pptx" | "suprnotes" | "task-folder";
  mode: LectureMode;
  context?: string;
  diagramHints?: string;
  slideImages?: Array<{ slide: number; descriptions: string[] }>;
  suprnotes?: unknown;
  outline?: PlanOutline;
  /** Read off the rendered pages. Takes precedence over retrieval, which can only search text. */
  transcript?: string;
  /**
   * The student's own question about their upload, sent as itself.
   *
   * It used to be folded into `topic`, which is why asking "explain the formula on page 7" produced
   * a general lecture: the question arrived as a title, with nothing attached to it and nothing
   * telling the model to stay on it. The server pairs this with the matching passage — see
   * lib/pdfFocus.ts.
   */
  focus?: string;
  /**
   * Handle for the page images the parse rendered, so the lecture is written while LOOKING at the
   * document rather than at a text extraction of it.
   *
   * Only the id crosses the wire. The images themselves stay on the server (lib/pageImageStore.ts)
   * because they are several megabytes that the server produced and will consume itself moments
   * later. An id the server no longer recognises is not an error — generation falls back to text.
   */
  documentId?: string;
  /** Whether the lecture must stay strictly inside the uploaded material or may use it as a
   *  springboard — see lib/sourceScope.ts. Absent for a topic with no upload. */
  sourceScope?: SourceScope;
  learnerProfile: LearnerProfileSnapshot;
  /** "What Aria thinks about this student" from earlier lessons — see personaField(). */
  learnerPersona?: string;
};
export function LearnPage({ go, onExit }: { go: (p: PageName) => void; onExit: () => void }) {
  const [topic, setTopic] = useState("");
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<
    "ask" | "outline" | "preview" | "building" | "teaching" | "finished" | "test-offer" | "test-written" | "test-oral" | "test-results" | "error"
  >("ask");
  const [beats, setBeats] = useState<Beat[]>([]);
  const [builtTopic, setBuiltTopic] = useState("");
/**
 * What the post-generation badge is allowed to claim.
 *
 * This was a bare `number | null`, and a bare number cannot tell "this was free" apart from "we did
 * not measure this" — which is exactly how the badge came to announce $0.0000 for a PDF re-upload
 * that had just paid full price to re-parse the document. Reused and demo lectures are their own
 * states now, so neither can borrow a dollar figure that was never true of them.
 */
type BuildCost =
  /** A real generation happened and `usd` is what IT cost — not what the lecture cost. */
  | { kind: "generated"; usd: number }
  /** Served from .lecture-cache. No generation spend this time; the document was still re-read. */
  | { kind: "cached" }
  /** DEMO_HARDCODED short-circuit — no model was called at all. */
  | { kind: "demo" };
  const [buildCost, setBuildCost] = useState<BuildCost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState("Writing the lecture script and boards");
  /**
   * Live generation progress for the design screen.
   *
   * Kept beside `buildStatus` rather than replacing it: the status prose is still what the demo and
   * pre-job phases write ("Choosing the teaching route"), and it is the fallback the design header
   * shows before the first poll returns a stage.
   */
  const [buildProgress, setBuildProgress] = useState<DesignProgress>({
    stage: "analyzing",
    stageFraction: 0,
    detail: null,
    status: "Starting",
    elapsedMs: 0,
  });
  const [buildJobId, setBuildJobId] = useState<string | null>(null);
  /**
   * The built lecture, held back until the student (or Aria's hand-off) starts it.
   *
   * The old flow jumped straight to `teaching` the instant generation finished. That is the abrupt
   * switch the design mode exists to remove: the lesson now reaches "ready", Aria announces it, and
   * the player begins on the hand-off rather than mid-sentence.
   */
  const [builtLesson, setBuiltLesson] = useState<{ beats: Beat[]; topic: string } | null>(null);
  /*
   * THE ONE-SLIDE SUMMARY, unlocked by finishing.
   *
   * Lectures no longer end on a recap beat; the crux of the whole lecture is a slide the student
   * opens when they choose — but only once they have watched the lecture to its end, because it
   * summarizes what they saw. Fetched once per lecture and kept, so reopening it is free.
   */
  const [lectureCompleted, setLectureCompleted] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lectureSummary, setLectureSummary] = useState<LectureSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  /**
   * Mirrors `builtLesson` for the hand-off.
   *
   * The hand-off can be triggered from a timer inside the design screen, which closes over the
   * state it was created with; reading the ref means a click and an announcement racing to start
   * the same lesson cannot start it twice, because clearing the ref is what makes the second one a
   * no-op.
   */
  const builtLessonRef = useRef<{ beats: Beat[]; topic: string } | null>(null);
  const [generationProfile, setGenerationProfile] = useState<LearnerProfileSnapshot>(DEFAULT_LEARNER_PROFILE);
  const generationProfileRef = useRef<LearnerProfileSnapshot>(DEFAULT_LEARNER_PROFILE);
  const [progressiveSessionId, setProgressiveSessionId] = useState<string | null>(null);
  const [progressiveComplete, setProgressiveComplete] = useState(true);
  const [progressivePlannedBeatCount, setProgressivePlannedBeatCount] = useState(0);
  const [progressiveStreamRevision, setProgressiveStreamRevision] = useState(0);
  const lecturePlayheadRef = useRef(-1);

  // Interactive planning: ONE pre-draft gate in the main canvas (ambiguity questions if the
  // topic is genuinely ambiguous, OR topic-specific planning questions if there are real
  // pre-draft decisions worth asking about — never both, see startPlanning). Once resolved (or
  // there's nothing to ask), the outline drafts live and a side chat takes over for mid-build
  // scoping questions + freeform revise.
  const [initialAmbiguityQuestions, setInitialAmbiguityQuestions] = useState<ClarifyQuestion[]>([]);
  const [initialPlanningQuestions, setInitialPlanningQuestions] = useState<ScopingQuestion[]>([]);
  const [planningAnswers, setPlanningAnswers] = useState<Array<{ question: string; label: string; instruction: string; focus?: string | null; fidelity?: PdfFidelity; depthLevel?: DepthLevel }>>([]);
  const [documentPlanningActive, setDocumentPlanningActive] = useState(false);
  const [focusedDocumentPlanningActive, setFocusedDocumentPlanningActive] = useState(false);
  const focusedPlanningFreshRef = useRef<FreshUpload | null>(null);
  /** Free-text notes from the document-scope/emphasis chip answers, carried from
   *  submitPlanningQuestions through the outline+preview screens to the eventual build() call —
   *  see confirmLessonPlan. Cleared whenever a fresh document-scope round starts. */
  const documentPlanningNotesRef = useRef<string[]>([]);
  /**
   * Whether the lesson must stay strictly inside the uploaded material or may use it as a
   * springboard, plus how much of it to cover — asked once alongside the existing document-scope
   * question (see fallbackFidelityQuestion in lib/documentLessonPlanning.ts) and travelling
   * through the outline call and into generation exactly like learnerProfile/depth already do.
   */
  const [sourceScope, setSourceScope] = useState<SourceScope>(emptySourceScope());
  const sourceScopeRef = useRef<SourceScope>(sourceScope);
  useEffect(() => {
    sourceScopeRef.current = sourceScope;
  }, [sourceScope]);
  const [clarifyAnswers, setClarifyAnswers] = useState<{ question: string; answer: string }[]>([]);
  /**
   * The pre-lesson conversation about what the student already knows.
   *
   * Held here rather than on the server because it is per-topic and dies with the planning session:
   * the route is stateless and takes the profile back on each turn (see mode "diagnose"). The
   * profile is what makes the lecture different for different students; `learnerDepth` is the
   * decision computed from it, and both travel on to the outline call and the lecture prompt.
   */
  const [learnerProfile, setLearnerProfile] = useState<LearnerProfile | null>(null);
  const [learnerDepth, setLearnerDepth] = useState<DepthLevel | null>(null);
  const [diagnosticQuestion, setDiagnosticQuestion] = useState<{ question: string; options: string[] } | null>(null);
  /** True while `diagnosticQuestion` IS the depth-preference question — answering it is handled
   *  locally (no model round-trip needed for a fixed set of chip options) rather than through
   *  submitDiagnosticAnswer. See startPlanning, where it is always asked first. */
  const isDepthQuestionRef = useRef(false);
  const [diagnosticExchanges, setDiagnosticExchanges] = useState<{ question: string; answer: string }[]>([]);
  const [diagnosticBusy, setDiagnosticBusy] = useState(false);
  /**
   * "This is what I'm noticing" — an occasional, one-sentence aside from the model, surfaced as
   * its own chat bubble ahead of the next question (if any). Keyed with a counter rather than the
   * text itself, because unlike a question a remark can legitimately repeat similar wording turn
   * to turn ("Good, that confirms it") without that meaning it is stale.
   */
  const [diagnosticRemark, setDiagnosticRemark] = useState<{ text: string; turn: number } | null>(null);
  const diagnosticTurnRef = useRef(0);
  /** Mirrors the profile for callbacks that must not re-subscribe on every answer. */
  const learnerProfileRef = useRef<LearnerProfile | null>(null);
  /**
   * What this learner has been taught before, loaded once per session.
   *
   * The WRITE side of this already existed; without the read it was a diary nobody opened. Held in
   * a ref because it never needs to re-render anything — it exists to be folded into the
   * conversation's opening context so Aria does not re-ask what a previous lesson established.
   */
  const learnedTopicsRef = useRef<{ topic: string; depth: number; mastered: string[]; objective: string }[]>([]);
  const [outline, setOutline] = useState<PlanOutline | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  // Aria's live planning "thoughts" — one line per subtopic, streamed in as the outline call's
  // token stream completes each subtopic's reason field. Cleared whenever a new outline call starts.
  const [planThoughts, setPlanThoughts] = useState<string[]>([]);
  // Scoping questions streamed in per-subtopic, mid-build — a question about subtopic 2 can
  // arrive while subtopic 4 is still drafting (genuine engagement DURING the build, not a
  // batch review pass after the outline finishes). Cleared per new outline call, same as thoughts.
  const [planScopingQuestions, setPlanScopingQuestions] = useState<{ subtopicIndex: number; question: string; options: { label: string; instruction: string }[] }[]>([]);
  const [planAngle, setPlanAngle] = useState<PlanningAngleId>("standard");
  const planAbortRef = useRef<AbortController | null>(null);

  // Post-lecture test mode: one shared question bank feeds both written and oral modes.
  const [testBank, setTestBank] = useState<TestBank | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestGradeResult[] | null>(null);
  const [testAnswers, setTestAnswers] = useState<Record<string, string> | undefined>(undefined);

  // PowerPoint upload state
  const [slideContext, setSlideContext] = useState("");
  const [diagramHints, setDiagramHints] = useState("");
  const [slideImages, setSlideImages] = useState<Array<{ slide: number; descriptions: string[] }>>([]);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; slideCount?: number; kind: "pptx" | "pdf" | "suprnotes" | "task-folder"; assetCount?: number } | null>(null);
  const [sourceDocument, setSourceDocument] = useState<unknown>(null);
  /** What the student asked about their upload, kept verbatim for the generator. */
  const [uploadFocus, setUploadFocus] = useState("");
  /**
   * What was read off the rendered pages — the region they pointed at, or the pages they chose.
   *
   * This is the content text extraction cannot reach: a formula drawn as vector strokes or a figure
   * pasted as an image is not a text object, so it never appears in contentBlocks at all.
   */
  const [ocrTranscript, setOcrTranscript] = useState("");
  /** Pages the student dragged an area on — the lesson is about that area; chat and voice are told so. */
  const [selectionPages, setSelectionPages] = useState<number[]>([]);
  /**
   * Handle for the page images the parse rendered and parked server-side.
   *
   * The images themselves never come here — they are megabytes the server produced and will use
   * itself — so this is the whole of what the client carries between parsing and generation.
   */
  const [documentId, setDocumentId] = useState<string | null>(null);
  /**
   * Every page's text, including pages the student did not select.
   *
   * Separate from `sourceDocument`, which is deliberately scoped to the selection so the LECTURE
   * stays about what they chose. This exists purely so questions asked during the lecture are not
   * confined to it.
   */
  const [fullDocumentText, setFullDocumentText] = useState("");

  /**
   * ARIA, OUT LOUD, FROM PLANNING UNTIL THE LECTURE IS READY.
   *
   * Lives at this level and not inside the outline screen, which is the whole point: that screen
   * unmounts the moment a plan is approved, so a session owned by it fell silent exactly when the
   * student began the several-minute wait it exists to keep them company through. LearnPage spans
   * both screens, so one socket covers the entire arc.
   *
   * The persona is fixed for a socket's life (the hook is explicit that a reconnect is the only
   * honest way to change who is talking), so it is written to cover planning AND building up front
   * rather than being swapped at the transition.
   */
  const voiceOutlineRef = useRef<PlanOutline | null>(null);
  const [voiceLines, setVoiceLines] = useState<{ role: "you" | "aria"; text: string }[]>([]);
  const voiceLinesRef = useRef<{ role: "you" | "aria"; text: string }[]>([]);
  const planningRevisionRef = useRef<string[]>([]);
  const voiceDocContext = buildDocumentContext(sourceDocument, slideContext, ocrTranscript, fullDocumentText, selectionPages);
  /** Aria's own last spoken line, used as the "question" a spoken student answer is graded
   *  against — see onTranscript below. Voice turn-taking is Gemini Live's own, not gated on
   *  diagnosticQuestion the way the text chat is, so there is no other record of what she just
   *  asked out loud. */
  const lastVoiceQuestionRef = useRef<string>("");

  const planningVoice = useGeminiLiveTutor({
    // The uploaded pages, as images: shared the moment the parse produces them, even if she
    // connected first. A scanned PDF has no text for the instruction below to carry.
    documentId: documentId ?? undefined,
    // Aria asks and waits here; a plain answer in the student's voice is a turn. See lib/voice/voiceGate.ts.
    gateProfile: "conversation",
    topic: topic || "this lesson",
    // Read when called, never captured: the outline is revised while the session is open, and a
    // captured value would leave her discussing the draft as it stood when she started speaking.
    getBeatContext: () => {
      const current = voiceOutlineRef.current;
      if (!current?.subtopics.length) return "The plan is still being drafted.";
      return current.subtopics.map((sub, i) => `${i + 1}. ${sub.title} — ${sub.caption}`).join("\n");
    },
    systemInstruction: buildPlanningVoiceInstruction({
      topic: topic || "this lesson",
      documentContext: voiceDocContext,
    }),
    customTools: PLANNING_TOOLS,
    onCustomToolCall: async (name, args) => {
      if (name === "revise_plan") {
        const instruction = typeof args.instruction === "string" ? args.instruction : "";
        if (!instruction.trim()) return "No change was described, so nothing was revised.";
        await reviseOutline(instruction);
        return "The plan was revised and the student can see the new version.";
      }
      if (name === "approve_plan") {
        approveOutline();
        return "The plan is accepted and the lesson is being built now. Tell them in one sentence that you're preparing it.";
      }
      return `Unknown tool: ${name}`;
    },
    onBoardRequest: () => {
      // Planning and building have no board. Declared because the hook requires it; VoiceTutor does
      // the same for the same reason.
    },
    onTranscript: (role, text, final) => {
      if (!final || !text.trim()) return;
      // Remote's ref-backed list (voiceLinesRef) rather than the setState updater: the ref is what
      // the reconnect path reads, so the two must not diverge.
      const line = { role: role === "student" ? "you" as const : "aria" as const, text: text.trim() };
      const next = [...voiceLinesRef.current.slice(-40), line];
      voiceLinesRef.current = next;
      setVoiceLines(next);

      if (role === "tutor") {
        lastVoiceQuestionRef.current = text.trim();
        return;
      }

      /*
       * A SPOKEN ANSWER FEEDS THE SAME SHARED PROFILE, SILENTLY.
       *
       * Voice stays naturally voice-led — Gemini Live keeps driving its own turns exactly as
       * buildPlanningVoiceInstruction already asks it to — but every final student utterance is
       * graded in the background via the same diagnose call the text chat uses, so a question
       * answered by talking counts exactly like one answered by typing. Nothing here tells Aria
       * what to say next; submitDiagnosticAnswer's own addContext call (see its body) is what
       * keeps her from re-asking something this turn just established.
       *
       * Gated on hasEnoughSignal so voice does not keep silently grading once the diagnostic has
       * already concluded — once the lecture is being planned in earnest, an aside spoken during
       * the build is genuine conversation, not one more diagnostic turn to score.
       */
      /*
       * PREVIEW COUNTS TOO.
       *
       * This was gated on `phase === "outline"` alone, but the voice session deliberately spans
       * outline AND preview (see the effect that starts it), so everything a student said on the
       * preview screen was transcribed, stored in voiceLines, and then never graded — the profile
       * simply did not hear it. "Actually I've never done calculus" spoken while looking at the
       * lesson preview is exactly the correction that should reshape the lesson, and it was the
       * one moment the system ignored.
       *
       * `hasEnoughSignal` still stops the grading once the diagnostic has genuinely concluded, so
       * this widens WHERE speech is heard without removing the stop condition.
       */
      const planningPhase = phase === "outline" || phase === "preview";
      /*
       * ONE CONVERSATION: a spoken answer to the question on screen IS the answer to it.
       *
       * It used to be graded silently against whatever Aria had last said out loud, while the text
       * side kept its own question open — two conversations running at once. Now the question on
       * screen is the only question, Aria speaks exactly that question, and whichever way the
       * student answers, it advances the same conversation.
       */
      if (planningPhase && diagnosticQuestionRef.current && !diagnosticBusyRef.current) {
        // Her own reply to this turn is held back by holdUnpromptedReplies (above); the next
        // question is spoken via say() — a short acknowledgement, then exactly what is on screen.
        void runDiagnostic(text.trim());
        return;
      }
      if (planningPhase && !hasEnoughSignal(learnerProfileRef.current ?? emptyProfile(topic))) {
        const question = lastVoiceQuestionRef.current || openingQuestion(topic);
        void submitDiagnosticAnswer(question, text.trim(), "voice");
      }
    },
    /**
     * KEEP THE SOCKET OPEN THROUGH A SILENT WAIT.
     *
     * Without this the hook ends the session after 60 seconds of student silence (IDLE_TIMEOUT_MS)
     * and caps it at five minutes regardless (MAX_SESSION_MS). Both are sensible for a session that
     * exists to answer a question and stop; both are exactly wrong here, where the student is meant
     * to be quiet while a lecture builds for several minutes. She delivered her opening line, the
     * student said nothing, and a minute later the voice was simply off.
     */
    alwaysOn: true,
    // While a question is on screen (or the next one is being chosen), Aria speaks only what she is
    // handed via say(): the question the student can see. See holdUnpromptedReplies in the hook.
    holdUnpromptedReplies: () => Boolean(diagnosticQuestionRef.current) || diagnosticBusyRef.current,
    onSessionEnded: (reason) => {
      // Surfaced rather than swallowed: a dropped socket and a deliberate stop look identical on
      // screen otherwise, which is what made the idle teardown so hard to see.
      if (reason !== "user") console.warn(`[planning-voice] session ended: ${reason}`);
    },
  });

  const voiceStart = planningVoice.start;
  const voiceStop = planningVoice.stop;

  /*
   * THE QUESTION ON SCREEN IS THE QUESTION ARIA ASKS.
   *
   * The diagnose step picks each question (with its quick-answer chips); Aria's voice only speaks
   * it, after a one-sentence acknowledgement of what the student just said. Before, her voice asked
   * questions of its own while a different question sat on screen, so the student faced two
   * conversations and whichever they answered, the other went unanswered.
   */
  const diagnosticQuestionRef = useRef<{ question: string; options: string[] } | null>(null);
  const diagnosticBusyRef = useRef(false);
  const lastStudentAnswerRef = useRef<string>("");
  const spokenQuestionRef = useRef<string>("");
  useEffect(() => {
    diagnosticQuestionRef.current = diagnosticQuestion;
    diagnosticBusyRef.current = diagnosticBusy;
  }, [diagnosticQuestion, diagnosticBusy]);
  const voiceSay = planningVoice.say;
  const voiceLive = planningVoice.status === "live" || planningVoice.status === "drawing";
  useEffect(() => {
    const q = diagnosticQuestion?.question;
    if (!q || !voiceLive || spokenQuestionRef.current === q) return;
    spokenQuestionRef.current = q;
    const answered = lastStudentAnswerRef.current;
    voiceSay(
      (answered
        ? `The student just answered: "${answered.slice(0, 300)}". Acknowledge it in ONE short, natural sentence (do not grade it or teach), then ask exactly this question and nothing else: `
        : "Ask exactly this question, warmly and in your own voice, and nothing else: ") + `"${q}"`,
    );
  }, [diagnosticQuestion, voiceLive, voiceSay]);

  /*
   * WHAT ARIA ALREADY KNOWS ABOUT THIS STUDENT, from earlier lectures (lib/learnerModel.ts).
   * Loaded once; a new topic's conversation starts from the related part of it, so a returning
   * student is not asked again what they showed last time. Signed out, it is simply empty.
   */
  const learnerMemoryLoadRef = useRef<Promise<LearnerMemory | null> | null>(null);
  /** The opening line and first sentence are only worth asking for once per lecture. */
  const warmedOpeningRef = useRef(false);
  const [memoryNote, setMemoryNote] = useState<string | null>(null);
  const [buildBeats, setBuildBeats] = useState<{ beats: NonNullable<ProgressiveLectureSnapshot["beatStatus"]>; startedAt?: string } | null>(null);
  /*
   * One request, shared. Planning AWAITS it rather than reading whatever has arrived: this screen
   * mounts at the moment a topic is submitted and planning starts in the same breath, so a plain
   * "fetch on mount" lost the race every time and the returning student was treated as new.
   */
  function loadLearnerMemory(): Promise<LearnerMemory | null> {
    learnerMemoryLoadRef.current ??= fetch("/api/learner-memory")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const memory = (data?.memory as LearnerMemory | undefined) ?? null;
        learnerMemoryRef.current = memory;
        return memory;
      })
      .catch(() => null);
    return learnerMemoryLoadRef.current;
  }
  /** The memory once it has arrived, for the portrait that every planning and writing step is given. */
  const learnerMemoryRef = useRef<LearnerMemory | null>(null);

  /**
   * "What Aria thinks about this student", for the models that plan the questions, draft the
   * outline, write the script and brief the boards (lib/learnerModel.ts personaForPrompt). One
   * field, spread into each request; empty until memory has loaded, and for a new student.
   */
  function personaField(): { learnerPersona?: string } {
    const block = personaForPrompt(learnerMemoryRef.current);
    return block ? { learnerPersona: block } : {};
  }

  /**
   * Ask Aria to rewrite her portrait when there is something new to say (the server skips the
   * model call otherwise). Best effort, never awaited: the lecture does not depend on it.
   */
  function refreshPersona() {
    void fetch("/api/learner-memory/persona", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: false }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.memory) learnerMemoryRef.current = data.memory as LearnerMemory;
      })
      .catch(() => {});
  }

  /*
   * PLANNING ONLY — exactly one live session exists on this page at any moment.
   *
   * Three screens can each open a Gemini Live socket: this one while planning, LessonDesignMode
   * while the lesson builds, and LessonPlayer once teaching starts. Two of them open at once means
   * two microphones, two Arias talking over each other, and both billing.
   *
   * `building` used to be in this list, which is precisely what produced two voices: the design
   * screen mounts in that phase and opens its own session with its own persona, so this one was
   * still holding a socket while Aria was already talking through the build. The handover is at the
   * phase boundary — planning ends, the design screen takes over, and the player takes over from
   * there.
   */
  useEffect(() => {
    if (phase === "outline" || phase === "preview") {
      void voiceStart();
      return;
    }
    voiceStop();
  }, [phase, voiceStart, voiceStop]);

  /*
   * Stop ONLY on unmount — never because `stop` got a new identity.
   *
   * `useEffect(() => () => voiceStop(), [voiceStop])` looks like an unmount cleanup and is not one:
   * React runs the cleanup whenever the dependency changes, and `stop` is a useCallback over
   * `teardown`, which itself has four callback dependencies. Any of them changing killed a live
   * session mid-conversation for no reason the student could see.
   */
  const voiceStopRef = useRef(voiceStop);
  useEffect(() => {
    voiceStopRef.current = voiceStop;
  }, [voiceStop]);
  useEffect(() => () => voiceStopRef.current(), []);

  /** One object handed to both screens, so the readout cannot drift between them. */
  const voice: VoiceState = {
    status: planningVoice.status,
    speaking: planningVoice.speaking,
    muted: planningVoice.muted,
    errorMessage: planningVoice.errorMessage,
    toggleMute: planningVoice.toggleMute,
    lastLine: voiceLines.length ? voiceLines[voiceLines.length - 1] : null,
  };
  const [uploadPhase, setUploadPhase] = useState<"idle" | "reading" | "choosing" | "ready" | "error">("idle");
  /**
   * Page-selection state. Only ever populated for PDFs/decks; every other upload path skips it
   * entirely. An ARRAY, not a single value, so more than one file can be chosen and previewed
   * together — see ingestFiles. A single-file upload is simply the length-1 case of the same
   * state, so nothing here special-cases "just one file".
   */
  type PendingSource = {
    file: File;
    kind: "pdf" | "pptx";
    pages: DocumentPage[];
    /** Whether THIS file's previews are the real pages or a reconstruction — see pagesFidelity's
     *  old doc comment; now tracked per file since a mixed PDF+deck upload can disagree. */
    fidelity: "rendered" | "approximate";
    /** Reachable via document-pages but with no renderable previews (e.g. no Python renderer on
     *  this server) — the reason is shown instead of a page stack for this file specifically. */
    unavailableReason: string | null;
    /** Chosen pages within THIS file, in the order they were chosen — same shape PageSelection
     *  always had, now one per file instead of shared. */
    selection: PageSelection;
    /** The part of a page the student dragged over, by page number, within THIS file. */
    regions: Record<number, NormalisedRect>;
    /**
     * How many pages this file has, known BEFORE all of them have rendered.
     *
     * The streaming preview route sends the count first, so the page stack can lay out the right
     * number of placeholders immediately instead of growing and reflowing as each image lands.
     */
    pageCount?: number;
  };
  const [pendingSources, setPendingSources] = useState<PendingSource[]>([]);
  const [activeSourceIndex, setActiveSourceIndex] = useState(0);
  const [pagesLoading, setPagesLoading] = useState(false);
  // True while the CHOSEN pages are being parsed — keeps the selection screen up instead of
  // falling back to the capture form.
  const [parsingPages, setParsingPages] = useState(false);
  const activeSource: PendingSource | undefined = pendingSources[activeSourceIndex];
  const pageSelection = activeSource?.selection ?? { pages: [], prompt: "" };
  const pageRegions = activeSource?.regions ?? {};
  /** Selection now lives on the page itself (a click in the scroller), not a separate grid — this
   *  is the one place that mutates a source's selection. Order is preserved, since the order
   *  pages were chosen in is meaningful when assembling an explanation. Always applies to the
   *  ACTIVE tab — see the tab switcher in the "choosing" phase render. */
  const togglePageSelected = useCallback((pageNumber: number) => {
    setPendingSources((current) =>
      current.map((source, index) => {
        if (index !== activeSourceIndex) return source;
        const pages = source.selection.pages.includes(pageNumber)
          ? source.selection.pages.filter((n) => n !== pageNumber)
          : [...source.selection.pages, pageNumber];
        return { ...source, selection: { ...source.selection, pages } };
      }),
    );
  }, [activeSourceIndex]);
  const setPageSelection = useCallback((updater: PageSelection | ((current: PageSelection) => PageSelection)) => {
    setPendingSources((current) =>
      current.map((source, index) => {
        if (index !== activeSourceIndex) return source;
        const next = typeof updater === "function" ? updater(source.selection) : updater;
        return { ...source, selection: next };
      }),
    );
  }, [activeSourceIndex]);
  const setPageRegions = useCallback(
    (updater: Record<number, NormalisedRect> | ((current: Record<number, NormalisedRect>) => Record<number, NormalisedRect>)) => {
      setPendingSources((current) =>
        current.map((source, index) => {
          if (index !== activeSourceIndex) return source;
          const next = typeof updater === "function" ? updater(source.regions) : updater;
          return { ...source, regions: next };
        }),
      );
    },
    [activeSourceIndex],
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Second, separate hidden input for a task-folder pick (webkitdirectory forces the native picker
  // into folder-selection mode, so it must be its own <input> — it can't share fileInputRef, which
  // stays a plain single-file .pptx/.json picker exactly as it works today).
  const folderInputRef = useRef<HTMLInputElement>(null);
  const buildAbortRef = useRef<AbortController | null>(null);
  /** When the current build started, so elapsed time (and the remaining estimate) is real. */
  const buildStartedAtRef = useRef<number | null>(null);


  /**
   * The track comes from the learner's SAVED PROFILE, not from a picker.
   *
   * This was `TRACKS[0]` — hardcoded to Standard — which is why an account with
   * `profile.accessibility === "adhd"` or `"dyslexia"` in Cosmos still got the standard lecture.
   * The value was being written at onboarding and read by nothing.
   *
   * `trackForProfile` is the single place that maps a profile to a track (lib/adhd/gate.ts), so the
   * two vocabularies cannot drift apart. It still supplies the `mood` string handed to lecture
   * generation, so the ADHD track also changes the prompt the pipeline receives — which is intended.
   */
  const { profile } = useAuth();
  const selectedMode = trackForProfile(profile);
  /**
   * What the lesson is being built FROM, for the design tutor's opening line.
   *
   * Derived from the upload that is actually in play rather than stored, so it cannot go stale
   * against `uploadedFile` the way a second piece of state would. "pages" wins over the raw file
   * kind when a selection exists, because "the pages you picked" is the more specific true thing.
   */
  const designSourceKind: "pdf" | "pptx" | "pages" | "topic" =
    pageSelection.pages.length > 0
      ? "pages"
      : uploadedFile?.kind === "pdf"
        ? "pdf"
        : uploadedFile?.kind === "pptx"
          ? "pptx"
          : "topic";

  useEffect(() => {
    if (!progressiveSessionId) return;
    const events = new EventSource(`/api/progressive-lectures/${encodeURIComponent(progressiveSessionId)}/events`);
    const onSnapshot = (event: MessageEvent<string>) => {
      const snapshot = JSON.parse(event.data) as ProgressiveLectureSnapshot;
      // Every planned beat with its measured timings, for the build screen's timeline.
      if (snapshot.beatStatus) setBuildBeats({ beats: snapshot.beatStatus, startedAt: snapshot.createdAt });
      /*
       * THE LECTURE'S FIRST WORDS, SYNTHESISED WHILE THE STUDENT IS STILL WATCHING THE BUILD.
       *
       * The player's own warm-up cannot help here: it only exists once the player is mounted,
       * which is after this screen is gone. So the first beat's opening line and first sentence
       * would always be a cold /api/tts call — seconds of silence at the exact moment the lecture
       * begins. Asked for here, they are a cache hit by the time Start is pressed. Best effort.
       */
      const opening = snapshot.beats?.[0];
      if (opening?.script && !warmedOpeningRef.current) {
        warmedOpeningRef.current = true;
        const bridge = openingSentence(opening.transitionIn, snapshot.topic ?? opening.title);
        void warmNarration(splitNarrationSentences(`${bridge} ${opening.script}`).slice(0, 2));
      }
      // The worker keeps a running total, so each snapshot replaces the last rather than adding.
      if (typeof snapshot.costUsd === "number") setCost("generation", snapshot.costUsd);
      setProgressivePlannedBeatCount(snapshot.plannedBeatCount);
      setBuildStatus(snapshot.complete
        ? "Lecture saved to your history"
        : snapshot.starterReady
          ? `Playing now · ${snapshot.contiguousReadyCount}/${snapshot.plannedBeatCount} beats ready`
          : `Preparing your opening · ${snapshot.contiguousReadyCount}/${snapshot.plannedBeatCount} beats ready`);

      /*
       * THE PROGRESS BAR NOW MOVES ON REAL WORK.
       *
       * `setBuildProgress` was only ever called by the debug/fixture polling loop. On the
       * production path `build()` set it once to {stage:"analyzing", stageFraction:0} and nothing
       * touched it again, so `progressFor("analyzing", 0)` returned 0 and the bar sat pinned at its
       * 2% floor for the entire build while the one honest signal — how many beats are actually
       * finished — was formatted into a sentence and thrown away.
       *
       * Beats completed out of beats planned is the truest progress this pipeline has: each one is
       * a real unit of finished work, written by the worker only after its script AND its premium
       * visual have landed. Mapping it onto the existing stage weights keeps the stage checklist
       * meaningful rather than replacing it with a bare fraction.
       */
      const planned = Math.max(1, snapshot.plannedBeatCount);
      const done = Math.min(snapshot.contiguousReadyCount, planned);
      const fraction = done / planned;
      setBuildProgress((current) => ({
        ...current,
        // The named stage tracks what the worker is really doing: planning until the plan exists,
        // then writing/illustrating beats, then finalising once they are all in.
        stage: snapshot.plannedBeatCount === 0
          ? "analyzing"
          : snapshot.complete
            ? "finalizing"
            : fraction > 0
              ? "visuals"
              : "structuring",
        stageFraction: snapshot.complete ? 1 : fraction,
        detail: snapshot.plannedBeatCount === 0
          ? "Planning the lesson"
          : `${done} of ${planned} sections ready`,
        status: snapshot.complete ? "Finished" : "Building",
        // A real elapsed clock, so estimateRemainingMs can extrapolate honestly instead of
        // dividing by a zero that never changes.
        elapsedMs: buildStartedAtRef.current ? Date.now() - buildStartedAtRef.current : 0,
      }));
      if (snapshot.beats.length > 0) {
        setBeats((current) => {
          const next = [...current];
          snapshot.beats.forEach((beat, index) => {
            // Progressive enrichment keeps the beat id and script stable and replaces only its
            // provisional draw payload. Apply that replacement even to the active beat: narration
            // continues from the same audio clock while the board upgrades to its sandbox version.
            // Adaptive script rewrites cannot reach the active beat because the server freezes
            // played/current plan positions before creating a new revision.
            next[index] = beat;
          });
          return next;
        });
      }
      if (snapshot.starterReady) setPhase((current) => current === "building" ? "teaching" : current);
      if (snapshot.complete) {
        setProgressiveComplete(true);
        setBuildCost({ kind: "generated", usd: snapshot.costUsd });
        events.close();
      } else if (snapshot.status === "failed") {
        setProgressiveComplete(true);
        if (snapshot.beats.length === 0) {
          setError(snapshot.error || "Progressive lecture generation failed.");
          setPhase("error");
        }
        events.close();
      }
    };
    events.addEventListener("snapshot", onSnapshot as EventListener);
    events.addEventListener("stream-error", () => setBuildStatus("Reconnecting to the generation worker"));
    events.onerror = () => setBuildStatus("Reconnecting to the generation worker");
    return () => events.close();
  }, [progressiveSessionId, progressiveStreamRevision]);


  useEffect(() => {
    return () => {
      buildAbortRef.current?.abort();
      planAbortRef.current?.abort();
    };
  }, []);

  /*
   * Load past lessons once. Best-effort: the route returns an empty list when signed out or when no
   * database is configured, so a failure here costs personalisation and never the lesson.
   */
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/learned-topics")
      .then((r) => (r.ok ? r.json() : { topics: [] }))
      .then((d) => {
        if (!cancelled && Array.isArray(d?.topics)) learnedTopicsRef.current = d.topics;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Pick up the brief from the front page and act on it immediately.
   *
   * A typed subject goes straight into planning and a chosen file straight into the parser, so the
   * student never sees this screen ask for what they already provided. Only someone who arrives
   * here directly — via the nav rather than the front page — gets the capture form.
   */
  /*
   * ONCE PER MOUNT, guarded by a ref — not by the handoff being one-shot.
   *
   * React Strict Mode (on by default in `next dev`) runs mount effects twice. The first run
   * consumed the brief and started planning; the second found the handoff empty, read that as
   * "arrived here directly", and sent the student back to the front page — so every typed prompt
   * bounced to landing in development. Refs survive the simulated remount, so this makes the
   * second run a no-op.
   */
  const briefHandledRef = useRef(false);
  useEffect(() => {
    if (briefHandledRef.current) return;
    briefHandledRef.current = true;
    const savedLecture = takePendingLecture();
    if (savedLecture) {
      openSavedLecture(savedLecture);
      return;
    }
    const brief = takePendingBrief();
    // Nothing handed over (a reload, a bookmark, a stray link): the front page is where a lesson
    // starts, so go there rather than show a second copy of it.
    if (!brief || (!brief.file && !brief.topic?.trim())) {
      go("landing");
      return;
    }

    if (brief.file) {
      // Route through the same handler the on-page picker uses, so PDF/PPTX/JSON parsing, page
      // limits and error reporting stay in exactly one place.
      void ingestFiles([brief.file]);
      if (brief.topic) setInput(brief.topic);
      return;
    }
    if (brief.topic) void startPlanning(brief.topic);
    // Runs once on mount (see briefHandledRef above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * A finished upload goes straight to planning.
   *
   * The topic-capture screen used to be where you chose a source, so it had to stay on screen
   * until you pressed a button. The front page now collects both the subject and the file, so
   * stopping here to show the same choices again is a dead step — the student has already said
   * what they want.
   *
   * Watches `uploadPhase` rather than being called from the four places that set "ready" (PDF,
   * PPTX, Suprnotes JSON, task folder), so there is one rule instead of four copies of it. The
   * parsers set a title as they finish, and that title is the topic to plan from.
   */
  const autoPlannedRef = useRef(false);
  useEffect(() => {
    if (uploadPhase !== "ready" || autoPlannedRef.current) return;
    const subject = (topic || input).trim();
    if (!subject) return;
    autoPlannedRef.current = true;
    void startPlanning(subject);
    // startPlanning is stable for this purpose; re-running on its identity would re-fire the jump.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadPhase, topic, input]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    // Reset file input so the same file(s) can be re-selected if needed
    e.target.value = "";
    await ingestFiles(files);
  }

  /** The file pipeline itself, separated from the input event so a file handed over from the
   *  front page goes through exactly the same parsing, limits and error handling. */
  /**
   * Parse the pages the student chose, then continue into planning.
   *
   * Called from the selector's confirm button. An empty selection means the whole document, which
   * is exactly what parse-pdf does when `pages` is absent — so "Use all pages" and the old
   * behaviour are literally the same request.
   *
   * The student's prompt is BOTH the topic and a separate focus field.
   *
   * It used to be only the topic, on the reasoning that a sentence conveys it and threading a
   * second parameter would change several contracts. That reasoning is what produced the bug:
   * "explain the formula on page 7" reached the model as a lecture title, with no passage attached
   * and nothing overriding the instruction to cover the whole document, so it came back as a
   * general lecture on the paper's subject. The topic still drives planning; `focus` is what lets
   * the server find the passage and pin the lecture to it.
   */
  /**
   * `pagesOverride` lets a caller act on pages that haven't made it into `pageSelection` state yet
   * — specifically the per-page "Get a lecture from this area" button, which selects a page and
   * parses it in the same click. Reading `pageSelection.pages` there would race the state update
   * (still the old value on this render), so the override is the source of truth when given.
   */
  async function parseSelectedPages(activeOverride?: number[]) {
    const sources = pendingSources;
    if (!sources.length) return;
    /**
     * Stay on the selection screen while the chosen pages are parsed.
     *
     * Setting uploadPhase to "reading" here fell through to the topic-capture form — so pressing
     * "Use 2 pages" bounced the student back to "Name what you do not understand" for the ~25
     * seconds parsing takes, which reads as being thrown out of the flow rather than progressing
     * through it. `parsing` keeps the page-selection screen mounted and simply shows that work is
     * happening on the button they just pressed.
     */
    setParsingPages(true);
    setUploadError(null);
    try {
      /*
       * MULTIPLE FILES ARE PARSED IN PARALLEL, THEN MERGED. Each file's own /api/parse-pdf or
       * /api/parse-pptx call is independent expensive work — there is no reason the second file
       * should wait on the first — and mergeSourceDocuments() combines the results into the one
       * flat sourceDocument every downstream planning/generation call already expects, tagging
       * each block with which file it came from.
       *
       * `activeOverride` only applies to the ACTIVE source (the "Get a lecture from this area"
       * button acts on one page of one file); every other source parses its own selection as-is.
       */
      const parsed = await Promise.all(
        sources.map(async (source, index) => {
          const chosen = index === activeSourceIndex && activeOverride ? activeOverride : source.selection.pages;
          /*
           * A DRAGGED AREA ON AN UNTICKED PAGE STILL COUNTS. The header button parses the ticked
           * pages; with none ticked it parsed the whole document and silently dropped the area the
           * student had drawn — a general lecture instead of one on their selection. Its page is
           * added, exactly as "Get a lecture from this area" does.
           */
          const regionOnly = Object.keys(source.regions).map(Number).filter((page) => Number.isInteger(page) && page > 0);
          const pages = chosen.length === 0 && regionOnly.length > 0 ? regionOnly : chosen;
          const fd = new FormData();
          fd.append("file", source.file);
          if (pages.length > 0) fd.append("pages", pages.join(","));
          // Only for pages still selected: deselecting a page must not leave its region behind to
          // be read from a page the student has since taken out of the lesson.
          const regions = pages
            .filter((page) => source.regions[page])
            .map((page) => ({ page, rect: source.regions[page] }));
          if (regions.length > 0) fd.append("regions", JSON.stringify(regions));
          // Same request, same fields, different parser — that is what "treated exactly the same" means.
          const res = await fetch(source.kind === "pptx" ? "/api/parse-pptx" : "/api/parse-pdf", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          // Each parsed file bills its own tokens; with several in flight this must be recorded
          // per response rather than once for the batch.
          recordJsonCost("document", data);
          return { source, data, ok: res.ok, drewRegion: regions.length > 0, regionPages: regions.map((region) => region.page) };
        }),
      );

      const failed = parsed.find((p) => !p.ok || (!p.data.sourceDocument && !p.data.fullText));
      if (failed) {
        throw new Error(failed.data.error || (failed.source.kind === "pptx"

          ? "Couldn't read the presentation. Make sure it's a valid .pptx file."
          : "Couldn't read the PDF. Make sure it's a valid .pdf file."));
      }

      const primary = parsed[activeSourceIndex] ?? parsed[0];
      const docsToMerge = parsed
        .filter((p) => isSuprnotesLessonInput(p.data.sourceDocument))
        .map((p) => ({ label: p.source.file.name, doc: p.data.sourceDocument as SuprnotesLessonInput }));
      const mergedSourceDocument = docsToMerge.length > 0 ? mergeSourceDocuments(docsToMerge) : null;

      setUploadedFile({
        name: sources.length > 1 ? `${sources.length} files` : primary.source.file.name,
        slideCount: Array.isArray(primary.data.pagesUsed) ? primary.data.pagesUsed.length : primary.data.pageCount ?? primary.data.slideCount ?? 0,
        kind: primary.source.kind,
        assetCount: parsed.reduce((sum, p) => sum + (p.data.assetCount ?? 0), 0),
      });
      setSourceDocument(mergedSourceDocument);
      // A deck without embedded pictures has no source document; its slide text is the source.
      // Only meaningful for a single deck — multiple files always produce a mergeable sourceDocument.
      if (!mergedSourceDocument && typeof primary.data.fullText === "string") setSlideContext(primary.data.fullText);
      const parsedDocumentId = typeof primary.data.documentId === "string" ? primary.data.documentId : null;
      setDocumentId(parsedDocumentId);
      setFullDocumentText(parsed.map((p) => (typeof p.data.fullDocumentText === "string" ? p.data.fullDocumentText : "")).filter(Boolean).join("\n\n"));

      /**
       * The question, from wherever the student actually asked it.
       *
       * THE BUG THIS FIXES. This read `pageSelection.prompt` alone — the small box on the
       * page-chooser. Someone who typed their question on the LANDING page (the main way in, and
       * the one that says "Teach me anything") sent no focus at all, so `focusPassages` returned
       * null, retrieval was skipped entirely, and the whole-document contract produced a survey of
       * the paper instead of an answer. The question was captured, used as the lecture's TITLE, and
       * then thrown away for the one purpose that mattered.
       *
       * The page-chooser box wins when both exist: it is the more specific of the two, typed with
       * the pages already in view. With more than one file, the ACTIVE tab's prompt wins — that
       * is the file the student was looking at when they typed it.
       */
      const focus = primary.source.selection.prompt.trim() || topic.trim() || input.trim();
      const transcriptText = parsed.map((p) => (typeof p.data.ocrTranscript === "string" ? p.data.ocrTranscript : "")).filter(Boolean).join("\n\n");
      const drewRegion = parsed.some((p) => p.drewRegion);

      /*
       * The lecture's SUBJECT comes from what was read, when the words only point.
       *
       * "Explain me this" is what a student types after drawing a box, and it was being used as the
       * topic — the build screen announced "Designing a live lesson on explain me this…" and the
       * lecture was titled after a pronoun. With no prompt at all the fallback was the FILE'S title,
       * which is how "select a region and press enter" produced a lecture on the whole document.
       * Both are the same mistake: a pointing phrase, and an absence, are not subjects.
       *
       * The typed words are still the question — they go on as `focus` untouched.
       */
      /*
       * A drawn region is called "Selected region", and nothing cleverer.
       *
       * Deriving a name from what was read sounds better than it is: the transcript of a table
       * begins with its markup, so a lecture came out titled `egin{array}{l|l|l|}`. There is no
       * good title hiding in a crop, and inventing one only produces confident nonsense on the
       * screen the student stares at while they wait. What they selected is what it is about.
       *
       * Only when they typed nothing meaningful — the region IS the request. A real question they
       * wrote is always a better title than this.
       */
      const pointing = !focus || isPointingPhrase(focus);
      /*
       * TRY THE TRANSCRIPT BEFORE FALLING BACK TO "Selected region".
       *
       * The region branch used to come first, so a dragged crop was ALWAYS titled "Selected
       * region" — `subjectFromTranscript` was unreachable whenever `drewRegion` was true. On the
       * build screen that is merely vague; in Lecture History it is actively broken, because every
       * lecture built from a crop becomes an identical card and none of them says what it was
       * about.
       *
       * The original reasoning for the literal — that a crop's transcript yields nonsense titles
       * like `egin{array}{l|l|l|}` — was sound when written, but it is `subjectFromTranscript`'s
       * own job to reject that, and it now does: markup, pipe-delimited rows, figure-only lines and
       * heading-less data all fail its candidate test and return "". So the literal stays exactly
       * where it belongs — as the fallback for when there genuinely is no name in the crop.
       */
      /*
       * ...AND THE DOCUMENT'S OWN NAME BEFORE THE LITERAL.
       *
       * The fix above stopped one step short. `primary.data.title` — the PDF's metadata title, or
       * its first heading, or the cleaned-up filename — sat BELOW the literal and was therefore
       * still unreachable whenever a region was drawn, which is the common case: dragging a box and
       * clicking "Get a lecture from this area" requires typing nothing at all. So every crop-built
       * lecture was named "Selected region" regardless, and Lecture History filled with identical
       * cards — the exact failure the comment above describes as actively broken.
       *
       * Naming the document and marking the crop keeps both facts: which file this came from, and
       * that it was part of it rather than the whole thing. The bare literal remains for the case it
       * was written for — a crop from a document with no usable title of its own.
       */
      const subject = lectureSubject({
        transcriptSubject: subjectFromTranscript(transcriptText),
        pointing,
        drewRegion,
        focus,
        topic,
        input,
        documentTitle: primary.data.title ?? "",
      });
      setUploadFocus(focus);
      setOcrTranscript(transcriptText);
      setSelectionPages(drewRegion ? [...new Set(parsed.flatMap((p) => p.regionPages))] : []);
      setPendingSources([]);
      setParsingPages(false);
      setUploadPhase("ready");

      /**
       * Continue with the scope already supplied. A precise question or dragged region builds
       * immediately; a broad multi-section selection gets the short source-specific planning gate.
       * Neither route lets the general outline planner reorder the parser's grounded source plan.
       * autoPlannedRef prevents the upload-watching effect from starting the same transition twice.
       */
      autoPlannedRef.current = true;
      void startPlanning(subject, false, {
        sourceDocument: mergedSourceDocument ?? undefined,
        slideContext: typeof primary.data.fullText === "string" ? primary.data.fullText : undefined,
        focus,
        transcript: transcriptText,
        kind: primary.source.kind,
        scopeSelected: drewRegion,
        documentId: parsedDocumentId,
        regionPages: parsed.flatMap((p) => p.regionPages),
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not read that file.");
      setParsingPages(false);
      setUploadPhase("error");
    }
  }

  /**
   * "Get a lecture from this area" — the button that appears the instant a region is cropped, so
   * building from just that crop does not require scrolling back up to the header's "Use N pages".
   * Marks the page selected (so the header stays truthful about what is about to be sent) and
   * parses immediately, passing the page explicitly rather than waiting a render for `pageSelection`
   * to reflect the toggle.
   */
  function useRegionAsLecture(pageNumber: number) {
    setPageSelection((current) =>
      current.pages.includes(pageNumber) ? current : { ...current, pages: [...current.pages, pageNumber] },
    );
    void parseSelectedPages([pageNumber]);
  }

  async function ingestFiles(files: File[]) {
    if (!files.length) return;
    setUploadPhase("reading");
    setUploadError(null);
    // A new document is a new lecture: its cost starts here, with the reading of it.
    resetCostLedger();
    setSlideContext("");
    setDiagramHints("");
    setSlideImages([]);
    setUploadedFile(null);
    setSourceDocument(null);

    try {
      // A Suprnotes JSON export is a complete, already-built lesson package, not "a document to
      // add to a stack" — if the student picked one (alone or alongside other files), it wins and
      // nothing else in the selection is read. Multi-select only ever composes several PDFs/decks.
      const jsonFile = files.find((f) => f.name.toLowerCase().endsWith(".json") || f.type === "application/json");
      if (jsonFile) {
        const text = await jsonFile.text();
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const lesson = parsed.lesson && typeof parsed.lesson === "object" ? parsed.lesson as Record<string, unknown> : {};
        const title = typeof lesson.title === "string" && lesson.title.trim() ? lesson.title.trim() : jsonFile.name.replace(/\.json$/i, "");
        const assetCount = Array.isArray(parsed.assets) ? parsed.assets.length : 0;
        const blockCount = Array.isArray(parsed.contentBlocks) ? parsed.contentBlocks.length : 0;
        if (!blockCount && !assetCount) {
          throw new Error("That JSON does not look like a Suprnotes lesson export. It needs contentBlocks or assets.");
        }
        setSourceDocument(parsed);
        setUploadedFile({ name: jsonFile.name, kind: "suprnotes", assetCount });
        setSlideContext("");
        setDiagramHints("");
        setSlideImages([]);
        setInput(title);
        setTopic(title);
        setUploadPhase("ready");
        return;
      }

      const docFiles = files.filter((file) => {
        const lower = file.name.toLowerCase();
        return lower.endsWith(".pdf") || file.type === "application/pdf" || lower.endsWith(".pptx") || file.type.includes("presentationml");
      });
      if (docFiles.length > 0) {
        /**
         * A PDF *or a deck* stops here to let the student choose pages, instead of parsing at once.
         *
         * A deck used to skip this screen entirely and parse the whole file, because PowerPoint had
         * no previews to choose from. It has them now (see lib/pptxRender.ts), so the two formats
         * take the same road: pick the pages, point at a part, ask about it.
         *
         * Thumbnails are cheap (~0.3s, a few hundred KB) and the full parse is not — 25s and real
         * money for a 7-page paper, far more for a textbook chapter. Rendering previews first means
         * the expensive pass runs once, over the pages the student actually wants, rather than over
         * everything and then again if they narrow it down.
         *
         * If previews are unavailable — no Python renderer on this server — the selector says so
         * and parsing the whole document remains one click away, which is the old behaviour.
         *
         * MULTIPLE FILES ARE FETCHED IN PARALLEL. Each file's thumbnails are independent work, so
         * there is no reason to make the second file wait on the first — Promise.all runs the
         * requests together and the tab strip (see the "choosing" phase render) shows each file
         * the moment its own previews land, not all-or-nothing.
         */
        setActiveSourceIndex(0);
        setPendingSources(
          docFiles.map((file) => ({
            file,
            kind: file.name.toLowerCase().endsWith(".pptx") || file.type.includes("presentationml") ? "pptx" as const : "pdf" as const,
            pages: [],
            fidelity: "rendered" as const,
            unavailableReason: null,
            selection: { pages: [], prompt: "" },
            regions: {},
          })),
        );
        setPagesLoading(true);
        setUploadPhase("choosing");
        /*
         * PAGES APPEAR AS THEY RENDER, not when the whole upload finishes.
         *
         * This used to await the full JSON body for every file before showing anything, so a
         * twenty-page PDF held a spinner for the entire render AND the 7 MB base64 transfer. The
         * route now streams one NDJSON line per page (`?stream=1`); each line is written straight
         * into that file's `pages` array, so page one is on screen in about a seventh of the time
         * and the rest fill in behind it.
         *
         * A PDF streams; a PPTX still uses the single-response path, because its pages do not
         * exist until LibreOffice has converted the whole deck — there is nothing to stream until
         * then. `readStreamedPages` returns the same shape either way so the code below is shared.
         */
        const results = await Promise.all(
          docFiles.map(async (file, index) => {
            const pageForm = new FormData();
            pageForm.append("file", file);
            const streamable = !(
              file.name.toLowerCase().endsWith(".pptx") || file.type.includes("presentationml")
            );
            const pageRes = await fetch(
              streamable ? "/api/document-pages?stream=1" : "/api/document-pages",
              { method: "POST", body: pageForm },
            );
            if (!streamable || !pageRes.body || !pageRes.ok) {
              const pageData = await pageRes.json().catch(() => ({}));
              return { file, ok: pageRes.ok, data: pageData };
            }
            return readStreamedPages(pageRes, file, (pageNumber, page, pageCount) => {
              // Write each page into the source it belongs to the moment it arrives. Keyed by
              // index rather than identity because `pendingSources` is replaced, not mutated.
              setPendingSources((current) =>
                current.map((source, sourceIndex) => {
                  if (sourceIndex !== index) return source;
                  const pages = source.pages.slice();
                  pages[pageNumber - 1] = page;
                  return { ...source, pages, pageCount: pageCount ?? source.pageCount };
                }),
              );
              // The first page of the first file is the moment the screen stops looking empty.
              setPagesLoading(false);
            });
          }),
        );
        setPagesLoading(false);

        /*
         * A REFUSAL is not a missing preview.
         *
         * A document over the page limit comes back 413 with an explanation of what to do about it.
         * Treating that as "previews are unavailable" would still show the selector, so the student
         * would pick pages from a document that is going to be rejected — and never see the
         * sentence telling them to split it. One refused file fails the whole upload; a partial
         * "3 of 4 files worked" state has no good way to explain itself.
         */
        const failed = results.find((r) => !r.ok);
        if (failed) {
          setPendingSources([]);
          setUploadError(typeof failed.data?.error === "string" ? failed.data.error : "Could not read that file.");
          setUploadPhase("error");
          return;
        }

        setPendingSources((current) =>
          current.map((source, index) => {
            const result = results[index];
            if (result?.data?.kind === "pages" && Array.isArray(result.data.pages)) {
              return {
                ...source,
                pages: result.data.pages,
                fidelity: result.data.fidelity === "approximate" ? "approximate" as const : "rendered" as const,
                unavailableReason: null,
              };
            }
            return { ...source, pages: [], unavailableReason: result?.data?.reason ?? "Page previews are unavailable." };
          }),
        );
        return;
      }

      const [file] = files;
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-pptx", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      recordJsonCost("document", data);
      if (!res.ok || !data.topic) {
        throw new Error(data.error || "Couldn't read the presentation. Make sure it's a valid .pptx file.");
      }
      setUploadedFile({ name: file.name, slideCount: data.slideCount ?? 0, kind: "pptx", assetCount: data.assetCount ?? 0 });
      setSlideContext(data.fullText ?? "");
      setDiagramHints(data.diagramHints ?? "");
      setDocumentId(typeof data.documentId === "string" ? data.documentId : null);
      setFullDocumentText(typeof data.fullDocumentText === "string" ? data.fullDocumentText : "");
      // A deck hides content in pictures for the same reason a paper does, and gets the same
      // reading — this is what was read off its slides.
      setOcrTranscript(typeof data.ocrTranscript === "string" ? data.ocrTranscript : "");
      setSelectionPages([]);
      // A pptx with at least one readable embedded image now gets a real sourceDocument, which
      // routes it through the same grounded pipeline (vision verification, image-only mode,
      // content-block-linked chalkboard boards) task-folder uploads already get — the payload
      // spread in build() below prefers sourceDocument over the flat slideContext when both are
      // set, so this is a strict upgrade, not a behavior change for decks with no images.
      setSourceDocument(data.sourceDocument ?? null);
      // Collect per-slide image descriptions for the "recreate" image prompts
      if (Array.isArray(data.slides)) {
        const imgs = (data.slides as Array<{ index: number; images?: Array<{ description: string }> }>)
          .filter((s) => s.images && s.images.length > 0)
          .map((s) => ({
            slide: s.index,
            descriptions: (s.images ?? []).map((img) => img.description).filter(Boolean),
          }));
        setSlideImages(imgs);
      }
      // Auto-fill the topic from the deck title if the user hasn't typed one
      if (!topic && !input.trim() && data.topic) {
        setInput(data.topic);
      }
      setUploadPhase("ready");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
      setUploadPhase("error");
    }
  }

  function readAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Task-folder upload: the student picks a whole folder (generated_notes.md + yolo_output/ images
   * + relevant_images.json + detected_subject.json). Everything is pulled out and adapted into the
   * same Suprnotes lesson-input shape the .json upload already produces (lib/markdownSource.ts), so
   * it flows through the exact same sourceDocument pipeline — build(), shouldSkipPlanning(), and the
   * server's generate-lecture route treat it identically to a Suprnotes JSON upload.
   */
  async function handleFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    setUploadPhase("reading");
    setUploadError(null);
    // A new document is a new lecture: its cost starts here, with the reading of it.
    resetCostLedger();
    setSlideContext("");
    setDiagramHints("");
    setSlideImages([]);
    setUploadedFile(null);
    setSourceDocument(null);

    const relPath = (f: File): string => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, "/");

    try {
      const mdFile =
        files.find((f) => /(^|\/)generated_notes\.md$/i.test(relPath(f))) ??
        files.find((f) => /\.(md|markdown)$/i.test(f.name));
      if (!mdFile) {
        throw new Error("Couldn't find a generated_notes.md in that folder.");
      }

      const findText = async (re: RegExp): Promise<string | undefined> => {
        const f = files.find((x) => re.test(relPath(x)));
        return f ? await f.text() : undefined;
      };
      const [mdText, relevantImagesText, detectedSubjectText] = await Promise.all([
        mdFile.text(),
        findText(/(^|\/)relevant_images\.json$/i),
        findText(/(^|\/)detected_subject\.json$/i),
      ]);

      // Only base64 the images this lesson actually needs (referenced in the notes or scored in
      // relevant_images.json) — a task folder holds many stray YOLO crops we must not embed.
      const wanted = relevantImageKeys(mdText, relevantImagesText);
      const imageFiles = files.filter((f) => {
        const isImg = f.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|avif)$/i.test(f.name);
        if (!isImg) return false;
        return wanted.size === 0 || wanted.has(assetKey(relPath(f)));
      });
      const images: UploadedImage[] = await Promise.all(
        imageFiles.map(async (f) => ({ path: relPath(f), dataUrl: await readAsDataUrl(f) })),
      );

      const { document, title, blockCount, assetCount, missingRefs } = buildLessonInputFromMarkdown(mdText, images, {
        relevantImagesText,
        detectedSubjectText,
      });
      if (!blockCount && !assetCount) {
        throw new Error("Couldn't read a lesson from that folder — no generated_notes.md sections or images were found.");
      }
      const folderName = relPath(mdFile).split("/")[0] || mdFile.name;
      setSourceDocument(document);
      setUploadedFile({ name: folderName, kind: "task-folder", assetCount });
      setInput(title);
      setTopic(title);
      setUploadPhase("ready");
      if (missingRefs.length) {
        setUploadError(`Heads up: ${missingRefs.length} image${missingRefs.length > 1 ? "s" : ""} referenced in the notes weren't found in the folder — the lesson will build without them.`);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Couldn't read that folder.");
      setUploadPhase("error");
    }
  }

  function clearUpload() {
    setUploadedFile(null);
    setSlideContext("");
    setDiagramHints("");
    setSlideImages([]);
    setSourceDocument(null);
    setUploadPhase("idle");
    setUploadError(null);
  }

  /**
   * The student's request in their own words, kept beside the cleaned subject.
   *
   * The subject names the lesson ("Cryptography"); the request is what they actually asked
   * ("explain me cryptography for my exam", "deletion code in C++"). Titles and Aria's questions use
   * the first; generation still receives the second, so "in C++" or "code" is never lost.
   */
  const requestTextRef = useRef("");

  /**
   * The SUBJECT of a request, not the request itself.
   *
   * The raw prompt was the topic everywhere — so beat titles read "Mw This Particular Eg" and Aria
   * asked "what do you think explain me cryptography is?". One cheap planner call names it (typos
   * fixed, request phrasing dropped, read off the document when the prompt only points at it). On
   * any failure, or after 4 s, the local keyword cleaner stands in: planning is never held up.
   */
  async function nameSubject(raw: string, source: unknown, docId: string | null | undefined): Promise<string> {
    const doc = isSuprnotesLessonInput(source) ? source : null;
    const local = topicKeywords(raw) || raw;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch("/api/plan-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "subject",
          text: raw,
          ...(doc ? { sourceDocument: doc, documentTitle: doc.lesson?.title ?? "" } : {}),
          ...(doc && docId ? { documentId: docId } : {}),
        }),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      recordJsonCost("planning", data);
      return typeof data.subject === "string" && data.subject.trim() ? data.subject.trim() : local;
    } catch {
      return local;
    } finally {
      clearTimeout(timer);
    }
  }

  function resetPlanning() {
    setInitialAmbiguityQuestions([]);
    setInitialPlanningQuestions([]);
    setPlanningAnswers([]);
    setClarifyAnswers([]);
    setOutline(null);
    setPlanError(null);
    setPlanThoughts([]);
    setPlanScopingQuestions([]);
    setPlanAngle("standard");
    setLearnerProfile(null);
    setLearnerDepth(null);
    setDiagnosticQuestion(null);
    setDiagnosticExchanges([]);
    setDiagnosticBusy(false);
    learnerProfileRef.current = null;
    setDocumentPlanningActive(false);
    setFocusedDocumentPlanningActive(false);
    focusedPlanningFreshRef.current = null;
    planningRevisionRef.current = [];
    voiceLinesRef.current = [];
    setVoiceLines([]);
  }

  /**
   * The upload's page images, for the planner. Planning runs on the pages as well as their text —
   * a scanned PDF has no text, so a text-only planner planned it from two figure captions. A ref,
   * set as planning starts, because the fresh parse's id is not in state yet at that moment.
   */
  const planDocumentIdRef = useRef<string | null>(null);
  const withPlanPages = (body: Record<string, unknown>) =>
    body.sourceDocument && !body.documentId && (planDocumentIdRef.current ?? documentId)
      ? { ...body, documentId: planDocumentIdRef.current ?? documentId }
      : body;

  async function callPlanApi(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    planAbortRef.current?.abort();
    const controller = new AbortController();
    planAbortRef.current = controller;
    try {
      const res = await fetch("/api/plan-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(withPlanPages(body)),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      recordJsonCost("planning", data);
      if (!res.ok) throw new Error(data.error || "Planning failed.");
      return data;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
      setPlanError(err instanceof Error ? err.message : "Planning failed.");
      return null;
    }
  }

  /** Streams an outline (mode "outline" or "revise") from /api/plan-lesson as NDJSON, surfacing
   *  each `{type:"thought"}` line into planThoughts live as Aria "reasons" about the outline,
   *  each `{type:"scoping-question"}` into planScopingQuestions the INSTANT that subtopic's own
   *  question completes (mid-build, interleaved with thoughts — not batched at the end), then
   *  applying the final `{type:"outline"}` event. */
  async function streamOutlineRequest(body: Record<string, unknown>, fallbackTopic: string) {
    planAbortRef.current?.abort();
    const controller = new AbortController();
    planAbortRef.current = controller;
    setPlanLoading(true);
    setPlanError(null);
    setPlanThoughts([]);
    setPlanScopingQuestions([]);

    try {
      const res = await fetch("/api/plan-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The portrait goes with every outline request (first draft, revision, re-angle), so the
        // structure itself is planned for this student, not just the wording later.
        body: JSON.stringify({
          ...withPlanPages(body),
          ...personaField(),
          ...(requestTextRef.current ? { request: requestTextRef.current } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Planning failed.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const handle = (event: OutlineStreamEvent) => {
        if (event.type === "error") throw new Error(event.error || "Planning failed.");
        if (event.type === "thought" && event.text) {
          setPlanThoughts((prev) => [...prev, event.text as string]);
        }
        if (event.type === "subtopic" && event.subtopic && typeof event.index === "number") {
          setOutline((prev) => {
            const nextSubtopics = [...(prev?.subtopics ?? [])];
            nextSubtopics[event.index as number] = event.subtopic as PlanOutline["subtopics"][number];
            return {
              topic: prev?.topic || fallbackTopic,
              subtopics: nextSubtopics.filter(Boolean),
              angle: typeof body.angle === "string" ? (body.angle as PlanningAngleId) : prev?.angle,
            };
          });
        }
        if (event.type === "scoping-question" && typeof event.subtopicIndex === "number" && event.question && Array.isArray(event.options)) {
          setPlanScopingQuestions((prev) => [...prev, { subtopicIndex: event.subtopicIndex as number, question: event.question as string, options: event.options as { label: string; instruction: string }[] }]);
        }
        if (event.type === "outline" && typeof event.costUsd === "number") addCost("planning", event.costUsd);
        if (event.type === "outline" && Array.isArray(event.subtopics)) {
          setOutline({
            topic: typeof event.topic === "string" ? event.topic : fallbackTopic,
            subtopics: event.subtopics,
            angle: typeof body.angle === "string" ? (body.angle as PlanningAngleId) : undefined,
          });
        }
      };
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line) handle(JSON.parse(line) as OutlineStreamEvent);
          newlineIndex = buffer.indexOf("\n");
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) handle(JSON.parse(buffer.trim()) as OutlineStreamEvent);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setPlanError(err instanceof Error ? err.message : "Planning failed.");
    } finally {
      setPlanLoading(false);
    }
  }

  async function requestOutline(t: string, clarifications: { question: string; answer: string }[], angle: PlanningAngleId = "standard") {
    setPhase("outline");
    setPlanAngle(angle);
    /*
     * The profile travels with the outline request, not just with the lecture.
     *
     * Adjusting depth after the structure is fixed cannot undo an outline whose first three
     * subtopics define terms this student already demonstrated — the subtopic list has to be
     * planned for them. Null when the conversation was skipped, and the route treats its absence
     * as "plan as before".
     */
    await streamOutlineRequest({
      mode: "outline",
      topic: t,
      clarifications,
      angle,
      sourceDocument,
      ...(learnerProfileRef.current ? { learnerProfile: learnerProfileRef.current } : {}),
      ...(learnerDepth ? { depth: learnerDepth } : {}),
      // Absent (fidelity stays at its "reference" default) for a topic with no upload — the
      // server treats a missing/no-op scope exactly like today's unlabeled behavior.
      ...(sourceDocument ? { sourceScope: sourceScopeRef.current } : {}),
    }, t);
  }

  /** "Teach it differently" — rerolls the entire outline through a different pedagogical angle
   *  instead of the default structure, so the same topic can produce a genuinely different lesson. */
  function rerollAngle(angle: PlanningAngleId) {
    setPlanAngle(angle);
    planningRevisionRef.current = [...planningRevisionRef.current.slice(-19), `Selected teaching angle: ${angle}.`];
    if (focusedDocumentPlanningActive) {
      const fresh = focusedPlanningFreshRef.current;
      streamOutlineRequest({
        mode: "document-question",
        topic,
        question: fresh?.focus ?? uploadFocus,
        transcript: fresh?.transcript ?? ocrTranscript,
        angle,
        sourceDocument: fresh?.sourceDocument ?? sourceDocument,
      }, topic);
      return;
    }
    streamOutlineRequest({ mode: "outline", topic, clarifications: clarifyAnswers, angle, sourceDocument }, topic);
  }

  // Structured uploads already carry an explicit source-grounded lesson plan. PDF/PPT uploads may
  // pause for scope choices before reaching this check, but their source plan is never rewritten.
  function shouldSkipPlanning(): boolean {
    const structuredUpload =
      uploadedFile?.kind === "suprnotes" ||
      uploadedFile?.kind === "task-folder" ||
      uploadedFile?.kind === "pdf" ||
      uploadedFile?.kind === "pptx";
    return structuredUpload || Boolean(slideContext && !sourceDocument) || (DEMO_HARDCODED && !sourceDocument && !slideContext);
  }

  // Ask BEFORE drafting, but only ONE thing, only when genuinely warranted — never both at once:
  // (a) disambiguation if the topic is genuinely ambiguous (rare), or (b) 2-3 topic-specific
  // planning questions if there are real pre-draft decisions worth surfacing (also not every
  // topic gets these). Anything else skips straight to live drafting with NO gate at all — this
  // is the actual fix: previously a clear, non-ambiguous topic fell through to nothing, and the
  // only way to ever start a draft was through a generic hardcoded steering panel that showed
  // for every topic regardless of relevance. Both question types now render as ONE panel in the
  // main canvas (see the outline screen's `!outline` branch), never the side chat — the side
  // chat is reserved for what happens DURING/AFTER drafting starts (live reasoning, mid-build
  // scoping questions, freeform revise).
  /**
   * @param forceBuild Skip the outline step regardless of what state has flushed yet.
   *
   * shouldSkipPlanning() reads `uploadedFile`, which is set in the same tick as `uploadPhase`.
   * A caller that has just parsed a document already knows its source and scope before React has
   * committed state. `fresh` carries those values into either document planning or generation.
   */
  async function startPlanning(t: string, forceBuild = false, fresh?: FreshUpload) {
    const raw = t.trim();
    if (!raw) return;
    setInput("");
    setError(null);
    resetPlanning();
    if (fresh?.documentId) planDocumentIdRef.current = fresh.documentId;
    requestTextRef.current = raw;
    // Shown at once from the local cleaner, then replaced by the named subject a moment later.
    setTopic(topicKeywords(raw) || raw);
    const trimmed = await nameSubject(raw, fresh?.sourceDocument ?? sourceDocument, fresh?.documentId ?? documentId);
    setTopic(trimmed);

    const planningDocument = fresh?.sourceDocument ?? sourceDocument;
    const planningFocus = fresh?.focus ?? uploadFocus;
    const planningKind = fresh?.kind ?? uploadedFile?.kind;
    const isPdfOrDeck = (planningKind === "pdf" || planningKind === "pptx") && Boolean(planningDocument);

    const shouldPlanExactQuestion = isPdfOrDeck
      && !isWholeDocumentRequest(planningFocus)
      && (Boolean(fresh?.scopeSelected) || isSpecificDocumentRequest(planningFocus, planningDocument));

    if (!forceBuild && shouldPlanExactQuestion) {
      setFocusedDocumentPlanningActive(true);
      focusedPlanningFreshRef.current = {
        ...fresh,
        sourceDocument: planningDocument ?? undefined,
        focus: planningFocus,
        kind: planningKind,
      };
      setPhase("outline");
      await streamOutlineRequest({
        mode: "document-question",
        topic: trimmed,
        question: planningFocus,
        transcript: fresh?.transcript ?? ocrTranscript,
        sourceDocument: planningDocument,
      }, trimmed);
      return;
    }

    if (!forceBuild && isPdfOrDeck && !fresh?.scopeSelected && shouldPlanDocumentScope(planningDocument, planningFocus)) {
      setDocumentPlanningActive(true);
      setPhase("outline");
      setPlanLoading(true);
      const data = await callPlanApi({ mode: "document-scope", topic: trimmed, sourceDocument: planningDocument });
      setPlanLoading(false);
      const questions = data && Array.isArray(data.planningQuestions)
        ? data.planningQuestions as ScopingQuestion[]
        : [];
      const fallback = fallbackDocumentScopeQuestion(planningDocument);
      if (!questions.length && fallback) setPlanError(null);
      setInitialPlanningQuestions(questions.length ? questions : fallback ? [fallback] : []);
      if (questions.length || fallback) return;
      build(trimmed, undefined, fresh);
      return;
    }

    /**
     * A WHOLE-DOCUMENT UPLOAD GETS THE PLANNING SCREEN TOO.
     *
     * It used to fall straight through to build(), so selecting pages and asking nothing produced a
     * silent wait behind a fixed status line — while typing a topic got Aria drafting an outline
     * section by section in a chat you could steer. Same product, two completely different levels of
     * involvement, decided by whether the material arrived as a file or as a sentence.
     *
     * `mode: "outline"` already grounds itself in the uploaded document (see the sourceDocLine in
     * app/api/plan-lesson/route.ts), so this is the identical call a typed topic makes, with the
     * document attached — not a second planning path that can drift from the first.
     *
     * The approved outline is now read by generation for the full-lecture shape, so steering it here
     * actually changes the lecture. A focused question keeps its own path above and is untouched.
     */
    if (!forceBuild && isPdfOrDeck) {
      setDocumentPlanningActive(true);
      focusedPlanningFreshRef.current = {
        ...fresh,
        sourceDocument: planningDocument ?? undefined,
        focus: "",
        kind: planningKind,
      };
      setPhase("outline");
      await streamOutlineRequest({
        mode: "outline",
        topic: trimmed,
        clarifications: [],
        sourceDocument: planningDocument,
      }, trimmed);
      return;
    }

    if (forceBuild || shouldSkipPlanning()) {
      const normalizedFresh = isPdfOrDeck && isWholeDocumentRequest(planningFocus)
        ? { ...fresh, sourceDocument: planningDocument, focus: "", kind: planningKind }
        : fresh;
      build(trimmed, undefined, normalizedFresh);
      return;
    }

    setPhase("outline");
    setPlanLoading(true);
    const data = await callPlanApi({ mode: "clarify", topic: trimmed, sourceDocument });
    setPlanLoading(false);
    if (data && data.ambiguous === true && Array.isArray(data.questions) && data.questions.length > 0) {
      // Genuinely vague — hold off on drafting until the student resolves it.
      setInitialAmbiguityQuestions(data.questions as ClarifyQuestion[]);
      return;
    }
    /*
     * Ask who this is for before planning what to teach.
     *
     * Only on the typed-topic path: an uploaded document returns above with its own planning, and a
     * demo/skip path never reaches here. Both questions here are asked locally rather than by a
     * round-trip, so the conversation starts the instant the screen does. This is the ONE pre-draft
     * conversation for a typed topic now — the old "planningQuestions" chip questionnaire (prior
     * knowledge / focus / structure dropdowns) has been retired in favor of this adaptive diagnostic;
     * see CLARIFY_TOPIC_SYSTEM_PROMPT's doc comment for why it no longer proposes those.
     *
     * THE DEPTH QUESTION COMES FIRST, ALWAYS. Everything else in this conversation deliberately
     * avoids asking the student to self-report their level (see diagnosticPrompt.ts's own doc
     * comment on why recognition is not evidence) — but "how deep do you want this" is a
     * preference, not a competence claim, the same category as the existing "goal" question kind.
     * Asking it directly and up front, every time, means depth is never left to an implicit read
     * of phrasing; runDiagnostic still lets the rest of the conversation's evidence override it.
     */
    // Never let a slow network hold up the conversation: memory gets a moment, then we go without.
    const memory = await Promise.race([
      loadLearnerMemory(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    const seeded = memory ? seedProfile(memory, trimmed, emptyProfile(trimmed)) : emptyProfile(trimmed);
    setLearnerProfile(seeded);
    learnerProfileRef.current = seeded;
    setMemoryNote(memoryWasUsed(seeded) ? rememberedLine(seeded) : null);
    lastStudentAnswerRef.current = "";
    spokenQuestionRef.current = "";
    isDepthQuestionRef.current = true;
    setDiagnosticQuestion({
      question: depthQuestion(trimmed),
      options: DEPTH_OPTIONS.map((o) => o.label),
    });
  }

  /**
   * One turn of the pre-lesson conversation.
   *
   * Answer in, updated profile out, and either the next question or the outline. The server is
   * stateless about this — the profile round-trips on every turn — so this function is the only
   * place the conversation's state lives.
   *
   * NEVER BLOCKS THE LESSON. Every failure path here falls through to drafting the outline: a
   * diagnostic that errors, times out, or returns nothing leaves the student with exactly the
   * lecture they would have had before this feature existed. The stage is an enhancement, and an
   * enhancement that can strand someone on a question screen is worse than no enhancement.
   */
  /**
   * ONE turn of the pre-lesson conversation, shared by BOTH the text-chat diagnostic and the live
   * voice session — see the doc comment on `onTranscript` below for why. Grades `answer` against
   * `question` (the open text-chat question when `source === "text"`, or a synthetic "what have
   * they just told Aria" question when `source === "voice"`), updates the one shared
   * `learnerProfile`, and returns whatever the model decided — the caller decides what to DO with
   * that, which is the whole reason this is split out from `runDiagnostic` rather than being it.
   *
   * NEVER BLOCKS THE LESSON. Every failure path here returns null rather than throwing: a
   * diagnostic that errors, times out, or returns nothing leaves the student with exactly the
   * lecture they would have had before this feature existed.
   */
  async function submitDiagnosticAnswer(
    question: string,
    answer: string,
    source: "text" | "voice",
  ): Promise<{ nextQuestion: { question: string; options: string[] } | null; remark: string } | null> {
    const exchanges = [...diagnosticExchanges, { question, answer }];
    setDiagnosticExchanges(exchanges);

    const data = await callPlanApi({
      mode: "diagnose",
      topic,
      profile: learnerProfileRef.current ?? emptyProfile(topic),
      exchanges,
      accountContext: accountContextLine(),
      // So Aria asks about what she does not know yet, not what her portrait already says.
      ...personaField(),
    });
    if (!data) return null;

    const profile = (data.profile as LearnerProfile | undefined) ?? null;
    if (profile) {
      setLearnerProfile(profile);
      learnerProfileRef.current = profile;
      // Tell the voice session what is now established, whichever channel just learned it — a
      // spoken answer must stop the TEXT side re-asking it, and a typed answer must stop Aria
      // asking about it out loud. See the "WHILE PLANNING" instruction in planningVoiceContract.ts.
      if (source === "text" && (planningVoice.status === "live" || planningVoice.status === "drawing")) {
        planningVoice.addContext(profileContextForVoice(profile));
      }
    }
    const depth = typeof data.depth === "number" ? (data.depth as DepthLevel) : null;
    if (depth) setLearnerDepth(depth);

    const remark = typeof data.remark === "string" ? data.remark.trim() : "";
    const next = data.nextQuestion as { question: string; options?: string[] } | null | undefined;
    return {
      nextQuestion: next?.question ? { question: next.question, options: Array.isArray(next.options) ? next.options : [] } : null,
      remark,
    };
  }

  async function runDiagnostic(answer: string) {
    const question = diagnosticQuestion?.question ?? openingQuestion(topic);
    lastStudentAnswerRef.current = answer;
    setDiagnosticQuestion(null);

    /*
     * The depth question answers itself — no model round-trip needed for a fixed set of chip
     * options. Maps straight onto claimedLevel (a stated preference, not a self-graded competence
     * claim — see depthQuestion's doc comment), then moves straight into the real adaptive
     * diagnostic, which can still override this via resolveDepth's existing asymmetric trust if
     * what follows contradicts it.
     *
     * A free-typed answer gets a best-effort local keyword match (someone who types "advanced" by
     * hand said the same thing as clicking the chip) at high confidence; anything unrecognisable
     * still sets a mid-level default at LOW confidence rather than silently discarding the answer
     * and leaving claimedLevel null — a null claimedLevel reads to resolveDepth as "never asked",
     * which is no longer true once this question has been asked and answered.
     */
    if (isDepthQuestionRef.current) {
      isDepthQuestionRef.current = false;
      const trimmed = answer.trim();
      const picked =
        DEPTH_OPTIONS.find((o) => o.label === trimmed) ??
        DEPTH_OPTIONS.find((o) => trimmed.toLowerCase().includes(o.label.split(" ")[0].toLowerCase()));
      const next: LearnerProfile = {
        ...(learnerProfileRef.current ?? emptyProfile(topic)),
        claimedLevel: picked?.level ?? 3,
        confidence: picked ? "high" : "low",
      };
      setLearnerProfile(next);
      learnerProfileRef.current = next;
      // Computed locally, right away, so the profile card's depth line reflects this choice the
      // instant it's made rather than waiting on the next diagnose round-trip to report it back.
      setLearnerDepth(resolveDepth(next));
      // "Just teach me" on the depth question itself still means "skip straight to the lecture".
      if (!wantsToStart(answer)) {
        setDiagnosticQuestion({ question: openingQuestion(topic), options: [] });
        return;
      }
    }

    /*
     * The student's override, checked before the model is consulted.
     *
     * "just teach me" must not wait on a round-trip to find out whether the model agreed to stop —
     * and a model told to be curious will occasionally ask one more anyway.
     */
    if (wantsToStart(answer)) {
      setDiagnosticBusy(false);
      requestOutline(topic, clarifyAnswers, planAngle);
      return;
    }

    setDiagnosticBusy(true);
    const result = await submitDiagnosticAnswer(question, answer, "text");
    setDiagnosticBusy(false);

    if (!result) {
      // submitDiagnosticAnswer already surfaced the error; teach rather than strand them on a question.
      requestOutline(topic, clarifyAnswers, planAngle);
      return;
    }

    if (result.remark) {
      diagnosticTurnRef.current += 1;
      setDiagnosticRemark({ text: result.remark, turn: diagnosticTurnRef.current });
    }

    if (result.nextQuestion) {
      setDiagnosticQuestion(result.nextQuestion);
      return;
    }
    requestOutline(topic, clarifyAnswers, planAngle);
  }

  /**
   * What the account already knows, so the conversation never asks for it again.
   *
   * Deliberately narrow. Age and accessibility pace genuinely change how something should be
   * taught; anything else on the profile would be personalisation for its own sake, which reads as
   * surveillance rather than teaching.
   */
  function accountContextLine(): string {
    const bits: string[] = [];
    if (profile?.age) bits.push(`age ${profile.age}`);
    if (profile?.simplerLanguage) bits.push("prefers simpler language");
    if (profile?.slowerPace) bits.push("prefers a slower pace");

    /*
     * Past lessons, so the conversation opens from what is already known.
     *
     * Only the few most recent, and only what stays true: a student who demonstrated a concept in
     * an earlier lesson should not be asked about it again. The prompt is separately told never to
     * re-ask anything in this line.
     */
    const past = learnedTopicsRef.current.slice(0, 3);
    for (const t of past) {
      const mastered = t.mastered.length ? `, demonstrated ${t.mastered.slice(0, 3).join(", ")}` : "";
      bits.push(`previously taught "${t.topic}" at depth ${t.depth}/5${mastered}`);
    }
    return bits.join("; ");
  }

  /**
   * What to silently tell the live voice session right after a TEXT answer updates the shared
   * profile, so Aria's own next spoken question — which she generates herself, per her "ASK, do
   * not tell" persona (lib/planningVoiceContract.ts) — never re-asks something already answered
   * on the other channel. Kept short and in the same "already established, never re-ask" register
   * accountContextLine already uses for the account's own prior-lesson history.
   */
  function profileContextForVoice(profile: LearnerProfile): string {
    const bits: string[] = [];
    if (profile.masteredConcepts.length) bits.push(`already demonstrated: ${profile.masteredConcepts.join(", ")}`);
    if (profile.weakConcepts.length) bits.push(`shaky on: ${profile.weakConcepts.join(", ")}`);
    if (profile.misconceptions.length) bits.push(`holds this wrong belief: ${profile.misconceptions.join("; ")}`);
    if (profile.prerequisiteGaps.length) bits.push(`missing prerequisite: ${profile.prerequisiteGaps.join(", ")}`);
    if (profile.objective !== "unknown") bits.push(`wants this for: ${profile.objective}`);
    if (profile.teachingHypothesis) bits.push(`current read on this student: ${profile.teachingHypothesis}`);
    return bits.length ? `The student answered a question in the chat panel. Already established, never ask about it again: ${bits.join(" | ")}` : "";
  }

  /** Applies an answer to a pre-draft ambiguity question — starts the FIRST draft now that the
   *  subject is resolved (mode:"outline"), since before this the outline was never built. */
  function answerAmbiguity(question: string, answer: string) {
    const next = [...clarifyAnswers, { question, answer }];
    setClarifyAnswers(next);
    setInitialAmbiguityQuestions([]);
    requestOutline(topic, next, planAngle);
  }

  /** Records/replaces an answer to one pre-draft planning question (main-canvas panel shows all
   *  of them at once, like a short form) — drafting only starts once every question has an
   *  answer (or the student explicitly skips), via submitPlanningQuestions below. */
  function choosePlanningAnswer(question: string, label: string, instruction: string, focus?: string | null, fidelity?: PdfFidelity, depthLevel?: DepthLevel) {
    setPlanningAnswers((prev) => [...prev.filter((a) => a.question !== question), { question, label, instruction, focus, fidelity, depthLevel }]);
  }

  /** Pulls the fidelity choice (see fallbackFidelityQuestion) out of the answered planning
   *  questions and folds it into sourceScope, alongside whatever breadth was already chosen —
   *  the two travel together from here on. Matched by `fidelity` being SET rather than by
   *  `focus`'s presence, since every answer object now always carries a `focus` key (even
   *  `undefined`) once choosePlanningAnswer started threading fidelity through the same shape. */
  function applyFidelityAnswer(answers: typeof planningAnswers, breadth: SourceScope["breadth"]) {
    const fidelityAnswer = answers.find((a) => a.fidelity === "strict" || a.fidelity === "reference");
    const next: SourceScope = {
      breadth,
      fidelity: fidelityAnswer?.fidelity ?? "reference",
      documentLabels: pendingSources.length > 1 ? pendingSources.map((s) => s.file.name) : [],
    };
    setSourceScope(next);
    sourceScopeRef.current = next;
    return next;
  }

  /**
   * All planning questions answered — fold them into clarifyAnswers (same grounding mechanism
   * ambiguity answers use) and draft an outline. This used to call build() directly for an
   * uploaded document, skipping the outline/preview screens entirely: the student would answer
   * the scope/emphasis/fidelity chips and land straight in "Preparing your lesson" with no chance
   * to see or confirm the lesson structure first. Every path — typed topic or uploaded document —
   * now goes through requestOutline the same way, so a document upload gets the identical
   * drafting-then-preview experience a typed topic already had.
   */
  function submitPlanningQuestions() {
    if (documentPlanningActive) {
      const scopeAnswer = planningAnswers.find((answer) => typeof answer.focus !== "undefined");
      const nextFocus = scopeAnswer ? scopeAnswer.focus ?? "" : "";
      const notes = planningAnswers
        .filter((a) => a.fidelity === undefined && a.depthLevel === undefined)
        .map((answer) => answer.instruction);
      applyFidelityAnswer(planningAnswers, nextFocus ? { kind: "section", focus: nextFocus } : { kind: "whole" });
      /*
       * The depth choice from the document-scope questions travels the same way the typed-topic
       * diagnostic's depth question does — straight onto claimedLevel/learnerDepth, not into the
       * free-text documentPlanningNotes line, so learnerInstruction's proper depth directive
       * applies rather than a vague prose note.
       */
      const depthAnswer = planningAnswers.find((a) => a.depthLevel !== undefined);
      if (depthAnswer?.depthLevel) {
        const nextProfile: LearnerProfile = {
          ...(learnerProfileRef.current ?? emptyProfile(topic)),
          claimedLevel: depthAnswer.depthLevel,
          confidence: "high",
        };
        setLearnerProfile(nextProfile);
        learnerProfileRef.current = nextProfile;
        setLearnerDepth(resolveDepth(nextProfile));
      }
      documentPlanningNotesRef.current = notes;
      setUploadFocus(nextFocus);
      setInitialPlanningQuestions([]);
      setPlanningAnswers([]);
      requestOutline(topic, [], planAngle);
      return;
    }
    const next = [...clarifyAnswers, ...planningAnswers.map((a) => ({ question: a.question, answer: `${a.label}: ${a.instruction}` }))];
    setClarifyAnswers(next);
    setInitialPlanningQuestions([]);
    setPlanningAnswers([]);
    requestOutline(topic, next, planAngle);
  }

  /** "Use your judgment" — explicit skip past the planning-question panel straight to drafting
   *  (an outline, not a direct build — same reasoning as submitPlanningQuestions above). */
  function skipPlanningQuestions() {
    setInitialPlanningQuestions([]);
    setPlanningAnswers([]);
    if (documentPlanningActive) {
      setUploadFocus("");
      documentPlanningNotesRef.current = [];
      requestOutline(topic, [], planAngle);
      return;
    }
    requestOutline(topic, clarifyAnswers, planAngle);
  }

  async function reviseOutline(instruction: string) {
    if (!outline || !instruction.trim()) return;
    planningRevisionRef.current = [...planningRevisionRef.current.slice(-19), instruction.trim()];
    const fresh = focusedPlanningFreshRef.current;
    await streamOutlineRequest({
      mode: "revise",
      outline,
      instruction: instruction.trim(),
      sourceDocument: fresh?.sourceDocument ?? sourceDocument,
      ...(focusedDocumentPlanningActive ? {
        question: fresh?.focus ?? uploadFocus,
        transcript: fresh?.transcript ?? ocrTranscript,
      } : {}),
    }, outline.topic);
  }

  /** Leaving planning — Back from the plan, Stop during a build — goes to the front page. */
  function leaveToHome() {
    planAbortRef.current?.abort();
    buildAbortRef.current?.abort();
    resetPlanning();
    resetCostLedger();
    go("landing");
  }

  /**
   * The learner profile the generation request will carry.
   *
   * The build-time steering CARD that used to gate this is gone (it blocked generation on a click
   * while its answers were truncated out of the prompt), so there is no `buildSteeringActive` to
   * check — the profile is simply kept current and read by `build()` when it runs.
   */
  function updateLearnerProfile(patch: Partial<LearnerProfileSnapshot>) {
    const merged = { ...generationProfileRef.current, ...patch };
    // A code choice the student made (or the suggestion carried) is kept; the expertise/goal rule
    // only ever ADDS code, it no longer silently takes back a request for it.
    const codeExamples = typeof patch.codeExamples === "boolean"
      ? patch.codeExamples
      : merged.codeExamples || shouldIncludeCodeExamples(merged);
    const next = { ...merged, codeExamples };
    generationProfileRef.current = next;
    setGenerationProfile(next);
  }

  /**
   * "Approve" no longer starts the build directly — it moves to the Final Lesson Preview, a
   * synthesized "here's everything about you + here's the plan" screen the student confirms or
   * goes back to edit, per the redesign. Gated on the diagnostic/planning questions actually
   * being resolved (they already gate the outline screen's own approve button existing at all,
   * but re-checking here keeps this function correct if it is ever called from anywhere else).
   */
  function approveOutline() {
    if (!outline) return;
    if (diagnosticQuestion || initialPlanningQuestions.length > 0 || initialAmbiguityQuestions.length > 0) return;
    // No separate preview screen any more: the chat has just shown the student what Aria
    // understood about them and the plan itself, so Accept means "start".
    confirmLessonPlan();
  }

  /** What the old approveOutline body did — the actual build trigger, now called from the
   *  preview screen's "Confirm" button. */
  function confirmLessonPlan() {
    build(
      topic,
      outline ?? undefined,
      focusedPlanningFreshRef.current ?? undefined,
      documentPlanningNotesRef.current,
    );
  }

  /**
   * What was just parsed, when the caller has it and React does not yet.
   *
   * The bug this exists for: `parseSelectedPages` set sourceDocument, uploadFocus and ocrTranscript
   * and then called startPlanning in the same tick. React had not re-rendered, so `build` closed
   * over the PREVIOUS values — every first build after an upload sent no document, no focus and no
   * transcript at all. A lecture built with no source document is exactly the "generic lecture"
   * that was reported, and no amount of work on grounding could reach a request that never carried
   * any. State remains the source for later rebuilds; this only covers the moment before it lands.
   */
  type FreshUpload = {
    sourceDocument?: unknown;
    focus?: string;
    transcript?: string;
    slideContext?: string;
    kind?: "pdf" | "pptx" | "suprnotes" | "task-folder";
    /** A dragged page region is already an explicit scope choice; never ask the student again. */
    scopeSelected?: boolean;
    /** Handle for the page images this parse rendered. Null when none were produced. */
    documentId?: string | null;
    /** Pages the student dragged an area on — the lecture is about that area (lib/beatSourceScope.ts). */
    regionPages?: number[];
  };

  async function build(
    t: string,
    approvedOutline?: PlanOutline,
    fresh?: FreshUpload,
    documentPlanningNotes: string[] = [],
  ) {
    const trimmed = t.trim();
    if (!trimmed) return;
    resetLectureSummary();
    buildAbortRef.current?.abort();
    const controller = new AbortController();
    buildAbortRef.current = controller;
    setPhase("building");
    // The portrait for the lecture writers needs memory in hand. Planning already awaited it; a
    // student who skipped straight to the build has not, so give it a moment, then go without.
    await Promise.race([loadLearnerMemory(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))]);
    /*
     * The build hand-off is SILENT here, deliberately.
     *
     * This used to tell the planning voice to keep the student company through the build. That job
     * now belongs to LessonDesignMode, which opens its own session with a persona written for it
     * and its own progress tools. Asking this session to do it as well is what put two Arias on the
     * screen talking over each other — and the effect below stops this one the moment the phase
     * changes, so the instruction would be shouted at a socket that is closing anyway.
     */
    setError(null);
    setBuildCost(null);
    setBeats([]);
    setBuiltTopic("");
    setBuildStatus("Choosing the teaching route");
    setBuildJobId(null);
    setBuiltLesson(null);
    buildStartedAtRef.current = Date.now();
    setBuildProgress({ stage: "analyzing", stageFraction: 0, detail: null, status: "Starting", elapsedMs: 0 });
    setProgressiveSessionId(null);
    setProgressiveComplete(true);
    setProgressivePlannedBeatCount(0);
    lecturePlayheadRef.current = -1;

    /*
     * The suggested learner profile is still fetched — it controls teaching depth and examples,
     * and never the facts or scope taken from an uploaded source.
     *
     * What is gone is the CONFIRMATION GATE that used to follow it: `setBuildSteeringActive(true)`
     * and `await waitForBuildSteering(...)` held generation until the student clicked a card whose
     * answers were then truncated out of the prompt anyway. The suggestion is now applied directly,
     * so the build starts immediately and the profile still reaches the request below.
     */
    setBuildStatus("Understanding how you want to learn");
    let suggested = DEFAULT_LEARNER_PROFILE;
    /*
     * The planning conversation already built a full profile. Derive the lecture's five-field
     * summary from it (lib/learnerModel.ts snapshotFrom) instead of asking a second model to guess
     * it again — two inferences could disagree about the same student. The suggestion call remains
     * only for lectures that had no conversation (uploads that skip planning, demos).
     */
    const conversationProfile = learnerProfileRef.current;
    const hasConversation = Boolean(conversationProfile && profileHasSignal(conversationProfile));
    if (hasConversation && conversationProfile) {
      suggested = snapshotFrom(conversationProfile, learnerDepth ?? undefined);
    } else try {
      const suggestionResponse = await fetch("/api/learner-profile/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: trimmed,
          outline: approvedOutline,
          planningConversation: JSON.stringify({
            clarificationAnswers: clarifyAnswers,
            outlineRevisions: planningRevisionRef.current,
            voiceConversation: voiceLinesRef.current,
          }),
        }),
        signal: controller.signal,
      });
      const suggestionData = await suggestionResponse.json().catch(() => ({}));
      if (suggestionData.suggestion) suggested = suggestionData.suggestion as LearnerProfileSnapshot;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
    // The suggestion route already honours an explicit "show me code" / "no code"; re-deriving here
    // from expertise and goal alone overwrote it.
    suggested = {
      ...suggested,
      codeExamples: typeof suggested.codeExamples === "boolean" ? suggested.codeExamples : shouldIncludeCodeExamples(suggested),
    };
    generationProfileRef.current = suggested;
    setGenerationProfile(suggested);

    const confirmedProfile = generationProfileRef.current;
    const buildSteeringLine = ` Confirmed learner profile: ${confirmedProfile.expertise}, ${confirmedProfile.depth} depth, ${confirmedProfile.goal} goal, ${confirmedProfile.preferredExamples} examples, code examples ${confirmedProfile.codeExamples ? "enabled" : "disabled"}.`;
    const documentPlanningLine = documentPlanningNotes.length
      ? ` Uploaded-source plan chosen by the student: ${documentPlanningNotes.join(" ")}`
      : "";

    // DEMO MODE: only bypass the API for plain topic demos. Uploaded sources must always exercise
    // the real generation path, otherwise Suprnotes/PPTX changes never show up in the lecture.
    if (DEMO_HARDCODED && !sourceDocument && !slideContext) {
      setBuildStatus("Applying your steering choices");
      // Not "$0.00" — nothing was generated, and a zero would read as "a lecture, for free".
      setBuildCost({ kind: "demo" });
      /*
       * Routed through the same ready/hand-off path as a real build, so the demo exercises the
       * transition students actually see rather than a shortcut that hides it.
       *
       * No voiceSay here: the design screen announces readiness itself (DESIGN_CUES.ready) and
       * starts the lecture once Aria stops speaking. Announcing it here too would say it twice.
       */
      const demo = { beats: demoLectureBeats, topic: demoLectureTopic };
      builtLessonRef.current = demo;
      setBuiltLesson(demo);
      setBuildProgress({ stage: "finalizing", stageFraction: 1, detail: null, status: "Ready", elapsedMs: 500 });
      return;
    }

    // Freshly parsed values win over state, which is stale for exactly one tick after an upload.
    const doc = fresh?.sourceDocument ?? sourceDocument;
    const focusText = fresh?.focus ?? uploadFocus;
    const transcriptText = fresh?.transcript ?? ocrTranscript;
    const slides = fresh?.slideContext ?? slideContext;
    // Same freshness rule as everything else here: a just-parsed value beats state, which is stale
    // for exactly one tick after an upload.
    const docImagesId = fresh?.documentId ?? documentId;

    setBuildStatus(doc ? `Building from your uploaded ${uploadedFile?.kind === "pdf" ? "PDF" : uploadedFile?.kind === "pptx" ? "presentation" : "source"}` : "Writing the lecture script and boards");

    /*
     * The learner profile reaches the lecture writer through `mood`, which is already the channel
     * every build-time preference travels on (steering choices, document plan, spoken steering).
     * Using it rather than a new field means generation, its cache key, and every existing
     * consumer pick this up with no change — and a lesson planned for a student is cached
     * separately from the same topic planned for someone else, which is correct.
     */
    const learnerLine = learnerProfileRef.current && learnerDepth
      ? learnerInstruction(learnerProfileRef.current, learnerDepth)
      : "";

    const payload: LecturePayload = {
      topic: trimmed,
      mood: `${selectedMode.name} learning mode: ${selectedMode.detail}.${buildSteeringLine}${documentPlanningLine}${learnerLine}`,
      sourceType: fresh?.kind ?? uploadedFile?.kind ?? "prompt",
      mode: selectedMode.id === "none" ? "standard" : selectedMode.id as LectureMode,
      ...(doc ? { suprnotes: doc } : slides ? { context: slides, diagramHints, slideImages } : {}),
      // The document question when there is one; otherwise the student's own words, when they say
      // more than the subject does ("deletion code in C++" vs "BST Deletion").
      ...(focusText
        ? { focus: focusText }
        : requestTextRef.current && requestTextRef.current.toLowerCase() !== trimmed.toLowerCase()
          ? { focus: requestTextRef.current }
          : {}),
      // Sent whichever route the upload took: a deck reaches generation through `context` rather
      // than `suprnotes`, and the passage read from its slides is just as much the subject there.
      ...(transcriptText ? { transcript: transcriptText } : {}),
      // A lecture "from this area": the area is the subject; the document is background.
      ...(fresh?.scopeSelected && (fresh.regionPages?.length || transcriptText)
        ? { selection: { pages: fresh.regionPages ?? [], transcript: transcriptText.slice(0, 8_000), description: trimmed } }
        : {}),
      ...(approvedOutline ? { outline: approvedOutline } : {}),
      // What lets the model read the pages instead of only a text extraction of them.
      ...(docImagesId ? { documentId: docImagesId } : {}),
      // Absent (defaults to "reference") for a topic with no upload — matches today's existing,
      // unlabeled behavior exactly.
      ...(doc || slides ? { sourceScope: sourceScopeRef.current } : {}),
      learnerProfile: confirmedProfile,
      // The whole profile, so the script writer and every board generator can pitch this lecture
      // for this student (lib/learnerBrief.ts), not just a level word.
      ...(hasConversation && conversationProfile ? { learner: conversationProfile } : {}),
      // And who they are across lessons, for the same writers.
      ...personaField(),
    };
    // Remember what the conversation established, for the next lecture, along with the student's
    // own words from it — the material the portrait is written from. Best effort: never awaited.
    // Once it is saved, the portrait is rewritten (the server skips this when nothing is new).
    if (hasConversation && conversationProfile) {
      const conversation = [
        ...diagnosticExchanges.map((exchange) => exchange.answer),
        ...voiceLinesRef.current.filter((line) => line.role === "you").map((line) => line.text),
      ].map((text) => text.trim()).filter((text) => text.length >= 4).slice(-30);
      void fetch("/api/learner-memory/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: conversationProfile, conversation }),
      })
        .then(() => refreshPersona())
        .catch(() => {});
    } else {
      refreshPersona();
    }

    try {
      const useFixture = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_USE_FIXTURE === "1";

      if (!useFixture) {
        setBuildStatus("Sending the opening beats to the generation worker");
        const progressive = await fetch("/api/progressive-lectures", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const started = await progressive.json().catch(() => ({}));
        if (!progressive.ok || typeof started.sessionId !== "string") {
          throw new Error(started.error || "Could not start progressive lecture generation.");
        }
        setBuiltTopic(trimmed);
        setProgressiveComplete(false);
        setProgressiveSessionId(started.sessionId);
        setBuildStatus("Preparing your opening beats");
        return;
      }

      const res = await fetch("/api/generate-lecture-debug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let data = await res.json().catch(() => ({}));

      /**
       * A 202 means generation is running in the background; poll until it finishes.
       *
       * The host cuts any single request at ~240s, so a long lecture used to die mid-flight with a
       * plain-text `504 stream timeout` that carried no JSON error — which is why this screen used
       * to blame the topic for what was really a platform timeout. Polling keeps every request
       * short, so a lecture can take as long as it needs.
       */
      if (res.status === 202 && typeof data.jobId === "string") {
        const jobId = data.jobId;
        // Published so the live tutor's adapt_lesson tool can steer THIS build.
        setBuildJobId(jobId);
        // Long enough to be cheap, short enough that the lecture starts promptly once ready.
        const POLL_MS = 3000;
        const DEADLINE_MS = 30 * 60 * 1000;
        const startedAt = Date.now();
        for (;;) {
          if (controller.signal.aborted) return;
          await new Promise((resolve) => setTimeout(resolve, POLL_MS));
          if (controller.signal.aborted) return;
          if (Date.now() - startedAt > DEADLINE_MS) {
            throw new Error("This lecture is taking unusually long. Try again, or use fewer pages.");
          }

          const poll = await fetch(`/api/generate-lecture/status?id=${encodeURIComponent(jobId)}`, {
            cache: "no-store",
            signal: controller.signal,
          }).catch(() => null);
          // A dropped poll is not a failed lecture — the job keeps running, so just try again.
          if (!poll?.ok) continue;
          const state = await poll.json().catch(() => ({}));

          if (state.state === "running") {
            if (typeof state.status === "string") setBuildStatus(state.status);
            /**
             * Stage data drives the design screen's bar, checklist and time estimate. Guarded
             * rather than assumed: the debug route and any older replica still answer with the
             * status-only shape, and a missing stage must leave the last real one standing rather
             * than resetting the bar to zero.
             */
            if (typeof state.stage === "string") {
              setBuildProgress({
                stage: state.stage,
                stageFraction: typeof state.stageFraction === "number" ? state.stageFraction : 0,
                detail: typeof state.detail === "string" ? state.detail : null,
                status: typeof state.status === "string" ? state.status : "Working",
                elapsedMs: typeof state.elapsedMs === "number" ? state.elapsedMs : 0,
              });
            } else if (typeof state.elapsedMs === "number") {
              setBuildProgress((prev) => ({ ...prev, elapsedMs: state.elapsedMs, status: state.status ?? prev.status }));
            }
            continue;
          }
          if (state.state === "error") throw new Error(state.error || "Couldn't build that lecture.");
          if (state.state === "unknown") {
            // NOT "expired" — nothing timed out. The job is missing because the server process that
            // was building it went away (a restart, a deploy, or the invocation being reaped), and
            // blaming a timeout sent people off shortening their PDF for a problem that had nothing
            // to do with its length.
            throw new Error("The build stopped unexpectedly — the server may have restarted. Press build to try again.");
          }
          if (state.state === "done") {
            data = state;
            break;
          }
        }
      } else if (!res.ok || !Array.isArray(data.beats)) {
        throw new Error(data.error || "Couldn't build that lecture. Try a different topic.");
      }

      if (!Array.isArray(data.beats)) {
        throw new Error(data.error || "Couldn't build that lecture. Try a different topic.");
      }
      /**
       * READY, not teaching.
       *
       * The lecture is complete here, but the screen no longer changes on its own: the design mode
       * shows 100%, Aria announces it, and the player starts on the hand-off. Snapping straight
       * into the lecture is the abrupt transition this whole flow exists to remove — and doing it
       * mid-sentence while she is still speaking was the worst version of it.
       */
      const lesson = { beats: data.beats as Beat[], topic: data.topic ?? trimmed };
      builtLessonRef.current = lesson;
      /*
       * Drive the checklist to fully complete alongside the lesson itself.
       *
       * A cache hit returns the finished lecture on the FIRST response, before any poll reported a
       * stage, so without this the screen would say "ready" in the header while the stage list
       * still showed the build sitting in "Analyzing your material" — the two halves of the same
       * screen contradicting each other.
       */
      setBuildProgress((prev) => ({ ...prev, stage: "finalizing", stageFraction: 1, detail: null, status: "Ready" }));
      setBuiltLesson(lesson);
      /*
       * `cached` is sent by the server (generate-lecture returns it on a cache hit) and was being
       * dropped here, which is what let a reused lecture display costUsd: 0 as though generating it
       * had been free. A cache hit only ever happens for a source-document run, so the document was
       * necessarily re-parsed at full price on the way to it.
       */
      if (data.cached) setBuildCost({ kind: "cached" });
      else if (typeof data.costUsd === "number") setBuildCost({ kind: "generated", usd: data.costUsd });
      if (!data.cached && typeof data.costUsd === "number") setCost("generation", data.costUsd);
      // No setPhase here — the design screen now owns the hand-off (see startBuiltLesson).
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Generation failed.");
      setPhase("error");
    }
  }

  /**
   * Commit the finished lesson and begin the lecture.
   *
   * Called by the design screen — either when Aria finishes announcing that the lesson is ready, or
   * when the student presses Start. Idempotent, because both can happen: the hand-off timer and an
   * impatient click race by design, and the loser must be a no-op rather than a second start.
   */
  function startBuiltLesson() {
    const lesson = builtLessonRef.current;
    if (!lesson) return;
    builtLessonRef.current = null;
    setBeats(lesson.beats);
    setBuiltTopic(lesson.topic);
    setPhase("teaching");
  }

  /**
   * Keep the learner model updating WHILE the lesson runs.
   *
   * The pre-lesson conversation decides where to start; these are the corrections. A student who
   * answers every checkpoint has demonstrated more than the conversation suggested, and one who
   * needs answers revealed has demonstrated less — recorded either way, so the next lesson on a
   * related topic opens from what actually happened rather than from the original estimate.
   */
  function recordCheckpointGrade(result: { concept: string; correct: boolean; revealed: boolean }) {
    const current = learnerProfileRef.current;
    if (!current) return;
    const next = applyDiagnostic(current, {
      question: result.concept,
      answer: result.revealed ? "(revealed)" : "(checkpoint)",
      verdict: result.correct ? "correct" : "incorrect",
      concept: result.concept,
    });
    learnerProfileRef.current = next;
    setLearnerProfile(next);
    // Checkpoint answers reach long-term memory through the lecture's interaction route on the
    // server (it knows which beat was asked about), not from here — sending both counted each twice.
  }

  /**
   * Remember what this learner was taught, for the next conversation.
   *
   * Best-effort and never awaited anywhere that matters: the route already no-ops when signed out
   * or when no database is configured, and a failed write must not affect a finished lesson.
   */
  function rememberLesson() {
    const current = learnerProfileRef.current;
    if (!current || !builtTopic) return;
    void fetch("/api/learned-topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: builtTopic,
        depth: learnerDepth ?? 2,
        mastered: current.masteredConcepts,
        objective: current.objective,
      }),
    }).catch(() => {});
  }

  function openSavedLecture(lecture: { topic: string; beats: Beat[] }) {
    resetLectureSummary();
    // Replaying costs only what is spent from here (narration, questions); its build was paid before.
    resetCostLedger();
    // A replay package is self-contained. Clear transient upload context so follow-up tools do not
    // accidentally read a different document that happened to be selected earlier in this tab.
    setSourceDocument(null);
    setSlideContext("");
    setDiagramHints("");
    setSlideImages([]);
    setUploadFocus("");
    setOcrTranscript("");
    setSelectionPages([]);
    setDocumentId(null);
    setFullDocumentText("");
    setUploadedFile(null);
    setProgressiveSessionId(null);
    setProgressiveComplete(true);
    setProgressivePlannedBeatCount(0);
    lecturePlayheadRef.current = -1;
    setBeats(lecture.beats);
    setBuiltTopic(lecture.topic);
    setBuildCost(null);
    setError(null);
    setPhase("teaching");
  }

  function resetLectureSummary() {
    setLectureCompleted(false);
    setSummaryOpen(false);
    setLectureSummary(null);
    setSummaryError(null);
    setSummaryLoading(false);
  }

  async function fetchLectureSummary() {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetch("/api/summarize-lecture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: builtTopic,
          request: requestTextRef.current,
          beats: beats.map((beat) => ({ title: beat.title, points: beat.points, script: beat.script })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      recordJsonCost("questions", data);
      if (!res.ok || !data.summary) throw new Error(data.error || "Couldn't summarize the lecture.");
      setLectureSummary(data.summary as LectureSummary);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : "Couldn't summarize the lecture.");
    } finally {
      setSummaryLoading(false);
    }
  }

  function openLectureSummary() {
    // The button is disabled until then; this guard is the rule, not the styling.
    if (!lectureCompleted) return;
    setSummaryOpen(true);
    if (!lectureSummary && !summaryLoading) void fetchLectureSummary();
  }

  const summaryOverlay = summaryOpen ? (
    <LectureSummarySlide
      fixed
      summary={lectureSummary}
      loading={summaryLoading}
      error={summaryError}
      onRetry={() => void fetchLectureSummary()}
      onClose={() => setSummaryOpen(false)}
    />
  ) : null;

  /** The end-of-lecture screens' way in. Only rendered once the lecture is complete. */
  const summaryButton = lectureCompleted ? (
    <button
      onClick={openLectureSummary}
      data-summarize-lecture=""
      className="hud-btn-primary fixed bottom-6 right-6 z-40 rounded-full px-6 py-3 text-sm font-bold shadow-2xl"
    >
      Summarize the lecture in one slide
    </button>
  ) : null;

  // Fired when a lecture finishes naturally (last beat played) — offers a test on the content.
  // Blind mode forces oral-only (a typed exam is a poor fit for an already voice-first mode);
  // every other mode gets to choose written or oral on the offer screen.
  function onLectureComplete() {
    // The final beat is never "moved past", so say explicitly that it was watched to the end.
    if (progressiveSessionId && lecturePlayheadRef.current >= 0) {
      void fetch(`/api/progressive-lectures/${encodeURIComponent(progressiveSessionId)}/interaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "playhead", playhead: lecturePlayheadRef.current, ended: true }),
      }).catch(() => {});
    }
    if (!progressiveComplete) return;
    // Watched to the end: the one-slide summary unlocks, here and on every screen after this.
    setLectureCompleted(true);
    rememberLesson();
    setPhase("test-offer");
  }

  function onLectureBeatChange(index: number) {
    if (index === lecturePlayheadRef.current) return;
    lecturePlayheadRef.current = index;
    if (!progressiveSessionId) return;
    void fetch(`/api/progressive-lectures/${encodeURIComponent(progressiveSessionId)}/interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "playhead", playhead: index }),
    });
  }

  function captureLearnerInteraction(signal: LearnerAdaptiveSignal) {
    if (!progressiveSessionId) return;
    const streamNeedsRestart = progressiveComplete;
    void fetch(`/api/progressive-lectures/${encodeURIComponent(progressiveSessionId)}/interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...signal, playhead: lecturePlayheadRef.current }),
    }).then(async (response) => {
      const result = await response.json().catch(() => ({})) as { adapted?: boolean };
      if (!response.ok || result.adapted === false || !streamNeedsRestart) return;
      setProgressiveComplete(false);
      setProgressiveStreamRevision((revision) => revision + 1);
    }).catch(() => {});
  }

  async function generateTestBank(): Promise<TestBank | null> {
    setTestLoading(true);
    setTestError(null);
    try {
      const res = await fetch("/api/generate-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: builtTopic, beats }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.questions)) throw new Error(data.error || "Could not generate a test.");
      const bank = { topic: data.topic ?? builtTopic, questions: data.questions as TestBank["questions"] };
      setTestBank(bank);
      return bank;
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Could not generate a test.");
      return null;
    } finally {
      setTestLoading(false);
    }
  }

  async function startWrittenTest() {
    const bank = testBank ?? (await generateTestBank());
    if (bank) setPhase("test-written");
  }

  async function startOralTest() {
    const bank = testBank ?? (await generateTestBank());
    if (bank) setPhase("test-oral");
  }

  function onTestGraded(results: TestGradeResult[], answers?: Record<string, string>) {
    setTestResults(results);
    setTestAnswers(answers);
    setPhase("test-results");
  }

  /**
   * Leaving a lecture ends it HERE, not on a different page.
   *
   * `onExit` navigated to the app-level completion screen, whose Replay routes back through
   * `startLesson(lastTrack)` — and that mounts a player with no beats, so it fell through to the
   * hardcoded photosynthesis demo. The lecture the student had just built lives in this component's
   * state, and once the router left this page there was nothing left to replay.
   *
   * Ending here keeps `beats` and `builtTopic` in scope, so Replay is genuinely a replay. "Something
   * new" still leaves, because that is the one case where losing the lecture is the intent.
   */
  function endLecture() {
    setPhase("finished");
  }

  /**
   * A DIFFERENT door than endLecture: pressing "End lesson" mid-lecture must return to the actual
   * Home page with the normal site UI restored — not detour through the "Finished." interstitial,
   * and not the separate app-level completion screen either.
   *
   * WHY THIS EXISTS. The interstitial ("It will not run that way again", Replay / Test me / Something
   * new) is a genuine end-of-lecture summary and stays for when a lecture completes naturally — that
   * moment is worth a beat. But the player's own exit control fires the same instant the student
   * decides to leave, mid-lesson, having asked for nothing but out. Routing that through a second
   * screen before a third screen (CompletePage) reaches Home was the actual bug: two hops of UI the
   * student never asked to see stood between "I want to leave" and being home.
   *
   * `go("landing")` directly is what "the normal home UI restored" means concretely in this app's
   * router — see components/hud/HudKit.tsx's PageName union and HudLogo's own onClick.
   */
  function endLectureToHome() {
    resetCostLedger();
    go("landing");
  }

  function replayLecture() {
    // Same beats, from the top. The player keys off its own index, so re-entering "teaching"
    // restarts it without regenerating anything.
    setPhase("teaching");
  }

  function backToLectureFromTest() {
    setTestBank(null);
    setTestResults(null);
    setTestAnswers(undefined);
    setTestError(null);
    // Back to the end of the lecture, not out of it — the beats are still here and still replayable.
    endLecture();
  }

  if (phase === "finished") {
    return (
      <main className="hud-canvas hud-grain relative flex min-h-screen items-center justify-center px-6">
        <section className="relative z-10 mx-auto flex max-w-3xl flex-col justify-center">
          <h1 className="hud-materialize font-display text-[3rem] leading-[0.94] tracking-[-0.035em] text-[var(--hud-text-dim)] sm:text-[4.4rem]">
            Finished.
            <br />
            <span className="text-[var(--hud-text)]">It will not run</span> that way again.
          </h1>
          <p
            className="hud-materialize mt-9 max-w-md text-[1.02rem] leading-[1.7] text-[var(--hud-text-dim)]"
            style={{ animationDelay: "0.1s" }}
          >
            Replay gives you this recording of {builtTopic || "your lecture"}. Asking again writes a new one.
          </p>
          <div className="hud-materialize mt-11 flex flex-wrap items-center gap-7" style={{ animationDelay: "0.18s" }}>
            <button
              onClick={replayLecture}
              className="hud-btn-primary rounded-[var(--radius)] px-9 py-4 text-[0.95rem]"
            >
              Replay
            </button>
            <button
              onClick={() => setPhase("test-offer")}
              className="text-sm text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
            >
              Test me on it
            </button>
            {lectureCompleted && (
              <button
                onClick={openLectureSummary}
                data-summarize-lecture=""
                className="text-sm font-semibold text-[var(--hud-text)] underline-offset-4 transition-colors hover:underline"
              >
                Summarize in one slide
              </button>
            )}
            {/* The one door that genuinely discards the lecture, so it is the one that leaves. */}
            <button
              onClick={onExit}
              className="text-sm text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
            >
              Something new
            </button>
            {/* A direct, undramatic way home — distinct from "Something new" (which re-enters the
                ask flow to start another lesson) and from Replay/Test (which stay with this one).
                Goes straight to the landing page with the normal site UI, no interstitial in between. */}
            <button
              onClick={() => go("landing")}
              className="text-sm text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
            >
              Home
            </button>
          </div>
        </section>
        {summaryOverlay}
      </main>
    );
  }

  if (phase === "test-offer") {
    return (
      <>
      <TestOfferScreen
        mode={selectedMode}
        topic={builtTopic}
        loading={testLoading}
        error={testError}
        forceOral={selectedMode.page === "blind-demo"}
        onWritten={startWrittenTest}
        onOral={startOralTest}
        onSkip={endLecture}
      />
      {/* The student lands here the moment the lecture ends — the summary is one click away. */}
      {!summaryOpen && summaryButton}
      {summaryOverlay}
      </>
    );
  }

  if (phase === "test-written" && testBank) {
    return <TestWrittenView key={testBank.questions.map((q) => q.id).join(":")} bank={testBank} onGraded={onTestGraded} onBack={() => setPhase("test-offer")} />;
  }

  if (phase === "test-oral" && testBank) {
    return (
      <TestOralView
        key={testBank.questions.map((q) => q.id).join(":")}
        topic={builtTopic}
        bank={testBank}
        onGraded={(results) => onTestGraded(results, undefined)}
        onBack={() => setPhase("test-offer")}
      />
    );
  }

  if (phase === "test-results" && testBank && testResults) {
    return (
      <TestResultsView
        topic={builtTopic}
        bank={testBank}
        results={testResults}
        answers={testAnswers}
        onBack={backToLectureFromTest}
      />
    );
  }

  if (phase === "teaching") {
    let player: React.ReactNode;
    // Freeform learner-mode string for the live tutor's realtime session instructions.
    const moodString = `${selectedMode.name} learning mode: ${selectedMode.detail}`;
    switch (selectedMode.page) {
      case "blind-demo":
        player = <BlindLessonPlayer beats={beats} title={builtTopic} onExit={endLectureToHome} onComplete={onLectureComplete} autoStart hasMoreBeats={!progressiveComplete} totalBeatCount={progressivePlannedBeatCount || undefined} onBeatIndexChange={onLectureBeatChange} onLearnerInteraction={captureLearnerInteraction} />;
        break;
      case "adhd-demo":
        player = <AdhdLessonPlayer beats={beats} title={builtTopic} onExit={endLectureToHome} onComplete={onLectureComplete} mood={moodString} sourceDocument={sourceDocument} slideContext={slideContext} ocrTranscript={ocrTranscript} documentId={documentId ?? ""} lessonQuestion={uploadFocus} fullDocumentText={fullDocumentText} hasMoreBeats={!progressiveComplete} totalBeatCount={progressivePlannedBeatCount || undefined} onBeatIndexChange={onLectureBeatChange} onLearnerInteraction={captureLearnerInteraction} />;
        break;
      case "dyslexia-demo":
        player = <DyslexiaLessonPlayer beats={beats} title={builtTopic} onExit={endLectureToHome} onComplete={onLectureComplete} sourceDocument={sourceDocument} slideContext={slideContext} ocrTranscript={ocrTranscript} documentId={documentId ?? ""} lessonQuestion={uploadFocus} fullDocumentText={fullDocumentText} hasMoreBeats={!progressiveComplete} totalBeatCount={progressivePlannedBeatCount || undefined} onBeatIndexChange={onLectureBeatChange} onLearnerInteraction={captureLearnerInteraction} />;
        break;
      case "deaf-demo":
        player = <LessonPlayer beats={beats} title={builtTopic} onExit={endLectureToHome} onComplete={onLectureComplete} onCheckpointGraded={recordCheckpointGrade} mode="deaf" mood={moodString} sourceDocument={sourceDocument} slideContext={slideContext} ocrTranscript={ocrTranscript} documentId={documentId ?? ""} lessonQuestion={uploadFocus} fullDocumentText={fullDocumentText} hasMoreBeats={!progressiveComplete} totalBeatCount={progressivePlannedBeatCount || undefined} onBeatIndexChange={onLectureBeatChange} onLearnerInteraction={captureLearnerInteraction} onSummarize={openLectureSummary} summaryUnlocked={lectureCompleted} selectionPages={selectionPages} />;
        break;
      case "demo":
      default:
        // `adhd` is the ONLY difference between the two tracks at this point: same player, same UI,
        // plus the overlay. The gate lives in lib/adhd/gate.ts so this is the one place that asks.
        player = <LessonPlayer beats={beats} title={builtTopic} onExit={endLectureToHome} onComplete={onLectureComplete} onCheckpointGraded={recordCheckpointGrade} mood={moodString} adhd={isAdhdLearner(profile)} sourceDocument={sourceDocument} slideContext={slideContext} ocrTranscript={ocrTranscript} documentId={documentId ?? ""} lessonQuestion={uploadFocus} fullDocumentText={fullDocumentText} hasMoreBeats={!progressiveComplete} totalBeatCount={progressivePlannedBeatCount || undefined} onBeatIndexChange={onLectureBeatChange} onLearnerInteraction={captureLearnerInteraction} onSummarize={openLectureSummary} summaryUnlocked={lectureCompleted} selectionPages={selectionPages} />;
    }
    return (
      <div className="relative">
        {player}
        {summaryOverlay}
        {/*
            The whole lecture's cost, not one stage of it: document, planning, generation, narration,
            questions and the live tutor each report what they measured (lib/costLedger.ts). The old
            badge showed generation alone and said so; that was honest but it was not the cost of
            the lecture — a re-uploaded PDF showed $0.0000 for about a dollar of document reading.
        */}
        {/*
         * OPERATOR TELEMETRY, NOT STUDENT UI. This floated a running dollar figure across the top
         * of the board — "This lecture $0.5385 · planning $0.0014 · generation $0.4297 …" — in the
         * most valuable space on screen, answering a question no learner has while they are trying
         * to follow a diagram. It is worth keeping for cost work, so it is behind a flag rather
         * than deleted: NEXT_PUBLIC_SHOW_COST_BADGE=1.
         */}
        {process.env.NEXT_PUBLIC_SHOW_COST_BADGE === "1" && (
          <LectureCostBadge
            reused={buildCost?.kind === "cached"}
            demo={buildCost?.kind === "demo"}
            generating={Boolean(progressiveSessionId) && !progressiveComplete}
          />
        )}
      </div>
    );
  }

  function submitTopic(value = input) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setTopic(trimmed);
    setInput("");
    setError(null);
    setPhase("ask");
  }

  /**
   * Page selection is its own full screen rather than a panel inside the upload box.
   *
   * FULL-BLEED SCROLLER, NOT A SPLIT PANE. The previous layout gave the page preview half the
   * screen and spent the other half on a thumbnail grid that duplicated what scrolling already
   * shows. Selection now happens on the page itself — a small "Select" control beside its label —
   * so the whole width goes to reading the document, which is what a 300%-zoomed Cambridge
   * textbook page actually needs.
   */
  if (uploadPhase === "choosing" || parsingPages) {
    const label = activeSource?.kind === "pptx" ? "slides" : "pages";
    const totalSelected = pendingSources.reduce((sum, s) => sum + s.selection.pages.length, 0);
    const drawnAreas = pendingSources.reduce((sum, s) => sum + Object.keys(s.regions).length, 0);
    return (
      <main className="hud-canvas hud-grain relative flex h-screen flex-col overflow-hidden text-[var(--hud-text)]">
        <header
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-3"
          style={{ borderColor: "var(--hud-line)" }}
        >
          <div className="min-w-0">
            <p className="text-[0.72rem] text-[var(--hud-text-faint)]">Uploaded</p>
            <h1 className="truncate text-[0.95rem] font-medium">
              {pendingSources.length > 1 ? `${pendingSources.length} files` : pendingSources[0]?.file.name ?? "Document"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {totalSelected > 0 && (
              <p className="text-[0.78rem] text-[var(--hud-text-faint)]">
                {totalSelected} {label} selected
              </p>
            )}
            <button
              onClick={() => {
                setPendingSources([]);
                setUploadPhase("idle");
              }}
              className="text-sm text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
            >
              Cancel
            </button>
            <button
              onClick={() => parseSelectedPages()}
              disabled={pagesLoading || parsingPages}
              className="hud-btn-primary px-6 py-2.5 text-sm disabled:opacity-40"
            >
              {parsingPages
                ? "Reading those pages…"
                : totalSelected > 0
                  ? `Use ${totalSelected} page${totalSelected === 1 ? "" : "s"}`
                  // An area is drawn and no page ticked: that area is what gets used.
                  : drawnAreas > 0
                    ? "Use the selected area"
                    : "Use all pages"}
            </button>
          </div>
        </header>

        {/* One tab per uploaded file — an Acrobat-style document switcher, not a merged scroll
            across files (their page numbers would collide and "Use N pages" would be ambiguous
            about which file a number belongs to). */}
        {pendingSources.length > 1 && (
          <div
            className="flex shrink-0 gap-1 overflow-x-auto border-b px-3 py-2"
            style={{ borderColor: "var(--hud-line)" }}
          >
            {pendingSources.map((source, index) => (
              <button
                key={source.file.name + index}
                onClick={() => setActiveSourceIndex(index)}
                className="shrink-0 rounded-[var(--radius)] px-3 py-1.5 text-[0.78rem] font-medium transition-colors"
                style={{
                  background: index === activeSourceIndex ? "var(--hud-cyan)" : "transparent",
                  color: index === activeSourceIndex ? "var(--hud-bg)" : "var(--hud-text-dim)",
                }}
              >
                {source.file.name}
                {source.selection.pages.length > 0 ? ` (${source.selection.pages.length})` : ""}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {pagesLoading && (activeSource?.pages.length ?? 0) === 0 ? (
            /*
             * A PAGE-SHAPED SKELETON, not a spinner in an empty pane.
             *
             * The old state was an 18px faint spinner centred in the full height of the reading
             * surface, holding for the entire render with no indication of how much was coming.
             * This shows the shape of what is arriving — a column of correctly proportioned page
             * placeholders — so the layout is already correct when the first real page lands and
             * nothing jumps. It only shows while NOTHING has arrived yet; the moment page one
             * streams in, the real stack takes over and fills in behind it.
             */
            <PageStackSkeleton label={label} count={activeSource?.pageCount ?? 3} />
          ) : activeSource?.unavailableReason ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <p className="text-[0.85rem] text-[var(--hud-text-dim)]">{activeSource.unavailableReason}</p>
              <p className="text-[0.78rem] text-[var(--hud-text-faint)]">The whole document will be used.</p>
            </div>
          ) : !activeSource || activeSource.pages.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6">
              <p className="max-w-sm text-center text-[0.9rem] leading-relaxed text-[var(--hud-text-dim)]">
                Choose the pages Aria should teach from, or continue to use the whole document.
              </p>
            </div>
          ) : (
            <>
              {activeSource.fidelity === "approximate" && (
                <p className="border-b px-5 py-2 text-center text-[0.72rem] text-amber-300/80" style={{ borderColor: "var(--hud-line)" }}>
                  These are rebuilt previews, not the real slides — layout and fonts will differ.
                </p>
              )}
              <PageStack
                pages={activeSource.pages}
                regions={pageRegions}
                onRegionChange={(pageNumber, rect) =>
                  setPageRegions((current) => {
                    const next = { ...current };
                    if (rect) next[pageNumber] = rect;
                    else delete next[pageNumber];
                    return next;
                  })
                }
                selected={pageSelection.pages}
                onToggleSelected={togglePageSelected}
                onUseRegion={useRegionAsLecture}
                label={label}
              />
            </>
          )}
        </div>

        {/* The prompt bar, docked full-width at the bottom — "what should Aria explain?" plus
            dictation, in the one place it belongs now that there is no side panel to anchor it to. */}
        <div className="shrink-0 border-t p-3" style={{ borderColor: "var(--hud-line)" }}>
          <div className="mx-auto max-w-4xl">
            <label htmlFor="page-prompt" className="sr-only">
              What should Aria explain about the selected {label}?
            </label>
            <textarea
              id="page-prompt"
              value={pageSelection.prompt}
              onChange={(e) => {
                const value = e.target.value;
                setPageSelection((current) => ({ ...current, prompt: value }));
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
              }}
              rows={2}
              placeholder={
                pageSelection.pages.length > 0
                  ? `What should Aria explain about ${pageSelection.pages.length === 1 ? "this page" : `these ${label}`}?`
                  : `Ask about specific ${label}…`
              }
              className="max-h-[180px] w-full resize-none overflow-y-auto rounded-[var(--radius)] border bg-transparent px-3 py-2 text-[0.85rem] leading-relaxed text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus:ring-1"
              style={{ borderColor: "var(--hud-line)" }}
            />
            <div className="mt-1.5 flex items-center gap-2">
              <VoicePromptButton
                baseText={pageSelection.prompt}
                onTranscript={(text) => setPageSelection((current) => ({ ...current, prompt: text }))}
                title="Speak your question"
                showLabel
                className="inline-flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1 text-[0.75rem] transition-colors"
              />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="hud-canvas hud-grain relative min-h-screen overflow-x-hidden text-[var(--hud-text)]">
      {phase === "building" ? (
        <LessonDesignMode
          topic={topic}
          mode={selectedMode.name}
          progress={{ ...buildProgress, status: buildProgress.status || buildStatus }}
          ready={builtLesson !== null}
          sourceKind={designSourceKind}
          mood={`${selectedMode.name} learning mode: ${selectedMode.detail}`}
          blindMode={selectedMode.page === "blind-demo"}
          studentName={profile?.displayName ?? undefined}
          jobId={buildJobId}
          documentId={documentId ?? undefined}
          documentContext={voiceDocContext}
          beatStatus={buildBeats?.beats}
          buildStartedAt={buildBeats?.startedAt}
          onStop={leaveToHome}
          onStart={startBuiltLesson}
        />
      ) : phase === "outline" ? (
        <OutlineReviewState
          topic={topic}
          outline={outline}
          loading={planLoading}
          error={planError}
          thoughts={planThoughts}
          scopingQuestions={planScopingQuestions}
          angle={planAngle}
          diagnosticQuestion={diagnosticQuestion}
          diagnosticBusy={diagnosticBusy}
          diagnosticRemark={diagnosticRemark}
          onAnswerDiagnostic={runDiagnostic}
          learnerSummary={learnerProfile && learnerDepth ? profileSummary(learnerProfile, learnerDepth) : ""}
          learnerProfile={learnerProfile}
          learnerDepth={learnerDepth}
          sourceScope={sourceScope}
          initialAmbiguityQuestions={initialAmbiguityQuestions}
          initialPlanningQuestions={initialPlanningQuestions}
          planningAnswers={planningAnswers}
          documentPlanning={documentPlanningActive}
          onChoosePlanningAnswer={choosePlanningAnswer}
          onSubmitPlanningQuestions={submitPlanningQuestions}
          onSkipPlanningQuestions={skipPlanningQuestions}
          onAnswerAmbiguity={answerAmbiguity}
          onRevise={reviseOutline}
          onApprove={approveOutline}
          onBack={leaveToHome}
          onOutlineChange={setOutline}
          onRerollAngle={rerollAngle}
          voice={voice}
          voiceLines={voiceLines}
          memoryNote={memoryNote}
        />
      ) : phase === "preview" ? (
        <LessonPreviewState
          topic={topic}
          outline={outline}
          learnerProfile={learnerProfile}
          learnerDepth={learnerDepth}
          sourceScope={sourceScope}
          onModify={() => setPhase("outline")}
          onConfirm={confirmLessonPlan}
          voice={voice}
        />
      ) : (
        /*
         * THE TOPIC-CAPTURE SCREEN IS GONE. The front page is the only way in: it takes the subject
         * or the file and hands it over, so this page never asks for them again. What is left is a
         * status for the moments in between — a file being read, an error with a way home, or the
         * second before planning starts. Leaving planning (Back, Stop) goes to the front page.
         */
        <EntryStatus
          phase={phase}
          error={error}
          uploadPhase={uploadPhase}
          uploadError={uploadError}
          fileName={uploadedFile?.name ?? null}
          topic={topic}
          onHome={leaveToHome}
          onRetry={topic ? () => void startPlanning(topic) : undefined}
        />
      )}
    </main>
  );
}

function parseBlindTopicCommand(raw: string): { action: "topic"; topic: string } | { action: "build" } | null {
  const normalized = raw
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const wakeMatch = /(^|\s)(hey nova|okay nova|ok nova|nova)(?=$|\s)/i.exec(normalized);
  if (!wakeMatch) return null;
  let command = normalized.slice(wakeMatch.index + wakeMatch[0].length).trim();
  command = command.replace(/^(please\s+)?/, "").trim();
  if (!command) return null;
  if (/^(build|start|begin|make|create)(\s+(the\s+)?lesson)?$/.test(command)) return { action: "build" };
  const topic = cleanupSpokenTopic(command)
    .replace(/\s+(please)$/i, "")
    .trim();
  return topic ? { action: "topic", topic } : null;
}

function cleanupSpokenTopic(command: string): string {
  return command
    .replace(/^(can you\s+)?(please\s+)?(teach me about|teach me|teach|i want you to teach me|i want to learn about|i want to learn|help me learn about|help me learn|make a lesson about|create a lesson about|lesson on|about|topic is|set topic to)\s+/i, "")
    .replace(/^(can you\s+)?(please\s+)?(explain me what is|explain me what are|explain what is|explain what are|explain me|explain|tell me what is|tell me about|what is|what are|who is|who are)\s+/i, "")
    .replace(/^(can you\s+)?(please\s+)?(help me understand|help me with|i need to understand|i want to understand)\s+/i, "")
    .replace(/\s+(please)$/i, "")
    .trim();
}

/**
 * What the learn page shows between the front page and the plan: reading a file, an error, or the
 * moment before planning starts. Never a form — the front page already asked.
 */
function EntryStatus({
  phase,
  error,
  uploadPhase,
  uploadError,
  fileName,
  topic,
  onHome,
  onRetry,
}: {
  phase: string;
  error: string | null;
  uploadPhase: "idle" | "reading" | "choosing" | "ready" | "error";
  uploadError: string | null;
  fileName: string | null;
  topic: string;
  onHome: () => void;
  onRetry?: () => void;
}) {
  const failed = phase === "error" ? error : uploadPhase === "error" ? uploadError : null;
  const title = failed
    ? phase === "error" ? "That lesson could not be built" : "That file could not be read"
    : uploadPhase === "reading" ? `Reading ${fileName ?? "your file"}…` : topic ? `Getting "${topic}" ready…` : "Getting your lesson ready…";
  return (
    <section className="hud-canvas hud-grain relative z-10 grid min-h-screen w-full place-items-center p-6">
      <div className="relative z-10 w-full max-w-md text-center" role={failed ? "alert" : "status"} aria-live="polite">
        {!failed && (
          <div className="mx-auto mb-6 h-8 w-8 animate-spin rounded-full border-2 border-[var(--hud-line-strong)] border-t-[var(--hud-text)]" aria-hidden="true" />
        )}
        <h1 className="font-display text-2xl tracking-[-0.02em] text-[var(--hud-text)]">{title}</h1>
        {failed && <p className="mt-3 text-sm text-rose-300">{failed}</p>}
        <div className="mt-8 flex items-center justify-center gap-3">
          {failed && onRetry && phase === "error" && (
            <button type="button" onClick={onRetry} className="hud-btn-primary rounded-full px-5 py-2 text-sm font-bold">
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={onHome}
            className="rounded-full border border-[var(--hud-line)] px-5 py-2 text-sm text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
          >
            {failed ? "Back to home" : "Cancel"}
          </button>
        </div>
      </div>
    </section>
  );
}

/** Shown right after a lecture finishes — offers a real test on the content. Blind mode forces
 *  oral-only (voice-first already; typing an exam is a poor fit), every other mode picks. */
function TestOfferScreen({
  mode,
  topic,
  loading,
  error,
  forceOral,
  onWritten,
  onOral,
  onSkip,
}: {
  mode: TrackMeta;
  topic: string;
  loading: boolean;
  error: string | null;
  forceOral: boolean;
  onWritten: () => void;
  onOral: () => void;
  onSkip: () => void;
}) {
  return (
    <section className="hud-canvas hud-grain relative z-10 grid min-h-screen w-full place-items-center overflow-y-auto p-6 lg:p-10">
      <div className="relative z-10 w-full max-w-xl">
        <div className="relative z-10">
          <HudEyebrow>End of lecture</HudEyebrow>
          <h1 className="mt-6 font-display text-[2.6rem] leading-[1.0] tracking-[-0.025em] sm:text-[3.4rem]">
            Now find out what
            <br />
            actually <span className="text-[var(--hud-text)]">stuck.</span>
          </h1>
          <p className="mt-7 border-t border-[var(--hud-line)] pt-6 text-[1.02rem] leading-[1.8] text-[var(--hud-text-dim)]">
            Real questions on <span className="text-[var(--hud-text)]">{topic}</span>, marked against
            what was taught rather than string-matched. Anything you miss is explained.
          </p>

          {error && <p className="mt-6 text-sm font-semibold text-rose-300">⚠️ {error}</p>}

          <div className="mt-9 flex flex-col items-center gap-3">
            {forceOral ? (
              <HudButton onClick={onOral} disabled={loading} className="w-full">
                {loading ? "Preparing…" : "Take the oral exam →"}
              </HudButton>
            ) : (
              <div className="flex w-full flex-col gap-3 sm:flex-row">
                <HudButton onClick={onWritten} disabled={loading} className="flex-1">
                  {loading ? "Preparing…" : "Written test →"}
                </HudButton>
                <HudButton variant="ghost" onClick={onOral} disabled={loading} className="flex-1">
                  {loading ? "Preparing…" : "Oral exam →"}
                </HudButton>
              </div>
            )}
            <button onClick={onSkip} disabled={loading} className="mt-2 text-sm font-bold text-[var(--hud-text-faint)] hover:text-[var(--hud-text)] disabled:opacity-40">
              Skip, I&apos;m done
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A row of quiet, flat quick-reply buttons — used inline under a chat bubble for both the rare
 *  ambiguity questions and the model-authored scoping questions. Deliberately no glow/gradient:
 *  a thin border, a filled state on hover, nothing decorative. */
function ProfileChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<readonly [T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-[var(--hud-text)]">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map(([id, text]) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${value === id
              ? "border-transparent bg-[var(--hud-cyan)] text-black"
              : "border-[var(--hud-line)] text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"}`}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

function QuickReplyChips({ options, onSelect, disabled }: { options: string[]; onSelect: (value: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          disabled={disabled}
          className="rounded-md border border-[var(--hud-line-strong)] px-4 py-2 text-sm font-medium text-[var(--hud-text-dim)] transition hover:border-[var(--hud-text-dim)] hover:text-[var(--hud-text)] disabled:opacity-40"
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

type OutlineChatMessage = {
  role: "aria" | "you";
  text: string;
  /** Inline quick-reply chips rendered under this bubble — used for ambiguity questions and
   *  model-authored scoping questions. Consumed once; the bubble keeps its chips forever in the
   *  log (a past question a student already answered), disabled state comes from `answered`. */
  chips?: { label: string; instruction: string }[];
  answered?: boolean;
  /** True for a seeded topic-ambiguity question — its chips re-draft the outline from scratch
   *  (onAnswerAmbiguity) instead of patching it in place (onRevise), since the answer changes
   *  what subject the outline should even be about. */
  isAmbiguity?: boolean;
  /** True for a pre-lesson question about what the student knows — its answer goes to the
   *  diagnostic turn rather than to the revise pipeline, since there is no outline to revise yet. */
  isDiagnostic?: boolean;
  /** Aria's plan proposal: its chips are Accept / Change / Focus, not revise instructions. */
  isPlan?: boolean;
};

/** Draft-first planning: Aria's best-guess outline appears immediately, then a live planning
 *  CONVERSATION reshapes that SAME outline — not a pre-plan questionnaire gate. Flat, dense,
 *  Linear/Notion-style two-column layout: the outline as the primary editable canvas on the
 *  left, a persistent side chat on the right that narrates Aria's live planning reasoning,
 *  asks real scoping questions grounded in the actual draft, AND takes freeform revise
 *  requests — one conversation, no buried bottom text field, no glow/gradient chrome.
 *
 *  Things beyond a static list:
 *  - Dependency connectors: each subtopic after the first shows a thin connecting line back to
 *    the one before it plus a short "builds on" tag, making the teaching ORDER visible as real
 *    structure — not just a flat stack of cards.
 *  - Low-confidence marker: a subtopic Aria genuinely wasn't sure about gets a dashed amber rail
 *    node instead of the default solid one, with an inline confirm/ask affordance — the student
 *    is confirming or correcting the plan they're already looking at, not answering an abstract
 *    questionnaire.
 *  - Scoping questions: 2-3 model-authored questions grounded in the ACTUAL drafted subtopics
 *    (never generic "more depth?" templates), rendered as chat bubbles with quick-reply chips.
 *    Picking one sends its ready-made instruction through the exact same revise pipeline
 *    freeform chat uses, patching the SAME outline object in place.
 *  - Ambiguity questions (rare — only when the topic itself is genuinely ambiguous) are seeded
 *    as the very first chat bubbles, answered the identical way — no separate gate screen.
 *  - The angle picker ("teach it differently"): rerolls the WHOLE outline through a different
 *    pedagogical framing (historical, first-principles, via a failure case, via analogy)
 *    instead of only letting the student add/remove rows from the same default structure. */
/** What Aria's live session is doing, and the way to silence it. */
type VoiceState = {
  status: string;
  speaking: boolean;
  muted: boolean;
  errorMessage: string | null;
  toggleMute: () => void;
  /** The most recent thing said, by either side. Shown so the voice is readable as well as audible. */
  lastLine: { role: "you" | "aria"; text: string } | null;
};

/**
 * One readout, used on the planning screen and the build screen.
 *
 * Shared rather than written twice because the two screens are one continuous session: showing
 * "listening" on one and nothing on the other would make a single conversation look like it had
 * stopped and started.
 */
function VoiceStrip({ voice }: { voice: VoiceState }) {
  const label =
    voice.status === "live"
      ? voice.muted
        ? "Muted"
        : voice.speaking
          ? "Aria is speaking…"
          : "Listening — just talk"
      : voice.status === "connecting"
        ? "Connecting to Aria…"
        : voice.status === "mic-denied"
          ? "Microphone blocked — Aria can't hear you"
          : voice.errorMessage ?? "Aria's voice is off";
  const live = voice.status === "live";

  return (
    <div className="flex items-center gap-2 px-1 pb-2">
      <span
        aria-hidden
        className={`h-2 w-2 rounded-full ${live && !voice.muted ? "bg-[var(--hud-accent,#7c5cff)]" : "bg-[var(--hud-text-faint,#888)]"}`}
      />
      <span className="text-xs text-[var(--hud-text-faint)]">{label}</span>
      {live && (
        <button
          type="button"
          onClick={voice.toggleMute}
          aria-pressed={voice.muted}
          className="rounded-full border border-[var(--hud-line,#333)] px-2.5 py-1 text-[11px] text-[var(--hud-text-faint)] transition hover:text-[var(--hud-text)]"
        >
          {voice.muted ? "Unmute" : "Mute"}
        </button>
      )}
      {/* Captions, in effect. Spoken words vanish, and a student who missed one should not have to
          ask her to repeat herself — nor be left unsure whether she said anything at all. */}
      {voice.lastLine && (
        <span className="max-w-[42ch] truncate text-xs italic text-[var(--hud-text-faint)]" title={voice.lastLine.text}>
          {voice.lastLine.role === "aria" ? "" : "You: "}
          {voice.lastLine.text}
        </span>
      )}
    </div>
  );
}

/**
 * The pre-lesson diagnostic question, as the main event rather than a small aside.
 *
 * Answering by typing here calls the exact same onAnswerDiagnostic the side chat's chip/typed
 * path already called — this is a second, more prominent front-end onto the same interaction,
 * not a new mechanism. Quick-reply chips (when the question has any) sit right below the
 * question text; a free-text field is always available underneath for a real answer.
 */
/**
 * The document-scope/emphasis/fidelity chip questions, one at a time — same redesign as
 * DiagnosticQuestionCard, applied here for the same reason. This used to stack every question
 * into one small bordered box and make the student answer all of them before anything advanced,
 * which read exactly like filling out a form. Now only the current unanswered question is shown,
 * generously sized, and picking a chip immediately advances to the next.
 */
function PlanningQuestionsCard({
  questions,
  answers,
  documentPlanning,
  loading,
  onChoose,
  onAllAnswered,
  onSkip,
}: {
  questions: ScopingQuestion[];
  answers: Array<{ question: string; label: string; instruction: string; focus?: string | null; fidelity?: PdfFidelity; depthLevel?: DepthLevel }>;
  documentPlanning: boolean;
  loading: boolean;
  onChoose: (question: string, label: string, instruction: string, focus?: string | null, fidelity?: PdfFidelity, depthLevel?: DepthLevel) => void;
  onAllAnswered: () => void;
  onSkip: () => void;
}) {
  const current = questions.find((q) => !answers.some((a) => a.question === q.question));

  // All questions answered — advance automatically, the instant the last chip is picked, rather
  // than waiting on a second "continue" click. In an effect, not during render: onAllAnswered
  // itself calls setState, and render must stay free of side effects.
  useEffect(() => {
    if (!current) onAllAnswered();
  }, [current, onAllAnswered]);

  if (!current) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
        <p className="text-sm text-[var(--hud-text-dim)]">Drafting your lesson…</p>
      </div>
    );
  }

  const answeredCount = answers.length;
  const total = questions.length;

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-10 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--hud-text-faint)]">
        {documentPlanning ? "Planning from your source" : "Before we draft this outline"} · {answeredCount + 1} of {total}
      </p>

      <h2 className="mt-4 max-w-xl text-2xl font-medium leading-snug text-[var(--hud-text)]">
        {current.question}
      </h2>

      <div className="mt-6 flex max-w-lg flex-wrap justify-center gap-2.5">
        {current.options.map((option) => (
          <button
            key={option.label}
            type="button"
            disabled={loading}
            onClick={() => onChoose(current.question, option.label, option.instruction, option.focus, option.fidelity, option.depthLevel)}
            className="rounded-full border border-[var(--hud-line-strong)] bg-white/[0.02] px-4 py-2 text-sm font-medium text-[var(--hud-text-dim)] transition hover:border-[var(--hud-cyan)] hover:text-[var(--hud-text)] disabled:opacity-40"
          >
            {option.label}
          </button>
        ))}
      </div>

      <button
        onClick={onSkip}
        disabled={loading}
        className="mt-8 text-xs font-medium text-[var(--hud-text-faint)] hover:text-[var(--hud-text)] disabled:opacity-40"
      >
        {documentPlanning ? "Or just teach the whole source →" : "Or let Aria use her judgment →"}
      </button>
    </div>
  );
}


/**
 * The tutor's own live picture of the student, made visible instead of only baked silently into
 * later prompts. Every field here already existed in state (learnerProfile, learnerDepth,
 * sourceScope) — this is purely a rendering surface, so it can only ever show what the diagnostic
 * has genuinely established, never invent structure the conversation hasn't produced yet.
 *
 * conceptMap() (lib/learnerProfile.ts) is the same view masteredConcepts/weakConcepts/
 * prerequisiteGaps/misconceptions already were — grouped by status here rather than re-derived,
 * so a change to how the profile classifies a concept shows up here automatically.
 */
function StudentProfileCard({
  profile,
  depth,
  sourceScope,
}: {
  profile: LearnerProfile | null;
  depth: DepthLevel | null;
  sourceScope: SourceScope;
}) {
  if (!profile) return null;
  const map = conceptMap(profile);
  const groups: { status: ConceptMapEntry["status"]; label: string; dot: string }[] = [
    { status: "mastered", label: "Mastered", dot: "bg-[var(--hud-cyan)]" },
    { status: "weak", label: "Shaky on", dot: "bg-amber-400" },
    { status: "missing", label: "Gap", dot: "bg-rose-400" },
    { status: "misconception", label: "Misconception", dot: "bg-rose-500" },
  ];
  const hasAnyConcepts = map.length > 0;
  const hasSourceInfo = sourceScope.documentLabels.length > 0 || sourceScope.breadth.kind !== "whole" || sourceScope.fidelity === "strict";

  if (!hasAnyConcepts && !profile.teachingHypothesis && !hasSourceInfo && profile.objective === "unknown") return null;

  /*
   * A DASHBOARD, NOT A STACK.
   *
   * This was a single narrow column: depth, then each concept group on its own row, then the
   * hypothesis, then the goal, then the scope chips — each one a full-width band, so reading "what
   * does Aria think of me and what is she about to teach" meant scrolling past the whole thing
   * before reaching the lesson itself.
   *
   * The same facts now sit in three columns that fill the width the page already has: who the
   * student is, what Aria concluded, and what she is drawing from. Nothing was removed; it is the
   * shape that changed, from a list to a panel that can be taken in at once.
   */
  const cells = groups
    .map((group) => ({ ...group, entries: map.filter((entry) => entry.status === group.status) }))
    .filter((group) => group.entries.length > 0);

  return (
    <div
      className="hud-materialize mb-6 overflow-hidden rounded-2xl border border-[var(--hud-line)] bg-white/[0.02]"
      style={{ animationDelay: "0.05s" }}
    >
      <div className="grid gap-px bg-[var(--hud-line)] md:grid-cols-3">
        {/* WHO — the depth dial and the student's own goal. */}
        <div className="bg-[var(--hud-bg-2)] p-4">
          <p className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--hud-cyan)]">Student profile</p>
          {depth && <p className="mt-2 font-display text-xl leading-tight text-[var(--hud-text)]">{DEPTH_NAMES[depth]}</p>}
          {profile.objective !== "unknown" && (
            <p className="mt-2 text-[0.78rem] leading-snug text-[var(--hud-text-faint)]">
              Goal: <span className="text-[var(--hud-text-dim)]">{profile.objective}</span>
            </p>
          )}
          {profile.redirectedFocus && (
            <p className="mt-1 text-[0.78rem] leading-snug text-[var(--hud-text-faint)]">
              Focus: <span className="text-[var(--hud-text-dim)]">{profile.redirectedFocus}</span>
            </p>
          )}
        </div>

        {/* WHAT SHE FOUND — the concept map, the reason the lesson is shaped the way it is. */}
        <div className="bg-[var(--hud-bg-2)] p-4">
          <p className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--hud-text-faint)]">What Aria found</p>
          {cells.length > 0 ? (
            <div className="mt-2 space-y-2">
              {cells.map((group) => (
                <div key={group.status} className="flex items-start gap-2">
                  <span className={`mt-[0.3rem] h-1.5 w-1.5 shrink-0 rounded-full ${group.dot}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <span className="text-[0.64rem] font-semibold uppercase tracking-wide text-[var(--hud-text-faint)]">
                      {group.label}
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {group.entries.map((entry) => (
                        <span
                          key={entry.concept}
                          className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.7rem] text-[var(--hud-text-dim)]"
                        >
                          {entry.concept}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[0.78rem] text-[var(--hud-text-faint)]">Still working that out.</p>
          )}
        </div>

        {/* THE PLAN — the teaching hypothesis, and what it is being drawn from. */}
        <div className="bg-[var(--hud-bg-2)] p-4">
          <p className="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--hud-text-faint)]">Teaching angle</p>
          {profile.teachingHypothesis ? (
            <p className="mt-2 text-[0.8rem] italic leading-relaxed text-[var(--hud-text-dim)]">
              &ldquo;{profile.teachingHypothesis}&rdquo;
            </p>
          ) : (
            <p className="mt-2 text-[0.78rem] text-[var(--hud-text-faint)]">Taking shape as you answer.</p>
          )}
          {hasSourceInfo && (
            <div className="mt-3 flex flex-wrap gap-1">
              <span className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.68rem] text-[var(--hud-text-dim)]">
                {sourceScope.breadth.kind === "whole" ? "Whole source" : sourceScope.breadth.focus}
              </span>
              <span className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.68rem] text-[var(--hud-text-dim)]">
                {sourceScope.fidelity === "strict" ? "Strictly from source" : "Source as reference"}
              </span>
              {sourceScope.documentLabels.map((label) => (
                <span key={label} className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.68rem] text-[var(--hud-text-dim)]">
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The Final Lesson Preview — a synthesized "here's everything about you + here's the plan"
 * moment between drafting the outline and actually building the lecture. Reuses
 * StudentProfileCard verbatim (same data, same component) rather than re-deriving anything: this
 * screen's entire job is to SHOW what planning already produced, not to compute anything new.
 *
 * CONFIRM VS MODIFY, NOT INLINE EDITING HERE. Modify is pure back-navigation to the outline
 * screen — every piece of state (outline, learnerProfile, sourceScope) is still live, so nothing
 * needs to be reconstructed. A second, separate editing surface on this screen would duplicate
 * the outline editor for no requirement that asks for it.
 */
function LessonPreviewState({
  topic,
  outline,
  learnerProfile,
  learnerDepth,
  sourceScope,
  onModify,
  onConfirm,
  voice,
}: {
  topic: string;
  outline: PlanOutline | null;
  learnerProfile: LearnerProfile | null;
  learnerDepth: DepthLevel | null;
  sourceScope: SourceScope;
  onModify: () => void;
  onConfirm: () => void;
  voice: VoiceState;
}) {
  return (
    <section className="relative z-10 min-h-screen w-full bg-[#08090c]">
      <div className="mx-auto flex max-w-3xl items-center justify-between border-b border-[var(--hud-line)] px-6 py-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--hud-text-faint)]">Ready to teach</p>
          <h1 className="mt-1 truncate text-lg font-medium text-[var(--hud-text)]">{topic}</h1>
        </div>
        <VoiceStrip voice={voice} />
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <StudentProfileCard profile={learnerProfile} depth={learnerDepth} sourceScope={sourceScope} />

        {outline && outline.subtopics.length > 0 && (
          <div className="rounded-2xl border border-[var(--hud-line)] bg-white/[0.02] p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--hud-cyan)]">Lesson structure</p>
            <ol className="mt-3 space-y-3">
              {outline.subtopics.map((subtopic, index) => (
                <li key={`${subtopic.title}-${index}`} className="text-sm">
                  <p className="font-medium text-[var(--hud-text)]">
                    {index + 1}. {subtopic.title}
                  </p>
                  <p className="mt-0.5 text-[var(--hud-text-dim)]">{subtopic.caption}</p>
                  {subtopic.reason && (
                    <p className="mt-0.5 text-[0.78rem] italic text-[var(--hud-text-faint)]">{subtopic.reason}</p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onModify}
            className="rounded-md border border-[var(--hud-line)] px-5 py-2.5 text-sm font-medium text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
          >
            Modify
          </button>
          <button onClick={onConfirm} className="hud-btn-primary px-6 py-2.5 text-sm">
            Confirm — start teaching
          </button>
        </div>
      </div>
    </section>
  );
}

function OutlineReviewState({
  topic,
  outline,
  loading,
  error,
  thoughts,
  scopingQuestions,
  angle,
  diagnosticQuestion,
  diagnosticRemark,
  diagnosticBusy,
  onAnswerDiagnostic,
  learnerSummary,
  learnerProfile,
  learnerDepth,
  sourceScope,
  initialAmbiguityQuestions,
  initialPlanningQuestions,
  planningAnswers,
  documentPlanning,
  onChoosePlanningAnswer,
  onSubmitPlanningQuestions,
  onSkipPlanningQuestions,
  onAnswerAmbiguity,
  onRevise,
  onApprove,
  onBack,
  onOutlineChange,
  onRerollAngle,
  voice,
  voiceLines,
  memoryNote,
}: {
  topic: string;
  /** Aria's live session state, owned by LearnPage so it survives into the build screen. */
  voice: VoiceState;
  /** Everything said out loud, by either side — merged into the one transcript below. */
  voiceLines: { role: "you" | "aria"; text: string }[];
  /** What Aria remembers from earlier lessons, said first so the student can correct it. */
  memoryNote: string | null;
  outline: PlanOutline | null;
  loading: boolean;
  error: string | null;
  thoughts: string[];
  /** Scoping questions as they stream in mid-build, one per completed subtopic that got one —
   *  see streamOutlineRequest in LearnPage. Consumed into chat the instant each new one lands,
   *  not batched at the end. */
  scopingQuestions: { subtopicIndex: number; question: string; options: { label: string; instruction: string }[] }[];
  angle: PlanningAngleId;
  /** Rare — seeded into the side chat as the first bubbles when the topic is genuinely
   *  ambiguous. Mutually exclusive with initialPlanningQuestions (see startPlanning). */
  /** The one open question in the pre-lesson conversation, or null when there is nothing to ask. */
  diagnosticQuestion: { question: string; options: string[] } | null;
  /** An occasional teacher-style aside from the diagnostic ("noticing you're solid on X, let's
   *  focus on Y") — seeded as its own chat bubble just before the next question, when present. */
  diagnosticRemark: { text: string; turn: number } | null;
  diagnosticBusy: boolean;
  onAnswerDiagnostic: (answer: string) => void;
  /** "intermediate, skipping gradient descent" — what Aria concluded, in the student's terms. */
  learnerSummary: string;
  /** The full profile/depth, for the live-building StudentProfileCard — learnerSummary above
   *  stays as the terse one-line version used in a couple of narrower spots. */
  learnerProfile: LearnerProfile | null;
  learnerDepth: DepthLevel | null;
  sourceScope: SourceScope;
  initialAmbiguityQuestions: ClarifyQuestion[];
  /** The ONE pre-draft gate, shown in the MAIN CANVAS (not the side chat) — topic-specific
   *  planning questions worth answering before drafting starts. Empty for most topics. */
  initialPlanningQuestions: ScopingQuestion[];
  planningAnswers: Array<{ question: string; label: string; instruction: string; focus?: string | null; fidelity?: PdfFidelity }>;
  documentPlanning: boolean;
  onChoosePlanningAnswer: (question: string, label: string, instruction: string, focus?: string | null, fidelity?: PdfFidelity) => void;
  onSubmitPlanningQuestions: () => void;
  onSkipPlanningQuestions: () => void;
  onAnswerAmbiguity: (question: string, answer: string) => void;
  onRevise: (instruction: string) => Promise<void>;
  onApprove: () => void;
  onBack: () => void;
  onOutlineChange: (outline: PlanOutline) => void;
  onRerollAngle: (angle: PlanningAngleId) => void;
}) {
  const [chatInput, setChatInput] = useState("");
  const [chatLog, setChatLog] = useState<OutlineChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  /*
   * The live session used to live HERE, and that was the bug.
   *
   * This component renders only while phase === "outline", so approving the plan unmounted it and
   * took the session with it — the voice died at exactly the build screen where the student was
   * waiting and most wanted company. It now lives in LearnPage, which spans both screens, and
   * arrives here as props.
   */
  const lastThoughtCountRef = useRef(0);
  const lastScopingCountRef = useRef(0);
  const seededAmbiguityRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Seed the rare ambiguity questions as the FIRST chat bubbles, once — same chip mechanic as
  // scoping questions, no separate gate screen.
  useEffect(() => {
    if (seededAmbiguityRef.current || initialAmbiguityQuestions.length === 0) return;
    seededAmbiguityRef.current = true;
    setChatLog((prev) => [
      ...initialAmbiguityQuestions.map((q): OutlineChatMessage => ({
        role: "aria",
        text: q.question,
        chips: q.options.map((label) => ({ label, instruction: label })),
        isAmbiguity: true,
      })),
      ...prev,
    ]);
  }, [initialAmbiguityQuestions]);

  /*
   * VOICE JOINS THE SAME TRANSCRIPT (lib/planningTranscript.ts).
   *
   * Spoken lines used to appear only as one truncated caption that the next line overwrote. Each
   * one is now a bubble — except Aria speaking the question already on screen, which would print it
   * twice. A spoken answer also marks the open question answered, exactly as a chip would.
   *
   * DECLARED BEFORE the question-seeding effect below, deliberately: effects run in declaration
   * order, and a spoken answer and the question it produces land in the same render. Declared
   * after, the next question was printed above the answer that caused it.
   */
  const seenVoiceCountRef = useRef(0);
  useEffect(() => {
    if (voiceLines.length < seenVoiceCountRef.current) seenVoiceCountRef.current = 0;
    if (voiceLines.length <= seenVoiceCountRef.current) return;
    const fresh = voiceLines.slice(seenVoiceCountRef.current);
    seenVoiceCountRef.current = voiceLines.length;
    setChatLog((prev) => {
      let next = prev;
      for (const line of fresh) {
        if (!shouldAddVoiceLine(next, line)) continue;
        if (line.role === "you") next = next.map((m) => (m.isDiagnostic && !m.answered ? { ...m, answered: true } : m));
        next = [...next, { role: line.role, text: line.text.trim() }];
      }
      return next;
    });
  }, [voiceLines]);

  /*
   * The pre-lesson conversation appears as chat bubbles, in the same place Aria already asks
   * everything else. Deliberately NOT a separate gate screen: this is a teacher asking a question
   * before class, and routing it through a different surface would make it feel like a form.
   *
   * Keyed by question text so re-renders cannot duplicate a bubble, and so a NEW question always
   * seeds even though the previous one is still in the log.
   */
  const seededDiagnosticRef = useRef<string>("");
  const seededRemarkTurnRef = useRef<number>(0);
  useEffect(() => {
    const q = diagnosticQuestion?.question;
    if (!q || seededDiagnosticRef.current === q) return;
    seededDiagnosticRef.current = q;
    // The remark (an occasional teacher-style aside — "noticing you're solid on X, let's focus on
    // Y") is seeded as its OWN bubble immediately before the question bubble it accompanies, in the
    // same update, so it always reads as a lead-in rather than appearing out of order.
    const remarkForThisTurn =
      diagnosticRemark && diagnosticRemark.turn > seededRemarkTurnRef.current ? diagnosticRemark.text : null;
    if (remarkForThisTurn) seededRemarkTurnRef.current = diagnosticRemark!.turn;
    setChatLog((prev) => [
      ...prev,
      ...(remarkForThisTurn ? [{ role: "aria" as const, text: remarkForThisTurn }] : []),
      {
        role: "aria",
        text: q,
        chips: (diagnosticQuestion?.options ?? []).map((label) => ({ label, instruction: label })),
        isDiagnostic: true,
      },
    ]);
  }, [diagnosticQuestion, diagnosticRemark]);

  // Stream Aria's per-subtopic planning reasoning into the chat log as it arrives, instead of a
  // separate floating panel — same underlying data (streamOutlineRequest), one conversation.
  useEffect(() => {
    // A shorter array than last time means a NEW outline stream started (streamOutlineRequest
    // resets thoughts/scopingQuestions to [] per call) — reset the counter so this stream's
    // items aren't skipped as "already seen".
    if (thoughts.length < lastThoughtCountRef.current) lastThoughtCountRef.current = 0;
    if (thoughts.length <= lastThoughtCountRef.current) return;
    lastThoughtCountRef.current = thoughts.length;
    // Not posted as chat bubbles any more. They are the planner's notes to itself ("Needed to
    // establish the foundation…"), and in a conversation they read as Aria muttering half-sentences
    // at the student. Drafting progress still shows under the transcript, and the finished plan is
    // proposed as one message with Accept / Change / Focus.
  }, [thoughts]);

  // Post each scoping question as a chat bubble the INSTANT it streams in — mid-build, while
  // later subtopics are still being drafted. This is the actual "engage during the build" fix:
  // a question about subtopic 2 can appear while subtopic 4 hasn't arrived yet, interleaved
  // with the thoughts above, not held back for a batch review pass on the finished outline.
  useEffect(() => {
    if (scopingQuestions.length < lastScopingCountRef.current) lastScopingCountRef.current = 0;
    if (scopingQuestions.length <= lastScopingCountRef.current) return;
    const fresh = scopingQuestions.slice(lastScopingCountRef.current);
    lastScopingCountRef.current = scopingQuestions.length;
    setChatLog((prev) => [
      ...prev,
      ...fresh.map((q): OutlineChatMessage => ({ role: "aria", text: q.question, chips: q.options })),
    ]);
  }, [scopingQuestions]);

  // What Aria remembers, said first — so a student can say "that's changed" before she relies on it.
  const seededMemoryRef = useRef(false);
  useEffect(() => {
    if (seededMemoryRef.current || !memoryNote) return;
    seededMemoryRef.current = true;
    setChatLog((prev) => [{ role: "aria", text: memoryNote }, ...prev]);
  }, [memoryNote]);

  /*
   * THE PLAN, PROPOSED IN THE CONVERSATION.
   *
   * Once the outline is drafted, Aria says what she understood about the student and what she
   * would teach, and offers Accept / Change / Focus. The full editable outline stays on the page
   * above; this is the moment of agreement, where the student is asked rather than left to find a
   * button. Posted once per drafted plan.
   */
  const postedPlanRef = useRef("");
  useEffect(() => {
    if (!outline || loading || outline.subtopics.length === 0) return;
    const key = outline.subtopics.map((sub) => sub.title).join("|");
    if (postedPlanRef.current === key) return;
    postedPlanRef.current = key;
    setChatLog((prev) => [
      ...prev,
      {
        role: "aria",
        text: planMessage(outline.subtopics.map((sub) => sub.title), learnerSummary),
        chips: [
          { label: PLAN_CHOICES.accept, instruction: "accept" },
          { label: PLAN_CHOICES.change, instruction: "change" },
          { label: PLAN_CHOICES.focus, instruction: "focus" },
        ],
        isPlan: true,
      },
    ]);
  }, [outline, loading, learnerSummary]);

  // Set by "Focus on…": the student's next message names what the lesson should centre on.
  const [awaitingFocus, setAwaitingFocus] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const composerRef = useRef<HTMLInputElement>(null);
  // Bumped when Aria asks the student to type or say something, so the input takes focus. Focus
  // happens in an effect, never from a render-time path.
  const [focusComposer, setFocusComposer] = useState(0);
  useEffect(() => {
    if (focusComposer > 0) composerRef.current?.focus();
  }, [focusComposer]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chatLog]);

  async function sendChat(instruction: string) {
    const trimmed = instruction.trim();
    if (!trimmed || loading || sending) return;
    setChatLog((prev) => [...prev, { role: "you", text: trimmed }]);
    /*
     * While a pre-lesson question is open, what the student types is its ANSWER — there is no
     * outline to revise yet, so sending it down the revise pipeline would fail on an empty outline
     * and lose what they said.
     */
    if (diagnosticQuestion) {
      setChatLog((prev) => prev.map((m) => (m.isDiagnostic && !m.answered ? { ...m, answered: true } : m)));
      onAnswerDiagnostic(trimmed);
      return;
    }
    const request = awaitingFocus ? `Refocus the lesson on this, as the student asked: ${trimmed}` : trimmed;
    setAwaitingFocus(false);
    setSending(true);
    await onRevise(request);
    setSending(false);
    // Success needs no line of its own: the revised plan is proposed as a new message.
    if (error) setChatLog((prev) => [...prev, { role: "aria", text: `Couldn't apply that — ${error}` }]);
  }

  /** A chip click under an Aria question bubble. `isAmbiguity` chips re-draft the outline from
   *  scratch (the answer changes what subject it's even about, via onAnswerAmbiguity); scoping
   *  chips patch the same outline in place via the normal revise pipeline (onRevise). Either
   *  way the source bubble is marked answered so its chips disable without vanishing. */
  function sendChip(bubbleIndex: number, questionText: string, label: string, instruction: string, isAmbiguity: boolean, isDiagnostic = false, isPlan = false) {
    if (sending || loading) return;
    if (isPlan) {
      setChatLog((prev) => prev.map((m, i) => (i === bubbleIndex ? { ...m, answered: true } : m)));
      setChatLog((prev) => [...prev, { role: "you", text: label }]);
      if (instruction === "accept") {
        onApprove();
        return;
      }
      setAwaitingFocus(instruction === "focus");
      setChatLog((prev) => [
        ...prev,
        {
          role: "aria",
          text: instruction === "focus"
            ? "What should the lesson centre on? Say it or type it."
            : "What would you like to change? Say it or type it — add, drop, reorder, or go deeper somewhere.",
        },
      ]);
      setFocusComposer((n) => n + 1);
      return;
    }
    setChatLog((prev) => prev.map((m, i) => (i === bubbleIndex ? { ...m, answered: true } : m)));
    setChatLog((prev) => [...prev, { role: "you", text: label }]);
    if (isDiagnostic) {
      onAnswerDiagnostic(label);
      return;
    }
    if (isAmbiguity) {
      onAnswerAmbiguity(questionText, label);
      return;
    }
    setSending(true);
    onRevise(instruction).then(() => {
      setSending(false);
      if (error) setChatLog((prev) => [...prev, { role: "aria", text: `Couldn't apply that — ${error}` }]);
    });
  }

  /**
   * The one planning conversation: Aria's lines and the student's, spoken or typed, in order.
   *
   * `inline` is the conversation as the main event (while Aria is getting to know the student):
   * tall, in the page. Otherwise it is docked under the plan, shorter, for asking changes.
   */
  /**
   * The docked composer's real height, so the column above can reserve exactly that much.
   *
   * A ResizeObserver rather than a one-off measurement: the composer changes height as the
   * transcript fills, when the voice strip appears, and on viewport resize. Each of those would
   * otherwise re-create the overlap this fixes.
   */
  const dockRef = useRef<HTMLDivElement | null>(null);
  const [dockHeight, setDockHeight] = useState(0);
  useEffect(() => {
    const node = dockRef.current;
    if (!node) {
      setDockHeight(0);
      return;
    }
    const observer = new ResizeObserver(([entry]) => setDockHeight(entry.contentRect.height));
    observer.observe(node);
    setDockHeight(node.getBoundingClientRect().height);
    return () => observer.disconnect();
  }, [outline, diagnosticQuestion, diagnosticBusy]);

  function renderConversation(inline: boolean) {
    return (
      <div
        data-planning-chat
        className={`pointer-events-auto overflow-hidden rounded-2xl border border-[var(--hud-line)] bg-[var(--hud-bg-2)]/95 shadow-2xl backdrop-blur-xl ${inline ? "mt-6" : ""}`}
      >
        {(chatLog.length > 0 || diagnosticBusy) && (
          <div className={`${inline ? "max-h-[55vh] min-h-[16rem]" : "max-h-44"} overflow-y-auto border-b border-[var(--hud-line)] px-4 py-3`}>
            <div className="space-y-2.5">
              {chatLog.map((m, i) => (
                <div key={i} data-chat-role={m.role} className={m.role === "you" ? "text-right" : ""}>
                  <p
                    className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-left leading-snug ${inline ? "text-[15px]" : "text-sm"} ${
                      m.role === "you" ? "bg-[var(--hud-text)] text-[#08090c]" : "bg-white/[0.05] text-[var(--hud-text-dim)]"
                    }`}
                  >
                    {m.text}
                  </p>
                  {m.chips && (
                    <div className="mt-2">
                      <QuickReplyChips
                        options={m.chips.map((c) => c.label)}
                        disabled={m.answered || sending || loading || diagnosticBusy}
                        onSelect={(label) => {
                          const chip = m.chips!.find((c) => c.label === label);
                          if (chip) sendChip(i, m.text, chip.label, chip.instruction, Boolean(m.isAmbiguity), Boolean(m.isDiagnostic), Boolean(m.isPlan));
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
              {(loading || sending || diagnosticBusy) && (
                <p className="text-sm text-[var(--hud-text-faint)]">
                  {diagnosticBusy
                    ? "Aria is thinking…"
                    : sending
                      ? "Updating…"
                      : !outline && thoughts.length > 0
                        ? `Drafting subtopic ${Math.min(thoughts.length + 1, ESTIMATED_SUBTOPICS)} of ~${ESTIMATED_SUBTOPICS}…`
                        : "Planning…"}
                </p>
              )}
              <div ref={chatEndRef} />
            </div>
          </div>
        )}
        <VoiceStrip voice={voice} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendChat(chatInput);
            setChatInput("");
          }}
          className="border-t border-[var(--hud-line)] p-3"
        >
          <div className="flex gap-2">
            <input
              ref={composerRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={awaitingFocus ? "What should the lesson focus on?" : outline ? "Ask Aria to change the lesson…" : "Answer out loud, or type here…"}
              disabled={loading || sending || diagnosticBusy}
              className="min-w-0 flex-1 rounded-lg border border-[var(--hud-line)] bg-transparent px-3 py-2.5 text-sm text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-line-strong)] focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading || sending || diagnosticBusy || !chatInput.trim()}
              className="shrink-0 rounded-lg border border-[var(--hud-line)] px-4 py-2.5 text-sm font-medium text-[var(--hud-text-dim)] hover:text-[var(--hud-text)] disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    );
  }

  function updateSubtopics(next: PlanOutline["subtopics"]) {
    if (!outline) return;
    onOutlineChange({ ...outline, subtopics: next });
  }

  function move(i: number, dir: -1 | 1) {
    if (!outline) return;
    const next = [...outline.subtopics];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    updateSubtopics(next);
  }

  function remove(i: number) {
    if (!outline) return;
    updateSubtopics(outline.subtopics.filter((_, idx) => idx !== i));
  }

  function addBlank() {
    if (!outline) return;
    updateSubtopics([...outline.subtopics, { title: "New subtopic", caption: "" }]);
  }

  function editField(i: number, field: "title" | "caption", value: string) {
    if (!outline) return;
    updateSubtopics(outline.subtopics.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  }

  /** The document-scope gate for an uploaded PDF/PPT ONLY (see shouldPlanDocumentScope) — shown
   *  only while `!outline`, unmounts for good once drafting starts. A typed topic never reaches
   *  this; it goes through the adaptive diagnostic conversation instead (diagnosticQuestion).
   *  Questions here are model-generated and grounded in the actual source document (see
   *  DOCUMENT_SCOPE_SYSTEM_PROMPT), not a fixed generic set. */
  function renderPlanningQuestionsPanel() {
    if (initialPlanningQuestions.length === 0) return null;
    return (
      <PlanningQuestionsCard
        questions={initialPlanningQuestions}
        answers={planningAnswers}
        documentPlanning={documentPlanning}
        loading={loading}
        onChoose={onChoosePlanningAnswer}
        onAllAnswered={onSubmitPlanningQuestions}
        onSkip={onSkipPlanningQuestions}
      />
    );
  }

  return (
    <section className="relative z-10 min-h-screen w-full bg-[#08090c]">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between border-b border-[var(--hud-line)] px-6 py-4 lg:px-10">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--hud-text-faint)]">
            {documentPlanning ? "Plan from your source" : "Lesson outline"}
          </p>
          <h1 className="mt-1 truncate text-lg font-medium text-[var(--hud-text)]">{topic}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowMemory(true)}
            className="rounded-md border border-[var(--hud-line)] px-3 py-2 text-sm text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"
          >
            What Aria remembers
          </button>
          <button onClick={onBack} className="shrink-0 rounded-md border border-[var(--hud-line)] px-4 py-2 text-sm font-medium text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]">
            Back
          </button>
        </div>
      </div>
      {showMemory && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="What Aria remembers about you"
          className="fixed inset-0 z-50 overflow-y-auto bg-black/70 px-6 py-12 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowMemory(false);
          }}
        >
          <div className="mx-auto max-w-lg rounded-2xl border border-[var(--hud-line)] bg-[var(--hud-bg-2)] p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium text-[var(--hud-text)]">What Aria remembers about you</h2>
                <p className="mt-1 text-xs text-[var(--hud-text-faint)]">From earlier lessons. Correct anything that&apos;s wrong before she plans this one.</p>
              </div>
              <button type="button" onClick={() => setShowMemory(false)} className="text-sm text-[var(--hud-text-faint)] hover:text-[var(--hud-text)]">
                Close
              </button>
            </div>
            <LearnerMemoryPanel compact />
          </div>
        </div>
      )}

      {/*
       * ONE COLUMN. The 360px "Plan with Aria" rail is gone.
       *
       * It had become a duplicate: the diagnostic question moved into this column as a real card
       * (it has since become the conversation itself), so the rail was left mirroring the same conversation
       * into a narrow strip beside it — the student read the question large on the left and its
       * echo on the right, and the lesson structure they actually came to look at was squeezed into
       * whatever width was left over.
       *
       * What the rail genuinely owned — the voice session, the transcript, and the "ask for a
       * change" input — is now docked at the bottom of this column, where it belongs: the plan is
       * the page, and talking to Aria is something you do TO the plan rather than beside it.
       */}
      <div className="mx-auto max-w-[1100px]">
        {/*
         * The floating composer is `position: fixed`, so it takes no space in the flow and the
         * column must reserve its height explicitly or the last beats sit underneath it. A fixed
         * `pb-40` was that reservation and it was wrong: the composer grows with the transcript
         * (up to max-h-44) plus the voice strip and the input, ~318px at its tallest against 160px
         * reserved — so roughly 158px of the lesson was covered, which is what the screenshot shows.
         * Measured at runtime instead, with a floor for the first paint before the observer fires.
         */}
        <div className="min-w-0 px-6 pt-8 lg:px-10" style={{ paddingBottom: Math.max(dockHeight + 24, 96) }}>
          <StudentProfileCard profile={learnerProfile} depth={learnerDepth} sourceScope={sourceScope} />
          {!outline && (diagnosticQuestion || diagnosticBusy) ? (
            /*
             * THE CONVERSATION IS THE PAGE while Aria is getting to know the student.
             *
             * This used to be a large question card, with the same question repeated in a small
             * transcript docked below it and Aria's voice asking something else again — three
             * surfaces for one conversation. Now there is one: her questions and the student's
             * answers, spoken or typed, in order, with the quick answers under her question.
             */
            renderConversation(true)
          ) : !outline && initialPlanningQuestions.length > 0 ? (
            renderPlanningQuestionsPanel()
          ) : !outline && initialAmbiguityQuestions.length > 0 ? (
            <p className="text-sm text-[var(--hud-text-dim)]">
              &ldquo;{topic}&rdquo; could mean a few different things — answer the question on the right so Aria drafts the right lesson.
            </p>
          ) : !outline && loading ? (
            <div>
              <p className="text-sm text-[var(--hud-text-dim)]">
                {thoughts.length === 0
                  ? `Thinking about "${topic}"…`
                  : `Drafting subtopic ${Math.min(thoughts.length + 1, ESTIMATED_SUBTOPICS)} of ~${ESTIMATED_SUBTOPICS}…`}
              </p>
              <div className="mt-3 h-1 max-w-xs overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-[var(--hud-cyan)] transition-all duration-500"
                  style={{ width: `${Math.min(100, (thoughts.length / ESTIMATED_SUBTOPICS) * 100)}%` }}
                />
              </div>
            </div>
          ) : outline ? (
            <>
              {/*
                THE LESSON PREVIEW. Once a diagnostic ran, this is the "concise Lesson Preview" the
                student confirms or edits before Phase 2 begins — not a separate screen, but this
                same editable outline framed as what it now is: the co-designed plan that came out
                of the conversation, not just a generic draft. Nothing renders here for a path with
                no diagnostic (a document upload, a revise, a fresh outline with no profile yet) —
                the framing only appears where there is something to frame.
              */}
              {learnerSummary && (
                <div className="mb-6 rounded-md border border-[var(--hud-cyan)]/25 bg-[var(--hud-cyan)]/[0.04] px-4 py-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-[var(--hud-cyan)]">Lesson preview, from what you told Aria</p>
                  <p className="mt-1 text-sm text-[var(--hud-text-dim)]">{learnerSummary}</p>
                  <p className="mt-1.5 text-xs text-[var(--hud-text-faint)]">
                    Edit anything below, or tell Aria in the chat if this should go differently.
                  </p>
                </div>
              )}

              {loading && (
                <div className="mb-6 rounded-md border border-[var(--hud-line)] bg-white/[0.025] px-4 py-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-[var(--hud-text-dim)]">
                      Drafting subtopic {Math.min(outline.subtopics.length + 1, ESTIMATED_SUBTOPICS)} of ~{ESTIMATED_SUBTOPICS}…
                    </p>
                    <p className="text-xs font-medium uppercase tracking-wider text-[var(--hud-text-faint)]">
                      {outline.subtopics.length} visible
                    </p>
                  </div>
                  <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className="h-full rounded-full bg-[var(--hud-cyan)] transition-all duration-500"
                      style={{ width: `${Math.min(100, (outline.subtopics.length / ESTIMATED_SUBTOPICS) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="mb-8">
                <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--hud-text-faint)]">Teaching angle</p>
                <div className="flex flex-wrap gap-1.5">
                  {PLANNING_ANGLES.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => onRerollAngle(a.id)}
                      disabled={loading || sending}
                      className={`rounded-md border px-3 py-1.5 text-xs font-medium transition disabled:opacity-40 ${
                        angle === a.id
                          ? "border-[var(--hud-cyan-deep)] bg-[var(--hud-cyan)]/10 text-[var(--hud-cyan-bright)]"
                          : "border-[var(--hud-line)] text-[var(--hud-text-dim)] hover:border-[var(--hud-line-strong)] hover:text-[var(--hud-text)]"
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>

              {outline.subtopics.some((subtopic) => subtopic.safetyNet) && (
                <div className="mb-7 flex items-center justify-between gap-4 border-y border-[var(--hud-line)] py-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-amber-300">Adaptive route ready</p>
                    <p className="mt-1 text-sm text-[var(--hud-text-dim)]">Prerequisite help stays hidden unless the learner needs it.</p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-[var(--hud-text-faint)]">
                    {outline.subtopics.filter((subtopic) => subtopic.safetyNet).length} safety nets
                  </span>
                </div>
              )}

              <div>
                {outline.subtopics.map((s, i) => (
                  <div key={i} className="group relative flex gap-4">
                    {/* Dependency connector: a thin rail down the left with a node per subtopic,
                        making the teaching order visible as real structure, not just a stacked
                        list. A low-confidence subtopic gets a dashed amber node instead of the
                        default solid one — Aria flagging she genuinely wasn't sure about it. */}
                    <div className="flex w-6 shrink-0 flex-col items-center">
                      <div
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${
                          s.confidence === "low"
                            ? "border-2 border-dashed border-amber-400 bg-transparent"
                            : i === 0
                              ? "border-2 border-[var(--hud-cyan)] bg-[var(--hud-cyan)]"
                              : "border-2 border-[var(--hud-line-strong)] bg-[#08090c]"
                        }`}
                      />
                      {i < outline.subtopics.length - 1 && <div className="w-px flex-1 bg-[var(--hud-line-strong)]" />}
                    </div>

                    <div className="min-w-0 flex-1 pb-7">
                      {i > 0 && (
                        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--hud-text-faint)]">
                          Builds on &ldquo;{outline.subtopics[i - 1].title}&rdquo;
                        </p>
                      )}
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <input
                            value={s.title}
                            onChange={(e) => editField(i, "title", e.target.value)}
                            className="w-full bg-transparent text-base font-medium text-[var(--hud-text)] focus:outline-none"
                          />
                          <input
                            value={s.caption}
                            onChange={(e) => editField(i, "caption", e.target.value)}
                            className="mt-0.5 w-full bg-transparent text-sm text-[var(--hud-text-dim)] focus:outline-none"
                          />
                          {s.reason && <p className="mt-1.5 text-xs text-[var(--hud-text-faint)]">{s.reason}</p>}
                          {s.safetyNet && (
                            <details className="mt-3 border-l-2 border-amber-400/60 pl-3">
                              <summary className="cursor-pointer list-none text-xs font-semibold text-amber-300 marker:content-none">
                                Only if needed: check {s.safetyNet.prerequisite.toLowerCase()}
                              </summary>
                              <div className="mt-3 grid gap-3 text-xs leading-5 sm:grid-cols-2">
                                <div>
                                  <p className="font-semibold uppercase tracking-wide text-[var(--hud-text-faint)]">Readiness check</p>
                                  <p className="mt-1 text-[var(--hud-text-dim)]">&ldquo;{s.safetyNet.diagnostic}&rdquo;</p>
                                </div>
                                <div>
                                  <p className="font-semibold uppercase tracking-wide text-[var(--hud-text-faint)]">If it is shaky</p>
                                  <p className="mt-1 text-[var(--hud-text-dim)]">{s.safetyNet.rescueMove}</p>
                                </div>
                                <div className="sm:col-span-2">
                                  <p className="font-semibold uppercase tracking-wide text-[var(--hud-text-faint)]">Memory echo after {s.safetyNet.reinforceAfter} more {s.safetyNet.reinforceAfter === 1 ? "topic" : "topics"}</p>
                                  <p className="mt-1 text-[var(--hud-text-dim)]">&ldquo;{s.safetyNet.reinforcementPrompt}&rdquo;</p>
                                </div>
                              </div>
                            </details>
                          )}
                          {s.confidence === "low" && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-[11px] font-medium text-amber-400">Aria wasn&apos;t sure about this one</span>
                              <button
                                onClick={() => updateSubtopics(outline.subtopics.map((sub, idx) => (idx === i ? { ...sub, confidence: undefined } : sub)))}
                                className="rounded border border-amber-400/40 px-2 py-0.5 text-[11px] font-medium text-amber-300 hover:bg-amber-400/10"
                              >
                                Confirm it belongs
                              </button>
                              <button
                                onClick={() =>
                                  setChatLog((prev) => [
                                    ...prev,
                                    {
                                      role: "aria",
                                      text: `About "${s.title}" — should I keep it as-is, adjust its depth, or move it elsewhere?`,
                                      chips: [
                                        { label: "Keep as-is", instruction: `Keep the subtopic "${s.title}" exactly as-is and clear any uncertainty about it.` },
                                        { label: "Make it simpler", instruction: `Simplify the subtopic "${s.title}" to a more basic/introductory level.` },
                                        { label: "Move it later", instruction: `Move the subtopic "${s.title}" later in the outline, after more foundational subtopics.` },
                                      ],
                                    },
                                  ])
                                }
                                className="rounded border border-[var(--hud-line-strong)] px-2 py-0.5 text-[11px] font-medium text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"
                              >
                                Ask me about it
                              </button>
                            </div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 hover:!opacity-100">
                          <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-[var(--hud-text-faint)] hover:text-[var(--hud-text)] disabled:opacity-20" aria-label="Move up">▲</button>
                          <button onClick={() => move(i, 1)} disabled={i === outline.subtopics.length - 1} className="rounded p-1 text-[var(--hud-text-faint)] hover:text-[var(--hud-text)] disabled:opacity-20" aria-label="Move down">▼</button>
                          <button onClick={() => remove(i)} className="rounded p-1 text-[var(--hud-text-faint)] hover:text-rose-400" aria-label="Remove">✕</button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={addBlank}
                className="ml-10 rounded-md border border-dashed border-[var(--hud-line)] px-4 py-2 text-sm font-medium text-[var(--hud-text-faint)] transition hover:border-[var(--hud-line-strong)] hover:text-[var(--hud-text)]"
              >
                + Add subtopic
              </button>

              {error && !sending && <p className="mt-6 text-sm text-rose-400">{error}</p>}

              <button
                onClick={onApprove}
                disabled={loading || outline.subtopics.length === 0}
                className="mt-10 w-full rounded-md bg-[var(--hud-text)] py-3 text-sm font-semibold text-[#08090c] transition hover:opacity-90 disabled:opacity-40"
              >
                Build lesson →
              </button>
            </>
          ) : (
            <p className="text-sm text-rose-400">{error ?? "Couldn't plan an outline."}</p>
          )}
        </div>

        {/*
         * THE COMPOSER, DOCKED.
         *
         * Everything the side rail actually owned — the live voice session, the running transcript,
         * and the freeform "change this" input — without the column. It floats over the bottom of
         * the plan so the structure above stays full width and nothing has to be scrolled past to
         * reach it. The transcript is capped and scrolls internally: it is there to confirm what
         * Aria heard, not to be re-read, and the question itself is already on the card above.
         */}
        {!(!outline && (diagnosticQuestion || diagnosticBusy)) && (
          <div ref={dockRef} className="pointer-events-none fixed inset-x-0 bottom-0 z-30">
            <div className="mx-auto max-w-[1100px] px-6 pb-5 lg:px-10">{renderConversation(false)}</div>
          </div>
        )}
      </div>
    </section>
  );
}
