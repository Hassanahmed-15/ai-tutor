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
import { AuthGate, useAuth } from "@/components/auth/AuthGate";
import { VoiceTutor } from "@/components/voice/VoiceTutor";

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

  /**
   * Everything below is behind the auth gate.
   *
   * Wrapping the whole router rather than individual pages keeps one place that decides
   * signed-out / needs-onboarding / ready, which matters because this app routes by component
   * swap rather than by URL — there are no paths for middleware to guard.
   */
  const routed = (() => {
  switch (page) {
    case "demo":
      return <LessonPlayer onExit={exitToComplete} />;
    case "blind-demo":
      return <BlindLessonPlayer onExit={exitToComplete} />;
    case "adhd-demo":
      return <AdhdLessonPlayer onExit={exitToComplete} />;
    case "deaf-demo":
      // Deaf mode uses the Standard player: captions carry every line on-screen.
      return <LessonPlayer onExit={exitToComplete} mode="deaf" />;
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
  })();

  return (
    <AuthGate>
      <VoiceModeSwitch>{routed}</VoiceModeSwitch>
    </AuthGate>
  );
}

/**
 * Sends blind and low-vision profiles to the voice-first tutor instead of the visual app.
 *
 * Inside the gate rather than beside it, because the decision needs the profile the gate has
 * already loaded — and it is a swap of the entire experience, not a variant of it: the voice tutor
 * has no board, no page router and no controls, so it replaces the router rather than rendering
 * within it.
 *
 * "Leave" drops back to the normal UI for the rest of the session. Someone with low vision may want
 * the visual app for a particular task, and their stored profile is unchanged by the detour — the
 * mode returns on the next visit unless they change it in settings.
 */
function VoiceModeSwitch({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const [overridden, setOverridden] = useState(false);
  const voiceFirst = profile?.accessibility === "blind" || profile?.accessibility === "low-vision";

  if (voiceFirst && !overridden) return <VoiceTutor onExit={() => setOverridden(true)} />;
  return <>{children}</>;
}
