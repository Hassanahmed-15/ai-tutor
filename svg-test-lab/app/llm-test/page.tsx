"use client";
import { useState } from "react";
import { DiagramRough } from "@/renderer/components/DiagramRough";
import type { DiagramSpec } from "@/renderer/components/Diagram";

// The REAL script from lib/demo/batteryLecture.json, beat 3 "Energy Flow" — unedited.
const ENERGY_FLOW_SCRIPT =
  "When a battery is connected to a device, electrons flow from the anode to the cathode " +
  "through an external circuit. This flow of electrons provides the energy needed for the " +
  "device to operate. It's like a river of energy flowing from one side to the other, " +
  "powering everything in its path.";

// A SECOND, unrelated topic — to test whether the model can generalize beyond batteries,
// which is the whole point of this exercise (general-purpose, not chemistry-only).
const PHOTOSYNTHESIS_SCRIPT =
  "Inside the chloroplast, sunlight is absorbed by chlorophyll. This energy splits water " +
  "molecules into oxygen and hydrogen. The hydrogen combines with carbon dioxide from the " +
  "air to build glucose, while the oxygen is released as a byproduct through small pores " +
  "in the leaf called stomata.";

type Result = { spec: DiagramSpec; raw: string; usage: unknown } | null;

function TestCase({ topic, script }: { topic: string; script: string }) {
  const [result, setResult] = useState<Result>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/generate-diagram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, script }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: "2px solid #e2ddd0", borderRadius: 20, padding: 32, marginBottom: 40 }}>
      <p style={{ fontFamily: "var(--font-sketch)", fontSize: 26, marginBottom: 8 }}>{topic}</p>
      <p style={{ fontSize: 13, color: "#55524a", marginBottom: 16, maxWidth: 640 }}>{script}</p>
      <button
        onClick={generate}
        disabled={loading}
        style={{
          background: "#1e5c56",
          color: "white",
          border: "none",
          borderRadius: 999,
          padding: "10px 20px",
          fontSize: 13,
          fontWeight: 700,
          cursor: loading ? "default" : "pointer",
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? "Asking gpt-4o…" : "Generate diagram (real API call)"}
      </button>

      {error && <p style={{ color: "#b41e4a", marginTop: 16, fontSize: 13 }}>Error: {error}</p>}

      {result && (
        <div style={{ marginTop: 24 }}>
          <div style={{ background: "#fdfbf6", borderRadius: 12, padding: 20 }}>
            <DiagramRough spec={result.spec} />
          </div>
          <details style={{ marginTop: 12 }}>
            <summary style={{ fontSize: 12, color: "#9a5a1b", cursor: "pointer" }}>
              Raw model output (unedited)
            </summary>
            <pre style={{ fontSize: 11, background: "#20180a", color: "#e2ddd0", padding: 16, borderRadius: 8, overflow: "auto", marginTop: 8 }}>
              {JSON.stringify(result.spec, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

export default function LlmTestPage() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: "#9a5a1b", letterSpacing: 1, marginBottom: 8 }}>
        THE REAL TEST — LLM GENERATES THE DIAGRAM, UNEDITED
      </p>
      <h1 style={{ fontFamily: "var(--font-sketch)", fontSize: 34, marginBottom: 24 }}>
        Can gpt-4o produce a good DiagramSpec on its own?
      </h1>
      <TestCase topic="How a battery works — Energy Flow" script={ENERGY_FLOW_SCRIPT} />
      <TestCase topic="Photosynthesis — inside the chloroplast" script={PHOTOSYNTHESIS_SCRIPT} />
    </div>
  );
}
