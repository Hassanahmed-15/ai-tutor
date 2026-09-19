import { NextResponse } from "next/server";

import { buildSlideBenchReport } from "@/lib/slidebench/report";
import { readSlideBenchRuns } from "@/lib/slidebench/store";

/**
 * The DOCX download. Dev-only for the same reason as the runner it reports on.
 *
 * Reads from the recorded runs rather than regenerating anything: the report must describe what
 * actually happened, and a report that re-ran the models would cost money and describe a different
 * bench than the one on screen.
 */
export const maxDuration = 120;

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production." }, { status: 404 });
  }
  const runs = readSlideBenchRuns();
  if (!runs.length) {
    return NextResponse.json({ error: "No runs recorded yet — run the bench first." }, { status: 400 });
  }
  const buffer = await buildSlideBenchReport(runs);
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="slide-model-comparison-${stamp}.docx"`,
    },
  });
}
