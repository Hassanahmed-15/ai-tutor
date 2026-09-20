/**
 * The words layer of the voice gate, tested on sentences rather than on a hand-set boolean.
 *
 * The old classifier's matrix tests passed `addressed: false` in by hand for every bystander case,
 * so the function that actually decided — which returned true for any three-word sentence — was
 * never exercised. These tests call the real thing, in both contexts that matter: while Aria is
 * talking (interrupting is the expensive mistake) and while she is waiting for an answer (missing
 * the answer is).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { classifyAddressing, topicWordsFrom, type AddressingContext } from "../voice/addressing";

const LECTURING: AddressingContext = {
  expectingAnswer: false,
  tutorSpeaking: true,
  topicWords: topicWordsFrom("Why demand curves slope downward", "price quantity substitution income effect"),
};
const WAITING: AddressingContext = { expectingAnswer: true, tutorSpeaking: false };
const IDLE: AddressingContext = { expectingAnswer: false, tutorSpeaking: false };

const forAria = (text: string, ctx: AddressingContext) => {
  const v = classifyAddressing(text, ctx);
  assert.equal(v.addressed, true, `"${text}" should be for Aria — got ${v.reason} (${v.score.toFixed(2)})`);
};
const notForAria = (text: string, ctx: AddressingContext) => {
  const v = classifyAddressing(text, ctx);
  assert.equal(v.addressed, false, `"${text}" should NOT be for Aria — got ${v.reason} (${v.score.toFixed(2)})`);
};

test("THE BUG: a bystander's three-word sentence no longer counts as addressed", () => {
  // The old rule was `words.length >= 3`. Every one of these stopped the lecture.
  notForAria("did you remember to send that email", LECTURING);
  notForAria("no it was on the table next to the keys", LECTURING);
  notForAria("and then the dog ran across the field", LECTURING);
  notForAria("hey can you pass me the charger", LECTURING);
  notForAria("I'll call you back in five minutes", LECTURING);
  notForAria("dinner's ready come downstairs", LECTURING);
  notForAria("did you see the game last night", LECTURING);
});

test("the tutor's name settles it, in either spelling", () => {
  forAria("aria, can you repeat that?", LECTURING);
  forAria("arya what was that", LECTURING);
  forAria("teacher slow down", LECTURING);
});

test("but the name in the third person is someone talking ABOUT her", () => {
  notForAria("aria said something about demand curves earlier", LECTURING);
  notForAria("arya keeps saying the same thing", IDLE);
  // "you" in the same breath means the student is telling her something — still for her.
  forAria("aria you said the curve slopes down, why?", LECTURING);
});

test("hailing someone else by name is not for Aria", () => {
  notForAria("hey Sam, are you coming?", LECTURING);
  notForAria("hi mom", IDLE);
  // "hey" followed by an instruction is still for her.
  forAria("hey can you explain that again", LECTURING);
  forAria("hey wait", LECTURING);
});

test("short lesson commands are always for Aria, even mid-lecture", () => {
  for (const cmd of ["stop", "pause", "wait", "hold on", "continue", "repeat", "say that again", "slower", "go back", "skip", "one more time", "never mind"]) {
    forAria(cmd, LECTURING);
  }
  forAria("Aria, pause the lecture", LECTURING);
  forAria("okay continue please", LECTURING);
});

test("a question about what is on the board interrupts; a question about the room does not", () => {
  forAria("wait, what does that mean?", LECTURING);
  forAria("why did that step change the sign?", LECTURING);
  forAria("can you explain the last part again", LECTURING);
  forAria("what do you mean by substitution effect", LECTURING);
  forAria("I don't get it", LECTURING);
  notForAria("what time is it", LECTURING);
  notForAria("what do you want for dinner", LECTURING);
});

test("topic words are evidence: the same shape of question flips on vocabulary", () => {
  forAria("so why does the price and quantity change", LECTURING);
  notForAria("so why was the bus and the traffic so bad", LECTURING);
  // Vocabulary raises the score even when it does not cross the line on its own.
  const onTopic = classifyAddressing("so the price goes up and the quantity goes down", LECTURING);
  const offTopic = classifyAddressing("so the bus was late and the traffic was bad", LECTURING);
  assert.ok(onTopic.score > offTopic.score, `${onTopic.score} should beat ${offTopic.score}`);
});

test("thinking aloud about the lesson does not interrupt the lesson", () => {
  // A declarative paraphrase mid-narration is the student keeping up, not a request. Interrupting
  // Aria every time the student mutters "so the price goes up" would be exactly the false
  // interruption this classifier exists to stop. While she WAITS, the same words are the answer.
  notForAria("so the price goes up and the quantity goes down", LECTURING);
  forAria("so the price goes up and the quantity goes down", WAITING);
});

test("backchannels never interrupt a lecture", () => {
  for (const ack of ["mm-hm", "okay", "yeah yeah", "right", "got it", "makes sense", "haha", "oh wow"]) {
    notForAria(ack, LECTURING);
  }
});

test("but a bare yes/no IS the answer when Aria asked a question", () => {
  forAria("yes", WAITING);
  forAria("no", WAITING);
  forAria("the second one", WAITING);
  forAria("I think it slopes down because people buy less", WAITING);
});

test("a side conversation is not an answer, even while Aria waits", () => {
  notForAria("pass me the charger", WAITING);
  notForAria("hey Sam did you lock the door", WAITING);
  notForAria("I'll call you back", WAITING);
});

test("whispered short commands and pauses still parse", () => {
  forAria("aria... slower", LECTURING);
  forAria("so — so why is it, um, why is it negative?", LECTURING);
});

test("every verdict names the rule that decided it", () => {
  for (const text of ["stop", "aria hi", "hey Sam", "pass me that", "okay", "why is the sign negative", "xyzzy"]) {
    const v = classifyAddressing(text, LECTURING);
    assert.ok(v.reason.length > 0, `no reason for "${text}"`);
  }
});

test("topicWordsFrom drops stopwords and short tokens and lowercases", () => {
  const words = topicWordsFrom("The Demand Curve", "why it slopes DOWNWARD");
  assert.ok(words.has("demand") && words.has("curve") && words.has("slopes") && words.has("downward"));
  assert.ok(!words.has("the") && !words.has("why") && !words.has("it"));
});
