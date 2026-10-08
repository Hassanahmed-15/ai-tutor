// Walks the classroom demo (/classroom) on the real GPU and saves frames to /tmp/classroom-*.png,
// printing what the teacher's brain was doing in each. Needs `npm run dev`.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
p.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 200)));
p.on("console", (m) => { if (m.type() === "error" && !/favicon|404|DevTools/.test(m.text())) console.log("[console]", m.text().slice(0, 160)); });
await p.route("**/api/auth/me", (r) => r.fulfill({ json: { databaseConfigured: true, user: { id: "u1", email: "s@x.com", username: "sana", onboarded: true, needsLearnerProfile: false, needsPreferences: false, hasPassword: true, providers: [] }, profile: { displayName: "Sana", age: 15, accessibility: "none", reducedMotion: null, captions: null, slowerPace: null, simplerLanguage: null, notes: null, learner: null, updatedAt: "" } } }));
await p.goto("http://localhost:3000/classroom", { waitUntil: "domcontentloaded", timeout: 120000 });
const state = () => p.evaluate(() => { const s = window.__ariaClassroom; return s ? `${s.crouch ? "CROUCH " : ""}hold=${s.holdPen ? 1 : 0} ${s.place}/${s.activity} clip=${s.clip} x=${Math.round(s.x)} yaw=${Math.round(s.yaw)} write=${s.write.toFixed(2)} pen=${s.pen ? Math.round(s.pen.x) + "," + Math.round(s.pen.y) : "-"} marker=${s.marker}` : "no teacher yet"; });
await p.waitForTimeout(9000);
console.log("before play:", await state());
await p.screenshot({ path: "/tmp/classroom-0-start.png" });
await p.getByRole("button", { name: /^(Play|Start)/i }).first().click();
let writes = 0, others = 0;
for (let k = 1; k <= 40; k++) {
  await p.waitForTimeout(1000);
  const s = await state();
  console.log(`t+${k}s:`, s);
  if (/write=1\.00.*marker=true/.test(s) && writes < 4) await p.screenshot({ path: `/tmp/classroom-write-${writes++}.png` });
  else if (k % 8 === 0 && others < 5) await p.screenshot({ path: `/tmp/classroom-at-${k}s.png` }), others++;
}
await b.close();
