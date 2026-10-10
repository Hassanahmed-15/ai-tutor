import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import OpenAI from "openai";
import { createCostMeter } from "@/lib/costMeter";
import { isModernModel } from "@/lib/modelPricing";
import {
  GLEAN_SYSTEM_PROMPT,
  NOTES_SYSTEM_PROMPT,
  foldVisualSections,
  gleanUserMessage,
  keepShownData,
  mergeGleaned,
  notesUserMessage,
  parseNotes,
  sanitizeOnScreen,
  sanitizeSegments,
  type NotesRequest,
} from "@/lib/youtube/videoNotes";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * One chapter of the video as its complete set of teaching points (lib/youtube/videoNotes.ts):
 * a first pass that writes them, and a second that is shown the chapter beside the notes and asked
 * only for what is missing.
 *
 * The notes are what the lecture is written from and checked against, so this is the script
 * writer's source, not a draft: it runs on the same model class the lecture text does.
 */
const MODEL = process.env.OPENAI_VIDEO_NOTES_MODEL ?? "gpt-4o";

export async function POST(req: Request) {
  // Reading a video is metered; like building the lecture itself, it needs a signed-in student.
  if (!(await currentUser())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "OPENAI_API_KEY not set." }, { status: 503 });
  const body = await req.json().catch(() => ({}));
  const rawChapter = body.chapter && typeof body.chapter === "object" ? body.chapter as Record<string, unknown> : {};
  const startSec = Math.max(0, Math.floor(Number(rawChapter.startSec) || 0));
  const endSec = Math.floor(Number(rawChapter.endSec) || 0);
  const title = typeof rawChapter.title === "string" ? rawChapter.title.trim().slice(0, 160) : "";
  if (!title || endSec <= startSec) return NextResponse.json({ error: "chapter is required" }, { status: 400 });
  const request: NotesRequest = {
    videoTitle: typeof body.videoTitle === "string" ? body.videoTitle.trim().slice(0, 200) : "",
    chapter: { title, startSec, endSec },
    segments: sanitizeSegments(body.segments, 200),
    onScreen: sanitizeOnScreen(body.onScreen, 200),
  };
  // A chapter of silence with a blank screen teaches nothing; say so rather than ask a model to invent it.
  if (request.segments.length === 0 && request.onScreen.length === 0) {
    return NextResponse.json({ notes: { chapter: request.chapter, sections: [], leftOut: [] }, gleaned: 0, costUsd: 0 });
  }

  const meter = createCostMeter();
  const client = meter.wrap(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
  const ask = async (system: string, user: string): Promise<unknown> => {
    const completion = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      ...(isModernModel(MODEL) ? { max_completion_tokens: 6_000 } : { max_tokens: 6_000, temperature: 0.1 }),
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    });
    return JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  };

  let lastError = "the notes call failed";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const first = parseNotes(await ask(NOTES_SYSTEM_PROMPT, notesUserMessage(request)), request.chapter);
      /*
       * EMPTY NOTES ARE AN ANSWER, NOT A FAILURE. A chapter can teach nothing: the closing minute of
       * a video is often thanks, a preview of the next one and a request to subscribe. The second
       * look below still runs on it — it is shown the chapter beside empty notes and asked what is
       * missing — so a chapter that DID teach something cannot come back empty on one call's say-so.
       */
      // The second look is an improvement, never a requirement: a failure here keeps the first pass.
      let notes = first;
      let gleaned = 0;
      try {
        const merged = mergeGleaned(first, await ask(GLEAN_SYSTEM_PROMPT, gleanUserMessage(request, first.sections)));
        notes = merged.notes;
        gleaned = merged.added;
      } catch (error) {
        console.warn(`[youtube] second look failed for "${title}": ${error instanceof Error ? error.message : error}`);
      }
      // Examples go back beside the ideas they show, and what was shown with data in it is never lost.
      notes = foldVisualSections(notes);
      const shown = keepShownData(notes, request.onScreen);
      notes = shown.notes;
      const points = notes.sections.reduce((n, section) => n + section.points.length, 0);
      // Said in the lecture's own record of what it left out, so an empty chapter is never invisible.
      if (points === 0 && notes.leftOut.length === 0) notes = { ...notes, leftOut: [`"${title}": nothing to teach in this stretch`] };
      console.log(`[youtube] notes "${title}" ${startSec}-${endSec}s: ${points} points (${gleaned} from the second look, ${shown.added} kept from the screen), ${notes.leftOut.length} left out`);
      return NextResponse.json({ notes, gleaned, costUsd: meter.totalUsd });
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  return NextResponse.json({ error: `Couldn't take notes on "${title}": ${lastError}`, costUsd: meter.totalUsd, retryable: true }, { status: 502 });
}
