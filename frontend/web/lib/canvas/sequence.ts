/**
 * THE MESSAGE SEQUENCE BOARD (TCP lecture, 2026-10-24: "the animations are shit … there was overlapping
 * text"). A handshake drawn as a two-node graph put SYN, SYN-ACK and ACK on one line, over each other.
 * Every networking text draws it as a ladder: the parties as vertical lifelines, each message a downward
 * arrow in time order, its name above it and what it carries below. Code places all of it, so nothing
 * can overlap; each message is drawn on the sentence that sends it.
 */
import type { SequenceStage } from "./types";

type Raw = Record<string, unknown>;
type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

export const SEQUENCE_MAX_LANES = 4;
export const SEQUENCE_MAX_MESSAGES = 8;
// TLS's own names ("CertificateVerify", "EncryptedExtensions") are up to 19 characters: a 16-character cap
// refused the TLS lecture's sequence and it fell back to a crowded sketch (2026-10-24).
const LABEL_MAX = 24;
const DETAIL_MAX = 32;

/** Why the last sequence board was refused, for the writer's next attempt (lib/canvas/generate.ts). */
let lastProblem = "";
export function takeSequenceProblem(): string {
  const p = lastProblem;
  lastProblem = "";
  return p;
}
const refuse = (why: string): null => {
  lastProblem = why;
  return null;
};

const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown, max: number): string => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim() : "").slice(0, max * 2);
const slugOf = (v: unknown, fallback: string): string => (text(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || fallback);

/**
 * A sequence board from the writer's JSON, or null when it is not one: fewer than two parties, a message
 * between parties that are not on the board, or words too long for a label (never cut — the board is
 * written again).
 */
export function validateSequenceStage(r: Raw, sentence: (v: unknown, f?: number) => number, unique: (v: unknown, f: string) => string): SequenceStage | null {
  const lanes: SequenceStage["lanes"] = [];
  for (const [i, raw] of arr(r.lanes ?? r.parties).entries()) {
    const l = obj(raw);
    const label = text(l.label ?? l.name ?? raw, LABEL_MAX);
    if (!label || label.length > LABEL_MAX) return refuse(`a lane needs a name of at most ${LABEL_MAX} characters (got "${label}")`);
    const id = slugOf(l.id ?? label, `lane-${i + 1}`);
    if (lanes.some((x) => x.id === id)) continue;
    lanes.push({ id, label });
  }
  if (lanes.length < 2 || lanes.length > SEQUENCE_MAX_LANES) return refuse(`a sequence has 2 to ${SEQUENCE_MAX_LANES} lanes (got ${lanes.length}): give "lanes" as [{"id", "label"}]`);
  const laneOf = (v: unknown) => {
    const want = slugOf(v, "");
    return lanes.find((l) => l.id === want || slugOf(l.label, "") === want)?.id;
  };
  const messages: SequenceStage["messages"] = [];
  let lastS = 0;
  for (const [i, raw] of arr(r.messages).entries()) {
    const m = obj(raw);
    const from = laneOf(m.from);
    const to = laneOf(m.to);
    const label = text(m.label, LABEL_MAX);
    const detail = text(m.detail ?? m.carries, DETAIL_MAX);
    if (!from || !to || from === to || !label) return refuse(`message ${i + 1} needs "from" and "to" naming two different lane ids (${lanes.map((l) => l.id).join(", ")}) and a "label"`);
    if (label.length > LABEL_MAX || detail.length > DETAIL_MAX) return refuse(`message ${i + 1}'s label is at most ${LABEL_MAX} characters and its detail at most ${DETAIL_MAX} ("${label}", "${detail}"): values, not descriptions`);
    // Time runs down the board: a message is never drawn before the one above it.
    const s = Math.max(lastS, sentence(m.s ?? m.sentence, i));
    lastS = s;
    messages.push({ id: slugOf(m.id ?? `${label}-${i + 1}`, `m${i + 1}`), from, to, label, ...(detail ? { detail } : {}), s, ...(m.lost === true ? { lost: true } : {}) });
  }
  if (!messages.length || messages.length > SEQUENCE_MAX_MESSAGES) return refuse(`a board holds 1 to ${SEQUENCE_MAX_MESSAGES} messages (got ${messages.length}): show the rest on the next board`);
  // Message ids are unique on the board.
  const seen = new Set<string>();
  for (const m of messages) {
    let id = m.id;
    for (let k = 2; seen.has(id); k++) id = `${m.id}-${k}`;
    m.id = id;
    seen.add(id);
  }
  const states: NonNullable<SequenceStage["states"]> = [];
  for (const [i, raw] of arr(r.states).entries()) {
    const st = obj(raw);
    const lane = laneOf(st.lane);
    const label = text(st.label ?? st.state, LABEL_MAX);
    if (!lane || !label || label.length > LABEL_MAX) continue;
    const at = Math.max(-1, Math.min(messages.length - 1, Math.round(Number(st.at ?? st.after ?? -1)) || 0));
    // One state per party per gap: a second would sit on the first.
    if (states.some((x) => x.lane === lane && x.at === at)) continue;
    states.push({ lane, label, at: Number.isFinite(at) ? at : -1, s: sentence(st.s ?? st.sentence, i) });
  }
  unique("sequence", "sequence");
  for (const l of lanes) unique(`lane-${l.id}`, `lane-${l.id}`);
  for (const m of messages) unique(`msg-${m.id}`, `msg-${m.id}`);
  return { kind: "sequence", lanes, messages, ...(states.length ? { states } : {}) };
}

export type SequenceGeometry = {
  lanes: Array<{ id: string; label: string; x: number; head: Rect; size: number; s: number }>;
  lifeline: { top: number; bottom: number };
  messages: Array<{
    id: string; s: number; label: string; detail?: string; lost?: boolean; rightward: boolean;
    p0: Pt; p1: Pt;
    /** Where the label and detail sit (their centre), the angle they are written at (degrees), and their size. */
    labelAt: Pt; detailAt?: Pt; angle: number; labelSize: number; detailSize: number;
    /** The text boxes, unrotated around their centre (for checks). */
    labelW: number; detailW: number;
  }>;
  states: Array<{ lane: string; label: string; s: number; box: Rect; size: number }>;
};

/**
 * Where everything goes. `measure(text, size)` is the text width (lib/canvas/layout.ts textWidth).
 * Rows are spaced so a message's detail (below its arrow) and the next message's label (above its own)
 * never meet, and a state tag sits on its party's lifeline in the gap between two rows.
 */
export function sequenceGeometry(stage: SequenceStage, area: Rect, measure: (t: string, size: number) => number): SequenceGeometry {
  const n = stage.lanes.length;
  const margin = Math.min(150, area.w * (n === 2 ? 0.17 : 0.11));
  const xs = stage.lanes.map((_, i) => area.x + margin + (n === 1 ? 0 : ((area.w - 2 * margin) * i) / (n - 1)));
  const spacing = n > 1 ? xs[1] - xs[0] : area.w;
  const firstS = (laneId: string) => Math.min(...stage.messages.filter((m) => m.from === laneId || m.to === laneId).map((m) => m.s), ...(stage.states ?? []).filter((st) => st.lane === laneId).map((st) => st.s), Infinity);
  const headH = 42;
  const lanes = stage.lanes.map((l, i) => {
    const size = Math.max(13, Math.min(19, ((Math.min(spacing - 16, 200) - 24) / Math.max(1, measure(l.label, 1)))));
    const w = Math.min(Math.max(96, measure(l.label, size) + 28), Math.max(80, spacing - 16));
    const s = firstS(l.id);
    return { id: l.id, label: l.label, x: xs[i], head: { x: xs[i] - w / 2, y: area.y, w, h: headH }, size, s: Number.isFinite(s) ? s : 0 };
  });
  const tagSize = 13;
  const states = stage.states ?? [];
  const tagW = (label: string) => measure(label, tagSize) + 16;
  const m = stage.messages.length;
  const top = area.y + headH + 8;
  const bottom = area.y + area.h - 6;
  const avail = bottom - top;
  const tagGap = 28;
  const plainGap = 10;
  const gaps = Array.from({ length: m + 1 }, (_, k) => (states.some((st) => st.at === k - 1) ? tagGap : plainGap));
  const gapSum = gaps.reduce((a, b) => a + b, 0);
  // The room a row needs around its arrow: the label above and the detail below it, or — when the board
  // is busy — the detail written on the label's line ("SYN  seq=1000"), so rows can be closer.
  let labelSize = 17, detailSize = 14;
  const roomFor = (compact: boolean) => (compact ? labelSize + 12 : labelSize + 10 + detailSize + 12);
  let compact = false;
  let drop = (avail - gapSum) / Math.max(1, m) - roomFor(false);
  if (drop < 22) {
    compact = true;
    drop = (avail - gapSum) / Math.max(1, m) - roomFor(true);
  }
  if (drop < 12) {
    // Still tight: smaller text before a flatter arrow.
    labelSize = 13;
    detailSize = 12;
    drop = (avail - gapSum) / Math.max(1, m) - roomFor(true);
  }
  drop = Math.max(8, Math.min(64, drop));
  const rowH = roomFor(compact) + drop;
  let y = top;
  const tagBoxes: SequenceGeometry["states"] = [];
  const placeTags = (at: number, yTop: number) => {
    for (const st of states.filter((x) => x.at === at)) {
      const lane = lanes.find((l) => l.id === st.lane)!;
      const w = Math.min(tagW(st.label), spacing - 24);
      tagBoxes.push({ lane: st.lane, label: st.label, s: st.s, box: { x: lane.x - w / 2, y: yTop + (tagGap - 22) / 2, w, h: 22 }, size: tagSize });
    }
  };
  const tagHalf = Math.max(0, ...states.map((st) => Math.min(tagW(st.label), spacing - 24) / 2));
  const messages: SequenceGeometry["messages"] = [];
  stage.messages.forEach((msg, i) => {
    placeTags(i - 1, y);
    y += gaps[i];
    const fromIdx = stage.lanes.findIndex((l) => l.id === msg.from);
    const fromX = xs[fromIdx];
    const toX = xs[stage.lanes.findIndex((l) => l.id === msg.to)];
    const rightward = toX > fromX;
    const y0 = y + labelSize + 10;
    const p0 = { x: fromX + (rightward ? 4 : -4), y: y0 };
    const end = { x: toX + (rightward ? -4 : 4), y: y0 + drop };
    const p1 = msg.lost ? { x: p0.x + (end.x - p0.x) * 0.62, y: p0.y + (end.y - p0.y) * 0.62 } : end;
    // The text sits in the first gap between lifelines along the arrow, clear of the state tags on them.
    const nextX = xs[fromIdx + (rightward ? 1 : -1)];
    const midX = (fromX + nextX) / 2;
    const along = (x: number) => ({ x, y: p0.y + ((end.y - p0.y) * (x - p0.x)) / (end.x - p0.x || 1) });
    const angle = (Math.atan2(end.y - p0.y, end.x - p0.x) * 180) / Math.PI;
    const upright = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
    const rad = (upright * Math.PI) / 180;
    // The perpendicular pointing up the board, and the direction along the text.
    const nx = Math.sin(rad), ny = -Math.cos(rad);
    const dx = Math.cos(rad);
    const room = Math.max(60, Math.abs(nextX - fromX) - 2 * (tagHalf + 6)) * 0.92;
    const detail = msg.detail ?? "";
    let ls = labelSize, ds = detailSize;
    const widthNow = () => (compact && detail ? measure(msg.label, ls) + 10 + measure(detail, ds) : Math.max(measure(msg.label, ls), detail ? measure(detail, ds) : 0));
    while (widthNow() > room && ls > 11) { ls -= 0.5; ds = Math.max(10, ds - 0.5); }
    const lw = measure(msg.label, ls);
    const dw = detail ? measure(detail, ds) : 0;
    let labelAt: Pt, detailAt: Pt | undefined;
    if (compact && detail) {
      // One line above the arrow: the name, then what it carries.
      const total = lw + 10 + dw;
      const lc = along(midX - (dx * (total / 2 - lw / 2)) * Math.sign(dx || 1));
      const dc = along(midX + (dx * (total / 2 - dw / 2)) * Math.sign(dx || 1));
      const off = Math.max(ls, ds) * 0.5 + 6;
      labelAt = { x: lc.x + nx * off, y: lc.y + ny * off };
      detailAt = { x: dc.x + nx * off, y: dc.y + ny * off };
    } else {
      const mid = along(midX);
      labelAt = { x: mid.x + nx * (ls * 0.5 + 7), y: mid.y + ny * (ls * 0.5 + 7) };
      detailAt = detail ? { x: mid.x - nx * (ds * 0.5 + 7), y: mid.y - ny * (ds * 0.5 + 7) } : undefined;
    }
    messages.push({
      id: msg.id, s: msg.s, label: msg.label, ...(detail ? { detail } : {}), ...(msg.lost ? { lost: true } : {}), rightward,
      p0, p1, labelAt, ...(detailAt ? { detailAt } : {}), angle: upright, labelSize: ls, detailSize: ds,
      labelW: lw, detailW: dw,
    });
    y += rowH;
  });
  placeTags(m - 1, y);
  y += gaps[m];
  return { lanes, lifeline: { top: area.y + headH, bottom: Math.min(bottom, Math.max(y, area.y + headH + 80)) }, messages, states: tagBoxes };
}

/** The board in words, for the examiner and the checks that read a board (lib/canvas/boardReview.ts). */
export function describeSequence(stage: SequenceStage): string {
  const name = (id: string) => stage.lanes.find((l) => l.id === id)?.label ?? id;
  const msgs = stage.messages.map((m, i) => `${i + 1}. [sentence ${m.s}] ${name(m.from)} → ${name(m.to)}: ${m.label}${m.detail ? ` (${m.detail})` : ""}${m.lost ? " — lost" : ""}`);
  const states = (stage.states ?? []).map((st) => `${name(st.lane)} is ${st.label} ${st.at < 0 ? "at the start" : `after message ${st.at + 1}`} [sentence ${st.s}]`);
  return [`Message sequence between ${stage.lanes.map((l) => l.label).join(", ")}:`, ...msgs, ...(states.length ? [`States: ${states.join("; ")}`] : [])].join("\n");
}

/** What the board writer is told when a board is a message sequence. */
export const SEQUENCE_GUIDE = `SEQUENCE BOARD — the messages passed between parties, drawn the way every networking and systems text draws them: each party a vertical lifeline, each message an arrow down the board in time order. Return "stage": {"kind": "sequence", "lanes": [{"id": "client", "label": "Client"}, {"id": "server", "label": "Server"}], "messages": [{"id": "syn", "from": "client", "to": "server", "label": "SYN", "detail": "seq=1000", "s": 1}, {"id": "synack", "from": "server", "to": "client", "label": "SYN-ACK", "detail": "seq=2000, ack=1001", "s": 2}], "states": [{"lane": "server", "label": "LISTEN", "at": -1, "s": 0}, {"lane": "client", "label": "ESTABLISHED", "at": 2, "s": 3}]}.
- 2 to 4 lanes (party names at most 24 characters), at most 6 messages a board (8 at the very most; a longer exchange continues on the next board), in the order they are sent; code places everything, so give no positions.
- Each message is drawn on the sentence that sends it ("s"): ONE message per sentence, never several at once. "label" is the message's name (at most 24 characters: "SYN", "GET /index", "vote?"); "detail" is what it carries, in values (at most 32 characters: "seq=1000", "ack=2001", "term=3"), never a description.
- "states" (optional) is a party's state from that point on, written on its lifeline: "at" is the index of the message it follows (-1 = before the first). Use the protocol's real state names (LISTEN, SYN-SENT, ESTABLISHED).
- A message that is lost has "lost": true and stops short with a cross.
- Use the lesson's own example and values, the same on every board.`;

/** The board-space box around a centred text written at `angle` degrees (its rotated rectangle's bounds). */
function textBox(at: Pt, w: number, size: number, angle: number): Rect {
  const r = (angle * Math.PI) / 180;
  const h = size * 1.2;
  const bw = Math.abs(w * Math.cos(r)) + Math.abs(h * Math.sin(r));
  const bh = Math.abs(w * Math.sin(r)) + Math.abs(h * Math.cos(r));
  return { x: at.x - bw / 2, y: at.y - bh / 2, w: bw, h: bh };
}

/**
 * What would collide on a sequence board — a label over another label, a state tag or a party's name, or
 * crossed by another arrow — named for a rewrite. Placement is by code, so this guards the squeezed cases
 * (eight messages with long details between four parties).
 */
export function sequenceOverlaps(g: SequenceGeometry): string[] {
  const issues: string[] = [];
  const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const texts: Array<{ what: string; box: Rect; msg?: string }> = [];
  for (const m of g.messages) {
    // Only the text's own extent along the arrow: the bounding box of a slanted label is inflated, so shrink it a little.
    texts.push({ what: `"${m.label}"`, box: textBox(m.labelAt, m.labelW * 0.96, m.labelSize * 0.9, m.angle), msg: m.id });
    if (m.detail && m.detailAt) texts.push({ what: `"${m.detail}"`, box: textBox(m.detailAt, m.detailW * 0.96, m.detailSize * 0.9, m.angle), msg: m.id });
  }
  for (const st of g.states) texts.push({ what: `the state "${st.label}"`, box: st.box });
  for (const l of g.lanes) texts.push({ what: `"${l.label}"`, box: l.head });
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (texts[i].msg && texts[i].msg === texts[j].msg) continue;
      if (hit(texts[i].box, texts[j].box)) issues.push(`${texts[i].what} and ${texts[j].what} overlap — fewer messages on this board, or shorter labels`);
    }
  }
  // A message's text crossed by another message's arrow.
  for (const t of texts) {
    if (!t.msg) continue;
    for (const m of g.messages) {
      if (m.id === t.msg) continue;
      for (let k = 1; k < 20; k++) {
        const p = { x: m.p0.x + ((m.p1.x - m.p0.x) * k) / 20, y: m.p0.y + ((m.p1.y - m.p0.y) * k) / 20 };
        if (p.x > t.box.x + 2 && p.x < t.box.x + t.box.w - 2 && p.y > t.box.y + 2 && p.y < t.box.y + t.box.h - 2) {
          issues.push(`the arrow "${m.label}" runs through ${t.what}`);
          break;
        }
      }
    }
  }
  return [...new Set(issues)];
}
