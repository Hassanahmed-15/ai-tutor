"use client";
/**
 * Demo: the classroom. The real LessonPlayer in classroom mode — the board full size on a classroom
 * wall and Aria as a whole teacher who walks to it and writes where the pen writes — on eight real
 * generated boards. Laptop-class devices.
 */
import { useMemo } from "react";
import { LessonPlayer } from "@/components/LessonPlayer";
import { classroomDemoLecture } from "@/lib/classroom/demoLecture";

export default function ClassroomDemo() {
  const lecture = useMemo(() => classroomDemoLecture(), []);
  return <LessonPlayer key="classroom" classroom beats={lecture.beats} title={lecture.title} autoVoiceAssistant={false} onExit={() => window.history.back()} />;
}
