import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { effectiveMastery } from "@/lib/learnerModel";
import { loadLearnerMemory } from "@/lib/learnerMemoryStore";
import { progressiveSession } from "@/lib/progressiveLectureStore";
import { conceptStatus, shakyPrerequisites } from "@/lib/knowledge/graph";
import { conceptsMatching, edgesTouching, loadLectureKnowledge } from "@/lib/knowledge/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE LECTURE THROUGH THIS STUDENT'S KNOWLEDGE (lib/knowledge): for each board, which drawn element
 * is which concept, and for each concept whether the student already knew it before this lecture,
 * where they learned it, and which prerequisites of it they are shaky on. The player marks the
 * boards with it; nothing here changes the lecture itself.
 *
 * GET ?session=<id>. 204 while the lecture's knowledge record is still being made.
 */
export async function GET(request: Request) {
  const auth = await currentUser();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const id = new URL(request.url).searchParams.get("session") ?? "";
  if (!/^[a-f0-9-]{36}$/.test(id)) return NextResponse.json({ error: "Invalid lecture id." }, { status: 400 });
  const [doc, session, memory] = await Promise.all([loadLectureKnowledge(id, auth.userId), progressiveSession(auth.userId, id), loadLearnerMemory(auth.userId)]);
  if (!doc) return new NextResponse(null, { status: 204 });
  const startedAt = Date.parse(session?.createdAt ?? doc.createdAt);
  const now = Date.now();
  const keys = doc.concepts.map((c) => c.key);
  const edges = await edgesTouching(keys).catch(() => []);
  const mastery = (key: string) => {
    const c = memory.concepts[key];
    return c ? effectiveMastery(c, now) : undefined;
  };
  const gapKeys = [...new Set(edges.filter((e) => e.type === "needs" && keys.includes(e.from)).map((e) => e.to))];
  const gapConcepts = await conceptsMatching(gapKeys).catch(() => []);
  const labelOf = (key: string) => doc.concepts.find((c) => c.key === key)?.label ?? gapConcepts.find((c) => c.id === key)?.label ?? memory.concepts[key]?.label ?? key;

  const taughtHere = new Set(doc.beats.flatMap((b) => [...b.concepts, ...Object.values(b.elements)]));
  const concepts = Object.fromEntries(doc.concepts.map((c) => {
    const m = memory.concepts[c.key];
    const firstSeen = Date.parse(m?.firstSeen ?? m?.evidence[0]?.at ?? m?.lastSeen ?? "");
    const before = Number.isFinite(firstSeen) && firstSeen < startedAt;
    const status = conceptStatus(mastery(c.key), before);
    const earlier = (m?.taught ?? []).filter((t) => t.lectureId !== id).at(-1);
    // A prerequisite this lecture itself teaches is not a gap — the student is about to learn it.
    const gaps = shakyPrerequisites([c.key], edges, mastery, 4).filter((g) => !taughtHere.has(g.key)).slice(0, 2).map((g) => ({ key: g.key, label: labelOf(g.key), mastery: g.mastery ?? null }));
    return [c.key, {
      label: c.label,
      status,
      mastery: mastery(c.key) ?? null,
      ...(status !== "new" && earlier ? { from: { lectureId: earlier.lectureId, sequence: earlier.sequence, beatId: earlier.beatId, title: earlier.title, topic: earlier.topic } } : {}),
      ...(gaps.length ? { gaps } : {}),
    }];
  }));
  return NextResponse.json({ beats: doc.beats, concepts }, { headers: { "Cache-Control": "private, no-store" } });
}
