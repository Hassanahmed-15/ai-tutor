// A headless Board for Node tests: it records every object and operation instead of drawing, so
// template logic, steps and actions can be checked without a browser or GPU.
import type { AnimOpts, Board, CameraPreset, Vec3 } from "./board.ts";
import type { ColorToken } from "../theme.ts";

export interface Recorded {
  kind: string;
  props: Record<string, unknown>;
}

export class RecordingBoard implements Board {
  state: Record<string, unknown> = {};
  reducedMotion = true;
  speed = 1;
  objects = new Map<string, Recorded>();
  log: string[] = [];
  captions: string[] = [];
  camera: CameraPreset = "iso";

  private put(id: string, kind: string, props: Record<string, unknown>) {
    this.objects.set(id, { kind, props: { ...props } });
    this.log.push(`${kind}:${id}`);
  }
  clear() {
    this.objects.clear();
    this.state = {};
    this.log.push("clear");
  }
  has(id: string) { return this.objects.has(id); }
  remove(id: string) {
    this.objects.delete(id);
    this.log.push(`remove:${id}`);
  }
  setCamera(preset: CameraPreset) { this.camera = preset; }
  fit(_points: Vec3[], preset?: CameraPreset) { if (preset) this.camera = preset; }
  caption(text: string) { this.captions.push(text); }

  axes(id: string, o: object) { this.put(id, "axes", o as Record<string, unknown>); }
  grid(id: string, o: object) { this.put(id, "grid", o as Record<string, unknown>); }
  node(id: string, o: object) { this.put(id, "node", o as Record<string, unknown>); }
  box(id: string, o: object) { this.put(id, "box", o as Record<string, unknown>); }
  arrow(id: string, o: object) { this.put(id, "arrow", o as Record<string, unknown>); }
  line(id: string, o: object) { this.put(id, "line", o as Record<string, unknown>); }
  polygon(id: string, o: object) { this.put(id, "polygon", o as Record<string, unknown>); }
  surface(id: string, o: { f: (x: number, y: number) => number; x: [number, number]; y: [number, number]; n: number }) {
    // Sample it, as the real board would, so a bad function shows up in tests.
    let finite = 0;
    for (let i = 0; i <= o.n; i++) for (let j = 0; j <= o.n; j++) {
      const v = o.f(o.x[0] + ((o.x[1] - o.x[0]) * i) / o.n, o.y[0] + ((o.y[1] - o.y[0]) * j) / o.n);
      if (Number.isFinite(v)) finite++;
    }
    this.put(id, "surface", { ...o, finiteSamples: finite });
  }
  points(id: string, o: { points: Vec3[] }) { this.put(id, "points", { count: o.points.length }); }
  label(id: string, o: object) { this.put(id, "label", o as Record<string, unknown>); }
  segments(id: string, o: { pairs: unknown[] }) { this.put(id, "segments", { count: o.pairs.length }); }
  solid(id: string, o: object) { this.put(id, "solid", o as Record<string, unknown>); }

  async setColor(id: string, color: ColorToken, _o?: AnimOpts) {
    const r = this.objects.get(id);
    if (!r) throw new Error(`no object "${id}"`);
    r.props.color = color;
    this.log.push(`color:${id}:${color}`);
  }
  setLabel(id: string, text: string) {
    const r = this.objects.get(id);
    if (!r) throw new Error(`no object "${id}"`);
    r.props.label = text;
  }
  async move(id: string, to: Vec3, _o?: AnimOpts) {
    const r = this.objects.get(id);
    if (!r) throw new Error(`no object "${id}"`);
    r.props.at = to;
    this.log.push(`move:${id}`);
  }
  async pulse(id: string) { this.log.push(`pulse:${id}`); }
  async tween(_ms: number, fn: (t: number) => void) { fn(1); }
}
