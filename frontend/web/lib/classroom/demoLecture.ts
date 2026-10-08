import type { DrawScript } from "@/components/sketch/LiveSketch";
import type { Beat } from "@/lib/lessonContent";
import heart from "./heartLecture.json";

/**
 * THE CLASSROOM DEMO LECTURE: eight real generated Motion boards on how the heart pumps blood (an
 * anim-lab run, code and narration as the generator wrote them), so the demo exercises the path a
 * real lecture takes — the sandbox, sentence-by-sentence reveals, and the pen writing every label,
 * which is what the teacher's marker hand follows.
 */
export function classroomDemoLecture(): { title: string; beats: Beat[] } {
  return {
    title: heart.title,
    beats: heart.beats.map((b, index) => ({
      id: `heart-${b.id}`,
      conceptId: "heart-circulation",
      conceptObjective: b.title,
      prerequisiteConceptIds: [],
      title: b.title,
      transitionIn: index === 0 ? undefined : `Next: ${b.title.toLowerCase()}.`,
      teacherMove: b.title,
      stepLabel: `${index + 1} · Learn`,
      slideKind: "intro" as const,
      points: [b.title],
      script: b.script,
      draw: {
        caption: b.title,
        durationMs: 30_000,
        surface: "paper",
        ops: [{ kind: "reactAnimation", teachingPoint: b.title, code: b.code, status: "ready" } as DrawScript["ops"][number]],
      },
    })),
  };
}
