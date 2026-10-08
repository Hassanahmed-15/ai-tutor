/**
 * THE WORDS' MOUTH SHAPES: TalkingHead's English text→Oculus-viseme rules (met4citizen, MIT, vendored
 * in ./vendor), loaded once and shared by every voice — the live tutor's script (lib/adhd/mouth.ts)
 * and the lecture narration's per-clip alignment (./clipLipSync.ts).
 */
export type LipsyncRules = {
  preProcessText: (s: string) => string;
  wordsToVisemes: (w: string) => { visemes: string[]; durations: number[] };
};

let rulesPromise: Promise<LipsyncRules | null> | null = null;

export function loadLipsyncRules(): Promise<LipsyncRules | null> {
  rulesPromise ??= import("./vendor/lipsync-en.mjs")
    .then((m) => {
      const rules = new m.LipsyncEn() as LipsyncRules & { rules?: Record<string, { visemes: string[] }[]> };
      // TalkingHead gives "w" the f/v shape (lower lip under the teeth). On a real face a "w" is a
      // rounded lip, as in "oo": "we", "was", "with" are among a lecture's commonest words.
      for (const rule of rules.rules?.W ?? []) rule.visemes = rule.visemes.map((v) => (v === "FF" ? "U" : v));
      return rules as LipsyncRules;
    })
    .catch((error) => {
      console.warn("[mouth] text rules unavailable:", error);
      return null;
    });
  return rulesPromise;
}

/** A sentence's words as rule output, each with the raw word (for its punctuation). */
export function wordsOf(rules: LipsyncRules, text: string): Array<{ word: string; visemes: string[]; durations: number[] }> {
  const out: Array<{ word: string; visemes: string[]; durations: number[] }> = [];
  for (const raw of rules.preProcessText(text).split(/\s+/)) {
    const w = raw.replace(/[^A-Za-z']/g, "");
    if (!w) continue;
    const r = rules.wordsToVisemes(w);
    out.push({ word: raw, visemes: r.visemes, durations: r.durations });
  }
  return out;
}
