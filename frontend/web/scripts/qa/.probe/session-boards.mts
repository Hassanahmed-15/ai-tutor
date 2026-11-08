// READ-ONLY: each board of a saved lecture — its stage, drawing (lab pencil / 3-D / gpt-image picture / code figure), living flag.
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/qa/.probe/session-boards.mts <sessionId…>
import { progressiveBeats } from "../../../lib/progressiveLectureStore";
for (const id of process.argv.slice(2)) {
  const docs = (await progressiveBeats(id)).sort((a, b) => a.sequence - b.sequence);
  console.log(`\n${id}`);
  for (const d of docs) {
    const sp = (d.beat as any)?.draw?.ops?.[0]?.spec;
    if (!sp) { console.log(`  ${d.sequence + 1}. (${d.state})`); continue; }
    const st = sp.stage;
    const pic = st.kind === "illustration" ? (st.src ? "gpt-image" : "") : st.picture?.src ? "gpt-image beside" : st.figure ? `code figure ${st.figure.component}` : st.kind === "figure" ? `code figure ${st.component}` : "";
    console.log(`  ${d.sequence + 1}. ${st.kind.padEnd(12)} ${(sp.lab ? `lab ${sp.lab.kind}${sp.lab.links ? ` (${sp.lab.links.length} links)` : ""}` : pic || "no drawing").padEnd(26)} living=${sp.living ? "yes" : "no "}  notes=${sp.notes.length}  ${sp.heading}`);
  }
}
