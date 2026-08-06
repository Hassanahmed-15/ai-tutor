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
