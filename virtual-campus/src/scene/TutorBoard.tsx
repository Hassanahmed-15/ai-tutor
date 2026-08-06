import { Html, RoundedBox, Text } from "@react-three/drei";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { M, makeEmissive } from "./materials";

/**
 * The teaching board, rendered INSIDE the 3D room rather than as a full-screen dialog.
 *
 * Previously, using the board meant opening a 2D overlay — you left the world to teach. Here the
 * real Live Tutor runs on the classroom wall, so you walk up to it and it is physically in the
 * room with you.
 *
 * ── Two verified mechanics this depends on ──
 * 1. `occlude` MUST be an array of meshes (raycast form), never the string "blending". Verified
 *    in drei's source: the blending path sets `pointerEvents:'none'` on the CANVAS element, which
 *    would break walking and looking. The array form also only raycasts the listed meshes, which
 *    is cheaper than testing the whole scene.
 * 2. Sizing is exact, not guesswork. Under `transform`, drei applies a scale of
 *    `1/(distanceFactor/400)`, so world_width = css_px × distanceFactor / 400. An 86" classroom
 *    display is 1.90m wide; at 1600 CSS px that gives distanceFactor = 1.90×400/1600 = 0.475.
 *
 * ── Cost control ──
 * The iframe is a full browser document running the entire tutor app, so exactly one may exist at
 * a time and only when someone is close. Distant boards show a rendered standby screen instead,
 * which costs a single emissive mesh.
 */

const BOARD_WIDTH = 1.9;
const BOARD_HEIGHT = 1.069; // 16:9
const CSS_WIDTH = 1600;
const DISTANCE_FACTOR = (BOARD_WIDTH * 400) / CSS_WIDTH; // 0.475

const LIVE_TUTOR_URL = import.meta.env.VITE_LIVE_TUTOR_URL || "http://localhost:3000/";

type TutorBoardProps = {
  position: [number, number, number];
  rotation: number;
  roomName: string;
  tutorRoute?: string;
  /** Only the single nearest board mounts a live iframe. */
  live: boolean;
  /** True when the player has explicitly focused the board — enables pointer events. */
  focused: boolean;
  onRequestFocus: () => void;
  /** Portal target outside the aria-hidden canvas subtree, so the focusable iframe is reachable
   *  by assistive tech and keyboard without violating WCAG 4.1.2. */
  portal?: React.RefObject<HTMLElement | null>;
  /** Uniform scale — 1 is an 86" classroom display; the auditorium uses ~1.8 for a hall-scale
   *  presentation surface. Scaling the group scales the Html transform with it, so the CSS pixel
   *  density (and therefore text legibility) is preserved exactly. */
  scale?: number;
};

export function TutorBoard({
  position,
  rotation,
  roomName,
  tutorRoute,
  live,
  focused,
  onRequestFocus,
  portal,
  scale = 1,
}: TutorBoardProps) {
  const bezel = useRef<THREE.Mesh>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const boardUrl = new URL(tutorRoute ?? "", LIVE_TUTOR_URL).toString();

  // An iframe pointing at a dead localhost fires no reliable error event, so race the load
  // against a timeout and fall back to the designed standby screen.
  useEffect(() => {
    if (!live) {
      setLoaded(false);
      setFailed(false);
      return;
    }
    const timer = window.setTimeout(() => setFailed((value) => (loaded ? value : true)), 4500);
    return () => window.clearTimeout(timer);
  }, [live, loaded]);

  const screenMaterial = useRef(makeEmissive("#0f1a18", 0.35));

  return (
    <group position={position} rotation={[0, rotation, 0]} scale={scale}>
      {/* Bezel + housing. A real display has depth, a frame, and a mount. */}
      <RoundedBox
        ref={bezel}
        args={[BOARD_WIDTH + 0.07, BOARD_HEIGHT + 0.07, 0.045]}
        radius={0.008}
        smoothness={3}
        castShadow
        receiveShadow
        material={M.steel}
      />
      {/* Wall mount arm behind. */}
      <mesh position={[0, -0.1, -0.06]} castShadow material={M.aluminium}>
        <boxGeometry args={[0.34, 0.34, 0.07]} />
      </mesh>
      {/* Under-board shelf with a marker tray — the detail that makes it a classroom board. */}
      <mesh position={[0, -BOARD_HEIGHT / 2 - 0.1, 0.06]} castShadow receiveShadow material={M.oak}>
        <boxGeometry args={[BOARD_WIDTH + 0.1, 0.035, 0.16]} />
      </mesh>

      {live && !failed ? (
        <Html
          transform
          // "raycast" (not "blending"): verified in drei's source that the blending path sets
          // pointerEvents:'none' on the CANVAS element, which would break walking and camera
          // drag. The raycast form preserves canvas interaction while still hiding the board
          // when geometry occludes it.
          occlude="raycast"
          distanceFactor={DISTANCE_FACTOR}
          position={[0, 0, 0.026]}
          zIndexRange={[12, 0]}
          portal={portal as React.RefObject<HTMLElement> | undefined}
          style={{
            width: `${CSS_WIDTH}px`,
            height: `${Math.round(CSS_WIDTH * (BOARD_HEIGHT / BOARD_WIDTH))}px`,
            // Unfocused, the board is a display you look at; focused, it is interactive. This is
            // what stops board clicks from stealing the drag-to-look camera while walking past.
            pointerEvents: focused ? "auto" : "none",
            borderRadius: "2px",
            overflow: "hidden",
            background: "#0f1a18",
          }}
        >
          <iframe
            title={`Live Tutor in ${roomName}`}
            src={boardUrl}
            onLoad={() => setLoaded(true)}
            allow="microphone; camera; autoplay; fullscreen; clipboard-write"
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ width: "100%", height: "100%", border: "none", display: "block" }}
          />
        </Html>
      ) : (
        <StandbyScreen roomName={roomName} offline={failed} material={screenMaterial.current} />
      )}

      {/* Invisible click target covering the screen. Present only when the board is NOT focused,
          so once focused every click goes to the tutor rather than being intercepted here. */}
      {!focused && (
        <mesh
          position={[0, 0, 0.03]}
          onClick={(event) => {
            event.stopPropagation();
            onRequestFocus();
          }}
          visible={false}
        >
          <planeGeometry args={[BOARD_WIDTH, BOARD_HEIGHT]} />
        </mesh>
      )}
    </group>
  );
}

/**
 * The board's idle state — a deliberately designed standby screen rather than a browser error.
 * This is what a player sees on every board they are not standing at, so it has to look like
 * part of the building.
 */
function StandbyScreen({
  roomName,
  offline,
  material,
}: {
  roomName: string;
  offline: boolean;
  material: THREE.Material;
}) {
  return (
    <group position={[0, 0, 0.026]}>
      <mesh material={material}>
        <planeGeometry args={[BOARD_WIDTH, BOARD_HEIGHT]} />
      </mesh>
      <Text
        position={[0, 0.12, 0.002]}
        fontSize={0.088}
        color="#7fd6c0"
        anchorX="center"
        anchorY="middle"
        maxWidth={BOARD_WIDTH * 0.85}
      >
        ARIA
      </Text>
      <Text
        position={[0, -0.02, 0.002]}
        fontSize={0.052}
        color="#e8f2ef"
        anchorX="center"
        anchorY="middle"
        maxWidth={BOARD_WIDTH * 0.85}
      >
        {roomName}
      </Text>
      <Text
        position={[0, -0.16, 0.002]}
        fontSize={0.036}
        color={offline ? "#f0b64a" : "#7b8f8a"}
        anchorX="center"
        anchorY="middle"
        maxWidth={BOARD_WIDTH * 0.8}
      >
        {offline
          ? "Live Tutor offline — start it on localhost:3000"
          : "Walk closer and press E to start the lesson"}
      </Text>
      {/* Standby indicator. */}
      <mesh position={[BOARD_WIDTH / 2 - 0.07, -BOARD_HEIGHT / 2 + 0.06, 0.003]}>
        <circleGeometry args={[0.012, 12]} />
        <meshBasicMaterial color={offline ? "#f0b64a" : "#58d68d"} toneMapped={false} />
      </mesh>
    </group>
  );
}
