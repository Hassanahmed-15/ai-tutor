# ADHD UI components

Pet, capture bar, card shelf, meters, overlays. See `lib/adhd/README.md` for the module convention
and the one design rule that governs everything in here.

Keep components dumb: state and scheduling belong in `lib/adhd/`, so the same logic can be driven
from `/adhd-lab` without mounting a lecture.
