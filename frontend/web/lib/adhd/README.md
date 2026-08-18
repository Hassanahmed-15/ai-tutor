# The ADHD module

Everything ADHD-specific lives under these three folders. If you are adding an ADHD feature and it
does not fit one of them, that is a signal the feature needs splitting, not that it needs a fourth
folder somewhere else in the tree.

```
frontend/web/lib/adhd/          logic — attention, chunking, concept cards, review scheduling
frontend/web/components/adhd/   UI — pet, capture, card shelf, meters, overlays
frontend/web/app/adhd-lab/      a deterministic lab route for judging it without a full lecture
```

## Why a lab route

`/board-lab` and `/structure-lab` already prove their worth: they render a board on fixed input with
**no model call**, so a Playwright run measures the renderer and nothing else. `/adhd-lab` exists for
the same reason — ADHD features are stateful and time-dependent, and testing them by generating a
whole lecture and waiting for the right moment does not scale. Drive the state directly instead.

## What is NOT here yet, deliberately

Three ADHD files predate this module and still sit in their original places:

- `components/AdhdLessonPlayer.tsx`
- `lib/useAttentionMonitor.ts`
- `lib/rechunk.ts`

They are left alone on purpose. Moving them rewrites imports across the player and the accessibility
routing, which is a riskier change than it looks and unrelated to whatever you came here to build.
Migrate them in their own commit once this branch is proven to run, not as a side effect.

**New ADHD work goes in the new folders.** That way the module grows correctly from the start and the
migration, when it happens, is only about the three legacy files.

## The one rule that is not about file layout

Every negative signal is routed through the companion, never at the learner. "Pip looks sleepy" and
"you lost focus" carry the same information and land completely differently. Rejection sensitive
dysphoria means perceived failure registers as pain and drives avoidance of whatever caused it —
which, here, would be this app. Anything that fires on drift, on a wrong answer, or on a missed
session gets read aloud before it ships, asking one question: would this sting?
