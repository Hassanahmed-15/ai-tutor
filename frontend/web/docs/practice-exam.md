# Practice exam (front page "Practice questions" mode)

The owner asked for this on 2026-11-26. It is in Aria, local only, behind a switch: `PRACTICE_EXAM=on` (server) and `NEXT_PUBLIC_PRACTICE_EXAM=on` (client).

The flow:
1. **Plan.** The student types a topic in Practice mode. Aria asks 4 planning questions, using the same big question and A/B/C cards (plus an "Other" box) as typed-prompt planning.
2. **Test.** 5–10 questions, or as many as the student asked for, mixing easy, medium and hard. Questions are multiple choice, short answers, or long worked numericals that the student answers on paper.
3. **Photos.** The student photographs their paper with the phone scanner (`PhoneCapturePanel`), or uploads photos from the computer.
4. **Grading.** Aria marks every answer against a mark scheme, step by step for worked answers.
5. **Results.** Marks and a grade, then an explanation of every mistake. Aria offers "Explain my mistakes", a lecture with one board per mistake.

## Server (lib/practice/*, app/api/practice/*)

### Types (lib/practice/types.ts)
```ts
type Difficulty = "easy" | "medium" | "hard";
type Style = "mcq" | "short" | "worked";          // worked = long numerical/structured, answered on paper
type ExamPlan = {
  topic: string; level: string; board?: string;     // e.g. "IGCSE", "Cambridge 0620"
  subtopics: string[];                               // [] = everything in the topic
  count: number;                                     // 3–15, default 8
  mix: { easy: number; medium: number; hard: number }; // counts that sum to count
  styles: Style[];                                   // allowed styles
  minutes: number | null;                            // null = untimed
};
type StudentQuestion = {                             // what the browser sees: NO answers or schemes
  id: string; n: number; difficulty: Difficulty; style: Style; marks: number; subtopic: string;
  stem: string;                                       // may use $…$ LaTeX for maths
  options?: Record<"A" | "B" | "C" | "D", string>;    // mcq only
  parts: { label: string; marks: number; text: string }[]; // short/worked; [] for mcq
  answerOn: "screen" | "paper";                       // worked → paper
};
type Scheme = { id: string; answer?: string; points: { label: string; text: string; marks: number }[]; working: string[]; commonErrors: string[] };
type QuestionResult = {
  id: string; awarded: number; max: number; correct: boolean;
  studentAnswer: string;                // what Aria read (typed, or transcribed from the photo)
  feedback: string;                     // one or two plain sentences
  firstError?: { step: string; what: string; why: string }; // where the working first went wrong
  correctWorking: string[];             // the right steps
  readConfidence?: "high" | "low";      // photo answers: how sure the reading is
};
type ExamResult = { examId: string; total: number; max: number; percent: number; grade: string; results: QuestionResult[]; mistakes: QuestionResult[]; costUsd: number };
```

### Routes (all need `lessonCaller()`, and return 404 unless `PRACTICE_EXAM=on`)
- `POST /api/practice/plan-options { topic, level? }` → `{ subtopics: string[] (5–9 short names), levels: string[] (3–5 likely levels/boards for this topic), suggestion: { count, mix, styles, minutes } }`. One cheap luna call.
- `POST /api/practice/exam { plan: ExamPlan }` → `{ examId, questions: StudentQuestion[], minutes }`.
  - One luna call writes all the questions with their schemes.
  - A second-examiner check answers every question independently and compares it with the scheme, as in lib/curriculum/examStyle.ts `solverProblems`. Flagged questions are rewritten once and dropped if still wrong.
  - Numbers must be checkable. The rules in lib/curriculum/examStyle.ts are the model to follow.
  - The exam with its schemes is stored server-side (blob via lib/blobStorage `uploadJsonBlob`/`downloadJsonBlob`, key `practice/exam/<examId>.json`), and only the owner's userId may grade it.
- `POST /api/practice/exam/[id]/grade { answers: { [questionId]: { choice?: string; text?: string } }, documentId?: string }` → `ExamResult`.
  - Multiple choice is marked by code.
  - Short typed answers are marked with lib/curriculum/pastPaperMarking.ts `markWritten`, or an extension of it that also returns `firstError` and `correctWorking`.
  - Paper answers come from the phone capture's page images (`documentId` from `/api/capture/[id]/finish`, read with lib/pageImageStore).
    - One vision call (luna, image parts) reads ALL the pages against the list of paper questions, matches the student's working to each question by its number, and marks it step by step against the scheme.
    - It returns per-question `studentAnswer` (transcribed working), marks, `firstError`, `correctWorking` and `readConfidence`.
    - It never invents working that isn't on the page; an unanswered question gets 0 with "No answer found on your pages".
  - Grade: percent → A* (≥ 90), A (≥ 80), B (≥ 70), C (≥ 60), D (≥ 50), E (≥ 40), else U, labelled "approximate".
- Every paid call is recorded in Aria's spend log the way other routes do (see lib/spend/record.ts and its callers).

## Client (components/practice/*)
- `PracticeExam.tsx` replaces `PastPaperPractice` for the front page's Practice mode when `NEXT_PUBLIC_PRACTICE_EXAM=on`. Phases:
  1. **Plan:** 4 questions, styled exactly like LearnPage `renderDiagnosticFocus`: progress dashes, a big serif question, A/B/C/D cards, and an "Other" box for typing.
     - (1) exam and level, from `levels` with the learner profile's study level first;
     - (2) topics, a multi-select of `subtopics` plus "Everything";
     - (3) how many and difficulty: 5 / 8 / 10 / Other, then "Mostly easy / Balanced / Exam-hard";
     - (4) question style and time: multi-select of multiple choice / short answers / long worked questions, then "Untimed / Timed like the exam (N min)".
     - Then a plan summary card with "Start test" and an edit link for each answer.
  2. **Writing:** "Aria is writing your test…" (it takes 20–60 s).
  3. **Test:** a clean exam-paper view with numbered questions, marks per part, difficulty tags, KaTeX for maths, and a timer when timed.
     - Multiple choice uses option buttons. Short answers use a text box. Worked questions show "Answer this on paper" with what to write.
     - A bar along the bottom offers "Scan my paper answers" (opens `PhoneCapturePanel` and receives its `CapturedDocument.documentId`) or "Upload photos" from the computer, then "Submit for marking".
  4. **Marking:** "Aria is marking your answers…".
  5. **Results:** score, percent and approximate grade, and a card per question showing marks, what Aria read, feedback, the first error highlighted, and the correct working.
     - Then "Your mistakes, explained", a short list, with two buttons: "Explain my mistakes: one board for each" and "Try a new test on what I missed".
- **Mistake lecture:** `setPendingBrief({ topic, review: { title, mistakes } })`, then `go("learn")`. LearnPage turns it into a lecture whose outline has one subtopic per mistake (the coordinator wires LearnPage).

## Practice sheets (owner 2026-11-27)

A practice sheet is the same test, written from something the student has studied: a lecture or a course lesson.
- **Where it is offered.**
  - At the end of every lecture: a "Practice sheet" card on the end screen (`TestOfferScreen`). A course lesson reaches that screen after its past-paper practice.
  - On the front page in Practice mode: `components/practice/PracticePicker.tsx` lists the student's saved lectures. Beside them is "Any topic": typed in the box, one of the student's suggested topics, or "Random topic", which picks one of those suggestions at random.
- **What it is written from.** `lib/practice/source.ts` turns what the browser already has into `plan.source`:
  - **A lecture:** its boards' titles, claims, points and definitions, each line said once, capped at 8,000 characters.
  - **A course lesson:** its spec's outcomes, terms and methods, then the boards. `exam` holds the course's name and level, and `examples` hold up to 4 of the course's own exam-style questions, used for their style.
- **The ready plan.** 6 questions, balanced (2 easy, 2 medium, 2 hard), every style, untimed. The test opens on the summary; every row can still be edited.
- **Server.**
  - `normalizePlan` keeps the source (`cleanSource`): length caps, control bytes removed, dropped if it says nothing.
  - The writer and the judge see the taught content between `<<<TAUGHT … TAUGHT>>>` markers, as material and never as instructions.
  - The blind solver does not see it: it must answer from the question alone.
- **Explain my mistakes from a lecture's sheet.** `LearnPage.startPracticeReview` first clears the last lesson's course, document and strict-source context. The build then starts on the next render, so the mistakes lecture is never taught as the previous course or PDF.

## Phone scanning from a local computer

The QR code opens the **live** site whenever `PUBLIC_BASE_URL` is set (`lib/capture/lanUrl.ts`), so a phone on any network can open it. With that set, `lib/capture/store.ts` keeps captures in the shared blob container, even in development.
- The phone uploads to the live server, which reads each photo.
- This computer sees the same session and results in blob storage, and `/api/capture/[id]/finish` runs here, so the page images land in this process for marking.
- Checked 2026-11-27 with `scripts/qa/.probe/capture-live-check.mts` (free): a session made here is found by the live phone route, and a wrong token gets 404.
