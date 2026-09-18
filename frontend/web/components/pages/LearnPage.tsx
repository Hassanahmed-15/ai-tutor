"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { HudCorners, HudEyebrow, HudButton, type PageName } from "@/components/hud/HudKit";
import { LessonPlayer } from "@/components/LessonPlayer";
import { BlindLessonPlayer } from "@/components/BlindLessonPlayer";
import { LessonDesignMode, type DesignProgress } from "@/components/design/LessonDesignMode";
import { applyDiagnostic, conceptMap, emptyProfile, hasEnoughSignal, learnerInstruction, profileSummary, resolveDepth, DEPTH_NAMES, type ConceptMapEntry, type DepthLevel, type LearnerProfile } from "@/lib/learnerProfile";
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
import { VoicePromptButton } from "@/components/upload/VoicePromptButton";
import { Loader2 } from "lucide-react";
import { isPointingPhrase, subjectFromTranscript } from "@/lib/pdfFocus";
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
  const voiceDocContext = buildDocumentContext(sourceDocument, slideContext, ocrTranscript, fullDocumentText);
  /** Aria's own last spoken line, used as the "question" a spoken student answer is graded
   *  against — see onTranscript below. Voice turn-taking is Gemini Live's own, not gated on
   *  diagnosticQuestion the way the text chat is, so there is no other record of what she just
   *  asked out loud. */
  const lastVoiceQuestionRef = useRef<string>("");

  const planningVoice = useGeminiLiveTutor({
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
        return "The student is now looking at the final lesson summary on screen — tell them briefly what it shows, and building starts once they confirm it there.";
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
      if (phase === "outline" && !hasEnoughSignal(learnerProfileRef.current ?? emptyProfile(topic))) {
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
    onSessionEnded: (reason) => {
      // Surfaced rather than swallowed: a dropped socket and a deliberate stop look identical on
      // screen otherwise, which is what made the idle teardown so hard to see.
      if (reason !== "user") console.warn(`[planning-voice] session ended: ${reason}`);
    },
  });

  const voiceStart = planningVoice.start;
  const voiceStop = planningVoice.stop;

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
      // The worker keeps a running total, so each snapshot replaces the last rather than adding.
      if (typeof snapshot.costUsd === "number") setCost("generation", snapshot.costUsd);
      setProgressivePlannedBeatCount(snapshot.plannedBeatCount);
      setBuildStatus(snapshot.complete
        ? "Lecture saved to your history"
        : snapshot.starterReady
          ? `Playing now · ${snapshot.contiguousReadyCount}/${snapshot.plannedBeatCount} beats ready`
          : `Preparing your opening · ${snapshot.contiguousReadyCount}/${snapshot.plannedBeatCount} beats ready`);
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
  useEffect(() => {
    const savedLecture = takePendingLecture();
    if (savedLecture) {
      openSavedLecture(savedLecture);
      return;
    }
    const brief = takePendingBrief();
    if (!brief) return;

    if (brief.file) {
      // Route through the same handler the on-page picker uses, so PDF/PPTX/JSON parsing, page
      // limits and error reporting stay in exactly one place.
      void ingestFiles([brief.file]);
      if (brief.topic) setInput(brief.topic);
      return;
    }
    if (brief.topic) void startPlanning(brief.topic);
    // Runs once on mount; takePendingBrief() is one-shot so a re-run could not double-fire anyway.
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
          const pages = index === activeSourceIndex && activeOverride ? activeOverride : source.selection.pages;
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
          return { source, data, ok: res.ok, drewRegion: regions.length > 0 };
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
      const subject = (pointing && drewRegion && "Selected region")
        || (pointing && subjectFromTranscript(transcriptText))
        || focus
        || topic.trim()
        || input.trim()
        || primary.data.title
        || "this document";
      setUploadFocus(focus);
      setOcrTranscript(transcriptText);
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
        const results = await Promise.all(
          docFiles.map(async (file) => {
            const pageForm = new FormData();
            pageForm.append("file", file);
            const pageRes = await fetch("/api/document-pages", { method: "POST", body: pageForm });
            const pageData = await pageRes.json().catch(() => ({}));
            return { file, ok: pageRes.ok, data: pageData };
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

  async function callPlanApi(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    planAbortRef.current?.abort();
    const controller = new AbortController();
    planAbortRef.current = controller;
    try {
      const res = await fetch("/api/plan-lesson", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
        body: JSON.stringify(body),
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
    const trimmed = t.trim();
    if (!trimmed) return;
    setTopic(trimmed);
    setInput("");
    setError(null);
    resetPlanning();

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
    setLearnerProfile(emptyProfile(trimmed));
    learnerProfileRef.current = emptyProfile(trimmed);
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

  function backToAsk() {
    planAbortRef.current?.abort();
    resetPlanning();
    setPhase("ask");
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
    const next = { ...merged, codeExamples: shouldIncludeCodeExamples(merged) };
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
    setPhase("preview");
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
  };

  async function build(
    t: string,
    approvedOutline?: PlanOutline,
    fresh?: FreshUpload,
    documentPlanningNotes: string[] = [],
  ) {
    const trimmed = t.trim();
    if (!trimmed) return;
    buildAbortRef.current?.abort();
    const controller = new AbortController();
    buildAbortRef.current = controller;
    setPhase("building");
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
    try {
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
    suggested = { ...suggested, codeExamples: shouldIncludeCodeExamples(suggested) };
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
      ...(focusText ? { focus: focusText } : {}),
      // Sent whichever route the upload took: a deck reaches generation through `context` rather
      // than `suprnotes`, and the passage read from its slides is just as much the subject there.
      ...(transcriptText ? { transcript: transcriptText } : {}),
      ...(approvedOutline ? { outline: approvedOutline } : {}),
      // What lets the model read the pages instead of only a text extraction of them.
      ...(docImagesId ? { documentId: docImagesId } : {}),
      // Absent (defaults to "reference") for a topic with no upload — matches today's existing,
      // unlabeled behavior exactly.
      ...(doc || slides ? { sourceScope: sourceScopeRef.current } : {}),
      learnerProfile: confirmedProfile,
    };

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

  // Fired when a lecture finishes naturally (last beat played) — offers a test on the content.
  // Blind mode forces oral-only (a typed exam is a poor fit for an already voice-first mode);
  // every other mode gets to choose written or oral on the offer screen.
  function onLectureComplete() {
    if (!progressiveComplete) return;
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
      </main>
    );
  }

  if (phase === "test-offer") {
    return (
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
        player = <LessonPlayer beats={beats} title={builtTopic} onExit={endLectureToHome} onComplete={onLectureComplete} onCheckpointGraded={recordCheckpointGrade} mode="deaf" mood={moodString} sourceDocument={sourceDocument} slideContext={slideContext} ocrTranscript={ocrTranscript} documentId={documentId ?? ""} lessonQuestion={uploadFocus} fullDocumentText={fullDocumentText} hasMoreBeats={!progressiveComplete} totalBeatCount={progressivePlannedBeatCount || undefined} onBeatIndexChange={onLectureBeatChange} onLearnerInteraction={captureLearnerInteraction} />;
        break;
      case "demo":
      default:
        // `adhd` is the ONLY difference between the two tracks at this point: same player, same UI,
        // plus the overlay. The gate lives in lib/adhd/gate.ts so this is the one place that asks.
        player = <LessonPlayer beats={beats} title={builtTopic} onExit={endLectureToHome} onComplete={onLectureComplete} onCheckpointGraded={recordCheckpointGrade} mood={moodString} adhd={isAdhdLearner(profile)} sourceDocument={sourceDocument} slideContext={slideContext} ocrTranscript={ocrTranscript} documentId={documentId ?? ""} lessonQuestion={uploadFocus} fullDocumentText={fullDocumentText} hasMoreBeats={!progressiveComplete} totalBeatCount={progressivePlannedBeatCount || undefined} onBeatIndexChange={onLectureBeatChange} onLearnerInteraction={captureLearnerInteraction} />;
    }
    return (
      <div className="relative">
        {player}
        {/*
            The whole lecture's cost, not one stage of it: document, planning, generation, narration,
            questions and the live tutor each report what they measured (lib/costLedger.ts). The old
            badge showed generation alone and said so; that was honest but it was not the cost of
            the lecture — a re-uploaded PDF showed $0.0000 for about a dollar of document reading.
        */}
        <LectureCostBadge
          reused={buildCost?.kind === "cached"}
          demo={buildCost?.kind === "demo"}
          generating={Boolean(progressiveSessionId) && !progressiveComplete}
        />
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
          {pagesLoading ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <Loader2 aria-hidden="true" size={18} className="animate-spin text-[var(--hud-text-faint)]" />
              <p className="text-[0.85rem] text-[var(--hud-text-dim)]">Rendering {label}…</p>
            </div>
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
          onStop={backToAsk}
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
          onBack={backToAsk}
          onOutlineChange={setOutline}
          onRerollAngle={rerollAngle}
          voice={voice}
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
        <section className="hud-canvas hud-grain relative z-10 min-h-screen w-full overflow-y-auto p-6 lg:p-10">
          {/* Masthead. The mode badge and "Change mode" control are gone with mode selection;
              there is no step 1 to return to, so this is a wordmark and a way out. */}
          <div className="relative z-20 mx-auto mb-20 flex max-w-5xl items-baseline justify-between">
            <button
              onClick={() => go("landing")}
              className="font-display text-2xl tracking-[-0.02em] text-[var(--hud-text)] transition-opacity hover:opacity-60"
            >
              Aria
            </button>
            <button
              onClick={() => go("landing")}
              className="text-sm text-[var(--hud-text-dim)] underline decoration-[var(--hud-line-strong)] underline-offset-4 transition-colors hover:text-[var(--hud-text)]"
            >
              Leave
            </button>
          </div>

          <div className="relative z-20 mx-auto max-w-5xl">
            <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr]">
              {/* Main content */}
              <div className="flex flex-col justify-start">
                <div className="mb-12">
                  <h1 className="font-display text-[2.8rem] leading-[0.95] tracking-[-0.035em] sm:text-[4rem]">
                    Name what you do not
                    <br />
                    <span className="text-[var(--hud-text)]">understand.</span>
                  </h1>
                </div>

                {/* Input section */}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (topic && !input.trim()) startPlanning(topic);
                    else startPlanning(input);
                  }}
                  className="mb-6"
                >
                  {/* A ruled line to write on, rather than a pill to fill in. The field is the
                      largest type on the page after the headline, because it is the one thing
                      being asked for. */}
                  <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:gap-4">
                    <input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="the Krebs cycle, properly"
                      autoFocus
                      className="min-w-0 flex-1 border-0 border-b border-[var(--hud-line-strong)] bg-transparent px-0 pb-3 font-display text-2xl tracking-[-0.01em] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] transition-colors focus:border-[var(--hud-cyan)] focus:outline-none focus:ring-0 sm:text-3xl"
                    />
                    <button
                      type="submit"
                      disabled={!(topic || input).trim()}
                      className="hud-btn-primary shrink-0 px-8 py-3.5 text-sm disabled:opacity-30"
                    >
                      Draft the plan
                    </button>
                  </div>
                </form>

                {/* Source upload */}
                <div className="mb-12">
                  <p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-[var(--hud-text-faint)]">Or upload a source</p>

                  {/* Hidden file input. `multiple` lets several PDFs/decks be picked at once — see
                      ingestFiles, which merges them into one source the model reasons over
                      together. A single Suprnotes JSON export still wins outright if picked
                      alongside other files, since it is a complete lesson package on its own. */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pptx,.pdf,.json,application/json"
                    className="sr-only"
                    onChange={handleFileSelect}
                    aria-label="Upload one or more PowerPoint, PDF, or Suprnotes JSON files"
                  />
                  {/* Second, separate hidden input for a task-folder pick — webkitdirectory forces
                      folder-selection mode, so it cannot share the single-file input above. */}
                  <input
                    ref={(el) => {
                      folderInputRef.current = el;
                      if (el) {
                        el.setAttribute("webkitdirectory", "");
                        el.setAttribute("directory", "");
                      }
                    }}
                    type="file"
                    multiple
                    className="sr-only"
                    onChange={handleFolderSelect}
                    aria-label="Upload a task folder containing generated_notes.md, images, and relevant_images.json"
                  />

                  {uploadPhase === "idle" || uploadPhase === "error" ? (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex w-full items-center gap-4 rounded-2xl border border-dashed border-[var(--hud-line)] bg-white/[0.02] px-6 py-5 text-left text-base text-[var(--hud-text-dim)] transition hover:border-[var(--hud-cyan)]/50 hover:bg-white/[0.05] hover:text-[var(--hud-text)]"
                      >
                          <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--hud-line)] bg-white/[0.05] text-xl">📎</span>
                          <span>
                          <span className="block font-bold">Upload .pptx, .pdf, or Suprnotes .json</span>
                          <span className="text-sm text-[var(--hud-text-faint)]">Aria reads your source and builds a lecture from it</span>
                        </span>
                      </button>
                      <div className="flex items-center gap-4 px-6">
                        <button
                          type="button"
                          onClick={() => folderInputRef.current?.click()}
                          className="text-left text-xs font-semibold text-[var(--hud-text-faint)] underline-offset-2 transition hover:text-[var(--hud-cyan)] hover:underline"
                        >
                          or upload a task folder →
                        </button>
                        <span className="text-[var(--hud-text-faint)]/40">·</span>
                        <button
                          type="button"
                          onClick={() => go("viewer")}
                          className="text-left text-xs font-semibold text-[var(--hud-text-faint)] underline-offset-2 transition hover:text-[var(--hud-cyan)] hover:underline"
                        >
                          just want to read it? open in the document viewer →
                        </button>
                      </div>
                    </div>
                  ) : uploadPhase === "reading" ? (
                    <div className="flex items-center gap-4 rounded-2xl border border-[var(--hud-line)] bg-white/[0.02] px-6 py-5">
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-[var(--hud-line)] bg-white/[0.05] text-xl">⏳</span>
                      <span className="text-base font-semibold text-[var(--hud-text-dim)]">Reading slides…</span>
                    </div>
                  ) : (
                    /* uploadPhase === "ready" */
                    <div className="rounded-2xl border border-[var(--hud-cyan)]/30 bg-[var(--hud-cyan)]/[0.04] px-6 py-5">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">📄</span>
                          <div>
                            <p className="font-bold text-[var(--hud-text)]">{uploadedFile?.name}</p>
                            <p className="text-sm text-[var(--hud-text-dim)]">
                              {uploadedFile?.kind === "suprnotes"
                                ? `${uploadedFile.assetCount ?? 0} provided images · ready to build`
                                : uploadedFile?.kind === "task-folder"
                                  ? `Task folder · ${uploadedFile.assetCount ?? 0} image${(uploadedFile.assetCount ?? 0) === 1 ? "" : "s"} extracted · ready to build`
                                  : uploadedFile?.kind === "pdf"
                                    ? `${uploadedFile.slideCount ?? 0} page${(uploadedFile.slideCount ?? 0) === 1 ? "" : "s"} · ${uploadedFile.assetCount ?? 0} image${(uploadedFile.assetCount ?? 0) === 1 ? "" : "s"} extracted · ready to build`
                                    : `${uploadedFile?.slideCount ?? 0} slides extracted${(uploadedFile?.assetCount ?? 0) > 0 ? ` · ${uploadedFile?.assetCount} image${uploadedFile?.assetCount === 1 ? "" : "s"}` : ""} · ready to build`}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={clearUpload}
                          className="shrink-0 rounded-full border border-[var(--hud-line)] px-3 py-1 text-xs font-bold text-[var(--hud-text-faint)] hover:text-[var(--hud-text)]"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )}

                  {uploadPhase === "error" && uploadError && (
                    <p className="mt-2 text-sm font-semibold text-rose-300">⚠️ {uploadError}</p>
                  )}
                </div>

                {/* Popular suggestions */}
                <div>
                  <p className="mb-4 text-xs font-black uppercase tracking-[0.16em] text-[var(--hud-text-faint)]">Popular topics to try</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => startPlanning(s)}
                        className="rounded-2xl border border-[var(--hud-line)] bg-white/[0.03] px-5 py-4 text-left text-base font-semibold text-[var(--hud-text-dim)] transition hover:border-[var(--hud-cyan)]/60 hover:bg-white/[0.08] hover:text-[var(--hud-text)]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Error message */}
                {phase === "error" && error && (
                  <div className="mt-8 rounded-3xl border border-rose-400/40 bg-rose-500/[0.08] px-6 py-5 text-base font-semibold text-rose-200">
                    ⚠️ {error}
                  </div>
                )}
              </div>

              {/* Right sidebar preview */}
              <div className="relative rounded-[2.5rem] border border-[var(--hud-line)]/50 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-8 backdrop-blur-xl lg:h-max lg:sticky lg:top-10">
                <HudCorners accent={selectedMode.accent} />
                <div className="relative z-10 space-y-8">
                  <div>
                    <HudEyebrow color={selectedMode.accent}>Build preview</HudEyebrow>
                  </div>

                  {/* Mode display */}
                  <div className="rounded-2xl border border-[var(--hud-line)] bg-black/30 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--hud-text-faint)]">Mode</p>
                    <p className="mt-3 font-display text-2xl">{selectedMode.name}</p>
                    <p className="mt-2 text-sm font-medium text-[var(--hud-text-dim)]">{selectedMode.detail}</p>
                  </div>

                  {/* Topic display */}
                  <div className="rounded-2xl border border-[var(--hud-line)] bg-black/30 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--hud-text-faint)]">Topic</p>
                    <p className="mt-3 text-2xl font-black text-[var(--hud-text)]">{topic || "Not set yet"}</p>
                    {uploadPhase === "ready" && uploadedFile && (
                      <p className="mt-2 text-xs font-semibold text-[var(--hud-cyan)]">
                        📎 {uploadedFile.kind === "suprnotes"
                          ? `${uploadedFile.assetCount ?? 0} images loaded from notes`
                          : uploadedFile.kind === "task-folder"
                            ? `${uploadedFile.assetCount ?? 0} image${(uploadedFile.assetCount ?? 0) === 1 ? "" : "s"} loaded from folder`
                            : uploadedFile.kind === "pdf"
                              ? `${uploadedFile.slideCount ?? 0} page${(uploadedFile.slideCount ?? 0) === 1 ? "" : "s"} loaded from PDF`
                              : `${uploadedFile.slideCount ?? 0} slides loaded`}
                      </p>
                    )}
                  </div>

                  {/* What you get */}
                  <div className="space-y-3 pt-4">
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-[var(--hud-text-faint)]">Included</p>
                    <div className="space-y-2 text-base text-[var(--hud-text-dim)]">
                      <p className="flex items-center gap-3"><span className="text-lg">✓</span> Teacher script</p>
                      <p className="flex items-center gap-3"><span className="text-lg">✓</span> Hand-drawn visuals</p>
                      <p className="flex items-center gap-3"><span className="text-lg">✓</span> Interactive checkpoints</p>
                      <p className="flex items-center gap-3"><span className="text-lg">✓</span> Full recap</p>
                    </div>
                  </div>

                  {/* Build button */}
                  <button
                    onClick={() => startPlanning(topic)}
                    disabled={!topic.trim()}
                    className="hud-btn-primary w-full rounded-full py-4 text-base font-black disabled:opacity-40"
                  >
                    Plan lesson →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
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

function DiagnosticQuestionCard({
  topic,
  question,
  remark,
  busy,
  onAnswer,
}: {
  topic: string;
  question: { question: string; options: string[] };
  remark: { text: string; turn: number } | null;
  busy: boolean;
  onAnswer: (answer: string) => void;
}) {
  const [draft, setDraft] = useState({ value: "", forQuestion: question.question });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /*
   * Reset the field the moment a NEW question arrives, during render — React's own documented
   * pattern for "state must change immediately when a prop changes" (see lib/usePdfDocument.ts
   * for the same pattern). Compared against `draft.forQuestion`, part of STATE itself, rather
   * than a ref: a ref is not safe to read during render, while state read during its own render
   * always reflects the commit in progress. An effect here would leave one stale frame of the
   * PREVIOUS question's typed text visible before it had a chance to run.
   */
  if (draft.forQuestion !== question.question) {
    setDraft({ value: "", forQuestion: question.question });
  }
  const value = draft.value;
  const setValue = (next: string) => setDraft({ value: next, forQuestion: question.question });

  useEffect(() => {
    textareaRef.current?.focus();
  }, [question.question]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    setValue("");
    onAnswer(trimmed);
  }

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-10 text-center">
      <p className="text-xs font-semibold uppercase tracking-wider text-[var(--hud-text-faint)]">
        Before we plan &ldquo;{topic}&rdquo;
      </p>

      {remark && (
        <p className="mt-4 max-w-lg text-sm italic text-[var(--hud-cyan)]/90">{remark.text}</p>
      )}

      <h2 className="mt-4 max-w-xl text-2xl font-medium leading-snug text-[var(--hud-text)]">
        {question.question}
      </h2>

      {question.options.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              disabled={busy}
              onClick={() => onAnswer(option)}
              className="rounded-full border border-[var(--hud-line-strong)] bg-white/[0.02] px-4 py-2 text-sm font-medium text-[var(--hud-text-dim)] transition hover:border-[var(--hud-cyan)] hover:text-[var(--hud-text)] disabled:opacity-40"
            >
              {option}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 w-full max-w-lg">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={busy}
          rows={2}
          placeholder={question.options.length > 0 ? "Or type your own answer…" : "Type your answer…"}
          className="w-full resize-none rounded-[var(--radius)] border border-[var(--hud-line)] bg-white/[0.02] px-4 py-3 text-sm text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)] focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-[var(--hud-text-faint)]">
            Or just say &ldquo;start&rdquo; and Aria will get going.
          </p>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !value.trim()}
            className="hud-btn-primary px-5 py-2 text-sm disabled:opacity-40"
          >
            {busy ? "Thinking…" : "Answer"}
          </button>
        </div>
      </div>
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

  return (
    <div
      className="hud-materialize mb-4 rounded-2xl border border-[var(--hud-line)] bg-white/[0.02] p-4"
      style={{ animationDelay: "0.05s" }}
    >
      <p className="text-xs font-bold uppercase tracking-wider text-[var(--hud-cyan)]">Student profile</p>

      {depth && (
        <p className="mt-2 text-sm font-medium text-[var(--hud-text)]">{DEPTH_NAMES[depth]}</p>
      )}

      {hasAnyConcepts && (
        <div className="mt-3 flex flex-col gap-2">
          {groups.map((group) => {
            const entries = map.filter((entry) => entry.status === group.status);
            if (!entries.length) return null;
            return (
              <div key={group.status} className="flex items-start gap-2">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${group.dot}`} aria-hidden="true" />
                <div className="min-w-0">
                  <span className="text-[0.68rem] font-semibold uppercase tracking-wide text-[var(--hud-text-faint)]">
                    {group.label}
                  </span>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {entries.map((entry) => (
                      <span
                        key={entry.concept}
                        className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.72rem] text-[var(--hud-text-dim)]"
                      >
                        {entry.concept}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {profile.teachingHypothesis && (
        <p className="mt-3 text-[0.8rem] italic leading-relaxed text-[var(--hud-text-dim)]">
          &ldquo;{profile.teachingHypothesis}&rdquo;
        </p>
      )}

      {profile.objective !== "unknown" && (
        <p className="mt-2 text-[0.75rem] text-[var(--hud-text-faint)]">
          Goal: <span className="text-[var(--hud-text-dim)]">{profile.objective}</span>
        </p>
      )}
      {profile.redirectedFocus && (
        <p className="mt-1 text-[0.75rem] text-[var(--hud-text-faint)]">
          Focus: <span className="text-[var(--hud-text-dim)]">{profile.redirectedFocus}</span>
        </p>
      )}

      {hasSourceInfo && (
        <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--hud-line)] pt-3">
          <span className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.7rem] text-[var(--hud-text-dim)]">
            {sourceScope.breadth.kind === "whole" ? "Whole source" : sourceScope.breadth.focus}
          </span>
          <span className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.7rem] text-[var(--hud-text-dim)]">
            {sourceScope.fidelity === "strict" ? "Strictly from source" : "Source as reference"}
          </span>
          {sourceScope.documentLabels.map((label) => (
            <span key={label} className="rounded-full border border-[var(--hud-line)] px-2 py-0.5 text-[0.7rem] text-[var(--hud-text-dim)]">
              {label}
            </span>
          ))}
        </div>
      )}
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
}: {
  topic: string;
  /** Aria's live session state, owned by LearnPage so it survives into the build screen. */
  voice: VoiceState;
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
    const fresh = thoughts.slice(lastThoughtCountRef.current);
    lastThoughtCountRef.current = thoughts.length;
    setChatLog((prev) => [...prev, ...fresh.map((t): OutlineChatMessage => ({ role: "aria", text: t }))]);
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
      onAnswerDiagnostic(trimmed);
      return;
    }
    setSending(true);
    await onRevise(trimmed);
    setSending(false);
    setChatLog((prev) => [...prev, { role: "aria", text: error ? `Couldn't apply that — ${error}` : "Updated the outline." }]);
  }

  /** A chip click under an Aria question bubble. `isAmbiguity` chips re-draft the outline from
   *  scratch (the answer changes what subject it's even about, via onAnswerAmbiguity); scoping
   *  chips patch the same outline in place via the normal revise pipeline (onRevise). Either
   *  way the source bubble is marked answered so its chips disable without vanishing. */
  function sendChip(bubbleIndex: number, questionText: string, label: string, instruction: string, isAmbiguity: boolean, isDiagnostic = false) {
    if (sending || loading) return;
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
      setChatLog((prev) => [...prev, { role: "aria", text: error ? `Couldn't apply that — ${error}` : "Updated the outline." }]);
    });
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
        <button onClick={onBack} className="shrink-0 rounded-md border border-[var(--hud-line)] px-4 py-2 text-sm font-medium text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]">
          Back
        </button>
      </div>

      <div className="mx-auto grid max-w-[1400px] grid-cols-1 lg:grid-cols-[1fr_360px]">
        {/* Outline canvas */}
        <div className="min-w-0 border-r border-[var(--hud-line)] px-6 py-8 lg:px-10">
          <StudentProfileCard profile={learnerProfile} depth={learnerDepth} sourceScope={sourceScope} />
          {!outline && diagnosticQuestion ? (
            /*
             * THE QUESTION LIVES HERE NOW, LARGE — not as a small chat bubble in a 360px side
             * rail while the main two-thirds of the screen sits empty. That emptiness was the
             * actual complaint: it read as a broken/empty screen rather than a teacher actively
             * working something out with you. The side chat still seeds the same question (for
             * voice context and as a running transcript), but this is the primary place to
             * answer — a real question card, generously sized, with the input right on it.
             */
            <DiagnosticQuestionCard
              topic={topic}
              question={diagnosticQuestion}
              remark={diagnosticRemark}
              busy={diagnosticBusy}
              onAnswer={(answer) => {
                // Mirrored into the side transcript so it still reads as one continuous
                // conversation there, even though this card is now where the answer was typed.
                setChatLog((prev) => [...prev, { role: "you", text: answer }]);
                onAnswerDiagnostic(answer);
              }}
            />
          ) : !outline && diagnosticBusy ? (
            <p className="text-sm text-[var(--hud-text-dim)]">Working out where to start…</p>
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

        {/* Side chat — Aria's live planning reasoning + freeform revise requests, one conversation */}
        <div className="flex h-[calc(100vh-65px)] flex-col lg:sticky lg:top-0">
          <div className="border-b border-[var(--hud-line)] px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--hud-text-faint)]">Plan with Aria</p>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {chatLog.length === 0 && !loading && (
              <p className="text-sm text-[var(--hud-text-faint)]">
                Ask for changes here — &ldquo;also cover streaming responses&rdquo;, &ldquo;make beat 3 more advanced&rdquo;, &ldquo;add the common mistake students make&rdquo;.
              </p>
            )}
            <div className="space-y-3">
              {chatLog.map((m, i) => (
                <div key={i} className={m.role === "you" ? "text-right" : ""}>
                  <p
                    className={`inline-block max-w-[90%] rounded-md px-3 py-2 text-left text-sm leading-snug ${
                      m.role === "you" ? "bg-[var(--hud-text)] text-[#08090c]" : "bg-white/[0.04] text-[var(--hud-text-dim)]"
                    }`}
                  >
                    {m.text}
                  </p>
                  {m.chips && (
                    <div className="mt-2">
                      <QuickReplyChips
                        options={m.chips.map((c) => c.label)}
                        disabled={m.answered || sending || loading}
                        onSelect={(label) => {
                          const chip = m.chips!.find((c) => c.label === label);
                          if (chip) sendChip(i, m.text, chip.label, chip.instruction, Boolean(m.isAmbiguity), Boolean(m.isDiagnostic));
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
              {(loading || sending) && (
                <p className="text-sm text-[var(--hud-text-faint)]">
                  {sending ? "Updating…" : !outline && thoughts.length > 0 ? `Drafting subtopic ${Math.min(thoughts.length + 1, ESTIMATED_SUBTOPICS)} of ~${ESTIMATED_SUBTOPICS}…` : "Planning…"}
                </p>
              )}
            </div>
            <div ref={chatEndRef} />
          </div>
          {/* Aria is already talking by the time this screen appears; this reports her state and
              offers the way out. A microphone that opened on its own must at minimum be visible
              and mutable, or it is something done TO the student rather than for them. */}
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
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask Aria to change the outline…"
                disabled={loading || sending}
                className="min-w-0 flex-1 rounded-md border border-[var(--hud-line)] bg-transparent px-3 py-2 text-sm text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-line-strong)] focus:outline-none"
              />
              <button
                type="submit"
                disabled={loading || sending || !chatInput.trim()}
                className="shrink-0 rounded-md border border-[var(--hud-line)] px-3 py-2 text-sm font-medium text-[var(--hud-text-dim)] hover:text-[var(--hud-text)] disabled:opacity-40"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
