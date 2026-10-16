import type { FigureComponent, FigureParams, FigureShape, Ink } from "../types";

/**
 * PROTEIN SYNTHESIS, DRAWN FROM THE SEQUENCE. The board gives a DNA strand (template or coding) or
 * an mRNA; the code works out the complementary strands, the codons, each tRNA's anticodon and the
 * amino acids from the standard genetic code, and draws transcription (template strand → mRNA,
 * base by base) and translation (a ribosome on the mRNA, tRNAs bringing amino acids, the growing
 * polypeptide, the stop codon). The audit found the earlier version drew empty coloured boxes with
 * no bases at all (2026-10-17): every letter on this figure now comes from the sequence the board
 * teaches, so the diagram cannot disagree with the narration.
 */

/** The standard genetic code, mRNA codon → amino acid (three-letter), "Stop" for stop codons. */
const CODE: Record<string, string> = (() => {
  const bases = "UCAG";
  // Amino acids in the conventional UCAG × UCAG × UCAG order of the codon table.
  const table = "Phe Phe Leu Leu Ser Ser Ser Ser Tyr Tyr Stop Stop Cys Cys Stop Trp Leu Leu Leu Leu Pro Pro Pro Pro His His Gln Gln Arg Arg Arg Arg Ile Ile Ile Met Thr Thr Thr Thr Asn Asn Lys Lys Ser Ser Arg Arg Val Val Val Val Ala Ala Ala Ala Asp Asp Glu Glu Gly Gly Gly Gly".split(" ");
  const out: Record<string, string> = {};
  let i = 0;
  for (const a of bases) for (const b of bases) for (const c of bases) out[a + b + c] = table[i++];
  return out;
})();

const RNA_PAIR: Record<string, string> = { A: "U", T: "A", U: "A", G: "C", C: "G" };
const DNA_PAIR: Record<string, string> = { A: "T", T: "A", U: "A", G: "C", C: "G" };

export type ProteinSynthesisData = {
  /** Template DNA strand, 3'→5', when known. */
  template?: string;
  /** mRNA, 5'→3'. */
  mrna: string;
  codons: string[];
  anticodons: string[];
  aminoAcids: string[];
};

const bases = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^ACGTU]/g, "");

/** From whatever strand the board gives, the full set of sequences, read in triplets from the first AUG if there is one. */
export function proteinSynthesisData(params: FigureParams): ProteinSynthesisData {
  let mrna = bases(params.mrna);
  let template: string | undefined;
  const dna = bases(params.dna);
  if (!mrna && dna) {
    const strand = String(params.strand ?? "template").toLowerCase();
    if (/coding|sense/.test(strand)) mrna = dna.replace(/T/g, "U");
    else {
      // A template written 3'→5' pairs base by base with the mRNA written 5'→3'.
      template = dna;
      mrna = [...dna].map((b) => RNA_PAIR[b] ?? "").join("");
    }
  }
  if (!mrna) mrna = "AUGGCUAAAUGA";
  mrna = mrna.replace(/T/g, "U");
  if (!template) template = [...mrna].map((b) => DNA_PAIR[b] ?? "").join("");
  const start = mrna.indexOf("AUG");
  const from = start >= 0 ? start : 0;
  const codons: string[] = [];
  for (let i = from; i + 3 <= mrna.length && codons.length < 8; i += 3) {
    codons.push(mrna.slice(i, i + 3));
    if (CODE[codons[codons.length - 1]] === "Stop") break;
  }
  return {
    template,
    mrna,
    codons,
    anticodons: codons.map((c) => [...c].map((b) => RNA_PAIR[b]).join("")),
    aminoAcids: codons.map((c) => CODE[c] ?? "?"),
  };
}

const C = { dna: "#2563eb", mrna: "#d97706", trna: "#7c3aed", amino: "#16a34a", stop: "#dc2626", ribo: "#ddd6fe" } as const;

export const proteinSynthesis: FigureComponent = {
  name: "proteinSynthesis",
  title: "Protein synthesis from the sequence: template DNA transcribed base by base into mRNA codons, then a ribosome translating them with tRNA anticodons into the amino-acid chain, ending at the stop codon",
  params: `mrna (the mRNA, 5'→3', e.g. "AUG GCU AAA UGA") OR dna (a DNA strand, e.g. "TAC CGA TTT ACT") with strand ("template" default: the strand RNA polymerase reads, written 3'→5' | "coding"); view ("transcription", "translation" or "both" default). Use exactly the sequence the narration reads out. Codons, anticodons and amino acids are computed from the standard genetic code — never give them.`,
  match: /\bprotein synthes\w*\b|\btranscription and translation\b|\b(transcri(be|ption)|translat(e|ion))\b(?=[\s\S]{0,120}\b(mRNA|ribosome|polypeptide|amino acid|codon)\b)|\bmRNA\b(?=[\s\S]{0,80}\b(ribosome|codon|tRNA)\b)/i,
  parts: [
    { id: "dna", name: "Template DNA strand" },
    { id: "mrna", name: "mRNA" },
    { id: "codon", name: "Codon" },
    { id: "ribosome", name: "Ribosome" },
    { id: "trna", name: "tRNA" },
    { id: "anticodon", name: "Anticodon" },
    { id: "polypeptide", name: "Polypeptide" },
    { id: "stop-codon", name: "Stop codon" },
    { id: "transcription", name: "Transcription" },
    { id: "translation", name: "Translation" },
  ],
  build(params) {
    const data = proteinSynthesisData(params);
    const view = String(params.view ?? "both").toLowerCase();
    const showT = !/translat/.test(view) || /both/.test(view);
    const showL = !/transcri/.test(view) || /both/.test(view);
    const n = data.codons.length;
    const box = 78, gap = 8, x0 = 150;
    const W = Math.max(640, x0 + n * (box + gap) + 40);
    const shapes: FigureShape[] = [];
    const parts: Array<{ id: string; name: string; anchor: { x: number; y: number } }> = [];
    const codonX = (i: number) => x0 + i * (box + gap);
    const triplets = (seq: string) => Array.from({ length: n }, (_, i) => seq.slice(i * 3, i * 3 + 3));
    const strand = (y: number, seqs: string[], colour: Ink, part: string, label: string, ends: [string, string]) => {
      void label;
      shapes.push({ t: "text", x: codonX(0) - 2, y: y - 6, text: ends[0], size: 13, anchor: "start", fill: "muted" });
      shapes.push({ t: "text", x: codonX(n - 1) + box, y: y - 6, text: ends[1], size: 13, anchor: "end", fill: "muted" });
      seqs.forEach((s, i) => {
        const stop = part === "mrna" && data.aminoAcids[i] === "Stop";
        shapes.push({ t: "path", d: `M${codonX(i)} ${y} h${box} v38 h-${box} Z`, fill: stop ? "#fee2e2" : "paper", stroke: stop ? C.stop : colour, width: 2, part: stop ? "stop-codon" : i === 0 && part === "mrna" ? "codon" : part });
        shapes.push({ t: "text", x: codonX(i) + box / 2, y: y + 26, text: s.split("").join(" "), size: 18, anchor: "middle", fill: "ink", part });
      });
    };
    let y = 30;
    if (showT) {
      // The template strand from the board's own sequence, aligned to the mRNA it gives.
      const startOffset = Math.max(0, data.mrna.indexOf("AUG"));
      const templateFromStart = (data.template ?? "").slice(startOffset);
      strand(y, triplets(templateFromStart), C.dna, "dna", "Template DNA", ["3′", "5′"]);
      parts.push({ id: "dna", name: "Template DNA strand", anchor: { x: codonX(0) + 6, y: y + 19 } });
      shapes.push({ t: "path", d: `M${codonX(0) - 60} ${y + 46} v34`, stroke: C.dna, width: 2.4, fill: "none", part: "transcription" });
      shapes.push({ t: "path", d: `M${codonX(0) - 66} ${y + 72} l6 10 l6 -10`, stroke: C.dna, width: 2.4, fill: "none", part: "transcription" });
      parts.push({ id: "transcription", name: "Transcription (RNA polymerase)", anchor: { x: codonX(0) - 60, y: y + 64 } });
      y += 92;
    }
    strand(y, data.codons, C.mrna, "mrna", "mRNA", ["5′", "3′"]);
    parts.push({ id: "mrna", name: "mRNA", anchor: { x: codonX(Math.min(1, n - 1)) + box / 2, y: y + 38 } });
    parts.push({ id: "codon", name: `Codon (${data.codons[0] ?? "AUG"})`, anchor: { x: codonX(0) + box / 2, y: y + 38 } });
    const stopAt = data.aminoAcids.indexOf("Stop");
    if (stopAt >= 0) parts.push({ id: "stop-codon", name: `Stop codon (${data.codons[stopAt]})`, anchor: { x: codonX(stopAt) + box / 2, y: y + 38 } });
    if (showL) {
      const ry = y;
      // The ribosome holds the first two codons and their tRNAs; each tRNA's anticodon pairs under its
      // codon, and the amino acids join into the chain below.
      const rcx = codonX(0) + box + gap / 2, rcy = ry + 40, rrx = box + 34, rry = 56;
      // Drawn first, behind the codons it holds, so their letters stay readable.
      shapes.unshift({ t: "path", d: `M${rcx - rrx} ${rcy} a${rrx} ${rry} 0 1 0 ${2 * rrx} 0 a${rrx} ${rry} 0 1 0 ${-2 * rrx} 0`, fill: C.ribo, stroke: C.trna, width: 1.8, opacity: 0.45, part: "ribosome" });
      parts.push({ id: "ribosome", name: "Ribosome", anchor: { x: rcx - rrx + 6, y: rcy + 20 } });
      const ty = ry + 44;
      const coding = data.aminoAcids.map((a, i) => ({ a, i })).filter((x) => x.a !== "Stop");
      coding.forEach(({ a, i }) => {
        const cx = codonX(i) + box / 2;
        shapes.push({ t: "path", d: `M${cx - 30} ${ty} h60 v26 h-60 Z`, fill: "#ede9fe", stroke: C.trna, width: 1.8, part: i === 0 ? "anticodon" : "trna" });
        shapes.push({ t: "text", x: cx, y: ty + 19, text: data.anticodons[i].split("").join(" "), size: 15, anchor: "middle", fill: C.trna, part: i === 0 ? "anticodon" : "trna" });
        shapes.push({ t: "path", d: `M${cx} ${ty + 26} v16`, stroke: C.trna, width: 2, fill: "none", part: "trna" });
        shapes.push({ t: "circle", cx, cy: ty + 62, r: 20, fill: "#dcfce7", stroke: C.amino, width: 2, part: "polypeptide" });
        shapes.push({ t: "text", x: cx, y: ty + 67, text: a, size: 15, anchor: "middle", fill: C.amino, part: "polypeptide" });
        if (i > 0) shapes.push({ t: "path", d: `M${codonX(i - 1) + box / 2 + 20} ${ty + 62} H${cx - 20}`, stroke: C.amino, width: 3, fill: "none", part: "polypeptide" });
      });
      if (coding.length) {
        parts.push({ id: "anticodon", name: `Anticodon (${data.anticodons[0]})`, anchor: { x: codonX(0) + box / 2 - 30, y: ty + 13 } });
        parts.push({ id: "trna", name: "tRNA", anchor: { x: codonX(Math.min(1, coding.length - 1)) + box / 2, y: ty + 34 } });
        parts.push({ id: "polypeptide", name: `Polypeptide (${coding.map((c) => c.a).join("–")})`, anchor: { x: codonX(coding.length - 1) + box / 2 + 20, y: ty + 62 } });
        parts.push({ id: "translation", name: "Translation", anchor: { x: rcx, y: rcy - rry + 3 } });
      }
    }
    // Shift everything down so the amino-acid row above the mRNA is inside the figure.
    const tops = shapes.map((sh) => (sh.t === "circle" ? sh.cy - sh.r : sh.t === "text" ? sh.y - sh.size : Number(/^M-?[\d.]+ (-?[\d.]+)/.exec(sh.d)?.[1] ?? 0)));
    const shift = Math.max(0, 12 - Math.min(...tops));
    const moved: FigureShape[] = shapes.map((sh) => {
      if (sh.t === "circle") return { ...sh, cy: sh.cy + shift };
      if (sh.t === "text") return { ...sh, y: sh.y + shift };
      return { ...sh, d: sh.d.replace(/^M(-?[\d.]+) (-?[\d.]+)/, (_, x, yy) => `M${x} ${Number(yy) + shift}`) };
    });
    return { w: W, h: y + (showL ? 140 : 60) + shift, shapes: moved, parts: parts.map((p) => ({ ...p, anchor: { x: p.anchor.x, y: p.anchor.y + shift } })) };
  },
};
