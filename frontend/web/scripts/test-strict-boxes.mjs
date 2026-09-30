/**
 * STRICT LECTURE: IS EACH SLIDE'S SOURCE BOXED ON THE PDF? — a REAL lecture (costs one lecture).
 *
 * Uploads a PDF, uses all pages (or asks a question), chooses "Strictly from source", starts the
 * lecture, and walks every slide: screenshots the screen, and records what the PDF panel shows —
 * whether the panel is there, the page it is on, how many boxes are drawn, and whether the slide's
 * board was replaced by a cropped PDF figure.
 *
 *   node scripts/test-strict-boxes.mjs <pdf> <email> <password-file> [out-dir] [--question "…"] [--max 8]
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.LAB_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const flag = (name, fallback = "") => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const [pdf, email, pwFile, outDir = path.resolve("strict-boxes-out")] = args.filter((a, i) => !a.startsWith("--") && !["--question", "--max"].includes(args[i - 1]));
const question = flag("--question");
const maxSlides = Number(flag("--max", "30"));
fs.mkdirSync(outDir, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const browser = await chromium.launch({ headless: !args.includes("--headed"), args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 } })).newPage();
const login = await page.request.post(`${BASE}/api/auth/login`, { data: { email, password: fs.readFileSync(pwFile, "utf8").trim() } });
if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

if (question) await page.locator("#brief").fill(question);
await page.locator('input[type="file"]').first().setInputFiles(pdf);
if (!question) await page.getByRole("button", { name: /use all pages/i }).click({ timeout: 120_000 });
await page.getByRole("button", { name: /strict source/i }).first().click({ timeout: 240_000 });
log(`chose STRICT${question ? ` for "${question}"` : " with all pages"}; waiting for the lecture`);

// The lecture screen: the PDF panel and a Play/Start control.
const panel = page.locator('section[aria-label="Source document"]');
const play = page.getByRole("button", { name: /^(Play|Start)/i }).first();
for (let i = 0; i < 400; i++) {
  if (await play.isVisible().catch(() => false)) break;
  const start = page.getByRole("button", { name: /start (the )?lesson|start lecture|begin/i }).first();
  if (await start.isVisible().catch(() => false)) await start.click().catch(() => {});
  await page.waitForTimeout(1500);
}
await play.click({ timeout: 60_000 });
log(`lecture started; PDF panel present: ${await panel.isVisible().catch(() => false)}`);

const report = [];
const next = page.getByRole("button", { name: /next concept/i }).first();
for (let slide = 1; slide <= maxSlides; slide++) {
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const section = document.querySelector('section[aria-label="Source document"]');
    // Boxes are the absolutely-positioned outlines drawn over the page image (amber solid / dashed).
    const boxes = section ? [...section.querySelectorAll("div,span")].filter((el) => {
      const s = getComputedStyle(el);
      return s.position === "absolute" && (s.borderStyle.includes("solid") || s.borderStyle.includes("dashed")) && parseFloat(s.borderTopWidth) >= 1.5 && el.getBoundingClientRect().width > 20;
    }).length : 0;
    const header = [...document.querySelectorAll("*")].find((el) => /highlighted on page/i.test(el.textContent ?? "") && el.children.length === 0)?.textContent ?? "";
    const figureCrop = Boolean(document.querySelector('[class*="SourceFigure"], [data-source-figure]')) || /From your source · page/i.test(document.body.innerText);
    const part = document.body.innerText.match(/Part (\d+) of (\d+)/)?.[0] ?? "";
    return { panel: Boolean(section), boxes, header: header.trim(), figureCrop, part };
  });
  await page.screenshot({ path: path.join(outDir, `slide-${String(slide).padStart(2, "0")}.png`) });
  report.push({ slide, ...info });
  log(`slide ${slide} (${info.part}): panel=${info.panel} boxes=${info.boxes} ${info.header ? `"${info.header}"` : ""}${info.figureCrop ? " FIGURE-CROP" : ""}`);
  // Advance, waiting while the next slide is still being written.
  let moved = false;
  for (let i = 0; i < 120 && !moved; i++) {
    if (await next.isEnabled().catch(() => false)) { await next.click().catch(() => {}); moved = true; break; }
    if (/Part (\d+) of \1\b/.test(info.part)) break;
    await page.waitForTimeout(2000);
  }
  if (!moved) break;
}
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
const noBox = report.filter((r) => r.boxes === 0).length;
const crops = report.filter((r) => r.figureCrop).length;
console.log(`\n${report.length} slides: ${noBox} without a box on the PDF, ${crops} with a cropped PDF figure. Screenshots in ${outDir}`);
