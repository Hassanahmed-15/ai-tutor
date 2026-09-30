import { currentUser } from "@/lib/auth";

/**
 * Who may use the lesson canvas, and as whom.
 *
 * Production: signed-in students only, each working in their own storage prefix — the id comes
 * from the session, never from the request. Development: a single local user, so the preview and
 * its browser tests work without an account. CANVAS_ENABLED=0 switches the feature off everywhere.
 */
export async function canvasUser(): Promise<{ userId: string } | { error: string; status: number }> {
  if (process.env.CANVAS_ENABLED === "0") return { error: "The lesson canvas is switched off.", status: 404 };
  const user = await currentUser().catch(() => null);
  if (user) return { userId: user.userId };
  if (process.env.NODE_ENV !== "production") return { userId: "local-dev" };
  return { error: "Please sign in to use the lesson canvas.", status: 401 };
}

/** Lectures one student may generate per 24 hours (each costs ~$0.10-0.20). 0 = no limit. */
export function canvasDailyLimit(): number {
  const raw = process.env.CANVAS_DAILY_LIMIT;
  if (raw !== undefined && Number.isFinite(Number(raw))) return Math.max(0, Number(raw));
  return process.env.NODE_ENV === "production" ? 10 : 0;
}
