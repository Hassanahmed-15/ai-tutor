/**
 * Hand-written equation boards, as the board model should write them — every term typeset by KaTeX
 * ("tex") and every equation the narration says written whole. For looking at them in the canvas lab
 * (`/canvas-lab?scrub=1&fixture=math`, development only) and for lib/anim/equationBoards.test.ts.
 * The first is the "Collecting like terms" board of the 2026-10-16 lecture, done right.
 */
export const EQUATION_FIXTURES: Array<{ id: string; script: string; raw: Record<string, unknown> }> = [
  {
    id: "m1",
    script:
      "Like terms have the same variables raised to the same powers. " +
      "Start with 5a + 3b − 2a + 4b, and find the terms that match. " +
      "Then group matching terms: (5a − 2a) + (3b + 4b) = 3a + 7b. " +
      "Only matching quantities can be combined, just as matching units can be combined.",
    raw: {
      heading: "Collecting like terms",
      notes: [{ text: "same variables, same powers", s: 0 }],
      stage: {
        kind: "equation",
        tokens: [
          { id: "a5", text: "5a", tex: "5a", color: "#0f766e" },
          { id: "plus-1", text: "+", tex: "+" },
          { id: "b3", text: "3b", tex: "3b", color: "#2563eb" },
          { id: "minus-1", text: "−", tex: "-" },
          { id: "a2", text: "2a", tex: "2a", color: "#0f766e" },
          { id: "plus-2", text: "+", tex: "+" },
          { id: "b4", text: "4b", tex: "4b", color: "#2563eb" },
          { id: "a-group", text: "(5a − 2a)", tex: "(5a - 2a)", color: "#0f766e" },
          { id: "plus-3", text: "+", tex: "+" },
          { id: "b-group", text: "(3b + 4b)", tex: "(3b + 4b)", color: "#2563eb" },
          { id: "equals", text: "=", tex: "=" },
          { id: "result", text: "3a + 7b", tex: "3a + 7b", color: "#c2410c" },
        ],
        steps: [
          { s: 0, order: ["a5", "plus-1", "b3", "minus-1", "a2", "plus-2", "b4"], highlight: [], caption: "An expression" },
          { s: 1, order: ["a5", "plus-1", "b3", "minus-1", "a2", "plus-2", "b4"], highlight: ["a5", "a2"], caption: "Match variables and powers" },
          { s: 2, order: ["a-group", "plus-3", "b-group", "equals", "result"], highlight: ["result"], caption: "Group, then combine" },
          { s: 3, order: ["a-group", "plus-3", "b-group", "equals", "result"], highlight: ["a-group", "b-group"], caption: "Only like terms combine" },
        ],
      },
      cues: [{ s: 2, action: "circle", target: "result" }],
    },
  },
  {
    id: "m2",
    script:
      "To add algebraic fractions, use a common denominator, just as with numbers. " +
      "For x/3 + (x − 4)/2, the common denominator is 6. " +
      "Rewrite both fractions over 6, then combine the numerators: x/3 + (x − 4)/2 = 2x/6 + 3(x − 4)/6 = (5x − 12)/6. " +
      "Expanding and collecting the top gives the answer.",
    raw: {
      heading: "Adding algebraic fractions",
      notes: [],
      stage: {
        kind: "equation",
        tokens: [
          { id: "f1", text: "x/3", tex: "\\frac{x}{3}" },
          { id: "plus-1", text: "+", tex: "+" },
          { id: "f2", text: "(x − 4)/2", tex: "\\frac{x - 4}{2}" },
          { id: "eq-1", text: "=", tex: "=" },
          { id: "f3", text: "2x/6", tex: "\\frac{2x}{6}", color: "#2563eb" },
          { id: "plus-2", text: "+", tex: "+" },
          { id: "f4", text: "3(x − 4)/6", tex: "\\frac{3(x - 4)}{6}", color: "#2563eb" },
          { id: "eq-2", text: "=", tex: "=" },
          { id: "result", text: "(5x − 12)/6", tex: "\\frac{5x - 12}{6}", color: "#c2410c" },
        ],
        steps: [
          { s: 0, order: ["f1", "plus-1", "f2"], caption: "Two fractions" },
          { s: 1, order: ["f1", "plus-1", "f2"], highlight: ["f1", "f2"], caption: "Common denominator: 6" },
          { s: 2, order: ["f1", "plus-1", "f2", "eq-1", "f3", "plus-2", "f4", "eq-2", "result"], highlight: ["result"], caption: "Same denominator, then combine" },
          { s: 3, order: ["f3", "plus-2", "f4", "eq-2", "result"], highlight: ["result"] },
        ],
      },
      cues: [],
    },
  },
];
