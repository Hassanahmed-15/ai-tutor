// When are a saved lecture's pictures requested? (free) Opens the lesson on board 1 and lists picture requests.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { SignJWT } from "jose";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const [session] = process.argv.slice(2);
// Signed in as the lecture's own (local test) account, read-only.
const owner = ((await new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared").container("progressive-lecture-sessions").items.query({ query: "SELECT c.userId FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: session }] }).fetchAll()).resources[0] as { userId: string }).userId;
const token = await new SignJWT({ email: `${owner}@example.com` }).setProtectedHeader({ alg: "HS256" }).setSubject(owner).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(env.AUTH_SECRET));
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addCookies([{ name: "aria_access", value: token, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
console.log("owner:", owner);
const t0 = Date.now();
const seen: string[] = [];
page.on("request", (r) => { if (r.url().includes("/api/canvas-lecture/image/")) seen.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${r.url().split("/image/")[1].slice(0, 20)}`); });
await page.goto(`http://localhost:3000/canvas-lab?session=${session}&board=0&s=0&p=0.2`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(12000);
console.log(`picture requests while on board 1 (${seen.length}):\n  ${seen.join("\n  ")}`);
await b.close();
