/** Onboarding's contextual options (lib/education.ts). */
import test from "node:test";
import assert from "node:assert/strict";
import { countryFromLanguage, countryName, curriculaFor, customOption, levelBand, sanitizeOptions, searchOptions, studyLevelsFor, subjectForTopic, subjectOptions } from "../education";

const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);
const subj = (...names: string[]) => subjectOptions().filter((s) => names.includes(s.label));

test("study levels use the country's own names", () => {
  assert.ok(studyLevelsFor("GB").some((x) => x.label.startsWith("GCSE / O-Level")));
  assert.ok(studyLevelsFor("GB").some((x) => x.label.startsWith("A-Level")));
  assert.ok(studyLevelsFor("US").some((x) => x.label === "Elementary"));
  assert.ok(studyLevelsFor("US").some((x) => x.label === "Graduate"));
  assert.ok(studyLevelsFor("PK").some((x) => /Matric/.test(x.label)));
  assert.ok(studyLevelsFor("ZZ").some((x) => x.label === "Undergraduate"), "anywhere else gets the general list");
});

test("curricula are contextual: USMLE only for medicine, SAT around high school, local first", () => {
  const ukMedic = curriculaFor({ country: "GB", level: { id: "undergrad", label: "Undergraduate" }, subjects: subj("Medicine") });
  assert.ok(ids(ukMedic).includes("usmle"));
  const ukPhysics = curriculaFor({ country: "GB", level: { id: "undergrad", label: "Undergraduate" }, subjects: subj("Physics") });
  assert.ok(!ids(ukPhysics).includes("usmle"), "not for a physics student");
  const usHigh = curriculaFor({ country: "US", level: { id: "us-high", label: "High School" }, subjects: subj("Mathematics") });
  assert.ok(ids(usHigh).includes("sat") && ids(usHigh).includes("ap"));
  assert.ok(!ids(curriculaFor({ country: "US", level: { id: "postgrad", label: "Postgraduate" } })).includes("sat"));
  const pk = curriculaFor({ country: "PK", level: { id: "pk-inter", label: "Intermediate (HSSC / FSc) / A-Level" }, subjects: subj("Biology") });
  assert.equal(ids(pk).indexOf("mdcat") >= 0, true);
  assert.ok(ids(pk).indexOf("pk-fsc") < ids(pk).indexOf("cambridge-a-level"), "local before international");
  assert.ok(!ids(curriculaFor({ country: "US", level: { id: "us-high", label: "High School" } })).includes("mdcat"), "not outside Pakistan");
});

test("admissions exams follow the subjects that lead to them, after the country's own curricula", () => {
  const alevel = { id: "gb-alevel", label: "A-Level / Sixth form (Years 12–13)" };
  const physics = ids(curriculaFor({ country: "GB", level: alevel, subjects: subj("Physics") }));
  assert.ok(!physics.includes("ucat"), "UCAT is not for a physics-only student");
  assert.equal(physics[0], "a-level", "the country's curriculum leads");
  const bio = ids(curriculaFor({ country: "GB", level: alevel, subjects: subj("Biology", "Chemistry") }));
  assert.ok(bio.includes("ucat") && bio.indexOf("a-level") < bio.indexOf("ucat"), "UCAT for would-be medics, after A-Level");
  const inter = { id: "pk-inter", label: "Intermediate (HSSC / FSc) / A-Level" };
  const pkPhysics = ids(curriculaFor({ country: "PK", level: inter, subjects: subj("Physics") }));
  assert.ok(pkPhysics.includes("ecat") && pkPhysics.includes("pk-fsc-preeng") && !pkPhysics.includes("mdcat"));
  const inBio = ids(curriculaFor({ country: "IN", level: { id: "in-senior", label: "Senior Secondary (Classes 11–12)" }, subjects: subj("Biology") }));
  assert.ok(inBio.includes("neet") && !inBio.includes("jee"));
});

test("search matches labels and aliases; custom entries are allowed and sanitised", () => {
  assert.equal(searchOptions(subjectOptions(), "math")[0].label, "Mathematics");
  assert.ok(searchOptions(subjectOptions(), "cs").some((x) => x.label === "Computer Science"));
  const c = customOption("  Astrophysics   II ");
  assert.equal(c.label, "Astrophysics II");
  assert.ok(c.custom && c.id.startsWith("custom:"));
  const clean = sanitizeOptions([{ id: "physics", label: "Physics" }, { label: "physics" }, { label: "" }, "x", { id: "<bad>", label: "Robotics" }], 10);
  assert.deepEqual(clean.map((x) => x.label), ["Physics", "Robotics"]);
  assert.ok(clean[1].id.startsWith("custom:"));
});

test("levels and topics map onto bands and subjects", () => {
  assert.equal(levelBand({ id: "custom:x", label: "Year 12 A levels" }), "senior");
  assert.equal(levelBand({ id: "gb-gcse", label: "GCSE" }), "secondary");
  assert.equal(subjectForTopic("Photosynthesis in a chloroplast", subj("Biology", "Physics"))?.label, "Biology");
  assert.equal(subjectForTopic("Newton's laws of motion", subj("Biology", "Physics"))?.label, "Physics");
  assert.equal(subjectForTopic("Overfitting in CNNs", subj("Machine Learning / AI"))?.label, "Machine Learning / AI");
  assert.equal(subjectForTopic("French cooking", subj("Physics")), null);
});

test("country names and language fallback", () => {
  assert.equal(countryName("PK"), "Pakistan");
  assert.equal(countryFromLanguage("en-GB,en;q=0.9"), "GB");
  assert.equal(countryFromLanguage("en"), null);
});
