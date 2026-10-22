// Read-only: a saved lecture's boards by the start of its session id (as QA folder names carry it).
import { writeFileSync } from "node:fs";
import { progressiveLectureSessions, progressiveLectureBeats } from "@/lib/db/cosmos";
const [prefix, out] = process.argv.slice(2);
const { resources: s } = await progressiveLectureSessions().items.query({ query: "SELECT c.id, c.topic FROM c WHERE STARTSWITH(c.id, @p)", parameters: [{ name: "@p", value: prefix }] }).fetchAll();
if (!s.length) { console.log("no session"); process.exit(0); }
const { resources: beats } = await progressiveLectureBeats().items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: s[0].id }] }).fetchAll();
writeFileSync(out, JSON.stringify(beats, null, 1));
console.log(s[0].id, s[0].topic, "beats", beats.length);
