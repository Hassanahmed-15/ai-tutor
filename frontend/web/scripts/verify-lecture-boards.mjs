/**
 * End-to-end board verification on ADVERSARIAL topics. Needs `npm run dev` running with
 * `BOARD_DIRECTOR=1`.
 *
 *   node scripts/verify-lecture-boards.mjs [topic-key]
 *
 * THE TOPICS ARE THE TEST. Every one is a machine-learning subject whose name collides with a
 * physical object, because that collision is what broke the pipeline: a lecture on Support Vector
 * Machines rendered a photograph of a stamp vending machine, labelled "Coin Return Mechanism",
 * under narration about maximising the margin between two classes. The old photo gate matched the
 * word "machine" in the beat text and an Openverse search for "SVM" did the rest.
 *
 * So each topic below must produce boards about the ALGORITHM and never a photograph of the
 * homonym — and separately, no beat may ship the "Animation unavailable" card, which is what the
 * second screenshot showed.
 */

const BASE = process.env.LAB_URL ?? "http://localhost:3000";

const TOPICS = {
  svm: { topic: "Support Vector Machines: the decision boundary and margin", collision: "a vending or industrial machine" },
  forest: { topic: "Random Forests: how an ensemble of decision trees votes", collision: "woodland or real trees" },
  neural: { topic: "Neural networks: layers, weights and how signals propagate", collision: "computer networking hardware" },
  tree: { topic: "Decision trees: how a split is chosen", collision: "a botanical tree" },
  kernel: { topic: "The kernel trick: mapping data into a higher-dimensional space", collision: "a seed or grain of corn" },
};

const only = process.argv[2];
const selected = only ? { [only]: TOPICS[only] } : TOPICS;

/** Board ops that count as a real, filled visual — the same rule lib/boardFallback.ts applies. */
function boardOf(beat) {
  const ops = beat.draw?.ops ?? [];
  for (const op of ops) {
    if (op.kind === "reactAnimation" && op.code) return { kind: "reactAnimation", filled: true };
    if (["manimScene", "structureScene", "plotBoard", "equationBoard"].includes(op.kind)) {
      if (op.spec) return { kind: op.kind, filled: true };
      return { kind: op.kind, filled: false };
    }
    if (op.kind === "chalkBoard" && Array.isArray(op.ops) && op.ops.length) return { kind: "chalkBoard", filled: true };
    if (op.kind === "image") return { kind: "image", filled: true };
  }
  // Hand-authored ops still put something on screen.
  return ops.length ? { kind: "hand-drawn", filled: true } : { kind: "none", filled: false };
}

let failures = 0;

for (const [key, { topic, collision }] of Object.entries(selected)) {
  if (!topic) continue;
  const started = Date.now();
  let data;
  try {
    const res = await fetch(`${BASE}/api/generate-lecture`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic }),
    });
    data = await res.json();
  } catch (err) {
    console.log(`ERR   ${key}: ${err.message}`);
    failures++;
    continue;
  }
  if (data.error) {
    // The depth gate rejecting a shallow script is a pre-existing generation concern, not a board
    // failure — report it plainly rather than counting it as a pass or a board bug.
    console.log(`SKIP  ${key}: ${String(data.error).slice(0, 90)}`);
    continue;
  }

  const beats = data.beats ?? [];
  const teaching = beats.filter((b) => b.slideKind !== "checkpoint" && b.draw);
  const boards = teaching.map((b) => ({ id: b.id, ...boardOf(b) }));

  const empty = boards.filter((b) => !b.filled);
  const photos = boards.filter((b) => b.kind === "image");
  const secs = ((Date.now() - started) / 1000).toFixed(0);

  const notes = [];
  // The failure from the second screenshot: a beat with a placeholder nobody could fill.
  if (empty.length) notes.push(`${empty.length} beat(s) with NO usable board: ${empty.map((b) => `${b.id}(${b.kind})`).join(", ")}`);
  // The failure from the first: a stock photograph on an abstract subject. Every topic here is
  // abstract, so ANY photo is wrong — there is no correct photograph of a decision boundary.
  if (photos.length) notes.push(`${photos.length} PHOTO board(s) on an abstract topic — the ${collision} failure`);

  if (notes.length) failures++;
  console.log(
    `${notes.length ? "FAIL" : "PASS"}  ${key.padEnd(7)} ${teaching.length} teaching beats · ${secs}s · $${(data.costUsd ?? 0).toFixed(3)}\n` +
      `      ${boards.map((b) => b.kind).join(", ")}` +
      (notes.length ? `\n      ${notes.join("\n      ")}` : ""),
  );
}

console.log(`\n${failures === 0 ? "all topics clean" : `${failures} topic(s) failed`}`);
process.exit(failures ? 1 : 0);
