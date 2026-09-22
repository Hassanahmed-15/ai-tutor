/**
 * THE LADDER: every board owns one rung, the lesson never descends.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  LADDER,
  ROLE_CONTRACT,
  defaultLadderObjectives,
  descends,
  inferRole,
  lessonMapBlock,
  orderByLadder,
  roleBriefing,
  subjectPhrase,
} from "../lessonLadder";

test("roles are inferred from wording, with specific rungs beating broad ones", () => {
  const n = 6;
  assert.equal(inferRole({ title: "What Overfitting Actually Is" }, 1, n), "core");
  assert.equal(inferRole({ title: "How the model memorises noise" }, 2, n), "mechanism");
  assert.equal(inferRole({ title: "Overfitting with real numbers" }, 3, n), "example");
  assert.equal(inferRole({ title: "Why it matters for deployment" }, 3, n), "implication");
  assert.equal(inferRole({ title: "The mistake people make in the mechanism" }, 3, n), "pitfall", "a pitfall board that mentions the mechanism is still a pitfall board");
  assert.equal(inferRole({ title: "Overfitting versus underfitting" }, 4, n), "contrast");
});

test("the first board is the hook and the last the recap, whatever they are called", () => {
  assert.equal(inferRole({ title: "How overfitting works" }, 0, 5), "hook");
  assert.equal(inferRole({ title: "What overfitting is" }, 4, 5), "recap");
});

test("THE ORDERING: 'how it works' before 'what it is' is put right, and nothing descends", () => {
  const plan = [
    { title: "Overfitting", objective: "Open with a puzzle." },
    { title: "How overfitting happens step by step", objective: "The mechanism." },
    { title: "What overfitting actually is", objective: "Define it." },
    { title: "Overfitting with real numbers", objective: "Worked example." },
    { title: "Overfitting Recap", objective: "Tie together." },
  ];
  const ordered = orderByLadder(plan);
  assert.deepEqual(ordered.map((b) => b.role), ["hook", "core", "mechanism", "example", "recap"]);
  assert.equal(ordered[1].title, "What overfitting actually is", "the definition moved ahead of the mechanism");
  assert.equal(descends(ordered.map((b) => b.role)), false);
});

test("descends() catches going deep and then back to basics", () => {
  assert.equal(descends(["hook", "core", "mechanism", "example", "recap"]), false);
  assert.equal(descends(["hook", "mechanism", "example", "core", "recap"]), true, "a definition after an example is a descent");
  assert.equal(descends(["hook", "example", "example", "recap"]), false, "two boards on the same rung is not a descent");
});

test("every rung has a contract, and only the core rung may define or use an analogy for the subject", () => {
  for (const role of LADDER) {
    assert.ok(ROLE_CONTRACT[role].must.length > 20, `${role} says what it must do`);
    assert.ok(ROLE_CONTRACT[role].mustNot.length > 20, `${role} says what it must not do`);
  }
  const definers = LADDER.filter((r) => ROLE_CONTRACT[r].allowsDefinition);
  const analogisers = LADDER.filter((r) => ROLE_CONTRACT[r].allowsAnalogy);
  assert.deepEqual(definers, ["core"]);
  assert.deepEqual(analogisers, ["core"]);
});

test("the default objectives climb the ladder with no two boards on the same rung", () => {
  const objectives = defaultLadderObjectives("overfitting", 6);
  const roles = objectives.map((o) => o.role);
  assert.equal(new Set(roles).size, roles.length, "no rung is used twice");
  assert.equal(descends(roles), false);
  for (const o of objectives) assert.ok(/no re-|only|do not|not yet/i.test(o.objective), `"${o.title}" says what it leaves alone`);
});

test("the lesson map tells the model what is taught, what is now, and what is still to come", () => {
  const plan = [
    { sequence: 0, title: "Why a model can be too good", objective: "hook", role: "hook" as const },
    { sequence: 1, title: "What overfitting is", objective: "define", role: "core" as const },
    { sequence: 2, title: "How it happens", objective: "mechanism", role: "mechanism" as const },
    { sequence: 3, title: "Regularisation", objective: "a fix", role: "application" as const },
  ];
  const block = lessonMapBlock(plan, 2, [
    { sequence: 0, keyClaims: ["A model can score perfectly on training data and badly on new data."] },
    { sequence: 1, keyClaims: ["Overfitting is fitting noise as if it were signal."] },
  ]);
  assert.match(block, /1\. \[TAUGHT\].*ESTABLISHED: "A model can score perfectly/);
  assert.match(block, /2\. \[TAUGHT\].*fitting noise as if it were signal/);
  assert.match(block, /3\. \[THIS BOARD\] \(mechanism\) How it happens/);
  assert.match(block, /4\. \[UPCOMING\] \(application\) Regularisation/);
  assert.match(block, /Do not pre-teach/);
  assert.match(block, /Do not define it, re-motivate it/);
});

test("the role briefing replaces 'everything in one board' with one rung's contract", () => {
  const briefing = roleBriefing("mechanism", [3, 4]);
  assert.match(briefing, /RUNG: MECHANISM/);
  assert.match(briefing, /MUST NOT: Do not re-define/);
  assert.match(briefing, /Rewording something already said is not depth/);
  assert.doesNotMatch(briefing, /ALL WITHIN THIS ONE BOARD/);
});

test("the subject phrase is the thing the lesson is about, not the question the student typed", () => {
  assert.equal(subjectPhrase("What is overfitting?"), "Overfitting");
  assert.equal(subjectPhrase("how linear regression works"), "Linear Regression");
  assert.equal(subjectPhrase("explain photosynthesis to me"), "Photosynthesis");
  assert.equal(subjectPhrase("the Krebs cycle"), "Krebs Cycle");
  assert.equal(subjectPhrase("supply and demand"), "Supply and Demand");
});

test("THE DESCENT BUG: a rung the planner assigned is kept, even when the objective's wording misleads", () => {
  // "builds on" matched the application pattern and sent the definition board to fifth place.
  const plan = [
    { title: "Overfitting", objective: "hook", role: "hook" as const },
    { title: "How Overfitting Works", objective: "mechanism", role: "mechanism" as const },
    { title: "What Overfitting Actually Is", objective: "Define it once and give the mental model the rest of the lesson builds on. No example, no mechanism yet.", role: "core" as const },
    { title: "Overfitting Recap", objective: "recap", role: "recap" as const },
  ];
  const ordered = orderByLadder(plan);
  assert.deepEqual(ordered.map((b) => b.role), ["hook", "core", "mechanism", "recap"]);
  assert.equal(ordered[1].title, "What Overfitting Actually Is");
});

test("inference reads the title before the objective, so a 'must not' clause cannot misclassify a board", () => {
  const role = inferRole({ title: "What Overfitting Actually Is", objective: "Definition and model only — no example, no mechanism yet." }, 2, 6);
  assert.equal(role, "core");
});

test("the default ladder titles are about the subject, never about the question", () => {
  for (const o of defaultLadderObjectives("Overfitting", 5)) {
    assert.doesNotMatch(o.title, /what is overfitting\?/i);
    assert.ok(o.title.split(" ").length <= 5, `"${o.title}" fits a title`);
  }
});
