"use client";

import { useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";

/**
 * Sign in or create an account.
 *
 * One screen with a mode toggle rather than two routes, because the fields are identical and a
 * student who picked the wrong one should not have to navigate to fix it.
 *
 * The password rule is length-only (10 characters). Composition rules — an uppercase, a digit, a
 * symbol — mostly produce predictable substitutions like P@ssw0rd1, so they add memorability cost
 * without adding much entropy. The server enforces the same rule; this is only the early warning.
 */
export function AuthScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isSignup = mode === "signup";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
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
    <main className="hud-canvas hud-grain relative flex min-h-screen items-center justify-center px-6">
      <div className="relative z-10 w-full max-w-sm">
        <h1 className="text-center font-display text-[3rem] leading-none tracking-[-0.04em] text-[var(--hud-text)]">
          Aria
        </h1>
        <p className="mt-3 text-center text-[0.9rem] text-[var(--hud-text-dim)]">
          {isSignup ? "Create an account to begin." : "Welcome back."}
        </p>

        <form onSubmit={submit} className="mt-9 space-y-3">
          <div>
            <label htmlFor="email" className="sr-only">Email address</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-[var(--radius)] border bg-[var(--hud-surface)] px-4 py-3 text-[0.95rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--hud-cyan)]"
              style={{ borderColor: "var(--hud-line)" }}
            />
          </div>
          <div>
            <label htmlFor="password" className="sr-only">Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={isSignup ? 10 : undefined}
              autoComplete={isSignup ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? "At least 10 characters" : "Your password"}
              className="w-full rounded-[var(--radius)] border bg-[var(--hud-surface)] px-4 py-3 text-[0.95rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--hud-cyan)]"
              style={{ borderColor: "var(--hud-line)" }}
            />
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
            disabled={busy}
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
