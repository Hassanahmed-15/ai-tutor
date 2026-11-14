"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PastPaperPractice } from "@/components/courses/PastPaperPractice";

/** /past-papers-lab?courseId=…&grade=…&unitId=…&topicId=…&lessonId=…&part=1 — the practice screen alone (dev only). */
function Lab() {
  const q = useSearchParams();
  const [done, setDone] = useState(false);
  if (done) return <p data-lab-done="" className="p-10">Done — the test screen would open now.</p>;
  return (
    <PastPaperPractice
      request={{ courseId: q.get("courseId") ?? "", grade: q.get("grade") ?? "", unitId: q.get("unitId") ?? "", topicId: q.get("topicId") ?? "", lessonId: q.get("lessonId") ?? "" }}
      part={Number(q.get("part")) || 1}
      onDone={() => setDone(true)}
    />
  );
}

export default function PastPapersLab() {
  return <Suspense><Lab /></Suspense>;
}
