"use client";

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { MotionPathPlugin } from "gsap/MotionPathPlugin";
import { BoardError, compileEntry, type EngineProps } from "./shared";

gsap.registerPlugin(DrawSVGPlugin, MorphSVGPlugin, MotionPathPlugin);

type BuildFn = (root: HTMLElement, g: typeof gsap) => gsap.core.Timeline;

/** Where sentence k (at fraction f) sits on the timeline: between its label and the next one. */
function timeFor(tl: gsap.core.Timeline, k: number, f: number, total: number): number {
  const dur = tl.duration();
  const at = (i: number) => tl.labels[`s${i}`] ?? (dur * i) / total;
  const start = at(k);
  const end = k + 1 < total ? at(k + 1) : tl.labels.end ?? dur;
  return Math.min(dur, start + Math.max(0, end - start) * f);
}

export function GsapBoard({ code, progress, sentenceIndex, sentenceProgress, sentenceTotal, onError }: EngineProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    setError(null);
    root.innerHTML = "";
    let ctx: gsap.Context | null = null;
    try {
      const build = compileEntry<BuildFn>(code, {}, "build");
      ctx = gsap.context(() => {
        const tl = build(root, gsap);
        if (!tl || typeof tl.seek !== "function") throw new Error("build() did not return a GSAP timeline");
        tl.pause(0);
        tlRef.current = tl;
      }, root);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onError(message);
    }
    return () => {
      tlRef.current = null;
      ctx?.revert();
    };
  }, [code, onError]);

  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    tl.seek(progress >= 1 ? tl.duration() : timeFor(tl, sentenceIndex, sentenceProgress, sentenceTotal), false);
  }, [progress, sentenceIndex, sentenceProgress, sentenceTotal, error]);

  return (
    <>
      <div ref={rootRef} className="fill" />
      {error ? <BoardError message={error} /> : null}
    </>
  );
}
