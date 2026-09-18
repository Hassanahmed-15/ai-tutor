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
  /**
   * "disabled" and "unavailable" both render the app with no account chrome, and they are separate
   * on purpose. "disabled" means the deployment genuinely has no database and never had accounts.
   * "unavailable" means it should have them and the endpoint is not answering — which used to be
   * indistinguishable from the first, so a broken backend presented itself as a deliberately
   * auth-free build. Same pixels, different truth; only the second says anything.
   */
  const [state, setState] = useState<"loading" | "anon" | "onboarding" | "ready" | "disabled" | "unavailable">("loading");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [profile, setProfile] = useState<LearnerProfile>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const refresh = useCallback(async () => {
    /*
     * A CEILING ON THE BOOT SCREEN.
     *
     * There was no timeout here, and this gate renders instead of the entire app — so a request
     * that never settled (Cosmos cold start, a hung proxy) left the student on the loading screen
     * indefinitely with no way forward. Eight seconds is well past a healthy response and well
     * short of the point where a person assumes the product is broken.
     *
     * The abort lands in the existing catch, which sets "unavailable" — a state that deliberately
     * degrades OPEN and renders the app. Timing out therefore shows the lesson, not an error page.
     */
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store", signal: controller.signal });
      /*
       * `res.ok` FIRST. Without it a 404 HTML page fails .json(), the catch yields {}, and {} reads
       * as `databaseConfigured: false` — so every auth control vanished silently and the app looked
       * like it had been built without accounts. That is exactly what happened when a stale route
       * cache 404'd every API endpoint: nothing on screen said anything was wrong.
       */
      if (!res.ok) return setState("unavailable");
      const data = await res.json().catch(() => null);
      if (!data) return setState("unavailable");
      // Only an explicit answer from a healthy endpoint counts as "this deployment has no accounts".
      if (!data.databaseConfigured) return setState("disabled");
      if (!data.user) return setState("anon");
      setUser(data.user);
      setProfile(data.profile ?? null);
      setState(data.user.onboarded ? "ready" : "onboarding");
    } catch {
      // Still degrades open — a network failure must not lock a student out of a lesson they were
      // mid-way through — but it is reported now rather than mimicking a no-database deployment.
      setState("unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);

  if (state === "loading") {
    /*
     * THE APP'S FIRST IMPRESSION, and it was one line of faint grey text.
     *
     * AuthGate wraps everything, so until /api/auth/me answers, this IS the product — no logo, no
     * motion, nothing to say the app is alive rather than broken. On a Cosmos cold start that can
     * last seconds, and it also had no timeout: a request that never returned left the entire app
     * on this screen forever, with no way out. The watchdog below degrades to the same
     * "unavailable" state the catch already uses, which renders the app rather than locking the
     * student out.
     */
    return (
      <main className="hud-canvas grid min-h-screen place-items-center" role="status" aria-live="polite">
        <div className="flex flex-col items-center gap-5">
          <div className="relative grid h-16 w-16 place-items-center">
            {/* A ring that sweeps rather than a spinner glyph — the wordmark stays still and legible
                while the motion happens around it. */}
            <span
              aria-hidden
              className="absolute inset-0 rounded-full border-2 border-[var(--hud-line)] border-t-[var(--hud-cyan)]"
              style={{ animation: "aria-boot-spin 900ms linear infinite" }}
            />
            <span className="font-display text-xl leading-none tracking-[-0.02em] text-[var(--hud-text)]">
              A
            </span>
          </div>
          <p className="text-[0.82rem] font-medium text-[var(--hud-text-dim)]">Starting Aria…</p>
        </div>
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

      {/* Says the quiet part. The app still works — this is a notice, not a gate — but "we cannot
          reach accounts right now" and "this build has no accounts" no longer look identical.
          Dismissible, because a student mid-lecture does not need it a second time. */}
      {state === "unavailable" && !noticeDismissed && (
        <div className="fixed bottom-4 left-1/2 z-[100] w-[min(92vw,30rem)] -translate-x-1/2 rounded-[var(--radius)] border border-amber-400/30 bg-amber-500/10 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <p className="flex-1 text-[0.8rem] leading-relaxed text-amber-100/85">
              <span className="font-bold">Accounts are unavailable.</span>{" "}
              Signing in, settings and your saved learning profile can’t be reached — lessons still
              work, but progress won’t be saved.
            </p>
            <button
              type="button"
              onClick={() => setNoticeDismissed(true)}
              className="shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-[0.75rem] font-bold text-amber-200/70 transition-colors hover:text-amber-100"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}
