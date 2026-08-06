import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Campus multiplayer client: presence, movement sync, and proximity voice.
 *
 * ── Movement ──
 * Outbound position is throttled and change-gated: sending 60 updates/sec when standing still is
 * pure waste, so an update goes out only when the avatar has actually moved/turned meaningfully,
 * capped at ~15Hz. Inbound peer positions are stored as targets, NOT applied directly — the
 * renderer interpolates toward them, which is what makes 15Hz network updates look like smooth
 * 60fps movement instead of teleporting.
 *
 * ── Voice ──
 * Peer connections are opened by proximity and torn down when people walk apart, so you are only
 * ever streaming audio with people near you. Audio is routed through the WebAudio graph with a
 * PannerNode per peer, positioned at that peer's location in the 3D world: someone to your left
 * is heard on your left, and volume falls off with distance. That spatialisation is what makes a
 * room full of people feel like a place rather than a conference call.
 *
 * To avoid both sides dialling each other simultaneously (glare), the peer with the
 * lexicographically smaller id is designated the initiator.
 */

export type PeerState = {
  id: string;
  name: string;
  color: string;
  /** Latest authoritative position from the network. */
  position: [number, number, number];
  rotation: number;
  animation: "idle" | "walking" | "running" | "sitting";
  room: string;
  seat: string | null;
  /** True while this peer's mic is producing sound — drives the speaking indicator. */
  speaking: boolean;
};

type NetworkOptions = {
  url?: string;
  enabled: boolean;
  name?: string;
  color?: string;
  /** Distance at which voice connections open. Slightly larger than audible range so audio is
   *  already flowing by the time someone is close enough to hear. */
  voiceRadius?: number;
  /** Distance at which a peer becomes inaudible. */
  audibleRadius?: number;
};

const DEFAULT_URL =
  import.meta.env.VITE_CAMPUS_SERVER_URL ||
  `ws://${window.location.hostname}:8787`;

const ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function useCampusNetwork({
  url = DEFAULT_URL,
  enabled,
  name,
  color,
  voiceRadius = 14,
  audibleRadius = 11,
}: NetworkOptions) {
  const [connected, setConnected] = useState(false);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [peers, setPeers] = useState<Map<string, PeerState>>(new Map());
  const [micEnabled, setMicEnabled] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const peersRef = useRef<Map<string, PeerState>>(new Map());
  const connectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioNodesRef = useRef<Map<string, { panner: PannerNode; gain: GainNode; el: HTMLAudioElement }>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const lastSentRef = useRef({ t: 0, p: [0, 0, 0] as number[], r: 0 });

  const commitPeers = useCallback(() => {
    setPeers(new Map(peersRef.current));
  }, []);

  // ── WebRTC ────────────────────────────────────────────────────────────────
  const ensureAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new Ctor();
    }
    if (audioCtxRef.current.state === "suspended") void audioCtxRef.current.resume();
    return audioCtxRef.current;
  }, []);

  const signal = useCallback((to: string, data: unknown) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "signal", to, data }));
    }
  }, []);

  /** Attach a remote track to a spatialised WebAudio node positioned at that peer. */
  const attachRemoteAudio = useCallback((peerId: string, stream: MediaStream) => {
    const ctx = ensureAudioContext();

    // Chrome requires the stream to be attached to a media element for WebRTC audio to flow,
    // even when routing through WebAudio. The element itself stays muted; the audible path is
    // the panner. Without this the MediaStreamSource produces silence in Chromium.
    const el = new Audio();
    el.srcObject = stream;
    el.muted = true;
    el.autoplay = true;
    void el.play().catch(() => {});

    const source = ctx.createMediaStreamSource(stream);
    const panner = ctx.createPanner();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 2.5;
    panner.maxDistance = audibleRadius;
    panner.rolloffFactor = 1.4;
    const gain = ctx.createGain();
    gain.gain.value = 1;

    source.connect(panner).connect(gain).connect(ctx.destination);
    audioNodesRef.current.set(peerId, { panner, gain, el });
  }, [audibleRadius, ensureAudioContext]);

  const createConnection = useCallback(
    (peerId: string, initiator: boolean) => {
      if (connectionsRef.current.has(peerId)) return connectionsRef.current.get(peerId)!;

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      connectionsRef.current.set(peerId, pc);

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      pc.onicecandidate = (event) => {
        if (event.candidate) signal(peerId, { candidate: event.candidate });
      };
      pc.ontrack = (event) => {
        attachRemoteAudio(peerId, event.streams[0]);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closeConnection(peerId);
        }
      };

      if (initiator) {
        void (async () => {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          signal(peerId, { sdp: pc.localDescription });
        })();
      }
      return pc;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signal, attachRemoteAudio],
  );

  const closeConnection = useCallback((peerId: string) => {
    connectionsRef.current.get(peerId)?.close();
    connectionsRef.current.delete(peerId);
    const audio = audioNodesRef.current.get(peerId);
    if (audio) {
      audio.el.srcObject = null;
      audio.panner.disconnect();
      audio.gain.disconnect();
      audioNodesRef.current.delete(peerId);
    }
  }, []);

  // ── Socket ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket;
    let closed = false;

    try {
      socket = new WebSocket(url);
    } catch {
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      setConnected(true);
      if (name || color) socket.send(JSON.stringify({ type: "profile", name, color }));
    };
    socket.onclose = () => {
      setConnected(false);
      if (!closed) {
        // Peers are meaningless without a connection; clear so stale avatars don't linger.
        peersRef.current.clear();
        commitPeers();
      }
    };
    socket.onerror = () => setConnected(false);

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data as string);
      switch (message.type) {
        case "welcome": {
          selfIdRef.current = message.id;
          setSelfId(message.id);
          for (const remote of message.players) upsertPeer(remote);
          commitPeers();
          break;
        }
        case "join": {
          upsertPeer(message.player);
          commitPeers();
          break;
        }
        case "sync": {
          for (const remote of message.players) upsertPeer(remote);
          commitPeers();
          break;
        }
        case "profile": {
          const existing = peersRef.current.get(message.id);
          if (existing) {
            existing.name = message.profile.name;
            existing.color = message.profile.color;
            commitPeers();
          }
          break;
        }
        case "leave": {
          peersRef.current.delete(message.id);
          closeConnection(message.id);
          commitPeers();
          break;
        }
        case "signal": {
          const from = message.from as string;
          const data = message.data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
          const pc = connectionsRef.current.get(from) ?? createConnection(from, false);
          if (data.sdp) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            if (data.sdp.type === "offer") {
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              signal(from, { sdp: pc.localDescription });
            }
          } else if (data.candidate) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch {
              /* candidate arriving before remote description — safe to drop */
            }
          }
          break;
        }
        default:
          break;
      }
    };

    function upsertPeer(remote: { id: string; profile: { name: string; color: string }; state: { p: number[]; r: number; a: string; room: string; seat: string | null } }) {
      if (remote.id === selfIdRef.current) return;
      const existing = peersRef.current.get(remote.id);
      const next: PeerState = {
        id: remote.id,
        name: remote.profile?.name ?? existing?.name ?? "Student",
        color: remote.profile?.color ?? existing?.color ?? "#7aa2c8",
        position: (remote.state?.p as [number, number, number]) ?? existing?.position ?? [0, 1, 0],
        rotation: remote.state?.r ?? existing?.rotation ?? 0,
        animation: (remote.state?.a as PeerState["animation"]) ?? "idle",
        room: remote.state?.room ?? existing?.room ?? "atrium",
        seat: remote.state?.seat ?? null,
        speaking: existing?.speaking ?? false,
      };
      peersRef.current.set(remote.id, next);
    }

    return () => {
      closed = true;
      socket.close();
      socketRef.current = null;
      for (const id of [...connectionsRef.current.keys()]) closeConnection(id);
    };
  }, [enabled, url, name, color, commitPeers, closeConnection, createConnection, signal]);

  // ── Public API ────────────────────────────────────────────────────────────

  /** Report our own position. Change-gated + rate-limited; see the note at the top. */
  const reportMovement = useCallback(
    (position: [number, number, number], rotation: number, animation: string, room: string, seat: string | null) => {
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) return;
      const now = performance.now();
      const last = lastSentRef.current;
      const movedFar = Math.hypot(position[0] - last.p[0], position[2] - last.p[2]) > 0.04;
      const turned = Math.abs(rotation - last.r) > 0.05;
      if (now - last.t < 66) return;              // ~15Hz ceiling
      if (!movedFar && !turned && now - last.t < 1000) return; // idle heartbeat once a second
      lastSentRef.current = { t: now, p: [...position], r: rotation };
      socket.send(JSON.stringify({ type: "move", p: position, r: rotation, a: animation, room, seat }));
    },
    [],
  );

  /**
   * Update the listener (our own ears) and every peer's audio position, and open/close voice
   * connections by distance. Called each frame from the scene, which is the only place that
   * knows current world positions.
   */
  const updateSpatialAudio = useCallback(
    (listenerPosition: [number, number, number], listenerRotation: number) => {
      const ctx = audioCtxRef.current;
      if (ctx) {
        const listener = ctx.listener;
        const [lx, ly, lz] = listenerPosition;
        const fx = Math.sin(listenerRotation);
        const fz = Math.cos(listenerRotation);
        // Newer WebAudio exposes AudioParams; older Safari only has the deprecated setters.
        if (listener.positionX) {
          listener.positionX.value = lx;
          listener.positionY.value = ly;
          listener.positionZ.value = lz;
          listener.forwardX.value = fx;
          listener.forwardY.value = 0;
          listener.forwardZ.value = fz;
          listener.upY.value = 1;
        } else {
          (listener as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(lx, ly, lz);
          (listener as unknown as { setOrientation(x: number, y: number, z: number, ux: number, uy: number, uz: number): void })
            .setOrientation(fx, 0, fz, 0, 1, 0);
        }
      }

      for (const peer of peersRef.current.values()) {
        const distance = Math.hypot(
          peer.position[0] - listenerPosition[0],
          peer.position[2] - listenerPosition[2],
        );

        // Open a connection when someone comes into range, tear it down when they leave —
        // with hysteresis so someone loitering at exactly the boundary doesn't thrash.
        const hasConnection = connectionsRef.current.has(peer.id);
        if (!hasConnection && distance < voiceRadius && micEnabled && selfIdRef.current) {
          createConnection(peer.id, selfIdRef.current < peer.id);
        } else if (hasConnection && distance > voiceRadius * 1.35) {
          closeConnection(peer.id);
        }

        const node = audioNodesRef.current.get(peer.id);
        if (node) {
          node.panner.positionX.value = peer.position[0];
          node.panner.positionY.value = peer.position[1];
          node.panner.positionZ.value = peer.position[2];
        }
      }
    },
    [micEnabled, voiceRadius, createConnection, closeConnection],
  );

  /** Request the mic and start streaming to any already-connected peers. */
  const enableMic = useCallback(async () => {
    try {
      ensureAudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;
      for (const pc of connectionsRef.current.values()) {
        for (const track of stream.getTracks()) pc.addTrack(track, stream);
      }
      setMicEnabled(true);
      setVoiceError(null);
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "Microphone unavailable");
      setMicEnabled(false);
    }
  }, [ensureAudioContext]);

  const disableMic = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setMicEnabled(false);
  }, []);

  /**
   * Temporarily silence the outgoing mic without tearing down peer connections.
   * Used when the AI tutor takes the microphone at a smartboard: the peer graph stays warm so
   * walking away from the board restores conversation instantly.
   */
  const setMicMuted = useCallback((muted: boolean) => {
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }, []);

  const peerList = useMemo(() => [...peers.values()], [peers]);

  return {
    connected,
    selfId,
    peers: peerList,
    micEnabled,
    voiceError,
    reportMovement,
    updateSpatialAudio,
    enableMic,
    disableMic,
    setMicMuted,
  };
}
