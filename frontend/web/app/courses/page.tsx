import type { Metadata } from "next";
import { CourseBrowser } from "@/components/courses/CourseBrowser";

export const metadata: Metadata = { title: "Courses · Aria" };

/** The course catalogue: every official syllabus Aria teaches, browsed down to single lessons. */
export default function CoursesPage() {
  return <CourseBrowser />;
}
