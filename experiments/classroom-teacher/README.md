# Classroom teacher (parked experiment, 2026-10-09)

A full-body Aria standing in front of the board on a classroom wall: she explains from her lane
right of the board, walks to it when it writes, holds a marker whose nib follows the board's pen
(left-handed, so she never covers fresh ink), crouches for low lines, and the board's pen waits for
her while she walks. Laptop demo at `/classroom`; an MP4 recorder for sharing.

Parked at the owner's request (2026-10-09): the product went back to the bust cutout at the
board's lower right.

## Bringing it back

**Easiest — the branch, exactly as it ran:**

    git checkout experiment/classroom-teacher
    cd frontend/web && npm install && npm run dev   # then open /classroom

**Onto another branch — the two patches:**

    git am experiments/classroom-teacher/patches/*.patch

They add `LessonPlayer classroom`, the `/classroom` route, the teacher (components/classroom,
lib/classroom), the pen-tip / pen-hold / glyph messages between the board sandbox and the page,
the 5 MB teacher model (public/classroom), its tests, `@types/three`, and the tour and recorder
scripts. If they no longer apply cleanly, `files/` holds every touched file as it was.

## What is in `files/`

Every file the experiment added or changed, at its original path, as of commit f80e5554:

- `frontend/web/components/classroom/ClassroomTeacher.tsx` — the three.js teacher: clips, two-bone
  IK writing arm and marker grip, head turns, lip-sync onto her own viseme shapes.
- `frontend/web/lib/classroom/teacherBrain.ts` — where she stands and what she does (pure, tested by
  `lib/anim/classroomBrain.test.ts`).
- `frontend/web/lib/classroom/penTip.ts` — the events between the board's pen and the teacher.
- `frontend/web/components/classroom/ClassroomRoom.tsx` — the wall, floor and board frame.
- `frontend/web/public/classroom/aria-teacher.glb` — Microsoft Rocketbox Female_Adult_14 + 14 clips
  (MIT, licence beside it).
- `frontend/web/lib/classroom/heartLecture.json`, `demoLecture.ts`, `app/classroom/page.tsx` — the demo.
- `frontend/web/scripts/avatar/classroom-tour.mjs`, `record-classroom.mjs` — verification and MP4.
- `LessonPlayer.tsx`, `ReactAnimationSandbox.tsx`, `sandboxMotion.ts` — full copies with the
  classroom wiring, for reference.

The research behind it: `docs/research/full-body-teacher-2026-10-09.md`.
