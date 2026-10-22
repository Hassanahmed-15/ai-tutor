// Read-only: a saved lecture's boards — each sentence, its pen cue (what Dot is sent to) and the label of that target.
import { progressiveLectureSessions, progressiveLectureBeats } from "@/lib/db/cosmos";
const id = process.argv[2];
const { resources: s } = await progressiveLectureSessions().items.query({ query: "SELECT c.id, c.userId, c.topic FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll();
console.log(JSON.stringify(s[0]));
const { resources: beats } = await progressiveLectureBeats().items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: id }] }).fetchAll();
const { writeFileSync } = await import("node:fs");
writeFileSync(process.argv[3], JSON.stringify(beats, null, 1));
console.log("beats", beats.length);
