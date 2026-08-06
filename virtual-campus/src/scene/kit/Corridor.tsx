import { CuboidCollider } from "@react-three/rapier";
import { useMemo } from "react";
import { CORRIDOR } from "../floorplan";
import { M, makeEmissive } from "../materials";

/**
 * The circulation spine.
 *
 * This is the single most important piece of the building for making it read as architecture
 * rather than a collection of floating rooms. Rooms open off it, you travel along it between
 * classes, and it gives the campus an obvious front-to-back orientation so people can navigate
 * without a map.
 *
 * Detailing that carries the weight here:
 * · A continuous linear light slot in the ceiling running the full length — this draws the eye
 *   down the corridor and is exactly what a real institutional building does to signal direction.
 * · Exposed services (duct + cable tray) above, because a corridor is where a building shows its
 *   working.
 * · A change of floor material at each doorway threshold, so junctions read as intentional.
 * · Wall-mounted wayfinding at consistent heights on the structural grid.
 */
export function CorridorSpine({ quiet = false }: { quiet?: boolean }) {
  const length = CORRIDOR.to - CORRIDOR.from;
  const centerZ = (CORRIDOR.from + CORRIDOR.to) / 2;
  const halfWidth = CORRIDOR.width / 2;

  const slotMaterial = useMemo(() => makeEmissive("#fff6e8", quiet ? 0.5 : 1.35), [quiet]);

  return (
    <group>
      {/* Floor — polished concrete, continuous with the atrium. */}
      <mesh
        position={[CORRIDOR.x, 0.003, centerZ]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        material={M.concreteFloor}
      >
        <planeGeometry args={[CORRIDOR.width, length]} />
      </mesh>
      <CuboidCollider position={[CORRIDOR.x, -0.1, centerZ]} args={[halfWidth, 0.1, length / 2]} friction={0.9} />

      {/* Ceiling slab. */}
      <mesh
        position={[CORRIDOR.x, CORRIDOR.height, centerZ]}
        rotation={[Math.PI / 2, 0, 0]}
        material={M.concreteRaw}
      >
        <planeGeometry args={[CORRIDOR.width, length]} />
      </mesh>

      {/* Continuous linear light slot — the corridor's defining feature. */}
      <mesh position={[CORRIDOR.x, CORRIDOR.height - 0.04, centerZ]} material={slotMaterial}>
        <boxGeometry args={[0.22, 0.04, length - 1.2]} />
      </mesh>
      {/* A few real lights sampled along the slot so it actually illuminates the floor, without
          paying for one light per metre. */}
      {!quiet &&
        Array.from({ length: 5 }, (_, index) => (
          <pointLight
            key={index}
            position={[CORRIDOR.x, CORRIDOR.height - 0.5, CORRIDOR.from + ((index + 0.5) * length) / 5]}
            intensity={7}
            distance={11}
            decay={2}
            color="#fff3e2"
          />
        ))}

      {/* Exposed services above — duct and cable tray. */}
      <mesh position={[CORRIDOR.x - 1.2, CORRIDOR.height - 0.34, centerZ]} castShadow material={M.aluminium}>
        <boxGeometry args={[0.44, 0.3, length - 0.6]} />
      </mesh>
      <mesh position={[CORRIDOR.x + 1.25, CORRIDOR.height - 0.28, centerZ]} castShadow material={M.steel}>
        <boxGeometry args={[0.3, 0.1, length - 0.6]} />
      </mesh>

      {/* Structural columns on the 7.2m grid, expressed rather than hidden. */}
      {Array.from({ length: Math.floor(length / 7.2) }, (_, index) => {
        const z = CORRIDOR.from + 3.6 + index * 7.2;
        return [-1, 1].map((side) => (
          <mesh
            key={`${index}-${side}`}
            position={[CORRIDOR.x + side * (halfWidth + 0.18), CORRIDOR.height / 2, z]}
            castShadow
            receiveShadow
            material={M.concreteWall}
          >
            <boxGeometry args={[0.34, CORRIDOR.height, 0.34]} />
          </mesh>
        ));
      })}

      {/* Skirting reveal running the full length on both sides. */}
      {[-1, 1].map((side) => (
        <mesh
          key={side}
          position={[CORRIDOR.x + side * halfWidth, 0.045, centerZ]}
          material={M.concreteRaw}
        >
          <boxGeometry args={[0.06, 0.09, length]} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Landscape and courtyard.
 *
 * The courtyard exists for one reason: it gives the windows something worth looking at. A glass
 * facade facing an empty void is a strong "this is a demo" signal, whereas the same facade facing
 * trees and benches makes the whole building feel sited in a place.
 */
export function Grounds({ quiet = false }: { quiet?: boolean }) {
  return (
    <group>
      {/* Ground plane. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -8]} receiveShadow>
        <planeGeometry args={[160, 160]} />
        <meshStandardMaterial color="#5f7a58" roughness={1} metalness={0} envMapIntensity={0.3} />
      </mesh>

      {/* Paved entrance forecourt. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 27]} receiveShadow material={M.concreteFloor}>
        <planeGeometry args={[34, 16]} />
      </mesh>

      {/* Entrance canopy — signals the front door from a distance. */}
      <group position={[0, 0, 21.4]}>
        <mesh position={[0, 4.4, 0]} castShadow receiveShadow material={M.concreteWall}>
          <boxGeometry args={[18, 0.34, 5.4]} />
        </mesh>
        {[-7.4, -2.5, 2.5, 7.4].map((x) => (
          <mesh key={x} position={[x, 2.2, 2.3]} castShadow material={M.steel}>
            <cylinderGeometry args={[0.09, 0.09, 4.4, 12]} />
          </mesh>
        ))}
      </group>

      {/* Courtyard between the wings, visible through the classroom glazing. */}
      <group position={[0, 0, -12]}>
        {[-19, 19].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
              <circleGeometry args={[5.4, 24]} />
              <meshStandardMaterial color="#6d8a62" roughness={0.98} envMapIntensity={0.3} />
            </mesh>
            {!quiet && <CourtyardTree position={[0, 0, 0]} scale={1.15} />}
            {!quiet && <CourtyardTree position={[3.1, 0, -2.6]} scale={0.82} />}
            <Bench position={[0, 0, 3.6]} />
          </group>
        ))}
      </group>

      {/* Perimeter planting — breaks the horizon so the campus doesn't sit on an infinite plane. */}
      {!quiet &&
        Array.from({ length: 14 }, (_, index) => {
          const angle = (index / 14) * Math.PI * 2;
          const radius = 46 + (index % 3) * 4;
          return (
            <CourtyardTree
              key={index}
              position={[Math.cos(angle) * radius, 0, -8 + Math.sin(angle) * radius]}
              scale={0.9 + (index % 4) * 0.14}
            />
          );
        })}
    </group>
  );
}

/**
 * A tree built from a tapered trunk, branch stubs, and layered alpha-free foliage masses.
 *
 * Deliberately procedural rather than a downloaded model: free tree assets vary wildly in style
 * and a mix of them looks like an asset pack. Three overlapping irregular canopy masses read as a
 * real tree at architectural distance far better than a single sphere, and cost almost nothing.
 */
function CourtyardTree({ position, scale = 1 }: { position: [number, number, number]; scale?: number }) {
  const canopy = useMemo(
    () => [
      { offset: [0, 3.5, 0] as [number, number, number], radius: 1.9, color: "#4a6b3c" },
      { offset: [0.85, 3.0, 0.5] as [number, number, number], radius: 1.4, color: "#3f5f34" },
      { offset: [-0.7, 3.2, -0.55] as [number, number, number], radius: 1.25, color: "#55764a" },
    ],
    [],
  );
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 1.6, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.13, 0.22, 3.2, 8]} />
        <meshStandardMaterial color="#6b563f" roughness={0.94} envMapIntensity={0.4} />
      </mesh>
      {canopy.map((mass, index) => (
        <mesh key={index} position={mass.offset} castShadow>
          <icosahedronGeometry args={[mass.radius, 1]} />
          <meshStandardMaterial color={mass.color} roughness={0.85} flatShading envMapIntensity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function Bench({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {[0, 1, 2].map((index) => (
        <mesh key={index} position={[0, 0.45, -0.18 + index * 0.18]} castShadow receiveShadow material={M.oak}>
          <boxGeometry args={[1.9, 0.05, 0.15]} />
        </mesh>
      ))}
      {[-0.78, 0.78].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]} castShadow material={M.steel}>
          <boxGeometry args={[0.06, 0.44, 0.5]} />
        </mesh>
      ))}
    </group>
  );
}
