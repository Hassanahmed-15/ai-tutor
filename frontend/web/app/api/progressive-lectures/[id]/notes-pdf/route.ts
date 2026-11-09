import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { progressiveBeats, progressiveInput, progressiveSession } from "@/lib/progressiveLectureStore";
import { loadCanvasImage } from "@/lib/canvas/store";
import { plainBlocks } from "@/lib/canvas/blocks";
import type { CanvasBoardSpec } from "@/lib/canvas/types";
import { notesFileName, notesHtml, type NotesPdfAsked, type NotesPdfSection } from "@/lib/notes/notesHtml";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * THE LESSON NOTES AS A PDF (lib/notes/notesHtml.ts): the lecture is read from the student's own saved
 * session; only their questions come from the browser. Where this server has no browser to print
 * with, it answers with the page itself and the student's browser prints it.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to download your notes." }, { status: 401 });
  const { id } = await ctx.params;
  const session = await progressiveSession(caller.userId, id).catch(() => null);
  if (!session) return NextResponse.json({ error: "That lecture was not found." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { asked?: unknown };
  const asked: NotesPdfAsked[] = (Array.isArray(body.asked) ? body.asked : []).slice(0, 60).map((a) => a as NotesPdfAsked).filter((a) => typeof a?.question === "string").map((a) => ({ index: Number(a.index) || 0, question: String(a.question).slice(0, 1000), answer: String(a.answer ?? "").slice(0, 6000) }));

  const docs = (await progressiveBeats(id)).sort((a, b) => a.sequence - b.sequence);
  const sections: NotesPdfSection[] = [];
  for (const doc of docs) {
    const beat = doc.beat;
    const spec = beat?.draw?.ops.find((o) => (o as { kind: string }).kind === "canvasBoard") as { spec?: CanvasBoardSpec } | undefined;
    if (!beat || !spec?.spec) continue;
    const blocks = spec.spec.blocks?.length ? spec.spec.blocks : plainBlocks(beat.id, beat.script);
    let picture: NotesPdfSection["picture"];
    const stage = spec.spec.stage;
    if (stage.kind === "illustration" && stage.src) {
      const name = stage.src.split("/").pop()?.split("?")[0] ?? "";
      const image = name ? await loadCanvasImage(caller.userId, name).catch(() => null) : null;
      if (image) picture = { src: `data:image/jpeg;base64,${image.toString("base64")}`, caption: spec.spec.heading };
    }
    sections.push({ title: spec.spec.heading, blocks, picture });
  }
  if (!sections.length) return NextResponse.json({ error: "These notes are not ready yet." }, { status: 409 });

  const input = await progressiveInput(session).catch(() => null);
  const lesson = (input?.suprnotes as { lesson?: { title?: string; subject?: string; level?: string } } | undefined)?.lesson;
  const title = lesson?.title || session.topic || "Lesson notes";
  const date = new Date().toISOString().slice(0, 10);
  const html = notesHtml({ title, subject: lesson?.subject, level: lesson?.level, date, sections, asked });
  const fileName = notesFileName(title, lesson?.subject, date);

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle", timeout: 40_000 });
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const pdf = await page.pdf({
        format: "A4", printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: "<span></span>",
        footerTemplate: `<div style="font:8px system-ui;color:#777;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
      });
      return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}` } });
    } finally {
      await browser.close();
    }
  } catch (error) {
    console.warn(`[notes-pdf] this server cannot print, the browser will: ${(error as Error).message.slice(0, 120)}`);
    return NextResponse.json({ html, fileName });
  }
}
