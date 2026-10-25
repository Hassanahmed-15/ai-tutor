import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient } from "@azure/storage-blob";
import { canvasPolicy } from "../../../lib/canvas/lessonRequest";
import { readingGrade } from "../../../lib/studentCard";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const blobs = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING).getContainerClient(env.AZURE_STORAGE_CONTAINER);
for (const id of process.argv.slice(2)) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.inputBlobName, ARRAY(SELECT VALUE p.canvas.script FROM p IN c.plan) AS scripts FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  const input = JSON.parse((await blobs.getBlobClient(s.inputBlobName).downloadToBuffer()).toString("utf8"));
  const policy = canvasPolicy(input);
  const grades = (s.scripts as string[]).filter(Boolean).map((t) => readingGrade(t));
  console.log(`${s.topic}: teaching policy ${policy ? `yes, target grade ${policy.readingGrade}` : "NONE (no simpler rewrite)"} | script grades ${grades.join(", ")} | student level: ${JSON.stringify(input.learnerProfile?.expertise ?? null)} ${JSON.stringify(input.studentCard?.level ?? input.learner?.level ?? null)}`);
}
