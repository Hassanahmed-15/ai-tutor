/**
 * Hand-written maths boards that use the Visuals Lab figures (2026-10-20): the Pythagoras
 * rearrangement proof, completing the square as an area, expanding brackets as an area, and a
 * "solve for x" equation board that gets a mid-board prediction. For looking at them in the canvas
 * lab (`/canvas-lab?scrub=1&fixture=visuals`, development only) and for tests.
 */
export const MATHS_VISUAL_FIXTURES: Array<{ id: string; script: string; raw: Record<string, unknown> }> = [
  {
    id: "v1",
    script:
      "Take any right-angled triangle with shorter sides a and b and hypotenuse c. " +
      "Fit four copies of it into a square whose side is a plus b. " +
      "The gap in the middle is a tilted square with side c, so its area is c squared. " +
      "Now slide three of the triangles, keeping the same square. " +
      "The gaps are now a square a by a, " +
      "and a square b by b. " +
      "Same square, same four triangles, so c squared equals a squared plus b squared.",
    raw: {
      heading: "Proving Pythagoras' theorem",
      notes: [{ text: "same square, same triangles", s: 3 }, { text: "c² = a² + b²", s: 6 }],
      stage: {
        kind: "figure",
        component: "pythagorasProof",
        params: { a: 3, b: 4 },
        parts: [
          { id: "square", name: "Square of side a + b", s: 1 },
          { id: "triangles", name: "Four copies of the triangle", s: 1 },
          { id: "c-square", name: "Square on the hypotenuse, c²", s: 2 },
          { id: "step-slide", name: "The triangles slide", s: 3 },
          { id: "a-square", name: "Square a²", s: 4 },
          { id: "b-square", name: "Square b²", s: 5 },
        ],
      },
      cues: [{ s: 2, action: "point", target: "c-square" }],
    },
  },
  {
    id: "v2",
    script:
      "Here is x squared plus six x drawn as areas: a square x by x, and a strip six wide. " +
      "Cut the strip in half, two strips three wide. " +
      "Move one half under the square. " +
      "One corner is missing: three by three, which is nine. " +
      "Add that nine and you have a complete square, x plus three on each side, so x squared plus six x is x plus three, all squared, minus nine.",
    raw: {
      heading: "Completing the square as an area",
      notes: [{ text: "half of 6 is 3", s: 1 }, { text: "x² + 6x = (x + 3)² − 9", s: 4 }],
      stage: {
        kind: "figure",
        component: "areaModel",
        params: { mode: "complete-square", b: 6 },
        parts: [
          { id: "x-squared", name: "x² (an x by x square)", s: 0 },
          { id: "x-term", name: "6x as a strip", s: 0 },
          { id: "step-split", name: "Cut 6x into two 3x strips", s: 1 },
          { id: "step-move", name: "Move one strip under the square", s: 2 },
          { id: "corner", name: "The missing corner, 3² = 9", s: 3 },
          { id: "complete", name: "The square (x + 3)²", s: 4 },
        ],
      },
      cues: [{ s: 3, action: "point", target: "corner" }],
    },
  },
  {
    id: "v3",
    script:
      "To expand x plus three times x plus two, draw a rectangle. " +
      "The big square is x squared. " +
      "Along the top, x times three is three x. " +
      "Down the side, two times x is two x. " +
      "And the corner is three times two, six, so the whole area is x squared plus five x plus six.",
    raw: {
      heading: "Expanding brackets as an area",
      notes: [{ text: "(x + 3)(x + 2) = x² + 5x + 6", s: 4 }],
      stage: {
        kind: "figure",
        component: "areaModel",
        params: { mode: "expand", p: 3, q: 2 },
        parts: [
          { id: "x-squared", name: "x²", s: 1 },
          { id: "x-term", name: "3x", s: 2 },
          { id: "x-term-2", name: "2x", s: 3 },
          { id: "number", name: "6", s: 4 },
        ],
      },
      cues: [],
    },
  },
  {
    id: "v4",
    script:
      "Solve two x plus three equals eleven. " +
      "Take three from both sides: two x equals eight. " +
      "Divide both sides by two: x equals four.",
    raw: {
      heading: "Solving a linear equation",
      notes: [{ text: "undo the + 3, then the × 2", s: 1 }],
      stage: {
        kind: "equation",
        tokens: [
          { id: "lhs", text: "2x", tex: "2x", color: "#2563eb" },
          { id: "plus", text: "+", tex: "+" },
          { id: "three", text: "3", tex: "3", color: "#d97706" },
          { id: "eq", text: "=", tex: "=" },
          { id: "eleven", text: "11", tex: "11" },
          { id: "eight", text: "8", tex: "8" },
          { id: "x", text: "x", tex: "x", color: "#2563eb" },
          { id: "four", text: "4", tex: "4", color: "#16a34a" },
        ],
        steps: [
          { s: 0, order: ["lhs", "plus", "three", "eq", "eleven"], caption: "The equation" },
          { s: 1, order: ["lhs", "eq", "eight"], caption: "− 3 from both sides" },
          { s: 2, order: ["x", "eq", "four"], caption: "÷ 2 on both sides" },
        ],
      },
      cues: [],
    },
  },
];

/** A recursion code board with its call stack (CodeStage.steps[].stack), for the same canvas-lab view. */
export const CS_VISUAL_FIXTURES: Array<{ id: string; script: string; raw: Record<string, unknown> }> = [
  {
    id: "c0",
    script:
      "We start count at three, so the loop has a value to test. " +
      "The while line checks that count is above zero, which is true. " +
      "The body prints three. " +
      "Then count drops to two, and the condition is checked again. " +
      "After printing two and one, count reaches zero, the condition is false, and the loop ends.",
    raw: {
      heading: "Tracing a while loop",
      notes: [],
      stage: {
        kind: "code",
        language: "python",
        lines: ["count = 3", "while count > 0:", "    print(count)", "    count -= 1", "print(\"done\")"],
        steps: [
          { s: 0, lines: [1], state: { count: 3 } },
          { s: 1, lines: [2], state: { count: 3 } },
          { s: 2, lines: [3], state: { count: 3 } },
          { s: 3, lines: [4], state: { count: 2 } },
          { s: 4, lines: [4], state: { count: 0 } },
        ],
        output: { s: 4, text: "3\n2\n1" },
      },
      cues: [],
    },
  },
  {
    id: "c1",
    script:
      "The program asks for factorial of three. " +
      "Three is not one or less, so this call waits for three times factorial of two, and a new call starts. " +
      "Two waits for two times factorial of one, and factorial of one starts. " +
      "One is one or less, so factorial of one returns one at once: the base case. " +
      "That one goes back up: two times one is two, so factorial of two returns two. " +
      "Then three times two is six: factorial of three returns six. " +
      "Every call has finished, and the program prints six.",
    raw: {
      heading: "How factorial(3) runs",
      notes: [{ text: "each call waits for the next", s: 1 }],
      stage: {
        kind: "code",
        language: "python",
        lines: ["def factorial(n):", "    if n <= 1:", "        return 1", "    return n * factorial(n - 1)", "", "print(factorial(3))"],
        groups: [{ from: 2, to: 3, label: "base case", s: 3 }, { from: 4, to: 4, label: "recursive case", s: 1 }],
        steps: [
          { s: 0, lines: [6, 1], stack: [{ call: "factorial(3)", value: "n = 3" }] },
          { s: 1, lines: [2, 4], stack: [{ call: "factorial(3)", value: "waits for 3 × ?" }, { call: "factorial(2)", value: "n = 2" }] },
          { s: 2, lines: [2, 4], stack: [{ call: "factorial(3)", value: "waits for 3 × ?" }, { call: "factorial(2)", value: "waits for 2 × ?" }, { call: "factorial(1)", value: "n = 1" }] },
          { s: 3, lines: [2, 3], stack: [{ call: "factorial(3)", value: "waits for 3 × ?" }, { call: "factorial(2)", value: "waits for 2 × ?" }, { call: "factorial(1)", value: "returns 1" }] },
          { s: 4, lines: [4], stack: [{ call: "factorial(3)", value: "waits for 3 × ?" }, { call: "factorial(2)", value: "2 × 1 = 2, returns 2" }] },
          { s: 5, lines: [4], stack: [{ call: "factorial(3)", value: "3 × 2 = 6, returns 6" }] },
          { s: 6, lines: [6], stack: [] },
        ],
        output: { s: 6, text: "6" },
      },
      cues: [{ s: 3, action: "point", target: "frame-3" }],
    },
  },
];

/** Sketch boards (CanvasStage "sketch"), written the way the board writer is asked to (lib/canvas/sketch.ts SKETCH_GUIDE). */
export const SKETCH_FIXTURES: Array<{ id: string; script: string; raw: Record<string, unknown> }> = [
  {
    id: "k1",
    script:
      "Draw x squared plus six x as areas: a square x by x, and a strip six wide. " +
      "Cut the strip in half and move one half under the square. " +
      "One corner is missing, three by three, which is nine. " +
      "So x squared plus six x equals x plus three, all squared, minus nine. " +
      "Add five to both sides: x squared plus six x plus five is x plus three, all squared, minus four.",
    raw: {
      heading: "Completing the square",
      notes: [],
      stage: {
        kind: "sketch",
        items: [
          {
            id: "area", type: "shapes", s: 0, at: { x: 0.5, y: 0, w: 6, h: 8 }, grid: { w: 10, h: 10 },
            shapes: [
              { id: "sq", kind: "rect", x: 1, y: 1, w: 5, h: 5, color: "blue", fill: true, label: "$x^2$", s: 0 },
              { id: "half-a", kind: "rect", x: 6, y: 1, w: 1.5, h: 5, color: "orange", fill: true, label: "$3x$", s: 0 },
              { id: "half-b", kind: "rect", x: 7.5, y: 1, w: 1.5, h: 5, color: "orange", fill: true, s: 0, move: { s: 1, to: { x: 1, y: 6 }, rotate: 90 }, label: "$3x$" },
              { id: "corner", kind: "rect", x: 6, y: 6, w: 1.5, h: 1.5, color: "green", dashed: true, label: "9", s: 2 },
            ],
          },
          {
            id: "working", type: "math", s: 0, at: { x: 6.8, y: 0.5, w: 5.2, h: 6 },
            lines: [
              { s: 0, tex: "\\blue{x^2} + \\orange{6x}", label: "① the areas" },
              { s: 2, tex: "\\orange{6} \\div 2 = \\orange{3},\\ \\orange{3}^2 = \\green{9}", label: "② half, squared" },
              { s: 3, tex: "\\blue{x^2} + \\orange{6x} = (x + \\orange{3})^2 - \\green{9}", label: "③ borrow 9" },
              { s: 4, tex: "\\blue{x^2} + \\orange{6x} + \\pink{5} = (x + \\orange{3})^2 - \\pink{4}", label: "④ tidy" },
            ],
          },
        ],
      },
      cues: [{ s: 2, action: "point", target: "corner" }],
    },
  },
  {
    id: "k2",
    script:
      "Here is y equals x squared, sitting at the origin. " +
      "Plus three inside the bracket slides it three to the left, and minus four drops it four down. " +
      "The lowest point is now at minus three, minus four.",
    raw: {
      heading: "Reading the vertex",
      notes: [],
      stage: {
        kind: "sketch",
        items: [
          { id: "form", type: "math", s: 0, col: "left", lines: [{ s: 0, tex: "y = (x \\orange{+ 3})^2 \\pink{- 4}" }, { s: 2, tex: "\\text{vertex } (\\orange{-3},\\ \\pink{-4})" }] },
          { id: "rule", type: "text", s: 1, col: "left", text: "inside the bracket: left/right, outside: up/down", size: "small", color: "muted" },
          {
            id: "plot", type: "graph", s: 0, col: "right", x: [-7, 3], y: [-5, 9],
            curves: [
              { id: "real", expr: "x^2 + 6*x + 5", s: 2 },
              { id: "ghost", expr: "x^2", dashed: true, color: "blue", s: 0, shift: { s: 1, dx: -3, dy: -4 } },
            ],
            points: [{ id: "vertex", x: -3, y: -4, label: "$(-3, -4)$", color: "pink", s: 2 }],
          },
        ],
      },
      cues: [],
    },
  },
  {
    id: "k3",
    script:
      "Bubble sort compares neighbours and swaps them when they are in the wrong order. " +
      "Five and two are the wrong way round, so they swap. " +
      "Five and eight are fine, so they stay. " +
      "After the first pass the largest value has bubbled to the end.",
    raw: {
      heading: "One pass of bubble sort",
      notes: [],
      stage: {
        kind: "sketch",
        items: [
          {
            id: "array", type: "shapes", s: 0, col: "full", grid: { w: 16, h: 4 },
            shapes: [
              { id: "c5", kind: "rect", x: 2, y: 1, w: 2, h: 2, label: "5", color: "orange", fill: true, s: 0, move: { s: 1, to: { x: 4, y: 1 } } },
              { id: "c2", kind: "rect", x: 4, y: 1, w: 2, h: 2, label: "2", color: "blue", fill: true, s: 0, move: { s: 1, to: { x: 2, y: 1 } } },
              { id: "c8", kind: "rect", x: 6, y: 1, w: 2, h: 2, label: "8", color: "ink", s: 0 },
              { id: "c1", kind: "rect", x: 8, y: 1, w: 2, h: 2, label: "1", color: "ink", s: 0 },
              { id: "c4", kind: "rect", x: 10, y: 1, w: 2, h: 2, label: "4", color: "ink", s: 0 },
              { id: "swap", kind: "label", x: 5, y: 3.6, label: "swap!", color: "pink", s: 1 },
            ],
          },
          { id: "trace", type: "table", s: 1, col: "left", headers: ["Compare", "Swap?", "List"], rows: [{ s: 1, cells: ["5, 2", "yes", "2 5 8 1 4"] }, { s: 2, cells: ["5, 8", "no", "2 5 8 1 4"] }, { s: 3, cells: ["…", "…", "2 5 1 4 8"] }] },
          { id: "code", type: "code", s: 0, col: "right", language: "python", lines: ["for i in range(n - 1):", "    if a[i] > a[i + 1]:", "        a[i], a[i + 1] = a[i + 1], a[i]"], steps: [{ s: 1, line: 3, note: "swap" }, { s: 2, line: 2 }] },
        ],
      },
      cues: [],
    },
  },
];

/** A logic-circuit board (figure "logicCircuit"): gates drawn by code from the expression, truth table computed. */
export const LOGIC_FIXTURES: Array<{ id: string; script: string; raw: Record<string, unknown> }> = [
  {
    id: "g1",
    script: "The warning light comes on when door A or door B is open. But it must stay off while the reset R is pressed. So the circuit is A OR B, then AND with NOT R. The truth table shows every case: the light is on in three of the eight rows.",
    raw: {
      heading: "A warning-light circuit",
      notes: [],
      stage: { kind: "figure", component: "logicCircuit", params: { expression: "(A OR B) AND NOT R", output: "Light" }, parts: [{ id: "inputs", name: "Inputs", s: 0 }, { id: "gate-1", name: "OR gate", s: 0 }, { id: "gate-2", name: "NOT gate", s: 1 }, { id: "gate-3", name: "AND gate", s: 2 }, { id: "output", name: "Light", s: 2 }, { id: "truth-table", name: "Truth table", s: 3 }] },
      cues: [],
    },
  },
];
