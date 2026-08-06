import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { KeyboardControls, Loader } from "@react-three/drei";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Hand, Mic, MicOff, Users, Zap } from "lucide-react";
import { CampusScene } from "./CampusScene";
import { CampusHud } from "./Hud";
import { PLAYER_CONTROL_MAP, type TeleportRequest, type TouchInput } from "./PlayerController";
import { SmartboardWorkspace } from "./Smartboard";
import { CAMPUS_ROOMS } from "./campus";
import { useCampusNetwork } from "./net/useCampusNetwork";
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
  /** Seat id the player currently occupies, or null when standing. Synced to peers so everyone
   *  sees who is actually sitting where. */
  const [seatedAt, setSeatedAt] = useState<string | null>(null);
  const selectedRoom = useMemo(
    () => CAMPUS_ROOMS.find((room) => room.id === selectedRoomId) ?? CAMPUS_ROOMS[0],
    [selectedRoomId],
  );

  // ── Multiplayer ───────────────────────────────────────────────────────────
  // A stable display name per browser session, so peers see a consistent person rather than a
  // new stranger on every reconnect.
  const displayName = useMemo(() => {
    const stored = window.localStorage.getItem("aria-campus-name");
    if (stored) return stored;
    const generated = `Student ${Math.floor(1000 + Math.random() * 9000)}`;
    window.localStorage.setItem("aria-campus-name", generated);
    return generated;
  }, []);
  const displayColor = useMemo(() => {
    const stored = window.localStorage.getItem("aria-campus-color");
    if (stored) return stored;
    // Colourblind-safe (Okabe-Ito) so peers stay distinguishable across colour-vision types.
    const palette = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00", "#56b4e9"];
    const generated = palette[Math.floor(Math.random() * palette.length)];
    window.localStorage.setItem("aria-campus-color", generated);
    return generated;
  }, []);

  const network = useCampusNetwork({
    enabled: true,
    name: displayName,
    color: displayColor,
  });

  const playerTransform = useRef<{ position: [number, number, number]; rotation: number }>({
    position: [0, 1, 14],
    rotation: 0,
  });

  const handleNetworkFrame = useCallback(
    (position: [number, number, number], rotation: number) => {
      playerTransform.current = { position, rotation };
      network.reportMovement(
        position,
        rotation,
        seatedAt ? "sitting" : player.state,
        selectedRoomId,
        seatedAt,
      );
      network.updateSpatialAudio(position, rotation);
    },
    // player.state/seatedAt are read through closure intentionally — this runs every frame and
    // must not re-create on every state change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network.reportMovement, network.updateSpatialAudio, selectedRoomId],
  );

  /**
   * Microphone arbitration.
   *
   * The AI tutor (Gemini Live) and peer voice chat both want the microphone. Walking up to a
   * smartboard hands the mic to the tutor and mutes the outgoing peer stream; walking away
   * restores classroom conversation. Peer connections are only muted, never torn down, so the
   * handoff back is instant rather than a fresh WebRTC negotiation.
   */
  useEffect(() => {
    network.setMicMuted(boardOpen);
  }, [boardOpen, network]);

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
                peers={network.peers}
                onNetworkFrame={handleNetworkFrame}
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

      {/* Live presence + voice. Shows who is genuinely connected right now, not simulated NPCs. */}
      <div className="presence-bar">
        <div className={`presence-status${network.connected ? " is-online" : ""}`}>
          <Users size={15} aria-hidden="true" />
          <span>
            {network.connected
              ? `${network.peers.length + 1} in campus`
              : "Offline — start the campus server"}
          </span>
        </div>

        <button
          className={`mic-button${network.micEnabled ? " is-live" : ""}${boardOpen ? " is-handed-over" : ""}`}
          onClick={() => (network.micEnabled ? network.disableMic() : void network.enableMic())}
          disabled={!network.connected}
          aria-pressed={network.micEnabled}
          title={
            boardOpen
              ? "Aria has the microphone while the smartboard is open"
              : network.micEnabled
                ? "Mute microphone"
                : "Talk to people near you"
          }
        >
          {network.micEnabled ? <Mic size={16} /> : <MicOff size={16} />}
          <span>
            {boardOpen
              ? "Mic → Aria"
              : network.micEnabled
                ? "Voice on"
                : "Talk nearby"}
          </span>
        </button>

        {network.peers.length > 0 && (
          <ul className="presence-list" aria-label="People nearby">
            {network.peers.slice(0, 6).map((peer) => (
              <li key={peer.id}>
                <span className="peer-dot" style={{ background: peer.color }} aria-hidden="true" />
                {peer.name}
              </li>
            ))}
          </ul>
        )}
      </div>

      {network.voiceError && (
        <p className="voice-error" role="status">Microphone unavailable: {network.voiceError}</p>
      )}

      {seatedAt && (
        <button className="stand-up-prompt" onClick={() => setSeatedAt(null)}>
          Stand up
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
