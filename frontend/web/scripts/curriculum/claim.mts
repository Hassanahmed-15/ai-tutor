/**
 * Hands an extraction agent the next document nobody has: the first id in
 * data/curricula/work/queue.txt with no tree, no rows file and no claim. The claim is a directory
 * made with mkdir, which only one process can create, so two agents never get the same id.
 *
 *   node --import tsx scripts/curriculum/claim.mts            → prints one id, or NONE
 *   node --import tsx scripts/curriculum/claim.mts --release <id>
 *   node --import tsx scripts/curriculum/claim.mts --skip <id> "why"   unreadable: set aside for a human
 *   node --import tsx scripts/curriculum/claim.mts --redo     next id from work/redo-shallow.txt (built
 *                                                              courses that are too shallow), own claims
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const W = path.join(ROOT, "data/curricula/work");
const args = process.argv.slice(2);
if (args[0] === "--release") {
  fs.rmSync(path.join(W, "claims", args[1]), { recursive: true, force: true });
  console.log(`released ${args[1]}`);
  process.exit(0);
}
if (args[0] === "--skip") {
  fs.appendFileSync(path.join(W, "skip.txt"), `${args[1]}\t${args.slice(2).join(" ") || "unreadable"}\n`);
  fs.rmSync(path.join(W, "claims", args[1]), { recursive: true, force: true });
  console.log(`skipped ${args[1]}`);
  process.exit(0);
}
const skipFile = path.join(W, "skip.txt");
const skipped = new Set(fs.existsSync(skipFile) ? fs.readFileSync(skipFile, "utf8").split("\n").map((l) => l.split("\t")[0]).filter(Boolean) : []);
const redo = args.includes("--redo");
const queue = fs.readFileSync(path.join(W, redo ? "redo-shallow.txt" : "queue.txt"), "utf8").split("\n").map((s) => s.trim()).filter(Boolean);
fs.mkdirSync(path.join(W, "claims"), { recursive: true });
fs.mkdirSync(path.join(W, "claims-redo"), { recursive: true });
for (const id of queue) {
  if (skipped.has(id)) continue;
  if (!redo && fs.existsSync(path.join(ROOT, "data/curricula/trees", `${id}.json`))) continue;
  if (!redo && fs.existsSync(path.join(ROOT, "data/curricula/rows", `${id}.json`))) continue;
  try {
    fs.mkdirSync(path.join(W, redo ? "claims-redo" : "claims", id));
  } catch {
    continue;
  }
  console.log(id);
  process.exit(0);
}
console.log("NONE");
