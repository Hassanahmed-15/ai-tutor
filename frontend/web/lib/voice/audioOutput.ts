/**
 * KEEPING ARIA AUDIBLE.
 *
 * Both of Aria's voices play through a Web Audio context — the lecture narration (lib/voice.ts) and
 * the live tutor (lib/useGeminiLiveTutor.ts) — and both contexts are created outside a click: after
 * a clip download, inside a WebSocket callback, on a reconnect timer. A browser may hold such a
 * context `suspended` (autoplay policy) or `interrupted` (Safari: a call, the ringer, another app),
 * and then:
 *   - `resume()` never settles, so code awaiting it waits forever while the UI says "speaking";
 *   - audio scheduled on it plays in silence.
 * That is "she's speaking but I can't hear her".
 *
 * Two guarantees here. Every context is registered, and resumed again on the next thing the student
 * does (a click, a key, returning to the tab) — the only moment a browser is certain to allow it.
 * And resuming is always BOUNDED: `ensureRunning` answers within its timeout, so a caller can take
 * a path that is audible without the context instead of hanging.
 */

type ContextLike = Pick<AudioContext, "state" | "resume"> & { addEventListener?: AudioContext["addEventListener"] };

const contexts = new Set<ContextLike>();
let installed = false;

function resumeAll(): void {
  for (const context of contexts) {
    if ((context.state as string) === "closed") {
      contexts.delete(context);
      continue;
    }
    if (context.state !== "running") void context.resume().catch(() => {});
  }
}

function install(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  for (const type of ["pointerdown", "keydown", "touchend"] as const) {
    window.addEventListener(type, resumeAll, { capture: true, passive: true });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") resumeAll();
  });
  window.addEventListener("focus", resumeAll);
}

/** Track a context so it is resumed whenever the student next interacts. */
export function registerAudioContext(context: ContextLike): void {
  install();
  contexts.add(context);
  // An `interrupted` (Safari) or `suspended` context that the browser lets go of later is picked up
  // here too, not only on the next click.
  context.addEventListener?.("statechange", () => {
    if ((context.state as string) === "closed") contexts.delete(context);
  });
}

/**
 * Try to have the context running within `timeoutMs`. Resolves true when it is running, false when
 * it is not — never hangs, unlike a bare `await context.resume()` on a context the browser refuses.
 */
export async function ensureRunning(context: ContextLike, timeoutMs = 1_500): Promise<boolean> {
  if (context.state === "running") return true;
  if ((context.state as string) === "closed") return false;
  await Promise.race([
    context.resume().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  // Re-read: resume() changes the state, which the narrowing above cannot know.
  return (context.state as string) === "running";
}

/** Resume every registered context now — call from a click handler (e.g. Play). */
export function resumeAllAudio(): void {
  install();
  resumeAll();
}
