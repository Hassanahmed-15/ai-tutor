/**
 * Copies the course browser and the course data from ../web, so the showcase always shows exactly
 * what the app's /courses page shows. Runs before every build (npm run build); the copied files are
 * gitignored — edit them in ../web.
 *
 *   public/data/menu.json        = what /api/curricula returns ({ builtAt, menu })
 *   public/data/trees/<id>.json  = what /api/curricula/<id> returns, for every course in the menu
 */
import fs from "node:fs";
import path from "node:path";

const HERE = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const WEB = path.resolve(HERE, "../web");

const COPY = [
  "components/courses/CourseBrowser.tsx",
  "lib/curriculum/catalog.ts",
  "lib/curriculum/mastery.ts",
  "lib/curriculum/curation.ts",
  "lib/curriculum/types.ts",
  "lib/testPrompt.ts",
  "app/globals.css",
  "components/viewer/viewer.css",
];
for (const f of COPY) {
  fs.mkdirSync(path.dirname(path.join(HERE, f)), { recursive: true });
  fs.copyFileSync(path.join(WEB, f), path.join(HERE, f));
}
// Tailwind skips gitignored files when it looks for class names, and the copied component is
// gitignored here: name it explicitly.
const css = path.join(HERE, "app/globals.css");
fs.writeFileSync(css, fs.readFileSync(css, "utf8").replace('@import "tailwindcss";', '@import "tailwindcss";\n@source "../components";'));
// Starting a lesson is not part of the showcase (the button is hidden); this keeps the import whole.
fs.writeFileSync(path.join(HERE, "lib/pendingTopic.ts"), "/** Showcase stub: lessons cannot be started here. */\nexport function savePendingCurriculum(request: unknown): void {\n  void request;\n}\n");

const { buildMenu, menuCourseIds } = await import(path.join(HERE, "lib/curriculum/curation.ts"));
const catalog = JSON.parse(fs.readFileSync(path.join(WEB, "data/curricula/catalog.json"), "utf8"));
const menu = buildMenu(catalog.entries);
// Every standard's courses (US national + each state), not only the default one's.
const ids: string[] = menuCourseIds(menu);

const DATA = path.join(HERE, "public/data");
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(path.join(DATA, "trees"), { recursive: true });
fs.writeFileSync(path.join(DATA, "menu.json"), JSON.stringify({ builtAt: catalog.builtAt, menu }));
let bytes = 0;
for (const id of ids) {
  const text = JSON.stringify(JSON.parse(fs.readFileSync(path.join(WEB, "data/curricula/trees", `${id}.json`), "utf8")));
  fs.writeFileSync(path.join(DATA, "trees", `${id}.json`), text);
  bytes += text.length;
}
console.log(`synced ${COPY.length} files, menu + ${ids.length} courses (${(bytes / 1e6).toFixed(1)} MB)`);
