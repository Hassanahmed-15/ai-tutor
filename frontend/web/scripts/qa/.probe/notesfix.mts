// Re-render saved boards with the planner's notes put back (as lib/canvas/generate.ts writeAsSaid now does)
// and the new notes column — free. QA_USER=<owner> npx tsx scripts/qa/.probe/notesfix.mts <session> <outDir> <board:sentence>...
import { mkdirSync, readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SignJWT } from "jose";
import { CosmosClient } from "@azure/cosmos";
import { anchorNotes } from "../../../lib/canvas/narrationSync";
import { normalizeMath, repeatsWorking } from "../../../lib/canvas/equationCheck";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const [session, out, ...shots] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const planned = ((await db.container("progressive-lecture-sessions").items.query({ query: "SELECT ARRAY(SELECT VALUE p.canvas.boardNotes FROM p IN c.plan) AS notes FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: session }] }).fetchAll()).resources[0] as any).notes as Array<Array<{ s: number; text: string }> | null>;
const sub = process.env.QA_USER ?? "local-dev-canvas";
const token = await new SignJWT({ email: `${sub}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addInitScript("window.__name = (f) => f;");
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
await ctx.route((url) => url.pathname === `/api/progressive-lectures/${session}`, async (route) => {
  const res = await route.fetch().catch(() => null);
  if (!res) return route.abort().catch(() => undefined);
  const snap = await res.json();
  (snap.beats ?? []).forEach((beat: any, i: number) => {
    const spec = beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
    const notes = planned[i] ?? [];
    // NOAT=1: the sketch's items placed by code in reading order (writing in a column, drawings beside it).
    if (spec && process.env.NOAT === "1" && spec.stage?.kind === "sketch") for (const it of spec.stage.items) delete it.at;
    if (!spec || spec.stage?.kind !== "equation" || !notes.length) return;
    const text = new Map(spec.stage.tokens.map((t: any) => [t.id, t.text]));
    const rows = spec.stage.steps.map((st: any) => normalizeMath(st.order.map((id: string) => text.get(id) ?? "").join("")).replace(/÷/g, "/"));
    spec.notes = anchorNotes(notes.map((n, k) => ({ id: `say-${k + 1}`, text: n.text, s: n.s })), beat.script).filter((n: any) => !repeatsWorking(n.text, rows));
  });
  await route.fulfill({ response: res, json: snap }).catch(() => undefined);
});
const p = await ctx.newPage();
for (const shot of shots) {
  const [board, sentence] = shot.split(":");
  await p.goto(`http://localhost:3000/canvas-lab?session=${session}&scrub=1&board=${board}&s=${sentence}&p=0.95`, { timeout: 120000 });
  // The board list loads, then the camera flies to the board: both before the pen is watched.
  await p.waitForSelector('[data-panel][data-live="true"]', { timeout: 90000 }).catch(() => undefined);
  await p.waitForTimeout(4500);
  for (let idle = 0, t = 0; idle < 1500 && t < 60000; t += 250) {
    const on = await p.evaluate(() => { const m = document.querySelector('[data-panel][data-live="true"] [data-marker-tip]'); return m ? Number(getComputedStyle(m).opacity) > 0.1 : false; });
    idle = on ? 0 : idle + 250;
    await p.waitForTimeout(250);
  }
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/board${board}-s${sentence}.png` });
  console.log("saved", `${out}/board${board}-s${sentence}.png`);
}
await p.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
await ctx.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
await b.close();
