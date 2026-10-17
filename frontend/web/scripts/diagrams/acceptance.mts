/**
 * Acceptance run of the vector diagram pipeline on real board briefs (PAID: one writer call, one
 * vision check per attempt — about $0.01-0.04 a diagram). Saves each diagram's PNG and description.
 *
 *   NODE_OPTIONS="--conditions=react-server" npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/diagrams/acceptance.mts <cases.json> <out dir> [name…]
 */
import fs from "node:fs";
import path from "node:path";
import { createOpenAI } from "../../lib/openaiClient";
import { diagramPng } from "../../lib/diagrams/render";
import { vectorDiagram, type VectorDiagramRequest } from "../../lib/diagrams/write";

const [casesFile, out, ...only] = process.argv.slice(2);
const cases: Record<string, VectorDiagramRequest> = JSON.parse(fs.readFileSync(casesFile, "utf8"));
fs.mkdirSync(out, { recursive: true });
const openai = createOpenAI();
let total = 0;
await Promise.all(Object.entries(cases).filter(([name]) => !only.length || only.includes(name)).map(async ([name, req]) => {
  const started = Date.now();
  const left = () => 170_000 - (Date.now() - started);
  const made = await vectorDiagram(openai, req, { share: false, timeLeft: left });
  total += made.costUsd;
  console.log(`${name}: $${made.costUsd.toFixed(4)} ${Math.round((Date.now() - started) / 1000)}s — ${made.log}`);
  if (!made.diagram) return;
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(made.diagram.raw, null, 1));
  const png = await diagramPng(made.diagram.drawing);
  if (png) fs.writeFileSync(path.join(out, `${name}.png`), png);
}));
console.log(`total $${total.toFixed(4)}`);
