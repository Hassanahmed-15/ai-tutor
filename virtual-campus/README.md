# ARIA Virtual Campus

A standalone, immersive campus prototype that hosts the existing Live Tutor as an interactive in-world smartboard. Nothing in this folder is imported by or written into the existing application.

## Run

```bash
npm install
npm run dev
```

The campus runs at `http://localhost:4173`. By default, smartboards open the existing tutor at `http://localhost:3000/`. Override that URL without changing code:

```bash
VITE_LIVE_TUTOR_URL=https://your-live-tutor.example npm run dev
```

## Player controls

- `WASD` or arrow keys: move the avatar relative to the camera.
- Hold `Shift`: run.
- `Space`: jump.
- Drag the world: orbit the third-person camera.
- Mouse wheel: camera distance.
- `E`: interact with a nearby smartboard.
- `Q`: travel to the safe place.
- `R`: return to the atrium.

On touch devices, the campus exposes a directional pad plus run and interact controls.

## Module boundary

- `src/CampusScene.tsx`: full Three.js campus, NPCs, classrooms, landmarks, and Rapier world colliders.
- `src/PlayerController.tsx`: visible player avatar, physics body, WASD/touch locomotion, procedural walk/run motion, third-person camera, room detection, and proximity interaction.
- `src/Hud.tsx`: semantic navigation, schedule, interaction prompts, presence, and accessibility preferences.
- `src/Smartboard.tsx`: trusted iframe adapter for the existing tutor and Gemini Live teacher.
- `src/campus.ts`: declarative room, accessibility, schedule, and person data.
- `src/App.tsx`: campus state and subsystem coordination.

The smartboard bridge intentionally treats Live Tutor as an independent product surface. Voice, whiteboard, diagram, pause/resume, and lecture state therefore remain controlled by the existing application.

## Accessibility model

The campus provides parallel spatial and semantic navigation, direct room travel, reduced-motion and quiet modes, high contrast, scalable labels, camera reset, a safe-place shortcut, descriptive room/object text, visible focus, and keyboard access. The dedicated rooms expose preferences rather than assigning disability labels to learners.

## Production extension points

The current presence layer uses local simulated occupants. A multiplayer transport can replace that source while preserving the same `CampusPerson` contract. Likewise, `Smartboard.tsx` is the only boundary that needs extension for a future postMessage protocol or same-origin component adapter.

## Running it

Two processes: the campus and the realtime server.

```bash
npm install
npm run dev:all      # campus on :4173, realtime server on :8787
```

Start the Live Tutor separately (`npm run dev` in `frontend/web`, port 3000) so the classroom
boards have something to show. Without it the boards render a designed standby screen rather
than an error.

### Multiplayer

Open http://localhost:4173 in two browser windows to see it working: each sees the other's
avatar move in real time with a name tag. Click **Talk nearby** to enable voice — audio is
spatialised, so peers get louder as you approach and pan to the side they are standing on.

`VITE_CAMPUS_SERVER_URL` overrides the realtime server address (defaults to the current host on
port 8787). `VITE_LIVE_TUTOR_URL` overrides the tutor origin.

## Controls

| Action | Input |
| --- | --- |
| Move | WASD / arrows, or the on-screen pad |
| Run | Shift |
| Jump | Space |
| Use the teaching board | Walk up, then E |
| Sit | Click a chair |
| Leave the board | "Step back" button (a cross-origin iframe swallows Escape) |
| Return to the atrium | R |

## Architecture notes

- `src/scene/floorplan.ts` is the single source of truth for the building. Rooms, walls, doors,
  windows, colliders, board mounts, and arrival points all derive from it, so geometry and
  physics cannot disagree. Changing the building is a data edit, not a geometry rewrite.
- `src/scene/kit/` holds the parametric architecture (walls with punched openings, doors that
  swing on real hinges with tracking colliders, glazing with mullion grids, four ceiling types).
- `src/scene/materials.ts` is a shared PBR material library; accessibility modes (low-stimulation,
  high-contrast) mutate it in place, so they are genuine rendering modes rather than CSS filters.
- `server/index.mjs` handles presence and movement on a 15Hz tick, and relays WebRTC signalling.
  Voice audio itself is peer-to-peer and never touches the server.
- The teaching board runs the real tutor in an iframe mounted on the classroom wall via drei's
  `<Html transform occlude="raycast">`. Only one is live at a time; the rest show a standby
  screen. The 2D dialog route is retained as the non-3D accessibility path.
