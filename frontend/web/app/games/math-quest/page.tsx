import type { Metadata } from "next";

export const metadata: Metadata = { title: "Math Quest · Aria" };

/**
 * MATH QUEST (docs/math-quest.md): the owner's game, full screen under a slim bar back to Aria. The game runs in its
 * own frame (it fills its viewport with `position: fixed` and keeps its own save in localStorage `mathquest-v2`).
 */
export default function MathQuestPage() {
  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#000" }}>
      <div style={{ height: 36, flex: "0 0 36px", display: "flex", alignItems: "center", gap: 12, padding: "0 14px", background: "#0b0b12", borderBottom: "1px solid #24243a", color: "#cfcfe6", fontSize: 14 }}>
        <a href="/" style={{ color: "#cfcfe6", textDecoration: "none" }}>← Back to Aria</a>
        <span style={{ opacity: 0.55 }}>Math Quest</span>
      </div>
      <iframe src="/games/math-quest/play" title="Math Quest" allow="autoplay; fullscreen" style={{ flex: 1, width: "100%", border: 0, display: "block" }} />
    </div>
  );
}
