// The browser Board, on three.js 0.186.1 (pinned). Maths coordinates with z up; labels are real HTML
// (CSS2DRenderer) so they stay sharp and readable; renders only when something changed; disposes
// every geometry and material it made when an object is removed or the board is cleared.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js";
import { COLOR, FONT, MAX_PIXEL_RATIO, SIZE, STATE_MARK, type ColorToken } from "../theme";
import { ease, type AnimOpts, type Board, type CameraPreset, type Shape, type SolidShape, type Vec3 } from "./board";

interface Entry { obj: THREE.Object3D; color?: ColorToken; labelEl?: HTMLElement; labelText?: string }

const V = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const DIRS: Record<CameraPreset, Vec3> = { iso: [1.05, -1.25, 0.85], front: [0, -1, 0.18], top: [0.001, -0.02, 1], side: [1, 0, 0.18] };

export class ThreeBoard implements Board {
  state: Record<string, unknown> = {};
  reducedMotion: boolean;
  speed = 1;
  onCaption: (text: string) => void = () => {};
  private renderer: THREE.WebGLRenderer;
  private labels: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private objects = new Map<string, Entry>();
  private dirty = true;
  private raf = 0;
  private resize: ResizeObserver;
  private host: HTMLElement;

  static supported(): boolean {
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch {
      return false;
    }
  }

  constructor(host: HTMLElement, opts: { reducedMotion?: boolean } = {}) {
    this.host = host;
    this.reducedMotion = opts.reducedMotion ?? matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO));
    this.renderer.setClearColor(COLOR.board);
    this.labels = new CSS2DRenderer();
    Object.assign(this.labels.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.append(this.renderer.domElement, this.labels.domElement);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 500);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.reducedMotion;
    this.controls.addEventListener("change", () => (this.dirty = true));
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(4, -6, 9);
    this.scene.add(sun);
    this.resize = new ResizeObserver(() => this.layout());
    this.resize.observe(host);
    this.layout();
    this.setCamera("iso");
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      if (this.controls.enableDamping) this.controls.update();
      if (!this.dirty) return;
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
    };
    loop();
  }

  private layout() {
    const w = this.host.clientWidth || 640, h = this.host.clientHeight || 480;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }

  /** GPU memory in use (for leak tests). */
  memory() { return { ...this.renderer.info.memory, objects: this.objects.size }; }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resize.disconnect();
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }

  // ── Bookkeeping ──────────────────────────────────────────────────────────────────────────────
  private put(id: string, obj: THREE.Object3D, color?: ColorToken, label?: string, labelAt?: Vec3) {
    if (this.objects.has(id)) this.remove(id);
    const e: Entry = { obj, color };
    // An empty label still gets an element, so a step can fill it in later.
    if (label !== undefined) {
      const el = document.createElement("div");
      el.className = "b3-label";
      Object.assign(el.style, { font: `${SIZE.label}px ${FONT}`, color: COLOR.text, textShadow: "0 0 3px #000, 0 0 4px #000", whiteSpace: "nowrap" });
      const l = new CSS2DObject(el);
      if (labelAt) l.position.copy(V(labelAt).sub(obj.position));
      obj.add(l);
      e.labelEl = el;
      e.labelText = label;
    }
    this.objects.set(id, e);
    this.scene.add(obj);
    this.paintLabel(e);
    this.dirty = true;
  }

  private paintLabel(e: Entry) {
    if (!e.labelEl) return;
    const mark = e.color ? STATE_MARK[e.color] : undefined;
    e.labelEl.textContent = mark ? `${mark} ${e.labelText}` : e.labelText ?? "";
  }

  has(id: string) { return this.objects.has(id); }

  remove(id: string) {
    const e = this.objects.get(id);
    if (!e) return;
    this.scene.remove(e.obj);
    e.obj.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mat of mats) mat.dispose();
    });
    this.objects.delete(id);
    this.dirty = true;
  }

  clear() {
    for (const id of [...this.objects.keys()]) this.remove(id);
    this.state = {};
  }

  private mat(color: ColorToken = "idle", opacity = 1) {
    return new THREE.MeshStandardMaterial({ color: COLOR[color], roughness: 0.55, metalness: 0.05, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity >= 1 });
  }

  private rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(len, 1e-6), 10), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  }

  // ── Camera and caption ───────────────────────────────────────────────────────────────────────
  setCamera(preset: CameraPreset, target: Vec3 = [0, 0, 0]) {
    const d = this.camera.position.distanceTo(this.controls.target) || 12;
    this.controls.target.copy(V(target));
    this.camera.position.copy(V(target).add(V(DIRS[preset]).normalize().multiplyScalar(d)));
    this.controls.update();
    this.dirty = true;
  }

  fit(points: Vec3[], preset: CameraPreset = "iso") {
    const box = new THREE.Box3().setFromPoints(points.map(V));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.min(1, this.camera.aspect);
    const dist = (Math.max(sphere.radius, 0.5) / Math.sin((fov * aspect) / 2)) * 1.08;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center.clone().add(V(DIRS[preset]).normalize().multiplyScalar(dist)));
    this.controls.update();
    this.dirty = true;
  }

  caption(text: string) { this.onCaption(text); }

  // ── Objects ──────────────────────────────────────────────────────────────────────────────────
  axes(id: string, o: { size: number; labels?: [string, string, string]; negative?: boolean }) {
    const g = new THREE.Group();
    const names = o.labels ?? ["x", "y", "z"];
    (["x", "y", "z"] as const).forEach((axis, k) => {
      const end: Vec3 = [0, 0, 0];
      end[k] = o.size;
      const start: Vec3 = [0, 0, 0];
      if (o.negative) start[k] = -o.size;
      g.add(this.rod(V(start), V(end), 0.018, this.mat(axis)));
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 14), this.mat(axis));
      head.position.copy(V(end));
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), V(end).normalize());
      g.add(head);
      const el = document.createElement("div");
      el.textContent = names[k];
      Object.assign(el.style, { font: `${SIZE.label}px ${FONT}`, color: COLOR[axis] });
      const l = new CSS2DObject(el);
      l.position.copy(V(end).multiplyScalar(1.1));
      g.add(l);
    });
    this.put(id, g);
  }

  grid(id: string, o: { size: number; step?: number; z?: number }) {
    const n = Math.round((2 * o.size) / (o.step ?? 1));
    const g = new THREE.GridHelper(2 * o.size, n, COLOR.muted, COLOR.muted);
    g.rotation.x = Math.PI / 2;
    g.position.z = o.z ?? 0;
    (g.material as THREE.Material).transparent = true;
    (g.material as THREE.Material).opacity = 0.35;
    this.put(id, g);
  }

  node(id: string, o: { at: Vec3; label?: string; color?: ColorToken; shape?: Shape; size?: number }) {
    const s = o.size ?? SIZE.node;
    const geo = { sphere: () => new THREE.SphereGeometry(s, 24, 16), box: () => new THREE.BoxGeometry(2 * s, 2 * s, 2 * s), cylinder: () => new THREE.CylinderGeometry(s, s, 2 * s, 20), cone: () => new THREE.ConeGeometry(s, 2 * s, 20) }[o.shape ?? "sphere"]();
    const m = new THREE.Mesh(geo, this.mat(o.color));
    m.position.copy(V(o.at));
    this.put(id, m, o.color, o.label, [o.at[0], o.at[1], o.at[2] + s * 1.9]);
  }

  box(id: string, o: { at: Vec3; size: Vec3; color?: ColorToken; label?: string; opacity?: number; inside?: boolean }) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...o.size), this.mat(o.color, o.opacity));
    m.position.copy(V(o.at));
    this.put(id, m, o.color, o.label, o.inside ? [o.at[0], o.at[1] - o.size[1] / 2 - 0.02, o.at[2]] : [o.at[0], o.at[1], o.at[2] + o.size[2] / 2 + 0.25]);
  }

  arrow(id: string, o: { from: Vec3; to: Vec3; color?: ColorToken; label?: string; width?: number }) {
    const a = V(o.from), b = V(o.to), len = a.distanceTo(b);
    const g = new THREE.Group();
    if (len > 1e-6) {
      const head = Math.min(SIZE.arrowHead * 2, len * 0.35);
      const dir = b.clone().sub(a).normalize();
      const neck = b.clone().sub(dir.clone().multiplyScalar(head));
      const mat = this.mat(o.color);
      g.add(this.rod(a, neck, o.width ?? 0.035, mat));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(head * 0.42, head, 18), mat);
      cone.position.copy(neck.clone().add(b).multiplyScalar(0.5));
      cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      g.add(cone);
    }
    this.put(id, g, o.color, o.label, [o.to[0] * 1.08 + o.from[0] * -0.08, o.to[1] * 1.08 + o.from[1] * -0.08, o.to[2] * 1.08 + o.from[2] * -0.08 + 0.18]);
  }

  line(id: string, o: { points: Vec3[]; color?: ColorToken; dashed?: boolean; width?: number }) {
    const g = new THREE.Group();
    const mat = this.mat(o.color ?? "muted");
    const r = o.width ?? 0.018;
    for (let i = 1; i < o.points.length; i++) {
      const a = V(o.points[i - 1]), b = V(o.points[i]);
      if (!o.dashed) g.add(this.rod(a, b, r, mat));
      else {
        const n = Math.max(1, Math.round(a.distanceTo(b) / 0.22));
        for (let k = 0; k < n; k++) g.add(this.rod(a.clone().lerp(b, k / n), a.clone().lerp(b, (k + 0.55) / n), r, mat));
      }
    }
    this.put(id, g, o.color);
  }

  polygon(id: string, o: { points: Vec3[]; color?: ColorToken; opacity?: number }) {
    const pos: number[] = [];
    for (let i = 1; i + 1 < o.points.length; i++) pos.push(...o.points[0], ...o.points[i], ...o.points[i + 1]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.mat(o.color, o.opacity ?? 0.35));
    m.renderOrder = 1;
    (m.material as THREE.Material).depthWrite = false;
    this.put(id, m, o.color);
  }

  surface(id: string, o: { f: (x: number, y: number) => number; x: [number, number]; y: [number, number]; n: number; wireframe?: boolean; opacity?: number; zClip?: number }) {
    const n = o.n, clip = o.zClip ?? 50;
    const pos = new Float32Array((n + 1) * (n + 1) * 3);
    const zs: number[] = [];
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
      const x = o.x[0] + ((o.x[1] - o.x[0]) * i) / n, y = o.y[0] + ((o.y[1] - o.y[0]) * j) / n;
      let z = o.f(x, y);
      if (!Number.isFinite(z)) z = 0;
      z = Math.max(-clip, Math.min(clip, z));
      const k = (i * (n + 1) + j) * 3;
      pos.set([x, y, z], k);
      zs.push(z);
    }
    const lo = Math.min(...zs), hi = Math.max(...zs);
    const ramp = [new THREE.Color(COLOR.z), new THREE.Color(COLOR.accent), new THREE.Color(COLOR.active)];
    const col = new Float32Array(zs.length * 3);
    zs.forEach((z, k) => {
      const t = hi > lo ? (z - lo) / (hi - lo) : 0.5;
      const c = t < 0.5 ? ramp[0].clone().lerp(ramp[1], t * 2) : ramp[1].clone().lerp(ramp[2], (t - 0.5) * 2);
      col.set([c.r, c.g, c.b], k * 3);
    });
    const idx: number[] = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const a = i * (n + 1) + j, b = a + 1, c = a + n + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 0.95 })));
    if (o.wireframe) g.add(new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: COLOR.board, transparent: true, opacity: 0.35 })));
    this.put(id, g);
  }

  points(id: string, o: { points: Vec3[]; color?: ColorToken; size?: number }) {
    // One instanced mesh, however many points (up to the schema limits).
    const m = new THREE.InstancedMesh(new THREE.SphereGeometry(o.size ?? 0.06, 10, 8), this.mat(o.color ?? "accent"), o.points.length);
    const t = new THREE.Matrix4();
    o.points.forEach((p, k) => m.setMatrixAt(k, t.makeTranslation(p[0], p[1], p[2])));
    this.put(id, m, o.color);
  }

  label(id: string, o: { at: Vec3; text: string; color?: ColorToken; small?: boolean }) {
    const el = document.createElement("div");
    el.textContent = o.text;
    Object.assign(el.style, { font: `${o.small ? SIZE.labelSmall : SIZE.label}px ${FONT}`, color: COLOR[o.color ?? "text"], textShadow: "0 0 3px #000, 0 0 4px #000", whiteSpace: "nowrap" });
    const l = new CSS2DObject(el);
    l.position.copy(V(o.at));
    this.put(id, l);
    // A plain label can be rewritten later (a queue's contents, a counter).
    const e = this.objects.get(id)!;
    e.labelEl = el;
    e.labelText = o.text;
  }

  segments(id: string, o: { pairs: [Vec3, Vec3][]; color?: ColorToken; opacity?: number }) {
    const pos = new Float32Array(o.pairs.length * 6);
    o.pairs.forEach(([a, b], k) => pos.set([...a, ...b], k * 6));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.put(id, new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: COLOR[o.color ?? "muted"], transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1 })), o.color);
  }

  solid(id: string, o: { shape: SolidShape; dims: number[]; at?: Vec3; color?: ColorToken; opacity?: number; label?: string }) {
    const [a = 1, b = a, c = a] = o.dims;
    // three.js builds these with y up; they are turned so their axis is our z (up).
    const geo: THREE.BufferGeometry = {
      box: () => new THREE.BoxGeometry(a, c, b),
      cylinder: () => new THREE.CylinderGeometry(a, a, b, 48),
      cone: () => new THREE.ConeGeometry(a, b, 48),
      sphere: () => new THREE.SphereGeometry(a, 40, 24),
      hemisphere: () => new THREE.SphereGeometry(a, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      prism3: () => new THREE.CylinderGeometry(a, a, b, 3),
      pyramid4: () => new THREE.ConeGeometry(a, b, 4),
      tetrahedron: () => new THREE.TetrahedronGeometry(a),
      octahedron: () => new THREE.OctahedronGeometry(a),
      dodecahedron: () => new THREE.DodecahedronGeometry(a),
      icosahedron: () => new THREE.IcosahedronGeometry(a),
    }[o.shape]();
    geo.rotateX(Math.PI / 2);
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo, this.mat(o.color ?? "accent", o.opacity ?? 0.55)));
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: COLOR.text })));
    if (o.at) g.position.copy(V(o.at));
    const top = (o.at ?? [0, 0, 0])[2] + Math.max(a, b, c);
    this.put(id, g, o.color, o.label, [(o.at ?? [0, 0, 0])[0], (o.at ?? [0, 0, 0])[1], top + 0.3]);
  }

  // ── Changes (animated unless reduced motion) ────────────────────────────────────────────────
  async setColor(id: string, color: ColorToken, o: AnimOpts = {}) {
    const e = this.need(id);
    const meshes: THREE.Mesh[] = [];
    e.obj.traverse((x) => { if ((x as THREE.Mesh).material && "color" in ((x as THREE.Mesh).material as object)) meshes.push(x as THREE.Mesh); });
    const target = new THREE.Color(COLOR[color]);
    const from = meshes.map((m) => ((m.material as THREE.MeshStandardMaterial).color).clone());
    await this.tween(o.animate === false ? 0 : o.ms ?? 260, (t) => meshes.forEach((m, k) => (m.material as THREE.MeshStandardMaterial).color.copy(from[k]).lerp(target, t)));
    e.color = color;
    this.paintLabel(e);
  }

  setLabel(id: string, text: string) {
    const e = this.need(id);
    e.labelText = text;
    this.paintLabel(e);
    this.dirty = true;
  }

  async move(id: string, to: Vec3, o: AnimOpts = {}) {
    const e = this.need(id);
    const from = e.obj.position.clone(), target = V(to);
    await this.tween(o.animate === false ? 0 : o.ms ?? 450, (t) => e.obj.position.copy(from).lerp(target, ease(t)));
  }

  async pulse(id: string, o: AnimOpts = {}) {
    const e = this.need(id);
    await this.tween(o.animate === false ? 0 : o.ms ?? 420, (t) => e.obj.scale.setScalar(1 + 0.35 * Math.sin(Math.PI * t)));
    e.obj.scale.setScalar(1);
  }

  tween(ms: number, fn: (t: number) => void): Promise<void> {
    const dur = this.reducedMotion ? 0 : ms / Math.max(this.speed, 0.05);
    if (dur <= 0) {
      fn(1);
      this.dirty = true;
      return Promise.resolve();
    }
    return new Promise((done) => {
      const start = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        fn(t);
        this.dirty = true;
        if (t < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
  }

  private need(id: string): Entry {
    const e = this.objects.get(id);
    if (!e) throw new Error(`no object "${id}" on the board`);
    return e;
  }
}
