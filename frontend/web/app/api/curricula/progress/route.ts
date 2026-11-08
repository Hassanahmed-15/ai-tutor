import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { curriculumLessons } from "@/lib/db/cosmos";
import { cacheId, type CachedLesson } from "@/lib/curriculum/lessonCache";
import type { CurriculumLessonRequest } from "@/lib/curriculum/lessonSpec";
import { lessonSeriesOn, splitIntoLessons } from "@/lib/series/split";
import { recordSeries } from "@/lib/series/store";

/**
 * A lesson of a course lesson's series was started or finished (lib/series/store.ts), so the student's
 * next visit opens the right one. The lessons are worked out again from the cached plan — the browser
 * says only which lesson and what happened.
 */
export async function POST(req: Request) {
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  if (!lessonSeriesOn()) return NextResponse.json({ ok: false, reason: "series off" });
  const body = (await req.json().catch(() => ({}))) as { request?: CurriculumLessonRequest; part?: unknown; status?: unknown; sessionId?: unknown };
  const r = body.request;
  const part = Number(body.part);
  const status = body.status === "completed" ? "completed" : body.status === "started" ? "started" : null;
  if (!r?.courseId || !Number.isInteger(part) || part < 1 || !status) return NextResponse.json({ error: "request, part and status are required" }, { status: 400 });
  const id = cacheId(r);
  const cached = await curriculumLessons()
    .then((c) => c.item(id, id).read<CachedLesson>())
    .then((x) => x.resource)
    .catch(() => undefined);
  if (!cached?.spec) return NextResponse.json({ error: "Unknown lesson" }, { status: 404 });
  const titles = splitIntoLessons(cached.spec.boards.map((b) => ({ title: b.title, outcomeRefs: b.outcomeRefs }))).map((p) => p.titles);
  if (part > titles.length) return NextResponse.json({ error: "No such lesson" }, { status: 400 });
  const saved = await recordSeries(caller.userId, r, titles, part, status, typeof body.sessionId === "string" ? body.sessionId.slice(0, 80) : undefined);
  return NextResponse.json({ ok: Boolean(saved), completed: saved?.completed ?? [], parts: titles.length });
}
