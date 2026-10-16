import type { FigureComponent, FigureShape } from "../types";

/**
 * Protein synthesis as a left-to-right process: DNA is transcribed to mRNA, which a ribosome
 * translates into a polypeptide. The parts a labelling question names sit on one figure.
 */
export const proteinSynthesis: FigureComponent = {
  name: "proteinSynthesis",
  title: "Protein synthesis: DNA transcribed to mRNA, then translated at a ribosome into a polypeptide",
  params: `view ("transcription", "translation" or "both" default).`,
  match: /\bprotein synthes\w*\b|\btranscription and translation\b|\b(transcri(be|ption)|translat(e|ion))\b(?=[\s\S]{0,120}\b(mRNA|ribosome|polypeptide|amino acid|codon)\b)|\bmRNA\b(?=[\s\S]{0,80}\b(ribosome|codon|tRNA)\b)/i,
  parts: [
    { id: "dna", name: "DNA" },
    { id: "mrna", name: "mRNA" },
    { id: "ribosome", name: "Ribosome" },
    { id: "polypeptide", name: "Polypeptide" },
    { id: "transcription", name: "Transcription" },
    { id: "translation", name: "Translation" },
  ],
  build(params) {
    const view = String(params.view ?? "both").toLowerCase();
    const both = !/transcri/.test(view) && !/translat/.test(view) ? true : /both/.test(view);
    const showT = both || /transcri/.test(view);
    const showL = both || /translat/.test(view);
    const shapes: FigureShape[] = [];
    if (showT) {
      shapes.push({ t: "path", part: "dna", d: "M48 80 H220 V150 H48 Z", fill: "#bfdbfe", stroke: "ink", width: 2 });
      shapes.push({ t: "text", part: "dna", x: 134, y: 122, text: "DNA", size: 18, anchor: "middle" });
      shapes.push({ t: "path", part: "transcription", d: "M228 115 H300", stroke: "ink", width: 2.4, fill: "none" });
      shapes.push({ t: "path", part: "transcription", d: "M288 104 L308 115 L288 126", stroke: "ink", width: 2.4, fill: "none" });
      shapes.push({ t: "path", part: "mrna", d: "M316 80 H500 V150 H316 Z", fill: "#fde68a", stroke: "ink", width: 2 });
      shapes.push({ t: "text", part: "mrna", x: 408, y: 122, text: "mRNA", size: 18, anchor: "middle" });
    }
    if (showL) {
      const y = showT ? 210 : 80;
      shapes.push({ t: "path", part: "mrna", d: `M80 ${y} H240 V${y + 56} H80 Z`, fill: "#fde68a", stroke: "ink", width: 2 });
      shapes.push({ t: "circle", part: "ribosome", cx: 280, cy: y + 28, r: 42, fill: "#ddd6fe", stroke: "ink", width: 2.2 });
      shapes.push({ t: "path", part: "translation", d: `M330 ${y + 28} H390`, stroke: "ink", width: 2.4, fill: "none" });
      shapes.push({ t: "path", part: "polypeptide", d: `M398 ${y + 12} H560 V${y + 44} H398 Z`, fill: "#fecaca", stroke: "ink", width: 2 });
    }
    return {
      w: 640,
      h: showT && showL ? 340 : 220,
      shapes,
      parts: [
        { id: "dna", name: "DNA", anchor: { x: 134, y: 115 } },
        { id: "transcription", name: "Transcription", anchor: { x: 268, y: 115 } },
        { id: "mrna", name: "mRNA", anchor: { x: 408, y: 115 } },
        { id: "ribosome", name: "Ribosome", anchor: { x: 280, y: showL ? (showT ? 238 : 108) : 115 } },
        { id: "translation", name: "Translation", anchor: { x: 360, y: showL ? (showT ? 238 : 108) : 115 } },
        { id: "polypeptide", name: "Polypeptide", anchor: { x: 480, y: showL ? (showT ? 238 : 108) : 115 } },
      ],
    };
  },
};
