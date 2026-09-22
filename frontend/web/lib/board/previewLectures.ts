import type { DrawScript } from "@/components/sketch/LiveSketch";
import type { Beat } from "@/lib/lessonContent";

export type PreviewKey = "linear-regression" | "neural-networks" | "plate-tectonics";

const scripts: Record<PreviewKey, Array<{
  id: string;
  concept: string;
  title: string;
  script: string;
  surface: DrawScript["surface"];
  lines: string[];
  screens?: number;
}>> = {
  "linear-regression": [
    { id: "fit", concept: "regression-loss", title: "Fit a line to the cloud", surface: "paper", screens: 2, script: "Start with the scatter of observed points. The line gives one prediction for every input. Each vertical gap is a residual. Squaring those gaps turns them into one loss we can minimise.", lines: ["observations (xᵢ, yᵢ)", "prediction ŷ = mx + b", "residual eᵢ = yᵢ − ŷᵢ", "loss J = Σeᵢ²"] },
    { id: "loss", concept: "regression-loss", title: "Why the residuals are squared", surface: "split", script: "Keep the fitted line on the left. On the right, compare positive and negative residuals. A plain sum can cancel to zero. Squaring keeps every miss positive and punishes the largest misses most.", lines: ["+3 and −3 cancel", "3² + (−3)² = 18", "large misses matter more", "same line, clearer objective"] },
    { id: "descent", concept: "optimisation", title: "Walk downhill to a better line", surface: "dark", script: "Now treat the loss as a landscape. Its slope says which change makes the fit worse. Step in the opposite direction. Repeating that small update moves the parameters toward the lowest loss.", lines: ["slope ∇J(θ)", "θ ← θ − α∇J(θ)", "small α = steady steps", "minimum = best fit"] },
  ],
  "neural-networks": [
    { id: "forward", concept: "learning-loop", title: "Signals move forward", surface: "dark", screens: 3, script: "An input enters the first layer. Every connection scales that signal by a weight. A neuron adds the incoming values and applies an activation. The final layer turns that chain into a prediction.", lines: ["input x", "weighted sum z = Wx + b", "activation a = σ(z)", "prediction ŷ"] },
    { id: "backprop", concept: "learning-loop", title: "Credit moves backward", surface: "split", script: "Keep the forward path visible. Compare the prediction with the target to get a loss. The chain rule carries responsibility backward through each connection. Each weight then changes by the amount it contributed to the error.", lines: ["loss L(ŷ, y)", "chain rule", "∂L/∂w", "w ← w − α∂L/∂w"] },
    { id: "generalise", concept: "generalisation", title: "Learning versus memorising", surface: "paper", script: "Training error can keep falling while new examples get worse. That gap is overfitting. Validation data reveals it because the model has never trained on those examples. Regularisation and simpler models can restore generalisation.", lines: ["training loss ↓", "validation loss turns ↑", "overfitting", "regularise or simplify"] },
  ],
  "plate-tectonics": [
    { id: "convection", concept: "plate-motion", title: "Heat drives slow motion", surface: "dark", screens: 2, script: "Deep rock is solid but moves over geological time. Hot material becomes buoyant and rises. Near the surface it spreads sideways beneath the plates. Cooler material sinks and completes the convection loop.", lines: ["hot mantle rises", "flow spreads sideways", "plates move centimetres per year", "cool mantle sinks"] },
    { id: "subduction", concept: "plate-motion", title: "One plate dives below another", surface: "split", script: "Keep that convection loop in view. At a convergent boundary, the denser oceanic plate bends downward. Water released from it lowers the melting point above. Magma then rises through the overriding plate.", lines: ["oceanic plate = denser", "subduction trench", "water triggers melting", "magma rises"] },
    { id: "hazards", concept: "boundary-effects", title: "Boundaries concentrate hazards", surface: "paper", script: "Plate interiors move almost as rigid pieces. Their boundaries absorb most of the deformation. Locked faults store elastic energy until they slip as earthquakes. Rising magma makes volcanic arcs above many subduction zones.", lines: ["locked fault stores energy", "sudden slip = earthquake", "magma arc", "hazards trace boundaries"] },
  ],
};

function drawFor(item: (typeof scripts)[PreviewKey][number]): DrawScript {
  return {
    caption: item.title,
    durationMs: 28_000,
    surface: item.surface,
    canvasScreens: item.screens,
    panes: item.surface === "split" ? { left: "dark", right: "paper" } : undefined,
    ops: item.lines.flatMap((line, index) => {
      const at = 0.05 + index * 0.24;
      return [
        { kind: "label" as const, id: `line-${index}`, text: line, x: 50, y: 18 + index * 18, size: index === 0 ? "lg" as const : "md" as const, color: item.surface === "paper" ? "#1e293b" : "#f8fafc", at, atSentence: index },
        ...(index === 0 ? [] : [{ kind: "arrow" as const, x1: 48, y1: 7 + index * 18, x2: 48, y2: 12 + index * 18, color: "#fbbf24", at: Math.max(0, at - 0.03), atSentence: index }]),
      ];
    }),
  };
}

export const PREVIEW_LECTURES: Record<PreviewKey, { title: string; beats: Beat[] }> = Object.fromEntries(
  Object.entries(scripts).map(([key, items]) => [key, {
    title: key.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
    beats: items.map((item, index) => ({
      id: item.id,
      conceptId: item.concept,
      conceptObjective: item.title,
      prerequisiteConceptIds: index > 0 && items[index - 1].concept !== item.concept ? [items[index - 1].concept] : [],
      title: item.title,
      transitionIn: index === 0 ? undefined : `Use what is already on the board to see ${item.title.toLowerCase()}.`,
      teacherMove: item.title,
      stepLabel: `${index + 1} · Learn`,
      slideKind: "intro" as const,
      points: item.lines,
      script: item.script,
      draw: drawFor(item),
    })),
  }]),
) as Record<PreviewKey, { title: string; beats: Beat[] }>;

export const PREVIEW_KEYS = Object.keys(PREVIEW_LECTURES) as PreviewKey[];

/**
 * A LECTURE WHOSE FIRST BOARD HAS NOT BEEN GENERATED YET.
 *
 * Every preview lecture above ships with its board content already filled, so the preview could
 * never reproduce the condition that actually broke in production: the beat exists and narration
 * starts, but the board's `reactAnimation` op is still waiting on the server. That is what put a
 * blank white rectangle on screen while Aria talked over it, and it is invisible to a seeded
 * fixture — which is exactly why three attempts at the title card passed here and failed there.
 *
 * `code: undefined` with no `status` is precisely what `isReactAnimationPending` looks for.
 */
export function pendingBoardLecture(): { title: string; beats: Beat[] } {
  const base = PREVIEW_LECTURES["linear-regression"];
  return {
    title: base.title,
    beats: base.beats.map((beat, index) => (
      index === 0
        ? { ...beat, draw: { ...beat.draw!, ops: [{ kind: "reactAnimation", teachingPoint: beat.title } as DrawScript["ops"][number]] } }
        : beat
    )),
  };
}
