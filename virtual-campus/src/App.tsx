import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls, Loader } from "@react-three/drei";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Hand, Zap } from "lucide-react";
import { CampusScene } from "./CampusScene";
import { CampusHud } from "./Hud";
import { PLAYER_CONTROL_MAP, type TeleportRequest, type TouchInput } from "./PlayerController";
import { SmartboardWorkspace } from "./Smartboard";
import { CAMPUS_ROOMS } from "./campus";
import type { AccessibilityProfile } from "./types";

const DEFAULT_ACCESSIBILITY: AccessibilityProfile = {
  reducedMotion: false,
  highContrast: false,
  quietWorld: false,
  largeLabels: false,
  monoAudio: false,
};

export default function App() {
  const [selectedRoomId, setSelectedRoomId] = useState("atrium");
  const [boardOpen, setBoardOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [accessibilityOpen, setAccessibilityOpen] = useState(false);
  const [profile, setProfile] = useState(DEFAULT_ACCESSIBILITY);
  const [nearbyBoard, setNearbyBoard] = useState<(typeof CAMPUS_ROOMS)[number] | null>(null);
  const [teleport, setTeleport] = useState<TeleportRequest>({ id: 0, position: [0, 1, 14] });
  const [touch, setTouch] = useState<TouchInput>({
    forward: false,
    back: false,
    left: false,
    right: false,
    run: false,
    interactNonce: 0,
  });
  const [player, setPlayer] = useState<{ position: [number, number, number]; state: "idle" | "walking" | "running" }>({
    position: [0, 1, 14],
    state: "idle",
  });
  const selectedRoom = useMemo(
    () => CAMPUS_ROOMS.find((room) => room.id === selectedRoomId) ?? CAMPUS_ROOMS[0],
    [selectedRoomId],
  );

  const travelToRoom = useCallback((roomId: string) => {
    const room = CAMPUS_ROOMS.find((candidate) => candidate.id === roomId) ?? CAMPUS_ROOMS[0];
    const position: [number, number, number] = room.id === "atrium"
      ? [0, 1, 14]
      : [room.camera[0], 1, room.camera[2]];
    setSelectedRoomId(room.id);
    setTeleport((request) => ({ id: request.id + 1, position }));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setBoardOpen(false);
        setAccessibilityOpen(false);
      }
      if (event.key.toLowerCase() === "r" && !event.metaKey && !event.ctrlKey) {
        travelToRoom("atrium");
      }
      if (event.key.toLowerCase() === "q" && !event.metaKey && !event.ctrlKey) {
        travelToRoom("wellness");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [travelToRoom]);

  return (
    <main
      className={`campus-app${profile.highContrast ? " is-high-contrast" : ""}${profile.largeLabels ? " has-large-labels" : ""}`}
    >
      <a className="skip-link" href="#campus-navigation">Skip 3D world</a>
      <div className="world" aria-hidden="true">
        <KeyboardControls map={PLAYER_CONTROL_MAP}>
          <Canvas
            /* "soft" selects PCFSoftShadowMap — the baseline before SoftShadows' PCSS patch. */
            shadows={profile.quietWorld ? false : "soft"}
            dpr={[1, profile.quietWorld ? 1.25 : 2]}
            /* fov 54 -> 50: a narrower lens is closer to how architectural photography is shot
               and reduces the wide-angle distortion that made rooms feel like game levels. */
            camera={{ position: [0, 3.2, 19], fov: 50, near: 0.1, far: 200 }}
            gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
          >
            <Suspense fallback={null}>
              <CampusScene
                selectedRoom={selectedRoom}
                profile={profile}
                onSelectRoom={setSelectedRoomId}
                onOpenBoard={() => setBoardOpen(true)}
                touch={touch}
                teleport={teleport}
                paused={boardOpen || accessibilityOpen}
                onRoomChange={(room) => setSelectedRoomId(room.id)}
                onBoardProximity={setNearbyBoard}
                onPlayerUpdate={(position, state) => setPlayer({ position, state })}
              />
            </Suspense>
          </Canvas>
        </KeyboardControls>
      </div>

      <CampusHud
        selectedRoom={selectedRoom}
        profile={profile}
        navOpen={navOpen}
        accessibilityOpen={accessibilityOpen}
        onNavigate={(roomId) => {
          travelToRoom(roomId);
          if (window.innerWidth < 760) setNavOpen(false);
        }}
        onToggleNav={() => setNavOpen((value) => !value)}
        onToggleAccessibility={() => setAccessibilityOpen((value) => !value)}
        onChangeProfile={setProfile}
        onOpenBoard={() => setBoardOpen(true)}
      />

      {nearbyBoard && !boardOpen && (
        <button className="interaction-prompt" onClick={() => setBoardOpen(true)}>
          <span className="interaction-key">E</span>
          <span><strong>Use smartboard</strong><small>{nearbyBoard.name}</small></span>
        </button>
      )}

      <div
        className={`player-readout is-${player.state}`}
        data-testid="player-readout"
        data-x={player.position[0].toFixed(2)}
        data-z={player.position[2].toFixed(2)}
      >
        <span aria-hidden="true" />
        <strong>{player.state === "idle" ? "Standing" : player.state === "walking" ? "Walking" : "Running"}</strong>
        <small>{selectedRoom.shortName} · {player.position[0].toFixed(1)}, {player.position[2].toFixed(1)}</small>
      </div>

      <MobileControls touch={touch} onChange={setTouch} />

      {boardOpen && (
        <SmartboardWorkspace room={selectedRoom} onClose={() => setBoardOpen(false)} />
      )}
      <Loader
        containerStyles={{ background: "#17211f" }}
        innerStyles={{ background: "rgba(255,255,255,.18)" }}
        barStyles={{ background: "#f0b64a" }}
        dataStyles={{ color: "#ffffff", fontFamily: "Inter, sans-serif" }}
      />
    </main>
  );
}

function MobileControls({ touch, onChange }: { touch: TouchInput; onChange: (touch: TouchInput) => void }) {
  const hold = (key: "forward" | "back" | "left" | "right" | "run", value: boolean) => {
    onChange({ ...touch, [key]: value });
  };
  const holdProps = (key: "forward" | "back" | "left" | "right" | "run") => ({
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      hold(key, true);
    },
    onPointerUp: () => hold(key, false),
    onPointerCancel: () => hold(key, false),
    onPointerLeave: () => hold(key, false),
  });
  return (
    <div className="mobile-controls" aria-label="Avatar controls">
      <div className="movement-pad">
        <button className="move-up" aria-label="Walk forward" {...holdProps("forward")}><ArrowUp /></button>
        <button className="move-left" aria-label="Walk left" {...holdProps("left")}><ArrowLeft /></button>
        <button className="move-down" aria-label="Walk backward" {...holdProps("back")}><ArrowDown /></button>
        <button className="move-right" aria-label="Walk right" {...holdProps("right")}><ArrowRight /></button>
      </div>
      <div className="mobile-actions">
        <button aria-label="Run" {...holdProps("run")}><Zap /></button>
        <button aria-label="Interact" onClick={() => onChange({ ...touch, interactNonce: touch.interactNonce + 1 })}><Hand /></button>
      </div>
    </div>
  );
}
