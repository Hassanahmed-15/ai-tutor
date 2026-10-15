"use client";

import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";
import { splitMath } from "@/lib/mathText";

/** Text with its LaTeX rendered by KaTeX (lib/mathText.ts); plain text passes through untouched. */
export function MathText({ text }: { text: string }) {
  const parts = useMemo(() => splitMath(text), [text]);
  if (parts.every((p) => p.kind === "text")) return <>{text}</>;
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.value}</span>
        ) : (
          <span
            key={i}
            className={p.display ? "my-1 block overflow-x-auto" : undefined}
            dangerouslySetInnerHTML={{ __html: katex.renderToString(p.value, { throwOnError: false, displayMode: p.display, output: "html" }) }}
          />
        ),
      )}
    </>
  );
}
