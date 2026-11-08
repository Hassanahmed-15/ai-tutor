// Save one shared stored picture to a file (free).
import { readFileSync, writeFileSync } from "node:fs";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { loadSharedCanvasImage } = await import("../../../lib/canvas/store");
const bytes = await loadSharedCanvasImage(process.argv[2]);
if (bytes) writeFileSync(process.argv[3], bytes);
console.log(bytes ? `${bytes.length} bytes` : "missing");
process.exit(0);
