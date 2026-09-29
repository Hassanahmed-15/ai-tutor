"use client";

// The production renderer, imported read-only from frontend/web (tsconfig maps @/* there).
import { ReactAnimationSandbox } from "@/components/sketch/ReactAnimationSandbox";
import type { EngineProps } from "./shared";

export function SandboxBoard({ code, progress, sentenceIndex, sentenceProgress, sentenceTotal, playing, assetIds, onError }: EngineProps) {
  return (
    <ReactAnimationSandbox
      code={code}
      progress={progress}
      sentenceIndex={sentenceIndex}
      sentenceProgress={sentenceProgress}
      sentenceTotal={sentenceTotal}
      assetIds={assetIds}
      settled={!playing}
      onError={() => onError("the production sandbox reported a render failure")}
    />
  );
}
