import { contentStems } from "./sourceGrounding";

/**
 * WHICH PART OF A DOCUMENT A QUESTION IS ABOUT.
 *
 * Shared by the page (is what was typed a question about this document? lib/documentLessonPlanning.ts)
 * and by the planner (which blocks answer it? lib/progressivePlan.ts), so the two cannot disagree
 * about what a question is. No dependencies beyond the word stemmer, so either side can import it.
 */

/**
 * The words in more than half of a document's blocks. They name what the whole document is about
 * ("binary", "search", "tree" in a chapter on binary search trees), so they cannot tell its parts
 * apart; a question is matched on its other words. Too few blocks to judge, and nothing is topical.
 */
export function topicalStems(texts: string[]): Set<string> {
  const usable = texts.filter((text) => text.trim());
  if (usable.length < 3) return new Set();
  const counts = new Map<string, number>();
  for (const text of usable) for (const stem of new Set(contentStems(text))) counts.set(stem, (counts.get(stem) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count / usable.length > 0.5).map(([stem]) => stem));
}

/** The words that carry a question, and a matcher that forgives a one-letter typo. */
export function questionMatcher(question: string, topical: Set<string> = new Set()): { asked: Set<string>; isAsked: (stem: string) => boolean; namesSubject: boolean } {
  /*
   * Request verbs ("used", "show", "list") match every section and decided the ranking on their own
   * when the real word was misspelt: "what are datsets used" picked a section for saying "used" twice.
   */
  const filler = new Set(contentStems("pdf document paper here page slide explain mean meant use used using show tell give list describe mention work help process"));
  const all = new Set(contentStems(question).filter((stem) => !filler.has(stem)));
  // Words the whole document uses do not point at a part of it — unless they are all there is.
  const distinct = new Set([...all].filter((stem) => !topical.has(stem)));
  const asked = distinct.size > 0 ? distinct : all;
  /* A typo is still the word: "datsets" asks about datasets. One edit apart, on words of 5+ letters. */
  const oneEditApart = (a: string, b: string): boolean => {
    if (a === b) return true;
    if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++edits > 1) return false;
      if (a.length > b.length) i++;
      else if (b.length > a.length) j++;
      else { i++; j++; }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  };
  const askedList = [...asked];
  return {
    asked,
    isAsked: (stem: string) => asked.has(stem) || askedList.some((word) => oneEditApart(word, stem)),
    // Every word of it is one the whole document uses: it names the document's subject, not a part.
    namesSubject: all.size > 0 && distinct.size === 0,
  };
}

/**
 * THE BLOCKS THAT ANSWER A QUESTION, inside the sections that do.
 *
 * Narrowing by section was not enough: a textbook page is one section, and the page that holds the
 * one figure on insertion is otherwise about deletion. Kept whole, a strict lecture — told to teach
 * every selected block — taught the deletion too (reported 2026-10-03, tree del.pdf, "explain me
 * insertion process in bst"). A block is kept when it uses a word that carries the question, and a
 * kept figure caption brings its printed labels with it. Empty when nothing matches, so the caller
 * can keep what it had.
 */
export function questionBlocks(
  blocks: Array<{ id: string; text?: string; role?: string }>,
  question: string,
  topical: Set<string> = topicalStems(blocks.map((block) => block.text ?? "")),
): string[] {
  const { isAsked, namesSubject } = questionMatcher(question, topical);
  // "Explain binary search trees" against a chapter on them asks for the chapter: no narrowing.
  if (namesSubject) return [];
  const kept = new Set<string>();
  blocks.forEach((block, index) => {
    if (!contentStems(block.text ?? "").some(isAsked)) return;
    kept.add(block.id);
    // A figure's labels sit beside its caption; the caption alone cannot be taught from the figure.
    for (const neighbour of [blocks[index - 1], blocks[index + 1]]) {
      if (neighbour?.role === "figure-labels") kept.add(neighbour.id);
    }
  });
  return blocks.filter((block) => kept.has(block.id)).map((block) => block.id);
}
