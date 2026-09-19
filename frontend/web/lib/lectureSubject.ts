/**
 * What a lecture built from an uploaded document is CALLED.
 *
 * This ordering has regressed twice, both times by adding a better candidate above the generic
 * literal without moving the document's own title above it too:
 *
 *   1. "Selected region" came first, so a dragged crop was always called that and the transcript
 *      was never consulted.
 *   2. The transcript was moved above it — but `documentTitle` stayed below, so the literal still
 *      won for every crop, which is most of them. Dragging a box and asking for a lecture requires
 *      typing nothing, so `pointing && drewRegion` is the normal path, not the edge case.
 *
 * Both times the visible damage was in Lecture History, where every crop-built lecture became an
 * identical "Selected region" card that said nothing about what it was.
 */
export interface LectureSubjectInput {
  /** A title recovered from the crop's OCR text, or "" when it yielded nothing usable. */
  transcriptSubject: string;
  /** True when the student typed nothing meaningful, so the region itself is the request. */
  pointing: boolean;
  /** True when the student dragged a box rather than selecting whole pages. */
  drewRegion: boolean;
  /** What the student actually typed, if anything. */
  focus: string;
  topic: string;
  input: string;
  /** The PDF's metadata title, first heading, or cleaned-up filename. */
  documentTitle: string;
}

export function lectureSubject(args: LectureSubjectInput): string {
  const croppedFrom = args.pointing && args.drewRegion && args.documentTitle
    ? `${args.documentTitle} — selected region`
    : "";
  return (args.pointing ? args.transcriptSubject : "")
    || args.focus
    || args.topic.trim()
    || args.input.trim()
    || croppedFrom
    || args.documentTitle
    || (args.pointing && args.drewRegion ? "Selected region" : "")
    || "this document";
}
