import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { effectiveMastery } from "@/lib/learnerModel";
import { loadLearnerMemory } from "@/lib/learnerMemoryStore";
import { edgeConfidence } from "@/lib/knowledge/graph";
import { conceptsMatching, edgesTouching } from "@/lib/knowledge/store";
import { ORGANISE_THRESHOLD, organiseMemory, unorganised } from "@/lib/knowledge/organise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The first visit may organise a long history (one model call); later visits are quick.
export const maxDuration = 120;

/**
 * THE STUDENT'S KNOWLEDGE MAP: every concept they have met, with Aria's estimate of how well they
 * know it, their own rating, when it is due for review and where it was taught — plus the links
 * between them from the shared graph, and a few concepts that come NEXT (what their concepts lead
 * to, and prerequisites they have never met), drawn faintly.
 */
export async function GET() {
  const auth = await currentUser();
  if (!auth) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  let memory = await loadLearnerMemory(auth.userId);
  // Older memories (board titles from before the graph) are organised into real concepts the first
  // time there are enough of them — once, then only again as new unorganised ones pile up.
  const before = new Set((await conceptsMatching(Object.keys(memory.concepts)).catch(() => [])).map((c) => c.id));
  if (unorganised(memory, before).length >= ORGANISE_THRESHOLD) {
    await organiseMemory(auth.userId).catch((error) => console.warn(`[knowledge] organising ${auth.userId} failed: ${(error as Error).message}`));
    memory = await loadLearnerMemory(auth.userId);
  }
  const now = Date.now();
  const allKeys = Object.keys(memory.concepts);
  const graphKnown = new Set((await conceptsMatching(allKeys).catch(() => [])).map((c) => c.id));
  // A star is a real concept: one the graph knows or a lecture taught — never an unorganised title.
  const learned = Object.values(memory.concepts).filter((c) => !c.offMap && (graphKnown.has(c.key) || (c.taught?.length ?? 0) > 0));
  const keys = learned.map((c) => c.key);
  const edges = keys.length ? await edgesTouching(keys).catch(() => []) : [];
  const known = new Set(keys);
  // What comes next: concepts linked to theirs that they have not met — prerequisites first.
  const nextKeys = [
    ...edges.filter((e) => e.type === "needs" && known.has(e.from) && !known.has(e.to)).map((e) => e.to),
    ...edges.filter((e) => e.type === "needs" && known.has(e.to) && !known.has(e.from)).map((e) => e.from),
    ...edges.filter((e) => e.type !== "needs").flatMap((e) => [e.from, e.to]).filter((k) => !known.has(k)),
  ];
  const nextSet = [...new Set(nextKeys)].slice(0, 16);
  const graph = await conceptsMatching([...keys, ...nextSet]).catch(() => []);
  const info = new Map(graph.map((g) => [g.id, g]));
  const shown = new Set([...keys, ...nextSet]);

  const nodes = [
    ...learned.map((c) => ({
      key: c.key,
      label: c.label,
      subject: info.get(c.key)?.subject ?? "general",
      summary: info.get(c.key)?.summary ?? "",
      status: "learned" as const,
      mastery: Math.round(effectiveMastery(c, now) * 100) / 100,
      selfRating: c.selfRating ?? null,
      reviewDue: c.reviewDue ?? null,
      due: Boolean(c.reviewDue && Date.parse(c.reviewDue) <= now && (c.taught?.length ?? 0) > 0),
      dueInDays: c.reviewDue ? Math.round((Date.parse(c.reviewDue) - now) / 86_400_000) : null,
      taught: c.taught ?? [],
      lastSeen: c.lastSeen,
    })),
    ...nextSet.filter((k) => info.has(k)).map((k) => ({
      key: k,
      label: info.get(k)!.label,
      subject: info.get(k)!.subject,
      summary: info.get(k)!.summary,
      status: "next" as const,
      mastery: null,
      selfRating: null,
      reviewDue: null,
      due: false,
      dueInDays: null,
      taught: [],
      lastSeen: null,
    })),
  ];
  const links = edges
    .filter((e) => shown.has(e.from) && shown.has(e.to))
    .map((e) => ({ from: e.from, to: e.to, type: e.type, confidence: edgeConfidence(e.support) }));
  return NextResponse.json({ nodes, links }, { headers: { "Cache-Control": "private, no-store" } });
}
