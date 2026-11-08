// Does a board picture whose first load fails come back? (free) Every picture's first request is
// answered 401 (as when a sign-in renewal fails); the board must hide it, ask again, and show it.
import { readFileSync } from "node:fs";
import os from "node:os";
import { chromium } from "playwright";
import { SignJWT } from "jose";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const [session, board = "0"] = process.argv.slice(2);
const owner = ((await new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared").container("progressive-lecture-sessions").items.query({ query: "SELECT c.userId FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: session }] }).fetchAll()).resources[0] as { userId: string }).userId;
const token = await new SignJWT({ email: `${owner}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(owner).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
const t0 = Date.now();
const log: string[] = [];
await page.route("**/api/canvas-lecture/image/**", async (route) => {
  const url = route.request().url();
  const name = url.split("/image/")[1].slice(0, 26);
  if (!url.includes("retry=")) {
    log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${name} → 401 (forced)`);
    return route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Please sign in"}' });
  }
  const res = await route.fetch();
  log.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${name} → ${res.status()}`);
  return route.fulfill({ response: res });
});
await page.goto(`http://localhost:3000/canvas-lab?session=${session}&board=${board}&s=0&p=0.9`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(15000);
const images = await page.$$eval("svg image", (els) => els.filter((e) => (e.getAttribute("href") ?? "").includes("/api/canvas-lecture/image/")).map((e) => ({ href: (e.getAttribute("href") ?? "").split("/image/")[1], hidden: e.getAttribute("visibility") === "hidden", box: e.getBoundingClientRect().width })));
console.log(`requests:\n  ${log.join("\n  ")}`);
console.log("board pictures:", JSON.stringify(images, null, 1));
await page.screenshot({ path: `${os.homedir()}/aria-qa-images/picture-retry.png` });
await b.close();
