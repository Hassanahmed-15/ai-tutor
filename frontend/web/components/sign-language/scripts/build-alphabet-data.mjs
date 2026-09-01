import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const source = process.argv[2];
const target = process.argv[3];
if (!source || !target) {
  throw new Error("Usage: node build-alphabet-data.mjs <upstream alphabets folder> <output json>");
}

const output = {};
for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
  const raw = JSON.parse(await readFile(path.join(source, `${letter}.json`), "utf8"));
  const hands = raw.map((frame) => {
    const [left, right] = frame[2];
    return left.length === 21 ? left : right;
  });
  const all = hands.flat();
  const xs = all.map((point) => point[1]);
  const ys = all.map((point) => point[2]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const xPad = (1 - (maxX - minX) / span) / 2;
  const yPad = (1 - (maxY - minY) / span) / 2;
  output[letter] = hands.map((hand) =>
    hand.map((point) => [
      Number((xPad + (point[1] - minX) / span).toFixed(4)),
      Number((yPad + (point[2] - minY) / span).toFixed(4)),
      Number((point[3] / span).toFixed(5)),
    ]),
  );
}

await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, `${JSON.stringify(output)}\n`);

