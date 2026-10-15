import type { CatalogEntry } from "./catalog";
import type { Region } from "./types";

/**
 * THE COURSES STUDENTS SEE (owner, 2026-10-14: "only include the essential courses, remove
 * redundant ones, make it easier to use").
 *
 * The catalogue holds every official document we extracted — several versions of a syllabus, an
 * exam-board copy of the national curriculum, technical streams, 469 US state sets. Students see a
 * curated menu instead: country → level (the way they describe themselves: "Class 9", "AP",
 * "O Level") → one course per subject, showing only that level's grades. Everything else stays in
 * data/curricula/trees and can be added here later.
 */

export type SubjectIcon =
  | "maths" | "physics" | "chemistry" | "biology" | "science" | "computer" | "english" | "language"
  | "islamiat" | "religion" | "history" | "geography" | "social" | "economics" | "accounting"
  | "business" | "psychology" | "sociology" | "civics" | "statistics" | "pakistan" | "general"
  | "medical" | "art" | "environment" | "law" | "exam";

export type MenuSubject = {
  key: string;
  name: string;
  icon: SubjectIcon;
  courseId: string;
  /** The course's grade labels shown at this level (empty = the course is not split by grade). */
  grades: string[];
  lessons: number;
  /** False when the course tree does not yet account for every outcome in its source (catalog quality "review"). */
  verified: boolean;
};
export type MenuLevel = { id: string; name: string; detail: string; subjects: MenuSubject[] };
/** One set of standards a region can be taught to (US: the national standards, or one state's). */
export type MenuStandard = { id: string; name: string; detail: string; levels: MenuLevel[] };
export type MenuRegion = {
  region: Region;
  name: string;
  flag: string;
  /** With `standards`: the levels every standard shares (US: AP, SAT & ACT), shown after the chosen standard's own. */
  levels: MenuLevel[];
  /** The standards a student picks between; the first is the default. See `standardLevels`. */
  standards?: MenuStandard[];
};
export type CourseMenu = { regions: MenuRegion[] };

/** The levels a region shows under a standard (the default one when `standardId` is unknown). */
export function standardLevels(region: MenuRegion, standardId?: string | null): MenuLevel[] {
  const std = region.standards?.find((x) => x.id === standardId) ?? region.standards?.[0];
  return std ? [...std.levels, ...region.levels] : region.levels;
}

/** Every course the menu can open, under every standard. */
export function menuCourseIds(menu: CourseMenu): string[] {
  const levels = menu.regions.flatMap((r) => [...r.levels, ...(r.standards ?? []).flatMap((x) => x.levels)]);
  return [...new Set(levels.flatMap((l) => l.subjects.map((x) => x.courseId)))];
}

type Pick = { name: string; icon: SubjectIcon; id: string; grades?: string[] };
type LevelSpec = { id: string; name: string; detail: string; grades?: string[]; picks: Pick[] };

const PK_PRIMARY_CORE: Pick[] = [
  { name: "English", icon: "english", id: "pk-ncp-english-1-12" },
  // The NCP 1–12 extraction is incomplete for Classes 1–8. Use the reviewed FBISE-hosted
  // multi-domain tree until the primary/middle NCP PDF is re-extracted section by section.
  { name: "Mathematics", icon: "maths", id: "pk-nc2006-mathematics-1-12" },
];
const PK_SECONDARY_CORE: Pick[] = [
  { name: "English", icon: "english", id: "pk-ncp-english-1-12" },
  { name: "Mathematics", icon: "maths", id: "pk-ncp-mathematics-9-12-fbise" },
];

/** Pakistan: National Curriculum 2022-23 (what FBISE examines); the richer 2026 Urdu/Islamiat for 9-12. */
const PAKISTAN: LevelSpec[] = [
  {
    id: "primary", name: "Primary", detail: "Class 1–5", grades: ["1", "2", "3", "4", "5"],
    picks: [
      ...PK_PRIMARY_CORE,
      { name: "Urdu", icon: "language", id: "pk-ncp-urdu-1-12" },
      { name: "Islamiat", icon: "islamiat", id: "pk-ncp-islamiat-1-12" },
      { name: "General Science", icon: "science", id: "pk-ncp-general-science-4-8" },
      { name: "General Knowledge", icon: "general", id: "pk-ncp-general-knowledge-1-3" },
      { name: "Social Studies", icon: "social", id: "pk-ncp-social-studies-4-5" },
      { name: "Computer (ICT)", icon: "computer", id: "pk-ncp-ict-1-5" },
      { name: "Religious Education", icon: "religion", id: "pk-ncp-religious-education-1-12" },
    ],
  },
  {
    id: "middle", name: "Middle", detail: "Class 6–8", grades: ["6", "7", "8"],
    picks: [
      ...PK_PRIMARY_CORE,
      { name: "Urdu", icon: "language", id: "pk-ncp-urdu-1-12" },
      { name: "Islamiat", icon: "islamiat", id: "pk-ncp-islamiat-1-12" },
      { name: "General Science", icon: "science", id: "pk-ncp-general-science-4-8" },
      { name: "Computer Science", icon: "computer", id: "pk-ncp-computer-science-6-12" },
      { name: "History", icon: "history", id: "pk-ncp-history-6-8" },
      { name: "Geography", icon: "geography", id: "pk-ncp-geography-6-8" },
      { name: "Religious Education", icon: "religion", id: "pk-ncp-religious-education-1-12" },
    ],
  },
  {
    id: "matric", name: "Matric", detail: "Class 9–10", grades: ["9", "10"],
    picks: [
      ...PK_SECONDARY_CORE,
      { name: "Physics", icon: "physics", id: "pk-ncp-physics-9-12" },
      { name: "Chemistry", icon: "chemistry", id: "pk-ncp-chemistry-9-12" },
      { name: "Biology", icon: "biology", id: "pk-ncp-biology-9-12" },
      { name: "Computer Science", icon: "computer", id: "pk-ncp-computer-science-6-12" },
      { name: "General Science", icon: "science", id: "pk-ncp-general-science-9-10" },
      { name: "Urdu", icon: "language", id: "pk-ncp2026-urdu-9-12" },
      { name: "Islamiat", icon: "islamiat", id: "pk-ncp2026-islamiat-9-12" },
      { name: "Pakistan Studies", icon: "pakistan", id: "pk-ncp-pakistan-studies-9-12" },
      { name: "Economics", icon: "economics", id: "pk-ncp-economics-9-12" },
      { name: "Religious Education", icon: "religion", id: "pk-ncp-religious-education-1-12" },
    ],
  },
  {
    id: "intermediate", name: "Intermediate", detail: "Class 11–12 (FSc / ICS / I.Com / FA)", grades: ["11", "12"],
    picks: [
      ...PK_SECONDARY_CORE,
      { name: "Physics", icon: "physics", id: "pk-ncp-physics-9-12" },
      { name: "Chemistry", icon: "chemistry", id: "pk-ncp-chemistry-9-12" },
      { name: "Biology", icon: "biology", id: "pk-ncp-biology-9-12" },
      { name: "Computer Science", icon: "computer", id: "pk-ncp-computer-science-6-12" },
      { name: "Urdu", icon: "language", id: "pk-ncp2026-urdu-9-12" },
      { name: "Islamiat", icon: "islamiat", id: "pk-ncp2026-islamiat-9-12" },
      { name: "Pakistan Studies", icon: "pakistan", id: "pk-ncp-pakistan-studies-9-12" },
      { name: "Economics", icon: "economics", id: "pk-ncp-economics-9-12" },
      { name: "Accounting", icon: "accounting", id: "pk-ncp-principles-accounting-11-12" },
      { name: "Commerce", icon: "business", id: "pk-ncp-principles-commerce-11" },
      { name: "Statistics", icon: "statistics", id: "pk-ncp-statistics-11-12" },
      { name: "Psychology", icon: "psychology", id: "pk-ncp-psychology-11-12" },
      { name: "Sociology", icon: "sociology", id: "pk-ncp-sociology-11-12" },
      { name: "Civics", icon: "civics", id: "pk-ncp-civics-11-12" },
      { name: "Religious Education", icon: "religion", id: "pk-ncp-religious-education-1-12" },
    ],
  },
  { id: "mdcat", name: "MDCAT", detail: "Medical entry test", picks: [{ name: "MDCAT (all subjects)", icon: "medical", id: "pk-mdcat-pmdc-2025" }] },
];

/** United States: the national standards (Common Core, NGSS, C3, CSTA), AP, SAT and ACT. */
const US_K12 = (grades: string[]): Pick[] => [
  { name: "Mathematics", icon: "maths", id: "us-ccss-math-k-12-csp", grades: [...grades, "all"] },
  { name: "English Language Arts", icon: "english", id: "us-ccss-ela-literacy-k-12-csp", grades },
  { name: "Science", icon: "science", id: "us-ngss-k-12-topic-arrangements", grades },
  { name: "Social Studies", icon: "social", id: "us-c3-social-studies-k-12", grades },
  { name: "Computer Science", icon: "computer", id: "us-csta-computer-science-pk-12-2026", grades },
];
/** The US school levels, as grade spans (PK = -1, K = 0), for placing a state's grade bands. */
const US_BANDS = [
  { id: "elementary", name: "Elementary", detail: "Grades K–5", lo: -1, hi: 5 },
  { id: "middle", name: "Middle School", detail: "Grades 6–8", lo: 6, hi: 8 },
  { id: "high", name: "High School", detail: "Grades 9–12", lo: 9, hi: 12 },
];
/** A state's subjects, in menu order: course id `us-<state>-<slug>`. */
const STATE_SUBJECTS: Array<[string, string, SubjectIcon]> = [
  ["mathematics", "Mathematics", "maths"], ["english-language-arts", "English Language Arts", "english"],
  ["science", "Science", "science"], ["social-studies", "Social Studies", "social"],
  ["computer-science", "Computer Science", "computer"], ["world-languages", "World Languages", "language"],
  ["arts", "Fine Arts", "art"], ["health", "Health", "general"], ["physical-education", "Physical Education", "general"],
  ["personal-finance", "Personal Finance", "economics"], ["english-language-development", "English Language Development", "english"],
  ["spanish-language-arts", "Spanish Language Arts", "language"],
];
/** "9-12", "10-9", "1-K", "PK" → the grades it spans; null for labels that are not grades ("all"). */
function gradeSpan(label: string): [number, number] | null {
  const n = label.toUpperCase().split("-").map((x) => (x === "PK" ? -1 : x === "K" ? 0 : /^\d{1,2}$/.test(x) ? Number(x) : NaN));
  return n.length > 2 || n.some(Number.isNaN) ? null : [Math.min(...n), Math.max(...n)];
}

/** Each state's own standards as a menu standard: its grade bands placed in Elementary/Middle/High. */
function stateStandards(entries: CatalogEntry[]): MenuStandard[] {
  const states = new Map<string, { name: string; courses: Map<string, CatalogEntry> }>();
  for (const e of entries) {
    const id = /^us-([a-z]{2})-(.+)$/.exec(e.id);
    const name = /^(.+) state academic standards/.exec(e.framework)?.[1];
    if (!id || !name || !menuEligible(e)) continue;
    const st = states.get(id[1]) ?? { name, courses: new Map() };
    st.courses.set(id[2], e);
    states.set(id[1], st);
  }
  return [...states.entries()]
    .map(([code, st]) => ({
      id: code,
      name: st.name,
      detail: `${st.name} state standards`,
      levels: US_BANDS.map((b) => ({
        id: b.id, name: b.name, detail: b.detail,
        subjects: STATE_SUBJECTS.flatMap(([slug, name, icon]) => {
          const e = st.courses.get(slug);
          const grades = e?.grades.map((g) => g.grade).filter((g) => { const span = gradeSpan(g); return span !== null && span[0] <= b.hi && span[1] >= b.lo; }) ?? [];
          if (!e || !grades.length) return [];
          const s = subjectFrom(e, name, icon, grades);
          return s.lessons >= MIN_LESSONS ? [s] : [];
        }),
      })).filter((l) => l.subjects.length),
    }))
    .filter((x) => x.levels.length)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const AP_ICON: Array<[RegExp, SubjectIcon]> = [
  [/calculus|precalculus|statistics/i, "maths"], [/physics/i, "physics"], [/chemistry/i, "chemistry"], [/biology/i, "biology"],
  [/environmental/i, "environment"], [/computer|cybersecurity/i, "computer"], [/english/i, "english"],
  [/language|latin|spanish|french|german|italian|japanese|chinese/i, "language"], [/history|african american/i, "history"],
  [/government|politics/i, "civics"], [/economics|business/i, "economics"], [/psychology/i, "psychology"],
  [/geography/i, "geography"], [/art|music/i, "art"], [/seminar|research/i, "exam"],
];

/** Cambridge International: one version per subject (the A*-G IGCSE over its 9-1 twin), core subjects only. */
const CAMBRIDGE_SUBJECTS: Array<[RegExp, string, SubjectIcon]> = [
  [/^Mathematics( \(Syllabus D\))?$/, "Mathematics", "maths"],
  [/^Mathematics - Additional$/, "Additional Mathematics", "maths"],
  [/^Mathematics - Further$/, "Further Mathematics", "maths"],
  [/^Physics$/, "Physics", "physics"],
  [/^Chemistry$/, "Chemistry", "chemistry"],
  [/^Biology$/, "Biology", "biology"],
  [/^Science - Combined$/, "Combined Science", "science"],
  [/^Sciences - Co-ordinated \(Double\)$/, "Co-ordinated Sciences", "science"],
  [/^Computer Science$/, "Computer Science", "computer"],
  [/^Information and Communication Technology$|^Information Technology$/, "Information Technology", "computer"],
  [/^English Language$|^English$|^English - Language and Literature$/, "English Language", "english"],
  [/^Literature in English$|^English - Literature$/, "English Literature", "english"],
  [/^English as a Second Language \(Speaking endorsement\)$/i, "English as a Second Language", "english"],
  [/^English General Paper$/, "English General Paper", "english"],
  [/^Economics$/, "Economics", "economics"],
  [/^Business( Studies)?$/, "Business", "business"],
  [/^Accounting$/, "Accounting", "accounting"],
  [/^Commerce$/, "Commerce", "business"],
  [/^Geography$/, "Geography", "geography"],
  [/^History$/, "History", "history"],
  [/^Sociology$/, "Sociology", "sociology"],
  [/^Psychology$/, "Psychology", "psychology"],
  [/^Islamiyat$|^Islamic Studies$/, "Islamiyat", "islamiat"],
  [/^Pakistan Studies$/, "Pakistan Studies", "pakistan"],
  [/^Urdu - (First Language|Second Language|Language)$|^Urdu as a Second Language$/, "Urdu", "language"],
  [/^Environmental Management$/, "Environmental Management", "environment"],
  [/^Global Perspectives( & Research)?$/, "Global Perspectives", "general"],
  [/^Law$/, "Law", "law"],
  [/^Statistics$/, "Statistics", "statistics"],
  [/^Art & Design$/, "Art & Design", "art"],
];
const CAMBRIDGE_LEVELS: Array<{ id: string; name: string; detail: string; families: string[] }> = [
  { id: "igcse", name: "IGCSE", detail: "Cambridge, age 14–16", families: ["Cambridge IGCSE"] },
  { id: "olevel", name: "O Level", detail: "Cambridge, age 14–16", families: ["Cambridge O Level"] },
  { id: "alevel", name: "AS & A Level", detail: "Cambridge, age 16–19", families: ["Cambridge AS & A Level", "Cambridge A Level", "Cambridge AS Level"] },
];

/** A course thinner than this at a level is not shown until it is rebuilt (it would look broken). */
export const MIN_LESSONS = 8;

function subjectFrom(e: CatalogEntry, name: string, icon: SubjectIcon, levelGrades?: string[]): MenuSubject {
  const own = e.grades.map((g) => g.grade);
  const grades = levelGrades ? own.filter((g) => levelGrades.some((wanted) => sameGrade(g, wanted))) : own.length > 1 ? own : [];
  const lessons = e.grades.filter((g) => grades.length === 0 || grades.includes(g.grade)).reduce((n, g) => n + g.lessons, 0);
  return { key: `${e.id}:${name}`, name, icon, courseId: e.id, grades, lessons, verified: e.quality !== "review" };
}

const ROMAN_GRADES: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8", IX: "9", X: "10", XI: "11", XII: "12" };
function sameGrade(actual: string, wanted: string): boolean {
  return actual === wanted || ROMAN_GRADES[actual.toUpperCase()] === wanted;
}

function menuEligible(e: CatalogEntry): boolean {
  // Known missing source codes mean the tree must not be presented as a complete syllabus.
  // Code-less official trees remain available, but their header can still be marked for review.
  return e.lessons >= MIN_LESSONS && e.missingCodes === 0 && (e.coverage === null || e.coverage >= 0.999);
}

function fromPicks(specs: LevelSpec[], byId: Map<string, CatalogEntry>): MenuLevel[] {
  return specs.map((l) => ({
    id: l.id,
    name: l.name,
    detail: l.detail,
    subjects: l.picks.flatMap((p) => {
      const e = byId.get(p.id);
      if (!e || !menuEligible(e)) return [];
      const s = subjectFrom(e, p.name, p.icon, p.grades ?? l.grades);
      return s.lessons >= MIN_LESSONS ? [s] : [];
    }),
  })).filter((l) => l.subjects.length);
}

/** The curated menu from the full catalogue (lib/curriculum/catalog.ts entries). */
export function buildMenu(entries: CatalogEntry[]): CourseMenu {
  const byId = new Map(entries.map((e) => [e.id, e]));

  // School levels follow the standard the student picks (national, or their state's); AP and the
  // admission tests are national, so every standard shares them.
  const usNational: MenuStandard = {
    id: "national", name: "National", detail: "Common Core · NGSS · C3 · CSTA",
    levels: fromPicks([
      { id: "elementary", name: "Elementary", detail: "Grades K–5", picks: US_K12(["K", "1", "2", "3", "4", "5", "K-2", "3-5"]) },
      { id: "middle", name: "Middle School", detail: "Grades 6–8", picks: US_K12(["6", "7", "8", "6-8", "MS"]) },
      { id: "high", name: "High School", detail: "Grades 9–12", picks: US_K12(["9", "10", "11", "12", "9-10", "11-12", "9-12", "HS", "HS Specialty"]) },
    ], byId),
  };
  const usLevels: MenuLevel[] = [
    {
      id: "ap", name: "AP", detail: "Advanced Placement",
      subjects: entries
        .filter((e) => e.region === "US" && e.id.startsWith("us-ap-") && menuEligible(e))
        .sort((a, b) => a.subject.localeCompare(b.subject))
        .map((e) => subjectFrom(e, `AP ${e.subject.replace(/ \(AP Capstone\)$/, "")}`, AP_ICON.find(([re]) => re.test(e.subject))?.[1] ?? "exam", [])),
    },
    ...fromPicks([{
      id: "tests", name: "SAT & ACT", detail: "College admission tests",
      picks: [
        { name: "SAT", icon: "exam", id: "us-sat-suite-assessment-framework", grades: [] },
        { name: "ACT English", icon: "english", id: "us-act-ccrs-english", grades: [] },
        { name: "ACT Math", icon: "maths", id: "us-act-ccrs-math", grades: [] },
        { name: "ACT Reading", icon: "english", id: "us-act-ccrs-reading", grades: [] },
        { name: "ACT Science", icon: "science", id: "us-act-ccrs-science", grades: [] },
        { name: "ACT Writing", icon: "english", id: "us-act-ccrs-writing", grades: [] },
      ],
    }], byId),
  ];

  const cambridgeLevels: MenuLevel[] = CAMBRIDGE_LEVELS.map((l) => {
    const chosen = new Map<string, { e: CatalogEntry; icon: SubjectIcon }>();
    for (const e of entries) {
      if (e.region !== "INTL" || !l.families.includes(e.family) || !menuEligible(e)) continue;
      const hit = CAMBRIDGE_SUBJECTS.find(([re]) => re.test(e.subject.trim()));
      if (!hit) continue;
      const [, name, icon] = hit;
      const at = chosen.get(name);
      // One course per subject: the main syllabus (not "International Mathematics", not a 9-1 twin), else the fuller one.
      if (!at || e.lessons > at.e.lessons) chosen.set(name, { e, icon });
    }
    return {
      id: l.id,
      name: l.name,
      detail: l.detail,
      subjects: CAMBRIDGE_SUBJECTS.map(([, name]) => name)
        .filter((n, i, a) => a.indexOf(n) === i && chosen.has(n))
        .map((n) => subjectFrom(chosen.get(n)!.e, n, chosen.get(n)!.icon, []))
        .filter((s) => s.lessons >= MIN_LESSONS),
    };
  }).filter((l) => l.subjects.length);

  return {
    regions: [
      { region: "PK", name: "Pakistan", flag: "🇵🇰", levels: fromPicks(PAKISTAN, byId) },
      { region: "US", name: "United States", flag: "🇺🇸", levels: usLevels.filter((l) => l.subjects.length), standards: [usNational, ...stateStandards(entries)] },
      { region: "INTL", name: "International", flag: "🌍", levels: cambridgeLevels },
    ].filter((r) => standardLevels(r as MenuRegion).length) as MenuRegion[],
  };
}
