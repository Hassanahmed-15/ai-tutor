"use client";

import { useEffect, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";
import { FRAMES_PER_SENTENCE } from "../lecture";
import { BoardError, type EngineProps } from "./shared";

export function LottieBoard({ code, progress, sentenceIndex, sentenceProgress, sentenceTotal, onError }: EngineProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    setError(null);
    const fail = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      onError(message);
    };
    // lottie-web touches `document` on import, so it is loaded only in the browser.
    import("lottie-web").then(({ default: lottie }) => {
      if (cancelled) return;
      try {
        root.innerHTML = "";
        const anim = lottie.loadAnimation({
          container: root,
          renderer: "svg",
          loop: false,
          autoplay: false,
          animationData: JSON.parse(code),
          rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
        });
        anim.addEventListener("error", () => fail("lottie-web reported an error"));
        animRef.current = anim;
        setLoaded((n) => n + 1);
      } catch (err) {
        fail(err);
      }
    }, fail);
    return () => {
      cancelled = true;
      animRef.current?.destroy();
      animRef.current = null;
    };
  }, [code, onError]);

  useEffect(() => {
    const anim = animRef.current;
    if (!anim) return;
    const last = Math.max(0, anim.totalFrames - 1);
    const frame = progress >= 1 ? last : Math.min(last, (sentenceIndex + sentenceProgress) * FRAMES_PER_SENTENCE);
    try {
      anim.goToAndStop(frame, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [progress, sentenceIndex, sentenceProgress, sentenceTotal, loaded]);

  return (
    <>
      <div ref={rootRef} className="fill lottie-bg" />
      {error ? <BoardError message={error} /> : null}
    </>
  );
}
