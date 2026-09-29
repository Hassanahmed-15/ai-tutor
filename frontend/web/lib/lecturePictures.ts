import { boardPictureMemoryOf } from "./anim/illustratedLayout";

/**
 * WHAT THE LECTURE HAS ALREADY PICTURED — so no two slides show the same picture as if new.
 *
 * The owner's brief (2026-09-29): "make sure it is not producing the same images again and again…
 * if the content is teaching differently from each slide then the picture should be different…
 * it should have memory of what it has taught in that particular lecture", and for a subtopic that
 * spans several slides: "build on one picture in a way it doesn't look repeated — the text written
 * on it should be different at least".
 *
 * So, per lecture:
 *  - a SUBTOPIC (one conceptId, several passes) has ONE picture. The first pass draws it; every
 *    later pass builds on it: zoomed onto a different part, with notes and labels no earlier board
 *    on that picture wrote.
 *  - a NEW subtopic gets a NEW picture, planned knowing every subject already pictured, so it never
 *    draws the same thing again.
 *
 * Boards of one lecture are generated in parallel, so the memory has two halves: this in-process
 * registry (a pass waits for its subtopic's picture while the first pass is still drawing it; plans
 * are made one at a time per lecture, so each sees the ones before it), and what the lecture's
 * saved boards carry in their code (`BOARD_PICTURE`, lib/anim/illustratedLayout.ts), which covers a
 * board drawn by another process or before a restart.
 */

export type LecturePicture = {
  id: string;
  subject: string;
  paper: string;
  conceptId: string;
  title: string;
  parts: Array<{ name: string; x: number; y: number }>;
  /** Every note and label already written on a board built on this picture. */
  written: string[];
  /** Parts a board on this picture has already zoomed onto. */
  focused: string[];
  /** Where the picture has ink (lib/anim/illustratedLayout.ts INK_COLS x INK_ROWS), for callouts. */
  ink?: string;
};

/** What one picture board records about itself, in its code. */
export type BoardPictureMemory = {
  v: 1;
  id: string;
  subject: string;
  paper: string;
  conceptId: string;
  title: string;
  parts: Array<{ name: string; x: number; y: number }>;
  notes: string[];
  labels: string[];
  focus: string | null;
  ink?: string;
};

type LectureState = {
  byConcept: Map<string, Promise<LecturePicture | null>>;
  pictures: LecturePicture[];
  /** Subjects planned but not drawn yet: a parallel plan must not pick them again. */
  planned: string[];
  lock: Promise<unknown>;
  touched: number;
};

const lectures = new Map<string, LectureState>();
const FORGET_AFTER_MS = 3 * 60 * 60 * 1000;

export function lectureState(key: string): LectureState {
  const now = Date.now();
  for (const [k, state] of lectures) if (now - state.touched > FORGET_AFTER_MS) lectures.delete(k);
  let state = lectures.get(key);
  if (!state) {
    state = { byConcept: new Map(), pictures: [], planned: [], lock: Promise.resolve(), touched: now };
    lectures.set(key, state);
  }
  state.touched = now;
  return state;
}

/** Runs `work` alone among this lecture's picture plans, so each plan sees every one before it. */
export function withPlanLock<T>(state: LectureState, work: () => Promise<T>): Promise<T> {
  const run = state.lock.then(work, work);
  state.lock = run.catch(() => undefined);
  return run;
}

/** Adds pictures recovered from saved boards, merging with what the registry already knows. */
export function rememberPictures(state: LectureState, pictures: LecturePicture[]): void {
  for (const picture of pictures) {
    const known = state.pictures.find((p) => p.id === picture.id);
    if (!known) {
      state.pictures.push({ ...picture, written: [...picture.written], focused: [...picture.focused] });
      continue;
    }
    for (const w of picture.written) if (!known.written.includes(w)) known.written.push(w);
    for (const f of picture.focused) if (!known.focused.includes(f)) known.focused.push(f);
  }
}

function isMemory(raw: unknown): raw is BoardPictureMemory {
  const m = raw as Partial<BoardPictureMemory> | null;
  return Boolean(m && m.v === 1 && typeof m.id === "string" && /^[a-f0-9]{32}$/.test(m.id) && typeof m.subject === "string" && typeof m.conceptId === "string" && Array.isArray(m.parts));
}

/** The pictures a lecture's saved boards were built on, merged per picture. */
export function picturesFromBoardCodes(codes: Array<string | null | undefined>): LecturePicture[] {
  const byId = new Map<string, LecturePicture>();
  for (const code of codes) {
    const memory = boardPictureMemoryOf(code);
    if (!isMemory(memory)) continue;
    const picture = byId.get(memory.id) ?? {
      id: memory.id,
      subject: memory.subject,
      paper: typeof memory.paper === "string" ? memory.paper : "#fbfaf7",
      conceptId: memory.conceptId,
      title: typeof memory.title === "string" ? memory.title : "",
      parts: memory.parts.filter((p) => p && typeof p.name === "string" && Number.isFinite(p.x) && Number.isFinite(p.y)),
      written: [],
      focused: [],
      ...(typeof memory.ink === "string" && /^[0-9]+$/.test(memory.ink) ? { ink: memory.ink } : {}),
    };
    for (const w of [...(memory.notes ?? []), ...(memory.labels ?? [])]) if (typeof w === "string" && !picture.written.includes(w)) picture.written.push(w);
    if (typeof memory.focus === "string" && !picture.focused.includes(memory.focus)) picture.focused.push(memory.focus);
    byId.set(memory.id, picture);
  }
  return [...byId.values()];
}

/**
 * The part a board building on a picture zooms onto: the planner's choice when it names a part of
 * the picture; otherwise the first part this slide's narration names that no earlier board zoomed
 * onto; otherwise any part not zoomed onto yet. A later pass never shows the picture exactly as an
 * earlier one did while it has a part left to look at.
 */
export function chooseFocus(picture: LecturePicture, planned: string | null | undefined, sentences: string[]): string | null {
  const byName = (name: string) => picture.parts.find((p) => p.name.toLowerCase() === name.toLowerCase())?.name ?? null;
  const fromPlan = planned ? byName(planned) : null;
  if (fromPlan && !picture.focused.includes(fromPlan)) return fromPlan;
  const said = sentences.join(" ").toLowerCase();
  const fresh = picture.parts.filter((p) => !picture.focused.includes(p.name));
  return fresh.find((p) => said.includes(p.name.toLowerCase()))?.name ?? fromPlan ?? fresh[0]?.name ?? null;
}
