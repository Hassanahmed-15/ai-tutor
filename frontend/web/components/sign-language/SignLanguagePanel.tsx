"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SignHand } from "./SignHand";
import { buildFingerSpellingPlan, playbackDelayMs } from "./processing";
import type { AlphabetPoseData, SignFrame } from "./types";

const DATA_URL = "/sign-language/asl-alphabet-poses.json";
const FRAME_MS = 42;

export default function SignLanguagePanel({ transcript, active }: { transcript: string; active: boolean }) {
  const [alphabet, setAlphabet] = useState<AlphabetPoseData | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(DATA_URL, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Signing data unavailable");
        return response.json() as Promise<AlphabetPoseData>;
      })
      .then(setAlphabet)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(true);
      });
    return () => controller.abort();
  }, []);

  if (loadError) {
    return (
      <div className="grid min-h-[15rem] place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-bold text-white/80">Signing data is unavailable</p>
          <p className="mt-2 text-xs leading-5 text-white/45">The lesson captions remain available below.</p>
        </div>
      </div>
    );
  }

  if (!alphabet) {
    return (
      <div className="grid min-h-[15rem] place-items-center" role="status">
        <span className="text-xs font-bold text-white/45">Loading signing data…</span>
      </div>
    );
  }

  return <SignPlayback key={transcript} alphabet={alphabet} transcript={transcript} active={active} />;
}

function SignPlayback({ alphabet, transcript, active }: { alphabet: AlphabetPoseData; transcript: string; active: boolean }) {
  const [unitIndex, setUnitIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const holdUntilRef = useRef(0);
  const plan = useMemo(() => buildFingerSpellingPlan(transcript), [transcript]);
  const unit = plan[unitIndex] ?? null;
  const sampledFrames = useMemo(() => {
    const frames = unit ? alphabet[unit.letter] ?? [] : [];
    return frames.filter((_, index) => index === 0 || index === frames.length - 1 || index % 3 === 0);
  }, [alphabet, unit]);

  useEffect(() => {
    if (!active || !unit || sampledFrames.length === 0) return;
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (now < holdUntilRef.current) return;
      setFrameIndex((currentFrame) => {
        if (currentFrame < sampledFrames.length - 1) return currentFrame + 1;
        if (unitIndex >= plan.length - 1) return currentFrame;
        setUnitIndex((currentUnit) => {
          const next = plan[currentUnit + 1];
          const wordChanged = next.wordIndex !== plan[currentUnit].wordIndex;
          holdUntilRef.current = now + playbackDelayMs(1, wordChanged) - sampledFrames.length * FRAME_MS;
          return currentUnit + 1;
        });
        return 0;
      });
    }, FRAME_MS);
    return () => window.clearInterval(timer);
  }, [active, plan, sampledFrames.length, unit, unitIndex]);

  const frame: SignFrame | null = sampledFrames[Math.min(frameIndex, Math.max(0, sampledFrames.length - 1))] ?? null;

  return (
    <div className="relative min-h-[17rem] overflow-hidden bg-[#101519]">
      <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3">
        <div>
          <p className="text-[0.62rem] font-black uppercase tracking-[0.16em] text-[var(--accent-deaf)]">ASL fingerspelling</p>
          <p className="mt-1 max-w-[13rem] truncate text-xs font-semibold text-white/55">{unit?.word ?? "Waiting for the teacher"}</p>
        </div>
        <span className="grid size-9 place-items-center rounded-md border border-white/10 bg-black/35 font-mono text-base font-black text-white">
          {unit?.letter ?? "–"}
        </span>
      </div>

      <div className="absolute inset-0 pt-6">
        <SignHand frame={frame} active={active && Boolean(unit)} />
      </div>

      <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-md border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md">
        <p className="min-w-0 truncate text-[0.68rem] font-semibold text-white/65">
          {active ? unit ? `${unit.word} · letter ${unit.letterIndex + 1} of ${unit.word.length}` : "Caption ready" : "Paused with lesson"}
        </p>
        <span className={`size-2 shrink-0 rounded-full ${active ? "bg-[var(--accent-deaf)]" : "bg-white/25"}`} aria-hidden />
      </div>
    </div>
  );
}
