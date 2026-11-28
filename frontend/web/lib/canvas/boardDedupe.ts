import type { BoardBlock } from "./blocks";
import type { StageSpec } from "./types";

/**
 * ONE TABLE, DRAWN ONCE (QA 2026-11-28, Economics board 5: "Measures of opportunity cost" was written as a table in
 * the notes column AND drawn as the board's table beside it). When the drawing is a table, a notes-column table with
 * the same rows (the same row names, or the same column heads and as many rows) is not written again: it becomes a
 * pointer to the drawn table, over the SAME sentences, so what Aria says is still written when she says it and the
 * lesson notes keep the full table. Applied where the board is laid out (lib/canvas/layout.ts), so saved boards
 * are fixed too. Pure (lib/anim/boardDedupe.test.ts).
 */

const key = (cell: string) => cell.replace(/\*\*|\$|[`_]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();

/** The table the stage draws, if it draws one: its column heads and each row's cells. */
export function stageTable(stage: StageSpec): { columns: string[]; rows: string[][] } | null {
  if (stage.kind === "figure" && stage.component === "conceptTable") {
    const p = stage.params ?? {};
    const split = (v: unknown, sep: RegExp) => (typeof v === "string" ? v.split(sep).map((c) => c.trim()).filter(Boolean) : []);
    const columns = split(p.columns, /\s*\|\s*/);
    const rowSrc = [p.rows, ...[1, 2, 3, 4, 5, 6].map((i) => p[`row${i}`])].filter((r): r is string => typeof r === "string");
    const rows = rowSrc.flatMap((r) => r.split(/\s*(?:;|\n)\s*/)).filter((r) => r.trim()).map((r) => r.split(/\s*\|\s*/));
    return rows.length ? { columns, rows } : null;
  }
  if (stage.kind === "sketch") {
    const table = stage.items.find((it) => it.type === "table");
    if (table && table.type === "table") return { columns: table.headers, rows: table.rows.map((r) => r.cells) };
  }
  return null;
}

/** Whether a notes-column table says the same as the drawn one. */
export function sameTable(block: { columns?: string[]; rows?: string[][] }, drawn: { columns: string[]; rows: string[][] }): boolean {
  const rows = block.rows ?? [];
  if (rows.length < 2 || !drawn.rows.length) return false;
  const names = new Set(drawn.rows.map((r) => key(r[0] ?? "")).filter(Boolean));
  const shared = rows.filter((r) => names.has(key(r[0] ?? ""))).length;
  if (shared >= 2 && shared >= Math.ceil(rows.length * 0.67)) return true;
  const heads = new Set(drawn.columns.map(key).filter(Boolean));
  const sharedHeads = (block.columns ?? []).filter((c) => heads.has(key(c))).length;
  return sharedHeads >= 2 && rows.length === drawn.rows.length;
}

/** The board's blocks with a table the drawing already shows turned into a pointer to it; the same array when none is. */
export function withoutDrawnTables(blocks: BoardBlock[], stage: StageSpec): BoardBlock[] {
  const drawn = stageTable(stage);
  if (!drawn) return blocks;
  let changed = false;
  const out = blocks.map((b): BoardBlock => {
    if ((b.kind !== "table" && b.kind !== "trace_table") || !sameTable(b, drawn)) return b;
    changed = true;
    const title = b.board_text.includes("|") ? "" : b.board_text.trim();
    const pointer: BoardBlock = { ...b, kind: "visual_ref", board_text: title ? `${title}: see the table` : "See the table" };
    delete pointer.rows;
    delete pointer.columns;
    return pointer;
  });
  return changed ? out : blocks;
}
