"use client";

import React, { useEffect, useRef, useState } from "react";
import { HudCorners, HudEyebrow, HudButton, type PageName } from "@/components/hud/HudKit";
import { LessonPlayer } from "@/components/LessonPlayer";
import { BlindLessonPlayer } from "@/components/BlindLessonPlayer";
import { AdhdLessonPlayer } from "@/components/AdhdLessonPlayer";
import { useAuth } from "@/components/auth/AuthGate";
import { trackForProfile, isAdhdLearner } from "@/lib/adhd/gate";
import { DyslexiaLessonPlayer } from "@/components/DyslexiaLessonPlayer";
import { TestWrittenView } from "@/components/TestWrittenView";
import { TestOralView } from "@/components/TestOralView";
import { TestResultsView } from "@/components/TestResultsView";
import { type TrackMeta } from "@/components/hud/tracks";
import { getSpeechRecognition, type SpeechRecognitionLike } from "@/lib/speech";
import { takePendingBrief } from "@/lib/pendingBrief";
import { PageSelector, type DocumentPage, type PageSelection } from "@/components/upload/PageSelector";
import type { Beat } from "@/lib/lessonContent";
import { DEMO_HARDCODED, demoLectureBeats, demoLectureTopic } from "@/lib/demo/demoLecture";
import type { TestBank, TestGradeResult } from "@/lib/testPrompt";
import { buildLessonInputFromMarkdown, relevantImageKeys, assetKey, type UploadedImage } from "@/lib/markdownSource";

/**
 * The "teach me anything" entry. After the user picks a mode, this asks what they want to
 * learn, generates a full demo-shaped lecture for that topic (/api/generate-lecture), then
 * mounts the same LessonPlayer used by the curated demo. Hud-styled chat-style intro.
 */
const SUGGESTIONS = ["How vaccines work", "Why the sky is blue", "How a black hole forms", "Supply and demand", "How memory works"];

type ModeId = TrackMeta["id"];
// Midpoint of OUTLINE_LESSON_SYSTEM_PROMPT's "5-9 subtopics" — used only to give the live
// drafting progress bar a denominator; the real count may land a little above or below this,
// which is fine since the bar just needs to feel like real progress, not be exact.
const ESTIMATED_SUBTOPICS = 7;
type PlanningAngleId = "standard" | "historical" | "first-principles" | "failure-case" | "analogy";
const PLANNING_ANGLES: { id: PlanningAngleId; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "historical", label: "Historical" },
  { id: "first-principles", label: "First principles" },
  { id: "failure-case", label: "Through a failure" },
  { id: "analogy", label: "Through an analogy" },
];
const BUILD_STEERING_QUESTIONS = [
  {
    question: "Should I spend extra time on the mechanism?",
    options: [
      { label: "Go deeper", note: "The student chose deeper technical mechanism explanations during build." },
      { label: "Keep it crisp", note: "The student chose concise mechanism explanations during build." },
    ],
  },
  {
    question: "Should I include the common trap?",
    options: [
      { label: "Add the trap", note: "The student wants a Mistake Ambush/common misconception included during the lecture." },
      { label: "Skip traps", note: "The student prefers not to spend extra time on misconception traps." },
    ],
  },
  {
    question: "What should Aria use when things get hard?",
    options: [
      { label: "Real example", note: "When the topic gets difficult, use a concrete real-world example." },
      { label: "Quick check", note: "When the topic gets difficult, use a short active recall check." },
      { label: "Analogy", note: "When the topic gets difficult, use a compact analogy." },
    ],
  },
] as const;
type ScopingQuestion = { question: string; options: { label: string; instruction: string }[] };
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
  context?: string;
  diagramHints?: string;
  slideImages?: Array<{ slide: number; descriptions: string[] }>;
  suprnotes?: unknown;
  outline?: PlanOutline;
};
export function LearnPage({ go, onExit }: { go: (p: PageName) => void; onExit: () => void }) {
  const [topic, setTopic] = useState("");
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<
    "ask" | "outline" | "building" | "teaching" | "test-offer" | "test-written" | "test-oral" | "test-results" | "error"
  >("ask");
  const [beats, setBeats] = useState<Beat[]>([]);
  const [builtTopic, setBuiltTopic] = useState("");
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState("Writing the lecture script and boards");
  const [buildSteeringActive, setBuildSteeringActive] = useState(false);
  const [buildSteeringChoices, setBuildSteeringChoices] = useState<string[]>([]);
  const buildSteeringNotesRef = useRef<string[]>([]);
  const buildSteeringResolveRef = useRef<(() => void) | null>(null);

  // Interactive planning: ONE pre-draft gate in the main canvas (ambiguity questions if the
  // topic is genuinely ambiguous, OR topic-specific planning questions if there are real
  // pre-draft decisions worth asking about — never both, see startPlanning). Once resolved (or
  // there's nothing to ask), the outline drafts live and a side chat takes over for mid-build
  // scoping questions + freeform revise.
  const [initialAmbiguityQuestions, setInitialAmbiguityQuestions] = useState<ClarifyQuestion[]>([]);
  const [initialPlanningQuestions, setInitialPlanningQuestions] = useState<ScopingQuestion[]>([]);
  const [planningAnswers, setPlanningAnswers] = useState<{ question: string; label: string; instruction: string }[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<{ question: string; answer: string }[]>([]);
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
  const [uploadPhase, setUploadPhase] = useState<"idle" | "reading" | "choosing" | "ready" | "error">("idle");
  // Page-selection state. Only ever populated for PDFs; every other upload path skips it entirely.
  const [pendingPdf, setPendingPdf] = useState<File | null>(null);
  const [documentPages, setDocumentPages] = useState<DocumentPage[]>([]);
  const [pagesLoading, setPagesLoading] = useState(false);
  // True while the CHOSEN pages are being parsed — keeps the selection screen up instead of
  // falling back to the capture form.
  const [parsingPages, setParsingPages] = useState(false);
  const [pagesUnavailable, setPagesUnavailable] = useState<string | null>(null);
  const [pageSelection, setPageSelection] = useState<PageSelection>({ pages: [], prompt: "" });
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
   * `profile.accessibility === "adhd"` in Cosmos still got the standard lecture. The value was
   * being written at onboarding and read by nothing.
   *
   * `trackForProfile` is the single place that maps a profile to a track (lib/adhd/gate.ts), so the
   * two vocabularies cannot drift apart. It still supplies the `mood` string handed to lecture
   * generation, so the ADHD track also changes the prompt the pipeline receives — which is intended.
   */
  const { profile } = useAuth();
  const selectedMode = trackForProfile(profile);

  useEffect(() => {
    return () => {
      buildAbortRef.current?.abort();
      planAbortRef.current?.abort();
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
    const brief = takePendingBrief();
    if (!brief) return;

    if (brief.file) {
      // Route through the same handler the on-page picker uses, so PDF/PPTX/JSON parsing, page
      // limits and error reporting stay in exactly one place.
      void ingestFile(brief.file);
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
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset file input so the same file can be re-selected if needed
    e.target.value = "";
    await ingestFile(file);
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
   * The student's prompt is folded into the topic rather than sent as a separate field: the
   * planning pipeline already takes a topic string, and threading a second "focus" parameter
   * through plan and generation would change several contracts for something a sentence conveys.
   */
  async function parseSelectedPages() {
    const file = pendingPdf;
    if (!file) return;
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
      const fd = new FormData();
      fd.append("file", file);
      if (pageSelection.pages.length > 0) fd.append("pages", pageSelection.pages.join(","));
      const res = await fetch("/api/parse-pdf", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.sourceDocument) {
        throw new Error(data.error || "Couldn't read the PDF. Make sure it's a valid .pdf file.");
      }
      setUploadedFile({
        name: file.name,
        slideCount: Array.isArray(data.pagesUsed) ? data.pagesUsed.length : data.pageCount ?? 0,
        kind: "pdf",
        assetCount: data.assetCount ?? 0,
      });
      setSourceDocument(data.sourceDocument);

      const focus = pageSelection.prompt.trim();
      const subject = focus || topic.trim() || input.trim() || data.title || "this document";
      setPendingPdf(null);
      setDocumentPages([]);
      setParsingPages(false);
      setUploadPhase("ready");

      /**
       * Go straight to building. The student has already said what they want twice — by choosing
       * pages and by writing a prompt — so presenting an outline to approve asks a third time for
       * information already given, and the outline is drafted from the document anyway.
       *
       * autoPlannedRef is set here so the upload-watching effect does not also fire; forceBuild
       * skips the outline without depending on setUploadedFile having flushed first.
       */
      autoPlannedRef.current = true;
      void startPlanning(subject, true);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not read that file.");
      setParsingPages(false);
      setUploadPhase("error");
    }
  }

  async function ingestFile(file: File) {
    setUploadPhase("reading");
    setUploadError(null);
    setSlideContext("");
    setDiagramHints("");
    setSlideImages([]);
    setUploadedFile(null);
    setSourceDocument(null);

    try {
      if (file.name.toLowerCase().endsWith(".json") || file.type === "application/json") {
        const text = await file.text();
        const parsed = JSON.parse(text) as Record<string, unknown>;
        const lesson = parsed.lesson && typeof parsed.lesson === "object" ? parsed.lesson as Record<string, unknown> : {};
        const title = typeof lesson.title === "string" && lesson.title.trim() ? lesson.title.trim() : file.name.replace(/\.json$/i, "");
        const assetCount = Array.isArray(parsed.assets) ? parsed.assets.length : 0;
        const blockCount = Array.isArray(parsed.contentBlocks) ? parsed.contentBlocks.length : 0;
        if (!blockCount && !assetCount) {
          throw new Error("That JSON does not look like a Suprnotes lesson export. It needs contentBlocks or assets.");
        }
        setSourceDocument(parsed);
        setUploadedFile({ name: file.name, kind: "suprnotes", assetCount });
        setSlideContext("");
        setDiagramHints("");
        setSlideImages([]);
        setInput(title);
        setTopic(title);
        setUploadPhase("ready");
        return;
      }

      if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
        /**
         * A PDF stops here to let the student choose pages, instead of parsing immediately.
         *
         * Thumbnails are cheap (~0.3s, a few hundred KB) and the full parse is not — 25s and real
         * money for a 7-page paper, far more for a textbook chapter. Rendering previews first means
         * the expensive pass runs once, over the pages the student actually wants, rather than over
         * everything and then again if they narrow it down.
         *
         * If previews are unavailable — no Python renderer on this server — the selector says so
         * and parsing the whole document remains one click away, which is the old behaviour.
         */
        setPendingPdf(file);
        setPagesLoading(true);
        setUploadPhase("choosing");
        const pageForm = new FormData();
        pageForm.append("file", file);
        const pageRes = await fetch("/api/document-pages", { method: "POST", body: pageForm });
        const pageData = await pageRes.json().catch(() => ({}));
        setPagesLoading(false);
        if (pageData?.kind === "pages" && Array.isArray(pageData.pages)) {
          setDocumentPages(pageData.pages);
          setPagesUnavailable(null);
        } else {
          setDocumentPages([]);
          setPagesUnavailable(pageData?.reason ?? "Page previews are unavailable.");
        }
        return;
      }

      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/parse-pptx", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.topic) {
        throw new Error(data.error || "Couldn't read the presentation. Make sure it's a valid .pptx file.");
      }
      setUploadedFile({ name: file.name, slideCount: data.slideCount ?? 0, kind: "pptx", assetCount: data.assetCount ?? 0 });
      setSlideContext(data.fullText ?? "");
      setDiagramHints(data.diagramHints ?? "");
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
    await streamOutlineRequest({ mode: "outline", topic: t, clarifications, angle, sourceDocument }, t);
  }

  /** "Teach it differently" — rerolls the entire outline through a different pedagogical angle
   *  instead of the default structure, so the same topic can produce a genuinely different lesson. */
  function rerollAngle(angle: PlanningAngleId) {
    setPlanAngle(angle);
    streamOutlineRequest({ mode: "outline", topic, clarifications: clarifyAnswers, angle, sourceDocument }, topic);
  }

  // Structured uploads already carry an explicit source-grounded lesson plan. Re-planning them
  // here can reorder or omit source material, so they skip directly to lecture generation.
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
   * A caller that has just parsed a document already KNOWS there is a source and should not
   * depend on React having committed that state first — the failure mode is a document upload
   * landing on the outline screen, which is exactly what it is meant to bypass.
   */
  async function startPlanning(t: string, forceBuild = false) {
    const trimmed = t.trim();
    if (!trimmed) return;
    setTopic(trimmed);
    setInput("");
    setError(null);
    resetPlanning();

    if (forceBuild || shouldSkipPlanning()) {
      build(trimmed, undefined, forceBuild);
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
    if (data && Array.isArray(data.planningQuestions) && data.planningQuestions.length > 0) {
      // Not ambiguous, but has real topic-specific planning decisions worth asking first.
      setInitialPlanningQuestions(data.planningQuestions as ScopingQuestion[]);
      return;
    }
    // Nothing to ask — start drafting immediately, no gate.
    requestOutline(trimmed, []);
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
  function choosePlanningAnswer(question: string, label: string, instruction: string) {
    setPlanningAnswers((prev) => [...prev.filter((a) => a.question !== question), { question, label, instruction }]);
  }

  /** All planning questions answered — fold them into clarifyAnswers (same grounding mechanism
   *  ambiguity answers use) and start the first draft. */
  function submitPlanningQuestions() {
    const next = [...clarifyAnswers, ...planningAnswers.map((a) => ({ question: a.question, answer: `${a.label}: ${a.instruction}` }))];
    setClarifyAnswers(next);
    setInitialPlanningQuestions([]);
    setPlanningAnswers([]);
    requestOutline(topic, next, planAngle);
  }

  /** "Use your judgment" — explicit skip past the planning-question panel straight to drafting. */
  function skipPlanningQuestions() {
    setInitialPlanningQuestions([]);
    setPlanningAnswers([]);
    requestOutline(topic, clarifyAnswers, planAngle);
  }

  async function reviseOutline(instruction: string) {
    if (!outline || !instruction.trim()) return;
    await streamOutlineRequest({ mode: "revise", outline, instruction: instruction.trim(), sourceDocument }, outline.topic);
  }

  function backToAsk() {
    planAbortRef.current?.abort();
    resetPlanning();
    setPhase("ask");
  }

  function approveOutline() {
    build(topic, outline ?? undefined);
  }

  function chooseBuildSteering(label: string, note: string) {
    if (!buildSteeringActive) return;
    if (!buildSteeringNotesRef.current.includes(note)) {
      buildSteeringNotesRef.current = [...buildSteeringNotesRef.current, note];
    }
    setBuildSteeringChoices((prev) => (prev.includes(label) ? prev : [...prev, label]));
    setBuildStatus(`Noted: ${label}`);
  }

  function continueBuildSteering() {
    if (!buildSteeringActive) return;
    buildSteeringResolveRef.current?.();
    buildSteeringResolveRef.current = null;
  }

  function waitForBuildSteering(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      buildSteeringResolveRef.current = resolve;
      signal.addEventListener(
        "abort",
        () => {
          buildSteeringResolveRef.current = null;
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true }
      );
    });
  }

  /**
   * @param forceSkipSteering Bypass the build-time steering prompt.
   *
   * Same reason as startPlanning's forceBuild: shouldSkipPlanning() reads `uploadedFile`, which a
   * caller that has just parsed a document sets in the same tick. Without this the steering panel
   * opens and waits for a click that a document upload should never have been asked for — the
   * lecture simply stops, with parse-pdf having returned 200 and nothing in the log.
   */
  async function build(t: string, approvedOutline?: PlanOutline, forceSkipSteering = false) {
    const trimmed = t.trim();
    if (!trimmed) return;
    buildAbortRef.current?.abort();
    const controller = new AbortController();
    buildAbortRef.current = controller;
    setPhase("building");
    setError(null);
    setCostUsd(null);
    setBeats([]);
    setBuiltTopic("");
    setBuildStatus("Choosing the teaching route");
    setBuildSteeringChoices([]);
    buildSteeringNotesRef.current = [];

    // Structured uploads (PDF/PPT/task-folder/notes) must teach their source AS-IS — no planning and
    // no build-time steering choices. Only typed prompts get the steering step. This is why a PDF was
    // still showing "planning options" even though the outline step was already skipped.
    if (!forceSkipSteering && !shouldSkipPlanning()) {
      setBuildSteeringActive(true);
      try {
        await waitForBuildSteering(controller.signal);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        throw err;
      } finally {
        setBuildSteeringActive(false);
      }
    }

    const buildSteeringNotes = buildSteeringNotesRef.current;
    const buildSteeringLine = buildSteeringNotes.length
      ? ` Build-time student steering: ${buildSteeringNotes.join(" ")}`
      : " Build-time student steering: no extra preference selected, use best judgment.";

    // DEMO MODE: only bypass the API for plain topic demos. Uploaded sources must always exercise
    // the real generation path, otherwise Suprnotes/PPTX changes never show up in the lecture.
    if (DEMO_HARDCODED && !sourceDocument && !slideContext) {
      setBuildStatus("Applying your steering choices");
      setBeats(demoLectureBeats);
      setBuiltTopic(demoLectureTopic);
      setCostUsd(0);
      // A short delay so the "building" screen shows briefly, then reveal — feels responsive/real.
      setTimeout(() => setPhase("teaching"), 500);
      return;
    }

    setBuildStatus(sourceDocument ? `Building from your uploaded ${uploadedFile?.kind === "pdf" ? "PDF" : uploadedFile?.kind === "pptx" ? "presentation" : "source"}` : "Writing the lecture script and boards");

    const payload: LecturePayload = {
      topic: trimmed,
      mood: `${selectedMode.name} learning mode: ${selectedMode.detail}.${buildSteeringLine}`,
      ...(sourceDocument ? { suprnotes: sourceDocument } : slideContext ? { context: slideContext, diagramHints, slideImages } : {}),
      ...(approvedOutline ? { outline: approvedOutline } : {}),
    };

    try {
      const useFixture = process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_USE_FIXTURE === "1";

      const res = await fetch(useFixture ? "/api/generate-lecture-debug" : "/api/generate-lecture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.beats)) {
        throw new Error(data.error || "Couldn't build that lecture. Try a different topic.");
      }
      setBeats(data.beats);
      setBuiltTopic(data.topic ?? trimmed);
      if (typeof data.costUsd === "number") setCostUsd(data.costUsd);
      setPhase("teaching");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Generation failed.");
      setPhase("error");
    }
  }

  // Fired when a lecture finishes naturally (last beat played) — offers a test on the content.
  // Blind mode forces oral-only (a typed exam is a poor fit for an already voice-first mode);
  // every other mode gets to choose written or oral on the offer screen.
  function onLectureComplete() {
    setPhase("test-offer");
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

  function backToLectureFromTest() {
    setTestBank(null);
    setTestResults(null);
    setTestAnswers(undefined);
    setTestError(null);
    onExit();
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
        onSkip={onExit}
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
        player = <BlindLessonPlayer beats={beats} title={builtTopic} onExit={onExit} onComplete={onLectureComplete} autoStart />;
        break;
      case "adhd-demo":
        player = <AdhdLessonPlayer beats={beats} title={builtTopic} onExit={onExit} onComplete={onLectureComplete} mood={moodString} />;
        break;
      case "dyslexia-demo":
        player = <DyslexiaLessonPlayer beats={beats} title={builtTopic} onExit={onExit} onComplete={onLectureComplete} />;
        break;
      case "deaf-demo":
        player = <LessonPlayer beats={beats} title={builtTopic} onExit={onExit} onComplete={onLectureComplete} mode="deaf" mood={moodString} />;
        break;
      case "demo":
      default:
        // `adhd` is the ONLY difference between the two tracks at this point: same player, same UI,
        // plus the overlay. The gate lives in lib/adhd/gate.ts so this is the one place that asks.
        player = <LessonPlayer beats={beats} title={builtTopic} onExit={onExit} onComplete={onLectureComplete} mood={moodString} adhd={isAdhdLearner(profile)} />;
    }
    return (
      <div className="relative">
        {player}
        {costUsd !== null && (
          <div className="pointer-events-none absolute left-0 right-0 top-0 z-[60] flex justify-center pt-2">
            <div className="hud-eyebrow flex items-center gap-1.5 rounded-full border border-[var(--hud-line-strong)] bg-black/70 px-3.5 py-1.5 text-[0.65rem] backdrop-blur-md">
              <span className="text-[var(--hud-text-faint)] normal-case tracking-normal font-semibold">This lecture cost</span>
              <span className="text-[var(--hud-cyan)]">${costUsd.toFixed(4)}</span>
            </div>
          </div>
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
   * Thumbnails need room to be recognisable — a page shrunk into a sidebar card is a grey
   * rectangle — and this is a real decision point in the flow, not a setting. It sits before the
   * outline step and after upload, so it reads as "which parts of this document?" followed by
   * "here is the plan".
   */
  if (uploadPhase === "choosing" || parsingPages) {
    return (
      <main className="hud-canvas hud-grain relative flex h-screen flex-col overflow-hidden text-[var(--hud-text)]">
        <header
          className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-5 py-3"
          style={{ borderColor: "var(--hud-line)" }}
        >
          <div className="min-w-0">
            <p className="text-[0.72rem] text-[var(--hud-text-faint)]">Uploaded</p>
            <h1 className="truncate text-[0.95rem] font-medium">{pendingPdf?.name ?? "Document"}</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setPendingPdf(null);
                setDocumentPages([]);
                setUploadPhase("idle");
              }}
              className="text-sm text-[var(--hud-text-dim)] transition-colors hover:text-[var(--hud-text)]"
            >
              Cancel
            </button>
            <button
              onClick={parseSelectedPages}
              disabled={pagesLoading || parsingPages}
              className="hud-btn-primary px-6 py-2.5 text-sm disabled:opacity-40"
            >
              {parsingPages
                ? "Reading those pages…"
                : pageSelection.pages.length > 0
                  ? `Use ${pageSelection.pages.length} page${pageSelection.pages.length === 1 ? "" : "s"}`
                  : "Use all pages"}
            </button>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[1fr_26rem]">
          {/* A large preview of the first selected page, so the grid stays scannable while the
              student can still read what they picked. */}
          <section className="hidden min-h-0 items-center justify-center overflow-hidden p-6 lg:flex">
            {(() => {
              const focus = pageSelection.pages[0] ?? documentPages[0]?.pageNumber;
              const page = documentPages.find((p) => p.pageNumber === focus);
              if (!page) {
                return (
                  <p className="max-w-sm text-center text-[0.9rem] leading-relaxed text-[var(--hud-text-dim)]">
                    Choose the pages Aria should teach from, or continue to use the whole document.
                  </p>
                );
              }
              return (
                // eslint-disable-next-line @next/next/no-img-element -- data: URI, no host to optimise
                <img
                  src={page.thumbnail}
                  alt={`Page ${page.pageNumber}`}
                  className="max-h-full max-w-full rounded-[var(--radius)] border bg-white object-contain"
                  style={{ borderColor: "var(--hud-line)" }}
                />
              );
            })()}
          </section>

          <div className="min-h-0 border-l" style={{ borderColor: "var(--hud-line)" }}>
            <PageSelector
              pages={documentPages}
              loading={pagesLoading}
              unavailableReason={pagesUnavailable}
              label="pages"
              onChange={setPageSelection}
            />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="hud-canvas hud-grain relative min-h-screen overflow-x-hidden text-[var(--hud-text)]">
      {phase === "building" ? (
        <BuildingState
          topic={topic}
          mode={selectedMode.name}
          status={buildStatus}
          steeringActive={buildSteeringActive}
          choices={buildSteeringChoices}
          // The planner's own questions, grounded in this topic and any uploaded document.
          questions={initialPlanningQuestions.map((q) => ({
            question: q.question,
            options: q.options.map((o) => ({ label: o.label, note: o.instruction })),
          }))}
          onChoose={chooseBuildSteering}
          onContinue={continueBuildSteering}
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
          initialAmbiguityQuestions={initialAmbiguityQuestions}
          initialPlanningQuestions={initialPlanningQuestions}
          planningAnswers={planningAnswers}
          onChoosePlanningAnswer={choosePlanningAnswer}
          onSubmitPlanningQuestions={submitPlanningQuestions}
          onSkipPlanningQuestions={skipPlanningQuestions}
          onAnswerAmbiguity={answerAmbiguity}
          onRevise={reviseOutline}
          onApprove={approveOutline}
          onBack={backToAsk}
          onOutlineChange={setOutline}
          onRerollAngle={rerollAngle}
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

                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pptx,.pdf,.json,application/json"
                    className="sr-only"
                    onChange={handleFileSelect}
                    aria-label="Upload PowerPoint, PDF, or Suprnotes JSON file"
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
                      <button
                        type="button"
                        onClick={() => folderInputRef.current?.click()}
                        className="w-full px-6 text-left text-xs font-semibold text-[var(--hud-text-faint)] underline-offset-2 transition hover:text-[var(--hud-cyan)] hover:underline"
                      >
                        or upload a task folder →
                      </button>
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

/** The "building your lecture" state — now with a brief steering window before the generation
 *  request is sent, so answers actually influence the prompt instead of being decorative. */
function BuildingState({
  topic,
  mode,
  status,
  steeringActive,
  choices,
  questions,
  onChoose,
  onContinue,
}: {
  topic: string;
  mode: string;
  status: string;
  steeringActive: boolean;
  choices: string[];
  /** Topic-specific questions from the planner. Empty falls back to the generic set. */
  questions?: { question: string; options: { label: string; note: string }[] }[];
  onChoose: (label: string, note: string) => void;
  onContinue: () => void;
}) {
  /**
   * Prefer the planner's questions over the hardcoded ones.
   *
   * BUILD_STEERING_QUESTIONS asks the same three things about every subject — "should I spend
   * extra time on the mechanism?" is a reasonable question about enzyme kinetics and a meaningless
   * one about the causes of the French Revolution. /api/plan-lesson already generates questions
   * grounded in the actual topic (and in an uploaded document, when there is one); they were
   * fetched but never reached this screen, so the generic set was what students always saw.
   *
   * The hardcoded set remains as a fallback for when planning is skipped or returns nothing —
   * asking something generic beats asking nothing.
   */
  const steeringQuestions = questions && questions.length > 0 ? questions : BUILD_STEERING_QUESTIONS;
  return (
    <div className="relative z-10 grid h-screen place-items-center p-6 text-center">
      <HudCorners />
      <div className="flex max-w-xl flex-col items-center">
        <div className="relative grid size-28 place-items-center">
          <div className="hud-halo absolute inset-0 rounded-full border border-[var(--hud-cyan)]/40" />
          <div className="pointer-events-none absolute inset-0 rounded-full opacity-40 blur-2xl" style={{ background: "radial-gradient(circle, rgba(94,234,212,0.6), transparent 70%)" }} />
          <span className="relative font-display text-4xl hud-text-glow">✦</span>
        </div>
        <HudEyebrow>Composing your lecture</HudEyebrow>
        <h2 className="mt-4 max-w-lg font-display text-3xl font-light leading-tight">
          Designing a live lesson on <span className="hud-text-glow italic">{topic}</span>…
        </h2>
        <p className="mt-5 max-w-md text-sm leading-7 text-[var(--hud-text-dim)]">
          Mode: {mode}. Aria is choosing the script, visuals, and interaction moments.
        </p>
        <p className="mt-3 text-xs font-black uppercase tracking-[0.18em] text-[var(--hud-cyan)]/70">{status}</p>

        {steeringActive && (
          <div className="mt-8 w-full rounded-2xl border border-[var(--hud-cyan)]/45 bg-[var(--hud-cyan)]/[0.075] p-5 text-left shadow-[0_0_60px_rgba(94,234,212,0.13)]">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--hud-cyan)]">Aria needs your call</p>
            <p className="mt-2 text-sm leading-6 text-[var(--hud-text-dim)]">
              Pick anything that matters. Then continue and Aria will build the lesson with that direction.
            </p>
            <div className="mt-4 space-y-4">
              {steeringQuestions.map((q) => (
                <div key={q.question}>
                  <p className="text-sm font-semibold text-[var(--hud-text)]">{q.question}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {q.options.map((option) => {
                      const selected = choices.includes(option.label);
                      return (
                        <button
                          key={option.label}
                          onClick={() => onChoose(option.label, option.note)}
                          className={`rounded-full border px-3 py-1.5 text-xs font-black transition ${
                            selected
                              ? "border-transparent bg-[var(--hud-cyan)] text-black"
                              : "border-[var(--hud-line)] text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={onContinue}
              className="mt-5 w-full rounded-full bg-[var(--hud-cyan)] px-4 py-3 text-sm font-black text-black transition hover:brightness-110"
            >
              {choices.length > 0 ? "Continue with my choices →" : "Use Aria’s choice →"}
            </button>
          </div>
        )}

        <div className="mt-8 h-1 w-56 overflow-hidden rounded-full bg-white/10">
          <div className="hud-shimmer h-full w-full" />
        </div>
      </div>
    </div>
  );
}

/** A row of quiet, flat quick-reply buttons — used inline under a chat bubble for both the rare
 *  ambiguity questions and the model-authored scoping questions. Deliberately no glow/gradient:
 *  a thin border, a filled state on hover, nothing decorative. */
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
function OutlineReviewState({
  topic,
  outline,
  loading,
  error,
  thoughts,
  scopingQuestions,
  angle,
  initialAmbiguityQuestions,
  initialPlanningQuestions,
  planningAnswers,
  onChoosePlanningAnswer,
  onSubmitPlanningQuestions,
  onSkipPlanningQuestions,
  onAnswerAmbiguity,
  onRevise,
  onApprove,
  onBack,
  onOutlineChange,
  onRerollAngle,
}: {
  topic: string;
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
  initialAmbiguityQuestions: ClarifyQuestion[];
  /** The ONE pre-draft gate, shown in the MAIN CANVAS (not the side chat) — topic-specific
   *  planning questions worth answering before drafting starts. Empty for most topics. */
  initialPlanningQuestions: ScopingQuestion[];
  planningAnswers: { question: string; label: string; instruction: string }[];
  onChoosePlanningAnswer: (question: string, label: string, instruction: string) => void;
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
    setSending(true);
    await onRevise(trimmed);
    setSending(false);
    setChatLog((prev) => [...prev, { role: "aria", text: error ? `Couldn't apply that — ${error}` : "Updated the outline." }]);
  }

  /** A chip click under an Aria question bubble. `isAmbiguity` chips re-draft the outline from
   *  scratch (the answer changes what subject it's even about, via onAnswerAmbiguity); scoping
   *  chips patch the same outline in place via the normal revise pipeline (onRevise). Either
   *  way the source bubble is marked answered so its chips disable without vanishing. */
  function sendChip(bubbleIndex: number, questionText: string, label: string, instruction: string, isAmbiguity: boolean) {
    if (sending || loading) return;
    setChatLog((prev) => prev.map((m, i) => (i === bubbleIndex ? { ...m, answered: true } : m)));
    setChatLog((prev) => [...prev, { role: "you", text: label }]);
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

  /** The ONE pre-draft gate — shown only while `!outline`, unmounts for good once drafting
   *  starts (never lingers in a compact form, unlike the old always-present panel). Questions
   *  are model-generated and topic-specific (see CLARIFY_TOPIC_SYSTEM_PROMPT's planningQuestions
   *  field), not a fixed generic set. */
  function renderPlanningQuestionsPanel() {
    if (initialPlanningQuestions.length === 0) return null;
    const allAnswered = planningAnswers.length >= initialPlanningQuestions.length;
    return (
      <div className="max-w-2xl rounded-xl border border-[var(--hud-cyan)]/40 bg-[var(--hud-cyan)]/[0.06] p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--hud-cyan)]">Aria is planning with you</p>
        <p className="mt-2 text-sm leading-6 text-[var(--hud-text-dim)]">
          A couple of things worth deciding before drafting this specific outline.
        </p>
        <div className="mt-4 space-y-5">
          {initialPlanningQuestions.map((q) => {
            const selected = planningAnswers.find((answer) => answer.question === q.question);
            return (
              <div key={q.question}>
                <p className="text-base font-medium text-[var(--hud-text)]">{q.question}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {q.options.map((option) => {
                    const active = selected?.label === option.label;
                    return (
                      <button
                        key={option.label}
                        onClick={() => onChoosePlanningAnswer(q.question, option.label, option.instruction)}
                        disabled={loading}
                        className={`rounded-md border px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
                          active
                            ? "border-[var(--hud-cyan)] bg-[var(--hud-cyan)] text-black"
                            : "border-[var(--hud-line-strong)] bg-black/20 text-[var(--hud-text-dim)] hover:border-[var(--hud-cyan)] hover:text-[var(--hud-text)]"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-5 flex items-center gap-3">
          <button
            onClick={onSubmitPlanningQuestions}
            disabled={!allAnswered || loading}
            className="flex-1 rounded-md bg-[var(--hud-text)] py-3 text-sm font-semibold text-[#08090c] transition hover:opacity-90 disabled:opacity-35"
          >
            {allAnswered ? "Draft outline with these choices →" : `Answer ${initialPlanningQuestions.length - planningAnswers.length} more to draft`}
          </button>
          <button
            onClick={onSkipPlanningQuestions}
            disabled={loading}
            className="text-sm font-medium text-[var(--hud-text-faint)] hover:text-[var(--hud-text)] disabled:opacity-40"
          >
            Use your judgment →
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="relative z-10 min-h-screen w-full bg-[#08090c]">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between border-b border-[var(--hud-line)] px-6 py-4 lg:px-10">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--hud-text-faint)]">Lesson outline</p>
          <h1 className="mt-1 truncate text-lg font-medium text-[var(--hud-text)]">{topic}</h1>
        </div>
        <button onClick={onBack} className="shrink-0 rounded-md border border-[var(--hud-line)] px-4 py-2 text-sm font-medium text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]">
          Back
        </button>
      </div>

      <div className="mx-auto grid max-w-[1400px] grid-cols-1 lg:grid-cols-[1fr_360px]">
        {/* Outline canvas */}
        <div className="min-w-0 border-r border-[var(--hud-line)] px-6 py-8 lg:px-10">
          {!outline && initialPlanningQuestions.length > 0 ? (
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
                          if (chip) sendChip(i, m.text, chip.label, chip.instruction, Boolean(m.isAmbiguity));
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
