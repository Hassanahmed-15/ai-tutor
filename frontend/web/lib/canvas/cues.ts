import type { CanvasCue } from "./types";

/** The cue the pen is showing now, and the element the camera is zoomed on (if any). */
export function activeCues(cues: CanvasCue[], sentence: number, progress: number, done: boolean): { pen?: CanvasCue; zoom?: string; visit?: string } {
  if (done) return {};
  const passed = [...cues].sort((a, b) => a.s - b.s || (a.at ?? 0) - (b.at ?? 0)).filter((c) => c.s < sentence || (c.s === sentence && (c.at ?? 0) <= progress));
  const pen = [...passed].reverse().find((c) => c.action === "point" || c.action === "circle" || c.action === "underline");
  const cam = [...passed].reverse().find((c) => c.action === "zoom" || c.action === "unzoom" || c.action === "visit");
  return {
    // The pen stays on its last target through the next sentence, then lifts.
    pen: pen && pen.s >= sentence - 1 ? pen : undefined,
    // A zoom holds for its own sentence and the next, then the camera pulls back on its own — a
    // forgotten "unzoom" must not keep the rest of the board out of view.
    zoom: cam?.action === "zoom" && cam.s >= sentence - 1 ? cam.target : undefined,
    // A visit to an earlier board lasts for the sentence that recalls it.
    visit: cam?.action === "visit" && cam.s === sentence ? cam.beat : undefined,
  };
}
