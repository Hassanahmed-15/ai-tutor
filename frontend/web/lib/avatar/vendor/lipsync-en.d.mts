/** TalkingHead's English text→Oculus-viseme rules (met4citizen, MIT), vendored as-is. */
export class LipsyncEn {
  constructor();
  /** Numbers to words, symbols spoken, diacritics dropped. */
  preProcessText(s: string): string;
  /** One word (or phrase) → visemes with relative start times and durations (units of one average viseme). */
  wordsToVisemes(w: string): { words: string; visemes: string[]; times: number[]; durations: number[]; i: number };
}
