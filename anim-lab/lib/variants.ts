import { sentences, type Beat } from "./lecture";

/**
 * Candidate prompts for PRODUCTION Motion boards, compared on one bench before any of them is
 * ported to frontend/web. Every variant writes the production contract —
 * `export default function Animation({ sentence, sentenceProgress })` with `motion` in scope — so
 * its boards render in the production sandbox exactly as a lesson would show them.
 */
export type Variant = { id: string; label: string; system: string; user: (beat: Beat) => string };

const CONTRACT = `CONTRACT
- Define exactly: export default function Animation({ sentence, sentenceProgress })
  - sentence: index of the sentence being spoken (0..N-1). sentence === N once the narration has finished: show everything.
  - sentenceProgress: 0..1 within the current sentence.
- Already in scope (never import): React, motion (the Motion library, formerly Framer Motion), and helpers lerp(a, b, t), clamp01(t), phase(t, start, end), smooth(t).
- Return one <svg viewBox="0 0 1000 560" width="100%" height="100%" style={{ display: "block" }}>.
- Output ONLY JavaScript/JSX source — no markdown fences, no imports, no explanations.
- Never write a bare < inside text; write &lt;.`;

const IDIOMS = `IDIOMS (use them)
- const on = (k) => sentence >= k;
- Groups appear with: <motion.g initial={false} animate={{ opacity: on(2) ? 1 : 0, y: on(2) ? 0 : 10 }} transition={{ duration: 0.7, ease: "easeOut" }}>
- Strokes draw with: <motion.path d="..." initial={false} animate={{ pathLength: on(1) ? 1 : 0 }} transition={{ duration: 1.1 }} fill="none" />
- Stagger children of one sentence with transition delay (0.15 s steps).
- Continuous explanatory motion once revealed: <motion.circle animate={on(3) ? { cx: [200, 600] } : { cx: 200 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }} />
- initial={false} is REQUIRED on every element that reveals, so a board opened mid-lecture shows its current state at once.
- Text: plain <text> inside a revealed motion.g.`;

function brief(beat: Beat): string {
  const list = sentences(beat.script);
  return `BOARD: "${beat.title}"
WHAT MUST BE DRAWN: ${beat.teachingPoint}

NARRATION — ${list.length} sentences, spoken in order while the board draws. Sentence k (0-based) is when its part of the drawing appears:
${list.map((s, k) => `  [${k}] ${s}`).join("\n")}

There are ${list.length} sentences: sentence runs 0..${list.length - 1}, then ${list.length} when finished.`;
}

/** V1 — the Animation Lab's Motion prompt, as the user saw it, on the production contract. */
const LAB_RULES = `BOARD RULES
- Canvas is 1000 x 560 (16:9-ish). Background #fbfaf7 (warm whiteboard). Ink #1f2937. Use 2-3 accents at most: #2563eb, #dc2626, #059669, #d97706.
- Draw the SPECIFIC subject with its real shape and parts — recognisable to a teacher, not generic boxes.
- A small title at top-left (x≈40, y≈48, 26px, bold). Keep everything else inside x 40..960, y 80..530.
- Every label is at least 17px, sits on empty space, and no two labels overlap each other or the drawing they name. Use short leader lines that do not cross other labels.
- Reveal strictly by sentence: what sentence k describes appears when sentence k starts, animates in over ~0.6-1.2 s, and STAYS. After the last sentence the complete diagram is on screen.
- Motion should explain (flow along a path, a signal travelling, a quantity growing), not decorate.`;

/** V2 — V1 plus a design system: the "cool and aesthetic" board. */
const DESIGN_SYSTEM = `DESIGN SYSTEM — every board looks like a premium, modern science-explainer illustration (think Kurzgesagt-clean, textbook-accurate):
- PAPER: <rect width="1000" height="560" fill="#fbfaf7" /> first. No frame or border.
- PALETTE: ink #1e293b for outlines and text; secondary text #64748b. Material colours come in pairs, a light fill with its deep outline:
    blue #dbeafe / #2563eb · red #fee2e2 / #dc2626 · green #dcfce7 / #16a34a · amber #fef3c7 / #d97706 · violet #ede9fe / #7c3aed · teal #ccfbf1 / #0d9488
  Use at most three pairs per board, each with a MEANING (e.g. blue = deoxygenated, red = oxygenated) kept consistent.
- DEPTH: define in <defs> one soft shadow <filter id="soft"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.12"/></filter> and apply it to the main subject's outer shapes only. Fill main shapes with a subtle linearGradient (lighter top-left to the pair's fill) so they read as solid objects.
- SHAPES: build real outlines from smooth cubic paths (C/S), rounded joins and caps, outline strokeWidth 2.5-3 in the deep colour; inner detail strokeWidth 1.5 at 0.6 opacity. Rects get rx 10-14. Nothing jagged, nothing thin and scratchy.
- TYPE: title 30px weight 800 ink at x=40 baseline y=58; optional subtitle 17px #64748b at y=86. Labels 17-18px weight 600 ink. Never set fontFamily (the host sets it).
- LABELS: each label sits in clear space beside its part, joined by a 1.5px #94a3b8 leader ending in a 4px dot ON the part. Align labels into tidy columns (left column right-aligned, right column left-aligned) with at least 34px between rows. A key term may sit on a soft pill: rect rx 12 in the pair's light fill behind the words.
- COMPOSITION: the subject is drawn LARGE (at least 45% of the board) and centred in its region; generous margins; balance left and right. Arrows are smooth curves with rounded arrowheads (<marker> per colour) that start and end at the things they connect.`;

const SHARED_TAIL = `QUALITY BAR
- Before writing, decide the layout: where the subject goes, where each label goes, where arrows run. Nothing may overlap or leave the frame.
- Prefer fewer, well-drawn parts over many sketchy ones. Every shape is a real part of the subject.`;

export const VARIANTS: Variant[] = [
  {
    id: "v1",
    label: "V1 lab prompt (production contract)",
    system: `You write one animated teaching board as a React component using the Motion library (formerly Framer Motion).\n\n${CONTRACT}\n\n${IDIOMS}\n\n${LAB_RULES}\n- Font: the host sets it; never set fontFamily.`,
    user: brief,
  },
  {
    id: "v2",
    label: "V2 lab prompt + design system",
    system: `You write one animated teaching board as a React component using the Motion library (formerly Framer Motion). The board is a beautiful, accurate, clearly labelled diagram that a teacher draws while explaining.\n\n${CONTRACT}\n\n${IDIOMS}\n\n${LAB_RULES}\n\n${DESIGN_SYSTEM}\n\n${SHARED_TAIL}`,
    user: brief,
  },
];

export function variantById(id: string): Variant | undefined {
  return VARIANTS.find((variant) => variant.id === id);
}
