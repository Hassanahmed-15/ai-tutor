// Plays one of the owner's saved lectures ON THE LIVE SITE and records what happens to each voice clip.
// LIVE_AUTH_SECRET comes from the environment (never printed). Usage: livevoice.mts <session> [seconds]
import { chromium } from "playwright";
import { SignJWT } from "jose";
const [session, seconds = "50"] = process.argv.slice(2);
const owner = "c82ec597-f14f-4849-a512-6549f14d5919";
const H = "https://aria-tutor.jollyfield-0fda1d9b.westus2.azurecontainerapps.io";
const token = await new SignJWT({ email: `${owner}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(owner).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.LIVE_AUTH_SECRET!));
const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "aria_access", value: token, domain: new URL(H).hostname, path: "/", secure: true, httpOnly: true, sameSite: "Lax" }]);
const page = await ctx.newPage();
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log: string[] = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") log.push(`${at()} console.${m.type()}: ${m.text().slice(0, 200)}`); });
page.on("pageerror", (e) => log.push(`${at()} PAGE ERROR: ${e.message.slice(0, 200)}`));
page.on("requestfailed", (r) => log.push(`${at()} FAILED ${r.url().replace(H, "").slice(0, 80)} ${r.failure()?.errorText}`));
page.on("response", (r) => { const u = r.url().replace(H, ""); if (u.includes("/api/tts") || r.status() >= 400) log.push(`${at()} ${r.status()} ${u.slice(0, 80)}`); });
await page.addInitScript(() => {
  const w = window as unknown as { __audio: string[] };
  w.__audio = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const el = this as HTMLMediaElement;
    const p = play.call(el);
    w.__audio.push(`play() ${(el.currentSrc || el.src).slice(0, 24)}`);
    p.then(() => w.__audio.push("play ok"), (e: Error) => w.__audio.push(`play REFUSED ${e.name}: ${e.message.slice(0, 80)}`));
    for (const ev of ["playing", "ended", "error"]) el.addEventListener(ev, () => w.__audio.push(`${ev} t=${el.currentTime.toFixed(2)}${ev === "error" ? ` code=${el.error?.code}` : ""}`), { once: true });
    return p;
  };
});
await page.goto(`${H}/canvas-lab?session=${session}`, { waitUntil: "domcontentloaded", timeout: 120000 }).catch((e) => log.push(`goto: ${e.message}`));
await page.waitForTimeout(10000);
const playBtn = page.getByRole("button", { name: /^(play|start|resume)/i }).first();
if (await playBtn.isVisible().catch(() => false)) { await playBtn.click(); log.push(`${at()} clicked play`); }
await page.waitForTimeout(Number(seconds) * 1000);
const audio = await page.evaluate(() => (window as unknown as { __audio?: string[] }).__audio ?? []);
console.log(`url: ${page.url().replace(H, "")}`);
console.log(log.slice(0, 60).join("\n"));
console.log("\naudio element:\n  " + audio.slice(0, 30).join("\n  "));
await page.screenshot({ path: `${process.env.HOME}/aria-qa-images/livevoice.png` });
await b.close();
process.exit(0);
