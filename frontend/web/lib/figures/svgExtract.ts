import { XMLParser } from "fast-xml-parser";
import type { Pt } from "./types";

/**
 * READ A TEXTBOOK SVG'S LABELS, THEN TAKE THEM OFF (scripts/figures/normalise-library.mts).
 *
 * A labelled diagram from Wikimedia Commons already knows where each part is: the label's leader
 * line ends on it. So each <text> label is read (string + where it sits once every transform is
 * applied), the thin stroke that starts beside it is followed to its far end — that end is the
 * part's ANCHOR — and then the words and the leader are removed from the art, so the board's own
 * label engine (lib/figures/labels.ts) re-draws them in the margins, named as the lesson needs.
 * A label with no leader usually sits ON its part, so its anchor is where it sat (or the nearest
 * drawn shape) — flagged confidence "low" for human review (app/figure-lab).
 *
 * Pure: no DOM, no browser. Geometry is approximate where SVG is hard (glyph widths are estimated
 * from the font size, curve bounding boxes use their control points), which is fine for picking
 * leaders and anchors, and is never used to draw anything.
 */

export type Box = { x: number; y: number; w: number; h: number };
type M = [number, number, number, number, number, number];
type Attrs = Record<string, string>;
export type XNode = { name: string; attrs: Attrs; children: XNode[]; text?: string; cdata?: boolean };

export type ExtractedLabel = {
  id: string;
  name: string;
  /** Where the label stood (root user units). */
  box: Box;
  size: number;
  anchor: Pt | null;
  confidence: "high" | "low";
  /** Distance from the text to the anchor along the leader (0 for "low"). */
  leaderLength: number;
};

export type SvgAnalysis = {
  root: XNode;
  /** The page in root user units (viewBox, or 0 0 width height). */
  page: Box;
  labels: ExtractedLabel[];
  /** Nodes that will not be written out (labels, leaders, hidden layers, metadata, scripts). */
  removed: Set<XNode>;
  stats: { texts: number; leaders: number; paths: number; pathBytes: number; images: number; imageArea: number; hasSwitchText: boolean };
};

/* ── XML in and out ────────────────────────────────────────────────────────────────────────── */

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  commentPropName: "#comment",
  cdataPropName: "#cdata",
  ignoreDeclaration: true,
  ignorePiTags: true,
  allowBooleanAttributes: true,
});

/** Illustrator writes `<!DOCTYPE svg [<!ENTITY ns_svg "http://…">]>` and then uses &ns_svg; in attributes. */
function expandDoctype(src: string): string {
  const doctype = /<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/i.exec(src);
  if (!doctype) return src;
  const entities = new Map<string, string>();
  for (const m of (doctype[1] ?? "").matchAll(/<!ENTITY\s+([\w.-]+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g)) entities.set(m[1], m[2] ?? m[3] ?? "");
  let out = src.slice(0, doctype.index) + src.slice(doctype.index + doctype[0].length);
  if (entities.size) out = out.replace(/&([\w.-]+);/g, (all, name: string) => (entities.has(name) ? entities.get(name)! : all));
  return out;
}

type Raw = Record<string, unknown>;
function toNodes(list: Raw[]): XNode[] {
  const out: XNode[] = [];
  for (const item of list) {
    if ("#text" in item) { out.push({ name: "#text", attrs: {}, children: [], text: String(item["#text"]) }); continue; }
    if ("#comment" in item) continue;
    if ("#cdata" in item) {
      const inner = (item["#cdata"] as Raw[]).map((c) => String(c["#text"] ?? "")).join("");
      out.push({ name: "#text", attrs: {}, children: [], text: inner, cdata: true });
      continue;
    }
    const name = Object.keys(item).find((k) => k !== ":@");
    if (!name) continue;
    const attrs = { ...((item[":@"] as Attrs | undefined) ?? {}) };
    out.push({ name: name.replace(/^svg:/, ""), attrs, children: toNodes((item[name] as Raw[]) ?? []) });
  }
  return out;
}

export function parseSvg(src: string): XNode {
  const nodes = toNodes(parser.parse(expandDoctype(src.replace(/^﻿/, ""))) as Raw[]);
  const root = nodes.find((n) => n.name === "svg");
  if (!root) throw new Error("no <svg> root");
  return root;
}

const escAttr = (v: string) => v.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const escText = (v: string) => v.replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;").replace(/</g, "&lt;");

/* ── sanitising ───────────────────────────────────────────────────────────────────────────── */

/** Elements never written out: active content, editor state, metadata, tooltips. */
const DROP_ELEMENTS = new Set(["script", "metadata", "foreignObject", "title", "desc", "iframe", "audio", "video", "canvas", "handler", "listener", "set", "animate", "animateMotion", "animateTransform", "animateColor", "discard"]);
const KEEP_PREFIXES = new Set(["xlink", "xml"]);

function cleanAttrs(name: string, attrs: Attrs): Attrs {
  const out: Attrs = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (/^on/i.test(k)) continue;
    const prefix = k.includes(":") ? k.split(":")[0] : "";
    if (prefix === "xmlns") { if (k === "xmlns:xlink") out[k] = "http://www.w3.org/1999/xlink"; continue; }
    if (prefix && !KEEP_PREFIXES.has(prefix)) continue;
    if (k === "href" || k === "xlink:href") {
      // Only references inside the file; an embedded picture is dropped with its element (see analyse).
      if (!v.trim().startsWith("#")) continue;
    }
    if (/url\(\s*['"]?(?!#)/i.test(v)) continue;
    if (k === "style") {
      const style = v.split(";").filter((d) => d.trim() && !/url\(\s*['"]?(?!#)/i.test(d) && !/^\s*-inkscape|^\s*behavior|expression\(/i.test(d)).join(";");
      if (style) out[k] = style;
      continue;
    }
    out[k] = v;
  }
  if (name === "svg") {
    out.xmlns = "http://www.w3.org/2000/svg";
    out["xmlns:xlink"] = "http://www.w3.org/1999/xlink";
  }
  return out;
}

function cleanCss(css: string): string {
  return css.replace(/@import[^;]*;?/gi, "").replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, "none").replace(/expression\s*\(/gi, "x(");
}

/** Writes the art back out: sanitised, with `removed` nodes left out and the root sized to `view`. */
export function serializeSvg(a: SvgAnalysis, view: Box = a.page): string {
  const write = (n: XNode, inStyle = false): string => {
    if (n.name === "#text") {
      const t = n.text ?? "";
      if (inStyle) return `<![CDATA[${cleanCss(t).replace(/]]>/g, "")}]]>`;
      return n.cdata ? `<![CDATA[${t.replace(/]]>/g, "")}]]>` : escText(t);
    }
    if (a.removed.has(n) || DROP_ELEMENTS.has(n.name) || n.name.includes(":")) return "";
    // A link is unwrapped: its art is kept, the navigation is not.
    if (n.name === "a") return n.children.map((c) => write(c, inStyle)).join("");
    const attrs = cleanAttrs(n.name, n.attrs);
    if (n === a.root) {
      delete attrs.width; delete attrs.height; delete attrs.x; delete attrs.y; delete attrs.preserveAspectRatio;
      const r = (v: number) => String(Math.round(v * 1000) / 1000);
      attrs.viewBox = `${r(view.x)} ${r(view.y)} ${r(view.w)} ${r(view.h)}`;
      attrs.width = r(view.w);
      attrs.height = r(view.h);
    }
    const head = `<${n.name}${Object.entries(attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("")}`;
    const inner = n.children.map((c) => write(c, n.name === "style")).join("");
    return inner.trim() || n.name === "text" || n.name === "tspan" ? `${head}>${inner}</${n.name}>` : `${head}/>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n${write(a.root)}`;
}

/* ── geometry helpers ─────────────────────────────────────────────────────────────────────── */

const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (m: M, n: M): M => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
const apply = (m: M, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const scaleOf = (m: M) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
const nums = (s: string | undefined): number[] => (s ?? "").match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];

export function parseTransform(t: string | undefined): M {
  let m: M = ID;
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = nums(args);
    let n: M = ID;
    if (fn === "matrix" && a.length >= 6) n = [a[0], a[1], a[2], a[3], a[4], a[5]];
    else if (fn === "translate") n = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (fn === "scale") n = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (fn === "rotate") {
      const r = ((a[0] ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
      n = [c, s, -s, c, 0, 0];
      if (a.length >= 3) n = mul(mul([1, 0, 0, 1, a[1], a[2]], n), [1, 0, 0, 1, -a[1], -a[2]]);
    } else if (fn === "skewX") n = [1, 0, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
    else if (fn === "skewY") n = [1, Math.tan(((a[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
    m = mul(m, n);
  }
  return m;
}

/** A path's subpaths as point lists (segment end points; curve control points kept separately for bounds). */
export function pathPoints(d: string): { subpaths: Array<{ pts: Pt[]; closed: boolean; curved: boolean }>; bounds: Pt[] } {
  const subpaths: Array<{ pts: Pt[]; closed: boolean; curved: boolean }> = [];
  const bounds: Pt[] = [];
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0, cmd = "", cur: Pt = { x: 0, y: 0 }, start: Pt = { x: 0, y: 0 };
  let sp: { pts: Pt[]; closed: boolean; curved: boolean } | null = null;
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[a-zA-Z]$/.test(tokens[i]);
  const push = (p: Pt) => { if (!sp) { sp = { pts: [cur], closed: false, curved: false }; subpaths.push(sp); } sp.pts.push(p); bounds.push(p); cur = p; };
  let guard = 0;
  while (i < tokens.length && guard++ < 200000) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const R = (x: number, y: number): Pt => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    switch (cmd.toLowerCase()) {
      case "m": {
        if (!isNum()) break;
        const p = R(num(), num());
        cur = p; start = p; sp = { pts: [p], closed: false, curved: false }; subpaths.push(sp); bounds.push(p);
        cmd = rel ? "l" : "L";
        break;
      }
      case "l": if (!isNum()) break; push(R(num(), num())); break;
      case "h": if (!isNum()) break; { const v = num(); push({ x: rel ? cur.x + v : v, y: cur.y }); } break;
      case "v": if (!isNum()) break; { const v = num(); push({ x: cur.x, y: rel ? cur.y + v : v }); } break;
      case "c": if (!isNum()) break; { const c1 = R(num(), num()), c2 = R(num(), num()), e = R(num(), num()); bounds.push(c1, c2); push(e); sp!.curved = true; } break;
      case "s": case "q": if (!isNum()) break; { const c1 = R(num(), num()), e = R(num(), num()); bounds.push(c1); push(e); sp!.curved = true; } break;
      case "t": if (!isNum()) break; push(R(num(), num())); sp!.curved = true; break;
      case "a": if (!isNum()) break; { num(); num(); num(); num(); num(); push(R(num(), num())); sp!.curved = true; } break;
      case "z": if (sp) { sp.closed = true; } cur = start; sp = null; break;
      default: i++;
    }
    if (cmd.toLowerCase() === "z") cmd = "";
  }
  return { subpaths, bounds };
}

const bboxOf = (pts: Pt[]): Box | null => {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};
const union = (a: Box, b: Box): Box => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };
export const distToBox = (p: Pt, b: Box) => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), Math.max(b.y - p.y, 0, p.y - (b.y + b.h)));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const centre = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

/* ── styles ───────────────────────────────────────────────────────────────────────────────── */

type Style = Record<string, string>;
const INHERITED = new Set(["fill", "stroke", "stroke-width", "font-size", "font-weight", "text-anchor", "visibility", "fill-opacity", "stroke-opacity", "font-family"]);
const STYLE_PROPS = ["fill", "stroke", "stroke-width", "font-size", "font-weight", "text-anchor", "display", "visibility", "opacity", "fill-opacity", "stroke-opacity", "font-family"];
type Rule = { sel: { tag?: string; id?: string; classes: string[] }; spec: number; order: number; decls: Style };

function parseDecls(s: string): Style {
  const out: Style = {};
  for (const d of s.split(";")) {
    const at = d.indexOf(":");
    if (at < 0) continue;
    const k = d.slice(0, at).trim().toLowerCase(), v = d.slice(at + 1).replace(/!important/i, "").trim();
    if (k && v) out[k] = v;
  }
  return out;
}

function parseCss(css: string): Rule[] {
  // Drop comments and @-blocks (keyframes, media, font-face) by matching their braces.
  let s = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "@") {
      const brace = s.indexOf("{", i), semi = s.indexOf(";", i);
      if (semi >= 0 && (brace < 0 || semi < brace)) { i = semi; continue; }
      if (brace < 0) break;
      let depth = 0, j = brace;
      for (; j < s.length; j++) { if (s[j] === "{") depth++; else if (s[j] === "}" && --depth === 0) break; }
      i = j;
      continue;
    }
    out += s[i];
  }
  s = out;
  const rules: Rule[] = [];
  let order = 0;
  for (const m of s.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = parseDecls(m[2]);
    for (const raw of m[1].split(",")) {
      const sel = raw.trim();
      if (!sel || /[\s>+~:[\]*]/.test(sel)) continue;
      const tag = /^[a-zA-Z][\w-]*/.exec(sel)?.[0];
      const id = /#([\w-]+)/.exec(sel)?.[1];
      const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((c) => c[1]);
      rules.push({ sel: { tag, id, classes }, spec: (id ? 100 : 0) + classes.length * 10 + (tag ? 1 : 0), order: order++, decls });
    }
  }
  return rules.sort((a, b) => a.spec - b.spec || a.order - b.order);
}

function computeStyle(n: XNode, parent: Style, rules: Rule[]): Style {
  const own: Style = {};
  for (const p of STYLE_PROPS) if (n.attrs[p] !== undefined) own[p] = n.attrs[p];
  const classes = (n.attrs.class ?? "").split(/\s+/).filter(Boolean);
  for (const r of rules) {
    if (r.sel.tag && r.sel.tag !== n.name) continue;
    if (r.sel.id && r.sel.id !== n.attrs.id) continue;
    if (!r.sel.classes.every((c) => classes.includes(c))) continue;
    Object.assign(own, r.decls);
  }
  if (n.attrs.style) Object.assign(own, parseDecls(n.attrs.style));
  const out: Style = {};
  for (const [k, v] of Object.entries(parent)) if (INHERITED.has(k)) out[k] = v;
  for (const [k, v] of Object.entries(own)) {
    if (v === "inherit") continue;
    if (k === "font-size") out[k] = String(fontSize(v, Number(parent["font-size"] ?? 16)));
    else out[k] = v;
  }
  return out;
}

function fontSize(v: string, parent: number): number {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return ({ small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32 } as Record<string, number>)[v.trim()] ?? parent;
  if (/em$/.test(v)) return n * parent;
  if (/%$/.test(v)) return (n / 100) * parent;
  if (/pt$/.test(v)) return n * (4 / 3);
  return n;
}

const length = (v: string | undefined, ref = 0): number => {
  if (!v) return 0;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  if (/%$/.test(v)) return (n / 100) * ref;
  if (/pt$/.test(v)) return n * (4 / 3);
  if (/mm$/.test(v)) return n * 3.7795;
  if (/cm$/.test(v)) return n * 37.795;
  if (/in$/.test(v)) return n * 96;
  return n;
};

/* ── text ─────────────────────────────────────────────────────────────────────────────────── */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()] ?? all));

type TextItem = { node: XNode; owner: XNode; text: string; box: Box; size: number; lines: Box[]; glyphs?: XNode[] };

/**
 * A line of words read by OCR from a render of the art (root user units) — for diagrams whose
 * labels were converted to outlines, so there is no <text> to read (scripts/figures/normalise-library.mts).
 */
export type OcrLine = { text: string; box: Box };

const NON_RENDERED = new Set(["defs", "clipPath", "mask", "marker", "pattern", "symbol", "linearGradient", "radialGradient", "filter", "style", "script", "metadata", "title", "desc", "foreignObject", "font", "font-face", "glyph", "cursor", "view"]);

/** Which child of a <switch> renders: the first whose systemLanguage includes English, or has none. */
function switchChoice(n: XNode): XNode | undefined {
  const kids = n.children.filter((c) => c.name !== "#text" && c.name !== "foreignObject" && !c.name.includes(":"));
  return kids.find((c) => !c.attrs.requiredExtensions && (!c.attrs.systemLanguage || /(^|[\s,])en\b/i.test(c.attrs.systemLanguage))) ?? kids.find((c) => !c.attrs.systemLanguage);
}

/* ── analysis ─────────────────────────────────────────────────────────────────────────────── */

type Stroke = { node: XNode; pts: Pt[]; width: number; curved: boolean };
type Shape = { node: XNode; box: Box; filled: boolean; frame?: boolean };

const isNone = (v: string | undefined) => !v || v === "none" || v === "transparent";

export function slugPart(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

/** The words of a label as a part name, or null when it is not one (numbers, single letters, captions). */
export function labelName(raw: string): string | null {
  let t = decodeEntities(raw).replace(/\s+/g, " ").trim();
  t = t.replace(/^[\s\-–—:•*·,.;]+|[\s\-–—:•*·,;]+$/g, "").replace(/\s*\((?:\d+|[a-z])\)$/i, "").trim();
  // Unbalanced brackets left by a line break ("Mitochondrion" / "(mitochondria)") come off.
  const open = (t.match(/\(/g) ?? []).length, close = (t.match(/\)/g) ?? []).length;
  if (close > open) t = t.replace(/^\(/, "").replace(/\)+$/, "").trim();
  else if (open > close) t = t.replace(/\s*\([^)]*$/, "").replace(/^\(/, "").trim();
  if (/^\(.*\)$/.test(t)) t = t.slice(1, -1).trim();
  if (!/[a-zA-ZÀ-ɏ]{3,}/.test(t) && !/^[A-Z]{2}$/.test(t)) return null;
  if (t.length > 48) return null;
  if (t.split(" ").length > 7) return null;
  if (/^(fig(ure)?\.?\s*\d|source:|©|copyright|https?:)/i.test(t)) return null;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function analyseSvg(src: string, opts: { ocr?: OcrLine[] } = {}): SvgAnalysis {
  const root = parseSvg(src);
  const removed = new Set<XNode>();
  const vb = nums(root.attrs.viewBox);
  const page: Box = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? { x: vb[0], y: vb[1], w: vb[2], h: vb[3] } : { x: 0, y: 0, w: length(root.attrs.width) || 800, h: length(root.attrs.height) || 600 };
  const diag = Math.hypot(page.w, page.h);
  const css: string[] = [];
  const collectCss = (n: XNode) => { if (n.name === "style") css.push(n.children.map((c) => c.text ?? "").join("")); n.children.forEach(collectCss); };
  collectCss(root);
  const rules = parseCss(css.join("\n"));

  const texts: TextItem[] = [];
  const strokes: Stroke[] = [];
  const shapes: Shape[] = [];
  const stats = { texts: 0, leaders: 0, paths: 0, pathBytes: 0, images: 0, imageArea: 0, hasSwitchText: false };

  const walk = (n: XNode, ctm: M, style: Style, textOwner?: XNode) => {
    if (n.name === "#text") return;
    if (NON_RENDERED.has(n.name) || n.name.includes(":")) return;
    const st = computeStyle(n, style, rules);
    if (st.display === "none" || (n.attrs.opacity !== undefined && Number(n.attrs.opacity) === 0)) { removed.add(n); return; }
    let m = mul(ctm, parseTransform(n.attrs.transform));
    if (n.name === "svg" && n !== root) m = mul(m, [1, 0, 0, 1, length(n.attrs.x), length(n.attrs.y)]);
    if (n.name === "switch") {
      const pick = switchChoice(n);
      for (const c of n.children) if (c !== pick && c.name !== "#text") removed.add(c);
      if (pick) {
        if (pick.name === "text") stats.hasSwitchText = true;
        walk(pick, m, st, pick.name === "text" && n.children.filter((c) => c.name !== "#text").every((c) => c.name === "text") ? n : undefined);
      }
      return;
    }
    if (n.name === "text") {
      stats.texts++;
      const item = readText(n, m, st, rules);
      if (item) texts.push({ ...item, node: n, owner: textOwner ?? n });
      return;
    }
    if (n.name === "image") {
      stats.images++;
      const box = transformBox(m, { x: length(n.attrs.x), y: length(n.attrs.y), w: length(n.attrs.width), h: length(n.attrs.height) });
      stats.imageArea += box.w * box.h;
      removed.add(n);
      return;
    }
    const stroked = !isNone(st.stroke) && st.visibility !== "hidden";
    const filled = !isNone(st.fill ?? "black") && Number(st["fill-opacity"] ?? 1) > 0.05;
    const sw = (Number.parseFloat(st["stroke-width"] ?? "1") || 1) * scaleOf(m);
    const addStroke = (pts: Pt[], curved: boolean, closed: boolean) => {
      if (stroked && pts.length >= 2 && !closed) strokes.push({ node: n, pts: pts.map((p) => apply(m, p)), width: sw, curved });
    };
    const addShape = (pts: Pt[]) => { const b = bboxOf(pts.map((p) => apply(m, p))); if (b) shapes.push({ node: n, box: b, filled, frame: stroked && (!filled || /^(#fff(fff)?|white)$/i.test((st.fill ?? "").trim())) }); };
    switch (n.name) {
      case "line": {
        const a = { x: length(n.attrs.x1), y: length(n.attrs.y1) }, b = { x: length(n.attrs.x2), y: length(n.attrs.y2) };
        addStroke([a, b], false, false);
        addShape([a, b]);
        break;
      }
      case "polyline": case "polygon": {
        const v = nums(n.attrs.points);
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < v.length; i += 2) pts.push({ x: v[i], y: v[i + 1] });
        if (n.name === "polyline" && (!filled || pts.length <= 3)) addStroke(pts, false, false);
        addShape(pts);
        break;
      }
      case "path": {
        stats.paths++;
        stats.pathBytes += (n.attrs.d ?? "").length;
        const { subpaths, bounds } = pathPoints(n.attrs.d ?? "");
        // A leader is an open stroke; a filled open path is a shape (its fill closes it).
        if (!filled || subpaths.every((s) => s.pts.length <= 3)) for (const s of subpaths) addStroke(s.pts, s.curved, s.closed);
        addShape(bounds);
        break;
      }
      case "rect": {
        const x = length(n.attrs.x), y = length(n.attrs.y), w = length(n.attrs.width), h = length(n.attrs.height);
        addShape([{ x, y }, { x: x + w, y: y + h }]);
        break;
      }
      case "circle": case "ellipse": {
        const cx = length(n.attrs.cx), cy = length(n.attrs.cy), rx = length(n.attrs.r ?? n.attrs.rx), ry = length(n.attrs.r ?? n.attrs.ry);
        addShape([{ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy + ry }]);
        break;
      }
    }
    for (const c of n.children) walk(c, m, st);
  };
  walk(root, ID, { "font-size": "16" });

  // Outlined labels: each OCR line is a label whose "text node" is the glyph shapes inside its box.
  if (opts.ocr?.length) {
    for (const line of opts.ocr) {
      const pad = line.box.h * 0.3;
      const zone = { x: line.box.x - pad, y: line.box.y - pad, w: line.box.w + pad * 2, h: line.box.h + pad * 2 };
      const inside = (b: Box) => b.x >= zone.x && b.y >= zone.y && b.x + b.w <= zone.x + zone.w && b.y + b.h <= zone.y + zone.h;
      const glyphs = [...new Set(shapes.filter((sh) => sh.box.h <= line.box.h * 1.6 && inside(sh.box)).map((sh) => sh.node))];
      if (!glyphs.length) continue;
      texts.push({ node: glyphs[0], owner: glyphs[0], glyphs, text: line.text, box: line.box, size: line.box.h * 1.3, lines: [line.box] });
    }
    stats.texts += texts.length;
  }
  const labels = matchLabels(texts, strokes.filter((st) => !texts.some((t) => t.glyphs?.includes(st.node))), shapes, diag, removed, page);
  stats.leaders = labels.filter((l) => l.confidence === "high").length;
  // A box drawn round a group of labels is empty once they are gone: take it off too.
  const gone = texts.filter((t) => removed.has(t.owner) || t.glyphs?.some((g) => removed.has(g))).map((t) => t.box);
  for (const sh of shapes) {
    // An outline, or a plain filled box (a rect, or a path of at most five corners) behind a heading.
    const boxy = sh.node.name === "rect" || ((sh.node.name === "path" || sh.node.name === "polygon") && pathPoints(sh.node.attrs.d ?? sh.node.attrs.points?.replace(/^/, "M") ?? "").bounds.length <= 5);
    if ((!sh.frame && !boxy) || sh.box.w * sh.box.h > page.w * page.h * 0.08 || !["rect", "path", "polyline", "polygon"].includes(sh.node.name)) continue;
    const holds = gone.filter((b) => b.x >= sh.box.x - 2 && b.y >= sh.box.y - 2 && b.x + b.w <= sh.box.x + sh.box.w + 2 && b.y + b.h <= sh.box.y + sh.box.h + 2);
    const words = holds.reduce((sum, b) => sum + b.w * b.h, 0);
    if (holds.length && words > sh.box.w * sh.box.h * 0.12) removed.add(sh.node);
  }
  return { root, page, labels, removed, stats };
}

function transformBox(m: M, b: Box): Box {
  return bboxOf([apply(m, { x: b.x, y: b.y }), apply(m, { x: b.x + b.w, y: b.y }), apply(m, { x: b.x, y: b.y + b.h }), apply(m, { x: b.x + b.w, y: b.y + b.h })])!;
}

/** A <text>'s words and the box they cover, every line and tspan placed. */
function readText(n: XNode, m: M, st: Style, rules: Rule[]): Omit<TextItem, "node" | "owner"> | null {
  type Chunk = { x: number; y: number; text: string; size: number; anchor: string; weight: string };
  const chunks: Chunk[] = [];
  let pos = { x: nums(n.attrs.x)[0] ?? 0, y: nums(n.attrs.y)[0] ?? 0 };
  pos.x += nums(n.attrs.dx)[0] ?? 0;
  pos.y += nums(n.attrs.dy)[0] ?? 0;
  let open: Chunk | null = null;
  const visit = (node: XNode, s: Style) => {
    for (const c of node.children) {
      if (c.name === "#text") {
        const t = decodeEntities(c.text ?? "");
        if (!t.trim() && !open) continue;
        if (!open) { open = { x: pos.x, y: pos.y, text: "", size: Number(s["font-size"] ?? 16), anchor: s["text-anchor"] ?? "start", weight: s["font-weight"] ?? "" }; chunks.push(open); }
        open.text += t;
        continue;
      }
      if (c.name !== "tspan" && c.name !== "textPath" && c.name !== "a") continue;
      const cs = computeStyle(c, s, rules);
      if (cs.display === "none") continue;
      const x = nums(c.attrs.x)[0], y = nums(c.attrs.y)[0], dx = nums(c.attrs.dx)[0], dy = nums(c.attrs.dy)[0];
      if (x !== undefined || y !== undefined || dx !== undefined || dy !== undefined) {
        // A positioned tspan starts a new chunk (a new line, in Inkscape's multi-line text).
        const advance = open ? estimateWidth(open.text, open.size, open.weight) : 0;
        pos = { x: x ?? (open ? open.x + advance : pos.x), y: y ?? pos.y };
        pos.x += dx ?? 0;
        pos.y += dy ?? 0;
        open = null;
      }
      visit(c, cs);
    }
  };
  visit(n, st);
  const lines: Box[] = [];
  const parts: string[] = [];
  let size = 0;
  for (const c of chunks) {
    const text = c.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const w = estimateWidth(text, c.size, c.weight);
    const x0 = c.x - (c.anchor === "end" ? w : c.anchor === "middle" ? w / 2 : 0);
    lines.push(transformBox(m, { x: x0, y: c.y - c.size * 0.76, w, h: c.size * 0.98 }));
    parts.push(text);
    size = Math.max(size, c.size * scaleOf(m));
  }
  if (!lines.length) return null;
  return { text: parts.join(" ").replace(/-\s+(?=[a-z])/g, "-").replace(/\s+/g, " "), box: lines.reduce(union), size, lines };
}

const estimateWidth = (t: string, size: number, weight: string) => t.length * size * (/bold|[6-9]00/.test(weight) ? 0.6 : 0.54);

/**
 * Pairs each label with its leader. A leader is a thin open stroke with one end beside the words and
 * the other end away from every label; strokes that meet end to end are followed as one leader
 * (an elbowed leader is often drawn as two lines). Its far end is the anchor.
 */
function matchLabels(texts: TextItem[], strokes: Stroke[], shapes: Shape[], diag: number, removed: Set<XNode>, page: Box): ExtractedLabel[] {
  // Words split across <text> elements on one baseline ("Golgi" "apparatus") are one label.
  const items = mergeLines(texts, (a, b) => Math.abs(a.box.y + a.box.h - (b.box.y + b.box.h)) < a.size * 0.3 && b.box.x - (a.box.x + a.box.w) < a.size * 0.45 && b.box.x - (a.box.x + a.box.w) > -a.size * 0.5, "x");
  const maxWidth = Math.max(2.6, diag * 0.004);
  const minLength = diag * 0.012;
  const candidates = strokes.filter((s) => s.width <= maxWidth && s.pts.length <= 8 && dist(s.pts[0], s.pts[s.pts.length - 1]) >= minLength);
  const ends = (s: Stroke) => [s.pts[0], s.pts[s.pts.length - 1]] as const;
  type Hit = { item: number; stroke: Stroke; near: Pt; far: Pt; gap: number };
  const hits: Hit[] = [];
  items.forEach((item, idx) => {
    const reach = item.size * 1.5 + 2;
    for (const s of candidates) {
      const [a, b] = ends(s);
      const da = distToBox(a, item.box), db = distToBox(b, item.box);
      const [near, far, gap, farGap] = da <= db ? [a, b, da, db] : [b, a, db, da];
      // A "V" drawn as one stroke — both ends on parts, the corner beside the words — points at two
      // places from one label: the corner is the near end, the first end the anchor.
      if (s.pts.length >= 3) {
        const inner = s.pts.slice(1, -1).map((p) => ({ p, d: distToBox(p, item.box) })).sort((x, y) => x.d - y.d)[0];
        if (inner.d <= reach && inner.d < gap && farGap >= item.size * 1.5 && gap >= item.size * 1.5) {
          hits.push({ item: idx, stroke: s, near: inner.p, far: a, gap: inner.d });
          continue;
        }
      }
      if (gap > reach || farGap < item.size * 1.5) continue;
      hits.push({ item: idx, stroke: s, near, far, gap });
    }
  });
  hits.sort((a, b) => a.gap - b.gap);
  const usedStroke = new Set<Stroke>();
  const leaderOf = new Map<number, { far: Pt; length: number; strokes: Stroke[] }>();
  const brackets: Array<{ item: number; strokes: Stroke[] }> = [];
  const otherLabelNear = (p: Pt, self: number) => items.some((it, j) => j !== self && distToBox(p, it.box) < it.size * 1.2);
  for (const h of hits) {
    if (usedStroke.has(h.stroke)) continue;
    // Follow strokes joined end to end.
    const chain = [h.stroke];
    let far = h.far, len = dist(h.near, h.far);
    for (let hop = 0; hop < 4; hop++) {
      const next = candidates.find((s) => !usedStroke.has(s) && !chain.includes(s) && ends(s).some((e) => dist(e, far) <= Math.max(1, diag * 0.0015)));
      if (!next) break;
      const [a, b] = ends(next);
      const nf = dist(a, far) < dist(b, far) ? b : a;
      len += dist(far, nf);
      far = nf;
      chain.push(next);
    }
    // A bracket or connector between labels is not a leader to a part.
    if (otherLabelNear(far, h.item)) { brackets.push({ item: h.item, strokes: chain }); continue; }
    if (leaderOf.has(h.item)) {
      // A second leader from the same words (one label, two places): removed from the art, anchor stays the first.
      if (dist(h.near, h.far) > 0) { chain.forEach((s) => usedStroke.add(s)); leaderOf.get(h.item)!.strokes.push(...chain); }
      continue;
    }
    chain.forEach((s) => usedStroke.add(s));
    leaderOf.set(h.item, { far, length: len, strokes: chain });
  }

  // Lines of one label stacked under each other: a line without its own leader joins the label above or below it.
  const stacked = groupStacked(items, leaderOf);

  const out: ExtractedLabel[] = [];
  const seen = new Map<string, ExtractedLabel>();
  const sizes = items.map((i) => i.size).sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 16;
  for (const group of stacked) {
    const lead = group.find((i) => leaderOf.has(i));
    const parts = group.map((i) => items[i]);
    const text = parts.map((p) => p.text).join(" ");
    const name = labelName(text);
    const box = parts.map((p) => p.box).reduce(union);
    const size = Math.max(...parts.map((p) => p.size));
    // Numbers and keys (axis ticks, "A", "1") stay in the art; captions and other words come off
    // (the board's notes and narration say them, in the board's own type).
    if (!name) {
      if (/[a-zA-Z\u00c0-\u024f]{3,}/.test(text)) {
        for (const p of parts) p.nodes.forEach((n) => removed.add(n));
        // Its leader or bracket would point from nowhere once the words are gone.
        for (const i of group) leaderOf.get(i)?.strokes.forEach((s) => removed.add(s.node));
        for (const b of brackets) if (group.includes(b.item)) b.strokes.forEach((s) => removed.add(s.node));
      }
      continue;
    }
    for (const p of parts) p.nodes.forEach((n) => removed.add(n));
    // A bracket drawn from these words to other labels goes with them.
    for (const b of brackets) if (group.includes(b.item)) b.strokes.forEach((s) => removed.add(s.node));
    // A title (much larger than the labels, no leader) is taken off the art but is not a part.
    if (lead === undefined && size >= median * 1.35 && items.length >= 4) continue;
    let anchor: Pt | null = null, confidence: "high" | "low" = "low", leaderLength = 0;
    if (lead !== undefined) {
      const l = leaderOf.get(lead)!;
      anchor = l.far; confidence = "high"; leaderLength = l.length;
      l.strokes.forEach((s) => removed.add(s.node));
    } else {
      // No leader: the words usually sit on their part. Anchor where they sat if a drawn shape is
      // under them, else on the nearest drawn shape close by.
      const c = centre(box);
      // Words without a leader near the edge of the page are a heading over a group of labels
      // ("Chloroplast" above "Thylakoid membrane", "Starch grain"), not a part.
      const band = 0.12;
      const marginal = c.x < page.x + page.w * band || c.x > page.x + page.w * (1 - band) || c.y < page.y + page.h * band || c.y > page.y + page.h * (1 - band);
      const under = shapes.filter((s) => s.filled && s.box.w * s.box.h > box.w * box.h * 0.5 && s.box.w * s.box.h < diag * diag * 0.14 && distToBox(c, s.box) === 0 && !s.node.name.startsWith("text"));
      if (marginal) anchor = null;
      else if (under.length) anchor = c;
      else {
        const radius = size * 3;
        const near = shapes.filter((s) => s.filled && s.box.w > 2 && s.box.h > 2).map((s) => ({ s, d: distToBox(c, s.box) })).filter((x) => x.d <= radius).sort((a, b) => a.d - b.d)[0];
        if (near) anchor = centre(near.s.box);
      }
    }
    const id = slugPart(name);
    if (!id) continue;
    const label: ExtractedLabel = { id, name, box, size, anchor, confidence, leaderLength };
    const prior = seen.get(id);
    if (prior) {
      // One part labelled twice: keep the better (a leader beats none).
      if (prior.confidence === "low" && confidence === "high") { out.splice(out.indexOf(prior), 1, label); seen.set(id, label); }
      continue;
    }
    seen.set(id, label);
    out.push(label);
  }
  return out;
}

type Merged = { text: string; box: Box; size: number; nodes: XNode[] };

function mergeLines(texts: TextItem[], joins: (a: Merged, b: Merged) => boolean, axis: "x"): Merged[] {
  void axis;
  const items: Merged[] = texts.map((t) => ({ text: t.text, box: t.box, size: t.size, nodes: t.glyphs ?? [t.owner] }));
  items.sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
  const out: Merged[] = [];
  for (const it of [...items].sort((a, b) => a.box.x - b.box.x)) {
    const host = out.find((o) => joins(o, it));
    if (host) { host.text = `${host.text} ${it.text}`; host.box = union(host.box, it.box); host.nodes.push(...it.nodes); host.size = Math.max(host.size, it.size); }
    else out.push({ ...it, nodes: [...it.nodes] });
  }
  return out;
}

function groupStacked(items: Merged[], leaderOf: Map<number, unknown>): number[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const order = items.map((_, i) => i).sort((a, b) => items[a].box.y - items[b].box.y);
  const hasLeader = (root: number) => items.some((_, j) => find(j) === root && leaderOf.has(j));
  for (const i of order) {
    for (const j of order) {
      if (i === j || find(i) === find(j)) continue;
      const a = items[i], b = items[j];
      if (b.box.y <= a.box.y) continue;
      const gap = b.box.y - (a.box.y + a.box.h);
      const overlap = Math.min(a.box.x + a.box.w, b.box.x + b.box.w) - Math.max(a.box.x, b.box.x);
      const aligned = Math.abs(a.box.x - b.box.x) < a.size || Math.abs(a.box.x + a.box.w - (b.box.x + b.box.w)) < a.size || Math.abs(centre(a.box).x - centre(b.box).x) < a.size;
      if (gap > Math.min(a.size, b.size) * 0.75 || gap < -a.size * 0.3 || overlap <= 0 || !aligned || Math.abs(a.size - b.size) > a.size * 0.25) continue;
      // Two lines that each have their own leader are two labels.
      if (hasLeader(find(i)) && hasLeader(find(j))) continue;
      // …and two lines are one label only when the words run on ("Rough endoplasmic" / "reticulum",
      // "Loop of" / "Henle", "Cell wall" / "(cellulose)"); a tight column of labels does not.
      if (!/^[a-z(]/.test(b.text.trim()) && !/(-|\b(of|and|the|to|in|with|for|or|de))$/i.test(a.text.trim())) continue;
      parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  for (const i of order) { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); }
  return [...groups.values()];
}
