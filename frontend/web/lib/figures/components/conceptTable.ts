import type { FigureComponent, FigureParams, FigurePart, Ink } from "../types";
import { PALETTE, bool, clamp } from "./mathsKit";
import { Board, type Rect, clean, measure, partName, wrap } from "./humanitiesKit";

/**
 * CONCEPT TABLE. A true table (up to 5 columns × 6 rows): a styled header row, an optional styled
 * first column, one optional highlighted cell. The code sizes each column to its content (never
 * narrower than its longest word) and wraps every cell inside its borders; a big table steps its
 * font down (to 13 at the smallest) before it would ever overflow.
 */

export type TableData = { columns: string[]; rows: string[][] };

const splitCols = (v: unknown) => {
  const s = typeof v === "string" ? v : "";
  const sep = s.includes("|") ? /\s*\|\s*/ : s.includes(";") ? /\s*;\s*/ : /\s*,\s*/;
  return s.split(sep).map((t) => clean(t, 40)).filter(Boolean);
};

export function tableData(params: FigureParams): TableData {
  let columns = splitCols(params.columns).slice(0, 5);
  // Rows in one "rows" param, or one param per row (row1…row6) when the table is too long for one.
  const perRow = [1, 2, 3, 4, 5, 6].map((i) => params[`row${i}`]).filter((r): r is string => typeof r === "string" && Boolean(r.trim()));
  const rowSrc = typeof params.rows === "string" ? params.rows : "";
  let rows = [...rowSrc.split(/\s*(?:;|\n)\s*/), ...perRow].filter((r) => r.trim()).slice(0, 6).map((r) => r.split(/\s*\|\s*/).map((c) => clean(c, 80)));
  if (!columns.length && !rows.length) {
    columns = ["Perspective", "Scale", "Evidence"];
    rows = [
      ["Personal", "Own experience", "Interviews, diaries"],
      ["Local", "Town or region", "Council reports"],
      ["National", "One country", "Government statistics"],
      ["Global", "Many countries", "UN and NGO data"],
    ];
  }
  const n = clamp(Math.max(columns.length, ...rows.map((r) => r.length), 1), 1, 5);
  columns = Array.from({ length: n }, (_, i) => columns[i] ?? "");
  rows = rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? ""));
  if (!rows.length) rows = [Array.from({ length: n }, () => "")];
  return { columns, rows };
}

/** "r2c3", "2,3", "row 2 col 3" → [bodyRow, column] (1-based); else the first cell containing the text. */
export function highlightCell(v: unknown, data: TableData): [number, number] | null {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  if (!s) return null;
  const m = /^(?:r(?:ow)?\s*)?(\d)\s*(?:,|\s|c(?:ol(?:umn)?)?)\s*(?:c(?:ol(?:umn)?)?\s*)?(\d)$/i.exec(s);
  if (m) {
    const r = Number(m[1]), c = Number(m[2]);
    if (r >= 1 && r <= data.rows.length && c >= 1 && c <= data.columns.length) return [r, c];
    return null;
  }
  const low = s.toLowerCase();
  for (let r = 0; r < data.rows.length; r++) for (let c = 0; c < data.columns.length; c++) if (data.rows[r][c].toLowerCase() === low) return [r + 1, c + 1];
  for (let r = 0; r < data.rows.length; r++) for (let c = 0; c < data.columns.length; c++) if (data.rows[r][c] && data.rows[r][c].toLowerCase().includes(low)) return [r + 1, c + 1];
  return null;
}

export type TableLayout = { size: number; pad: number; lineH: number; colW: number[]; rowH: number[]; cells: string[][][]; x0: number; y0: number };

/** Column widths, wrapped cells and row heights (row 0 is the header). */
export function layoutTable(data: TableData, maxW = 780, maxH = 470): TableLayout {
  const all = [data.columns, ...data.rows];
  const n = data.columns.length;
  let best: TableLayout | null = null;
  for (const size of [17, 16, 15, 14, 13]) {
    const pad = size <= 14 ? 8 : 10, lineH = Math.round(size * 1.28);
    const minW = Array.from({ length: n }, (_, c) => Math.min(maxW / n, Math.max(70, ...all.map((r) => Math.max(0, ...r[c].split(/\s+/).map((w) => measure(w, size)))) ) + 2 * pad + 2));
    const natW = Array.from({ length: n }, (_, c) => Math.max(minW[c], ...all.map((r) => measure(r[c], size) + 2 * pad + 2)));
    let colW: number[];
    const natSum = natW.reduce((a, b) => a + b, 0), minSum = minW.reduce((a, b) => a + b, 0);
    if (natSum <= maxW) colW = natW;
    else if (minSum >= maxW) colW = minW.map((w) => (w * maxW) / minSum);
    else {
      // Share what is left over the minimums in proportion to how much more each column wants.
      const extra = maxW - minSum, want = natW.map((w, c) => w - minW[c]), wantSum = want.reduce((a, b) => a + b, 0) || 1;
      colW = minW.map((w, c) => w + (extra * want[c]) / wantSum);
    }
    const cells = all.map((r, ri) => r.map((t, c) => (t ? wrap(t, ri === 0 ? size : size, colW[c] - 2 * pad - 2, size === 13 ? 4 : Infinity) : [])));
    const rowH = cells.map((r) => Math.max(1, ...r.map((l) => l.length)) * lineH + 2 * pad);
    // A very short table sits in the middle of a figure at least 110 high.
    const lay = { size, pad, lineH, colW, rowH, cells, x0: 4, y0: Math.max(4, (110 - rowH.reduce((a, b) => a + b, 0)) / 2) };
    best = lay;
    if (rowH.reduce((a, b) => a + b, 0) <= maxH) break;
  }
  return best!;
}

const COL_PARTS = Array.from({ length: 5 }, (_, i) => ({ id: `col-${i + 1}`, name: `Column ${i + 1}` }));
const ROW_PARTS = Array.from({ length: 6 }, (_, i) => ({ id: `row-${i + 1}`, name: `Row ${i + 1}` }));

export const conceptTable: FigureComponent = {
  name: "conceptTable",
  title: "Concept table: a real table (up to 5 columns × 6 rows) with a styled header row and first column, cells wrapped to fit, one optional highlighted cell",
  params: `columns (the header row, up to 5, comma-separated, e.g. "Perspective,Scale,Evidence"; use "|" between headers if a header has a comma); rows (up to 6 rows separated by ";", cells within a row separated by "|", e.g. "Personal|Own experience|Interviews; Local|Town or region|Council reports"; keep each cell to a few words; a param holds at most 400 characters, so for a bigger table give row1, row2 … row6 instead, one row each, e.g. row1 "Functionalism|Durkheim|Society as a body"); highlight (optional cell to emphasise: "r2c3" = body row 2, column 3, or a word that appears in the cell); headerColumn (true default: style the first column as row headings; false for a plain grid). Columns are sized to their content and every cell wraps inside its borders.`,
  match: /\bcompar(e|ing|ison) (table|grid|chart)\b|\b(summary|comparison|concept|perspectives?) table\b|\btabulate\b|\bin a table\b|\btable (comparing|showing|summari[sz]ing)\b|\b(local|national|global) perspectives?\b/i,
  parts: [{ id: "header", name: "Header row" }, { id: "first-column", name: "First column" }, { id: "highlight", name: "Highlighted cell" }, ...COL_PARTS, ...ROW_PARTS],
  selfLabelled: true,
  build(params: FigureParams) {
    const data = tableData(params);
    const lay = layoutTable(data);
    const hl = highlightCell(params.highlight, data);
    const styledFirst = bool(params.headerColumn, true) && data.columns.length > 1;
    const { size, pad, lineH, colW, rowH, cells, x0, y0 } = lay;
    const xs = [x0];
    for (const w of colW) xs.push(xs[xs.length - 1] + w);
    const ys = [y0];
    for (const h of rowH) ys.push(ys[ys.length - 1] + h);
    const W = xs[xs.length - 1], H = ys[ys.length - 1];
    const tableBox: Rect = { x: x0, y: y0, w: W - x0, h: H - y0 };
    const BLUE = PALETTE.blue, AMBER = PALETTE.amber, RED = PALETTE.red;

    const b = new Board();
    // Washes: header row, first column, highlighted cell.
    b.path(`M${x0 + 10} ${y0} H${W - 10} A10 10 0 0 1 ${W} ${y0 + 10} V${ys[1]} H${x0} V${y0 + 10} A10 10 0 0 1 ${x0 + 10} ${y0} Z`, { fill: BLUE, stroke: "none", opacity: 0.2, part: "header" });
    if (styledFirst) b.path(`M${x0} ${ys[1]} H${xs[1]} V${H - 10} V${H} H${x0 + 10} A10 10 0 0 1 ${x0} ${H - 10} Z`, { fill: AMBER, stroke: "none", opacity: 0.13, part: "first-column" });
    // Inner rules, then the border (the header rule a little heavier).
    for (let c = 1; c < xs.length - 1; c++) b.line([{ x: xs[c], y: y0 }, { x: xs[c], y: H }], { stroke: "ink", width: 1.2, opacity: 0.45, part: `col-${c + 1}` });
    for (let r = 2; r < ys.length - 1; r++) b.line([{ x: x0, y: ys[r] }, { x: W, y: ys[r] }], { stroke: "ink", width: 1.2, opacity: 0.45, part: `row-${r}` });
    b.line([{ x: x0, y: ys[1] }, { x: W, y: ys[1] }], { stroke: "ink", width: 2.2, part: "header" });
    b.rect(tableBox, 10, { fill: "none", stroke: "ink", width: 2.2 });
    if (hl) {
      const [r, c] = hl;
      const cell: Rect = { x: xs[c - 1] + 2, y: ys[r] + 2, w: colW[c - 1] - 4, h: rowH[r] - 4 };
      b.rect(cell, 4, { fill: RED, stroke: "none", opacity: 0.14, part: "highlight" });
      b.rect(cell, 4, { fill: "none", stroke: RED, width: 3, part: "highlight" });
    }
    // Text: each cell's lines centred vertically in its row, left-aligned inside its padding.
    cells.forEach((row, r) => row.forEach((lines, c) => {
      if (!lines.length) return;
      const top = ys[r] + (rowH[r] - lines.length * lineH) / 2 + (lineH - size) / 2 - 1;
      const isHl = hl && hl[0] === r && hl[1] === c + 1;
      const part = r === 0 ? "header" : isHl ? "highlight" : c === 0 && styledFirst ? "first-column" : `col-${c + 1}`;
      const fill: Ink = r === 0 ? BLUE : isHl ? RED : c === 0 && styledFirst ? AMBER : "ink";
      b.lines(lines, xs[c] + pad + 1, top, size, { anchor: "start", fill: r === 0 || (c === 0 && styledFirst) || isHl ? fill : "ink", part, lineH });
    }));
    // Every column and body row as a (thin) shape of its own, so each part exists for the pen.
    for (let c = 0; c < colW.length; c++) b.line([{ x: xs[c] + 3, y: y0 + 2 }, { x: xs[c + 1] - 3, y: y0 + 2 }], { stroke: "none", width: 0, part: `col-${c + 1}` });
    for (let r = 1; r < rowH.length; r++) b.line([{ x: W - 2, y: ys[r] + 3 }, { x: W - 2, y: ys[r + 1] - 3 }], { stroke: "none", width: 0, part: `row-${r}` });

    const parts: FigurePart[] = [
      { id: "header", name: "Header row", anchor: { x: x0 + 3, y: (ys[0] + ys[1]) / 2 } },
    ];
    if (styledFirst) parts.push({ id: "first-column", name: partName(data.columns[0] || "First column", "First column"), anchor: { x: x0 + colW[0] / 2, y: H - 3 } });
    if (hl) parts.push({ id: "highlight", name: partName(data.rows[hl[0] - 1][hl[1] - 1], "Highlighted cell"), anchor: { x: xs[hl[1] - 1] + colW[hl[1] - 1] / 2, y: ys[hl[0] + 1] - 4 } });
    colW.forEach((w, c) => parts.push({ id: `col-${c + 1}`, name: partName(data.columns[c], `Column ${c + 1}`), anchor: { x: xs[c] + w / 2, y: y0 + 3 } }));
    data.rows.forEach((row, r) => parts.push({ id: `row-${r + 1}`, name: partName(row[0], `Row ${r + 1}`), anchor: { x: W - 3, y: (ys[r + 1] + ys[r + 2]) / 2 } }));
    return { w: Math.ceil(W + 4), h: Math.ceil(H + y0), shapes: b.shapes, parts };
  },
};
