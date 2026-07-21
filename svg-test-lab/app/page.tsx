import { SceneRenderer } from "@/renderer/SceneRenderer";
import type { Scene } from "@/renderer/types";

// Exactly the JSON shape from the pasted proposal — the LLM would output this, unedited.
const alkaliMetalsScene: Scene = {
  type: "lesson",
  title: "Alkali Metals",
  layout: "two-column",
  components: [
    { type: "icon", icon: "mdi:fire", size: 100, color: "#e0a85f" },
    { type: "icon", icon: "mdi:water", size: 100, color: "#5b9bd5" },
    { type: "icon", icon: "mdi:test-tube", size: 100, color: "#6bc2b6" },
  ],
  bullets: ["Highly reactive", "Soft metals", "Low density"],
};

// A math-heavy scene to test KaTeX in the same pipeline.
const quadraticScene: Scene = {
  type: "lesson",
  title: "The Quadratic Formula",
  layout: "single-column",
  components: [
    { type: "icon", icon: "mdi:function-variant", size: 80, color: "#a855f7" },
    { type: "formula", latex: "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}" },
  ],
  bullets: ["Solves any quadratic ax²+bx+c=0", "± gives two possible roots"],
};

// A flowchart scene to test Mermaid in the same pipeline.
const processScene: Scene = {
  type: "lesson",
  title: "How Photosynthesis Works",
  layout: "single-column",
  components: [
    {
      type: "flowchart",
      mermaid: `graph LR
  A[Sunlight] --> B[Chlorophyll absorbs light]
  B --> C[Water + CO2]
  C --> D[Glucose + Oxygen]`,
    },
  ],
};

// ── REAL LECTURE CONTENT — pulled directly from lib/demo/batteryLecture.json ──
// Beat 2 "Inside a Battery" today uses an AI-generated cutaway PHOTO + 4 callouts
// (anode/cathode/electrolyte/separator). This rebuilds the SAME labeled cross-section
// using only typed shapes — no image generation call. Shared spec so the raw-SVG and
// Rough.js renderers can be compared on IDENTICAL input.
const crossSectionSpec = {
  viewBoxW: 400,
  viewBoxH: 200,
  shapes: [
    { id: "anode", kind: "rect" as const, x: 20, y: 50, w: 26, h: 60, color: "#6bc2b6", label: "Anode", labelPos: "below" as const },
    { id: "separator", kind: "rect" as const, x: 50, y: 50, w: 10, h: 60, color: "#e2ddd0", label: "Separator", labelPos: "below" as const },
    { id: "cathode", kind: "rect" as const, x: 80, y: 50, w: 26, h: 60, color: "#e0a85f", label: "Cathode", labelPos: "below" as const },
    { id: "electrolyte", kind: "circle" as const, x: 50, y: 20, r: 3, color: "#5b9bd5", label: "Electrolyte", labelPos: "above" as const },
  ],
  connectors: [],
};

const batteryCrossSectionScene: Scene = {
  type: "lesson",
  title: "Inside a Battery",
  layout: "single-column",
  components: [{ type: "diagram", spec: crossSectionSpec }],
  bullets: [
    "Anode and cathode are separated by the electrolyte",
    "The separator prevents a short circuit",
    "The electrolyte lets ions move between electrodes",
  ],
};

const batteryCrossSectionSceneRough: Scene = {
  ...batteryCrossSectionScene,
  components: [{ type: "diagram-rough", spec: crossSectionSpec }],
};

// Beat 3 "Energy Flow" today uses a 15KB LLM-WRITTEN REACT COMPONENT for the animation.
// This rebuilds the same idea — electrons flowing anode -> circuit -> cathode -> device —
// as a typed diagram, using the SAME renderer as every other diagram, no custom code
// generation, no sandboxed iframe.
//
// FIX from the first pass: anode/cathode were floating with nothing showing they're part
// of a battery. Now they sit INSIDE a `battery` enclosure (the actual recognizable battery
// silhouette — body + terminal bump), and the device sits outside, wired to the terminals.
const flowSpec = {
  viewBoxW: 460,
  viewBoxH: 260,
  enclosures: [
    { id: "battery-shell", kind: "battery" as const, x: 28, y: 70, w: 50, h: 42, label: "Battery", labelPos: "above" as const },
  ],
  shapes: [
    { id: "anode", kind: "rect" as const, x: 17, y: 70, w: 15, h: 26, color: "#6bc2b6", label: "Anode", labelPos: "below" as const },
    { id: "cathode", kind: "rect" as const, x: 39, y: 70, w: 15, h: 26, color: "#e0a85f", label: "Cathode", labelPos: "below" as const },
    { id: "device", kind: "rect" as const, x: 78, y: 25, w: 26, h: 20, color: "#a855f7", label: "Device", labelPos: "inside" as const },
  ],
  connectors: [
    { from: "anode", to: "device", flow: true, flowColor: "#5b9bd5", flowLabel: "e⁻" },
    { from: "device", to: "cathode", flow: true, flowColor: "#5b9bd5", flowLabel: "e⁻" },
  ],
};

const batteryFlowScene: Scene = {
  type: "lesson",
  title: "Energy Flow",
  layout: "single-column",
  components: [{ type: "diagram", spec: flowSpec }],
  bullets: [
    "Electrons flow anode → external circuit → cathode",
    "This flow of electrons is what powers the device",
  ],
};

const batteryFlowSceneRough: Scene = {
  ...batteryFlowScene,
  components: [{ type: "diagram-rough", spec: flowSpec }],
};

export default function Home() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px", display: "flex", flexDirection: "column", gap: 40 }}>
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#9a5a1b", letterSpacing: 1, marginBottom: 8 }}>
          TEST 1 — ICONIFY + BULLETS (the exact pasted example)
        </p>
        <SceneRenderer scene={alkaliMetalsScene} />
      </div>
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#9a5a1b", letterSpacing: 1, marginBottom: 8 }}>
          TEST 2 — KATEX MATH
        </p>
        <SceneRenderer scene={quadraticScene} />
      </div>
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#9a5a1b", letterSpacing: 1, marginBottom: 8 }}>
          TEST 3 — MERMAID FLOWCHART
        </p>
        <SceneRenderer scene={processScene} />
      </div>
      <div id="test4">
        <p style={{ fontSize: 13, fontWeight: 700, color: "#b41e4a", letterSpacing: 1, marginBottom: 8 }}>
          TEST 4 — REAL LECTURE: battery cross-section (replaces an AI-generated photo + 4 callouts)
        </p>
        <SceneRenderer scene={batteryCrossSectionScene} />
      </div>
      <div id="test5">
        <p style={{ fontSize: 13, fontWeight: 700, color: "#b41e4a", letterSpacing: 1, marginBottom: 8 }}>
          TEST 5 — REAL LECTURE: electron flow (replaces a 15KB LLM-written React animation)
        </p>
        <SceneRenderer scene={batteryFlowScene} />
      </div>
      <div id="test6">
        <p style={{ fontSize: 13, fontWeight: 700, color: "#1e5c56", letterSpacing: 1, marginBottom: 8 }}>
          TEST 6 — SAME cross-section, drawn with Rough.js instead of raw SVG
        </p>
        <SceneRenderer scene={batteryCrossSectionSceneRough} />
      </div>
      <div id="test7">
        <p style={{ fontSize: 13, fontWeight: 700, color: "#1e5c56", letterSpacing: 1, marginBottom: 8 }}>
          TEST 7 — SAME electron flow, drawn with Rough.js instead of raw SVG
        </p>
        <SceneRenderer scene={batteryFlowSceneRough} />
      </div>
    </div>
  );
}
