// What the canvas lab shows for a saved session (free): a screenshot and the page's text.
import { chromium } from "playwright";
const [url, out] = process.argv.slice(2);
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") console.log("console:", m.text().slice(0, 200)); });
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForTimeout(10000);
await page.screenshot({ path: out });
console.log((await page.innerText("body")).slice(0, 400).replace(/\s+/g, " "));
await b.close();
