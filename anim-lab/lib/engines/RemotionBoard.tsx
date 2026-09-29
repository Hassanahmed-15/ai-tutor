"use client";

import React, { useEffect, useMemo, useRef, type ComponentType } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { AbsoluteFill, Easing, Sequence, Series, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FPS, FRAMES_PER_SENTENCE } from "../lecture";
import { BoardError, compileEntry, type EngineProps } from "./shared";

export function RemotionBoard({ code, progress, sentenceIndex, sentenceProgress, sentenceTotal, onError }: EngineProps) {
  const playerRef = useRef<PlayerRef>(null);
  const compiled = useMemo(() => {
    try {
      const scope = { React, AbsoluteFill, Sequence, Series, useCurrentFrame, useVideoConfig, interpolate, spring, Easing, random };
      return { Scene: compileEntry<ComponentType>(code, scope, "Scene"), error: null };
    } catch (err) {
      return { Scene: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);
  useEffect(() => {
    if (compiled.error) onError(compiled.error);
  }, [compiled.error, onError]);

  const duration = sentenceTotal * FRAMES_PER_SENTENCE;
  const frame = progress >= 1 ? duration - 1 : Math.round((sentenceIndex + sentenceProgress) * FRAMES_PER_SENTENCE);
  useEffect(() => {
    playerRef.current?.seekTo(Math.max(0, Math.min(duration - 1, frame)));
  }, [frame, duration, compiled.Scene]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const onPlayerError = (e: { detail: { error: Error } }) => onError(e.detail.error.message);
    player.addEventListener("error", onPlayerError);
    return () => player.removeEventListener("error", onPlayerError);
  }, [compiled.Scene, onError]);

  if (!compiled.Scene) return <BoardError message={compiled.error ?? "no Scene"} />;
  return (
    <Player
      ref={playerRef}
      component={compiled.Scene}
      durationInFrames={duration}
      fps={FPS}
      compositionWidth={1000}
      compositionHeight={560}
      style={{ width: "100%", height: "100%" }}
      controls={false}
      clickToPlay={false}
      errorFallback={({ error }) => <BoardError message={error.message} />}
    />
  );
}
