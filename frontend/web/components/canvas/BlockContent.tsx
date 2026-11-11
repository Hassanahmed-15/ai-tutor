"use client";

import { Fragment, useLayoutEffect, useMemo, useRef } from "react";
import katex from "katex";
import { dollarMath, type BoardBlock, type CalloutKind, type RevealUnit } from "@/lib/canvas/blocks";

/**
 * ONE BLOCK OF THE FULL BOARD (lib/canvas/blocks.ts), drawn piece by piece: on the board (BlocksView) and in
 * the lesson notes (LessonNotesPanel). A piece not said yet keeps its place, unseen, so the lines around it
 * never jump when it appears.
 */
export const CALLOUT_LABEL: Record<CalloutKind | "you_asked", { mark: string; word: string }> = {
  key_idea: { mark: "💡", word: "Key idea" },
  example: { mark: "✏️", word: "Example" },
  mistake: { mark: "⚠️", word: "Common mistake" },
  check: { mark: "❓", word: "Check yourself" },
  remember: { mark: "📌", word: "Remember" },
  you_asked: { mark: "🗣️", word: "You asked" },
};

/** The smallest a formula is drawn to stay in its column. */
const FORMULA_MIN = 0.6;

function Tex({ tex, display = false }: { tex: string; display?: boolean }) {
  // A displayed formula is typeset inline in display style: that can break at "=" where the column is too narrow.
  const breakable = display && !/\\begin\{/.test(tex);
  const html = useMemo(() => katex.renderToString(breakable ? `\\displaystyle ${tex}` : tex, { throwOnError: false, displayMode: display && !breakable, trust: false }), [tex, display, breakable]);
  const box = useRef<HTMLSpanElement>(null);
  // What cannot break (one long fraction) is drawn smaller to stay in the column, not cut off at its edge.
  useLayoutEffect(() => {
    const el = box.current;
    if (!display || !el) return;
    let frame = 0, tries = 0, stopped = false;
    const fit = () => {
      if (stopped) return;
      el.style.fontSize = "";
      const room = el.parentElement?.clientWidth ?? 0;
      // A board is often mounted before it has a width.
      if (!room) { if (++tries < 40) frame = requestAnimationFrame(fit); return; }
      if (el.scrollWidth > room) el.style.fontSize = `${Math.max(FORMULA_MIN, room / el.scrollWidth).toFixed(3)}em`;
    };
    fit();
    void document.fonts?.ready.then(fit);
    return () => { stopped = true; cancelAnimationFrame(frame); };
  }, [html, display]);
  return <span ref={box} className={display ? "bk-tex" : undefined} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The picture part Aria is naming, as it is written in the text: the name or its plural, as a whole word. */
export function partWords(name: string): RegExp {
  const words = name.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])(${words}(?:e?s)?)(?![\\p{L}\\p{N}])`, "giu");
}

/** A line of board text: **key terms** stand out, $…$ is typeset, everything else is plain text. `lit`: words lit while she says them. */
export function Inline({ text, lit }: { text: string; lit?: RegExp }) {
  const parts = dollarMath(text).split(/(\*\*[^*]+\*\*|\$[^$]+\$)/g).filter(Boolean);
  const plain = (t: string, key: number) => {
    if (!lit) return <Fragment key={key}>{t}</Fragment>;
    const bits = t.split(lit);
    return <Fragment key={key}>{bits.map((b, k) => (k % 2 ? <mark key={k} className="bk-said">{b}</mark> : b))}</Fragment>;
  };
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") ? <strong key={i} className="bk-key"><Inline text={part.slice(2, -2)} lit={lit} /></strong>
        : part.startsWith("$") && part.length > 2 ? <Tex key={i} tex={part.slice(1, -1)} />
        : plain(part, i),
      )}
    </>
  );
}

const KEYWORDS = /\b(def|return|if|elif|else|for|while|in|not|and|or|import|from|class|True|False|None|print|function|var|let|const|int|float|void|public|static|DECLARE|INPUT|OUTPUT|ENDIF|ENDWHILE|NEXT|THEN|TO|FOR|WHILE|IF|ELSE|RETURN)\b/g;

function CodeLine({ line }: { line: string }) {
  const comment = line.search(/(#|\/\/).*$/);
  const code = comment >= 0 ? line.slice(0, comment) : line;
  const pieces = code.split(KEYWORDS);
  return (
    <>
      {pieces.map((piece, i) => (i % 2 ? <span key={i} className="bk-kw">{piece}</span> : <Fragment key={i}>{piece}</Fragment>))}
      {comment >= 0 && <span className="bk-dim">{line.slice(comment)}</span>}
    </>
  );
}

/** A block, its direction set by its own words: Urdu and Arabic run right to left, code never does. */
export function BlockView(props: { block: BoardBlock; units: RevealUnit[]; shown: number; said?: { name: string; sentence: number } }) {
  const rtl = props.block.kind !== "code" && props.block.kind !== "formula" && /[\u0590-\u08FF]/.test(props.block.board_text);
  return <div dir={rtl ? "rtl" : "ltr"}><BlockBody {...props} /></div>;
}

function BlockBody({ block, units, shown, said }: { block: BoardBlock; units: RevealUnit[]; shown: number; said?: { name: string; sentence: number } }) {
  const on = (i: number) => (i < shown ? "bk-on" : "bk-off");
  // The part of the picture she is naming lights up in the words of the sentence she is saying (PictureSpotlight).
  const words = useMemo(() => (said ? partWords(said.name) : undefined), [said?.name]);
  const litAt = (i: number) => (words && said && i < shown && Math.floor(units[i]?.at ?? -1) === said.sentence ? words : undefined);
  const lines = units.map((u, i) => <span key={u.key} data-bk-unit={i < shown ? "" : undefined} className={on(i)}><Inline text={u.text} lit={litAt(i)} /></span>);
  const label = (kind: CalloutKind | "you_asked") => (
    <div className="bk-label"><span className="cv-natural bk-emoji" aria-hidden="true">{CALLOUT_LABEL[kind].mark}</span> {CALLOUT_LABEL[kind].word}</div>
  );
  switch (block.kind) {
    case "heading":
      return <h3 className="bk-heading">{lines}</h3>;
    case "steps":
      // A step written with its own number ("1. Food enters…") is numbered once, by the list.
      return <ol className="bk-steps">{units.map((u, i) => <li key={u.key} data-bk-unit={i < shown ? "" : undefined} className={on(i)}><Inline text={u.text.replace(/^\s*\d+[.)]\s+/, "")} lit={litAt(i)} /></li>)}</ol>;
    case "formula":
    case "chemical_equation":
      return (
        <div className="bk-formula">
          <div data-bk-unit={shown > 0 ? "" : undefined} className={on(0)}><Tex tex={units[0]?.text ?? ""} display /></div>
          {units.length > 1 && <div className="bk-where"><span className={on(1)}>where:</span>{units.slice(1).map((u, i) => <div key={u.key} data-bk-unit={i + 1 < shown ? "" : undefined} className={on(i + 1)}><Inline text={u.text} lit={litAt(i + 1)} /></div>)}</div>}
        </div>
      );
    case "code":
      return <pre className="bk-code">{units.map((u, i) => <div key={u.key} data-bk-unit={i < shown ? "" : undefined} className={on(i)}><CodeLine line={u.text} /></div>)}</pre>;
    case "table":
    case "trace_table":
      if (block.rows?.length) {
        return (
          <table className="bk-table">
            {block.columns?.length ? <thead className={on(0)}><tr>{block.columns.map((c, i) => <th key={i}><Inline text={c} /></th>)}</tr></thead> : null}
            <tbody>{block.rows.map((row, r) => <tr key={r} data-bk-unit={r < shown ? "" : undefined} className={on(r)}>{row.map((cell, c) => <td key={c}><Inline text={cell} lit={litAt(r)} /></td>)}</tr>)}</tbody>
          </table>
        );
      }
      return <p className="bk-p">{lines}</p>;
    case "definition":
      return <p className="bk-def">{lines}</p>;
    case "quote":
      return <blockquote className="bk-quote">{lines}{block.source && <cite className={on(units.length - 1)}>— {block.source}</cite>}</blockquote>;
    case "translation":
      return <p className="bk-p">{lines}{(block.translation || block.pronunciation) && <span className={`bk-sub ${on(units.length - 1)}`}>{block.translation}{block.pronunciation ? ` (${block.pronunciation})` : ""}</span>}</p>;
    case "callout":
      return <aside className={`bk-box bk-${block.callout ?? "key_idea"}`}>{label(block.callout ?? "key_idea")}{lines}</aside>;
    case "you_asked":
      return <aside className="bk-box bk-asked">{label("you_asked")}{lines}</aside>;
    case "question":
      return <aside className="bk-box bk-check">{label("check")}{lines}</aside>;
    case "answer_reveal":
      return <p className="bk-answer">{lines}</p>;
    case "visual_ref":
    case "image":
      return <p className="bk-caption">▸ {lines}</p>;
    case "legend":
      return <p className="bk-legend">{lines}</p>;
    default:
      return <p className="bk-p">{lines}</p>;
  }
}
