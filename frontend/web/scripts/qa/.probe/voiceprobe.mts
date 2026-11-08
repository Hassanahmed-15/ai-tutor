// Does Aria's voice play in the real player? (≈ $0.001 a sentence) Plays a saved lecture in canvas-lab with the
// real narration and records every clip: requested, answered, played, stalled.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SignJWT } from "jose";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const [prefix, seconds = "60"] = process.argv.slice(2);
const s = (await new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared").container("progressive-lecture-sessions").items.query({ query: "SELECT c.id, c.userId FROM c WHERE STARTSWITH(c.id, @id)", parameters: [{ name: "@id", value: prefix }] }).fetchAll()).resources[0] as { id: string; userId: string };
const token = await new SignJWT({ email: `${s.userId}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(s.userId).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log: string[] = [];
page.on("console", (m) => { const t = m.text(); if (/narration|error|blocked|audio|tts/i.test(t)) log.push(`${at()} console.${m.type()}: ${t.slice(0, 160)}`); });
page.on("pageerror", (e) => log.push(`${at()} PAGE ERROR: ${e.message.slice(0, 200)}`));
page.on("request", (r) => { if (r.url().includes("/api/tts")) log.push(`${at()} tts request ${(r.postData() ?? "").slice(9, 60)}`); });
page.on("response", (r) => { if (r.url().includes("/api/tts")) log.push(`${at()} tts ${r.status()} ${r.headers()["content-type"] ?? ""}`); });
await page.addInitScript(() => {
  const w = window as unknown as { __audio: string[] };
  w.__audio = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this as HTMLMediaElement;
    const p = play.call(el);
    w.__audio.push(`play() src=${(el.currentSrc || el.src).slice(0, 30)}`);
    p.then(() => w.__audio.push("play ok"), (e: Error) => w.__audio.push(`play REFUSED ${e.name}: ${e.message.slice(0, 80)}`));
    for (const ev of ["playing", "ended", "error", "stalled", "pause"]) el.addEventListener(ev, () => w.__audio.push(`${ev} t=${el.currentTime.toFixed(2)}${ev === "error" ? ` code=${el.error?.code}` : ""}`), { once: true });
    return p;
  };
});
await page.goto(`http://localhost:3000/canvas-lab?session=${s.id}`, { waitUntil: "domcontentloaded", timeout: 180000 });
await page.waitForTimeout(8000);
// The Play click unlocks audio, as a student's would.
const play = page.getByRole("button", { name: /^(play|start|resume)/i }).first();
if (await play.isVisible().catch(() => false)) { await play.click(); log.push(`${at()} clicked ${await play.textContent()}`); }
await page.mouse.click(700, 450);
await page.waitForTimeout(Number(seconds) * 1000);
const audio = await page.evaluate(() => (window as unknown as { __audio: string[] }).__audio);
const status = await page.locator("text=/Aria is (speaking|listening|thinking)|Ready|Paused/").first().textContent().catch(() => "?");
console.log(log.join("\n"));
console.log("\naudio element:\n  " + audio.join("\n  "));
console.log("\nstatus:", status);
await page.screenshot({ path: `${process.env.HOME}/aria-qa-images/voiceprobe.png` });
await b.close();
process.exit(0);
