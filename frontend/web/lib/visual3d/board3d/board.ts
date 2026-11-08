// The board interface templates draw on. Coordinates are maths coordinates: right-handed, z up.
// Two implementations: ThreeBoard (browser, three.js) and RecordingBoard (Node tests). Templates
// never touch three.js directly, so their logic and actions are testable without a GPU.
import type { ColorToken } from "../theme.ts";

export type Vec3 = [number, number, number];
export type CameraPreset = "front" | "iso" | "top" | "side";
export type Shape = "sphere" | "box" | "cylinder" | "cone";
export type SolidShape = "box" | "cylinder" | "cone" | "sphere" | "hemisphere" | "prism3" | "pyramid4" | "tetrahedron" | "octahedron" | "dodecahedron" | "icosahedron";

export interface AnimOpts {
  animate?: boolean;
  ms?: number;
}

export interface Board {
  /** Scratch state for the template that owns the board (cleared with the board). */
  state: Record<string, unknown>;
  reducedMotion: boolean;
  speed: number;

  clear(): void;
  has(id: string): boolean;
  remove(id: string): void;
  setCamera(preset: CameraPreset, target?: Vec3): void;
  /** Frame these points so they fill the view. */
  fit(points: Vec3[], preset?: CameraPreset): void;
  caption(text: string): void;

  axes(id: string, opts: { size: number; labels?: [string, string, string]; negative?: boolean }): void;
  grid(id: string, opts: { size: number; step?: number; z?: number }): void;
  node(id: string, opts: { at: Vec3; label?: string; color?: ColorToken; shape?: Shape; size?: number }): void;
  /** inside: write the label on the box (cells, stack items) instead of above it. */
  box(id: string, opts: { at: Vec3; size: Vec3; color?: ColorToken; label?: string; opacity?: number; inside?: boolean }): void;
  arrow(id: string, opts: { from: Vec3; to: Vec3; color?: ColorToken; label?: string; width?: number }): void;
  line(id: string, opts: { points: Vec3[]; color?: ColorToken; dashed?: boolean; width?: number }): void;
  polygon(id: string, opts: { points: Vec3[]; color?: ColorToken; opacity?: number }): void;
  surface(id: string, opts: { f: (x: number, y: number) => number; x: [number, number]; y: [number, number]; n: number; wireframe?: boolean; opacity?: number; zClip?: number }): void;
  points(id: string, opts: { points: Vec3[]; color?: ColorToken; size?: number }): void;
  label(id: string, opts: { at: Vec3; text: string; color?: ColorToken; small?: boolean }): void;
  /** Many thin line segments in one draw call (level curves, vector fields, wireframes). */
  segments(id: string, opts: { pairs: [Vec3, Vec3][]; color?: ColorToken; opacity?: number }): void;
  /** A ready-made solid with its edges outlined. dims: box [l,w,h]; cylinder/cone [r,h]; sphere/hemisphere [r]; others [size]. */
  solid(id: string, opts: { shape: SolidShape; dims: number[]; at?: Vec3; color?: ColorToken; opacity?: number; label?: string }): void;

  setColor(id: string, color: ColorToken, opts?: AnimOpts): Promise<void>;
  setLabel(id: string, text: string): void;
  move(id: string, to: Vec3, opts?: AnimOpts): Promise<void>;
  pulse(id: string, opts?: AnimOpts): Promise<void>;
  /** Run fn(t) for t from 0 to 1 over ms (scaled by speed; instant under reduced motion). */
  tween(ms: number, fn: (t: number) => void): Promise<void>;
}

export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
