"use client";

import React, { useEffect, useMemo, type ComponentType } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { BoardBoundary, BoardError, compileEntry, type EngineProps } from "./shared";

type BoardFn = ComponentType<{ step: number; sentenceProgress: number }>;

export function MotionBoard({ code, progress, sentenceIndex, sentenceProgress, sentenceTotal, onError }: EngineProps) {
  const compiled = useMemo(() => {
    try {
      return { Board: compileEntry<BoardFn>(code, { React, motion, AnimatePresence, useReducedMotion }, "Board"), error: null };
    } catch (err) {
      return { Board: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [code]);
  useEffect(() => {
    if (compiled.error) onError(compiled.error);
  }, [compiled.error, onError]);

  if (!compiled.Board) return <BoardError message={compiled.error ?? "no Board"} />;
  const Board = compiled.Board;
  return (
    <BoardBoundary onError={onError} resetKey={code}>
      <Board step={progress >= 1 ? sentenceTotal : sentenceIndex} sentenceProgress={sentenceProgress} />
    </BoardBoundary>
  );
}
