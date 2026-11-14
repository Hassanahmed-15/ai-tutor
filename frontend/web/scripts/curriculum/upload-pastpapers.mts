/**
 * Puts the cut past papers into PRIVATE blob storage (lib/curriculum/pastPapers.ts reads them): one JSON per question
 * and its page images. Free (storage only). Skips what is already there, so it can be re-run after a stall.
 *   node --env-file=.env.local --conditions=react-server --import tsx scripts/curriculum/upload-pastpapers.mts <questions.jsonl> <crops dir>
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { lectureBlobContainer } from "../../lib/blobStorage";

const [jsonl, crops, mode] = process.argv.slice(2);
const overwriteImages = mode === "--overwrite-images" || mode === "--overwrite-all";
const overwriteDocs = mode === "--overwrite-all";
const rows = readFileSync(jsonl, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { blob: string; doc: { images: string[] } });
const container = await lectureBlobContainer();
const have = new Set<string>();
for await (const b of container.listBlobsFlat({ prefix: "pastpapers/" })) have.add(b.name);
type Job = { name: string; body: () => Buffer; type: string };
const jobs: Job[] = [];
for (const r of rows) {
  if (overwriteDocs || !have.has(r.blob)) jobs.push({ name: r.blob, body: () => Buffer.from(JSON.stringify(r.doc)), type: "application/json" });
  for (const img of r.doc.images) if (overwriteImages || !have.has(img)) jobs.push({ name: img, body: () => readFileSync(path.join(crops, img.replace(/^pastpapers\/images\//, ""))), type: "image/jpeg" });
}
console.log(`already stored ${have.size} | to upload ${jobs.length}`);
let done = 0, failed = 0, next = 0;
async function worker() {
  while (next < jobs.length) {
    const j = jobs[next++];
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await container.getBlockBlobClient(j.name).uploadData(j.body(), { blobHTTPHeaders: { blobContentType: j.type, blobCacheControl: "private, max-age=86400" } });
        done++; break;
      } catch (e) {
        if (attempt === 4) { failed++; console.warn("failed", j.name, (e as Error).message.slice(0, 80)); }
        else await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if ((done + failed) % 2000 === 0) console.log(`  ${done + failed}/${jobs.length}`);
  }
}
await Promise.all(Array.from({ length: 16 }, worker));
console.log(`uploaded ${done}, failed ${failed}`);
