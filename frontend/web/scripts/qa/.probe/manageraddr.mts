// Where in the course catalogue the manager's lessons came from (read-only).
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient } from "@azure/storage-blob";
import { curriculumDocumentOf } from "../../../lib/canvas/lessonRequest";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const blob = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING);
const container = env.AZURE_STORAGE_CONTAINER || env.AZURE_STORAGE_CONTAINER_NAME || "lectures";
const rows = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.id, c.topic, c.inputBlobName, c._ts FROM c WHERE STARTSWITH(c.userId, '20448e02') AND c.sourceType = 'suprnotes' ORDER BY c._ts DESC" }).fetchAll()).resources as any[];
for (const s of rows.slice(0, 10)) {
  const input = JSON.parse((await blob.getContainerClient(container).getBlobClient(s.inputBlobName).downloadToBuffer()).toString("utf8"));
  const doc = curriculumDocumentOf(input) as any;
  const keys = doc ? Object.keys(doc).join(",") : "";
  console.log(`${s.id.slice(0, 8)} ${new Date(s._ts * 1000).toISOString().slice(0, 16)} "${s.topic}" | doc keys: ${keys}`);
  if (doc) console.log("   source:", JSON.stringify(doc.source).slice(0, 700));
}
process.exit(0);
