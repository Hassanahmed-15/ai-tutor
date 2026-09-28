/**
 * Board fixtures for the generator and critic tests: complete, runnable Animation components shaped
 * like the ones the model writes, built from a list of text rows so a test can say exactly which
 * words are on the board and where.
 *
 * Every board here passes the strict (sourceFaithful) static floors — boardPlan, visualSpec, six or
 * more timed steps over three sentences, three groups — so whatever a test observes is caused by
 * the thing it changed (a word, a position, a fragment), not by an unrelated density miss.
 */

export type FixtureText = { text: string; x: number; y: number; size?: number; sentence: number; kind?: string };

/** The source the strict fixtures are grounded in: a textbook's "Energy transfer" paragraph and figure. */
export const ENERGY_SOURCE = {
  text:
    "Energy transfer\nThe photosynthesis reaction needs a supply of energy to make it happen. This energy comes from light. " +
    "During photosynthesis, the plant's leaves absorb the energy of light. The energy is stored in the glucose that is made.\n" +
    "Diagram labels: cell wall, vacuole, nucleus, chloroplast containing chlorophyll\n" +
    "Photosynthesis happens inside the chloroplasts in a palisade cell like this one.",
  labels: ["cell wall", "vacuole", "nucleus", "chloroplast containing chlorophyll"],
  caption: "Photosynthesis happens inside the chloroplasts in a palisade cell like this one.",
  strict: true,
};

export const ENERGY_SCRIPT =
  "The photosynthesis reaction needs a supply of energy to make it happen. This energy comes from light. " +
  "Photosynthesis happens inside the chloroplasts in a palisade cell like this one. " +
  "The cell has a cell wall, a vacuole and a nucleus.";

/** The faithful rows: the heading, one source sentence, and the figure's four labels (one wrapped). */
export const FAITHFUL_TEXTS: FixtureText[] = [
  { text: "Energy transfer", x: 76, y: 78, size: 34, sentence: 0, kind: "write" },
  { text: "This energy comes from light.", x: 76, y: 150, size: 22, sentence: 1, kind: "write" },
  { text: "cell wall", x: 690, y: 190, size: 20, sentence: 3, kind: "label" },
  { text: "vacuole", x: 690, y: 250, size: 20, sentence: 3, kind: "label" },
  { text: "nucleus", x: 690, y: 310, size: 20, sentence: 3, kind: "label" },
  { text: "chloroplast containing", x: 690, y: 370, size: 20, sentence: 2, kind: "label" },
  { text: "chlorophyll", x: 690, y: 394, size: 20, sentence: 2, kind: "label" },
];

/** A board with these rows, a drawn cell, and a leader line to each label row. */
export function fixtureBoard(
  texts: FixtureText[],
  options: { wrapInFragment?: boolean; useMemo?: boolean; brokenReference?: boolean; rich?: boolean; cellX?: number } = {},
): string {
  const rows = texts
    .map((row, index) =>
      `      <text x="${row.x}" y="${row.y}" fontSize="${row.size ?? 22}" fill={ink} data-teach-order="${index + 10}" data-teach-kind="${row.kind ?? "label"}" data-teach-weight="1" data-teach-sentence="${row.sentence}">${row.text}</text>`,
    )
    .join("\n");
  const leaders = texts
    .filter((row) => (row.kind ?? "label") === "label")
    .map((row) => `      <line x1="${row.x - 8}" y1="${row.y - 6}" x2="560" y2="${row.y - 6}" stroke="#8a91a3" strokeWidth="1.5" />\n      <circle cx="560" cy="${row.y - 6}" r="5" fill="#65a30d" />`)
    .join("\n");
  const labelGroup = options.wrapInFragment ? `<>\n${rows}\n${leaders}\n      </>` : `<g>\n${rows}\n${leaders}\n      </g>`;
  const memo = options.useMemo ? "const cellWidth = React.useMemo(() => 260, []);" : "const cellWidth = 260;";
  return `export default function Animation({ progress }) {
  const boardPlan = { composition: "figure centre, labels right", readingPath: ["title", "cell", "labels"], reservedRegions: [{ name: "cell", x: 380, y: 140, w: 300, h: 320 }] };
  const visualSpec = { subject: "palisade cell", recognitionCues: ["cell outline"], requiredParts: ["cell wall"], forbiddenShortcuts: ["anything not in SOURCE"] };
  ${memo}
  const draw = phase(progress, 0.1, 0.6);
  const settle = phase(progress, 0.5, 0.9);
  const ink = "#1b2440";
  ${options.brokenReference ? "const oops = notDefinedAnywhere * 2;" : ""}
  return (
    <svg viewBox="0 0 1000 560" style={{ background: "#fbfbf8" }}>
      <rect x="40" y="24" width="920" height="512" fill="none" stroke="#e2e2dc" />
      <g data-teach-order="1" data-teach-kind="diagram" data-teach-weight="3" data-teach-sentence="2">
        <rect x="${options.cellX ?? 400}" y="150" width={cellWidth} height="300" rx="40" fill="#dff2cd" stroke="#65a30d" strokeWidth="3" opacity={draw} />
        <ellipse cx="530" cy="300" rx="80" ry="110" fill="#eaf4fd" stroke="#4a90d9" strokeWidth="2" opacity={draw} />
        <circle cx="470" cy="220" r="22" fill="#c4b5fd" stroke="#6d28d9" opacity={settle} />
        <path d="M440 380 q20 -20 40 0 q20 20 40 0" fill="none" stroke="#65a30d" strokeWidth="2" opacity={settle} />
      </g>
      <g data-teach-order="2" data-teach-kind="diagram" data-teach-weight="2" data-teach-sentence="2">
        <circle cx="600" cy="250" r="12" fill="#86efac" stroke="#15803d" opacity={draw} />
        <circle cx="610" cy="330" r="12" fill="#86efac" stroke="#15803d" opacity={draw} />
      </g>
      ${options.rich ? RICH_GROUPS : ""}
      ${labelGroup}
    </svg>
  );
}`;
}

/**
 * Extra drawn structure (explicit tags — the density count reads source tags, so a .map() would count
 * once) that lifts a fixture over the REFERENCE-mode floors: five groups, object primitives well
 * ahead of text and lines.
 */
const RICH_GROUPS = `<g data-teach-order="3" data-teach-kind="diagram" data-teach-weight="2" data-teach-sentence="2">
        <circle cx="450" cy="260" r="9" fill="#86efac" stroke="#15803d" opacity={draw} />
        <circle cx="470" cy="300" r="9" fill="#86efac" stroke="#15803d" opacity={draw} />
        <circle cx="455" cy="340" r="9" fill="#86efac" stroke="#15803d" opacity={draw} />
        <circle cx="620" cy="200" r="9" fill="#86efac" stroke="#15803d" opacity={draw} />
        <circle cx="630" cy="400" r="9" fill="#86efac" stroke="#15803d" opacity={draw} />
        <circle cx="600" cy="420" r="9" fill="#86efac" stroke="#15803d" opacity={draw} />
      </g>
      <g data-teach-order="4" data-teach-kind="diagram" data-teach-weight="2" data-teach-sentence="3">
        <path d="M410 170 q120 -18 240 0" fill="none" stroke="#65a30d" strokeWidth="2" opacity={settle} />
        <path d="M410 430 q120 18 240 0" fill="none" stroke="#65a30d" strokeWidth="2" opacity={settle} />
        <path d="M420 200 q-8 100 0 200" fill="none" stroke="#65a30d" strokeWidth="2" opacity={settle} />
        <path d="M640 200 q8 100 0 200" fill="none" stroke="#65a30d" strokeWidth="2" opacity={settle} />
      </g>
      <g data-teach-order="5" data-teach-kind="diagram" data-teach-weight="1" data-teach-sentence="3">
        <ellipse cx="500" cy="250" rx="14" ry="8" fill="#fde68a" stroke="#d97706" opacity={settle} />
        <ellipse cx="560" cy="380" rx="14" ry="8" fill="#fde68a" stroke="#d97706" opacity={settle} />
        <ellipse cx="520" cy="410" rx="14" ry="8" fill="#fde68a" stroke="#d97706" opacity={settle} />
      </g>`;
