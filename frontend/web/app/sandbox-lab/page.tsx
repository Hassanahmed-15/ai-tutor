"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReactAnimationSandbox } from "@/components/sketch/ReactAnimationSandbox";

/**
 * `/sandbox-lab` — one generated React board, rendered exactly as the lesson renders it.
 *
 * The iteration loop for sandbox quality. `?topic=` picks a fixture, `?p=` sets progress, and
 * `?auto=1` generates on load so a headless screenshot needs no clicking. The board renders through
 * the real ReactAnimationSandbox, so what you screenshot here is what a student would see.
 */

const FIXTURES: Record<string, { title: string; teachingPoint: string; script: string }> = {
  respiration: {
    title: "Overview of the Respiratory System",
    teachingPoint:
      "The respiratory system: the airways carry air down the trachea into both lungs, and the diaphragm below them drives airflow. Oxygen travels in, carbon dioxide travels out.",
    script:
      "Breathing depends on a vital network of organs. The main components are the airways, the lungs, and the diaphragm. Air enters through the trachea and passes into both lungs. The diaphragm sits beneath the lungs and drives airflow. Oxygen moves in and carbon dioxide moves out.",
  },
  airways: {
    title: "Anatomy of the Airways",
    teachingPoint:
      "The airways are the air passages that guide air into the lungs: nasal cavity, trachea, bronchi, then bronchioles. They warm and filter the air and remove particles.",
    script:
      "The airways are the passages that guide air into the lungs. Air enters at the nasal cavity. It travels down the trachea. The trachea splits into two bronchi. Each bronchus branches into finer bronchioles. Along the way the airways warm and filter the air and remove particles.",
  },
  neuron: {
    title: "How a Neuron Fires",
    teachingPoint:
      "A neuron: dendrites receive signals, the cell body sums them, and if threshold is reached an impulse travels down the axon to the terminals.",
    script:
      "A neuron receives signals through its dendrites. The cell body sums those incoming signals. When the total crosses the threshold, the neuron fires. The impulse travels along the axon. It reaches the axon terminals and passes to the next cell.",
  },
  heart: {
    title: "Blood Flow Through the Heart",
    teachingPoint:
      "The heart's four chambers: deoxygenated blood enters the right atrium, drops to the right ventricle, goes to the lungs, returns to the left atrium, then the left ventricle pumps it to the body.",
    script:
      "Blood returns from the body into the right atrium. It drops into the right ventricle. The right ventricle pumps it to the lungs. Oxygenated blood returns to the left atrium. It fills the left ventricle. The left ventricle pumps it out to the whole body.",
  },
  volcano: {
    title: "Inside a Volcano",
    teachingPoint:
      "A volcano in cross-section: a magma chamber below, a central conduit rising through the cone, and the vent at the summit where lava and ash escape.",
    script:
      "Beneath a volcano lies a magma chamber. Pressure builds in that chamber. Magma rises through a central conduit. The conduit runs up through the layered cone. At the summit the vent releases lava and ash.",
  },
};

/**
 * The board reveals by SENTENCE, not by raw progress: every step carries `data-teach-sentence`, and
 * the sandbox hides anything whose sentence has not been reached. Passing only `progress` (with the
 * defaults sentenceIndex=0, sentenceTotal=1) clamps every step to sentence 0 at local time 0 and
 * renders a blank board — which looks exactly like a broken generator and is not one.
 *
 * So the lab emulates what LessonPlayer does: walk the narration's sentences as progress advances.
 */
function sentenceStateFor(progress: number, script: string) {
  const sentenceTotal = Math.max(1, (script.match(/[.!?]+/g) ?? []).length);
  const scaled = Math.min(progress, 0.999999) * sentenceTotal;
  return {
    sentenceTotal,
    sentenceIndex: Math.min(sentenceTotal - 1, Math.floor(scaled)),
    sentenceProgress: progress >= 1 ? 1 : scaled - Math.floor(scaled),
  };
}

function SandboxLab() {
  const params = useSearchParams();
  const key = params.get("topic") ?? "respiration";
  const auto = params.get("auto") === "1";
  const [progress, setProgress] = useState(() => {
    const p = Number(params.get("p"));
    return Number.isFinite(p) && p >= 0 ? Math.min(1, p) : 1;
  });

  const [code, setCode] = useState<string | null>(null);
  const [assetIds, setAssetIds] = useState<string[]>([]);
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    const fixture = FIXTURES[key];
    if (!fixture || busy) return;
    setBusy(true);
    setError(null);
    setCode(null);
    try {
      const res = await fetch("/api/sandbox-board", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fixture),
      });
      const data = await res.json();
      if (data.code) {
        setCode(data.code);
        setAssetIds(Array.isArray(data.assetIds) ? data.assetIds : []);
      } else {
        setError(data.error ?? "no code returned");
      }
      setMeta({ status: data.status, critique: data.critique, stats: data.stats });
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    } finally {
      setBusy(false);
    }
  }, [key, busy]);

  useEffect(() => {
    if (auto) void generate();
    // Intentionally once on mount: re-running on `generate` identity would loop the API call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 p-5 text-white">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-black">sandbox-lab</h1>
        {Object.keys(FIXTURES).map((name) => (
          <a
            key={name}
            href={`/sandbox-lab?topic=${name}&p=${progress}`}
            className={`rounded-full px-3 py-1 text-xs ${name === key ? "bg-white/20" : "bg-white/5 text-white/60"}`}
          >
            {name}
          </a>
        ))}
        <button
          onClick={generate}
          disabled={busy}
          data-generate=""
          className="rounded-full bg-emerald-400 px-4 py-1.5 text-xs font-bold text-slate-900 disabled:opacity-50"
        >
          {busy ? "generating…" : "generate"}
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs">
          p {progress.toFixed(2)}
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="w-56"
          />
        </label>
      </div>

      {/* 16:9 at the lesson's own aspect, so what is screenshotted here matches the player. */}
      <div className="mt-4 aspect-[1000/560] w-full max-w-[1100px] overflow-hidden rounded-xl bg-white" data-stage="">
        {code ? (
          <ReactAnimationSandbox
            code={code}
            progress={progress}
            assetIds={assetIds}
            {...sentenceStateFor(progress, FIXTURES[key]?.script ?? "")}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500" data-empty="">
            {busy ? "generating…" : error ? `error: ${error}` : "press generate"}
          </div>
        )}
      </div>

      {meta ? (
        <pre className="mt-3 max-h-52 overflow-auto rounded-lg bg-black/40 p-3 text-[11px] text-white/70" data-meta="">
          {JSON.stringify(meta, null, 2)}
        </pre>
      ) : null}
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SandboxLab />
    </Suspense>
  );
}
