/**
 * WHAT ARIA IS POINTING AT. The board that knows what the narration is about (the lesson canvas's
 * pen cue) publishes the element it is pointing at; Dot (components/avatar/BoardAvatar.tsx) reads it
 * to fly beside it. The element is measured by the reader on every frame, because the canvas camera
 * moves under it. A tiny bus rather than props: the two live far apart in LessonPlayer's tree.
 */
export type PointAction = "point" | "circle" | "underline";
export type PointTarget = { el: Element; action: PointAction; key: string };

let current: PointTarget | null = null;
const listeners = new Set<(t: PointTarget | null) => void>();

export function setPointTarget(target: PointTarget | null): void {
  if (current?.key === target?.key && current?.el === target?.el) return;
  current = target;
  for (const fn of listeners) fn(current);
}

export function pointTarget(): PointTarget | null {
  return current && current.el.isConnected ? current : null;
}

export function onPointTarget(fn: (t: PointTarget | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Is Dot standing in for the pen? When she is, the board draws the ring / highlighter swipe / tap
 * but not the pen body, which used to sit on top of what it pointed at.
 */
let dotPoints = false;
const pointerListeners = new Set<() => void>();
export function setDotPointer(on: boolean): void {
  if (dotPoints === on) return;
  dotPoints = on;
  for (const fn of pointerListeners) fn();
}
export function dotPointer(): boolean {
  return dotPoints;
}
export function onDotPointer(fn: () => void): () => void {
  pointerListeners.add(fn);
  return () => pointerListeners.delete(fn);
}
