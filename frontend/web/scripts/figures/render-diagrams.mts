/**
 * Offline PNGs of the vector-diagram acceptance boards (free, no model).
 *
 *   npx tsx --tsconfig tsconfig.json scripts/figures/render-diagrams.mts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { FIXTURES, fixtureBoard } from "../../lib/diagrams/fixtures.ts";
import { boardPng, boardSvg } from "../../lib/bench/renderSvg.ts";
import { validateCanvasSpec } from "../../lib/canvas/validate.ts";

const WEB = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const stamp = new Date().toISOString().slice(0, 10);
const folders = [
  path.join(WEB, ".bench", "diagrams", stamp),
  "/opt/cursor/artifacts/screenshots",
  `/Users/hassanahmed/aria-qa-images/${stamp}-vector-diagrams`,
];

async function main() {
  for (const dir of folders) await mkdir(dir, { recursive: true }).catch(() => undefined);
  for (const fix of FIXTURES) {
    const spec = validateCanvasSpec(fixtureBoard(fix), 8);
    if (!spec) throw new Error(`${fix.id} did not validate`);
    const png = boardPng(spec);
    const svg = boardSvg(spec);
    const name = `${fix.id}`;
    for (const dir of folders) {
      await writeFile(path.join(dir, `${name}.png`), png).catch(() => undefined);
      await writeFile(path.join(dir, `${name}.svg`), svg).catch(() => undefined);
    }
    console.log(name, png.length, "bytes");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
