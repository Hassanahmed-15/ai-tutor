import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";

/**
 * ARIA campus realtime server.
 *
 * Two jobs, deliberately kept in one small process:
 *  1. PRESENCE + MOVEMENT — every connected student's position/rotation/state, broadcast to
 *     everyone else so avatars actually appear and move on other people's screens.
 *  2. WEBRTC SIGNALLING — relaying offer/answer/ICE between peers so they can open direct
 *     peer-to-peer audio connections for proximity voice. Audio itself never touches this
 *     server; it goes browser-to-browser, which keeps bandwidth cost at zero and latency low.
 *
 * Design notes:
 *  · Movement is broadcast at a fixed tick rate rather than on every client message. A client
 *    sending 60 updates/sec to 20 peers would be 1200 messages/sec fanned out; batching to a
 *    ~15Hz tick with only changed players keeps that at a small fraction and is well under the
 *    threshold where interpolation on the client hides the difference.
 *  · State is in-memory only. This is presence data — it is meaningless once someone
 *    disconnects, so persisting it would be pure overhead.
 *  · Voice peering is decided by the CLIENT based on distance, not here. The server only relays
 *    signalling; it has no opinion about who should hear whom, which keeps proximity rules on
 *    the side that already knows the 3D positions.
 */

const PORT = Number(process.env.CAMPUS_PORT ?? 8787);
const TICK_HZ = 15;
const STALE_MS = 30_000;

/** @type {Map<string, {id:string, socket:import("ws").WebSocket, profile:object, state:object, lastSeen:number, dirty:boolean}>} */
const players = new Map();

const wss = new WebSocketServer({ port: PORT });

function send(socket, type, payload) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({ type, ...payload }));
}

function broadcast(type, payload, exceptId) {
  const message = JSON.stringify({ type, ...payload });
  for (const player of players.values()) {
    if (player.id === exceptId) continue;
    if (player.socket.readyState === player.socket.OPEN) player.socket.send(message);
  }
}

function publicPlayer(player) {
  return { id: player.id, profile: player.profile, state: player.state };
}

wss.on("connection", (socket) => {
  const id = randomUUID().slice(0, 8);
  const player = {
    id,
    socket,
    profile: { name: `Student ${id.slice(0, 4)}`, color: "#7aa2c8" },
    state: { p: [0, 1, 14], r: 0, a: "idle", seat: null, room: "atrium", hand: false },
    lastSeen: Date.now(),
    dirty: false,
  };
  players.set(id, player);

  // Tell the newcomer who they are and who is already here.
  send(socket, "welcome", {
    id,
    players: [...players.values()].filter((other) => other.id !== id).map(publicPlayer),
  });
  // Tell everyone else about the newcomer.
  broadcast("join", { player: publicPlayer(player) }, id);

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // ignore malformed frames rather than killing the connection
    }
    player.lastSeen = Date.now();

    switch (message.type) {
      case "move": {
        // Trust but bound: clamp to the campus extents so a malformed or hostile client cannot
        // teleport an avatar to infinity and break everyone else's rendering.
        const [x, y, z] = message.p ?? [0, 1, 0];
        player.state.p = [clamp(x, -60, 60), clamp(y, -5, 30), clamp(z, -60, 60)];
        player.state.r = Number(message.r) || 0;
        player.state.a = message.a === "walking" || message.a === "running" || message.a === "sitting" ? message.a : "idle";
        player.state.room = typeof message.room === "string" ? message.room.slice(0, 40) : player.state.room;
        player.state.seat = typeof message.seat === "string" ? message.seat.slice(0, 40) : null;
        player.state.hand = message.hand === true;
        player.dirty = true;
        break;
      }
      case "profile": {
        if (typeof message.name === "string") player.profile.name = message.name.slice(0, 32);
        if (typeof message.color === "string") player.profile.color = message.color.slice(0, 16);
        broadcast("profile", { id, profile: player.profile }, id);
        break;
      }
      // ── WebRTC signalling relay ──────────────────────────────────────────
      // Forwarded verbatim to exactly one target. The server never inspects SDP or candidates.
      case "signal": {
        const target = players.get(message.to);
        if (target) send(target.socket, "signal", { from: id, data: message.data });
        break;
      }
      case "chat": {
        const text = String(message.text ?? "").slice(0, 500);
        if (text) broadcast("chat", { from: id, name: player.profile.name, text, room: player.state.room });
        break;
      }
      default:
        break;
    }
  });

  const close = () => {
    players.delete(id);
    broadcast("leave", { id }, id);
  };
  socket.on("close", close);
  socket.on("error", close);
});

function clamp(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 0;
}

// Movement tick: send only players who actually moved since the last tick.
setInterval(() => {
  const moved = [...players.values()].filter((player) => player.dirty);
  if (moved.length > 0) {
    broadcast("sync", { players: moved.map(publicPlayer) });
    for (const player of moved) player.dirty = false;
  }
  // Reap connections that stopped reporting (half-open sockets don't always fire 'close').
  const now = Date.now();
  for (const player of players.values()) {
    if (now - player.lastSeen > STALE_MS) {
      player.socket.terminate();
      players.delete(player.id);
      broadcast("leave", { id: player.id });
    }
  }
}, 1000 / TICK_HZ);

console.log(`[campus] realtime server listening on ws://localhost:${PORT}`);
