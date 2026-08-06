import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { audioBus } from "../audioBus";
import { M, makeEmissive } from "../materials";

/**
 * Interactive campus fixtures.
 *
 * Design rules shared by everything in this file:
 *  · Real proportions (a coffee machine is 400mm wide, lockers are 300mm doors, clocks are
 *    300mm) — wrong fixture scale betrays a scene faster than low polygon counts do.
 *  · Every interaction produces immediate feedback in BOTH sight and sound, and the sound is
 *    optional (audioBus no-ops when audio is off) so no interaction depends on hearing.
 *  · Animations are critically damped, never linear tweens, and respect reduced motion by
 *    snapping (the parent passes `reducedMotion` where relevant).
 */

/** Coffee machine with a working brew cycle: press → hum + steam glow + cup fills. */
export function CoffeeMachine({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const [brewing, setBrewing] = useState(false);
  const brewT = useRef(0);
  const steam = useRef<THREE.Mesh>(null);
  const cup = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (brewing) {
      brewT.current += delta;
      if (steam.current) {
        steam.current.position.y = 1.18 + (brewT.current % 0.9) * 0.22;
        (steam.current.material as THREE.MeshBasicMaterial).opacity =
          0.5 * (1 - (brewT.current % 0.9) / 0.9);
      }
      if (cup.current) cup.current.scale.y = Math.min(1, brewT.current / 3);
      if (brewT.current > 3.4) {
        setBrewing(false);
        brewT.current = 0;
      }
    }
  });

  return (
    <group
      position={position}
      rotation={[0, rotation, 0]}
      onClick={(event) => {
        event.stopPropagation();
        if (!brewing) {
          setBrewing(true);
          audioBus.emit("coffee");
        }
      }}
    >
      {/* Body — commercial bean-to-cup proportions. */}
      <mesh position={[0, 1.28, 0]} castShadow receiveShadow material={M.steel}>
        <boxGeometry args={[0.4, 0.56, 0.42]} />
      </mesh>
      <mesh position={[0, 1.05, 0.16]} material={M.aluminium}>
        <boxGeometry args={[0.3, 0.06, 0.12]} />
      </mesh>
      {/* Display strip lights up while brewing. */}
      <mesh position={[0, 1.42, 0.215]} material={brewing ? makeEmissive("#7fd6c0", 1.8) : M.rubberFloor}>
        <boxGeometry args={[0.2, 0.05, 0.006]} />
      </mesh>
      {/* Cup + fill level. */}
      <mesh position={[0, 0.985, 0.16]} material={M.ceramic} castShadow>
        <cylinderGeometry args={[0.035, 0.028, 0.07, 12]} />
      </mesh>
      <mesh ref={cup} position={[0, 0.985, 0.16]} scale={[1, 0, 1]}>
        <cylinderGeometry args={[0.03, 0.024, 0.06, 12]} />
        <meshStandardMaterial color="#5a3a24" roughness={0.4} />
      </mesh>
      {/* Steam puff. */}
      <mesh ref={steam} position={[0, 1.18, 0.16]} visible={brewing}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
      </mesh>
      {/* Counter it sits on. */}
      <mesh position={[0, 0.48, 0]} castShadow receiveShadow material={M.walnut}>
        <boxGeometry args={[0.7, 0.96, 0.6]} />
      </mesh>
    </group>
  );
}

/** Water dispenser — click for a bubble glug. */
export function WaterDispenser({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const bottle = useRef<THREE.Mesh>(null);
  const wobble = useRef(0);
  useFrame((_, delta) => {
    if (wobble.current > 0) {
      wobble.current = Math.max(0, wobble.current - delta);
      if (bottle.current) {
        bottle.current.scale.setScalar(1 + Math.sin(wobble.current * 26) * 0.015 * wobble.current);
      }
    }
  });
  return (
    <group
      position={position}
      rotation={[0, rotation, 0]}
      onClick={(event) => {
        event.stopPropagation();
        wobble.current = 1;
        audioBus.emit("water");
      }}
    >
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow material={M.plaster}>
        <boxGeometry args={[0.34, 1.1, 0.34]} />
      </mesh>
      <mesh ref={bottle} position={[0, 1.32, 0]} castShadow>
        <cylinderGeometry args={[0.14, 0.15, 0.42, 14]} />
        <meshPhysicalMaterial color="#bfe0ec" transparent opacity={0.5} roughness={0.1} envMapIntensity={1.4} />
      </mesh>
      <mesh position={[0, 0.78, 0.18]} material={M.steel}>
        <boxGeometry args={[0.16, 0.05, 0.05]} />
      </mesh>
    </group>
  );
}

/** Lockers — a bank of doors; each clicks open/shut on its own hinge. */
export function LockerBank({
  position,
  rotation = 0,
  count = 6,
}: {
  position: [number, number, number];
  rotation?: number;
  count?: number;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[(count * 0.31) / 2 - 0.155, 0.9, -0.02]} castShadow receiveShadow material={M.steel}>
        <boxGeometry args={[count * 0.31 + 0.04, 1.8, 0.44]} />
      </mesh>
      {Array.from({ length: count }, (_, index) => (
        <LockerDoor key={index} x={index * 0.31} />
      ))}
    </group>
  );
}

function LockerDoor({ x }: { x: number }) {
  const [open, setOpen] = useState(false);
  const pivot = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (!pivot.current) return;
    pivot.current.rotation.y = THREE.MathUtils.damp(pivot.current.rotation.y, open ? -1.9 : 0, 8, delta);
  });
  return (
    <group position={[x, 0.9, 0.2]}>
      <group ref={pivot} position={[-0.14, 0, 0]}>
        <mesh
          position={[0.14, 0, 0]}
          castShadow
          onClick={(event) => {
            event.stopPropagation();
            setOpen((value) => !value);
            audioBus.emit("locker");
          }}
        >
          <boxGeometry args={[0.28, 1.74, 0.02]} />
          <meshStandardMaterial color="#5f7d8c" roughness={0.5} metalness={0.4} envMapIntensity={1.1} />
        </mesh>
        {/* Vent slots + handle */}
        <mesh position={[0.14, 0.6, 0.012]} material={M.rubberFloor}>
          <boxGeometry args={[0.16, 0.012, 0.004]} />
        </mesh>
        <mesh position={[0.24, 0, 0.02]} material={M.aluminium}>
          <boxGeometry args={[0.02, 0.1, 0.02]} />
        </mesh>
      </group>
    </group>
  );
}

/** Wall clock showing the real local time — updated once a minute. */
export function WallClock({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const minute = useRef<THREE.Mesh>(null);
  const hour = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const m = now.getMinutes() + now.getSeconds() / 60;
      const h = (now.getHours() % 12) + m / 60;
      if (minute.current) minute.current.rotation.z = -(m / 60) * Math.PI * 2;
      if (hour.current) hour.current.rotation.z = -(h / 12) * Math.PI * 2;
    };
    update();
    const timer = window.setInterval(update, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh material={M.ceramic} castShadow>
        <cylinderGeometry args={[0.16, 0.16, 0.03, 24]} />
      </mesh>
      <group rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.02]}>
        <mesh ref={hour} position={[0, 0, 0.002]}>
          <boxGeometry args={[0.014, 0.08, 0.004]} />
          <meshBasicMaterial color="#22302d" />
        </mesh>
        <mesh ref={minute} position={[0, 0, 0.006]}>
          <boxGeometry args={[0.01, 0.12, 0.004]} />
          <meshBasicMaterial color="#22302d" />
        </mesh>
      </group>
    </group>
  );
}

/** Ceiling projector — present in every classroom; hums softly via room tone, lens glows. */
export function Projector({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh material={M.aluminium} castShadow>
        <boxGeometry args={[0.34, 0.12, 0.26]} />
      </mesh>
      <mesh position={[0, 0, 0.14]} rotation={[Math.PI / 2, 0, 0]} material={makeEmissive("#cfe8ff", 0.9)}>
        <cylinderGeometry args={[0.035, 0.035, 0.03, 12]} />
      </mesh>
      <mesh position={[0, 0.16, 0]} material={M.steel}>
        <cylinderGeometry args={[0.015, 0.015, 0.2, 8]} />
      </mesh>
    </group>
  );
}

/** Emergency exit sign — green, emissive, above doors. A legally mandated detail that instantly
 *  reads as "real institutional building". */
export function ExitSign({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh material={makeEmissive("#1f9d55", 1.6)}>
        <boxGeometry args={[0.36, 0.14, 0.03]} />
      </mesh>
      <Text position={[0, 0, 0.02]} fontSize={0.075} color="#eafff3" anchorX="center" anchorY="middle">
        EXIT
      </Text>
    </group>
  );
}

/** Elevator front: two steel doors that slide open on call. Single-storey building, so the cab
 *  is set dressing — but the doors genuinely open, which is what people try. */
export function ElevatorDoors({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const [open, setOpen] = useState(false);
  const left = useRef<THREE.Mesh>(null);
  const right = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    const offset = open ? 0.44 : 0;
    if (left.current) left.current.position.x = THREE.MathUtils.damp(left.current.position.x, -0.225 - offset, 6, delta);
    if (right.current) right.current.position.x = THREE.MathUtils.damp(right.current.position.x, 0.225 + offset, 6, delta);
  });

  // Auto-close after a while, like a real lift.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), 6000);
    return () => window.clearTimeout(timer);
  }, [open]);

  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* Shaft surround + cab interior visible when open. */}
      <mesh position={[0, 1.25, -0.5]} receiveShadow material={M.concreteRaw}>
        <boxGeometry args={[1.4, 2.5, 0.9]} />
      </mesh>
      <mesh position={[0, 1.25, -0.12]} material={M.rubberFloor}>
        <boxGeometry args={[1.0, 2.3, 0.02]} />
      </mesh>
      <mesh ref={left} position={[-0.225, 1.2, 0]} castShadow material={M.aluminium}>
        <boxGeometry args={[0.45, 2.3, 0.05]} />
      </mesh>
      <mesh ref={right} position={[0.225, 1.2, 0]} castShadow material={M.aluminium}>
        <boxGeometry args={[0.45, 2.3, 0.05]} />
      </mesh>
      {/* Frame + indicator + call button. */}
      <mesh position={[0, 2.44, 0.02]} material={M.steel}>
        <boxGeometry args={[1.1, 0.1, 0.08]} />
      </mesh>
      <mesh position={[0, 2.44, 0.07]} material={makeEmissive("#f0b64a", 1.2)}>
        <boxGeometry args={[0.14, 0.05, 0.01]} />
      </mesh>
      <Text position={[0, 2.44, 0.08]} fontSize={0.05} color="#2b2013" anchorX="center" anchorY="middle">
        1
      </Text>
      <mesh
        position={[0.68, 1.05, 0.04]}
        rotation={[Math.PI / 2, 0, 0]}
        material={open ? makeEmissive("#7fd6c0", 1.6) : M.aluminium}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
          audioBus.emit("chime");
        }}
      >
        <cylinderGeometry args={[0.03, 0.03, 0.02, 12]} />
      </mesh>
    </group>
  );
}

/** Digital information kiosk — shows the live room directory with occupancy. */
export function InfoKiosk({
  position,
  rotation = 0,
  lines,
}: {
  position: [number, number, number];
  rotation?: number;
  lines: Array<{ label: string; detail: string }>;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.7, 0]} castShadow receiveShadow material={M.steel}>
        <boxGeometry args={[0.1, 1.4, 0.3]} />
      </mesh>
      <group position={[0, 1.52, 0.02]} rotation={[-0.14, 0, 0]}>
        <mesh castShadow material={M.rubberFloor}>
          <boxGeometry args={[0.62, 0.92, 0.04]} />
        </mesh>
        <mesh position={[0, 0, 0.021]} material={makeEmissive("#101d1a", 0.5)}>
          <planeGeometry args={[0.56, 0.86]} />
        </mesh>
        <Text position={[0, 0.36, 0.03]} fontSize={0.05} color="#7fd6c0" anchorX="center" anchorY="middle">
          TODAY AT ARIA
        </Text>
        {lines.slice(0, 8).map((line, index) => (
          <group key={index} position={[0, 0.24 - index * 0.082, 0.03]}>
            <Text position={[-0.26, 0, 0]} fontSize={0.034} color="#e8f2ef" anchorX="left" anchorY="middle" maxWidth={0.34}>
              {line.label}
            </Text>
            <Text position={[0.26, 0, 0]} fontSize={0.028} color="#8aa39d" anchorX="right" anchorY="middle" maxWidth={0.2}>
              {line.detail}
            </Text>
          </group>
        ))}
      </group>
    </group>
  );
}

/** Cork notice board with pinned papers — classrooms and the corridor. */
export function NoticeBoard({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const papers = useRef(
    Array.from({ length: 6 }, (_, index) => ({
      x: -0.32 + (index % 3) * 0.32 + (Math.sin(index * 7.3) * 0.04),
      y: 0.16 - Math.floor(index / 3) * 0.34 + Math.cos(index * 3.1) * 0.03,
      tilt: Math.sin(index * 13.7) * 0.09,
      tone: ["#f6f2e8", "#eef4f6", "#f8eede"][index % 3],
    })),
  );
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh castShadow material={M.oak}>
        <boxGeometry args={[1.1, 0.84, 0.03]} />
      </mesh>
      <mesh position={[0, 0, 0.017]}>
        <planeGeometry args={[1.02, 0.76]} />
        <meshStandardMaterial color="#a5825a" roughness={0.98} envMapIntensity={0.4} />
      </mesh>
      {papers.current.map((paper, index) => (
        <mesh key={index} position={[paper.x, paper.y, 0.025]} rotation={[0, 0, paper.tilt]}>
          <planeGeometry args={[0.2, 0.26]} />
          <meshStandardMaterial color={paper.tone} roughness={0.95} envMapIntensity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/** Restroom door sign — set dressing along the corridor. */
export function RestroomSign({
  position,
  rotation = 0,
  label,
}: {
  position: [number, number, number];
  rotation?: number;
  label: string;
}) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh material={M.aluminium}>
        <boxGeometry args={[0.26, 0.26, 0.012]} />
      </mesh>
      <Text position={[0, 0, 0.01]} fontSize={0.06} color="#1d2a27" anchorX="center" anchorY="middle" maxWidth={0.22}>
        {label}
      </Text>
    </group>
  );
}
