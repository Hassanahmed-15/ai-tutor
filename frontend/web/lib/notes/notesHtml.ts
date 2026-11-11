import katex from "katex";
import { dollarMath, type BoardBlock, type CalloutKind } from "../canvas/blocks";

/**
 * THE LESSON NOTES AS A PRINTABLE PAGE (owner, 2026-11-09: "allow the notes at the end to be exported as
 * PDF"). Every section of the lecture in full, the student's own questions, and the lesson's pictures with
 * their text beside them. One HTML document: the server prints it to a PDF, or, where the server has no
 * browser, the student's own browser does. Pure, unit-tested (lib/anim/notesHtml.test.ts).
 */
export type NotesPdfSection = { title: string; blocks: BoardBlock[]; picture?: { src: string; caption: string } };
export type NotesPdfAsked = { index: number; question: string; answer: string };
export type NotesPdfInput = { title: string; subject?: string; level?: string; date: string; sections: NotesPdfSection[]; asked: NotesPdfAsked[] };

const KATEX_CSS = "https://cdn.jsdelivr.net/npm/katex@0.18.1/dist/katex.min.css";
const LABEL: Record<CalloutKind, string> = { key_idea: "💡 Key idea", example: "✏️ Example", mistake: "⚠️ Common mistake", check: "❓ Check yourself", remember: "📌 Remember" };

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tex = (t: string, display = false) => katex.renderToString(t, { throwOnError: false, displayMode: display, trust: false });

/** Board text as HTML: **key terms** in bold, $…$ typeset, everything else escaped. */
export function inlineHtml(text: string): string {
  return dollarMath(text).split(/(\*\*[^*]+\*\*|\$[^$]+\$)/g).filter(Boolean).map((part) => {
    if (part.startsWith("**")) return `<strong>${inlineHtml(part.slice(2, -2))}</strong>`;
    if (part.startsWith("$") && part.length > 2) return tex(part.slice(1, -1));
    return esc(part);
  }).join("");
}

const RTL = /[֐-ࣿ]/;

function blockHtml(b: BoardBlock): string {
  const text = inlineHtml(b.board_text);
  const inner = (() => {
    switch (b.kind) {
      case "heading": return `<h3>${text}</h3>`;
      case "steps": return b.items?.length ? `<ol>${b.items.map((i) => `<li>${inlineHtml(i.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>` : `<p>${text}</p>`;
      case "formula":
      case "chemical_equation":
        return `<div class="formula">${tex(b.tex ?? b.board_text, true)}${b.where?.length ? `<div class="where">where:${b.where.map((w) => `<div>${inlineHtml(w)}</div>`).join("")}</div>` : ""}</div>`;
      case "code": return `<pre>${esc((b.code ?? b.board_text.split("\n")).join("\n"))}</pre>`;
      case "table":
      case "trace_table":
        return b.rows?.length ? `<table>${b.columns?.length ? `<thead><tr>${b.columns.map((c) => `<th>${inlineHtml(c)}</th>`).join("")}</tr></thead>` : ""}<tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${inlineHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : `<p>${text}</p>`;
      case "definition": return `<p class="definition">${text}</p>`;
      case "quote": return `<blockquote>${text}${b.source ? `<cite>${esc(b.source)}</cite>` : ""}</blockquote>`;
      case "translation": return `<p>${text}${b.translation ? `<span class="sub">${esc(b.translation)}${b.pronunciation ? ` (${esc(b.pronunciation)})` : ""}</span>` : ""}</p>`;
      case "callout": return `<aside><div class="label">${LABEL[b.callout ?? "key_idea"]}</div>${text}</aside>`;
      case "question": return `<aside><div class="label">${LABEL.check}</div>${text}</aside>`;
      case "answer_reveal": return `<p class="answer">${text}</p>`;
      case "visual_ref":
      case "image": return `<p class="caption">${text}</p>`;
      case "legend": return `<p class="caption">${text}</p>`;
      default: return `<p>${text}</p>`;
    }
  })();
  return `<div dir="${b.kind !== "code" && b.kind !== "formula" && RTL.test(b.board_text) ? "rtl" : "ltr"}">${inner}</div>`;
}

const asText = (s: NotesPdfInput) => JSON.stringify(s.sections.map((x) => x.title));

export function notesHtml(input: NotesPdfInput): string {
  const rtl = RTL.test(asText(input)) || input.sections.some((s) => s.blocks.some((b) => RTL.test(b.board_text)));
  let figure = 0;
  const sections = input.sections.map((s, index) => {
    const asked = input.asked.filter((a) => a.index === index);
    const n = s.picture ? ++figure : 0;
    return `<section>
<h2 id="s${index + 1}" dir="${RTL.test(s.title) ? "rtl" : "ltr"}">${index + 1}. ${inlineHtml(s.title)}</h2>
${s.picture ? `<figure><img src="${esc(s.picture.src)}" alt="${esc(s.picture.caption)}"><figcaption>Figure ${n}. ${esc(s.picture.caption)}</figcaption></figure>` : ""}
${s.blocks.map(blockHtml).join("\n")}
${asked.map((a) => `<aside class="asked"><div class="label">🗣️ You asked</div><strong>${esc(a.question)}</strong>${a.answer ? `<p>${esc(a.answer)}</p>` : ""}</aside>`).join("\n")}
</section>`;
  }).join("\n");
  const toc = input.sections.map((s, i) => `<li><a href="#s${i + 1}">${inlineHtml(s.title)}</a></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(input.title)}</title>
<link rel="stylesheet" href="${KATEX_CSS}">
${rtl ? '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Nastaliq+Urdu&family=Noto+Naskh+Arabic&display=swap">' : ""}
<style>
@page { size: A4; margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
body { font: 11.5pt/1.55 Georgia, "Times New Roman", ${rtl ? '"Noto Nastaliq Urdu", "Noto Naskh Arabic", ' : ""}serif; color: #15132b; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.cover { padding: 30mm 0 10mm; border-bottom: 2px solid #6c3fe6; margin-bottom: 8mm; }
.cover .brand { font: 600 11pt system-ui, sans-serif; color: #6c3fe6; }
.cover h1 { font: 700 26pt/1.15 system-ui, sans-serif; margin: 6mm 0 3mm; }
.cover .meta { font: 11pt system-ui, sans-serif; color: #56536f; }
.toc h2 { font: 700 13pt system-ui, sans-serif; margin: 0 0 2mm; border: 0; }
.toc ol { margin: 0; padding-inline-start: 6mm; } .toc a { color: inherit; text-decoration: none; }
.toc { break-after: page; }
h2 { font: 700 15pt/1.25 system-ui, sans-serif; margin: 7mm 0 3mm; padding-bottom: 1mm; border-bottom: 1px solid #c4bee0; break-after: avoid; }
h3 { font: 700 12.5pt system-ui, sans-serif; margin: 3mm 0 1.5mm; break-after: avoid; }
p { margin: 0 0 2.2mm; } strong { color: #5226c2; }
ol { margin: 0 0 2.5mm; padding-inline-start: 6mm; } li { margin-bottom: 1mm; }
figure { margin: 2mm 0 3.5mm; text-align: center; break-inside: avoid; } img { max-width: 100%; max-height: 95mm; }
figcaption, .caption { font: 9.5pt system-ui, sans-serif; color: #56536f; }
.definition { border-inline-start: 3px solid #6c3fe6; padding-inline-start: 3mm; } .answer { border-inline-start: 3px solid #c4bee0; padding-inline-start: 3mm; }
aside { background: #f3f0fb; border-inline-start: 3px solid #6c3fe6; border-radius: 2mm; padding: 2mm 3mm; margin: 0 0 2.5mm; break-inside: avoid; }
.label { font: 700 9.5pt system-ui, sans-serif; color: #56536f; margin-bottom: .7mm; }
.formula { margin: 1mm 0 2.5mm; break-inside: avoid; } .where { font-size: 10pt; color: #56536f; }
pre { font: 9.5pt/1.45 Menlo, Consolas, monospace; background: #f3f0fb; padding: 2.5mm 3mm; border-radius: 2mm; white-space: pre-wrap; break-inside: avoid; margin: 0 0 2.5mm; }
table { width: 100%; border-collapse: collapse; margin: 0 0 2.5mm; font-size: 10.5pt; break-inside: avoid; } th, td { border: 1px solid #c4bee0; padding: 1mm 1.8mm; text-align: start; vertical-align: top; } th { background: #f3f0fb; }
blockquote { margin: 0 0 2.5mm; padding-inline-start: 3mm; border-inline-start: 3px solid #c4bee0; font-style: italic; } cite { display: block; font-style: normal; font-size: 9.5pt; color: #56536f; } .sub { display: block; color: #56536f; font-size: 10pt; }
</style></head><body>
<div class="cover"><div class="brand">Aria · Lesson notes</div><h1>${inlineHtml(input.title)}</h1><div class="meta">${[input.subject, input.level, input.date].filter(Boolean).map((x) => esc(x!)).join(" · ")}</div></div>
<div class="toc"><h2>In these notes</h2><ol>${toc}</ol></div>
${sections}
</body></html>`;
}

/** A file name a student can keep: Aria-Notes_Biology_Osmosis_Lesson1_2026-11-09.pdf */
export function notesFileName(title: string, subject: string | undefined, date: string): string {
  const safe = (t: string) => t.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  const lesson = /Lesson (\d+) of \d+/.exec(title)?.[1];
  const topic = title.replace(/\s*[—-]\s*Lesson \d+ of \d+/, "");
  return ["Aria-Notes", subject ? safe(subject) : "", safe(topic), lesson ? `Lesson${lesson}` : "", date].filter(Boolean).join("_") + ".pdf";
}
