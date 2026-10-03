/**
 * Model JSON in, a CanvasBoardSpec the renderer can always draw out — or null.
 *
 * Every field is checked and clamped rather than trusted: ids are slugged and de-duplicated, sentence
 * numbers are clamped to the narration, icons must be known, expressions must parse and read only
 * the board's own variables, and cues aimed at ids that do not exist are dropped. A board missing
 * what its stage needs to draw anything returns null, and the caller retries or falls back.
 */

import { compileExpr, exprUsesOnly } from "./expr";
import {
  CANVAS_ICONS,
  CANVAS_STAGES,
  type CanvasBoardSpec,
  type CanvasCue,
  type CanvasIcon,
  type CanvasInteraction,
  type CodeStage,
  type CompareStage,
  type EquationStage,
  type FlowArrow,
  type FlowStage,
  type GraphStage,
  type IllustrationStage,
  type SceneStage,
  type StageSpec,
} from "./types";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Text, trimmed and capped. A list of strings is joined — models often answer "1 or 2 sentences" as an array. */
const str = (v: unknown, max = 80): string => {
  const text = typeof v === "string" ? v : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(" ") : "";
  return text.replace(/\s+/g, " ").trim().slice(0, max);
};
const num = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function slug(v: unknown, fallback: string): string {
  const s = str(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}

const icon = (v: unknown): CanvasIcon | undefined => {
  const s = str(v, 20).toLowerCase();
  return (CANVAS_ICONS as readonly string[]).includes(s) ? (s as CanvasIcon) : undefined;
};
const color = (v: unknown): string | undefined => {
  const s = str(v, 9);
  return /^#[0-9a-f]{6}$/i.test(s) ? s : undefined;
};

export function validateCanvasSpec(raw: unknown, sentenceCount: number, vars: string[] = []): CanvasBoardSpec | null {
  const r = obj(raw);
  const lastS = Math.max(0, sentenceCount - 1);
  const sentence = (v: unknown, fallback = 0) => Math.max(0, Math.min(lastS, Math.round(num(v, fallback))));
  const used = new Set<string>(["heading", "stage", "board", "picture", "equation", "graph"]);
  const unique = (v: unknown, fallback: string) => {
    let id = slug(v, fallback);
    while (used.has(id)) id = `${id}-2`;
    used.add(id);
    return id;
  };

  const heading = str(r.heading, 60);
  if (!heading) return null;

  const notes = arr(r.notes)
    .map((n, i) => {
      const o = typeof n === "string" ? { text: n } : obj(n);
      const text = str(o.text, 44).replace(/\.$/, "");
      return text ? { id: unique(o.id ?? `note-${i + 1}`, `note-${i + 1}`), text, s: sentence(o.s ?? o.sentence, i) } : null;
    })
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .slice(0, 4);

  const interaction = validateInteraction(r.interaction);
  const knownVars = interaction?.kind === "try" ? interaction.controls.map((c) => c.var) : vars;

  const stage = validateStage(obj(r.stage), sentence, unique, knownVars);
  if (!stage) return null;

  const ids = new Set(used);
  const cues: CanvasCue[] = arr(r.cues)
    .map((c) => obj(c))
    .map((c): CanvasCue | null => {
      const action = str(c.action, 12) as CanvasCue["action"];
      if (!["point", "circle", "underline", "zoom", "unzoom", "visit"].includes(action)) return null;
      // A visit names another board; whether that board exists and came earlier is checked by the
      // caller, which knows the lesson.
      if (action === "visit") {
        const beat = str(c.beat ?? c.target, 40);
        return beat ? { s: sentence(c.s ?? c.sentence), at: Math.max(0, Math.min(0.9, num(c.at, 0.05))), action, beat } : null;
      }
      const target = c.target === undefined ? undefined : slug(c.target, "");
      if (action !== "unzoom" && (!target || !ids.has(target))) return null;
      return { s: sentence(c.s ?? c.sentence), at: Math.max(0, Math.min(0.95, num(c.at, 0.2))), action, target };
    })
    .filter((c): c is CanvasCue => Boolean(c))
    .slice(0, 14);

  const carry = arr(r.carry).map((c) => slug(c, "")).filter((c) => c && ids.has(c)).slice(0, 3);
  const insideRaw = obj(r.inside);
  const inside = str(insideRaw.beat, 40) && str(insideRaw.id, 40) ? { beat: str(insideRaw.beat, 40), id: slug(insideRaw.id, "") } : undefined;

  return {
    v: 1,
    heading,
    notes,
    stage,
    cues,
    ...(carry.length ? { carry } : {}),
    ...(inside ? { inside } : {}),
    ...(interaction ? { interaction } : {}),
    ...(r.overview === true ? { overview: true } : {}),
  };
}

function validateArrows(raw: unknown, sentence: (v: unknown, f?: number) => number, unique: (v: unknown, f: string) => string, nodeIds: Set<string>, vars: string[]): FlowArrow[] {
  return arr(raw)
    .map((a) => obj(a))
    .map((a, i): FlowArrow | null => {
      const from = slug(a.from, "");
      const to = slug(a.to, "");
      if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) return null;
      const rate = str(a.rate, 120);
      return {
        id: unique(a.id ?? `${from}-to-${to}`, `arrow-${i + 1}`),
        from,
        to,
        label: str(a.label, 22) || undefined,
        s: sentence(a.s ?? a.sentence),
        flow: a.flow === true,
        rate: rate && exprUsesOnly(rate, vars) ? rate : undefined,
        color: color(a.color),
      };
    })
    .filter((a): a is FlowArrow => Boolean(a))
    .slice(0, 10);
}

function validateStage(r: Raw, sentence: (v: unknown, f?: number) => number, unique: (v: unknown, f: string) => string, vars: string[]): StageSpec | null {
  const kind = str(r.kind, 16) as StageSpec["kind"];
  if (!(CANVAS_STAGES as readonly string[]).includes(kind)) return null;

  if (kind === "code") return validateCode(r, sentence, unique);

  if (kind === "flow") {
    const nodes = arr(r.nodes)
      .map((n) => obj(n))
      .map((n, i) => {
        const label = str(n.label, 24);
        if (!label) return null;
        const glow = str(n.glow, 120);
        const role = str(n.role, 8);
        const becomes = becomesOf(n.becomes, sentence);
        return {
          id: unique(n.id ?? label, `node-${i + 1}`),
          label,
          sub: str(n.sub, 28) || undefined,
          icon: icon(n.icon),
          color: color(n.color),
          role: (["input", "core", "output"].includes(role) ? role : undefined) as FlowStage["nodes"][number]["role"],
          s: sentence(n.s ?? n.sentence, i),
          glow: glow && exprUsesOnly(glow, vars) ? glow : undefined,
          ...(becomes ? { becomes } : {}),
        };
      })
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .slice(0, 7);
    if (nodes.length < 2) return null;
    const arrangement = str(r.arrangement, 24);
    const stage: FlowStage = {
      kind,
      arrangement: arrangement === "cycle" || arrangement === "chain" ? arrangement : "inputs-core-outputs",
      nodes,
      arrows: validateArrows(r.arrows, sentence, unique, new Set(nodes.map((n) => n.id)), vars),
    };
    return stage;
  }

  if (kind === "illustration") {
    const subject = str(r.subject, 500);
    const parts = arr(r.parts)
      .map((p) => (typeof p === "string" ? { name: p } : obj(p)))
      .map((p, i) => {
        const name = str(p.name, 32);
        const say = str(p.say, 220);
        return name ? { id: unique(p.id ?? name, `part-${i + 1}`), name, s: sentence(p.s ?? p.sentence, i), ...(say ? { say } : {}), ...(Number.isFinite(Number(p.x)) ? { x: Number(p.x), y: Number(p.y) } : {}) } : null;
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 8);
    if (!subject || !parts.length) return null;
    const partIds = new Set(parts.map((p) => p.id));
    const stage: IllustrationStage = {
      kind,
      subject,
      parts,
      labels: arr(r.labels).map((l) => slug(l, "")).filter((l) => partIds.has(l)).slice(0, 3),
      ...(typeof r.src === "string" ? { src: r.src } : {}),
      ...(typeof r.paper === "string" ? { paper: r.paper } : {}),
    };
    return stage;
  }

  if (kind === "equation") {
    const tokens = arr(r.tokens)
      .map((t) => (typeof t === "string" ? { text: t } : obj(t)))
      .map((t, i) => {
        const text = str(t.text, 18);
        return text ? { id: unique(t.id ?? `t${i + 1}`, `t${i + 1}`), text, color: color(t.color), on: t.on === undefined ? undefined : slug(t.on, "") } : null;
      })
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .slice(0, 16)
      .map((t, _, all) => (t.on && all.some((h) => h.id === t.on && h.id !== t.id) ? t : { ...t, on: undefined }));
    if (tokens.length < 2) return null;
    const tokenIds = new Set(tokens.map((t) => t.id));
    const steps = arr(r.steps)
      .map((st) => obj(st))
      .map((st) => {
        const order = arr(st.order).map((id) => slug(id, "")).filter((id) => tokenIds.has(id));
        return order.length
          ? { s: sentence(st.s ?? st.sentence), order: [...new Set(order)], highlight: arr(st.highlight).map((h) => slug(h, "")).filter((h) => tokenIds.has(h)), caption: str(st.caption, 60) || undefined }
          : null;
      })
      .filter((st): st is NonNullable<typeof st> => Boolean(st))
      .sort((a, b) => a.s - b.s)
      .slice(0, 6);
    const stage: EquationStage = { kind, tokens, steps: steps.length ? steps : [{ s: 0, order: tokens.map((t) => t.id), highlight: [] }] };
    return stage;
  }

  if (kind === "graph") {
    const axis = (v: unknown, fallback: string) => {
      const a = obj(v);
      const min = num(a.min, 0);
      const max = num(a.max, 100);
      return { label: str(a.label, 32) || fallback, min: Math.min(min, max - 1e-6), max: Math.max(max, min + 1e-6) };
    };
    const curveVars = [...vars, "x"];
    const curves = arr(r.curves)
      .map((c) => obj(c))
      .map((c, i) => {
        let expr = str(c.expr, 160);
        // A curve is a function of its x axis. Written in the slider's variable instead ("rate =
        // f(light)" with light on the x axis), it would draw flat — so that variable becomes x.
        const read = compileExpr(expr)?.vars ?? [];
        if (!read.includes("x") && read.length === 1 && vars.includes(read[0])) expr = expr.replace(new RegExp(`\\b${read[0]}\\b`, "g"), "x");
        if (!compileExpr(expr) || !exprUsesOnly(expr, curveVars)) return null;
        return { id: unique(c.id ?? `curve-${i + 1}`, `curve-${i + 1}`), expr, label: str(c.label, 28) || undefined, color: color(c.color), s: sentence(c.s ?? c.sentence, i) };
      })
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .slice(0, 3);
    if (!curves.length) return null;
    const curveIds = new Set(curves.map((c) => c.id));
    const markers = arr(r.markers)
      .map((m) => obj(m))
      .map((m, i) => {
        const x = str(m.x, 80) || String(num(m.x, NaN));
        const curve = slug(m.curve, curves[0].id);
        if (!compileExpr(x) || !exprUsesOnly(x, vars) || !curveIds.has(curve)) return null;
        return { id: unique(m.id ?? `marker-${i + 1}`, `marker-${i + 1}`), x, curve, label: str(m.label, 24) || undefined, s: sentence(m.s ?? m.sentence) };
      })
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .slice(0, 2);
    const guides = arr(r.guides)
      .map((g) => obj(g))
      .map((g, i) => (Number.isFinite(Number(g.x)) && str(g.label, 24) ? { id: unique(g.id ?? `guide-${i + 1}`, `guide-${i + 1}`), x: Number(g.x), label: str(g.label, 24), s: sentence(g.s ?? g.sentence) } : null))
      .filter((g): g is NonNullable<typeof g> => Boolean(g))
      .slice(0, 2);
    const trace = obj(r.trace);
    const stage: GraphStage = {
      kind,
      x: axis(r.x, "x"),
      y: axis(r.y, "y"),
      curves,
      ...(markers.length ? { markers } : {}),
      ...(guides.length ? { guides } : {}),
      ...(curveIds.has(slug(trace.curve, "")) ? { trace: { curve: slug(trace.curve, ""), s: sentence(trace.s ?? trace.sentence) } } : {}),
    };
    return stage;
  }

  if (kind === "compare") {
    const side = (v: unknown, fallback: string) => {
      const s = obj(v);
      const title = str(s.title, 28);
      const items = arr(s.items)
        .map((it) => (typeof it === "string" ? { text: it } : obj(it)))
        .map((it, i) => (str(it.text, 60) ? { id: unique(it.id ?? `${fallback}-${i + 1}`, `${fallback}-${i + 1}`), text: str(it.text, 60), s: sentence(it.s ?? it.sentence, i) } : null))
        .filter((it): it is NonNullable<typeof it> => Boolean(it))
        .slice(0, 4);
      return title && items.length ? { id: unique(s.id ?? fallback, fallback), title, icon: icon(s.icon), color: color(s.color), items } : null;
    };
    const left = side(r.left, "left");
    const right = side(r.right, "right");
    if (!left || !right) return null;
    const itemIds = new Set([...left.items, ...right.items].map((i) => i.id));
    const stage: CompareStage = {
      kind,
      left,
      right,
      links: arr(r.links)
        .map((l) => obj(l))
        .map((l) => ({ from: slug(l.from, ""), to: slug(l.to, "") }))
        .filter((l) => itemIds.has(l.from) && itemIds.has(l.to))
        .slice(0, 4),
    };
    return stage;
  }

  // scene
  const items = arr(r.items)
    .map((it) => obj(it))
    .map((it, i) => {
      const k = str(it.kind, 6);
      const cell = str(it.cell, 3).toUpperCase();
      if (!/^[A-F][1-4]$/.test(cell)) return null;
      return {
        id: unique(it.id ?? it.label ?? `item-${i + 1}`, `item-${i + 1}`),
        kind: (k === "box" || k === "text" ? k : "icon") as SceneStage["items"][number]["kind"],
        icon: icon(it.icon),
        label: str(it.label, 40) || undefined,
        cell,
        span: /^[1-6]x[1-4]$/.test(str(it.span, 3)) ? str(it.span, 3) : undefined,
        color: color(it.color),
        s: sentence(it.s ?? it.sentence, i),
        ...(becomesOf(it.becomes, sentence) ? { becomes: becomesOf(it.becomes, sentence) } : {}),
      };
    })
    .filter((it): it is NonNullable<typeof it> => Boolean(it))
    .slice(0, 12);
  if (!items.length) return null;
  const stage: SceneStage = { kind: "scene", items, arrows: validateArrows(r.arrows, sentence, unique, new Set(items.map((i) => i.id)), vars) };
  return stage;
}

/** A morph is only kept when it changes something and happens on a real sentence. */
/**
 * A program as the model wrote it, made safe to draw: lines keep their indentation (tabs become
 * spaces) and are capped in number and length; every step and trace row lands on a real sentence;
 * a step names real lines. The listing must be real code — at least one line that is not blank.
 */
function validateCode(r: Raw, sentence: (v: unknown, f?: number) => number, unique: (v: unknown, f: string) => string): CodeStage | null {
  const rawLines = Array.isArray(r.lines) ? r.lines : typeof r.code === "string" ? r.code.split("\n") : [];
  const lines = rawLines
    .map((l) => (typeof l === "string" ? l.replace(/\t/g, "    ").replace(/\s+$/, "").slice(0, 72) : ""))
    .slice(0, 18);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.some((l) => l.trim())) return null;
  unique("code", "code");
  lines.forEach((_, i) => unique(`line-${i + 1}`, `line-${i + 1}`));
  const lineNo = (v: unknown) => {
    const n = Math.round(num(v, 0));
    return n >= 1 && n <= lines.length ? n : 0;
  };
  const steps = arr(r.steps)
    .map((st) => obj(st))
    .map((st, i) => {
      const picked = (Array.isArray(st.lines) ? st.lines : [st.lines ?? st.line]).map(lineNo).filter(Boolean);
      if (picked.length === 0) return null;
      const note = str(st.note, 48);
      // What the variables hold after these lines: an object {"count": 1} or a list of {name, value}.
      const rawState = st.state ?? st.vars;
      const stateList = Array.isArray(rawState)
        ? rawState.map((v) => obj(v)).map((v) => ({ name: str(v.name, 14), value: cell(v.value) }))
        : Object.entries(obj(rawState)).map(([name, value]) => ({ name: str(name, 14), value: cell(value) }));
      const state = stateList.filter((v) => v.name && /^[A-Za-z_][\w.\[\]]*$/.test(v.name)).slice(0, 5);
      return { s: sentence(st.s ?? st.sentence, i), lines: [...new Set(picked)].slice(0, 6), ...(note ? { note } : {}), ...(state.length ? { state } : {}) };
    })
    .filter((st): st is NonNullable<typeof st> => Boolean(st))
    .sort((a, b) => a.s - b.s)
    .slice(0, 10);
  const traceRaw = obj(r.trace);
  const vars = arr(traceRaw.vars).map((v) => str(v, 14)).filter(Boolean).slice(0, 4);
  const rows = vars.length
    ? arr(traceRaw.rows)
        .map((row) => obj(row))
        // Values are often numbers or booleans in the model's JSON: each is written as text.
        .map((row, i) => ({ s: sentence(row.s ?? row.sentence, i), values: vars.map((_, k) => cell(arr(row.values)[k])) }))
        .slice(0, 8)
    : [];
  const outputRaw = obj(r.output);
  const outputText = typeof outputRaw.text === "string" ? outputRaw.text.split("\n").slice(0, 4).map((l) => l.slice(0, 48)).join("\n").trim() : "";
  if (rows.length) unique("trace", "trace");
  if (outputText) unique("output", "output");
  const groups = arr(r.groups)
    .map((g) => obj(g))
    .map((g, i) => {
      const from = lineNo(g.from);
      const to = lineNo(g.to ?? g.from);
      const label = str(g.label, 18);
      return from && to && to >= from && label ? { from, to, label, s: sentence(g.s ?? g.sentence, i) } : null;
    })
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
    .filter((g, i, all) => !all.slice(0, i).some((h) => g.from <= h.to && h.from <= g.to))
    .slice(0, 4);
  const edits = arr(r.edits)
    .map((e) => obj(e))
    .map((e) => {
      const line = lineNo(e.line);
      const from = typeof e.from === "string" ? e.from.replace(/\t/g, "    ").replace(/\s+$/, "").slice(0, 72) : "";
      return line && from !== lines[line - 1] ? { s: sentence(e.s ?? e.sentence, 1), line, from } : null;
    })
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .filter((e, i, all) => all.findIndex((x) => x.line === e.line) === i)
    .slice(0, 3);
  if (groups.length) groups.forEach((_, i) => unique(`group-${i + 1}`, `group-${i + 1}`));
  if (steps.some((st) => st.state)) unique("state", "state");
  return {
    kind: "code",
    language: str(r.language, 20).toLowerCase() || "python",
    lines,
    ...(r.reveal === "all" ? { reveal: "all" as const } : {}),
    ...(groups.length ? { groups } : {}),
    ...(edits.length ? { edits } : {}),
    steps: steps.length ? steps : [{ s: 0, lines: [1] }],
    ...(rows.length ? { trace: { vars, rows } } : {}),
    ...(outputText ? { output: { s: sentence(outputRaw.s ?? outputRaw.sentence, 0), text: outputText } } : {}),
  };
}

/** One trace cell as text: a number, boolean or string, capped. */
function cell(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return str(v, 14);
}

function becomesOf(raw: unknown, sentence: (v: unknown, f?: number) => number): { icon?: CanvasIcon; label?: string; s: number } | undefined {
  const b = obj(raw);
  const next = { icon: icon(b.icon), label: str(b.label, 24) || undefined };
  if (!next.icon && !next.label) return undefined;
  return { ...next, s: sentence(b.s ?? b.sentence, 1) };
}

export function validateInteraction(raw: unknown): CanvasInteraction | undefined {
  const r = obj(raw);
  const kind = str(r.kind, 6);
  const prompt = str(r.prompt ?? r.question, 200);
  if (!prompt) return undefined;
  if (kind === "draw") {
    const expect = str(r.expect, 400);
    return expect ? { kind: "draw", prompt, expect } : undefined;
  }
  if (kind === "quiz") {
    const options = arr(r.options)
      .map((o) => obj(o))
      .map((o) => ({ text: str(o.text, 90), correct: o.correct === true, feedback: str(o.feedback, 260) }))
      .filter((o) => o.text && o.feedback)
      .slice(0, 4);
    const right = options.filter((o) => o.correct);
    // The right answer must be right on its own. A model that marks an option correct and then says
    // "none of these is quite right" has written a broken question — refuse it, so the board is redone.
    const selfDoubting = /none of (these|the above)|not quite right|isn'?t (quite )?right|neither is|is (actually )?wrong/i;
    if (right.length !== 1 || selfDoubting.test(right[0].feedback)) return undefined;
    return options.length >= 2 ? { kind: "quiz", question: prompt, options } : undefined;
  }
  if (kind !== "try") return undefined;
  const controls = arr(r.controls)
    .map((c) => obj(c))
    .map((c) => {
      const v = str(c.var, 16).replace(/[^A-Za-z0-9_]/g, "");
      if (!/^[A-Za-z_]/.test(v) || v === "x") return null;
      const min = num(c.min, 0);
      const max = num(c.max, 100);
      if (!(max > min)) return null;
      return { var: v, label: str(c.label, 28) || v, min, max, step: num(c.step, (max - min) / 100), value: Math.max(min, Math.min(max, num(c.value, (min + max) / 2))), unit: str(c.unit, 10) || undefined };
    })
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .slice(0, 2);
  if (!controls.length) return undefined;
  const vars = controls.map((c) => c.var);
  return {
    kind: "try",
    prompt,
    controls,
    reactions: arr(r.reactions)
      .map((x) => obj(x))
      .map((x) => ({ when: str(x.when, 120), say: str(x.say, 220) }))
      .filter((x) => x.say && exprUsesOnly(x.when, vars))
      .slice(0, 6),
    readouts: arr(r.readouts)
      .map((x) => obj(x))
      .map((x) => ({ label: str(x.label, 24), expr: str(x.expr, 120), unit: str(x.unit, 16) || undefined }))
      .filter((x) => x.label && exprUsesOnly(x.expr, vars))
      .slice(0, 2),
  };
}
