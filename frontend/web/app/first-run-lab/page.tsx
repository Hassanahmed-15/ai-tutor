"use client";

/**
 * FIRST-RUN LAB — a clickable demo of what a student meets right after signing in (owner's ask,
 * 2026-10-13: "ask what subject to study… I want innovative ideas", then "implement these, I want
 * to see what you mean"). Nothing here is wired into the real home page yet.
 *
 *   1. Dot asks the first question herself, out loud; subjects float around her (tap or say one).
 *   2. A subject opens as a star map of its topics, the first one glowing "start here".
 *   3. "Show me your syllabus": a photo of a contents page becomes the student's own map (demo:
 *      sample chapters — the real version would read the page).
 *   4. "Not sure?": curiosity cards, each a one-minute lesson.
 *   5. Coming back: Dot offers a recap quiz or the next topic, one tap each.
 *   6. "Exam coming up?": a date turns the map into a day-by-day plan.
 *
 * Starting a lesson is real: the topic is saved (lib/pendingTopic.ts) and the app at / starts it,
 * exactly as the welcome page's Generate does.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Atom,
  BookOpen,
  CalendarDays,
  Camera,
  Check,
  Code2,
  FlaskConical,
  Landmark,
  Leaf,
  Lightbulb,
  Mic,
  RotateCcw,
  Sigma,
  TrendingUp,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { DotAvatar, type DotMouthInput } from "@/components/avatar/DotAvatar";
import { letterMouth } from "@/components/pages/AriaBot";
import { savePendingTopic } from "@/lib/pendingTopic";

type Topic = { name: string; line: string };
type Subject = { id: string; name: string; icon: typeof Sigma; color: string; topics: Topic[] };

const SUBJECTS: Subject[] = [
  { id: "maths", name: "Maths", icon: Sigma, color: "var(--map-1)", topics: [
    { name: "Fractions", line: "Parts of a whole, and how to add them." },
    { name: "Algebra basics", line: "Letters that stand for numbers." },
    { name: "Linear equations", line: "Solve for x, step by step." },
    { name: "Quadratic equations", line: "Curves, roots and the formula." },
    { name: "Trigonometry", line: "Angles and sides of triangles." },
    { name: "Probability", line: "How likely something is." },
    { name: "Differentiation", line: "How fast things change." },
  ] },
  { id: "physics", name: "Physics", icon: Atom, color: "var(--map-4)", topics: [
    { name: "Speed and velocity", line: "How fast, and in which direction." },
    { name: "Newton's laws", line: "Why things move the way they do." },
    { name: "Work and energy", line: "Where energy goes and how it changes." },
    { name: "Waves", line: "Sound, light and ripples." },
    { name: "Electricity", line: "Current, voltage and resistance." },
    { name: "Magnetism", line: "Fields, poles and motors." },
    { name: "Atoms and radiation", line: "What's inside an atom." },
  ] },
  { id: "chemistry", name: "Chemistry", icon: FlaskConical, color: "var(--map-6)", topics: [
    { name: "States of matter", line: "Solids, liquids and gases." },
    { name: "Atomic structure", line: "Protons, neutrons, electrons." },
    { name: "The periodic table", line: "Why elements sit where they do." },
    { name: "Chemical bonding", line: "How atoms hold together." },
    { name: "Acids and bases", line: "pH and neutralisation." },
    { name: "Rates of reaction", line: "What makes reactions faster." },
    { name: "Organic chemistry", line: "Carbon and its compounds." },
  ] },
  { id: "biology", name: "Biology", icon: Leaf, color: "var(--map-2)", topics: [
    { name: "Cells", line: "The building blocks of life." },
    { name: "Photosynthesis", line: "How a leaf makes food from light." },
    { name: "Respiration", line: "How cells get energy from food." },
    { name: "Digestion", line: "From food to fuel." },
    { name: "The heart", line: "How blood travels round the body." },
    { name: "DNA and genes", line: "The instructions inside every cell." },
    { name: "Evolution", line: "How living things change over time." },
  ] },
  { id: "cs", name: "Computer Science", icon: Code2, color: "var(--map-5)", topics: [
    { name: "Binary", line: "How computers count with 0 and 1." },
    { name: "Algorithms", line: "Step-by-step recipes for problems." },
    { name: "Variables and loops", line: "The first ideas of programming." },
    { name: "Searching and sorting", line: "Finding and ordering things fast." },
    { name: "Networks", line: "How the internet moves data." },
    { name: "Databases", line: "Storing and finding information." },
  ] },
  { id: "english", name: "English", icon: BookOpen, color: "var(--map-3)", topics: [
    { name: "Parts of speech", line: "Nouns, verbs and friends." },
    { name: "Tenses", line: "Past, present and future." },
    { name: "Paragraph writing", line: "One idea, well built." },
    { name: "Persuasive essays", line: "Making a case that convinces." },
    { name: "Poetry analysis", line: "Reading what a poem really says." },
  ] },
  { id: "history", name: "History", icon: Landmark, color: "var(--map-7)", topics: [
    { name: "Ancient civilisations", line: "Egypt, Indus and Mesopotamia." },
    { name: "The Mughal Empire", line: "Rulers, art and decline." },
    { name: "The Industrial Revolution", line: "Machines that changed the world." },
    { name: "World War I", line: "Causes and consequences." },
    { name: "World War II", line: "How it started and ended." },
    { name: "Independence of Pakistan", line: "The road to 1947." },
  ] },
  { id: "economics", name: "Economics", icon: TrendingUp, color: "var(--map-8)", topics: [
    { name: "Supply and demand", line: "Why prices go up and down." },
    { name: "Inflation", line: "Why money buys less over time." },
    { name: "Markets", line: "Competition and monopolies." },
    { name: "Money and banks", line: "What banks actually do." },
    { name: "Trade", line: "Why countries buy and sell." },
  ] },
];

const CURIOUS = [
  { q: "Why is the sky blue?", subject: "physics" },
  { q: "How does your phone know where you are?", subject: "physics" },
  { q: "Why do we need sleep?", subject: "biology" },
  { q: "How does a vaccine train your body?", subject: "biology" },
  { q: "Why does ice float?", subject: "chemistry" },
  { q: "How does Google find things so fast?", subject: "cs" },
];

/** Demo stand-in for what reading a contents page would return. */
const SAMPLE_CHAPTERS: Topic[] = [
  { name: "Measurements", line: "Chapter 1" },
  { name: "Kinematics", line: "Chapter 2" },
  { name: "Dynamics", line: "Chapter 3" },
  { name: "Turning effect of forces", line: "Chapter 4" },
  { name: "Gravitation", line: "Chapter 5" },
  { name: "Work, energy and power", line: "Chapter 6" },
  { name: "Fluid dynamics", line: "Chapter 7" },
  { name: "Oscillations", line: "Chapter 8" },
];

/** In "coming back" mode: what this pretend student has already done. */
const DONE: Record<string, number> = { biology: 2, maths: 1 };

type Step =
  | { k: "ask" }
  | { k: "map"; subject: Subject }
  | { k: "syllabus" }
  | { k: "taste" };

function useNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 680px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}

export default function FirstRunLab() {
  const [returning, setReturning] = useState(false);
  const [step, setStep] = useState<Step>({ k: "ask" });
  const [sound, setSound] = useState(false);
  const [name, setName] = useState("");
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const n = d?.profile?.displayName ?? d?.user?.username ?? "";
        setName(String(n).split(" ")[0]);
      })
      .catch(() => {});
  }, []);

  const done = returning ? DONE : {};

  return (
    <main className="hud-canvas relative min-h-screen overflow-x-clip">
      <div aria-hidden="true" className="welcome-glow pointer-events-none absolute inset-x-0 top-0 h-[700px] opacity-70" />

      {/* Lab chrome: which visit this is, and whether Dot speaks aloud. */}
      <header className="relative z-20 mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <span className="rounded-full border border-dashed border-[var(--hud-line-strong)] px-3 py-1 text-[0.75rem] text-[var(--hud-text-faint)]">
          Demo · after sign-in
        </span>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Which visit" className="flex rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] p-1 text-[0.82rem]">
            {[["First visit", false], ["Coming back", true]].map(([label, v]) => (
              <button
                key={label as string}
                role="radio"
                aria-checked={returning === v}
                onClick={() => { setReturning(v as boolean); setStep({ k: "ask" }); }}
                className={`rounded-full px-3 py-1.5 transition-colors ${returning === v ? "bg-[var(--accent)] text-[var(--accent-on)]" : "text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"}`}
              >
                {label as string}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSound((s) => !s)}
            aria-pressed={sound}
            aria-label={sound ? "Mute Aria" : "Let Aria speak"}
            className="grid size-9 place-items-center rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"
          >
            {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </button>
        </div>
      </header>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-24 sm:px-6">
        {step.k === "ask" && returning && (
          <ComingBack name={name} sound={sound} onStart={setStarting} onElse={() => setReturning(false)} onMap={(s) => setStep({ k: "map", subject: s })} />
        )}
        {step.k === "ask" && !returning && (
          <AskSubject
            name={name}
            sound={sound}
            onSubject={(s) => setStep({ k: "map", subject: s })}
            onTopic={setStarting}
            onSyllabus={() => setStep({ k: "syllabus" })}
            onTaste={() => setStep({ k: "taste" })}
          />
        )}
        {step.k === "map" && (
          <StarMap subject={step.subject} done={done[step.subject.id] ?? 0} sound={sound} onBack={() => setStep({ k: "ask" })} onStart={setStarting} />
        )}
        {step.k === "syllabus" && (
          <SyllabusScan
            sound={sound}
            onBack={() => setStep({ k: "ask" })}
            onBuilt={(topics) => setStep({ k: "map", subject: { id: "mine", name: "Your syllabus", icon: BookOpen, color: "var(--accent)", topics } })}
          />
        )}
        {step.k === "taste" && <Taste sound={sound} onBack={() => setStep({ k: "ask" })} onStart={setStarting} />}
      </div>

      {starting && <StartSheet topic={starting} onClose={() => setStarting(null)} />}
    </main>
  );
}

/* ─────────────────────────────── Dot, saying something ─────────────────────────────── */

type DotSaysProps = { text: string; size?: number; sound: boolean; row?: boolean };

/** Keyed by the line, so a new line starts typing from the first letter. */
function DotSays(props: DotSaysProps) {
  return <DotSaysLine key={props.text} {...props} />;
}

function DotSaysLine({ text, size = 150, sound, row = false }: DotSaysProps) {
  const [typed, setTyped] = useState(0);
  const mouth = useRef<DotMouthInput>(null);

  useEffect(() => {
    let i = 0;
    const timer = window.setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= text.length) window.clearInterval(timer);
    }, 34);
    return () => window.clearInterval(timer);
  }, [text]);

  useEffect(() => {
    if (!sound || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.03;
    u.pitch = 1.15;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return () => window.speechSynthesis.cancel();
  }, [text, sound]);

  const talking = typed < text.length;
  useEffect(() => {
    mouth.current = talking && typed > 0 ? letterMouth(text, typed - 1) : null;
  }, [typed, talking, text]);

  return (
    <div className={`flex items-center gap-4 ${row ? "flex-row" : "flex-col"}`}>
      <div style={{ width: size, height: size }} className="shrink-0" aria-hidden="true">
        <DotAvatar state={talking ? "speaking" : "idle"} mouth={mouth} className="h-full w-full drop-shadow-[0_10px_28px_rgba(110,80,230,0.4)]" />
      </div>
      <p
        className={`max-w-md rounded-[16px] border border-[var(--hud-line)] bg-[var(--hud-surface)] px-4 py-3 text-[1.05rem] font-medium leading-snug text-[var(--hud-text)] shadow-[var(--elev-1)] sm:text-[1.15rem] ${row ? "text-left" : "text-center"}`}
        aria-live="polite"
      >
        <span className="sr-only">{text}</span>
        <span aria-hidden="true">
          {text.slice(0, typed)}
          <span className="invisible">{text.slice(typed)}</span>
        </span>
      </p>
    </div>
  );
}

/* ─────────────────────────────── 1. Dot asks; subjects orbit ─────────────────────────────── */

type SpeechRec = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void };

function AskSubject({
  name, sound, onSubject, onTopic, onSyllabus, onTaste,
}: { name: string; sound: boolean; onSubject: (s: Subject) => void; onTopic: (t: string) => void; onSyllabus: () => void; onTaste: () => void }) {
  const narrow = useNarrow();
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const recRef = useRef<SpeechRec | null>(null);
  const greeting = `Hi${name ? ` ${name}` : ""}! What are you studying these days?`;

  function listen() {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { setHeard("Voice isn't available in this browser — tap a subject instead."); return; }
    if (listening) { recRef.current?.stop(); return; }
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[0]?.[0]?.transcript ?? "";
      setHeard(`“${said}”`);
      const low = said.toLowerCase();
      const alias: Record<string, string[]> = { maths: ["math", "maths", "mathematics"], cs: ["computer", "coding", "programming"], biology: ["bio", "biology"] };
      const hit = SUBJECTS.find((s) => low.includes(s.name.toLowerCase()) || (alias[s.id] ?? []).some((a) => low.includes(a)));
      if (hit) window.setTimeout(() => onSubject(hit), 500);
      else if (said.trim()) window.setTimeout(() => onTopic(said.trim()), 500);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    setHeard("");
    setListening(true);
    rec.start();
  }

  // Around her on a wide screen (an ellipse); a tidy wrap under her on a phone.
  const orbit = useMemo(
    () => SUBJECTS.map((s, i) => {
      const a = (i / SUBJECTS.length) * Math.PI * 2 - Math.PI / 2;
      return { s, left: 50 + Math.cos(a) * 40, top: 50 + Math.sin(a) * 40, delay: (i * 0.53) % 4 };
    }),
    [],
  );

  const bubble = (s: Subject) => {
    const Icon = s.icon;
    return (
      <>
        <span className="grid size-8 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${s.color} 20%, transparent)` }}>
          <Icon size={16} strokeWidth={2} style={{ color: s.color }} />
        </span>
        {s.name}
      </>
    );
  };
  const bubbleCls =
    "inline-flex items-center gap-2 rounded-full border border-[var(--hud-line-strong)] bg-[var(--hud-surface)] py-1.5 pl-1.5 pr-4 text-[0.92rem] font-medium text-[var(--hud-text)] shadow-[var(--elev-1)] transition-[border-color,box-shadow] hover:border-[var(--accent)] hover:shadow-[var(--elev-2)]";

  return (
    <section className="fr-in flex flex-col items-center">
      {narrow ? (
        <>
          <div className="mt-4"><DotSays text={greeting} size={130} sound={sound} /></div>
          <div className="mt-7 flex flex-wrap justify-center gap-2.5">
            {SUBJECTS.map((s) => (
              <button key={s.id} type="button" onClick={() => onSubject(s)} className={bubbleCls}>{bubble(s)}</button>
            ))}
          </div>
        </>
      ) : (
        <div className="relative mx-auto mt-2 h-[560px] w-full max-w-[900px]">
          <div className="absolute left-1/2 top-1/2 w-[340px] -translate-x-1/2 -translate-y-1/2">
            <DotSays text={greeting} size={160} sound={sound} />
          </div>
          {orbit.map(({ s, left, top, delay }) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onSubject(s)}
              className={`fr-bob absolute ${bubbleCls}`}
              style={{ left: `${left}%`, top: `${top}%`, transform: "translate(-50%, -50%)", animationDelay: `-${delay}s` }}
            >
              {bubble(s)}
            </button>
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-col items-center gap-3">
        <button
          type="button"
          onClick={listen}
          aria-pressed={listening}
          className={`inline-flex h-12 items-center gap-2 rounded-full px-6 text-[0.95rem] font-semibold transition-colors ${listening ? "bg-[var(--danger)] text-white" : "hud-btn-primary"}`}
          style={{ borderRadius: 999 }}
        >
          <Mic size={17} /> {listening ? "Listening… tap to stop" : "Or just say it"}
        </button>
        {heard && <p className="text-[0.88rem] text-[var(--hud-text-dim)]">{heard}</p>}
      </div>

      <div className="mt-8 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        <button type="button" onClick={onSyllabus} className="flex items-center gap-3 rounded-[14px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-4 text-left transition-colors hover:border-[var(--accent)]">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)]"><Camera size={18} className="text-[var(--accent-ink)]" /></span>
          <span>
            <span className="block text-[0.95rem] font-semibold text-[var(--hud-text)]">Show me your syllabus</span>
            <span className="block text-[0.82rem] text-[var(--hud-text-dim)]">A photo of your book&rsquo;s contents page</span>
          </span>
        </button>
        <button type="button" onClick={onTaste} className="flex items-center gap-3 rounded-[14px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-4 text-left transition-colors hover:border-[var(--accent)]">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--accent-soft)]"><Lightbulb size={18} className="text-[var(--accent-ink)]" /></span>
          <span>
            <span className="block text-[0.95rem] font-semibold text-[var(--hud-text)]">Not sure? Try something fun</span>
            <span className="block text-[0.82rem] text-[var(--hud-text-dim)]">One-minute lessons on big questions</span>
          </span>
        </button>
      </div>
    </section>
  );
}

/* ─────────────────────────────── 2 + 6. The star map, and the exam plan ─────────────────────────────── */

function StarMap({ subject, done, sound, onBack, onStart }: { subject: Subject; done: number; sound: boolean; onBack: () => void; onStart: (t: string) => void }) {
  const narrow = useNarrow();
  const n = subject.topics.length;
  const next = Math.min(done, n - 1);
  const [picked, setPicked] = useState(next);
  const [exam, setExam] = useState("");

  const W = narrow ? 360 : 1000;
  const H = narrow ? 110 * n + 40 : 400;
  const pts = subject.topics.map((_, i) =>
    narrow
      ? { x: W / 2 + Math.sin(i * 1.25) * 95, y: 60 + i * 110 }
      : { x: 80 + (i * (W - 160)) / Math.max(1, n - 1), y: H / 2 + Math.sin(i * 1.25) * 95 },
  );

  const say = done > 0
    ? `You've done ${done} of ${n}. Next up: ${subject.topics[next].name}.`
    : `Start with ${subject.topics[0].name} — everything else builds on it.`;

  const plan = useMemo(() => {
    if (!exam) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(`${exam}T00:00:00`);
    const days = Math.round((end.getTime() - today.getTime()) / 86_400_000);
    if (!(days > 0)) return { days, rows: [] as Array<{ date: string; topics: string[] }> };
    const left = subject.topics.slice(done).map((t) => t.name);
    // Leave the last day for revision when there is room.
    const study = Math.max(1, Math.min(days - (days > left.length ? 1 : 0), left.length));
    const per = Math.ceil(left.length / study);
    const rows: Array<{ date: string; topics: string[] }> = [];
    for (let d = 0; d < study; d++) {
      const chunk = left.slice(d * per, d * per + per);
      if (!chunk.length) break;
      const day = new Date(today);
      day.setDate(today.getDate() + d);
      rows.push({ date: day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), topics: chunk });
    }
    if (days > rows.length) {
      const rev = new Date(end);
      rev.setDate(end.getDate() - 1);
      rows.push({ date: rev.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }), topics: ["Recap quiz on everything"] });
    }
    return { days, rows };
  }, [exam, subject, done]);

  const t = subject.topics[picked];
  const state = (i: number) => (i < done ? "done" : i === next ? "next" : "later");

  return (
    <section className="fr-in">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[0.88rem] text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]">
        <ArrowLeft size={15} /> Subjects
      </button>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-[2rem] font-semibold tracking-[-0.01em] text-[var(--hud-text)] sm:text-[2.6rem]">{subject.name}</h1>
        <DotSays key={say} text={say} size={64} sound={sound} row />
      </div>

      <div className="mt-6 overflow-hidden rounded-[18px] border border-[var(--hud-line)] bg-[color-mix(in_srgb,var(--hud-surface)_70%,transparent)]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label={`${subject.name} topics`}>
          {Array.from({ length: 46 }, (_, k) => (
            <circle key={`bg${k}`} cx={(k * 211) % W} cy={(k * 137 + 29) % H} r={k % 5 === 0 ? 1.6 : 0.9} fill="var(--hud-text-faint)" opacity={0.35} />
          ))}
          {pts.slice(1).map((p, i) => (
            <line
              key={i}
              className="fr-line"
              pathLength={1}
              style={{ animationDelay: `${i * 0.12}s` }}
              x1={pts[i].x} y1={pts[i].y} x2={p.x} y2={p.y}
              stroke={i + 1 <= done ? subject.color : "var(--hud-line-strong)"}
              strokeWidth={i + 1 <= done ? 3 : 2}
            />
          ))}
          {pts.map((p, i) => {
            const s = state(i);
            const sel = i === picked;
            return (
              <g
                key={i}
                role="button"
                tabIndex={0}
                aria-label={`${subject.topics[i].name}${s === "done" ? ", done" : s === "next" ? ", start here" : ""}`}
                onClick={() => setPicked(i)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicked(i); } }}
                className="cursor-pointer outline-none"
                style={{ opacity: 0, animation: `welcome-pop 0.4s var(--ease) ${0.1 + i * 0.1}s forwards` }}
              >
                {s === "next" && <circle className="fr-pulse" cx={p.x} cy={p.y} r={18} fill={subject.color} />}
                {sel && <circle cx={p.x} cy={p.y} r={27} fill="none" stroke="var(--hud-text)" strokeWidth={1.5} strokeDasharray="3 4" />}
                <circle
                  cx={p.x} cy={p.y} r={s === "later" ? 13 : 18}
                  fill={s === "later" ? "var(--hud-surface)" : subject.color}
                  stroke={s === "later" ? "var(--hud-line-strong)" : subject.color}
                  strokeWidth={2}
                />
                {s === "done" && <path d={`M${p.x - 7} ${p.y} l5 5 l9 -10`} stroke="var(--hud-bg)" strokeWidth={3} fill="none" strokeLinecap="round" strokeLinejoin="round" />}
                {s === "next" && <circle cx={p.x} cy={p.y} r={6} fill="var(--hud-bg)" />}
                <text
                  x={narrow ? p.x + (p.x > W / 2 ? -30 : 30) : p.x}
                  y={narrow ? p.y + 5 : p.y + (p.y < H / 2 ? -32 : 42)}
                  textAnchor={narrow ? (p.x > W / 2 ? "end" : "start") : "middle"}
                  fill={s === "later" ? "var(--hud-text-dim)" : "var(--hud-text)"}
                  style={{ font: `${sel ? 600 : 500} 15px var(--font-body)` }}
                >
                  {subject.topics[i].name}
                </text>
                {s === "next" && !narrow && (
                  <text x={p.x} y={p.y + (p.y < H / 2 ? 44 : -30)} textAnchor="middle" fill={subject.color} style={{ font: "600 12px var(--font-body)", letterSpacing: "0.04em" }}>
                    START HERE
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        {/* The picked star. */}
        <div key={picked} className="fr-in flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5">
          <div>
            <p className="text-[0.78rem] font-medium uppercase tracking-[0.06em]" style={{ color: subject.color }}>
              {state(picked) === "done" ? "Done" : state(picked) === "next" ? "Start here" : `Topic ${picked + 1} of ${n}`}
            </p>
            <h2 className="mt-1 text-[1.3rem] font-semibold text-[var(--hud-text)]">{t.name}</h2>
            <p className="mt-0.5 text-[0.92rem] text-[var(--hud-text-dim)]">{t.line}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {state(picked) === "done" ? (
              <>
                <button type="button" onClick={() => onStart(`Quick recap quiz on ${t.name}`)} className="hud-btn-primary inline-flex h-11 items-center gap-2 px-5 text-[0.92rem] font-semibold" style={{ borderRadius: 999 }}>
                  <RotateCcw size={15} /> 2-minute recap
                </button>
                <button type="button" onClick={() => onStart(t.name)} className="h-11 rounded-full border border-[var(--hud-line-strong)] px-5 text-[0.92rem] text-[var(--hud-text)] hover:bg-[var(--hud-surface-2)]">Learn again</button>
              </>
            ) : (
              <button type="button" onClick={() => onStart(subject.id === "mine" ? t.name : `${t.name} (${subject.name})`)} className="hud-btn-primary inline-flex h-11 items-center gap-2 px-5 text-[0.92rem] font-semibold" style={{ borderRadius: 999 }}>
                Start lesson <ArrowRight size={15} />
              </button>
            )}
          </div>
        </div>

        {/* 6. Exam coming up? */}
        <div className="rounded-[16px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5">
          <label htmlFor="exam" className="flex items-center gap-2 text-[0.95rem] font-semibold text-[var(--hud-text)]">
            <CalendarDays size={17} className="text-[var(--accent-ink)]" /> Exam coming up?
          </label>
          <input
            id="exam"
            type="date"
            value={exam}
            onChange={(e) => setExam(e.target.value)}
            className="mt-3 h-10 w-full rounded-[var(--radius)] border border-[var(--input-border)] bg-[var(--hud-bg)] px-3 text-[0.92rem] text-[var(--hud-text)]"
          />
          {plan && plan.days <= 0 && <p className="mt-3 text-[0.85rem] text-[var(--hud-text-dim)]">Pick a day after today.</p>}
          {plan && plan.days > 0 && (
            <>
              <p className="mt-3 text-[0.85rem] text-[var(--hud-text-dim)]">{plan.days} days to go. Here&rsquo;s your plan:</p>
              <ol className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                {plan.rows.map((r) => (
                  <li key={r.date + r.topics[0]} className="flex gap-3 text-[0.86rem]">
                    <span className="w-24 shrink-0 text-[var(--hud-text-faint)]">{r.date}</span>
                    <span className="text-[var(--hud-text)]">{r.topics.join(", ")}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────── 3. The syllabus photo ─────────────────────────────── */

function SyllabusScan({ sound, onBack, onBuilt }: { sound: boolean; onBack: () => void; onBuilt: (t: Topic[]) => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [phase, setPhase] = useState<"pick" | "scan" | "found">("pick");
  const [shown, setShown] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  function begin(url: string | null) {
    setImg(url);
    setPhase("scan");
    window.setTimeout(() => setPhase("found"), 2600);
  }
  useEffect(() => {
    if (phase !== "found") return;
    const timer = window.setInterval(() => setShown((s) => (s >= SAMPLE_CHAPTERS.length ? s : s + 1)), 160);
    return () => window.clearInterval(timer);
  }, [phase]);
  useEffect(() => () => { if (img?.startsWith("blob:")) URL.revokeObjectURL(img); }, [img]);

  const say = phase === "pick" ? "Show me the contents page of your book, and I'll turn it into your own map."
    : phase === "scan" ? "Reading your page…"
    : `I found ${SAMPLE_CHAPTERS.length} chapters. Shall I make them your map?`;

  return (
    <section className="fr-in">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[0.88rem] text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]">
        <ArrowLeft size={15} /> Back
      </button>
      <div className="mt-4 flex justify-center"><DotSays key={say} text={say} size={110} sound={sound} /></div>

      <div className="mx-auto mt-8 grid max-w-3xl gap-5 sm:grid-cols-2">
        <div className="relative grid aspect-[3/4] place-items-center overflow-hidden rounded-[16px] border border-dashed border-[var(--hud-line-strong)] bg-[var(--hud-surface)]">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt="Your contents page" className="h-full w-full object-cover" />
          ) : phase === "pick" ? (
            <div className="flex flex-col items-center gap-3 p-6 text-center">
              <Camera size={30} className="text-[var(--accent-ink)]" />
              <button type="button" onClick={() => fileRef.current?.click()} className="hud-btn-primary h-11 px-5 text-[0.92rem] font-semibold" style={{ borderRadius: 999 }}>
                Take or choose a photo
              </button>
              <button type="button" onClick={() => begin(null)} className="text-[0.85rem] text-[var(--hud-text-dim)] underline underline-offset-4 hover:text-[var(--hud-text)]">
                Use a sample page
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) begin(URL.createObjectURL(f)); }}
              />
            </div>
          ) : (
            <SamplePage />
          )}
          {phase === "scan" && <span className="fr-scan absolute inset-x-0 h-[3px] bg-[var(--accent)] shadow-[0_0_18px_4px_var(--hud-cyan-glow)]" />}
        </div>

        <div className="flex flex-col">
          <p className="text-[0.78rem] font-medium uppercase tracking-[0.06em] text-[var(--hud-text-faint)]">
            {phase === "found" ? "Chapters found (demo: sample list)" : "Chapters"}
          </p>
          <ol className="mt-2 flex-1 space-y-1.5">
            {SAMPLE_CHAPTERS.slice(0, phase === "found" ? shown : 0).map((c, i) => (
              <li key={c.name} className="fr-in flex items-center gap-3 rounded-[10px] border border-[var(--hud-line)] bg-[var(--hud-surface)] px-3 py-2 text-[0.9rem] text-[var(--hud-text)]">
                <span className="grid size-6 place-items-center rounded-full bg-[var(--accent-soft)] text-[0.75rem] font-semibold text-[var(--accent-ink)]">{i + 1}</span>
                {c.name}
              </li>
            ))}
            {phase !== "found" && <li className="text-[0.88rem] text-[var(--hud-text-faint)]">{phase === "scan" ? "Reading…" : "Waiting for a photo."}</li>}
          </ol>
          {phase === "found" && shown >= SAMPLE_CHAPTERS.length && (
            <button type="button" onClick={() => onBuilt(SAMPLE_CHAPTERS)} className="hud-btn-primary fr-in mt-4 inline-flex h-12 items-center justify-center gap-2 text-[0.95rem] font-semibold" style={{ borderRadius: 999 }}>
              <Check size={16} /> Make it my map
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** A drawn stand-in for a textbook contents page. */
function SamplePage() {
  return (
    <div className="h-full w-full bg-[#F7F3EA] p-6 text-left text-[#2a241b]">
      <p className="text-[0.95rem] font-bold tracking-wide">CONTENTS</p>
      <ol className="mt-4 space-y-2.5 text-[0.8rem]">
        {SAMPLE_CHAPTERS.map((c, i) => (
          <li key={c.name} className="flex justify-between gap-2 border-b border-dotted border-[#b9ae98] pb-1">
            <span>{i + 1}. {c.name}</span>
            <span>{1 + i * 14}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ─────────────────────────────── 4. Curiosity cards ─────────────────────────────── */

function Taste({ sound, onBack, onStart }: { sound: boolean; onBack: () => void; onStart: (t: string) => void }) {
  return (
    <section className="fr-in">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-[0.88rem] text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]">
        <ArrowLeft size={15} /> Back
      </button>
      <div className="mt-4 flex justify-center"><DotSays text="Pick one that makes you curious. I'll explain it in a minute." size={110} sound={sound} /></div>
      <ul className="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CURIOUS.map((c, i) => {
          const s = SUBJECTS.find((x) => x.id === c.subject)!;
          const Icon = s.icon;
          return (
            <li key={c.q} className="fr-in" style={{ animationDelay: `${i * 70}ms` }}>
              <button
                type="button"
                onClick={() => onStart(`${c.q} (a one-minute lesson)`)}
                className="group flex h-full w-full flex-col justify-between gap-6 rounded-[16px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5 text-left transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[var(--accent)]"
              >
                <span className="text-[1.15rem] font-semibold leading-snug text-[var(--hud-text)]">{c.q}</span>
                <span className="flex items-center justify-between text-[0.8rem] text-[var(--hud-text-dim)]">
                  <span className="inline-flex items-center gap-1.5"><Icon size={14} style={{ color: s.color }} /> {s.name} · 1 min</span>
                  <ArrowRight size={15} className="transition-transform group-hover:translate-x-0.5" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ─────────────────────────────── 5. Coming back ─────────────────────────────── */

function ComingBack({ name, sound, onStart, onElse, onMap }: { name: string; sound: boolean; onStart: (t: string) => void; onElse: () => void; onMap: (s: Subject) => void }) {
  const bio = SUBJECTS.find((s) => s.id === "biology")!;
  const last = bio.topics[1];
  const next = bio.topics[2];
  return (
    <section className="fr-in flex flex-col items-center">
      <div className="mt-8"><DotSays text={`Welcome back${name ? `, ${name}` : ""}! Last time we did ${last.name}.`} size={150} sound={sound} /></div>
      <div className="mt-9 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => onStart(`Quick recap quiz on ${last.name}`)} className="flex flex-col gap-2 rounded-[16px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5 text-left transition-colors hover:border-[var(--accent)]">
          <RotateCcw size={20} className="text-[var(--accent-ink)]" />
          <span className="text-[1.1rem] font-semibold text-[var(--hud-text)]">2-minute recap quiz</span>
          <span className="text-[0.86rem] text-[var(--hud-text-dim)]">Check what stuck from {last.name}.</span>
        </button>
        <button type="button" onClick={() => onStart(`${next.name} (Biology)`)} className="welcome-cta flex flex-col gap-2 rounded-[16px] border border-[var(--accent)] p-5 text-left">
          <ArrowRight size={20} className="text-[var(--accent-ink)]" />
          <span className="text-[1.1rem] font-semibold text-[var(--hud-text)]">Next: {next.name}</span>
          <span className="text-[0.86rem] text-[var(--hud-text-dim)]">{next.line}</span>
        </button>
      </div>
      {/* Where they are, at a glance: the subject's stars, two lit. */}
      <button type="button" onClick={() => onMap(bio)} className="mt-6 flex items-center gap-2 rounded-full px-3 py-2 hover:bg-[var(--hud-surface-2)]" aria-label={`Biology: 2 of ${bio.topics.length} done. Open the map`}>
        {bio.topics.map((t, i) => (
          <span key={t.name} title={t.name} className="size-3 rounded-full" style={{ background: i < 2 ? bio.color : "transparent", border: `2px solid ${i < 2 ? bio.color : "var(--hud-line-strong)"}`, boxShadow: i === 2 ? `0 0 0 4px color-mix(in srgb, ${bio.color} 25%, transparent)` : undefined }} />
        ))}
        <span className="ml-2 text-[0.82rem] text-[var(--hud-text-dim)]">Biology · 2 of {bio.topics.length} · see map</span>
      </button>
      <button type="button" onClick={onElse} className="mt-6 text-[0.88rem] text-[var(--hud-text-dim)] underline underline-offset-4 hover:text-[var(--hud-text)]">
        Something else
      </button>
    </section>
  );
}

/* ─────────────────────────────── Starting for real ─────────────────────────────── */

function StartSheet({ topic, onClose }: { topic: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button type="button" aria-label="Close" onClick={onClose} className="fixed inset-0 bg-[var(--scrim)] backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-label="Start this lesson" className="welcome-dialog relative w-full max-w-sm rounded-[18px] border border-[var(--hud-line)] bg-[var(--hud-bg)] p-6 shadow-[var(--elev-2)]">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]">
          <X size={16} />
        </button>
        <p className="text-[0.78rem] font-medium uppercase tracking-[0.06em] text-[var(--hud-text-faint)]">Here the lesson would start</p>
        <h2 className="mt-2 text-[1.3rem] font-semibold text-[var(--hud-text)]">{topic}</h2>
        <p className="mt-2 text-[0.88rem] text-[var(--hud-text-dim)]">
          In the demo, this opens the real app and starts the lesson (a real lesson, about 2¢).
        </p>
        <button
          type="button"
          onClick={() => { savePendingTopic(topic); window.location.href = "/"; }}
          className="hud-btn-primary mt-5 inline-flex h-11 w-full items-center justify-center gap-2 text-[0.95rem] font-semibold"
          style={{ borderRadius: 999 }}
        >
          Start it for real <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}
