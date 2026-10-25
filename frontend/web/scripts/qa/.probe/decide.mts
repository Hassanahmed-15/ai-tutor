// What the subject logic decides today for every stored lecture (free). Course lessons use the new rule.
import { readFileSync, writeFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { BlobServiceClient } from "@azure/storage-blob";
import { examinerFor } from "../../../lib/canvas/mathsCheck";
import { isLabLookTopic } from "../../../lib/canvas/subjectLook";
import { asMathsOrCs, courseLessonSubject } from "../../../lib/canvas/lessonSubject";
import { curriculumDocumentOf, strictDocumentOf } from "../../../lib/canvas/lessonRequest";
const S = "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/2735a389-20f1-4b4d-94c6-1e1ea98cc81e/scratchpad";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const blobs = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING).getContainerClient(env.AZURE_STORAGE_CONTAINER);
const sessions = JSON.parse(readFileSync(`${S}/sessions.json`, "utf8")) as any[];
const out: any[] = [];
for (const s of sessions) {
  let plan = s.plan;
  let kind = s.sourceType as string;
  if (s.sourceType === "suprnotes" || s.sourceType === "pdf") {
    const meta = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.inputBlobName FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: s.id }] }).fetchAll()).resources[0] as any;
    const input = await blobs.getBlobClient(meta.inputBlobName).downloadToBuffer().then((b) => JSON.parse(b.toString("utf8"))).catch(() => null);
    if (input) {
      const course = curriculumDocumentOf(input);
      if (course) { kind = "course"; const subject = courseLessonSubject(course, input.topic); if (subject) plan = plan.map((b: any) => ({ ...b, subject })); }
      else if (s.sourceType === "pdf") kind = strictDocumentOf(input) ? "pdf-strict" : "pdf-reference";
      else kind = "suprnotes-other";
    }
  }
  const examiner = examinerFor(s.topic, plan);
  const look = asMathsOrCs(plan.find((b: any) => b.subject)?.subject, () => isLabLookTopic([s.topic, ...plan.map((b: any) => `${b.title} ${b.brief}`)].join(" ")));
  const treated = examiner === "cs" ? "cs" : examiner === "maths" ? "maths" : look ? "maths/cs-look" : "other";
  out.push({ topic: s.topic.trim(), kind, treated, titles: plan.slice(0, 3).map((b: any) => b.title).join(" / ") });
}
writeFileSync(`${S}/decided.json`, JSON.stringify(out));
const distinct = new Map<string, any>();
for (const r of out) { const k = `${r.kind}|${r.topic.toLowerCase()}`; if (!distinct.has(k)) distinct.set(k, r); }
console.log(out.length, "lectures,", distinct.size, "distinct (kind, topic)");
writeFileSync(`${S}/distinct.tsv`, [...distinct.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.topic.localeCompare(b.topic)).map((r, i) => `${i}\t${r.kind}\t${r.treated}\t${r.topic.slice(0, 70)}\t${r.titles.slice(0, 90)}`).join("\n"));
