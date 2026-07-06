"use client";

import { useCallback, useState } from "react";
import { LessonPlayer } from "@/components/LessonPlayer";
import { BlindLessonPlayer } from "@/components/BlindLessonPlayer";
import { AdhdLessonPlayer } from "@/components/AdhdLessonPlayer";
import { DyslexiaLessonPlayer } from "@/components/DyslexiaLessonPlayer";
import type { PageName } from "@/components/hud/HudKit";
import { LandingPage } from "@/components/pages/LandingPage";
import { TracksPage } from "@/components/pages/TracksPage";
import { AboutPage } from "@/components/pages/AboutPage";
import { FeaturesPage } from "@/components/pages/FeaturesPage";
import { CompletePage } from "@/components/pages/CompletePage";
import { LearnPage } from "@/components/pages/LearnPage";

/**
 * Central client-side router. Every page (marketing + the five lesson players) is a named
 * `PageName`; `go()` switches between them and scrolls to top. The lesson players keep their
 * exact existing props and logic — only their `onExit` is pointed at the new completion
 * page. `lastTrack` remembers which mode the player just finished so the completion page can
 * offer a replay.
 */
export default function Home() {
  const [page, setPage] = useState<PageName>("landing");
  const [lastTrack, setLastTrack] = useState<PageName>("demo");

  const go = useCallback((p: PageName) => {
    setPage(p);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, []);

  const startLesson = useCallback((p: PageName) => {
    setLastTrack(p);
    go(p);
  }, [go]);

  // Players exit to the completion page (a real ending screen, vs. the old abrupt stop).
  const exitToComplete = useCallback(() => go("complete"), [go]);

  switch (page) {
    case "demo":
      return <LessonPlayer onExit={exitToComplete} />;
    case "blind-demo":
      return <BlindLessonPlayer onExit={exitToComplete} />;
    case "adhd-demo":
      return <AdhdLessonPlayer onExit={exitToComplete} />;
    case "deaf-demo":
      // Deaf mode uses the Standard player: captions carry every line on-screen.
      return <LessonPlayer onExit={exitToComplete} />;
    case "dyslexia-demo":
      return <DyslexiaLessonPlayer onExit={exitToComplete} />;
    case "learn":
      return <LearnPage go={go} onExit={() => go("complete")} />;
    case "tracks":
      return <TracksPage go={go} onStart={startLesson} />;
    case "about":
      return <AboutPage go={go} onStart={() => go("tracks")} />;
    case "features":
      return <FeaturesPage go={go} onStart={() => go("tracks")} />;
    case "complete":
      return <CompletePage go={go} lastTrack={lastTrack} onReplay={() => startLesson(lastTrack)} />;
    case "landing":
    default:
      return <LandingPage go={go} onStart={() => go("tracks")} />;
  }
}
