/**
 * WHAT A SPOKEN ANSWER TO A PLANNING QUESTION MEANT.
 *
 * The planning screen shows one question with answer cards (A, B, C…). A spoken answer used to count
 * only if it contained the first word of a card, or the whole card, verbatim — so "I know a little
 * bit", "the second one", "B" or "no idea" were all silently dropped and the question just sat there
 * (reported 2026-09-29: "the voice input doesn't really work nicely while planning"). The strictness
 * existed for a real reason: a cough, a word from the room, or Aria's own voice echoing back as she
 * read the question used to "answer" it. This keeps that protection and accepts the ways people
 * actually answer out loud:
 *   - the card's letter or position: "B", "option b", "the second one", "the last one";
 *   - the card in their own words: its distinctive words, in any order ("basics, I know those");
 *   - not knowing: "not sure", "no idea", "I don't know" (the "Not sure" card when there is one);
 *   - skipping: "just teach me", "skip", "let's start";
 *   - any real sentence of their own — graded like a typed answer.
 * and still ignores: one stray word that names no card, and anything that is mostly Aria's own
 * last line coming back through the microphone.
 */

export type SpokenAnswer = { kind: "option"; option: string } | { kind: "free"; text: string };

const STOP = new Set(
  "a an the and or but of to in on at by for with is are was be it its i im i'm me my we you your this that it's just really so very bit some any about think know".split(" "),
);

function normalise(text: string): string {
  return text.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function contentWords(text: string): string[] {
  return normalise(text).split(" ").filter((w) => w.length >= 3 && !STOP.has(w));
}

const ORDINALS: Record<string, number> = { first: 0, one: 0, second: 1, two: 1, third: 2, three: 2, fourth: 3, four: 3, fifth: 4, five: 4 };
const NOT_SURE = /\b(?:not sure|no idea|dont know|do not know|no clue|not really sure|unsure|havent heard|never heard)\b/;
const SKIP = /\b(?:just teach(?: me)?|skip(?: it| this)?|start the (?:lesson|lecture)|lets (?:just )?start|get started)\b/;

/** Which card a spoken reference by letter or position picks, or -1. */
function byPosition(spoken: string, count: number): number {
  const letter = /^(?:(?:option|answer|letter)\s+)?([a-e])(?:\s+(?:please|i think))?$/.exec(spoken) ?? /\b(?:option|answer|letter)\s+([a-e])\b/.exec(spoken);
  if (letter) return letter[1].charCodeAt(0) - 97;
  if (/\b(?:the )?last (?:one|option)\b/.test(spoken)) return count - 1;
  const ordinal = /\b(?:the )?(first|second|third|fourth|fifth)(?: one| option)?\b/.exec(spoken) ?? /\b(?:option|number) (one|two|three|four|five)\b/.exec(spoken);
  if (ordinal) return ORDINALS[ordinal[1]];
  return -1;
}

/**
 * The answer a final student transcript gives to the question on screen, or null to ignore it.
 * `echoOf` is Aria's own last spoken line: a transcript mostly made of it is her voice, not theirs.
 */
export function matchSpokenAnswer(text: string, options: string[], echoOf = ""): SpokenAnswer | null {
  const spoken = normalise(text);
  if (!spoken) return null;
  const words = spoken.split(" ");

  // Her own voice through the microphone: most of its words are in what she just said.
  const echoWords = new Set(contentWords(echoOf));
  const mine = contentWords(spoken);
  if (echoWords.size && mine.length >= 2 && mine.filter((w) => echoWords.has(w)).length / mine.length >= 0.75) return null;

  if (SKIP.test(spoken)) return { kind: "free", text: "Just teach me" };

  if (options.length) {
    const position = byPosition(spoken, options.length);
    if (position >= 0 && position < options.length) return { kind: "option", option: options[position] };

    if (NOT_SURE.test(spoken)) {
      const unsure = options.find((o) => /\bnot sure\b|\bno idea\b/i.test(o));
      return unsure ? { kind: "option", option: unsure } : { kind: "free", text: text.trim() };
    }

    // Their words against each card's words: a card whose distinctive words they said.
    const cards = options.map((option) => contentWords(option));
    const scores = cards.map((card) => {
      if (!card.length) return 0;
      const hits = card.filter((w) => mine.includes(w) || mine.some((m) => m.length >= 5 && (m.startsWith(w.slice(0, 5)) || w.startsWith(m.slice(0, 5))))).length;
      // A word only this card has is worth more than one several cards share.
      const unique = card.filter((w) => mine.includes(w) && cards.filter((c) => c.includes(w)).length === 1).length;
      return hits / card.length + unique * 0.5;
    });
    const best = Math.max(...scores);
    const winners = scores.filter((s) => s === best).length;
    if (best >= 0.5 && winners === 1) return { kind: "option", option: options[scores.indexOf(best)] };
  } else if (NOT_SURE.test(spoken)) {
    return { kind: "free", text: text.trim() };
  }

  // Their own answer: a real phrase, not a stray word from the room. Beside answer cards it takes a
  // little more to count ("yes please" picks nothing); an open question takes any short phrase.
  if (words.length >= (options.length ? 3 : 2) && mine.length >= 1) return { kind: "free", text: text.trim() };
  return null;
}
