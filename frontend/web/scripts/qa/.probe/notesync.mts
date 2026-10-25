// Picture-board sync from a sync-check run's saved timings (free): does the board show each sentence's note and
// pointer as her voice starts that sentence? node --import tsx scripts/qa/.probe/notesync.mts <session8> [speeds]
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
const [id, speedsArg] = process.argv.slice(2);
const dir = `${homedir()}/aria-qa-images/${new Date().toISOString().slice(0, 10)}-sync`;
for (const speed of (speedsArg ?? "0.5,0.75,1,1.25,1.5,2").split(",")) {
  const file = `${dir}/${id}-${speed}x.json`;
  if (!existsSync(file)) { console.log(`${speed}x: not played yet`); continue; }
  const { sync, sizes } = JSON.parse(readFileSync(file, "utf8")) as { sync: Array<Record<string, any>>; sizes: Array<[number, string]> };
  const sizeText = new Map(sizes);
  const cues = sync.filter((e) => e.ev === "trace" && String(e.msg).startsWith("[playback] sentence ")).map((e) => ({ t: e.t as number, ...JSON.parse(String(e.msg).slice("[playback] sentence ".length)) }));
  const clips: Array<{ text: string; start: number; end: number }> = [];
  let open: { text: string; start: number; end: number } | null = null;
  for (const e of sync) {
    if (e.ev === "audio-playing") { const text = sizeText.get(e.size) ?? ""; if (!open || open.text !== text) { open = { text, start: e.t, end: Infinity }; clips.push(open); } }
    if (e.ev === "audio-ended" && open) { open.end = e.t; open = null; }
  }
  let n = 0, ok = 0; const off: number[] = []; const worst: string[] = [];
  for (const c of clips) {
    const cue = cues.filter((q) => q.narration >= q.bridge && c.text.startsWith(String(q.text).slice(0, 40))).sort((a, b) => Math.abs(a.t - c.start) - Math.abs(b.t - c.start))[0];
    if (!cue) continue;
    n++;
    // The board's step for the sentence (its note, its pointer) against the moment her voice starts it.
    const d = (cue.t - c.start) / 1000;
    off.push(d);
    if (d >= -0.3 && d <= 0.6) ok++;
    else worst.push(`board ${cue.beat + 1} s${cue.board}: board ${d < 0 ? `${(-d).toFixed(1)} s BEFORE` : `${d.toFixed(1)} s AFTER`} her voice — "${c.text.slice(0, 45)}"`);
  }
  const ends = clips.filter((c) => Number.isFinite(c.end));
  console.log(`${speed.padStart(4)}x  board on her voice ${ok}/${n}  (step vs voice: min ${Math.min(...off).toFixed(2)} s, max ${Math.max(...off).toFixed(2)} s)  sentences heard ${ends.length}${worst.length ? `\n      ${worst.slice(0, 3).join("\n      ")}` : ""}`);
}
