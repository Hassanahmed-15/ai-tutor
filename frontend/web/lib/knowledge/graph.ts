import { conceptKey } from "../learnerModel";

/**
 * THE KNOWLEDGE GRAPH — pure logic, unit-tested in lib/anim/knowledgeGraph.test.ts.
 *
 * Two layers, as intelligent tutors have them (a curriculum graph and a learner model):
 *
 *   1. ONE SHARED CONCEPT GRAPH, grown from the lectures students make. Every lecture's concepts
 *      and the links between them are extracted once (lib/knowledge/extract.ts) and merged in. It
 *      holds concepts only — never anything about a student.
 *   2. EACH STUDENT'S OVERLAY: the existing learner memory (lib/learnerModel.ts), whose concepts
 *      now share the graph's keys, with mastery, a review schedule and where each was taught.
 *
 * WHY LINKS ARE ONLY EVER SOFT. LLMs find concepts reliably but prerequisite links far less so —
 * the best recent system scored ~0.5-0.6 on relation triples (InstructKG, 2026). So a link earns
 * confidence as more lectures independently assert it (`edgeConfidence`), and nothing here ever
 * BLOCKS a student on a link: links suggest a refresher, a question, a review — never a gate.
 */

export type EdgeType = "needs" | "part-of" | "related";
export const EDGE_TYPES: EdgeType[] = ["needs", "part-of", "related"];

export type KnowledgeConcept = {
  id: string;
  kind: "concept";
  label: string;
  aliases: string[];
  subject: string;
  /** One line: what it is. */
  summary: string;
  /** How many lectures have taught it. */
  lectures: number;
  updatedAt: string;
};

export type KnowledgeEdge = {
  id: string;
  kind: "edge";
  from: string;
  to: string;
  type: EdgeType;
  /** Lectures that asserted this link, most recent last (capped). Support = how many ever did. */
  sources: string[];
  support: number;
  updatedAt: string;
};

/** What one lecture contributes: its concepts, its links, and which concepts each board teaches. */
export type LectureKnowledge = {
  concepts: Array<{ key: string; label: string; aliases: string[]; subject: string; summary: string }>;
  edges: Array<{ from: string; to: string; type: EdgeType }>;
  /** Per board: the concepts it teaches, and which drawn element (by id) stands for which concept. */
  beats: Array<{ sequence: number; concepts: string[]; elements: Record<string, string> }>;
};

/* ── keys ─────────────────────────────────────────────────────────────────────────────────── */

/** Formulas and abbreviations students meet under two names: one key for both. */
const SYNONYMS: Record<string, string> = {
  co2: "carbon dioxide",
  "co 2": "carbon dioxide",
  h2o: "water",
  "h 2 o": "water",
  o2: "oxygen",
  "oxygen gas": "oxygen",
  c6h12o6: "glucose",
  atp: "atp",
  dna: "dna",
  "deoxyribonucleic acid": "dna",
  rna: "rna",
  "sun light": "sunlight",
  "light energy": "light energy",
};

/**
 * The concept's key: the learner model's key (lower case, singular, punctuation gone) with known
 * synonyms folded, so "CO₂", "co2" and "Carbon Dioxide" are one concept.
 */
export function canonicalKey(label: string): string {
  const plain = String(label ?? "")
    .normalize("NFKD")
    .replace(/[₀-₉]/g, (d) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(d)))
    .replace(/[̀-ͯ]/g, "");
  const key = conceptKey(plain);
  return SYNONYMS[key] ?? SYNONYMS[key.replace(/\s+/g, "")] ?? key;
}

export function edgeId(from: string, type: EdgeType, to: string): string {
  return `${from}|${type}|${to}`.slice(0, 250);
}

/* ── one lecture's extraction, cleaned ────────────────────────────────────────────────────── */

const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * The model's extraction, made safe: keys canonical, concepts deduplicated, links only between
 * concepts of this lecture and never to themselves, a link that would close a "needs" cycle within
 * the lecture dropped, and each board's element map pointing at real concepts.
 */
export function validateLectureKnowledge(raw: unknown, beatCount: number): LectureKnowledge | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const concepts = new Map<string, LectureKnowledge["concepts"][number]>();
  for (const item of Array.isArray(r.concepts) ? r.concepts.slice(0, 40) : []) {
    const c = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const label = str(c.label ?? c.name, 60);
    const key = canonicalKey(str(c.key, 60) || label);
    if (!key || key.length < 2 || !label) continue;
    const aliases = [...new Set((Array.isArray(c.aliases) ? c.aliases : []).map((a) => canonicalKey(str(a, 60))).filter((a) => a && a !== key))].slice(0, 6);
    const existing = concepts.get(key);
    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...aliases])].slice(0, 8);
      continue;
    }
    concepts.set(key, { key, label, aliases, subject: str(c.subject, 40).toLowerCase() || "general", summary: str(c.summary, 160) });
  }
  if (concepts.size === 0) return null;
  // An alias of one concept that is itself another concept's key points at that concept.
  const resolve = (k: string) => {
    const key = canonicalKey(k);
    if (concepts.has(key)) return key;
    for (const c of concepts.values()) if (c.aliases.includes(key)) return c.key;
    return "";
  };

  const edges: LectureKnowledge["edges"] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(r.edges) ? r.edges.slice(0, 80) : []) {
    const e = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    let from = resolve(str(e.from, 60));
    let to = resolve(str(e.to, 60));
    const type = (EDGE_TYPES as string[]).includes(String(e.type)) ? (e.type as EdgeType) : null;
    if (!from || !to || from === to || !type) continue;
    // "related" has no direction: one order for it, so A~B and B~A are one link.
    if (type === "related" && from > to) [from, to] = [to, from];
    const id = edgeId(from, type, to);
    if (seen.has(id)) continue;
    if (type === "needs" && reaches(edges, to, from)) continue;
    seen.add(id);
    edges.push({ from, to, type });
  }

  const beats: LectureKnowledge["beats"] = [];
  for (const item of Array.isArray(r.beats) ? r.beats : []) {
    const b = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const sequence = Math.floor(Number(b.sequence));
    if (!Number.isInteger(sequence) || sequence < 0 || sequence >= beatCount || beats.some((x) => x.sequence === sequence)) continue;
    const keys = [...new Set((Array.isArray(b.concepts) ? b.concepts : []).map((k) => resolve(str(k, 60))).filter(Boolean))].slice(0, 6);
    const elements: Record<string, string> = {};
    const rawElements = b.elements && typeof b.elements === "object" ? (b.elements as Record<string, unknown>) : {};
    for (const [element, concept] of Object.entries(rawElements).slice(0, 12)) {
      const key = resolve(str(concept, 60));
      if (key && /^[a-z0-9-]{1,60}$/.test(element)) elements[element] = key;
    }
    beats.push({ sequence, concepts: keys, elements });
  }
  beats.sort((a, b) => a.sequence - b.sequence);
  return { concepts: [...concepts.values()], edges, beats };
}

/** Whether `to` can already be reached from `from` along "needs" links — adding the reverse would loop. */
function reaches(edges: LectureKnowledge["edges"], from: string, to: string): boolean {
  const stack = [from];
  const seen = new Set<string>();
  while (stack.length) {
    const at = stack.pop()!;
    if (at === to) return true;
    if (seen.has(at)) continue;
    seen.add(at);
    for (const e of edges) if (e.type === "needs" && e.from === at) stack.push(e.to);
  }
  return false;
}

/* ── merging into the shared graph ────────────────────────────────────────────────────────── */

/** A concept as the graph will hold it after this lecture. Counting a lecture twice is a no-op upstream. */
export function mergeConcept(existing: KnowledgeConcept | null, incoming: LectureKnowledge["concepts"][number], now: string): KnowledgeConcept {
  if (!existing) {
    return { id: incoming.key, kind: "concept", label: incoming.label, aliases: incoming.aliases, subject: incoming.subject, summary: incoming.summary, lectures: 1, updatedAt: now };
  }
  return {
    ...existing,
    aliases: [...new Set([...existing.aliases, ...incoming.aliases])].filter((a) => a !== existing.id).slice(0, 12),
    summary: existing.summary || incoming.summary,
    subject: existing.subject === "general" ? incoming.subject : existing.subject,
    lectures: existing.lectures + 1,
    updatedAt: now,
  };
}

/** A link as the graph will hold it once `lectureId` has asserted it (once per lecture). */
export function mergeEdge(existing: KnowledgeEdge | null, incoming: { from: string; to: string; type: EdgeType }, lectureId: string, now: string): KnowledgeEdge {
  if (existing?.sources.includes(lectureId)) return existing;
  return {
    id: edgeId(incoming.from, incoming.type, incoming.to),
    kind: "edge",
    from: incoming.from,
    to: incoming.to,
    type: incoming.type,
    sources: [...(existing?.sources ?? []), lectureId].slice(-10),
    support: (existing?.support ?? 0) + 1,
    updatedAt: now,
  };
}

/** How much to trust a link: one lecture saying so is a hint; several agreeing is knowledge. */
export function edgeConfidence(support: number): number {
  return Math.round((1 - Math.pow(0.6, Math.max(0, support))) * 100) / 100;
}

/* ── mastery: knowledge tracing ───────────────────────────────────────────────────────────── */

/**
 * BAYESIAN KNOWLEDGE TRACING, one observation. A correct answer raises the chance the student knows
 * it — less if a guess was likely; a wrong one lowers it — less if a slip was likely. Then the
 * chance they learned it from this very attempt (the feedback they just got) is added.
 */
export function bktUpdate(p: number, correct: boolean, params: { guess: number; slip?: number; learn?: number }): number {
  const slip = params.slip ?? 0.1;
  const learn = params.learn ?? 0.15;
  const guess = params.guess;
  const known = Math.max(0.01, Math.min(0.99, p));
  const posterior = correct
    ? (known * (1 - slip)) / (known * (1 - slip) + (1 - known) * guess)
    : (known * slip) / (known * slip + (1 - known) * (1 - guess));
  return Math.round(Math.max(0, Math.min(1, posterior + (1 - posterior) * learn)) * 1000) / 1000;
}

/**
 * FRACTIONAL IMPLICIT REPETITION (Math Academy's FIRe, simplified). Answering a question about a
 * concept correctly also exercises what it builds on, so each prerequisite gets a share of the
 * credit, scaled by how much the link is trusted. Never a penalty: a wrong answer says little about
 * which prerequisite failed.
 */
export function implicitCredit(p: number, confidence: number, share = 0.3): number {
  return Math.round(Math.min(1, p + (1 - p) * share * confidence) * 1000) / 1000;
}

/* ── review schedule ──────────────────────────────────────────────────────────────────────── */

/**
 * WHEN TO REVIEW, in the shape of FSRS: a memory has a STABILITY S (days) and the chance of recall
 * after t days is R(t) = (1 + 19/81 · t/S)^-0.5, which is 0.9 exactly when t = S. So the review is
 * due S days after the last practice. Remembering multiplies S; forgetting shrinks it. The default
 * FSRS weights are fitted to Anki cards; these few constants are the same shape, tuned for concepts.
 */
export function retrievability(daysSince: number, stability: number): number {
  return Math.pow(1 + (19 / 81) * (Math.max(0, daysSince) / Math.max(0.1, stability)), -0.5);
}

export function nextStability(stability: number | undefined, outcome: "taught" | "correct" | "wrong"): number {
  if (outcome === "taught") return stability ?? 1;
  if (outcome === "wrong") return Math.max(0.5, (stability ?? 1) * 0.4);
  return Math.min(180, Math.max(2, (stability ?? 1) * 2.5));
}

export function reviewDueAt(lastPracticed: string, stability: number): string {
  return new Date(Date.parse(lastPracticed) + stability * 86_400_000).toISOString();
}

/* ── what a lecture needs from the student ────────────────────────────────────────────────── */

export type Mastery = (key: string) => number | undefined;

/** What the lecture planner is told about the student's knowledge (lib/knowledge/planning.ts). */
export type PlanningKnowledge = {
  mastered: string[];
  shaky: Array<{ label: string; for: string }>;
  earlier: Array<{ label: string; topic: string }>;
};

/**
 * The prerequisites of some concepts that the student is shaky on (or has never met), most trusted
 * link first. `mastery` is undefined for a concept the student has never been taught.
 */
export function shakyPrerequisites(concepts: string[], edges: Array<Pick<KnowledgeEdge, "from" | "to" | "type" | "support">>, mastery: Mastery, limit = 3): Array<{ key: string; for: string; mastery: number | undefined; confidence: number }> {
  const out: Array<{ key: string; for: string; mastery: number | undefined; confidence: number }> = [];
  const wanted = new Set(concepts);
  for (const e of edges) {
    if (e.type !== "needs" || !wanted.has(e.from) || wanted.has(e.to)) continue;
    const m = mastery(e.to);
    if (m !== undefined && m >= 0.6) continue;
    if (out.some((o) => o.key === e.to)) continue;
    out.push({ key: e.to, for: e.from, mastery: m, confidence: edgeConfidence(e.support) });
  }
  // Something they were taught and got shaky on outranks something never met; trust breaks ties.
  return out.sort((a, b) => Number(b.mastery !== undefined) - Number(a.mastery !== undefined) || b.confidence - a.confidence).slice(0, limit);
}

/** How a concept on a board reads to this student: already known, met but shaky, or new to them. */
export function conceptStatus(mastery: number | undefined, firstSeenBeforeLecture: boolean): "known" | "shaky" | "new" {
  if (mastery === undefined || !firstSeenBeforeLecture) return "new";
  return mastery >= 0.7 ? "known" : "shaky";
}
