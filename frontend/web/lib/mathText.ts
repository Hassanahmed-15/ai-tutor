/**
 * Maths inside chat answers. Models write LaTeX ("\(mg\sin 30^\circ\)") however often they are told
 * not to; shown raw it is unreadable and spoken raw it is nonsense (audit 2026-10-15). The chat
 * renders the maths with KaTeX (components/MathText.tsx) and the voice reads `speakableMath`.
 */
export type MathSegment = { kind: "text" | "math"; value: string; display: boolean };

/** Delimited TeX: \( … \), \[ … \], $$ … $$, and $ … $ only when it holds TeX (so "$5" stays money). */
const MATH = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\$([^$\n]*?[\\^_{][^$\n]*?)\$/g;

export function splitMath(text: string): MathSegment[] {
  const out: MathSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(MATH)) {
    if (m.index! > last) out.push({ kind: "text", value: text.slice(last, m.index), display: false });
    const tex = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    out.push({ kind: "math", value: tex.trim(), display: Boolean(m[2] ?? m[3]) });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ kind: "text", value: text.slice(last), display: false });
  return out;
}

export function hasMath(text: string): boolean {
  MATH.lastIndex = 0;
  return MATH.test(text);
}

const WORDS: Array<[RegExp, string]> = [
  [/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1 over $2"],
  [/\\sqrt\{([^{}]*)\}/g, "the square root of $1"],
  [/\^\{?\\circ\}?/g, " degrees"],
  [/\^\{?2\}?/g, " squared"],
  [/\^\{?3\}?/g, " cubed"],
  [/\^\{([^{}]*)\}/g, " to the power $1"],
  [/\^(\w)/g, " to the power $1"],
  [/_\{([^{}]*)\}/g, " $1"],
  [/_(\w)/g, " $1"],
  [/\\(?:text|mathrm|operatorname|mathbf)\{([^{}]*)\}/g, "$1"],
  [/\\times|\\cdot/g, " times "],
  [/\\approx/g, " approximately "],
  [/\\le(?:q)?\b/g, " less than or equal to "],
  [/\\ge(?:q)?\b/g, " greater than or equal to "],
  [/\\ne(?:q)?\b/g, " not equal to "],
  [/\\pm/g, " plus or minus "],
  [/\\Delta/g, " delta "],
  [/\\(alpha|beta|gamma|theta|lambda|mu|omega|pi|sigma|phi|rho|tau)\b/g, " $1 "],
  [/\\(sin|cos|tan|ln|log)\b/g, " $1 "],
  [/\\[,;:!]|\\quad|\\qquad/g, " "],
  [/\\left|\\right/g, ""],
  [/[{}]/g, ""],
  [/\\/g, ""],
];

/** The same text with its maths turned into words a voice can read ("m g sin 30 degrees"). */
export function speakableMath(text: string): string {
  return splitMath(text).map((seg) => {
    if (seg.kind === "text") return seg.value;
    let t = seg.value;
    for (const [re, rep] of WORDS) t = t.replace(re, rep);
    return t.replace(/=/g, " equals ").replace(/\s+/g, " ").trim();
  }).join("").replace(/\s+([,.;:])/g, "$1");
}
