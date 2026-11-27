import { test } from "node:test";
import assert from "node:assert/strict";
import { takeSentences } from "../useGeminiLiveTutor";

// The planning chat in the cloned voice speaks one sentence per call, starting as soon as the first is whole.

test("a finished sentence is taken as soon as the next one starts", () => {
  const { sentences, rest } = takeSentences("Which parts of vaccines have you met before? You can tick");
  assert.deepEqual(sentences, ["Which parts of vaccines have you met before?"]);
  assert.equal(rest, "You can tick");
});

test("a sentence still arriving waits, even with no punctuation yet", () => {
  assert.deepEqual(takeSentences("Great, let me think about"), { sentences: [], rest: "Great, let me think about" });
});

test("a very short sentence is joined to the next, so it costs one wait, not two", () => {
  const { sentences, rest } = takeSentences("Nice. That tells me where to start. Next");
  assert.deepEqual(sentences, ["Nice. That tells me where to start."]);
  assert.equal(rest, "Next");
});

test("a sentence ending at the end of the text so far waits for what follows", () => {
  // The transcript arrives in pieces: "...before?" may be followed by more on the same line.
  assert.deepEqual(takeSentences("Which parts have you met before?").sentences, []);
});

test("a long sentence is cut at a clause, so its first half is spoken while the rest arrives", () => {
  const { sentences, rest } = takeSentences("Feel free to let me know about immune defenses, antigen recognition, immune memory, the vaccination process, or protection");
  assert.deepEqual(sentences, ["Feel free to let me know about immune defenses, antigen recognition,"]);
  assert.equal(rest, "immune memory, the vaccination process, or protection");
});

test("a dash ends a long clause too, but a short clause is never cut", () => {
  assert.deepEqual(takeSentences("Hello, Sam, which parts").sentences, []);
  const { sentences } = takeSentences("Tick the ones you know about vaccines and the immune system — or say it is all new. Then");
  assert.deepEqual(sentences, ["Tick the ones you know about vaccines and the immune system —", "or say it is all new."]);
});

test("several sentences in one piece come out in order, quotes and brackets kept", () => {
  const { sentences } = takeSentences('You said "antigens are new to me." Good to know! Then we start with antigens (the flags). And');
  assert.deepEqual(sentences, ['You said "antigens are new to me."', "Good to know! Then we start with antigens (the flags)."]);
});
