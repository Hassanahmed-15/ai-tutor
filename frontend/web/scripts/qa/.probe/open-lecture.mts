// Opens a saved lecture in a visible browser window, signed in as the local test account that made it.
//   node --import tsx scripts/qa/.probe/open-lecture.mts <sessionId>
import { readFileSync } from "node:fs";
import { SignJWT } from "jose";
import { chromium } from "playwright";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^["']|["']$/g, "")]));
const token = await new SignJWT({ email: "local-dev-canvas@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject(process.env.QA_USER ?? "local-dev-canvas").setIssuedAt().setExpirationTime("12h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const browser = await chromium.launch({ headless: false, args: ["--start-maximized", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: null });
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
await page.addInitScript("window.__name = f => f");
await page.goto(`http://localhost:3000/canvas-lab?session=${process.argv[2]}`, { timeout: 120000 });
console.log("opened");
await new Promise((r) => browser.on("disconnected", r));
