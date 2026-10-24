import test from "node:test";
import assert from "node:assert/strict";
import katex from "katex";
import { mathifyBoard, noteTex, unicodeToTex } from "../canvas/mathNotes";
import type { CanvasBoardSpec } from "../canvas/types";

const renders = (tex: string) => { try { katex.renderToString(tex, { throwOnError: true }); return true; } catch { return false; } };

// The importance-sampling board (owner, 2026-10-24): "each eq should be derived from katex".
test("an equation note is turned into LaTeX that KaTeX renders; a note in words stays text", () => {
  assert.equal(noteTex("ρ₀:t = ∏ π(a|s)/b(a|s)"), String.raw`\rho_{0:t} = \prod \frac{\pi (a\mid s)}{b(a\mid s)}`);
  assert.equal(noteTex("V̂ = (1/N)Σᵢ₌₁ᴺΣₜ₌₀ᵀγᵗρ₀:ₜ⁽ⁱ⁾rₜ₊₁⁽ⁱ⁾"), String.raw`\hat{V} = \frac{1}{N}\sum_{i=1}^{N}\sum_{t=0}^{T}\gamma^{t}\rho_{0:t}^{(i)}r_{t+1}^{(i)}`);
  assert.equal(noteTex("Ordinary: V̂ₖ = (1/N)ΣρᵢGᵢ"), String.raw`\text{Ordinary: }\hat{V}_{k} = \frac{1}{N}\sum \rho_{i}G_{i}`);
  for (const t of ["τ = (s₀, a₀, r₁, ...)", "ρ = ∏ₜ₌₀ᵏ [π(aₜ|sₜ) ÷ b(aₜ|sₜ)]", "V̂ₖ = (1/N) × Σᵢ₌₁ⁿ ρᵢ × Gᵢ", "x² + 2x − 3 = 0"]) assert.ok(renders(noteTex(t) ?? ""), t);
  for (const t of ["Importance sampling: fix returns", "Large ratios increase variance", "Unbiased, high variance"]) assert.equal(noteTex(t), null, t);
  assert.equal(unicodeToTex("γᵗ"), String.raw`\gamma^{t}`, "a command never becomes text");
});

test("an equation in a flow box is taken out (kept as a typeset note), a fragment leaves only its words", () => {
  const spec = {
    v: 1, heading: "Importance Sampling", cues: [],
    notes: [{ id: "n1", text: "ρ₀:t = ∏ π(a|s)/b(a|s)", s: 1 }],
    stage: { kind: "flow", nodes: [
      { id: "ratio", label: "Importance ratio", sub: "ρ₀:t = π/b × …", s: 1 },
      { id: "ret", label: "Expected return", sub: "V̂ = (1/N)ΣᵢΣₜ", s: 2 },
      { id: "rew", label: "Rewards", sub: "rₜ₊₁^(i), discounted", s: 2 },
      { id: "traj", label: "Trajectory", sub: "τ from behavior b", s: 0 },
    ], arrows: [{ from: "rew", to: "ret", label: "γᵗρ₀:trₜ₊₁" }] },
  } as unknown as CanvasBoardSpec;
  mathifyBoard(spec, renders);
  const nodes = (spec.stage as unknown as { nodes: Array<{ id: string; sub?: string }>; arrows: Array<{ label?: string }> });
  assert.equal(nodes.nodes.find((n) => n.id === "ratio")?.sub, undefined);
  assert.equal(nodes.nodes.find((n) => n.id === "ret")?.sub, undefined);
  assert.equal(nodes.nodes.find((n) => n.id === "rew")?.sub, "discounted");
  assert.equal(nodes.nodes.find((n) => n.id === "traj")?.sub, "τ from behavior b", "one symbol in words stays");
  assert.equal(nodes.arrows[0].label, undefined);
  // The expected return's equation was in no note: it is one now, typeset; the ratio was already a note.
  assert.ok(spec.notes.some((n) => n.text.startsWith("V̂ =") && (n as { tex?: string }).tex));
  assert.equal(spec.notes.filter((n) => n.text.startsWith("ρ₀:t")).length, 1);
  assert.ok(spec.notes.every((n) => (n as { tex?: string }).tex));
});
