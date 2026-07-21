"use client";
import { InlineMath, BlockMath } from "react-katex";
import "katex/dist/katex.min.css";

export function Formula({ latex, block = true }: { latex: string; block?: boolean }) {
  return block ? <BlockMath math={latex} /> : <InlineMath math={latex} />;
}
