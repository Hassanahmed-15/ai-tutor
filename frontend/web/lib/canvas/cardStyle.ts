/**
 * HOW TEXT CARDS ARE DRAWN (owner, 2026-10-19: "replace the cards", visuals only — never how the
 * lesson is taught). STICKY NOTES are the card look: pastel paper notes with pencil arrows, a
 * spotlight on the note Aria is on, and a recap wave when the board ends (CanvasPanel StickyCard).
 * Same positions, same words, same timing as before. Chalk boards keep their own cards.
 *
 * The other looks stay for comparison: ?cards=classic | sticker | marker | badge | sticky in a URL
 * (remembered in this browser), or NEXT_PUBLIC_CANVAS_CARDS on a deployment.
 */
export type CardStyle = "classic" | "sticker" | "marker" | "badge" | "sticky";

const STYLES: readonly CardStyle[] = ["classic", "sticker", "marker", "badge", "sticky"];

const KEY = "aria.canvas.cards.v1";

export function preferredCardStyle(): CardStyle {
  const env = process.env.NEXT_PUBLIC_CANVAS_CARDS as CardStyle | undefined;
  const fromEnv: CardStyle = env && STYLES.includes(env) ? env : "sticky";
  if (typeof window === "undefined") return fromEnv;
  try {
    const asked = new URLSearchParams(window.location.search).get("cards") as CardStyle | null;
    if (asked && STYLES.includes(asked)) {
      window.localStorage.setItem(KEY, asked);
      return asked;
    }
    const saved = window.localStorage.getItem(KEY) as CardStyle | null;
    if (saved && STYLES.includes(saved)) return saved;
  } catch {
    // Private windows and blocked storage keep the deployment's default.
  }
  return fromEnv;
}
