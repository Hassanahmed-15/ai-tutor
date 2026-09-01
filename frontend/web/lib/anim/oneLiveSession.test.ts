/**
 * ONE live voice session on screen at a time.
 *
 * A Gemini Live session is a socket, so this cannot be tested by running it. What CAN be tested is
 * the rule that decides when each session is open, and that rule is a single phase check in
 * LearnPage — so this reads the source and asserts the shape of it.
 *
 * WHY THIS EARNS A TEST. Three components can each open a session: LearnPage while planning,
 * LessonDesignMode while the lesson builds, and LessonPlayer while teaching. They live in different
 * files and nothing in the type system connects them, so the invariant is invisible at every
 * individual call site. It broke exactly that way: the planning voice ran through `outline` and
 * `building`, the design screen was later added to the `building` phase with a session of its own,
 * and the result was two Arias talking over each other with two open microphones and two bills.
 *
 * The failure is also nearly invisible in review — each file looks right on its own — which is
 * precisely the kind of bug worth pinning in a test rather than a comment.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Resolved from the working directory rather than from this file's own location: the test build
 * emits CommonJS, so `import.meta` is unavailable, and the emitted __dirname would point into
 * .test-build rather than at the source being asserted about. `npm run test:anim` always runs from
 * the package root.
 */
const root = process.cwd();
const learnPage = readFileSync(join(root, "components", "pages", "LearnPage.tsx"), "utf8");
const designMode = readFileSync(join(root, "components", "design", "LessonDesignMode.tsx"), "utf8");

test("the planning voice does NOT run during the building phase", () => {
  /*
   * The design screen owns the build. If this condition ever includes "building" again, two
   * sessions are open at once — which is the bug this file exists to prevent coming back.
   */
  const gate = learnPage.match(/if \(phase === "outline"[^)]*\) \{\s*\n\s*void voiceStart\(\);/);
  assert.ok(
    gate,
    'LearnPage must start the planning voice on the "outline" phase only — if this failed, check that the phase gate around voiceStart() has not regained another phase.',
  );
  assert.doesNotMatch(
    gate[0],
    /building/,
    'The planning voice must not run during "building": LessonDesignMode opens its own session in that phase, so both would be live at once.',
  );
});

test("each screen opens exactly one session, and only one screen owns each phase", () => {
  // One hook call per file. A second in the same component would double up on its own.
  const countSessions = (src: string) => src.match(/useGeminiLiveTutor\(\{/g)?.length ?? 0;
  assert.equal(countSessions(learnPage), 1, "LearnPage should open exactly one Live session");
  assert.equal(countSessions(designMode), 1, "LessonDesignMode should open exactly one Live session");
});

test("the design screen stops its session before handing over to the lecture", () => {
  /*
   * The player opens its own session when teaching starts, so the design screen's must be closed on
   * the way out — otherwise the two overlap for the whole lecture rather than for a moment.
   */
  assert.match(
    designMode,
    /stop\(\);\s*\n\s*onStart\(\);/,
    "LessonDesignMode must stop its Live session before calling onStart(), or it stays open under the lecture.",
  );
});
