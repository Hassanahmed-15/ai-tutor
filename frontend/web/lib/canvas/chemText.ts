/**
 * FORMULAS WRITTEN AS A STUDENT READS THEM IN PRINT: "CH4, C2H6" on a written board becomes "CH₄, C₂H₆"
 * (course bench, 2026-10-24: "Naming and drawing hydrocarbons" wrote every formula flat). A word is changed
 * only when it is wholly element symbols with counts — "CO2", "H2SO4", "Ca(OH)2", "C3H8" — so "Group 2",
 * "Q1", "Year 11" and "2 marks" stay as they are; a leading number ("2H2O") stays full size.
 */
const ELEMENTS = new Set("H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" "));
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };

/** Is this word a chemical formula: element symbols, brackets and counts only, with at least one count? */
function isFormula(word: string): boolean {
  if (!/\d/.test(word) || !/^[A-Z(]/.test(word)) return false;
  const parts = word.match(/[A-Z][a-z]?|\d+|[()]/g);
  if (!parts || parts.join("") !== word) return false;
  // At least one element, and a count only after an element or a closing bracket: "(0, 1)" is a point, not a formula.
  return parts.some((p) => ELEMENTS.has(p)) && parts.every((p, i) => (/^\d+$/.test(p) ? i > 0 && (ELEMENTS.has(parts[i - 1]) || parts[i - 1] === ")") : p === "(" || p === ")" || ELEMENTS.has(p)));
}

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "–": "⁻" };
const sub = (d: string) => [...d].map((c) => SUB[c]).join("");
const sup = (d: string) => [...d].map((c) => SUP[c] ?? c).join("");

/**
 * An ion's charge is raised, not lowered: "Ca2+" → "Ca²⁺" (it came out "Ca₂+", course bench 2026-10-24),
 * "SO42-" → "SO₄²⁻", "NH4+" → "NH₄⁺", "OH-" → "OH⁻". One element and a number before the sign: the number
 * is the charge. Several elements: a single final digit is a count (NO3- → NO₃⁻), two final digits are a
 * count and then the charge (CO32- → CO₃²⁻).
 */
export function chemSubscripts(text: string): string {
  return text.replace(/(^|[^A-Za-z0-9])(\d*)([A-Z(][A-Za-z0-9()]*)([+\-−–](?![A-Za-z0-9]))?/g, (whole, before: string, lead: string, word: string, sign: string | undefined) => {
    if (!isFormula(word) && !(sign && /^[A-Z][a-z]?$|^[A-Z(]/.test(word) && isFormula(`${word}1`))) return whole;
    if (!sign) return `${before}${lead}${word.replace(/\d+/g, sub)}`;
    const tail = /(\d+)$/.exec(word)?.[1] ?? "";
    const body = word.slice(0, word.length - tail.length);
    const single = /^[A-Z][a-z]?$/.test(body);
    const [count, charge] = single ? ["", tail] : tail.length >= 2 ? [tail.slice(0, -1), tail.slice(-1)] : [tail, ""];
    return `${before}${lead}${body.replace(/\d+/g, sub)}${sub(count)}${sup(charge)}${sup(sign)}`;
  });
}
