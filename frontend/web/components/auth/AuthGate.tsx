"use client";

import { useCallback, useEffect, useState } from "react";
import { AuthScreen } from "./AuthScreen";
import { OnboardingScreen } from "./OnboardingScreen";

export type SessionUser = { id: string; email: string; onboarded: boolean };
export type LearnerProfile = {
  displayName: string | null;
  age: number | null;
  vision: string | null;
  adhd: boolean | null;
  dyslexia: boolean | null;
  hearing: boolean | null;
  reducedMotion: boolean | null;
  captions: boolean | null;
  slowerPace: boolean | null;
  simplerLanguage: boolean | null;
} | null;

/**
 * Decides what a visitor sees: sign-in, onboarding, or the app.
 *
 * WHY A GATE RATHER THAN MIDDLEWARE. The app routes by swapping components on a `PageName`, not by
 * URL, so there are no paths for middleware to protect — one component owning the decision is the
 * honest shape for this architecture rather than a redirect scheme bolted onto a single route.
 *
 * DEGRADES OPEN, DELIBERATELY. If no database is configured the gate steps aside and the tutor
 * works exactly as it did before. Auth was added to this product; making its absence break
 * everything would turn one misconfigured env var into a total outage, and the lecture pipeline
 * has no dependency on knowing who you are.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "anon" | "onboarding" | "ready" | "disabled">("loading");
  const [user, setUser] = useState<SessionUser | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!data.databaseConfigured) return setState("disabled");
      if (!data.user) return setState("anon");
      setUser(data.user);
      setState(data.user.onboarded ? "ready" : "onboarding");
    } catch {
      // A network failure must not lock a student out of a lesson they were mid-way through.
      setState("disabled");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === "loading") {
    return (
      <main className="hud-canvas grid min-h-screen place-items-center">
        <p className="text-sm text-[var(--hud-text-faint)]">Checking your session…</p>
      </main>
    );
  }
  if (state === "anon") return <AuthScreen onAuthenticated={refresh} />;
  if (state === "onboarding") return <OnboardingScreen email={user?.email ?? ""} onDone={refresh} />;
  return <>{children}</>;
}
