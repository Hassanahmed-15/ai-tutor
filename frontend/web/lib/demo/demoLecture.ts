import type { Beat } from "@/lib/lessonContent";
import batteryLecture from "./batteryLecture.json";

/**
 * DEMO MODE — a pre-generated, hardcoded lecture ("How a battery works") with real images,
 * animations, and blackboards baked in. When NEXT_PUBLIC_DEMO_HARDCODED === "1", the "Teach me
 * anything" flow ignores whatever topic is typed and instantly returns THIS lecture — so a demo
 * feels like a real, instant generation with zero API cost. Flip the flag off for real use.
 *
 * The JSON was captured from a live /api/generate-lecture run, so its shape already matches Beat.
 */
export const DEMO_HARDCODED = process.env.NEXT_PUBLIC_DEMO_HARDCODED === "1";

const demo = batteryLecture as { topic: string; beats: Beat[] };

export const demoLectureTopic = demo.topic;
export const demoLectureBeats: Beat[] = demo.beats;
