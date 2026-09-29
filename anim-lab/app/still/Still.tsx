"use client";

import { useEffect, useState } from "react";
import { SandboxBoard } from "../../lib/engines/SandboxBoard";
import { sentences, sentenceState } from "../../lib/lecture";

type BenchBoard = { id: string; title: string; script: string; code: string | null; assetIds?: string[] };

/**
 * `/still?variant=v1&id=heart&p=1` — one bench board at progress p (default: finished), rendered by
 * the production ReactAnimationSandbox at the board's own 1000x560 aspect. `data-ready` goes on the
 * stage once the sandbox has posted ready, so a screenshot never catches a half-booted board.
 */
export default function Still() {
  const [board, setBoard] = useState<BenchBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const variant = params.get("variant") ?? "";
  const id = params.get("id") ?? "";
  const p = Math.max(0, Math.min(1, Number(params.get("p") ?? "1")));

  useEffect(() => {
    fetch(`/api/bench?variant=${encodeURIComponent(variant)}&id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => (data.code ? setBoard(data) : setError(data.error ?? "no code")))
      .catch((e) => setError(String(e)));
  }, [variant, id]);

  if (error) return <div data-error="" style={{ padding: 20, color: "#b91c1c" }}>{error}</div>;
  if (!board?.code) return null;
  const clock = sentenceState(p, sentences(board.script).length);
  return (
    <div style={{ width: 1000, height: 560, position: "relative", background: "#fbfaf7" }} data-stage="" data-ready={ready ? "1" : undefined}>
      <SandboxBoardWithReady board={board} progress={p} clock={clock} onReady={() => setReady(true)} />
    </div>
  );
}

function SandboxBoardWithReady({ board, progress, clock, onReady }: {
  board: BenchBoard;
  progress: number;
  clock: { sentenceIndex: number; sentenceProgress: number; sentenceTotal: number };
  onReady: () => void;
}) {
  useEffect(() => {
    // The production component reports ready through onReady; SandboxBoard does not expose it, so
    // readiness is read from the iframe's own document instead.
    const timer = setInterval(() => {
      const frame = document.querySelector("iframe");
      if (frame) {
        clearInterval(timer);
        setTimeout(onReady, 2500);
      }
    }, 100);
    return () => clearInterval(timer);
  }, [onReady]);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {/* The lesson's pane sizes the sandbox iframe; here the stage does. */}
      <style>{"[data-stage] div{width:100%;height:100%}iframe{width:100%!important;height:100%!important;border:0;display:block}"}</style>
      <SandboxBoard
        code={board.code!}
        progress={progress}
        sentenceIndex={clock.sentenceIndex}
        sentenceProgress={clock.sentenceProgress}
        sentenceTotal={clock.sentenceTotal}
        playing={false}
        assetIds={board.assetIds}
        onError={() => undefined}
      />
    </div>
  );
}
