"use client";

import { useEffect, useRef, type RefObject } from "react";
import type * as THREE_NS from "three";
import { mouthShape, visemeWeights } from "@/lib/adhd/mouth";
import { PEN_HOLD_EVENT, PEN_TIP_EVENT, setTeacherPresent, type PenTip } from "@/lib/classroom/penTip";
import { classroomStage, FLOOR_FRACTION, initialBrain, stepBrain, WALK_SPEED_TH, type Activity, type BrainState } from "@/lib/classroom/teacherBrain";

/**
 * ARIA IN THE CLASSROOM: a full-body teacher standing in front of the board, on the student's own GPU.
 *
 * One transparent canvas over the whole stage, an orthographic camera in stage pixels (so a point on
 * the board and a point on her are the same coordinates), and one rigged character
 * (public/classroom/aria-teacher.glb: Microsoft Rocketbox, MIT, 5 MB, 13 motion-captured clips, the
 * 15 Oculus visemes and the 52 ARKit shapes on her face). lib/classroom/teacherBrain.ts decides
 * where she stands and what she does; this file only makes it so:
 *  - clips crossfade by activity; the walk plays at the speed she actually moves;
 *  - while writing, a two-bone IK puts her left hand's marker on the board's pen tip;
 *  - her head turns to the pen while she writes and to the student otherwise;
 *  - her mouth takes the same viseme stream as the bust (lib/adhd/mouth.ts), straight onto her own
 *    authored viseme shapes; she blinks.
 * Pointer events pass through: nothing under her is lost.
 */

type Props = {
  /** The stage she stands on; her canvas covers it. */
  within: RefObject<HTMLElement | null>;
  speaking: boolean;
  listening: boolean;
  /** A new part is being introduced: she takes the middle of the stage. */
  presenting: boolean;
  /** The lesson is playing; paused, she does not chase the pen. */
  active: boolean;
  /** Pixels on the right covered by a sheet, so her lane moves left of it. */
  rightInset?: number;
  onUnavailable?: (reason: string) => void;
};

const MODEL_URL = "/classroom/aria-teacher.glb";
/** Model units are centimetres; she is this tall. */
const MODEL_HEIGHT = 174.4;
const TALK_CLIPS = ["talk1", "talk2", "talk3", "talk4", "talk5", "moderate"];

export function ClassroomTeacher({ within, speaking, listening, presenting, active, rightInset = 0, onUnavailable }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  // What the render loop reads each frame; kept current without restarting the scene.
  const live = useRef({ speaking, listening, presenting, active, rightInset });
  const unavailable = useRef(onUnavailable);
  useEffect(() => {
    live.current = { speaking, listening, presenting, active, rightInset };
    unavailable.current = onUnavailable;
  });

  useEffect(() => {
    const host = hostRef.current;
    const stageEl = within.current;
    if (!host || !stageEl) return;
    let disposed = false;
    let raf = 0;
    const cleanups: Array<() => void> = [];

    // The pen's tip, as the board reports it, in page px.
    let pen: { x: number; y: number } | null = null;
    const onPen = (e: Event) => {
      const tip = (e as CustomEvent<PenTip>).detail;
      pen = tip && tip.on ? { x: tip.x, y: tip.y } : null;
    };
    window.addEventListener(PEN_TIP_EVENT, onPen);
    cleanups.push(() => window.removeEventListener(PEN_TIP_EVENT, onPen));

    (async () => {
      const probe = document.createElement("canvas");
      if (!probe.getContext("webgl2")) {
        unavailable.current?.("WebGL2 is not available");
        return;
      }
      const THREE = await import("three");
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js");
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
      host.appendChild(renderer.domElement);
      cleanups.push(() => {
        renderer.dispose();
        renderer.domElement.remove();
      });

      const scene = new THREE.Scene();
      // Stage pixels, y up: a board point and a point on her share coordinates.
      const camera = new THREE.OrthographicCamera(0, 1, 1, 0, -20000, 20000);
      camera.position.set(0, 0, 5000);
      scene.add(new THREE.HemisphereLight(0xfff8f0, 0x8a94a3, 1.15));
      const key = new THREE.DirectionalLight(0xffffff, 2.1);
      key.position.set(-0.6, 1.2, 1.4);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xdfe8ff, 0.9);
      rim.position.set(0.9, 0.8, -1);
      scene.add(rim);

      let W = 1;
      let H = 1;
      const resize = () => {
        const r = stageEl.getBoundingClientRect();
        W = Math.max(1, r.width);
        H = Math.max(1, r.height);
        renderer.setSize(W, H, false);
        camera.left = 0;
        camera.right = W;
        camera.top = H;
        camera.bottom = 0;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(stageEl);
      cleanups.push(() => ro.disconnect());

      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      let gltf: Awaited<ReturnType<typeof loader.loadAsync>>;
      try {
        gltf = await loader.loadAsync(MODEL_URL);
      } catch (error) {
        console.warn("[classroom] could not load the teacher:", error);
        unavailable.current?.("load failed");
        return;
      }
      if (disposed) return;
      setTeacherPresent(true);
      cleanups.push(() => setTeacherPresent(false));

      const body = gltf.scene;
      const rig = new THREE.Group(); // position and yaw; `body` keeps its own import transform
      rig.add(body);
      scene.add(rig);
      const meshes: THREE_NS.SkinnedMesh[] = [];
      body.traverse((o) => {
        if ((o as THREE_NS.SkinnedMesh).isSkinnedMesh) {
          const m = o as THREE_NS.SkinnedMesh;
          m.frustumCulled = false;
          meshes.push(m);
        }
      });
      const bone = (name: string) => body.getObjectByName(name) as THREE_NS.Bone | undefined;
      const lUpper = bone("Bip01_L_UpperArm");
      const lFore = bone("Bip01_L_Forearm");
      const lHand = bone("Bip01_L_Hand");
      const head = bone("Bip01_Head");
      const lFingers = ["1", "2", "3", "4"].flatMap((f) => [bone(`Bip01_L_Finger${f}`), bone(`Bip01_L_Finger${f}1`), bone(`Bip01_L_Finger${f}2`)]).filter(Boolean) as THREE_NS.Bone[];

      // A soft shadow on the floor under her.
      const shadowTex = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const g = c.getContext("2d")!;
        const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
        grad.addColorStop(0, "rgba(0,0,0,0.42)");
        grad.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 128, 128);
        return new THREE.CanvasTexture(c);
      })();
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
      shadow.renderOrder = -1;
      scene.add(shadow);

      // The marker in her writing hand.
      const marker = new THREE.Group();
      const markerBody = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 14), new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5 }));
      const markerCap = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 0.22, 14), new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4 }));
      markerCap.position.y = 0.45;
      const markerNib = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.16, 12), new THREE.MeshStandardMaterial({ color: 0x0f172a }));
      markerNib.position.y = -0.58;
      markerNib.rotation.x = Math.PI;
      marker.add(markerBody, markerCap, markerNib);
      marker.visible = false;
      scene.add(marker);

      // Clips.
      const mixer = new THREE.AnimationMixer(body);
      const actions = new Map<string, THREE_NS.AnimationAction>();
      for (const clip of gltf.animations) actions.set(clip.name, mixer.clipAction(clip));
      let current: THREE_NS.AnimationAction | null = null;
      let currentName = "";
      let talkIndex = 0;
      let clipSince = 0;
      const play = (name: string, fade = 0.45, randomStart = false) => {
        const next = actions.get(name);
        if (!next || name === currentName) return;
        next.reset();
        next.enabled = true;
        next.setEffectiveWeight(1);
        next.setEffectiveTimeScale(1);
        if (randomStart) next.time = (next.getClip().duration * ((talkIndex * 0.37) % 1)) | 0;
        next.play();
        if (current) current.crossFadeTo(next, fade, false);
        current = next;
        currentName = name;
      };

      // The face: her own viseme shapes take the viseme stream directly; ARKit shapes for the rest.
      const dict = meshes.find((m) => m.morphTargetDictionary)?.morphTargetDictionary ?? {};
      const visemeIndex = new Map<string, number>();
      for (const [k, i] of Object.entries(dict)) {
        const m = /^AA_VI_\d\d_(.+)$/.exec(k);
        if (m) visemeIndex.set(m[1] === "KK" ? "kk" : m[1] === "Sil" ? "sil" : m[1], i);
      }
      const shape = (suffix: string) => Object.entries(dict).find(([k]) => k.endsWith(suffix))?.[1];
      const blinkL = shape("_EyeBlinkLeft");
      const blinkR = shape("_EyeBlinkRight");
      const smileL = shape("_MouthSmileLeft");
      const smileR = shape("_MouthSmileRight");
      const browUp = shape("_BrowInnerUp");
      const face = new Float32Array(Object.keys(dict).length);
      const setFace = (i: number | undefined, v: number) => {
        if (i !== undefined) face[i] = v;
      };

      let brain: BrainState | null = null;
      let holding = false;
      // Never leave the board waiting on a teacher who is gone.
      cleanups.push(() => window.dispatchEvent(new CustomEvent(PEN_HOLD_EVENT, { detail: false })));
      let nextBlink = performance.now() + 2500;
      let blinkStart = -1;
      let last = performance.now();
      const t0 = last;

      // Scratch objects.
      const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
      const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();
      const tipWorld = new THREE.Vector3();
      const handGoal = new THREE.Vector3();
      // The writing grip's own vectors: solveArm and lookAt use v1..v4 as scratch.
      const NIB = new THREE.Vector3(-0.35, -0.55, -0.75).normalize(); // from fist to tip
      const WRIST_FROM_FIST = new THREE.Vector3(0.3, 0.45, 0.25).normalize();
      const fist = new THREE.Vector3();
      const keepUpper = new THREE.Quaternion(), keepFore = new THREE.Quaternion();

      /** Rotate `b` in world space by `delta`, keeping its parent. */
      const rotateWorld = (b: THREE_NS.Object3D, delta: THREE_NS.Quaternion) => {
        b.getWorldQuaternion(q2);
        q2.premultiply(delta);
        b.parent!.getWorldQuaternion(q3);
        b.quaternion.copy(q3.invert().multiply(q2));
        b.updateMatrixWorld(true);
      };

      /** Two-bone IK: the hand to `goal`, the elbow toward `pole`, blended by `weight`. */
      const solveArm = (upper: THREE_NS.Bone, fore: THREE_NS.Bone, hand: THREE_NS.Bone, goal: THREE_NS.Vector3, pole: THREE_NS.Vector3, weight: number) => {
        keepUpper.copy(upper.quaternion);
        keepFore.copy(fore.quaternion);
        const S = upper.getWorldPosition(v1);
        const E = fore.getWorldPosition(v2);
        const Wp = hand.getWorldPosition(v3);
        const a = E.distanceTo(S);
        const b = Wp.distanceTo(E);
        const toGoal = v4.copy(goal).sub(S);
        const d = Math.min(a + b - 1e-3, Math.max(Math.abs(a - b) + 1e-3, toGoal.length()));
        const n = toGoal.normalize();
        const p = pole.clone().sub(S);
        p.sub(n.clone().multiplyScalar(p.dot(n))).normalize();
        const cosA = (a * a + d * d - b * b) / (2 * a * d);
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        const elbow = S.clone().add(n.clone().multiplyScalar(a * cosA)).add(p.multiplyScalar(a * sinA));
        q1.setFromUnitVectors(E.clone().sub(S).normalize(), elbow.clone().sub(S).normalize());
        rotateWorld(upper, q1);
        const E2 = fore.getWorldPosition(new THREE.Vector3());
        const W2 = hand.getWorldPosition(new THREE.Vector3());
        const reach = S.clone().add(n.clone().multiplyScalar(d));
        q1.setFromUnitVectors(W2.sub(E2).normalize(), reach.sub(E2).normalize());
        rotateWorld(fore, q1);
        if (weight < 1) {
          upper.quaternion.copy(keepUpper.slerp(upper.quaternion, weight));
          fore.quaternion.copy(keepFore.slerp(fore.quaternion, weight));
          upper.updateMatrixWorld(true);
        }
      };

      /** Turn the head toward `target` (world), at most `max` radians, by `weight`. */
      const lookAt = (target: THREE_NS.Vector3, forward: THREE_NS.Vector3, weight: number, max: number) => {
        if (!head) return;
        const hp = head.getWorldPosition(v1);
        const want = v2.copy(target).sub(hp).normalize();
        q1.setFromUnitVectors(forward, want);
        const angle = 2 * Math.acos(Math.min(1, Math.abs(q1.w)));
        const limit = angle > max ? max / angle : 1;
        q1.slerpQuaternions(new THREE.Quaternion(), q1, limit * weight);
        rotateWorld(head, q1);
      };

      const loop = () => {
        raf = requestAnimationFrame(loop);
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        const t = (now - t0) / 1000;
        const { speaking: talking, listening: hearing, presenting: introducing, active: playing, rightInset: inset } = live.current;
        const stage = classroomStage(W, H, inset);
        const th = stage.teacherHeight;
        const box = stageEl.getBoundingClientRect();
        // A tip off the stage is a board sliding away in a transition, not writing to follow.
        const penLocal = pen && pen.x >= box.left && pen.x <= box.right && pen.y >= box.top && pen.y <= box.bottom ? { x: pen.x - box.left, y: pen.y - box.top } : null;
        brain = stepBrain(brain ?? initialBrain(stage, t), { dt, now: t, pen: penLocal, speaking: talking, listening: hearing, presenting: introducing, active: playing, stage });

        // The pen waits for her hand.
        if (brain.holdPen !== holding) {
          holding = brain.holdPen;
          window.dispatchEvent(new CustomEvent(PEN_HOLD_EVENT, { detail: holding }));
        }

        // Body clip for what she is doing.
        const act: Activity = brain.activity;
        if (act === "walk") play("walk", 0.25);
        else if (act === "write") play(brain.crouch ? "crouch" : "idle2", 0.5);
        else if (act === "point") play("present_right", 0.5);
        else if (act === "listen") play("listen", 0.6);
        else if (act === "talk") {
          if (!TALK_CLIPS.includes(currentName) || t - clipSince > 9) {
            talkIndex = (talkIndex + 1) % TALK_CLIPS.length;
            play(TALK_CLIPS[talkIndex], 0.7, true);
            clipSince = t;
          }
        } else play("idle", 0.6);
        if (act !== "talk" && !TALK_CLIPS.includes(currentName)) clipSince = t;
        const walkAction = actions.get("walk");
        if (walkAction) walkAction.setEffectiveTimeScale(Math.max(0.35, Math.min(1.3, Math.abs(brain.v) / (WALK_SPEED_TH * th))));

        // Place her: feet just above the bottom of the stage, facing where the brain says.
        const scale = th / MODEL_HEIGHT;
        body.scale.setScalar(scale);
        const floor = H * FLOOR_FRACTION;
        rig.position.set(brain.x, floor, 0);
        rig.rotation.y = (brain.yaw * Math.PI) / 180;
        shadow.position.set(brain.x, floor + 2, -th);
        shadow.scale.set(th * 0.42, th * 0.07, 1);

        mixer.update(dt);
        body.updateMatrixWorld(true);

        // Writing. The marker leans as a held marker does: nib on the pen tip, body up and out toward
        // the camera, her fist round its middle. The wrist is solved to just behind the fist, the hand
        // turned so its knuckles run along the marker, the fingers closed on it.
        if (lUpper && lFore && lHand && brain.write > 0 && brain.tip) {
          const markerLen = 0.075 * th;
          tipWorld.set(brain.tip.x, H - brain.tip.y, -0.18 * th);
          const nib = NIB;
          fist.copy(tipWorld).addScaledVector(nib, -markerLen * 0.5);
          handGoal.copy(fist).addScaledVector(WRIST_FROM_FIST, 0.045 * th);
          const shoulder = lUpper.getWorldPosition(new THREE.Vector3());
          const pole = new THREE.Vector3(shoulder.x + 0.1 * th, shoulder.y - 0.6 * th, shoulder.z + 0.25 * th);
          solveArm(lUpper, lFore, lHand, handGoal, pole, brain.write);
          // Knuckles toward the fist, then roll so the curl axis (local Z) lies along the marker.
          const wrist = lHand.getWorldPosition(new THREE.Vector3());
          lHand.getWorldQuaternion(q1);
          const xNow = new THREE.Vector3(1, 0, 0).applyQuaternion(q1);
          const toFist = fist.clone().sub(wrist).normalize();
          rotateWorld(lHand, new THREE.Quaternion().setFromUnitVectors(xNow, toFist).slerp(new THREE.Quaternion(), 1 - brain.write));
          lHand.getWorldQuaternion(q1);
          const zNow = new THREE.Vector3(0, 0, 1).applyQuaternion(q1);
          const zWant = nib.clone().sub(toFist.clone().multiplyScalar(nib.dot(toFist))).normalize();
          rotateWorld(lHand, new THREE.Quaternion().setFromUnitVectors(zNow, zWant).slerp(new THREE.Quaternion(), 1 - brain.write));
          for (const f of lFingers) f.rotateZ(0.5 * brain.write);
          marker.visible = brain.write > 0.5;
          marker.position.copy(fist);
          marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), nib);
          const r = 0.009 * th;
          marker.scale.set(r, markerLen, r);
        } else marker.visible = false;

        // Her head: to the pen while she writes, to the student otherwise.
        const forward = v4.set(Math.sin(rig.rotation.y), 0, Math.cos(rig.rotation.y));
        if (brain.write > 0.2 && brain.tip) lookAt(tipWorld, forward, 0.75 * brain.write, 0.9);
        else if (act !== "walk" && head) lookAt(head.getWorldPosition(v3).add(new THREE.Vector3(0, -0.02 * th, 5 * th)), forward, 0.65, 0.7);

        // Face.
        face.fill(0);
        const vis = visemeWeights();
        let any = 0;
        for (const [name, w] of Object.entries(vis)) {
          if (name === "sil" || w <= 0.02) continue;
          const i = visemeIndex.get(name);
          if (i !== undefined) {
            face[i] = Math.min(1, w * 0.85);
            any += w;
          }
        }
        const mouth = mouthShape();
        if (any < 0.05 && mouth.open > 0.04) {
          setFace(visemeIndex.get("aa"), mouth.open * 0.55);
          setFace(visemeIndex.get("I"), Math.max(0, mouth.width - 0.5) * 0.6);
        }
        setFace(smileL, talking ? 0.14 : 0.1);
        setFace(smileR, talking ? 0.14 : 0.1);
        setFace(browUp, talking ? 0.12 + 0.1 * Math.max(0, Math.sin(t * 1.3)) : 0);
        if (now > nextBlink) {
          blinkStart = now;
          nextBlink = now + 2200 + ((now * 7.31) % 3400);
        }
        const bt = (now - blinkStart) / 150;
        const blink = blinkStart > 0 && bt < 1 ? Math.sin(bt * Math.PI) : 0;
        setFace(blinkL, blink);
        setFace(blinkR, blink);
        for (const m of meshes) {
          const inf = m.morphTargetInfluences;
          if (!inf) continue;
          for (let i = 0; i < inf.length; i++) inf[i] = inf[i] * 0.45 + face[i] * 0.55;
        }

        renderer.render(scene, camera);
        if (process.env.NODE_ENV !== "production") (window as unknown as { __ariaClassroom?: unknown }).__ariaClassroom = { ...brain, clip: currentName, pen: penLocal, marker: marker.visible, th };
      };
      loop();
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const c of cleanups) c();
    };
  }, [within]);

  return <div ref={hostRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[15]" />;
}
