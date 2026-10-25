"use client";

import { useEffect, useState } from "react";
import { LessonCanvas } from "@/components/canvas/LessonCanvas";
import type { CanvasBoardSpec } from "@/lib/canvas/types";

/**
 * ONE FINISHED BOARD, DRAWN BY THE REAL BOARD CODE — for the eyes that check every board before a student
 * sees it (lib/canvas/boardLook.ts; owner, 2026-10-23: "100 percent accurate diagrams", a vision check on
 * every board, rendered in a real browser). The board is handed in by the headless browser that opens
 * this page (window.__board); the page holds no data of its own and needs no account. Everything the
 * student would see on the finished board is drawn — the runtime guards that move writing apart included
 * — and nothing else: the player's controls and board map are hidden. When fonts and pictures are in and
 * the guards have settled, the page marks itself ready (body[data-board-ready]).
 */
/** `sentence`/`progress` (QA only): the board part-way through, the pointer where it is then; omitted, it is finished. */
type Given = { spec: CanvasBoardSpec; topic?: string; sentence?: number; progress?: number };

export default function BoardRender() {
  const [board, setBoard] = useState<Given | null>(null);
  useEffect(() => {
    const given = (window as unknown as { __board?: Given }).__board;
    if (given?.spec) queueMicrotask(() => setBoard(given));
  }, []);
  useEffect(() => {
    if (!board) return;
    let cancelled = false;
    void (async () => {
      await document.fonts.ready.catch(() => undefined);
      // Pictures inside the board: each one decoded before the picture is taken.
      const images = [...document.querySelectorAll("img")];
      await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
      // The marker puts a finished board up at once; the text guards move writing apart over a few frames.
      await new Promise((resolve) => setTimeout(resolve, 1800));
      if (!cancelled) document.body.dataset.boardReady = "1";
    })();
    return () => {
      cancelled = true;
    };
  }, [board]);
  if (!board) return <div data-board-empty style={{ position: "fixed", inset: 0, background: "#000" }} />;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0b0f14" }}>
      <style>{`[aria-label="Lesson canvas"] > :not(svg):not(style) { display: none !important; }`}</style>
      <LessonCanvas
        panels={[{ key: "board", spec: board.spec }]}
        currentIndex={0}
        sentence={board.sentence ?? Number.MAX_SAFE_INTEGER}
        sentenceProgress={board.progress ?? 1}
        finished={board.sentence === undefined}
        waitingForStudent={false}
        playing={board.sentence !== undefined}
        topic={board.topic ?? board.spec.heading}
        onSpeak={() => {}}
        onTellAria={() => {}}
        onContinue={() => {}}
      />
    </div>
  );
}
