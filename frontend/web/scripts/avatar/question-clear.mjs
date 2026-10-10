// Checks that Aria's bust never covers a question: the questions panel (open) and a checkpoint on
// the board, at a wide and a narrower laptop width. Saves /tmp/qclear-*.png. Needs `npm run dev`.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const hit = (a, c) => a && c && a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
const r = (x) => (x ? `${Math.round(x.x)},${Math.round(x.y)} ${Math.round(x.width)}x${Math.round(x.height)}` : "-");
let failures = 0;
for (const [w, h] of [[1440, 900], [1100, 760]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.route("**/api/auth/me", (rt) => rt.fulfill({ json: { databaseConfigured: true, user: { id: "u1", email: "s@x.com", username: "sana", onboarded: true, needsLearnerProfile: false, needsPreferences: false, hasPassword: true, providers: [] }, profile: { displayName: "Sana", age: 15, accessibility: "none", reducedMotion: null, captions: null, slowerPace: null, simplerLanguage: null, notes: null, learner: null, updatedAt: "" } } }));
  await p.goto("http://localhost:3000/player-preview", { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.waitForTimeout(15000);
  const aria = p.locator('[role="img"][aria-label="Aria"]');
  console.log(`${w}x${h} board: aria ${r(await aria.boundingBox())}`);
  // 1. The questions panel.
  await p.getByRole("button", { name: "Ask Aria" }).click();
  await p.waitForTimeout(1200);
  const panel = await p.locator('textarea, input[placeholder*="Ask"]').first().locator("xpath=ancestor::div[contains(@class,'flex-col')][1]").boundingBox();
  const input = await p.locator('input[placeholder*="Ask"], textarea').first().boundingBox();
  const a1 = await aria.boundingBox();
  const bad1 = hit(a1, panel) || hit(a1, input);
  failures += bad1 ? 1 : 0;
  console.log(`  panel open: aria ${r(a1)} panel ${r(panel)} input ${r(input)} -> ${bad1 ? "OVERLAP" : "clear"}`);
  await p.screenshot({ path: `/tmp/qclear-${w}-panel.png` });
  await p.getByRole("button", { name: "Close the questions" }).click();
  await p.waitForTimeout(800);
  // 2. A checkpoint on the board: step forward until its answer box appears.
  let form = null;
  for (let i = 0; i < 14 && !form; i++) {
    await p.getByRole("button", { name: /next/i }).first().click().catch(() => {});
    await p.waitForTimeout(1500);
    const box = p.locator("form:has(input), form:has(textarea)").first();
    if (await box.count() && await box.isVisible()) form = await box.boundingBox();
  }
  await p.waitForTimeout(1200);
  const a2 = await aria.boundingBox();
  const bad2 = !form || hit(a2, form);
  failures += bad2 ? 1 : 0;
  console.log(`  checkpoint: aria ${r(a2)} question ${r(form)} -> ${!form ? "NO CHECKPOINT FOUND" : bad2 ? "OVERLAP" : "clear"}`);
  await p.screenshot({ path: `/tmp/qclear-${w}-checkpoint.png` });
  await p.close();
}
await b.close();
console.log(failures ? `${failures} FAILED` : "all clear");
process.exit(failures ? 1 : 0);
