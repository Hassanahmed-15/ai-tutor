import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { SignJWT } from "jose";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const id = process.argv[2];
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.userId FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
const tok = await new SignJWT({ email: "x@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject(s.userId).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources as any[];
for (const b of beats.sort((a, c) => a.sequence - c.sequence)) {
  const st = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec?.stage;
  if (st?.kind !== "illustration") continue;
  const r = await fetch(`http://localhost:3000${st.src}`, { headers: { cookie: `aria_access=${tok}` } }).catch(() => null);
  console.log(b.sequence + 1, st.src, "coursePicture", st.coursePicture, "labels", JSON.stringify(st.labelsInPicture), "→ image", r?.status, r?.headers.get("content-length"));
}
process.exit(0);
