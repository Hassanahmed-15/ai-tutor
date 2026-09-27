"use client";
/**
 * Dev-only preview of the silent build screen.
 *
 * Timestamps are fixed offsets from a value captured once on the client, never at module scope:
 * a clock read while the module evaluates differs between the server's HTML and the client's
 * first paint, and React discards the tree with a hydration error.
 */
import { useEffect, useState } from "react";
import { LessonBuildScreen } from "@/components/design/LessonBuildScreen";

export default function Preview() {
  const [t0, setT0] = useState<number | null>(null);
  useEffect(() => setT0(Date.now()), []);
  if (t0 === null) return null;

  const iso = (msAgo: number) => new Date(t0 - msAgo).toISOString();
  const beats = [
    { sequence: 0, title: "What a transducer actually is", state: "ready", timing: { textStartedAt: iso(90_000), readyAt: iso(60_000) } },
    { sequence: 1, title: "Energy in, energy out", state: "ready", timing: { textStartedAt: iso(60_000), readyAt: iso(38_000) } },
    { sequence: 2, title: "How a microphone converts pressure to voltage", state: "generating", timing: { textStartedAt: iso(12_000) } },
    { sequence: 3, title: "Sensors versus actuators", state: "planned" },
    { sequence: 4, title: "Where transducers show up in daily life", state: "planned" },
  ];

  return (
    <LessonBuildScreen
      topic="Transducer"
      progress={{ stage: "visuals", stageFraction: 0.4, detail: "2 of 5 sections ready", status: "Building", elapsedMs: 92_000 }}
      ready={false}
      beatStatus={beats as never}
      buildStartedAt={iso(92_000)}
      onStop={() => {}}
      onStart={() => {}}
    />
  );
}
