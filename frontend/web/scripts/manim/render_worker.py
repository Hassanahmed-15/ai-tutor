"""
A long-lived Manim render worker.

WHY. `import manim` costs ~3.3 seconds, and a low-quality beat renders in ~8.7 seconds cold —
so nearly 40% of every render was spent re-importing a library the machine had already loaded
moments earlier. Spawning one process per beat meant a lecture paid that toll 12 times, and
the result was the thing this was built to fix: the narration finished before the picture
arrived.

PROTOCOL. Line-delimited JSON on stdin/stdout, one job per line:

    in   {"id": "abc", "script": {...}, "output": "…/abc.mp4", "quality": "low"}
    out  {"id": "abc", "ok": true,  "durationMs": 12133}
    out  {"id": "abc", "ok": false, "error": "…"}

A `{"ready": true}` line is emitted once Manim is imported, so the pool knows when a worker
can accept work rather than guessing with a timer.

Everything diagnostic goes to stderr. stdout carries protocol only — a stray print there
would desynchronise the caller's line reader.
"""

from __future__ import annotations

import json
import sys
import traceback

# Import once. This is the whole point of the file.
from render_beat import render_script  # noqa: E402


def main() -> int:
    # Node writes UTF-8; Python on Windows decodes stdin with the LOCALE encoding (cp1252
    # here). Without this, "H₂O" (48 e2 82 82 4f) arrives as "Hâ‚‚O" and renders as "Hâ,,O" —
    # every subscript, degree sign and arrow in a lecture silently mangled. The one-shot CLI
    # path reads with encoding="utf-8" and was always correct, which is exactly why this hid:
    # hand-verified renders used the CLI, the app uses this worker.
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
        except Exception:  # pragma: no cover - already UTF-8, or not reconfigurable
            pass

    sys.stdout.write(json.dumps({"ready": True}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        if line == "exit":
            return 0

        job_id = None
        try:
            job = json.loads(line)
            job_id = job.get("id")

            # Round-trip probe: echo the decoded text straight back so a test can assert the
            # exact string survived the stdin channel. Renders are slow and lossy to inspect;
            # this makes the encoding contract directly assertable on the real code path.
            if job.get("echo"):
                sys.stdout.write(json.dumps({"id": job_id, "ok": True, "echo": job.get("text", "")}) + "\n")
                sys.stdout.flush()
                continue

            result = render_script(
                job["script"],
                job["output"],
                job.get("quality", "medium"),
            )
            response = {"id": job_id, "ok": True, "durationMs": result["durationMs"]}
        except Exception as exc:  # noqa: BLE001 - one bad job must not kill the worker
            # Report and keep going. A malformed script is a per-beat failure, not a reason to
            # tear down a process that took 3.3s to warm up.
            traceback.print_exc(file=sys.stderr)
            response = {"id": job_id, "ok": False, "error": f"{type(exc).__name__}: {exc}"}

        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
