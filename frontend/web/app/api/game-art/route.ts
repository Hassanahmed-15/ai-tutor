import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import { appPath } from "@/lib/appPaths";
import { currentUser } from "@/lib/auth";
import { databaseConfigured, ensureContainers, users, migrateUserDoc, type UserDoc } from "@/lib/db/cosmos";
import { isAdhdLearner } from "@/lib/adhd/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One backdrop image for a game round, generated from the lesson topic and cached on disk.
 *
 * WHY A BACKDROP AT ALL. The sorter played correctly and looked like nothing — grey rectangles
 * falling through a black void. Almost all of the felt difference between that and a real game is
 * that a real game happens somewhere. One image is the cheapest possible version of "somewhere".
 *
 * ONE PER LESSON, NOT ONE PER BEAT. `lib/imageGen.ts` already spends ~$0.011 per board image, 4-6
 * times a lecture; adding another of those per game round would be a real cost on a pipeline that
 * shows the learner its spend. This is a single image, cached by topic hash, so replaying a lesson
 * or playing several rounds within one costs nothing after the first.
 *
 * FAILURE IS A MISSING PICTURE, NEVER A MISSING GAME. Every error path here returns 200 with
 * `{ url: null }` rather than an error status. The client treats a backdrop as decoration and plays
 * on the vendored sprites regardless — the same discipline `imageGen.ts` uses when a board image
 * fails, and the difference between a game with no picture and a game that will not start.
 */

const MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
const CACHE_DIR = "generated";

/**
 * Ask for a REAL SCENE. The app is what makes it readable.
 *
 * The first prompt asked for "dark, moody, abstract, calm, almost empty through the middle" and the
 * model delivered exactly that: a near-black blue haze with no subject at all, which added nothing
 * to the game and was indistinguishable from no backdrop. The mistake was making the model
 * responsible for legibility.
 *
 * That responsibility belongs to the client, which already owns both levers — the backdrop renders
 * at 0.42 opacity behind a vignette drawn down the play column. So this asks for a picture worth
 * looking at, and the app dims it.
 */
function promptFor(topic: string): string {
  return (
    `A rich illustrated scene about "${topic}", in the style of a polished 2D video game background. ` +
    "Recognisable subject matter relating to the topic, painted with real depth: a clear foreground, " +
    "midground and background, atmospheric light, and colour. Cool palette of deep blues, teals and " +
    "violets with warm accent light. Detail concentrated toward the left, right and lower edges. " +
    "No text, no words, no letters, no numbers, no user interface elements. " +
    "Wide cinematic 3:2 composition."
  );
}

export async function POST(request: Request) {
  // Gated like everything else in this track: the art is only used by the ADHD game mode, and an
  // ungated image endpoint is an ungated way to spend money.
  // `currentUser()` is the session ({ userId, email }); the ADHD flag lives on the profile
  // document, so the gate needs a read — the same two-step the leaderboard route does.
  if (!databaseConfigured()) return NextResponse.json({ url: null, reason: "no-database" });
  await ensureContainers();
  const session = await currentUser();
  if (!session) return NextResponse.json({ url: null, reason: "signed-out" });
  const { resource } = await users().item(session.userId, session.userId).read<UserDoc>();
  const profile = resource ? migrateUserDoc(resource).doc.profile : null;
  if (!isAdhdLearner(profile)) return NextResponse.json({ url: null, reason: "not-adhd" });

  let topic = "";
  try {
    topic = String(((await request.json()) as { topic?: unknown }).topic ?? "").trim();
  } catch {
    return NextResponse.json({ url: null, reason: "bad-body" });
  }
  if (!topic) return NextResponse.json({ url: null, reason: "no-topic" });

  // Hash the topic, not the raw string: it becomes a filename, and a lesson title can contain
  // slashes, quotes and anything else a learner typed.
  const key = createHash("sha256").update(`${MODEL}:${topic.toLowerCase()}`).digest("hex").slice(0, 20);
  const fileName = `game-bg-${key}.png`;
  const dir = appPath("public", CACHE_DIR);
  const file = path.join(dir, fileName);
  const url = `/${CACHE_DIR}/${fileName}`;

  try {
    await readFile(file);
    return NextResponse.json({ url, cached: true });
  } catch {
    // Not cached yet — fall through and generate.
  }

  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ url: null, reason: "no-key" });

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const result = await client.images.generate({
      model: MODEL,
      prompt: promptFor(topic),
      size: "1536x1024",
      quality: "low",
      n: 1,
    });

    const b64 = result.data?.[0]?.b64_json;
    if (!b64) return NextResponse.json({ url: null, reason: "no-image" });

    await mkdir(dir, { recursive: true });
    await writeFile(file, Buffer.from(b64, "base64"));
    return NextResponse.json({ url, cached: false });
  } catch (err) {
    // Content policy, rate limit, network — all the same to the caller: play without a picture.
    return NextResponse.json({ url: null, reason: err instanceof Error ? err.message.slice(0, 120) : "failed" });
  }
}
