"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, ArrowRight, Atom, BarChart3, BookOpen, Brain, Briefcase, Calculator, ChevronRight, ClipboardCheck,
  Code2, FlaskConical, Flag, Globe2, Landmark, Languages, Leaf, Loader2, Microscope, Moon, Palette, Scale, Search,
  Sigma, Sparkles, Sprout, Stethoscope, TrendingUp, Users, X, HeartHandshake, CheckCircle2, CircleDashed, Target, Trophy,
} from "lucide-react";
import { studentLessonTitle } from "@/lib/curriculum/catalog";
import { applyCheckpoint, checkpointKey, courseCompletion, emptyProgress, lessonKey, markStarted, nextLesson, progressOf, type CourseProgress } from "@/lib/curriculum/mastery";
import type { TestGradeResult, TestQuestion } from "@/lib/testPrompt";
import { standardLevels, type CourseMenu, type MenuLevel, type MenuRegion, type MenuSubject, type SubjectIcon } from "@/lib/curriculum/curation";
import type { CurriculumTree, Region, Subtopic } from "@/lib/curriculum/types";
import { savePendingCurriculum } from "@/lib/pendingTopic";

/**
 * THE COURSES PAGE, three taps from "where do I study" to a lesson (owner, 2026-10-14: "only the
 * essential courses, remove redundant ones, make it easier to use, change the UI"):
 *
 *   country → level ("Matric · Class 9–10", "AP", "O Level") → subject → the course at that level
 *
 * The menu is curated on the server (lib/curriculum/curation.ts): one course per subject per level.
 * The course shows only the classes of the level picked; a lesson opens a panel with its learning
 * goals and Start, which hands the app a brief made of those goals (lib/curriculum/catalog.ts).
 * Where the student is lives in the address (?r=PK&l=matric&s=<course>) so Back and links work.
 */

const ICONS: Record<SubjectIcon, typeof Sigma> = {
  maths: Sigma, physics: Atom, chemistry: FlaskConical, biology: Leaf, science: Microscope, computer: Code2,
  english: BookOpen, language: Languages, islamiat: Moon, religion: HeartHandshake, history: Landmark,
  geography: Globe2, social: Users, economics: TrendingUp, accounting: Calculator, business: Briefcase,
  psychology: Brain, sociology: Users, civics: Scale, statistics: BarChart3, pakistan: Flag, general: Sparkles,
  medical: Stethoscope, art: Palette, environment: Sprout, law: Scale, exam: ClipboardCheck,
};
// One quiet tone per subject family, from the knowledge-map palette (each clears 3:1 on the page).
const TONE: Partial<Record<SubjectIcon, string>> = {
  maths: "var(--map-1)", statistics: "var(--map-1)", physics: "var(--map-4)", chemistry: "var(--map-6)",
  biology: "var(--map-2)", science: "var(--map-2)", environment: "var(--map-2)", computer: "var(--map-5)",
  english: "var(--map-3)", language: "var(--map-3)", history: "var(--map-7)", geography: "var(--map-6)",
  economics: "var(--map-8)", accounting: "var(--map-8)", business: "var(--map-8)", medical: "var(--map-1)",
};
const tone = (i: SubjectIcon) => TONE[i] ?? "var(--accent)";

/** The "Unit checkpoint" card under every unit (off by the owner's choice; the code stays). */
const SHOW_UNIT_CHECKPOINTS = false;

/** Regions hidden from the course menu. */
const HIDDEN_REGIONS = new Set<string>(["PK"]);

function gradeLabel(region: Region, g: string): string {
  if (g === "all") return "All grades";
  if (/^\d+$/.test(g)) return region === "PK" ? `Class ${g}` : `Grade ${g}`;
  if (g === "K") return "Kindergarten";
  if (/^\d+-\d+$/.test(g)) return `Grades ${g.replace("-", "–")}`;
  if (g === "K-2") return "Grades K–2";
  if (g === "MS") return "Middle school";
  if (g === "HS") return "High school";
  const roman: Record<string, string> = { I: "1", II: "2", III: "3", IV: "4", V: "5", VI: "6", VII: "7", VIII: "8", IX: "9", X: "10", XI: "11", XII: "12" };
  if (roman[g.toUpperCase()]) return region === "PK" ? `Class ${roman[g.toUpperCase()]}` : `Grade ${roman[g.toUpperCase()]}`;
  return g;
}

/** A heading without the bookkeeping some sources print before it ("[9] Domain A: …" → "Domain A: …"). */
const clean = (t: string) => t.replace(/^\s*\[[^\]]*\]\s*/, "");

/** Region, standard (US: "national" or a state code), level and subject. */
type Where = { r: Region | null; d?: string | null; l: string | null; s: string | null };
function readWhere(): Where {
  if (typeof window === "undefined") return { r: null, l: null, s: null };
  const q = new URLSearchParams(window.location.search);
  return { r: (q.get("r") as Region) || null, d: q.get("d"), l: q.get("l"), s: q.get("s") };
}
function writeWhere(w: Where) {
  const q = new URLSearchParams();
  if (w.r) q.set("r", w.r);
  if (w.d) q.set("d", w.d);
  if (w.l) q.set("l", w.l);
  if (w.s) q.set("s", w.s);
  const qs = q.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  try { localStorage.setItem("aria.courses.where", JSON.stringify({ r: w.r, d: w.d ?? null, l: w.l })); } catch { /* storage off */ }
}

/**
 * SHOWCASE BUILD (frontend/courses-showcase, a static site): the catalogue only. Course data comes
 * from static files instead of the API, and everything that needs an account or a model — starting
 * a lesson, checkpoints, progress — is hidden.
 */
const SHOWCASE = process.env.NEXT_PUBLIC_COURSES_SHOWCASE === "1";
const MENU_URL = SHOWCASE ? "/data/menu.json" : "/api/curricula";
const treeUrl = (id: string) => (SHOWCASE ? `/data/trees/${id}.json` : `/api/curricula/${id}`);

export function CourseBrowser() {
  const [menu, setMenu] = useState<CourseMenu | null>(null);
  const [where, setWhere] = useState<Where>({ r: null, l: null, s: null });
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch(MENU_URL).then((r) => r.json()).then((raw: { menu: CourseMenu }) => {
      // Regions not offered (owner, 2026-10-17: "hide Pakistan"); International first.
      const regions = raw.menu.regions.filter((x) => !HIDDEN_REGIONS.has(x.region)).sort((a, b) => (a.region === "INTL" ? -1 : b.region === "INTL" ? 1 : 0));
      const d = { menu: { ...raw.menu, regions } };
      setMenu(d.menu);
      let w = readWhere();
      if (!w.r) {
        try { w = { ...w, ...JSON.parse(localStorage.getItem("aria.courses.where") ?? "{}") }; } catch { /* none saved */ }
      }
      const region = d.menu.regions.find((x) => x.region === w.r) ?? d.menu.regions[0];
      const levels = region ? standardLevels(region, w.d) : [];
      const level = levels.find((x) => x.id === w.l) ?? levels[0];
      const std = region?.standards?.some((x) => x.id === w.d) ? w.d : null;
      setWhere({ r: region?.region ?? null, d: std, l: level?.id ?? null, s: w.s && level?.subjects.some((s) => s.key === w.s) ? w.s : null });
    }).catch(() => setMenu({ regions: [] }));
  }, []);

  const go = (w: Where) => { setWhere(w); writeWhere(w); window.scrollTo({ top: 0 }); };
  const baseRegion = menu?.regions.find((x) => x.region === where.r) ?? null;
  // The region as shown: its levels under the chosen standard (lib/curriculum/curation.ts standardLevels).
  const region = useMemo(() => (baseRegion ? { ...baseRegion, levels: standardLevels(baseRegion, where.d) } : null), [baseRegion, where.d]);
  const standard = baseRegion?.standards ? baseRegion.standards.find((x) => x.id === where.d) ?? baseRegion.standards[0] : null;
  const level = region?.levels.find((x) => x.id === where.l) ?? null;
  const subject = level?.subjects.find((s) => s.key === where.s) ?? null;

  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !menu) return null;
    const out: Array<{ region: MenuRegion; level: MenuLevel; subject: MenuSubject }> = [];
    // Searched under the standard chosen for each country (else 51 states each answer "Mathematics").
    for (const r of menu.regions) for (const l of standardLevels(r, r.region === where.r ? where.d : null)) for (const s of l.subjects) {
      if (`${s.name} ${l.name} ${l.detail} ${r.name}`.toLowerCase().includes(q)) out.push({ region: r, level: l, subject: s });
    }
    return out.slice(0, 30);
  }, [query, menu, where.r, where.d]);

  return (
    <main className="hud-canvas relative min-h-screen overflow-x-clip">
      <div aria-hidden="true" className="welcome-glow pointer-events-none absolute inset-x-0 top-0 h-[460px] opacity-50" />
      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-24 pt-8 sm:px-6">
        {subject && region && level ? (
          <CourseView region={region} standardName={standard && standard.id !== "national" ? standard.name : undefined} level={level} subject={subject} onBack={() => go({ ...where, s: null })} />
        ) : (
          <>
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-[2.2rem] font-semibold tracking-[-0.01em] text-[var(--hud-text)] sm:text-[2.8rem]">Courses</h1>
                <p className="mt-1 text-[0.98rem] text-[var(--hud-text-dim)]">Pick where you study, your level, then a subject.</p>
              </div>
              <label className="flex h-11 w-full max-w-xs items-center gap-2 rounded-full border border-[var(--hud-line-strong)] bg-[var(--hud-surface)] px-4 focus-within:border-[var(--accent)]">
                <Search size={16} className="text-[var(--hud-text-faint)]" aria-hidden="true" />
                <span className="sr-only">Search subjects</span>
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a subject" className="min-w-0 flex-1 bg-transparent text-[0.95rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none" />
                {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear"><X size={15} className="text-[var(--hud-text-faint)]" /></button>}
              </label>
            </header>

            {!menu && <div className="mt-20 grid place-items-center"><Loader2 className="animate-spin text-[var(--hud-text-faint)]" /></div>}

            {hits && (
              <section className="mt-8">
                <p className="text-[0.85rem] text-[var(--hud-text-faint)]">{hits.length ? `${hits.length} found` : "Nothing found"}</p>
                <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {hits.map(({ region: r, level: l, subject: s }) => (
                    <SubjectCard key={`${r.region}-${l.id}-${s.key}`} s={s} note={`${r.flag} ${l.name} · ${l.detail}`} onOpen={() => { setQuery(""); go({ r: r.region, d: r.region === where.r ? where.d : null, l: l.id, s: s.key }); }} />
                  ))}
                </ul>
              </section>
            )}

            {!hits && menu && region && (
              <>
                {/* Where you study */}
                <div role="tablist" aria-label="Country" className="mt-8 inline-flex flex-wrap gap-1 rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] p-1">
                  {menu.regions.map((r) => (
                    <button
                      key={r.region} type="button" role="tab" aria-selected={r.region === region.region}
                      onClick={() => go({ r: r.region, d: null, l: standardLevels(r)[0]?.id ?? null, s: null })}
                      className={`rounded-full px-4 py-2 text-[0.95rem] font-medium transition-colors ${r.region === region.region ? "bg-[var(--accent)] text-[var(--accent-on)]" : "text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"}`}
                    >
                      <span aria-hidden="true" className="mr-1.5">{r.flag}</span>{r.name}
                    </button>
                  ))}
                </div>

                {/* Which standards (US: national, or the student's state) — the levels below follow it. */}
                {baseRegion?.standards && standard && (
                  <label className="mt-4 flex w-full max-w-md items-center gap-3 rounded-[14px] border border-[var(--hud-line)] bg-[var(--hud-surface)] px-4 py-2.5 focus-within:border-[var(--accent)]">
                    <span className="shrink-0 text-[0.85rem] font-medium text-[var(--hud-text-dim)]">Standards</span>
                    <select
                      value={standard.id}
                      onChange={(e) => {
                        const d = e.target.value;
                        const levels = standardLevels(baseRegion, d);
                        go({ r: baseRegion.region, d, l: levels.some((x) => x.id === where.l) ? where.l : levels[0]?.id ?? null, s: null });
                      }}
                      className="min-w-0 flex-1 cursor-pointer bg-transparent text-[0.95rem] font-semibold text-[var(--hud-text)] focus:outline-none"
                    >
                      {baseRegion.standards.map((x) => (
                        <option key={x.id} value={x.id} className="bg-[var(--hud-bg)] text-[var(--hud-text)]">
                          {x.id === "national" ? `${x.name} (${x.detail})` : x.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {/* Your level */}
                <div className="mt-6 flex snap-x gap-3 overflow-x-auto pb-2" role="tablist" aria-label="Level">
                  {region.levels.map((l) => {
                    const on = l.id === level?.id;
                    return (
                      <button
                        key={l.id} type="button" role="tab" aria-selected={on}
                        onClick={() => go({ r: region.region, d: where.d, l: l.id, s: null })}
                        className={`min-w-[150px] shrink-0 snap-start rounded-[16px] border px-5 py-4 text-left transition-colors ${on ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--hud-line)] bg-[var(--hud-surface)] hover:border-[var(--hud-line-strong)]"}`}
                      >
                        <span className="block text-[1.15rem] font-semibold text-[var(--hud-text)]">{l.name}</span>
                        <span className="mt-0.5 block text-[0.8rem] text-[var(--hud-text-dim)]">{l.detail}</span>
                        <span className="mt-2 block text-[0.75rem] text-[var(--hud-text-faint)]">{l.subjects.length} {l.subjects.length === 1 ? "subject" : "subjects"}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Subjects */}
                {level && (
                  <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {level.subjects.map((s) => <SubjectCard key={s.key} s={s} onOpen={() => go({ r: region.region, d: where.d, l: level.id, s: s.key })} />)}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function SubjectCard({ s, note, onOpen }: { s: MenuSubject; note?: string; onOpen: () => void }) {
  const Icon = ICONS[s.icon];
  return (
    <li>
      <button type="button" onClick={onOpen} className="group flex h-full w-full items-center gap-4 rounded-[16px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-4 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[var(--hud-line-strong)]">
        <span className="grid size-12 shrink-0 place-items-center rounded-[14px]" style={{ background: `color-mix(in srgb, ${tone(s.icon)} 16%, transparent)` }}>
          <Icon size={22} strokeWidth={1.9} style={{ color: tone(s.icon) }} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[1.02rem] font-semibold leading-snug text-[var(--hud-text)]">{s.name}</span>
          <span className="mt-0.5 block text-[0.8rem] text-[var(--hud-text-dim)]">{note ?? `${s.lessons} lessons${s.verified === false ? " · being checked" : ""}`}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-[var(--hud-text-faint)] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </button>
    </li>
  );
}

type Picked = { lesson: Subtopic; grade: string; unit: string; topic: string; key: string; unitId: string; topicId: string };

/** This course's progress for this browser (lib/curriculum/mastery.ts), saved as it changes. */
function useProgress(courseId: string): [CourseProgress, (f: (p: CourseProgress) => CourseProgress) => void] {
  const storeKey = `aria.course.progress.${courseId}`;
  // Read once on mount (the course view remounts per course, so the key never changes under it).
  const [p, setP] = useState<CourseProgress>(() => {
    try { return { ...emptyProgress(), ...JSON.parse(localStorage.getItem(storeKey) ?? "{}") }; } catch { return emptyProgress(); }
  });
  const update = (f: (q: CourseProgress) => CourseProgress) => setP((q) => {
    const next = f(q);
    try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* storage off */ }
    return next;
  });
  return [p, update];
}

function CourseView({ region, standardName, level, subject, onBack }: { region: MenuRegion; standardName?: string; level: MenuLevel; subject: MenuSubject; onBack: () => void }) {
  const [tree, setTree] = useState<CurriculumTree | null>(null);
  const [error, setError] = useState(false);
  const [grade, setGrade] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [progress, updateProgress] = useProgress(subject.courseId);
  const [checkpoint, setCheckpoint] = useState<{ unitId: string | null; title: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(treeUrl(subject.courseId)).then((r) => (r.ok ? r.json() : Promise.reject())).then((t: CurriculumTree) => {
      if (!live) return;
      setTree(t);
      const first = t.grades.find((g) => !subject.grades.length || subject.grades.includes(g.grade));
      setGrade(first?.grade ?? null);
      setUnitId(first?.units[0]?.id ?? null);
    }).catch(() => live && setError(true));
    return () => { live = false; };
  }, [subject.courseId, subject.grades]);

  const blocks = useMemo(() => tree?.grades.filter((g) => !subject.grades.length || subject.grades.includes(g.grade)) ?? [], [tree, subject.grades]);
  const block = blocks.find((g) => g.grade === grade) ?? blocks[0];
  const unit = block?.units.find((u) => u.id === unitId) ?? block?.units[0];
  const titleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of blocks) for (const u of g.units) for (const t of u.topics) for (const s of t.subtopics) {
      const title = studentLessonTitle(s.title, s.outcomes, t.title);
      counts.set(title, (counts.get(title) ?? 0) + 1);
    }
    return counts;
  }, [blocks]);
  const displayLessonTitle = (s: Subtopic, topic: string) => {
    const title = studentLessonTitle(s.title, s.outcomes, topic);
    return (titleCounts.get(title) ?? 0) > 1 ? `${title} · ${clean(topic)}` : title;
  };
  const Icon = ICONS[subject.icon];

  return (
    <section>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[0.9rem] text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]">
        <ArrowLeft size={15} /> {region.flag} {standardName ? `${standardName} · ` : ""}{level.name} · {level.detail}
      </button>

      <header className="mt-4 flex flex-wrap items-center gap-4">
        <span className="grid size-14 place-items-center rounded-[16px]" style={{ background: `color-mix(in srgb, ${tone(subject.icon)} 16%, transparent)` }}>
          <Icon size={26} strokeWidth={1.9} style={{ color: tone(subject.icon) }} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[2rem] font-semibold leading-tight text-[var(--hud-text)] sm:text-[2.4rem]">{subject.name}</h1>
          <p className="text-[0.88rem] text-[var(--hud-text-dim)]">
            {tree ? [tree.qualification, tree.board, tree.syllabusCode].filter(Boolean).join(" · ") || tree.framework : "Loading…"}
            {tree?.source.urls[0] && <> · <a href={tree.source.urls[0]} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-[var(--hud-text)]">official syllabus</a></>}
          </p>
        </div>
      </header>

      {tree && (
        <div className={`mt-4 flex flex-wrap items-center gap-2 rounded-[12px] border px-4 py-3 text-[0.82rem] ${tree.build.coverage !== null && tree.build.coverage < 0.999 ? "border-[var(--warm)] bg-[color-mix(in_srgb,var(--warm)_10%,transparent)] text-[var(--hud-text)]" : "border-[var(--hud-line)] bg-[var(--hud-surface)] text-[var(--hud-text-dim)]"}`}>
          <span className="font-semibold text-[var(--hud-text)]">Curriculum status:</span>
          {subject.verified === false
            ? "Being checked against the official syllabus — some wording or sections may differ"
            : tree.build.coverage !== null && tree.build.coverage >= 0.999 && tree.build.missingCodes.length === 0
            ? "Mapped to the published syllabus"
            : tree.build.coverage !== null
              ? `Needs curriculum review (${Math.round(tree.build.coverage * 100)}% coded coverage)`
              : "Source mapped; code coverage is not published by this authority"}
          {tree.build.missingCodes.length > 0 && <span>· {tree.build.missingCodes.length} source outcomes missing</span>}
        </div>
      )}

      {error && <p className="mt-10 text-[var(--hud-danger)]">This course could not be loaded.</p>}
      {!tree && !error && <div className="mt-16 grid place-items-center"><Loader2 className="animate-spin text-[var(--hud-text-faint)]" /></div>}

      {tree && block && (
        <>
          {blocks.length > 1 && (
            <div className="mt-6 flex flex-wrap gap-2" role="tablist" aria-label="Class">
              {blocks.map((g) => (
                <button key={g.grade} type="button" role="tab" aria-selected={g.grade === block.grade} onClick={() => { setGrade(g.grade); setUnitId(g.units[0]?.id ?? null); setPicked(null); }}
                  className={`rounded-full px-4 py-2 text-[0.92rem] font-medium transition-colors ${g.grade === block.grade ? "bg-[var(--accent)] text-[var(--accent-on)]" : "border border-[var(--hud-line)] text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"}`}>
                  {gradeLabel(region.region, g.grade)}
                </button>
              ))}
            </div>
          )}

          {/* The class at a glance: mastered lessons, and the assessment over every unit. */}
          {!SHOWCASE && (() => {
            const all = progressOf(progress, block);
            const best = progress.checkpoints[checkpointKey(block.grade)];
            const next = nextLesson(block, progress);
            const completion = courseCompletion(progress, block);
            return (
              <div className="mt-5 rounded-[16px] border border-[var(--hud-line)] bg-[var(--hud-surface)] px-5 py-4">
                <div className="flex flex-wrap items-center gap-4">
                  <Trophy size={20} className="text-[var(--warm)]" aria-hidden="true" />
                  <div className="min-w-[180px] flex-1">
                    <p className="text-[0.92rem] font-semibold text-[var(--hud-text)]">{all.mastered} of {all.total} lessons mastered</p>
                    <div className="mt-1.5 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-[var(--hud-surface-2)]">
                      <div className="h-full rounded-full bg-[var(--ok)]" style={{ width: `${all.total ? (100 * all.mastered) / all.total : 0}%` }} />
                    </div>
                  </div>
                  <button type="button" onClick={() => setCheckpoint({ unitId: null, title: `${blocks.length > 1 ? gradeLabel(region.region, block.grade) + " " : ""}assessment` })}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-[var(--hud-line-strong)] px-4 text-[0.88rem] font-medium text-[var(--hud-text)] hover:bg-[var(--hud-surface-2)]">
                    <Target size={15} /> {best ? `Assessment · best ${best.score}/${best.total}` : "Take the class assessment"}
                  </button>
                </div>
                <p className="mt-3 text-[0.78rem] text-[var(--hud-text-faint)]">
                  Completion requires every lesson mastered and at least 80% on the class assessment.
                  {completion.complete ? " Course complete." : next ? ` Recommended next: ${studentLessonTitle(next.title, [], next.unitTitle)}.` : " Take the class assessment to finish."}
                </p>
              </div>
            );
          })()}

          <div className="mt-6 grid items-start gap-5 lg:grid-cols-[260px_1fr]">
            {/* Units */}
            <nav aria-label="Units" className="flex gap-2 overflow-x-auto pb-1 lg:sticky lg:top-6 lg:flex-col lg:overflow-visible">
              {block.units.map((u, i) => {
                const on = u.id === unit?.id;
                const lessons = u.topics.reduce((n, t) => n + t.subtopics.length, 0);
                return (
                  <button key={u.id} type="button" onClick={() => { setUnitId(u.id); setPicked(null); }}
                    className={`flex min-w-[200px] items-start gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors lg:min-w-0 ${on ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--hud-surface-2)]"}`}>
                    <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[0.72rem] font-semibold ${on ? "bg-[var(--accent)] text-[var(--accent-on)]" : "bg-[var(--hud-surface-2)] text-[var(--hud-text-dim)]"}`}>{i + 1}</span>
                    <span className="min-w-0">
                      <span className={`block text-[0.9rem] leading-snug ${on ? "font-semibold text-[var(--hud-text)]" : "text-[var(--hud-text)]"}`}>{clean(u.title)}</span>
                      <span className="block text-[0.72rem] text-[var(--hud-text-faint)]">{(() => { const pr = progressOf(progress, block, u.id); return pr.mastered ? `${pr.mastered}/${lessons} mastered` : `${lessons} lessons`; })()}</span>
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* Lessons of the unit */}
            {unit && (
              <div>
                {unit.topics.map((t) => (
                  <section key={t.id} className="mb-6">
                    <h2 className="text-[0.82rem] font-semibold uppercase tracking-[0.06em] text-[var(--hud-text-dim)]">{clean(t.title)}</h2>
                    <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                      {t.subtopics.map((s) => (
                        <li key={s.id}>
                          <button type="button" onClick={() => setPicked({ lesson: s, grade: block.grade, unit: unit.title, topic: t.title, key: lessonKey(block.grade, unit.id, t.id, s.id), unitId: unit.id, topicId: t.id })}
                            className={`flex h-full w-full items-center justify-between gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors ${picked?.lesson === s ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--hud-line)] bg-[var(--hud-surface)] hover:border-[var(--hud-line-strong)]"}`}>
                            <span className="flex items-center gap-2 text-[0.95rem] text-[var(--hud-text)]">
                              {(() => {
                                const st = progress.lessons[lessonKey(block.grade, unit.id, t.id, s.id)]?.state;
                                return st === "mastered" ? <CheckCircle2 size={16} className="shrink-0 text-[var(--ok)]" aria-label="Mastered" />
                                  : st === "started" ? <CircleDashed size={16} className="shrink-0 text-[var(--accent-ink)]" aria-label="Started" /> : null;
                              })()}
                              {displayLessonTitle(s, t.title)}
                            </span>
                            <span className="shrink-0 text-[0.72rem] text-[var(--hud-text-faint)]">{s.outcomes.length} {s.outcomes.length === 1 ? "goal" : "goals"}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {/* Unit checkpoints are hidden (owner, 2026-10-17: "remove these checkpoints from the UI"). */}
                {SHOW_UNIT_CHECKPOINTS && !SHOWCASE && (() => {
                  const best = progress.checkpoints[checkpointKey(block.grade, unit.id)];
                  return (
                    <button type="button" onClick={() => setCheckpoint({ unitId: unit.id, title: `Checkpoint: ${clean(unit.title)}` })}
                      className="mt-2 flex w-full items-center gap-4 rounded-[14px] border border-dashed border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-5 py-4 text-left transition-colors hover:bg-[var(--accent-soft)]">
                      <Target size={22} className="shrink-0 text-[var(--accent-ink)]" aria-hidden="true" />
                      <span className="flex-1">
                        <span className="block text-[0.98rem] font-semibold text-[var(--hud-text)]">Unit checkpoint</span>
                        <span className="block text-[0.82rem] text-[var(--hud-text-dim)]">{best ? `Best: ${best.score}/${best.total} — retake to master the rest` : "A short check on this unit. Lessons you get right are marked mastered."}</span>
                      </span>
                      <ArrowRight size={16} className="text-[var(--hud-text-faint)]" aria-hidden="true" />
                    </button>
                  );
                })()}
              </div>
            )}
          </div>
        </>
      )}

      {checkpoint && tree && block && (
        <CheckpointDialog
          courseId={subject.courseId}
          grade={block.grade}
          unitId={checkpoint.unitId}
          title={checkpoint.title}
          onClose={() => setCheckpoint(null)}
          onGraded={(results) => updateProgress((p) => applyCheckpoint(p, checkpointKey(block.grade, checkpoint.unitId), results))}
        />
      )}

      {/* The lesson: what it covers, and Start. */}
      {picked && tree && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
          <button type="button" aria-label="Close" onClick={() => setPicked(null)} className="fixed inset-0 bg-[var(--scrim)] backdrop-blur-sm" />
          <div role="dialog" aria-modal="true" aria-label={displayLessonTitle(picked.lesson, picked.topic)} className="welcome-dialog relative w-full max-w-lg rounded-t-[20px] border border-[var(--hud-line)] bg-[var(--hud-bg)] p-6 shadow-[var(--elev-2)] sm:rounded-[20px]">
            <button type="button" onClick={() => setPicked(null)} aria-label="Close" className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]"><X size={16} /></button>
            <p className="pr-10 text-[0.75rem] font-medium uppercase tracking-[0.06em] text-[var(--hud-text-faint)]">{gradeLabel(region.region, picked.grade)} · {clean(picked.topic)}</p>
            <h3 className="mt-1.5 text-[1.35rem] font-semibold leading-snug text-[var(--hud-text)]">{displayLessonTitle(picked.lesson, picked.topic)}</h3>
            <p className="mt-4 text-[0.82rem] font-medium text-[var(--hud-text-dim)]">By the end you can:</p>
            <ul className="mt-2 max-h-[40vh] space-y-2 overflow-y-auto pr-1">
              {picked.lesson.outcomes.map((o, i) => (
                <li key={i} className="flex gap-2.5 text-[0.92rem] leading-snug text-[var(--hud-text)]">
                  <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{o.text}</span>
                </li>
              ))}
            </ul>
            {!SHOWCASE && <button type="button"
              onClick={() => { updateProgress((p) => markStarted(p, picked.key)); savePendingCurriculum({ courseId: subject.courseId, version: tree.build.builtAt, grade: picked.grade, unitId: picked.unitId, topicId: picked.topicId, lessonId: picked.lesson.id }); window.location.href = "/"; }}
              className="hud-btn-primary mt-6 inline-flex h-12 w-full items-center justify-center gap-2 text-[1rem] font-semibold" style={{ borderRadius: 999 }}>
              Start lesson <ArrowRight size={16} />
            </button>}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * A checkpoint: short-answer questions written for this unit's (or class's) lessons, graded by the
 * app's test grader; each lesson answered correctly becomes mastered. The question set is kept in
 * the browser, so retaking it costs nothing; "New questions" asks for a fresh set.
 */
function CheckpointDialog({ courseId, grade, unitId, title, onClose, onGraded }: {
  courseId: string; grade: string; unitId: string | null; title: string;
  onClose: () => void; onGraded: (results: Array<{ lessonKey: string; correct: boolean }>) => void;
}) {
  const bankKey = `aria.course.cp.${courseId}.${checkpointKey(grade, unitId)}`;
  const saved = (() => {
    try { const q = JSON.parse(localStorage.getItem(bankKey) ?? "null") as TestQuestion[] | null; return q?.length ? q : null; } catch { return null; }
  })();
  const [questions, setQuestions] = useState<TestQuestion[] | null>(saved);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<Record<string, TestGradeResult> | null>(null);
  const [busy, setBusy] = useState(!saved);
  const [error, setError] = useState<string | null>(null);

  const fetchBank = () =>
    fetch("/api/curricula/checkpoint", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId, grade, unitId }) })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not load the checkpoint.");
        setQuestions(data.questions);
        try { localStorage.setItem(bankKey, JSON.stringify(data.questions)); } catch { /* storage off */ }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));

  // First open with no saved set: write one (busy starts true for exactly this case).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!saved) void fetchBank(); }, []);

  const freshQuestions = () => {
    setError(null); setResults(null); setAnswers({}); setQuestions(null); setBusy(true);
    void fetchBank();
  };

  const submit = async () => {
    if (!questions) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/grade-test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ questions, answers }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.results)) throw new Error(data.error ?? "Could not mark your answers.");
      const byId = Object.fromEntries((data.results as TestGradeResult[]).map((r) => [r.id, r]));
      setResults(byId);
      onGraded(questions.map((q) => ({ lessonKey: q.beatId, correct: Boolean(byId[q.id]?.correct) })));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const score = results && questions ? questions.reduce((sum, q) => sum + (results[q.id]?.pointsEarned ?? 0), 0) : null;
  const available = results && questions ? questions.reduce((sum, q) => sum + (results[q.id]?.pointsAvailable ?? 0), 0) : null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 bg-[var(--scrim)] backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-label={title} className="welcome-dialog relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-[20px] border border-[var(--hud-line)] bg-[var(--hud-bg)] shadow-[var(--elev-2)] sm:rounded-[20px]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--hud-line)] px-6 py-4">
          <div>
            <p className="text-[0.75rem] font-medium uppercase tracking-[0.06em] text-[var(--hud-text-faint)]">Checkpoint</p>
            <h3 className="text-[1.2rem] font-semibold text-[var(--hud-text)]">{title}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {busy && !questions && <p className="flex items-center gap-2 text-[0.92rem] text-[var(--hud-text-dim)]"><Loader2 size={16} className="animate-spin" /> Writing your questions…</p>}
          {error && <p role="alert" className="text-[0.9rem] text-[var(--hud-danger)]">{error}</p>}
          {score !== null && questions && (
            <p className="mb-4 rounded-[12px] bg-[var(--accent-soft)] px-4 py-3 text-[0.95rem] font-medium text-[var(--hud-text)]">
              {score} of {available} marks. {score === available ? "Every lesson here is mastered." : "Review the missing points, then retake."}
            </p>
          )}
          <ol className="space-y-5">
            {questions?.map((q, i) => {
              const r = results?.[q.id];
              return (
                <li key={q.id}>
                  <p className="text-[0.95rem] font-medium leading-snug text-[var(--hud-text)]">{i + 1}. {q.prompt}</p>
                  <textarea
                    value={answers[q.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                    disabled={Boolean(results)} rows={2} placeholder="Your answer"
                    className="mt-2 w-full resize-y rounded-[10px] border border-[var(--input-border)] bg-[var(--hud-surface)] px-3 py-2 text-[0.92rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--accent)] focus:outline-none"
                  />
                  {r && (
                    <div className={`mt-2 rounded-[10px] px-3 py-2 text-[0.85rem] ${r.status === "correct" ? "bg-[var(--ok-dim)] text-[var(--hud-text)]" : r.status === "partial" ? "bg-amber-400/10 text-[var(--hud-text)]" : "bg-[var(--danger-dim)] text-[var(--hud-text)]"}`}>
                      <p className="font-medium">{r.status === "correct" ? "Correct" : r.status === "partial" ? "Partially correct" : "Misconception"} — {r.feedback}</p>
                      {r.missingKeyPoints.length > 0 && <p className="mt-1 text-amber-300">Still needed: {r.missingKeyPoints.join("; ")}</p>}
                      {r.misconception && <p className="mt-1 text-[var(--hud-danger)]">Misconception: {r.misconception}</p>}
                      {r.status === "misconception" && q.rubric.modelAnswer && <p className="mt-1 text-[var(--hud-text-dim)]">A good answer: {q.rubric.modelAnswer}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
        {questions && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--hud-line)] px-6 py-4">
            {results ? (
              <>
                <button type="button" onClick={freshQuestions} className="h-10 rounded-full px-4 text-[0.88rem] text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]">New questions</button>
                <button type="button" onClick={() => { setResults(null); setAnswers({}); }} className="hud-btn-primary h-10 px-5 text-[0.9rem] font-semibold" style={{ borderRadius: 999 }}>Retake</button>
              </>
            ) : (
              <button type="button" disabled={busy || !Object.values(answers).some((a) => a.trim())} onClick={() => void submit()} className="hud-btn-primary inline-flex h-10 items-center gap-2 px-5 text-[0.9rem] font-semibold disabled:opacity-50" style={{ borderRadius: 999 }}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : null} Check my answers
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
