"use client";

import { useEffect, useMemo, useRef } from "react";
import hljs from "highlight.js/lib/core";
import cpp from "highlight.js/lib/languages/cpp";
import c from "highlight.js/lib/languages/c";
import java from "highlight.js/lib/languages/java";
import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import csharp from "highlight.js/lib/languages/csharp";
import go from "highlight.js/lib/languages/go";
import sql from "highlight.js/lib/languages/sql";
import type { CodeSpec } from "@/lib/codeSpec";

/*
 * Only the languages codeSpec allows, registered one by one. The full highlight.js bundle is ~190
 * languages; a board that can only ever receive ten should not ship the other hundred and eighty.
 */
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("c", c);
hljs.registerLanguage("java", java);
hljs.registerLanguage("python", python);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("go", go);
hljs.registerLanguage("sql", sql);

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Highlighted HTML, one string per source line.
 *
 * Highlighting line by line would be simpler and wrong: a block comment or multi-line string opens
 * on one line and closes on another, and highlighting each line alone colours the middle of it as
 * code. So the whole listing is highlighted once and the HTML is split afterwards — every span still
 * open at a newline is closed there and reopened on the next line, so each line is valid markup.
 */
export function highlightLines(code: string, language: CodeSpec["language"]): string[] {
  const html = language === "pseudocode" ? escapeHtml(code) : hljs.highlight(code, { language, ignoreIllegals: true }).value;
  const lines: string[] = [];
  const open: string[] = [];
  let current = "";
  const tag = /<span[^>]*>|<\/span>|\n/g;
  let last = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    current += html.slice(last, m.index);
    last = m.index + m[0].length;
    if (m[0] === "\n") {
      lines.push(current + "</span>".repeat(open.length));
      current = open.join("");
    } else if (m[0] === "</span>") {
      open.pop();
      current += m[0];
    } else {
      open.push(m[0]);
      current += m[0];
    }
  }
  lines.push(current + html.slice(last));
  return lines;
}

/**
 * A code listing, walked through against the beat's narration progress.
 *
 * Deliberately NOT a drawing, for the reason EquationBoard is not: code is READ. Asked to explain a
 * PDF's `remove()` function, the pipeline drew an animated tree and the student never saw the
 * function they were asking about. This board shows the listing itself and moves a highlight through
 * it — search, then each deletion case — with a one-line note on what those lines do.
 *
 * The whole listing is visible from the first frame, faded: a reader needs the shape of the function
 * to follow a highlight moving through it. Lines already walked through stay fully readable.
 */
export function CodeBoard({ spec, progress = 0, compact = false }: { spec: CodeSpec; progress?: number; compact?: boolean }) {
  const lines = useMemo(() => highlightLines(spec.code, spec.language), [spec.code, spec.language]);
  const steps = spec.steps;
  const clamped = Math.max(0, Math.min(1, progress));
  // Step one is lit from the first frame: a code beat's script runs for minutes, and any lead-in
  // left the board unhighlighted for the whole opening sentence.
  const active = Math.min(steps.length - 1, Math.floor(clamped * steps.length));
  const current = active >= 0 ? steps[active] : null;

  const lineState = useMemo(() => {
    const state = new Array<"idle" | "seen" | "active">(lines.length).fill("idle");
    steps.forEach((step, i) => {
      if (i > active) return;
      for (let n = step.lines[0]; n <= step.lines[1]; n++) {
        // Steps run in order and the active one is visited last, so it wins any overlap.
        state[n - 1] = i === active ? "active" : "seen";
      }
    });
    return state;
  }, [lines.length, steps, active]);

  // Scroll the LISTING, never the page: scrollIntoView also moves every scrollable ancestor, which
  // would yank the whole lesson layout each time the highlight advances.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const firstActive = current ? current.lines[0] - 1 : -1;
  useEffect(() => {
    const box = scrollRef.current;
    const line = box?.querySelector<HTMLElement>(`[data-line="${firstActive + 1}"]`);
    if (!box || !line) return;
    const top = line.offsetTop; // the listing is `relative`, so this is already box-relative
    if (top < box.scrollTop || top + line.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: "smooth" });
    }
  }, [firstActive]);

  return (
    <section
      data-board="code"
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-900"
    >
      <style>{CODE_THEME}</style>
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <span className="font-mono text-xs font-bold text-slate-500">&lt;/&gt;</span>
        <span className="text-sm font-bold text-slate-700">{spec.title ?? LANGUAGE_LABEL[spec.language]}</span>
        <span className="text-xs font-semibold text-slate-400">{LANGUAGE_LABEL[spec.language]}</span>
        {spec.fromSource && (
          <span className="ml-auto rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
            From your document
          </span>
        )}
      </header>

      <div ref={scrollRef} className={`code-board relative min-h-0 flex-1 overflow-auto py-3 font-mono ${compact ? "text-[12px]" : "text-[13px] lg:text-sm"} leading-6`}>
        {lines.map((html, i) => {
          const state = lineState[i];
          return (
            <div
              key={i}
              data-line={i + 1}
              data-state={state}
              className={`flex border-l-4 pr-4 transition-colors duration-300 ${
                state === "active" ? "border-amber-400 bg-amber-100/80" : "border-transparent"
              }`}
              style={{ opacity: state === "idle" && active >= 0 ? 0.45 : 1 }}
            >
              <span className="w-10 shrink-0 select-none pr-3 text-right text-slate-400">{i + 1}</span>
              <code className="min-w-0 flex-1 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{ __html: html || " " }} />
            </div>
          );
        })}
      </div>

      <footer className="min-h-[3.25rem] border-t border-slate-200 bg-slate-50 px-4 py-2">
        {current ? (
          <p className="text-sm font-semibold text-slate-800">
            <span className="mr-2 text-xs font-bold text-amber-700">
              Step {active + 1}/{steps.length} · lines {current.lines[0]}
              {current.lines[1] !== current.lines[0] ? `–${current.lines[1]}` : ""}
            </span>
            {current.note}
          </p>
        ) : (
          <p className="text-xs font-semibold text-slate-400">Follow along — each part is highlighted as it is explained.</p>
        )}
      </footer>
    </section>
  );
}

const LANGUAGE_LABEL: Record<CodeSpec["language"], string> = {
  cpp: "C++",
  c: "C",
  java: "Java",
  python: "Python",
  javascript: "JavaScript",
  typescript: "TypeScript",
  csharp: "C#",
  go: "Go",
  sql: "SQL",
  pseudocode: "Pseudocode",
};

/* A light GitHub-like palette, scoped to this board so it cannot restyle anything else. */
export const CODE_THEME = `
.code-board .hljs-keyword, .code-board .hljs-built_in, .code-board .hljs-type { color: #b0306b; }
.code-board .hljs-literal, .code-board .hljs-number { color: #0550ae; }
.code-board .hljs-string, .code-board .hljs-char { color: #0a7a3b; }
.code-board .hljs-comment { color: #6e7781; font-style: italic; }
.code-board .hljs-title, .code-board .hljs-title.function_ { color: #6639ba; }
.code-board .hljs-params, .code-board .hljs-variable { color: #1f2328; }
.code-board .hljs-meta { color: #8a4600; }
.code-board .hljs-operator, .code-board .hljs-punctuation { color: #57606a; }
`;
