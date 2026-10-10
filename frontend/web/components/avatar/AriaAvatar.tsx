"use client";

import { useEffect, useRef, useState } from "react";
import { mouthShape, visemeWeights } from "@/lib/adhd/mouth";
import { faceFromVisemes, visemesActive } from "@/lib/avatar/visemes";
import { blinkWeight, composeFrame, easeFrame, expressionTarget, headSway, mouthWeights, nextBlinkDelayMs, type AvatarState, type FaceFrame } from "@/lib/avatar/face";

/**
 * ARIA'S FACE: a Gaussian-splat head of a real person (a photoreal 3D capture, ~4 MB), rendered in
 * the browser by @myned-ai/gsplat-flame-avatar-renderer (MIT), lip-synced from her live voice.
 *
 * HOW IT MOVES. Every chunk of Aria's speech already plays through one audio bus with an analyser on
 * it (lib/adhd/mouth.ts); this reads that mouth shape once per frame and turns it into the head's 52
 * ARKit blendshapes (lib/avatar/face.ts), adds a blink, a brow for her state, and a slow head sway,
 * and hands the frame to the renderer. Barge-in needs nothing extra: the analyser publishes a closed
 * mouth the moment the audio stops.
 *
 * WHAT IT COSTS. Nothing per minute: the student's GPU draws her. WebGL2 is required; where it is
 * missing, or the head fails to load, `onUnavailable` fires and the caller shows the orb instead.
 */

export type AriaHead = "Jane" | "Sasha" | "Jack" | "John";
export const ARIA_HEADS: AriaHead[] = ["Jane", "Sasha", "Jack", "John"];
export const DEFAULT_HEAD: AriaHead = "Jane";

type Renderer = { dispose?: () => void; viewer?: { camera?: { isPerspectiveCamera?: boolean; aspect: number; setViewOffset: (fw: number, fh: number, x: number, y: number, w: number, h: number) => void } } };

/** The renderer's states; speaking plays the talk clips, everything else the idle loop. */
const RENDERER_STATE: Record<AvatarState, string> = { idle: "Idle", listening: "Listening", thinking: "Thinking", speaking: "Responding" };

/** How the camera crops to the bust: the bundle leaves a lot of empty scene around the head. */
const FRAME = { centerY: 0.47, height: 0.44 };

export function AriaAvatar({
  state,
  head = DEFAULT_HEAD,
  background,
  transparent = false,
  className = "",
  onReady,
  onUnavailable,
}: {
  state: AvatarState;
  head?: AriaHead;
  /** Hex like "0x0A0A14"; omitted = the renderer's default (black). Ignored when `transparent`. */
  background?: string;
  /**
   * Draw her as a cutout on whatever is behind: the renderer always clears to an opaque colour, so
   * while it creates its context the canvas is asked for alpha and its clear is forced to transparent
   * (the trick gsplat-talkinghead uses). Only the canvas inside this host is affected.
   */
  transparent?: boolean;
  className?: string;
  onReady?: () => void;
  onUnavailable?: (reason: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<AvatarState>(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let renderer: Renderer | null = null;
    let cancelled = false;

    // Per-frame animation state, kept out of React.
    let expression: FaceFrame = {};
    let lastFrameAt = performance.now();
    let blinkStartedAt = performance.now() + nextBlinkDelayMs("idle");
    const swayPhase: [number, number, number] = [Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28];
    const t0 = performance.now();

    const frame = (): FaceFrame => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;
      const s = stateRef.current;
      expression = easeFrame(expression, expressionTarget(s), Math.min(1, dt * 6));
      const since = now - blinkStartedAt;
      let blink = 0;
      if (since >= 0) {
        blink = blinkWeight(since);
        if (since > 180) blinkStartedAt = now + nextBlinkDelayMs(s);
      }
      // The visemes when the listener hears them (which sound), else the loudness mouth (how much).
      const mouth = mouthShape();
      const live = visemeWeights();
      return composeFrame(expression, visemesActive(live) ? faceFromVisemes(live, Math.min(1, mouth.open * 1.6 + 0.2)) : mouthWeights(mouth), blink);
    };

    const canRender = (() => {
      try {
        const c = document.createElement("canvas");
        return Boolean(c.getContext("webgl2"));
      } catch {
        return false;
      }
    })();
    if (!canRender) {
      queueMicrotask(() => {
        setStatus("failed");
        onUnavailable?.("WebGL2 is not available");
      });
      return;
    }

    (async () => {
      try {
        const mod = await import("@myned-ai/gsplat-flame-avatar-renderer");
        if (cancelled) return;
        // `create` makes an isolated instance (v1.0.6+); the typings only declare the singleton `getInstance`.
        const Factory = mod.GaussianSplatRenderer as unknown as { create: (host: HTMLDivElement, asset: string, options: object) => Promise<unknown> };
        const restore = transparent ? forceTransparentCanvas(host) : null;
        let created: Renderer;
        try {
          created = (await Factory.create(host, `/avatars/${head}.zip`, {
          backgroundColor: transparent ? undefined : background,
          getChatState: () => RENDERER_STATE[stateRef.current],
          getExpressionData: frame,
          getNeckPose: () => ({ neck: headSway((performance.now() - t0) / 1000, stateRef.current, mouthShape().open, swayPhase) }),
          // Mutual gaze: the renderer solves the eye-look shapes so her eyes stay on the camera, whatever the head does.
          getGazeOffset: () => ({ yawDeg: 0, pitchDeg: 0 }),
          loadProgress: (p: number) => setProgress(Math.round(p)),
          })) as unknown as Renderer;
        } finally {
          restore?.();
        }
        if (cancelled) {
          created.dispose?.();
          return;
        }
        renderer = created;
        // Crop the camera to the bust so the face fills the tile.
        const camera = created.viewer?.camera;
        if (camera?.isPerspectiveCamera) {
          const zoom = 1 / FRAME.height;
          const aspect = camera.aspect;
          camera.setViewOffset(aspect * zoom, zoom, (aspect * zoom - aspect) / 2, FRAME.centerY * zoom - 0.5, aspect, 1);
        }
        setStatus("ready");
        onReady?.();
      } catch (error) {
        if (cancelled) return;
        console.warn("[avatar] could not load Aria's face:", error);
        setStatus("failed");
        onUnavailable?.(error instanceof Error ? error.message : "load failed");
      }
    })();

    return () => {
      cancelled = true;
      try {
        renderer?.dispose?.();
      } catch {
        // The renderer may already have torn itself down.
      }
      // The renderer appends its own canvas; leave the host clean for a remount.
      while (host.firstChild) host.removeChild(host.firstChild);
    };
    // A new head or background rebuilds the renderer; state changes are read per frame via the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head, background, transparent]);

  return (
    <div className={`relative overflow-hidden ${className}`} aria-label="Aria" role="img">
      <div ref={hostRef} className="absolute inset-0 [&>canvas]:!h-full [&>canvas]:!w-full" />
      {status === "loading" && (
        <div className="absolute inset-0 grid place-items-center" aria-live="polite">
          <span className="aria-breathe size-3 rounded-full bg-[var(--hud-cyan)]" />
          <span className="sr-only">Loading Aria{progress ? `, ${progress}%` : ""}</span>
        </div>
      )}
    </div>
  );
}

/**
 * While the renderer sets up, any WebGL context made for a canvas inside `host` gets an alpha
 * channel and a transparent clear colour, whatever the renderer asks for. Returns the undo.
 */
function forceTransparentCanvas(host: HTMLElement): () => void {
  const original = HTMLCanvasElement.prototype.getContext;
  const patched = function (this: HTMLCanvasElement, id: string, attributes?: unknown) {
    if (!id.startsWith("webgl") || !host.contains(this)) return original.call(this, id, attributes as never);
    const gl = original.call(this, id, { ...(attributes as object), alpha: true, premultipliedAlpha: true } as never) as WebGLRenderingContext | null;
    if (gl) {
      const clearColor = gl.clearColor.bind(gl);
      gl.clearColor = () => clearColor(0, 0, 0, 0);
    }
    return gl;
  };
  HTMLCanvasElement.prototype.getContext = patched as typeof HTMLCanvasElement.prototype.getContext;
  return () => {
    if (HTMLCanvasElement.prototype.getContext === patched) HTMLCanvasElement.prototype.getContext = original;
  };
}
