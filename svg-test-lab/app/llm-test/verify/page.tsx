import { DiagramRough } from "@/renderer/components/DiagramRough";

// Hardcoded from the ACTUAL curl responses of /api/generate-diagram — unedited by hand,
// pasted here only so we can visually verify what the model produced without needing
// button-click automation.
const batteryResult = {
  shapes: [
    { id: "anode", kind: "rect" as const, x: 20, y: 50, w: 10, h: 20, color: "#FFB6C1", label: "Anode", labelPos: "above" as const },
    { id: "cathode", kind: "rect" as const, x: 70, y: 50, w: 10, h: 20, color: "#ADD8E6", label: "Cathode", labelPos: "above" as const },
    { id: "device", kind: "rect" as const, x: 45, y: 70, w: 10, h: 10, color: "#98FB98", label: "Device", labelPos: "below" as const },
  ],
  connectors: [{ from: "anode", to: "cathode", flow: true, flowColor: "#FFD700", flowLabel: "e⁻" }],
  enclosures: [{ id: "battery", kind: "battery" as const, x: 15, y: 40, w: 70, h: 40, label: "Battery", labelPos: "above" as const }],
};

const photoResult = {
  shapes: [
    { id: "chlorophyll", kind: "circle" as const, x: 20, y: 20, r: 5, color: "#76c7c0", label: "Chlorophyll", labelPos: "below" as const },
    { id: "sunlight", kind: "rect" as const, x: 10, y: 10, w: 10, h: 5, color: "#ffeb3b", label: "Sunlight", labelPos: "above" as const },
    { id: "water", kind: "rect" as const, x: 20, y: 40, w: 10, h: 5, color: "#4fc3f7", label: "H₂O", labelPos: "below" as const },
    { id: "oxygen", kind: "circle" as const, x: 60, y: 40, r: 5, color: "#81d4fa", label: "O₂", labelPos: "below" as const },
    { id: "glucose", kind: "rect" as const, x: 60, y: 20, w: 10, h: 5, color: "#ffcc80", label: "Glucose", labelPos: "above" as const },
  ],
  connectors: [
    { from: "sunlight", to: "chlorophyll", flow: true, flowColor: "#ffeb3b", flowLabel: "Energy" },
    { from: "chlorophyll", to: "water", flow: true, flowColor: "#4fc3f7", flowLabel: "Splitting" },
    { from: "water", to: "oxygen", flow: true, flowColor: "#81d4fa", flowLabel: "Release" },
    { from: "water", to: "glucose", flow: true, flowColor: "#ffcc80", flowLabel: "H+CO₂" },
  ],
  enclosures: [{ id: "chloroplast", kind: "box" as const, x: 8, y: 8, w: 84, h: 40, label: "Chloroplast", labelPos: "above" as const }],
};

export default function VerifyPage() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: "#b41e4a", letterSpacing: 1, marginBottom: 8 }}>
        ACTUAL gpt-4o OUTPUT, RENDERED — NOTHING HAND-TUNED
      </p>
      <div id="battery" style={{ border: "2px solid #e2ddd0", borderRadius: 20, padding: 32, marginBottom: 40, background: "#fdfbf6" }}>
        <p style={{ fontFamily: "var(--font-sketch)", fontSize: 24, marginBottom: 16 }}>Battery — Energy Flow (LLM-generated)</p>
        <DiagramRough spec={batteryResult} />
      </div>
      <div id="photo" style={{ border: "2px solid #e2ddd0", borderRadius: 20, padding: 32, background: "#fdfbf6" }}>
        <p style={{ fontFamily: "var(--font-sketch)", fontSize: 24, marginBottom: 16 }}>Photosynthesis (LLM-generated)</p>
        <DiagramRough spec={photoResult} />
      </div>
    </div>
  );
}
