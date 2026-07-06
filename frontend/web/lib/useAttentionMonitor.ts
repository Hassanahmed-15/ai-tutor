"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

/**
 * Real camera-based attention monitoring for the ADHD track — MediaPipe's Face Landmarker
 * runs entirely client-side (WASM), so no video frame ever leaves the device. Scores three
 * signals every frame: face presence (looked away entirely), head-pose yaw/pitch deviation
 * (posture/gaze proxy — a turned head usually means attention moved elsewhere), and blink
 * rate (a stalled or racing blink rate both correlate with disengagement). These combine
 * into one EMA-smoothed engagement score so a single blink or a quick glance away doesn't
 * false-trigger — `drifting` only flips once the score is sustained below threshold.
 */

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const WASM_BASE_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

// MediaPipe's WASM runtime logs routine startup/per-frame info (e.g. "INFO: Created
// TensorFlow Lite XNNPACK delegate for CPU.") through console.error instead of
// console.info — a known quirk of their build. Next.js's dev overlay treats any
// console.error as a crashing error and takes over the whole page with a red overlay,
// which blocks the rest of the app (including audio) until dismissed. We filter out only
// lines matching this known-benign MediaPipe pattern; everything else still reaches the
// real console.error untouched.
const MEDIAPIPE_BENIGN_LOG = /^(INFO|WARNING):/;

const EMA_ALPHA = 0.12; // smoothing factor — lower = slower to react, fewer false triggers
const DRIFT_THRESHOLD = 0.7; // engagement at/below this counts as "not engaged"
const DRIFT_SUSTAIN_MS = 0; // 0 = trigger instantly the moment engagement hits the threshold
const RECOVER_SUSTAIN_MS = 900; // must stay above threshold this long before clearing `drifting`
const BLINK_WINDOW_MS = 10000;
const BLINK_CLOSED_THRESHOLD = 0.5; // blendshape score above this counts as "eyes closed" this frame

export interface AttentionState {
  /** 0 (fully disengaged) to 1 (fully engaged), EMA-smoothed. */
  engagement: number;
  /** True once disengagement has been sustained long enough to act on. */
  drifting: boolean;
  /** True once the model is loaded and the camera is streaming. */
  ready: boolean;
  /** Set if camera permission was denied or the model/camera failed — player should fall
   *  back to manual-only operation, never block on this. */
  error: string | null;
}

export function useAttentionMonitor(enabled: boolean): AttentionState {
  const [state, setState] = useState<AttentionState>({ engagement: 1, drifting: false, ready: false, error: null });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  const emaRef = useRef(1);
  const blinkTimesRef = useRef<number[]>([]);
  const wasClosedRef = useRef(false);
  const belowSinceRef = useRef<number | null>(null);
  const aboveSinceRef = useRef<number | null>(null);
  const drivingRef = useRef(false);

  const stop = useCallback(() => {
    cancelledRef.current = true;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string" && MEDIAPIPE_BENIGN_LOG.test(args[0])) return;
      originalConsoleError(...args);
    };

    cancelledRef.current = false;
    emaRef.current = 1;
    blinkTimesRef.current = [];
    wasClosedRef.current = false;
    belowSinceRef.current = null;
    aboveSinceRef.current = null;
    drivingRef.current = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
        if (cancelledRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;

        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        videoRef.current = video;

        const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
        const landmarker = await FaceLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        });
        if (cancelledRef.current) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;

        setState((s) => ({ ...s, ready: true, error: null }));
        const loop = () => {
          if (cancelledRef.current || !videoRef.current || !landmarkerRef.current) return;
          const now = performance.now();
          const result = landmarkerRef.current.detectForVideo(videoRef.current, now);
          const frameScore = scoreFrame(result, now, blinkTimesRef, wasClosedRef);
          emaRef.current = EMA_ALPHA * frameScore + (1 - EMA_ALPHA) * emaRef.current;

          let drifting = drivingRef.current;
          if (emaRef.current <= DRIFT_THRESHOLD) {
            aboveSinceRef.current = null;
            if (belowSinceRef.current === null) belowSinceRef.current = now;
            if (!drifting && now - belowSinceRef.current >= DRIFT_SUSTAIN_MS) drifting = true;
          } else {
            belowSinceRef.current = null;
            if (aboveSinceRef.current === null) aboveSinceRef.current = now;
            if (drifting && now - aboveSinceRef.current >= RECOVER_SUSTAIN_MS) drifting = false;
          }
          drivingRef.current = drifting;

          setState({ engagement: emaRef.current, drifting, ready: true, error: null });
          rafRef.current = requestAnimationFrame(loop);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelledRef.current) return;
        const message =
          err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
            ? "Camera permission was denied."
            : "Couldn't start the camera or load the attention model.";
        setState({ engagement: 1, drifting: false, ready: false, error: message });
      }
    })();

    return () => {
      stop();
      console.error = originalConsoleError;
      setState({ engagement: 1, drifting: false, ready: false, error: null });
    };
  }, [enabled, stop]);

  return state;
}

/** Scores one frame 0 (disengaged) to 1 (engaged) from face presence, head pose, and blink rate. */
function scoreFrame(
  result: import("@mediapipe/tasks-vision").FaceLandmarkerResult,
  now: number,
  blinkTimesRef: { current: number[] },
  wasClosedRef: { current: boolean }
): number {
  if (!result.faceLandmarks || result.faceLandmarks.length === 0) return 0; // looked away entirely

  let poseScore = 1;
  const matrix = result.facialTransformationMatrixes?.[0];
  if (matrix && matrix.data.length >= 16) {
    const m = matrix.data;
    // Approximate yaw/pitch from the rotation sub-matrix (row-major 4x4).
    const yaw = Math.atan2(m[2], m[10]); // m[2,0] over m[2,2]
    const pitch = Math.atan2(-m[6], m[10]); // -m[2,1] over m[2,2]
    const deviation = Math.abs(yaw) + Math.abs(pitch) * 0.7;
    poseScore = Math.max(0, 1 - deviation / 0.9); // ~50 degrees of combined deviation -> 0
  }

  let blinkScore = 1;
  const blendshapes = result.faceBlendshapes?.[0]?.categories;
  if (blendshapes) {
    const left = blendshapes.find((c) => c.categoryName === "eyeBlinkLeft")?.score ?? 0;
    const right = blendshapes.find((c) => c.categoryName === "eyeBlinkRight")?.score ?? 0;
    const closed = (left + right) / 2 > BLINK_CLOSED_THRESHOLD;
    if (closed && !wasClosedRef.current) blinkTimesRef.current.push(now);
    wasClosedRef.current = closed;
    blinkTimesRef.current = blinkTimesRef.current.filter((t) => now - t < BLINK_WINDOW_MS);
    const blinksPerMin = blinkTimesRef.current.length * (60000 / BLINK_WINDOW_MS);
    // Normal blink rate is roughly 12-20/min; well outside that (staring/zoning out, or
    // rapid fluttering) both read as lower engagement.
    blinkScore = blinksPerMin >= 6 && blinksPerMin <= 30 ? 1 : 0.55;
  }

  return poseScore * 0.7 + blinkScore * 0.3;
}
