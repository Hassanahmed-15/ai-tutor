"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AuthScreen } from "./AuthScreen";
import { OnboardingScreen } from "./OnboardingScreen";
import { SettingsScreen } from "./SettingsScreen";
import type { AccessibilityProfile } from "@/lib/db/cosmos";

export type SessionUser = {
  id: string;
  email: string;
  username: string;
  onboarded: boolean;
  createdAt?: string;
};

export type LearnerProfile = {
  displayName: string | null;
  age: number | null;
  accessibility: AccessibilityProfile | null;
  reducedMotion: boolean | null;
  captions: boolean | null;
  slowerPace: boolean | null;
  simplerLanguage: boolean | null;
  notes: string | null;
} | null;

type AuthValue = {
  user: SessionUser | null;
  profile: LearnerProfile;
  /** Re-reads /api/auth/me. Call after anything that changes the account. */
  refresh: () => Promise<void>;
  openSettings: () => void;
};

const AuthContext = createContext<AuthValue>({
  user: null,
  profile: null,
  refresh: async () => {},
  openSettings: () => {},
});

/**
 * Read the signed-in account and its learning profile from anywhere below the gate.
 *
 * Safe to call when auth is disabled or nobody is signed in — it returns nulls rather than
 * throwing, so a component can personalise when it has data and render normally when it does not.
 */
export function useAuth(): AuthValue {
  return useContext(AuthContext);
}

/**
 * Decides what a visitor sees: sign-in, onboarding, or the app.
 *
 * WHY A GATE RATHER THAN MIDDLEWARE. The app routes by swapping components on a `PageName`, not by
 * URL, so there are no paths for middleware to protect — one component owning the decision is the
 * honest shape for this architecture rather than a redirect scheme bolted onto a single route.
 *
 * SETTINGS LIVE HERE TOO. They are an overlay rather than a page for the same reason: there is no
 * URL to return from, and a student who opens settings mid-lecture must come back to the lecture
 * still running, not to a remounted player. This component already owns the session state settings
 * edits, so putting them anywhere else would mean a second copy of it.
 *
 * DEGRADES OPEN, DELIBERATELY. If no database is configured the gate steps aside and the tutor
 * works exactly as it did before. Auth was added to this product; making its absence break
 * everything would turn one misconfigured env var into a total outage, and the lecture pipeline
 * has no dependency on knowing who you are.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<"loading" | "anon" | "onboarding" | "ready" | "disabled">("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<LearnerProfile>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!data.databaseConfigured) return setState("disabled");
      if (!data.user) return setState("anon");
      setUser(data.user);
      setProfile(data.profile ?? null);
      setState(data.user.onboarded ? "ready" : "onboarding");
    } catch {
      // A network failure must not lock a student out of a lesson they were mid-way through.
      setState("disabled");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  if (state === "loading") {
    return (
      <main className="hud-canvas grid min-h-screen place-items-center">
        <p className="text-sm text-[var(--hud-text-faint)]">Checking your session…</p>
      </main>
    );
  }
  if (state === "anon") return <AuthScreen onAuthenticated={refresh} />;
  if (state === "onboarding") return <OnboardingScreen email={user?.email ?? ""} onDone={refresh} />;

  return (
    <AuthContext.Provider value={{ user, profile, refresh, openSettings }}>
      {children}
      {/* Rendered over the app rather than instead of it: closing settings returns to exactly the
          state that was there, including a lecture still in progress. */}
      {settingsOpen && state === "ready" && (
        <SettingsScreen
          user={user}
          profile={profile}
          onClose={() => setSettingsOpen(false)}
          onSaved={refresh}
        />
      )}
    </AuthContext.Provider>
  );
}
