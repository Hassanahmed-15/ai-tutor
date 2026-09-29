/**
 * Motion boards on the server render (renderStaticFrame), which every rendered-output check — the
 * layout check, label grounding, both vision critics — depends on. Motion cannot run there, so each
 * motion element must render as its plain SVG element settled at its `animate` target: the frame the
 * student's sandbox shows once the glide lands. If this breaks, a Motion board would throw here and
 * every quality check would silently score nothing (see RenderedFrame's "component" failure).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

async function render(code: string, base?: object) {
  const { renderStaticFrame } = await import("../reactAnimationVisionCritic");
  const frame = await renderStaticFrame(code, undefined, base);
  assert.equal(frame.failure, undefined, frame.failure?.message);
  return frame.svg ?? "";
}

test("a motion element renders as its SVG element at its animate target, without Motion's props", async () => {
  const svg = await render(`export default function Animation({ progress }) {
    const SPRING = { type: "spring", stiffness: 140, damping: 24 };
    return (
      <svg viewBox="0 0 1000 560">
        <g data-teach-order="1" data-teach-kind="diagram" data-teach-weight="1" data-teach-sentence="0">
          <motion.circle cx="200" cy="200" initial={false} animate={{ r: 10 + 30 * phase(progress, 0, 1), fill: "#e05a4f" }} transition={SPRING} />
          <motion.g initial={false} animate={{ y: 60 * phase(progress, 0.5, 1) }} transition={SPRING}>
            <rect x="400" y="100" width="80" height="40" />
          </motion.g>
        </g>
      </svg>
    );
  }`);
  assert.match(svg, /<circle cx="200" cy="200" r="40" fill="#e05a4f"/, "r and fill settle at progress=1");
  assert.match(svg, /<g transform="translate\(0 60\)"><rect/, "y is a translation, written as an attribute resvg honours");
  assert.doesNotMatch(svg, /initial|animate|transition|stiffness/, "Motion's own props never reach the markup");
  assert.match(svg, /<g data-teach-order="1"/, "the host's reveal step is untouched");
});

test("scale and rotate pivot on the element's centre, as Motion's do on SVG", async () => {
  const svg = await render(`export default function Animation({ progress }) {
    return (
      <svg viewBox="0 0 1000 560">
        <motion.circle cx="100" cy="150" r="20" initial={false} animate={{ scale: 2 }} />
        <motion.g initial={false} animate={{ rotate: 90 }}>
          <rect x="300" y="100" width="100" height="40" />
          <line x1="300" y1="200" x2="400" y2="200" />
        </motion.g>
      </svg>
    );
  }`);
  assert.match(svg, /<circle cx="100" cy="150" r="20" transform="translate\(100 150\) scale\(2 2\) translate\(-100 -150\)"/);
  assert.match(svg, /<g transform="translate\(350 150\) rotate\(90\) translate\(-350 -150\)">/, "a group's centre comes from its children");
});

test("keyframe arrays settle on their last value, and resting targets leave no transform", async () => {
  const svg = await render(`export default function Animation({ progress }) {
    return (
      <svg viewBox="0 0 1000 560">
        <motion.rect x="10" y="10" width="20" height="20" initial={false} animate={{ x: [0, 30, 0], fill: ["#000", "#fff"] }} />
      </svg>
    );
  }`);
  assert.match(svg, /<rect x="10" y="10" width="20" height="20" fill="#fff"><\/rect>/);
});

test("an import of Motion resolves, and a board's own `motion` variable still renders", async () => {
  const imported = await render(`import { motion } from "framer-motion";
  export default function Animation({ progress }) {
    return <svg viewBox="0 0 1000 560"><motion.circle cx="50" cy="50" r="5" initial={false} animate={{ x: 10 }} /></svg>;
  }`);
  assert.match(imported, /<circle cx="50" cy="50" r="5" transform="translate\(10 0\)"/);

  // Boards generated before Motion sometimes named a progress variable `motion`.
  const shadowing = await render(`const motion = 0.5;
  export default function Animation({ progress }) {
    return <svg viewBox="0 0 1000 560"><circle cx="50" cy="50" r={10 * motion} /></svg>;
  }`);
  assert.match(shadowing, /<circle cx="50" cy="50" r="5"/);
});

test("THE NEXT.JS CASE: Motion boards render through the react-server build too", async () => {
  const load = createRequire(__filename);
  const rscReact = load(load.resolve("react").replace(/index\.js$/, "react.react-server.js"));
  const svg = await render(`export default function Animation({ progress }) {
    return <svg viewBox="0 0 1000 560"><motion.g initial={false} animate={{ x: 25 }}><rect x="0" y="0" width="10" height="10" /></motion.g>
      <BoardLabels sentence={9} sentenceProgress={1} labels={[{ text: "vent", x: 500, y: 200, sentence: 1 }]} /></svg>;
  }`, rscReact);
  assert.match(svg, /<g transform="translate\(25 0\)"><rect/);
  assert.match(svg, />vent<\/text>/, "BoardLabels renders with the react-server build's static hooks");
});

/*
 * THE MOTION BOARD CONTRACT: boards reveal themselves from the sentence clock. The code checker
 * (drawSanitize) and the server render must agree with the prompt, or every generated board is
 * rejected — or worse, passes while rendering blank.
 */
import { getReactAnimationCodeDiagnostics } from "../drawSanitize";
import { REACT_ANIMATION_SYSTEM_PROMPT } from "../drawPrompt";
import { isMotionBoard } from "./sandboxMotion";

function promptExample(): string {
  const match = REACT_ANIMATION_SYSTEM_PROMPT.match(/```jsx\n([\s\S]*?)```/);
  assert.ok(match, "the prompt carries a worked example");
  return match[1];
}

function motionBoard(opts: { steps: Array<[string, number]>; texts?: number }): string {
  const texts = Array.from({ length: opts.texts ?? 3 }, (_, i) => `<text x="710" y="${150 + i * 40}" fontSize="20">part ${i}</text>`).join("");
  const steps = opts.steps.map(([helper, n], i) => helper === "draw"
    ? `<motion.path d="M${300 + i * 10} 200 C 350 250 400 250 450 300" fill="none" stroke="#3f7cc0" initial={false} animate={draw(${n})} transition={DRAW} />`
    : `<motion.g initial={false} animate={reveal(${n})} transition={REVEAL}><path d="M${300 + i * 10} 200 L 340 260 L 300 300 Z" fill="#fbd9d4" /><circle cx="${400 + i * 5}" cy="300" r="12" fill="#dcebf8" /><ellipse cx="500" cy="${200 + i * 10}" rx="30" ry="12" fill="#e3968e" /><rect x="600" y="${150 + i * 20}" width="20" height="10" fill="#f0b39f" /></motion.g>`,
  ).join("\n");
  return `export default function Animation({ sentence, sentenceProgress }) {
  const on = (k) => sentence >= k;
  const reveal = (k) => ({ opacity: on(k) ? 1 : 0, y: on(k) ? 0 : 10 });
  const draw = (k) => ({ pathLength: on(k) ? 1 : 0, opacity: on(k) ? 1 : 0 });
  const REVEAL = { duration: 0.6, ease: "easeOut" };
  const DRAW = { duration: 1.1, ease: "easeInOut" };
  const visualSpec = { subject: "s", recognitionCues: [], requiredParts: [], forbiddenShortcuts: [] };
  const boardPlan = { composition: "figure", readingPath: [], reservedRegions: [] };
  const swell = 1 + 0.02 * thereAndBack(phase(sentenceProgress, 0, 1));
  return (
    <svg viewBox="0 0 1000 560">
      <g><g><g><g><g>
      ${texts}
      ${steps}
      </g></g></g></g></g>
    </svg>
  );
}`;
}

test("the prompt's worked example is a Motion board that the checker accepts and the server renders", async () => {
  const example = promptExample();
  assert.ok(isMotionBoard(example), "the example uses the sentence-clock signature");
  const diagnostics = getReactAnimationCodeDiagnostics(example);
  assert.equal(diagnostics.issue, null, `the example must pass its own checker: ${diagnostics.issue}`);
  assert.equal(diagnostics.motionBoard, true);
  assert.ok(diagnostics.timelineStepCount >= 8 && diagnostics.distinctTimelineSentences >= 3);
  assert.doesNotMatch(example, /data-teach/, "the example never teaches the retired attributes");
  assert.equal((example.match(/<text\b/g) ?? []).length, 4, "the example writes its title and three key notes — labels are listed");
  assert.match(example, /<BoardLabels side="right"/, "labels go to the right column; the notes hold the left");
  assert.ok(((example.match(/<BoardLabels\b[\s\S]*?\/>/)?.[0] ?? "").match(/\btext\s*:/g) ?? []).length <= 3, "at most three labels");
  assert.match(example, /<BoardLabels\b/, "labels go through BoardLabels");

  const svg = await render(example);
  assert.match(svg, />diaphragm<\/text>/, "every sentence is revealed on the finished frame");
  // Every revealed step is visible at the end (a label's highlight pill and ring are hidden unless
  // its sentence is being spoken — they are not steps).
  assert.doesNotMatch(svg, /<g opacity="0"/, "no step is left hidden at the end");
  for (const label of ["trachea", "left lung", "diaphragm"]) {
    assert.match(svg, new RegExp(`text-anchor="start">${label}</text>`), `BoardLabels writes "${label}" in the right column`);
  }
  for (const note of ["Air in via the trachea", "Branches feed both lungs", "Diaphragm drops → inhale"]) {
    assert.match(svg, new RegExp(`>${note}</text>`), `the note "${note}" is written`);
  }
});

test("a Motion board passes on reveal steps spread across sentences, not data-teach attributes", () => {
  const good = motionBoard({ steps: [["reveal", 0], ["reveal", 1], ["draw", 1], ["reveal", 2], ["draw", 3], ["reveal", 3], ["reveal", 4], ["draw", 4]] });
  const d = getReactAnimationCodeDiagnostics(good);
  assert.equal(d.issue, null, d.issue ?? "");
  assert.equal(d.timelineStepCount, 8);
  assert.equal(d.distinctTimelineSentences, 5);
});

test("a Motion board is rejected for too few reveals, a front-loaded reveal, or too many labels", () => {
  const sparse = getReactAnimationCodeDiagnostics(motionBoard({ steps: [["reveal", 0], ["reveal", 1], ["draw", 2]] }));
  assert.match(sparse.issue ?? "", /sentence-synchronized reveal/);

  const frontLoaded = getReactAnimationCodeDiagnostics(motionBoard({ steps: Array.from({ length: 8 }, () => ["reveal", 0] as [string, number]) }));
  assert.match(frontLoaded.issue ?? "", /front-loaded/);

  const crowded = getReactAnimationCodeDiagnostics(motionBoard({ steps: [["reveal", 0], ["reveal", 1], ["draw", 1], ["reveal", 2], ["draw", 3], ["reveal", 3], ["reveal", 4], ["draw", 4]], texts: 10 }));
  assert.match(crowded.issue ?? "", /too many labels/);
  // Abstract diagrams write values inside their cells and nodes: those are content, not labels.
  const abstractBoard = getReactAnimationCodeDiagnostics(motionBoard({ steps: [["reveal", 0], ["reveal", 1], ["draw", 1], ["reveal", 2], ["draw", 3], ["reveal", 3], ["reveal", 4], ["draw", 4]], texts: 10 }), { abstract: true });
  assert.doesNotMatch(abstractBoard.issue ?? "", /too many labels/);
});

test("a timeline board saved before Motion is still recognised and judged as one", () => {
  assert.equal(isMotionBoard("export default function Animation({ progress }) { return null; }"), false);
  assert.equal(isMotionBoard("export default function Animation({ sentence, sentenceProgress }) { return null; }"), true);
  const legacy = getReactAnimationCodeDiagnostics("export default function Animation({ progress }) { return <svg viewBox=\"0 0 1000 560\" />; }");
  assert.equal(legacy.motionBoard, false);
  assert.doesNotMatch(legacy.issue ?? "", /export signature/, "the old signature is still accepted");
});

test("BoardLabels lays labels out so none can overlap, whatever points the model gives", async () => {
  // The reported board: four labels whose points sit 12-40 px apart on the right of a plot.
  const { renderStaticFrame } = await import("../reactAnimationVisionCritic");
  const frame = await renderStaticFrame(`export default function Animation({ sentence, sentenceProgress }) {
    return (
      <svg viewBox="0 0 1000 560">
        <text x="56" y="70" fontSize="32" fontWeight="800">Understanding Residuals</text>
        <BoardLabels sentence={sentence} sentenceProgress={sentenceProgress} labels={[
          { text: "observed value", x: 640, y: 316, sentence: 1 },
          { text: "residual", x: 660, y: 304, sentence: 2 },
          { text: "predicted value", x: 640, y: 356, sentence: 3 },
          { text: "regression model", x: 560, y: 380, sentence: 4 },
        ]} />
      </svg>
    );
  }`);
  assert.equal(frame.failure, undefined, frame.failure?.message);
  const rows = [...(frame.svg ?? "").matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*text-anchor="(start|end)">([^<]+)<\/text>/g)]
    .map((m) => ({ side: m[3], y: Number(m[2]), text: m[4] }));
  assert.equal(rows.length, 4);
  for (const side of ["start", "end"]) {
    const column = rows.filter((r) => r.side === side).sort((a, b) => a.y - b.y);
    for (let i = 1; i < column.length; i++) assert.ok(column[i].y - column[i - 1].y >= 40, `${column[i - 1].text} / ${column[i].text} are 40 apart`);
  }
  // Rows keep the order of their points, so leaders never cross: "residual" (y 304) above "observed value" (316).
  const right = rows.filter((r) => r.side === "start").sort((a, b) => a.y - b.y).map((r) => r.text);
  assert.ok(right.indexOf("residual") < right.indexOf("observed value"));
});

test("the pen is plain ES5 the sandbox can run as-is, and exposes start and pause", async () => {
  const { PEN_WRITER_SOURCE } = await import("./sandboxMotion");
  // The sandbox inlines it untranspiled: no arrows, no let/const, no template literals.
  assert.doesNotMatch(PEN_WRITER_SOURCE, /=>|\blet\s|\bconst\s|`/);
  const frames: Array<() => void> = [];
  const api = new Function("requestAnimationFrame", "document", `${PEN_WRITER_SOURCE}; return PEN;`)(
    (fn: () => void) => frames.push(fn),
    { querySelector: () => null }
  ) as { start: (i: number, p: number) => void; pause: (on: boolean) => void };
  assert.equal(typeof api.start, "function");
  assert.equal(typeof api.pause, "function");
  // With no board on screen the pen does nothing, and never throws.
  api.start(0, 0);
  api.pause(true);
  frames.shift()?.();
});
