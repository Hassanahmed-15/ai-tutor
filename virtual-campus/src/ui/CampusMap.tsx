import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { CAMPUS_PEOPLE, CAMPUS_ROOMS } from "../campus";
import { CORRIDOR, ROOMS } from "../scene/floorplan";

/**
 * The campus map — a live plan drawn from the same floorplan data the 3D world is built from,
 * so it can never drift out of date. Click a room to travel there; search covers rooms,
 * subjects, and teachers.
 *
 * This is 2D DOM/SVG rather than an in-world object deliberately: a map's job is wayfinding for
 * people who are lost or who cannot comfortably navigate 3D at all, so it must not itself
 * require 3D navigation to reach. It is fully keyboard-operable.
 */

const WORLD = { minX: -21, maxX: 21, minZ: -60, maxZ: 30 };
const SCALE = 4.4;
const MAP_W = (WORLD.maxX - WORLD.minX) * SCALE;
const MAP_H = (WORLD.maxZ - WORLD.minZ) * SCALE;

const toMapX = (x: number) => (x - WORLD.minX) * SCALE;
const toMapY = (z: number) => (z - WORLD.minZ) * SCALE;

export function CampusMap({
  open,
  onClose,
  onNavigate,
  playerPosition,
  selectedRoomId,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (roomId: string) => void;
  playerPosition: [number, number, number];
  selectedRoomId: string;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];
    const rooms = CAMPUS_ROOMS.filter(
      (room) =>
        room.name.toLowerCase().includes(trimmed) ||
        room.shortName.toLowerCase().includes(trimmed) ||
        room.subject.toLowerCase().includes(trimmed),
    ).map((room) => ({ kind: "room" as const, id: room.id, title: room.shortName, detail: room.subject }));
    // Teachers resolve to the room they teach in, so "find a teacher" is also wayfinding.
    const people = CAMPUS_PEOPLE.filter((person) => person.name.toLowerCase().includes(trimmed)).map((person) => ({
      kind: "person" as const,
      id: nearestRoomTo(person.position),
      title: person.name,
      detail: person.role,
    }));
    return [...rooms, ...people].slice(0, 8);
  }, [query]);

  if (!open) return null;

  return (
    <section className="campus-map" role="dialog" aria-modal="true" aria-label="Campus map and search">
      <header className="map-header">
        <h2>Campus map</h2>
        <div className="map-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            placeholder="Find a room, subject, or teacher…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search rooms, subjects, and teachers"
            autoFocus
          />
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close map">
          <X size={19} />
        </button>
      </header>

      {results.length > 0 && (
        <ul className="map-results" aria-label="Search results">
          {results.map((result, index) => (
            <li key={`${result.kind}-${index}`}>
              <button
                onClick={() => {
                  onNavigate(result.id);
                  onClose();
                }}
              >
                <strong>{result.title}</strong>
                <small>{result.detail}</small>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="map-canvas" aria-hidden={results.length > 0}>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Plan of the ARIA campus">
          {/* Grounds */}
          <rect x={0} y={0} width={MAP_W} height={MAP_H} rx={14} className="map-ground" />
          {/* Corridor spine */}
          <rect
            x={toMapX(CORRIDOR.x - CORRIDOR.width / 2)}
            y={toMapY(CORRIDOR.from)}
            width={CORRIDOR.width * SCALE}
            height={(CORRIDOR.to - CORRIDOR.from) * SCALE}
            className="map-corridor"
          />
          {ROOMS.map((shell) => {
            const meta = CAMPUS_ROOMS.find((room) => room.id === shell.id);
            if (!meta) return null;
            const [cx, cz] = shell.center;
            const [w, d] = shell.size;
            const selected = shell.id === selectedRoomId;
            return (
              <g key={shell.id}>
                <rect
                  x={toMapX(cx - w / 2)}
                  y={toMapY(cz - d / 2)}
                  width={w * SCALE}
                  height={d * SCALE}
                  rx={4}
                  className={`map-room${selected ? " is-selected" : ""}`}
                  style={{ fill: meta.accent }}
                  role="button"
                  tabIndex={0}
                  aria-label={`Travel to ${meta.name}`}
                  onClick={() => {
                    onNavigate(shell.id);
                    onClose();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onNavigate(shell.id);
                      onClose();
                    }
                  }}
                />
                <text x={toMapX(cx)} y={toMapY(cz)} className="map-label">
                  {meta.shortName}
                </text>
              </g>
            );
          })}
          {/* The player, with a halo so the dot is findable at a glance. */}
          <circle cx={toMapX(playerPosition[0])} cy={toMapY(playerPosition[2])} r={9} className="map-you-halo" />
          <circle cx={toMapX(playerPosition[0])} cy={toMapY(playerPosition[2])} r={4} className="map-you" />
          <text x={toMapX(playerPosition[0])} y={toMapY(playerPosition[2]) - 13} className="map-you-label">
            You
          </text>
        </svg>
      </div>
      <p className="map-hint">Click any room to walk there · M closes the map</p>
    </section>
  );
}

function nearestRoomTo(position: [number, number, number]): string {
  let best = CAMPUS_ROOMS[0].id;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const room of CAMPUS_ROOMS) {
    const distance = Math.hypot(room.position[0] - position[0], room.position[2] - position[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = room.id;
    }
  }
  return best;
}
