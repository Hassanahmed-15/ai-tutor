import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { buildMenu, menuCourseIds, standardLevels } from "../curriculum/curation";
import type { CatalogEntry } from "../curriculum/catalog";

const catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/curricula/catalog.json"), "utf8")) as { entries: CatalogEntry[] };

function subject(region: string, level: string, name: string) {
  const menu = buildMenu(catalog.entries);
  return menu.regions.find((r) => r.region === region)?.levels.find((l) => l.id === level)?.subjects.find((s) => s.name === name);
}

test("Pakistan Mathematics uses complete multi-domain trees at every displayed level", () => {
  const primary = subject("PK", "primary", "Mathematics");
  const middle = subject("PK", "middle", "Mathematics");
  const matric = subject("PK", "matric", "Mathematics");
  assert.equal(primary?.courseId, "pk-nc2006-mathematics-1-12");
  assert.deepEqual(primary?.grades, ["I", "II", "III", "IV", "V"]);
  assert.deepEqual(middle?.grades, ["VI", "VII", "VIII"]);
  assert.equal(matric?.courseId, "pk-ncp-mathematics-9-12-fbise");
  assert.deepEqual(matric?.grades, ["9", "10"]);
});

test("known exam courses are not exposed when their source coverage is incomplete", () => {
  const menu = buildMenu(catalog.entries);
  const biology = menu.regions.find((r) => r.region === "INTL")?.levels.find((l) => l.id === "olevel")?.subjects.find((s) => s.name === "Biology");
  const alevel = menu.regions.find((r) => r.region === "INTL")?.levels.find((l) => l.id === "alevel")?.subjects.find((s) => s.name === "Mathematics");
  const calculus = subject("US", "ap", "AP Calculus AB and BC");
  assert.equal(biology?.courseId, "cie-olevel-biology-5090-2026-2028");
  assert.equal(alevel?.courseId, "cie-alevel-mathematics-9709-2026-2027");
  assert.deepEqual(calculus?.grades, []);
});

test("US school levels follow the chosen standard; AP and admission tests are shared by every standard", () => {
  const menu = buildMenu(catalog.entries);
  const us = menu.regions.find((r) => r.region === "US")!;
  assert.equal(us.standards?.[0].id, "national", "national standards are the default");
  assert.ok((us.standards?.length ?? 0) > 40, "the states are offered");
  const national = standardLevels(us).map((l) => l.id);
  const texas = standardLevels(us, "tx");
  assert.deepEqual(national.slice(0, 3), ["elementary", "middle", "high"]);
  assert.deepEqual(texas.map((l) => l.id), national, "same levels, in the same order");
  assert.equal(texas[0].subjects.find((s) => s.name === "Mathematics")?.courseId, "us-tx-mathematics");
  assert.ok(texas[0].subjects.every((s) => s.courseId.startsWith("us-tx-")), "a state's school levels hold only that state's courses");
  assert.deepEqual(texas.find((l) => l.id === "ap"), standardLevels(us).find((l) => l.id === "ap"));
  assert.deepEqual(standardLevels(us, "nowhere").map((l) => l.id), national, "an unknown standard falls back to national");
  const ids = menuCourseIds(menu);
  assert.ok(ids.includes("us-ccss-math-k-12-csp") && ids.includes("us-tx-mathematics"), "course lists include every standard");
});
