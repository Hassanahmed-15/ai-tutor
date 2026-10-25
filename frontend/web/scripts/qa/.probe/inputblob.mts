import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient } from "@azure/storage-blob";
import { courseLessonSubject } from "../../../lib/canvas/lessonSubject";
import { curriculumDocumentOf, canvasPlanRequest, MATHS_CS_TEACHING } from "../../../lib/canvas/lessonRequest";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const blob = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING);
for (const id of process.argv.slice(2)) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.inputBlobName FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  const container = env.AZURE_STORAGE_CONTAINER || env.AZURE_STORAGE_CONTAINER_NAME || "lectures";
  const buf = await blob.getContainerClient(container).getBlobClient(s.inputBlobName).downloadToBuffer();
  const input = JSON.parse(buf.toString("utf8"));
  const doc = curriculumDocumentOf(input);
  console.log(`${s.topic}: course lesson=${Boolean(doc)} lesson.subject=${JSON.stringify(doc?.lesson?.subject)} → taught as ${courseLessonSubject(doc, input.topic)} | maths rules in the planner request: ${canvasPlanRequest(input).includes(MATHS_CS_TEACHING)}`);
}
