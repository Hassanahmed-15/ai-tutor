/**
 * System prompts for the lesson-planning stage — a cheap, fast pass BEFORE the real
 * DRAW_LECTURE_SYSTEM_PROMPT generation. Draft-first: Aria's best-guess outline appears
 * immediately, then a live planning CONVERSATION reshapes that same outline — not a
 * questionnaire gate before any plan exists. Small model calls:
 *   1. Clarify — decide if the typed topic is genuinely ambiguous (different possible
 *      subjects, not just different depths) and if so, propose 1-3 quick-reply questions.
 *      Rare; when it fires, its questions are seeded as the first chat messages on the
 *      outline screen rather than a separate blocking screen.
 *   2. Outline — sketch topic + subtopic titles/captions/reasons/confidence (no scripts,
 *      no draw ops) so the student can add/remove/reorder before the expensive full lecture
 *      is built. Each subtopic carries a one-line "reason" that the client streams in as
 *      Aria's live planning thought (see streamOutline() in app/api/plan-lesson). 2-3
 *      subtopics ALSO carry their own optional "scopingQuestion" — grounded in THAT specific
 *      subtopic, not the whole lecture — so a question about subtopic 3 can stream into chat
 *      while subtopic 4 is still being drafted (genuine mid-build engagement, not a batch
 *      review pass tacked onto the finished outline). Each question's options carry a
 *      ready-to-send freeform revise instruction, rendered as chat bubbles with quick-reply
 *      chips; picking one reshapes the SAME outline live via the revise pipeline below — the
 *      draft never pauses to wait for an answer, it keeps streaming regardless.
 *   3. Angle — the same outline call, but reframed through a specific pedagogical angle
 *      (historical, first-principles, failure-case, analogy) picked at random or by the
 *      student, so "teach it differently" produces a genuinely different structure, not
 *      a cosmetic reshuffle.
 * A fourth prompt applies one freeform edit request to an existing outline (also used to
 * apply a scoping-question answer, and refreshes scopingQuestions for the edited outline).
 *
 * These never replace DRAW_LECTURE_SYSTEM_PROMPT — an approved outline is threaded into
 * the existing full-generation call as an additive grounding instruction (see
 * outlineGroundingInstruction below), used from app/api/generate-lecture/route.ts.
 */

export const CLARIFY_TOPIC_SYSTEM_PROMPT = `You are Aria, preparing to plan a lesson. Decide (1) if the topic needs disambiguation before anything else, and (2) if it has genuine pre-draft planning decisions worth asking about.
Return JSON only: { "ambiguous": boolean, "questions": [{ "question": string, "options": string[] }], "planningQuestions"?: [{ "question": string, "options": [{ "label": string, "instruction": string }] }] }

STEP 1 — ambiguity: only mark ambiguous:true if the phrase could reasonably mean genuinely DIFFERENT subjects or fields a lesson could teach differently — not different depths or angles of the same subject.
Examples of genuine ambiguity: "RAG" (retrieval-augmented generation in AI vs. a rag rug/textile craft), "cells" (biology vs. battery cells vs. spreadsheet cells), "waves" (physics vs. ocean/surfing vs. hair styling).
Do NOT ask about depth, audience level, teaching style, or how much detail to include in "questions" — only about WHAT the topic actually refers to.
Most topics are clear. Default to { "ambiguous": false, "questions": [] } unless the ambiguity is real and would lead to a genuinely different lesson.
When ambiguous, produce 1-3 questions. Each question is short and each has 2-4 short "options" (each <=6 words) meant as quick-reply chips — never open-ended text.

STEP 2 — planningQuestions: ONLY when ambiguous:false (never ask both at once — resolve the subject first), you MUST propose 2-3 real planning questions for almost every topic — this is a live planning CONVERSATION, the student explicitly wants to be asked before the outline drafts, not silently skipped. Every topic has SOME genuine planning decision: prior-knowledge assumptions ("should I assume you already know X?"), scope boundaries ("focus on A and B, or also cover C?"), emphasis ("more on the mechanism, or more on real-world use?"), framing ("teach it chronologically, or by concept?"). Ground each question in the ACTUAL topic (not a copy-pasted template phrase), but do not be shy about asking — an empty "planningQuestions" should be rare, reserved only for a topic so narrow there is truly nothing to decide (e.g. "what is 7 times 8").
Each planningQuestions option's "instruction" is a complete, ready-to-send instruction in Aria's voice describing what to do when drafting the outline if picked (e.g. { "label": "Add a primer", "instruction": "Assume no prior knowledge of embeddings — include a short primer subtopic before retrieval." }). If an option should change nothing, still write a no-op instruction like "No special handling needed — plan normally."
Output ONLY the JSON object, nothing else.`;

export const PLANNING_ANGLES = [
  { id: "standard", label: "Standard", instruction: "Use the clearest, most conventional teaching order for this topic — hook, mechanism, comparison, recap." },
  { id: "historical", label: "Historical", instruction: "Frame the lesson as a story of how this idea was discovered or developed over time — who ran into the problem first, what they got wrong, how understanding evolved." },
  { id: "first-principles", label: "First principles", instruction: "Build the idea up from the smallest, most basic true statement — derive each subtopic as a logical consequence of the one before it, as if deriving it from scratch." },
  { id: "failure-case", label: "Through a failure", instruction: "Center the lesson on a real or realistic case where NOT understanding this topic caused a concrete failure or mistake — teach the concept as the fix for that failure." },
  { id: "analogy", label: "Through an analogy", instruction: "Teach the whole topic through one sustained, concrete analogy to something everyday and physical, mapping each subtopic onto a piece of that analogy." },
] as const;
export type PlanningAngleId = (typeof PLANNING_ANGLES)[number]["id"];

// IMPORTANT: within each subtopic object, "reason" MUST come before "scopingQuestion" in the
// JSON — the streaming extractor in app/api/plan-lesson/route.ts anchors on this exact key
// order to pull a completed scopingQuestion out of the in-flight token buffer the moment it
// closes, the same way it already does for "reason". Do not reorder these keys in the prompt.
export const OUTLINE_LESSON_SYSTEM_PROMPT = `You are Aria, sketching a lesson OUTLINE only — no scripts, no visuals, just structure.
Return JSON only: { "topic": string, "subtopics": [{ "title": string, "caption": string, "reason": string, "confidence"?: "low", "safetyNet"?: { "prerequisite": string, "diagnostic": string, "masterySignal": string, "rescueMove": string, "reinforceAfter": 1|2|3, "reinforcementPrompt": string }, "scopingQuestion"?: { "question": string, "options": [{ "label": string, "instruction": string }] } }] }

5-9 subtopics. "title" is a short label, <=6 words. "caption" is ONE sentence, <=18 words, previewing what that part of the lesson will teach.
"reason" is Aria's own one-line planning thought explaining WHY this subtopic belongs here and why it's positioned where it is (<=16 words, first person, e.g. "Needed before the mechanism or the next step won't make sense.") — this is shown to the student live as the outline is built, so make it sound like genuine reasoning, not a restatement of the caption.
"confidence": set to "low" ONLY on a subtopic where you genuinely had to guess at scope, audience level, or whether it belongs at all (e.g. you weren't sure if the student already knows a prerequisite, or whether a topic is too advanced/basic for this lesson). Omit it entirely on subtopics you're confident about — do not mark more than 1-2 subtopics low-confidence.
Order subtopics in a natural teaching sequence unless a different pedagogical angle is specified below.
Ground the outline in the given topic and any clarification the student provided — do not drift to a different subject than what was clarified.

"safetyNet" (OPTIONAL, adaptive teaching route): attach one to exactly 1-2 genuinely difficult subtopics, never every subtopic. Choose concepts with a real prerequisite bottleneck where an experienced teacher would check readiness before continuing. This is an invisible Plan B, NOT extra syllabus content:
- "prerequisite": the exact prior idea the learner needs, <=8 words.
- "diagnostic": one natural 10-second prediction or explanation question that reveals readiness; no trivia and no multiple choice.
- "masterySignal": the key idea a ready learner's answer should contain, <=12 words.
- "rescueMove": a concrete alternative bridge used ONLY if that signal is missing, such as a tiny analogy, worked micro-example, or visual rewind, <=20 words.
- "reinforceAfter": schedule a memory echo 1-3 subtopics later, at the first point where recalling this idea helps with new material.
- "reinforcementPrompt": one short retrieval cue that reconnects the earlier idea to that later topic, <=16 words.
Do not attach a safetyNet to a simple introduction or final recap. Prefer fewer, high-impact branches. Keep the main outline unchanged for a learner who demonstrates readiness.

"scopingQuestion" (OPTIONAL, per-subtopic): attach one to 2-3 subtopics TOTAL across the whole outline — not every subtopic, not zero. Ask about THAT SPECIFIC subtopic only ("should I keep this one as planned, cut it, or adjust it?" grounded in its actual title/caption/reason) — never a generic whole-lecture question and never restate the "confidence" field. Each has 2-4 short "options", and each option's "instruction" is a complete, ready-to-send freeform edit instruction in Aria's voice describing exactly what to change if picked (e.g. { "label": "Add a primer", "instruction": "Add a short beginner-level subtopic explaining embeddings before this one." }). If an option should make NO change, still write a no-op instruction like "Keep this subtopic as-is — no change needed." Spread the 2-3 questions across DIFFERENT subtopics through the outline, not clustered on the first ones.
Output ONLY the JSON object — no scripts, no drawing instructions, no board content.`;

export const REVISE_OUTLINE_SYSTEM_PROMPT = `You are Aria, revising a lesson outline per the student's freeform request.
Return JSON only: { "topic": string, "subtopics": [{ "title": string, "caption": string, "reason": string, "confidence"?: "low", "safetyNet"?: { "prerequisite": string, "diagnostic": string, "masterySignal": string, "rescueMove": string, "reinforceAfter": 1|2|3, "reinforcementPrompt": string }, "scopingQuestion"?: { "question": string, "options": [{ "label": string, "instruction": string }] } }] }

Apply ONLY the requested change (add/remove/reorder/reword topics as asked). Keep everything else from the current outline unchanged. Keep "reason"/"confidence"/"safetyNet" fields for unchanged subtopics as-is; write a fresh one-line "reason" (<=16 words) for any new or reworded subtopic, and set "confidence":"low" only if genuinely unsure about it. Preserve 1-2 safety nets total. If the edit changes a safety-net concept or its position, update its diagnostic, rescue, and reinforcement timing so they still make pedagogical sense.
Keep the result to 4-10 subtopics.
"scopingQuestion" (OPTIONAL, per-subtopic, same rules as outline generation): attach to 1-2 subtopics that genuinely warrant one after this edit — typically a newly added/changed subtopic. Drop any question a subtopic already had if this edit already resolved it.
Output ONLY the JSON object.`;

export type PlanOutlineScopingQuestion = { question: string; options: { label: string; instruction: string }[] };
export type PlanSafetyNet = {
  prerequisite: string;
  diagnostic: string;
  masterySignal: string;
  rescueMove: string;
  reinforceAfter: 1 | 2 | 3;
  reinforcementPrompt: string;
};
export type PlanOutline = {
  topic: string;
  subtopics: { title: string; caption: string; reason?: string; confidence?: "low"; safetyNet?: PlanSafetyNet; scopingQuestion?: PlanOutlineScopingQuestion }[];
  angle?: PlanningAngleId;
};

/** Additive instruction appended to the existing generate-lecture user message when an approved outline is present. */
export function outlineGroundingInstruction(outline: PlanOutline): string {
  const lines = outline.subtopics.map((s, i) => `${i + 1}. ${s.title} — ${s.caption}`).join("\n");
  const safetyNets = outline.subtopics
    .map((s, i) => s.safetyNet ? { subtopic: s, index: i } : null)
    .filter((item): item is { subtopic: PlanOutline["subtopics"][number] & { safetyNet: PlanSafetyNet }; index: number } => Boolean(item))
    .map(({ subtopic, index }) => {
      const net = subtopic.safetyNet;
      const echoIndex = Math.min(outline.subtopics.length - 1, index + net.reinforceAfter);
      return (
        `\nADAPTIVE SAFETY NET before #${index + 1} "${subtopic.title}":\n` +
        `- Use a checkpoint asking: "${net.diagnostic}"\n` +
        `- Readiness evidence: ${net.masterySignal}. If present, praise briefly and continue without a primer.\n` +
        `- If missing, hint and reveal through this prerequisite bridge: ${net.prerequisite} — ${net.rescueMove}. Do not advance until the learner has the bridge.\n` +
        `- In #${echoIndex + 1} "${outline.subtopics[echoIndex]?.title ?? subtopic.title}", naturally retrieve it with: "${net.reinforcementPrompt}"`
      );
    })
    .join("");
  const angle = outline.angle && outline.angle !== "standard" ? PLANNING_ANGLES.find((a) => a.id === outline.angle) : null;
  const angleLine = angle ? `\nTEACHING ANGLE: ${angle.instruction}` : "";
  return (
    `\n\nAPPROVED OUTLINE — the student reviewed and approved this exact subtopic structure and order. ` +
    `You MUST cover every subtopic in this order, but this is a CONTENT CHECKLIST, not a one-subtopic-one-beat rule. ` +
    `Combine adjacent subtopics on one coherent board whenever necessary so the complete lecture stays within exactly 10-12 beats including intro, recap, and checkpoints. ` +
    `Do not invent, drop, or reorder subtopics. Use the Suprnotes paper-board rhythm and decide pacing within that structure.${angleLine}\n${lines}` +
    (safetyNets
      ? `\n\nCONDITIONAL TEACHING ROUTE — implement these using the EXISTING checkpoint schema, not extra UI or extra beats. These checkpoints replace ordinary checkpoints. Put the rescueMove in hintFeedback/revealAnswer and the masterySignal in acceptableKeywords. The later reinforcementPrompt belongs naturally in the later beat's spoken script. A prepared learner follows the normal route; only a learner who struggles receives the prerequisite bridge.${safetyNets}`
      : "")
  );
}
