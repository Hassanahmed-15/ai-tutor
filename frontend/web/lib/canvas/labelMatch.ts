import { partNames, samePartName } from "./labelPolicy";

/**
 * A label must name the part its leader points at (owner, 2026-10-17: "I want the label to be very
 * very very accurate"). The board writer picks a part by id and writes its own name for it, and
 * nothing checked the two agreed — "Left atrium" could ship on the right atrium. The writer's name is
 * kept when it shares a word with the part's own name or id (or the part's name is a placeholder the
 * writer is meant to fill); otherwise the part's own name is used, which is right by construction.
 */
const STOP = new Set(["the", "and", "for", "with", "from", "into", "onto", "its", "his", "her", "their", "this", "that", "part", "side", "end", "region", "area"]);

function tokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[^A-Za-z0-9₀-₉⁰-⁹]+/).filter(Boolean)) {
    // Geometry and chemistry names are letters ("O", "AB", "OM", "H2O"): kept as they are written.
    if (/^[A-Z][A-Z0-9₀-₉]{0,3}$/.test(raw)) { out.push(raw); continue; }
    const w = raw.toLowerCase();
    if (w.length < 3 || STOP.has(w)) continue;
    out.push(w.replace(/(?:ies)$/, "y").replace(/(?:es|s)$/, ""));
  }
  return out;
}

/** A part name that is only a placeholder for content the writer supplies ("Event 2", "Body A"). */
export function placeholderPartName(name: string): boolean {
  return /^(?:part|item|object|body|event|step|stage|label|point|mass|block|card|box|node|cell|row|column|factor|cause|effect|case|example|group|value|term)\b[\s-]*(?:[A-Z0-9]{1,2}|one|two|three|four)?$/i.test(name.trim());
}

export function labelMatchesPart(label: string, part: { id: string; name: string; aliases?: string[] }): boolean {
  if (placeholderPartName(part.name)) return true;
  // The part's own name, any spelling of it, or a textbook synonym ("Sperm duct" on the vas deferens,
  // lib/canvas/labelPolicy.ts SYNONYMS) names it.
  if (partNames(part).some((n) => samePartName(label, n))) return true;
  const own = new Set([...tokens(part.name), ...tokens(part.id.replace(/[-_]+/g, " "))]);
  const lower = [...own].map((t) => t.toLowerCase());
  return tokens(label).some((t) => {
    if (own.has(t)) return true;
    const l = t.toLowerCase();
    // "vent" ~ "ventricle", "mitochondrion" ~ "mitochondria": a shared stem of four letters or more.
    return l.length >= 4 && lower.some((o) => o.length >= 4 && (o.startsWith(l.slice(0, Math.max(4, l.length - 2))) || l.startsWith(o.slice(0, Math.max(4, o.length - 2)))));
  });
}

let mismatches: string[] = [];
/** The labels replaced since the last call (the board writer is told, like a cut). */
export function takeLabelMismatches(): string[] {
  const out = mismatches;
  mismatches = [];
  return out;
}

/** The name to write on a part: the writer's when it names that part, else the part's own. */
export function accurateLabel(written: string, part: { id: string; name: string }): string {
  if (!written || labelMatchesPart(written, part)) return written || part.name;
  mismatches.push(`"${written}" was written on the part "${part.name}" (${part.id}), which it does not name: the part's own name was used`);
  return part.name;
}

/**
 * A substance or flow drawn as an arrow or dots (oxygen, CO₂, water, ions, light, heat). On a generated
 * picture these were the labels most often wrong — "Oxygen" and "Carbon dioxide" swapped onto each
 * other's arrows in a saved alveolus board (label check, 2026-10-17) — so a picture labels structures
 * only, and the narration and notes name what moves.
 */
export function movingSubstance(name: string): boolean {
  return /^(?:the\s+)?(?:incoming\s+|outgoing\s+|diffusing\s+)?(?:oxygen|carbon dioxide|co2|co₂|o2|o₂|water(?:\s+vapou?r)?|h2o|h₂o|glucose|sucrose|sugars?|amino acids?|fatty acids?|glycerol|ions?|sodium|potassium|chloride|calcium|hydrogen|nitrogen|ammonia|nitrates?|mineral(?:s| ions)?|nutrients?|urea|light(?:\s+energy)?|heat(?:\s+energy)?|energy|electrons?|protons?|atp|adp|nadph?|gases|gas exchange|air\s*flow|airflow)(?:\s+(?:molecules?|ions?|in|out|enters?|leaves?|diffus\w*|moves?|arrows?|flow))*\s*(?:\([^)]*\))?$/i.test(name.trim());
}
