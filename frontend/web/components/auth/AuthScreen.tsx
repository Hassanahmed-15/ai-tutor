"use client";

import { AriaMark } from "@/components/brand/AriaMark";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, Loader2, X } from "lucide-react";
import { MIN_PASSWORD, passwordChecks } from "@/lib/passwordRules";

/**
 * Sign in or create an account.
 *
 * One screen with a mode toggle rather than two routes, because the fields are identical and a
 * student who picked the wrong one should not have to navigate to fix it.
 *
 * Two ways in, clearly separated (owner's spec, 2026-09-29): "Continue with Google / Apple /
 * Microsoft" first, then "or sign up with email". Every field has a VISIBLE label — a placeholder
 * alone disappears the moment someone starts typing — and the password shows its rules as a live
 * checklist (lib/passwordRules.ts, the same rules the server enforces), so nobody learns them from
 * a rejected submit.
 */

type ProviderId = "google" | "apple" | "microsoft";
const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "google", label: "Google" },
  { id: "apple", label: "Apple" },
  { id: "microsoft", label: "Microsoft" },
];

const PROVIDER_ERRORS: Record<string, string> = {
  "not-configured": "isn't set up on this server yet — use email for now.",
  cancelled: "sign-in was cancelled.",
  state: "sign-in took too long or was opened in another window — please try again.",
  token: "couldn't confirm your account — please try again.",
  "email-unverified": "has an email that isn't verified, and an Aria account already uses it — sign in with your password instead.",
  "no-email": "didn't share an email address — allow email access and try again.",
  server: "sign-in failed on our side — please try again.",
};

function ProviderIcon({ id }: { id: ProviderId }) {
  if (id === "google") {
    return (
      <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px]">
        <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
        <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
      </svg>
    );
  }
  if (id === "apple") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="currentColor">
        <path d="M16.37 12.62c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.82-.81-3-.79-1.54.02-2.96.9-3.76 2.28-1.6 2.78-.41 6.9 1.15 9.16.76 1.1 1.67 2.34 2.86 2.3 1.15-.05 1.58-.74 2.97-.74 1.38 0 1.77.74 2.98.72 1.23-.02 2.01-1.12 2.77-2.23.87-1.28 1.23-2.51 1.25-2.58-.03-.01-2.4-.92-2.38-3.69zM14.1 5.86c.63-.77 1.06-1.84.94-2.9-.91.04-2.01.61-2.66 1.37-.58.67-1.09 1.76-.95 2.8 1.01.08 2.04-.51 2.67-1.27z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 23 23" className="size-[16px]">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

const INPUT =
  "w-full rounded-[var(--radius)] border border-[var(--input-border)] bg-[var(--hud-surface)] px-4 py-3 text-[0.95rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:border-[var(--hud-cyan)] focus:outline-none focus:ring-2 focus:ring-[var(--hud-cyan-glow)]";
const LABEL = "mb-1.5 block text-[0.84rem] font-medium text-[var(--hud-text)]";

export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // A provider sign-in that failed comes back here with the reason in the URL. This screen only
  // ever renders client-side (AuthGate shows it after /api/auth/me answers), so it is read at once.
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("auth_error");
    if (!code) return null;
    const provider = PROVIDERS.find((p) => p.id === params.get("auth_provider"))?.label ?? "That provider";
    return `${provider} ${PROVIDER_ERRORS[code] ?? PROVIDER_ERRORS.server}`;
  });
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState<Record<ProviderId, boolean> | null>(null);
  const [leaving, setLeaving] = useState<ProviderId | null>(null);

  const isSignup = mode === "signup";
  const checks = useMemo(() => passwordChecks(password, { email, username }), [password, email, username]);
  const passwordOk = checks.every((c) => c.ok);

  useEffect(() => {
    fetch("/api/auth/providers", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setAvailable(data ?? { google: false, apple: false, microsoft: false }))
      .catch(() => setAvailable({ google: false, apple: false, microsoft: false }));
    // The failed sign-in's reason is shown (see `error`); tidy the address bar so a reload does not
    // show it again.
    const params = new URLSearchParams(window.location.search);
    if (params.has("auth_error")) {
      params.delete("auth_error");
      params.delete("auth_provider");
      const rest = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    }
  }, []);

  function continueWith(id: ProviderId) {
    if (available && !available[id]) {
      setError(`${PROVIDERS.find((p) => p.id === id)!.label} ${PROVIDER_ERRORS["not-configured"]}`);
      return;
    }
    setError(null);
    setLeaving(id);
    window.location.assign(`/api/auth/oauth/${id}/start`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (isSignup && !passwordOk) {
      setError("Your password doesn't meet the requirements below yet.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Username only exists on signup — sending it to login would be meaningless, since login
        // identifies by email.
        body: JSON.stringify(isSignup ? { email, username, password } : { email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Something went wrong. Try again.");
      onAuthenticated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <main className="hud-canvas relative flex min-h-screen items-center justify-center px-6 py-12">
      <div className="relative z-10 w-full max-w-sm">
        <h1 className="flex flex-col items-center gap-4 text-center text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] text-[var(--hud-text)]">
          <AriaMark size={44} />
          {isSignup ? "Create your Aria account" : "Sign in to Aria"}
        </h1>
        <p className="mt-2 text-center text-[0.9375rem] text-[var(--hud-text-dim)]">
          Your tutor that teaches on a board and answers out loud.
        </p>

        {/* WAY ONE: an account you already have. */}
        <div className="mt-8 space-y-2.5" role="group" aria-label={isSignup ? "Sign up with a provider" : "Sign in with a provider"}>
          {PROVIDERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => continueWith(id)}
              disabled={leaving !== null}
              aria-describedby={available && !available[id] ? `${id}-unavailable` : undefined}
              className="flex w-full items-center justify-center gap-3 rounded-[var(--radius)] border bg-[var(--hud-surface)] px-4 py-3 text-[0.93rem] font-medium text-[var(--hud-text)] transition-colors hover:bg-[var(--hud-surface-2)] disabled:opacity-60"
              style={{ borderColor: "var(--hud-line-strong)" }}
            >
              {leaving === id ? <Loader2 aria-hidden="true" size={17} className="animate-spin" /> : <ProviderIcon id={id} />}
              Continue with {label}
              {available && !available[id] && (
                <span id={`${id}-unavailable`} className="sr-only">
                  (not set up on this server yet)
                </span>
              )}
            </button>
          ))}
        </div>

        {/* THE SEPARATION: the two methods never blur into one form. */}
        <div className="my-7 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1" style={{ background: "var(--hud-line)" }} />
          <span className="text-[0.78rem] font-medium text-[var(--hud-text-faint)]">
            {isSignup ? "or sign up with email" : "or sign in with email"}
          </span>
          <span className="h-px flex-1" style={{ background: "var(--hud-line)" }} />
        </div>

        {/* WAY TWO: email. */}
        <form onSubmit={submit} className="space-y-4" noValidate={false}>
          <div>
            <label htmlFor="email" className={LABEL}>Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={INPUT}
              style={{ borderColor: "var(--hud-line)" }}
            />
          </div>
          {/* Signup only. The field is unmounted rather than hidden on login so browsers do not
              offer to autofill a username into a form that would ignore it. */}
          {isSignup && (
            <div>
              <label htmlFor="username" className={LABEL}>Username</label>
              <input
                id="username"
                type="text"
                required
                autoComplete="username"
                minLength={3}
                maxLength={24}
                // Mirrors the server rule so the browser catches it before a round trip; the
                // server still validates, since this is only a hint.
                pattern="[A-Za-z0-9_\-]{3,24}"
                title="3–24 characters: letters, numbers, hyphen or underscore."
                aria-describedby="username-hint"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. sarah_harun"
                className={INPUT}
                style={{ borderColor: "var(--hud-line)" }}
              />
              <p id="username-hint" className="mt-1.5 text-[0.76rem] text-[var(--hud-text-faint)]">
                3–24 characters: letters, numbers, hyphen or underscore.
              </p>
            </div>
          )}
          <div>
            <label htmlFor="password" className={LABEL}>Password</label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={isSignup ? MIN_PASSWORD : undefined}
                autoComplete={isSignup ? "new-password" : "current-password"}
                aria-describedby={isSignup ? "password-rules" : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isSignup ? `At least ${MIN_PASSWORD} characters` : "Your password"}
                className={`${INPUT} pr-11`}
                style={{ borderColor: "var(--hud-line)" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 grid w-11 place-items-center text-[var(--hud-text-faint)] hover:text-[var(--hud-text)]"
              >
                {showPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
              </button>
            </div>
            {/* The rules, visible before anything is submitted, each ticking as it is met. */}
            {isSignup && (
              <ul id="password-rules" className="mt-2 space-y-1" aria-live="polite">
                {checks.map((c) => {
                  const met = c.ok;
                  const pending = password.length === 0;
                  return (
                    <li
                      key={c.id}
                      className="flex items-center gap-2 text-[0.78rem]"
                      style={{ color: pending ? "var(--hud-text-faint)" : met ? "var(--hud-cyan)" : "var(--hud-danger)" }}
                    >
                      {pending ? (
                        <span aria-hidden="true" className="grid size-3.5 place-items-center rounded-full border" style={{ borderColor: "var(--hud-line-strong)" }} />
                      ) : met ? (
                        <Check aria-hidden="true" size={14} strokeWidth={3} />
                      ) : (
                        <X aria-hidden="true" size={14} strokeWidth={3} />
                      )}
                      <span>
                        {c.label}
                        <span className="sr-only">{pending ? "" : met ? " — met" : " — not met yet"}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* role="alert" so a screen reader announces the failure without the student having to
              go looking for what changed. */}
          {error && (
            <p role="alert" className="text-[0.82rem] leading-relaxed text-[var(--hud-danger)]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || (isSignup && password.length > 0 && !passwordOk)}
            className="hud-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius)] px-6 py-3 text-[0.95rem] disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 aria-hidden="true" size={15} className="animate-spin" /> Working…
              </>
            ) : (
              <>
                {isSignup ? "Create account" : "Sign in"} <ArrowRight aria-hidden="true" size={15} />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-[0.84rem] text-[var(--hud-text-dim)]">
          {isSignup ? "Already have an account?" : "New here?"}{" "}
          <button
            onClick={() => {
              setMode(isSignup ? "login" : "signup");
              setError(null);
            }}
            className="text-[var(--hud-cyan-bright)] underline decoration-[var(--hud-line-strong)] underline-offset-4"
          >
            {isSignup ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </main>
  );
}
