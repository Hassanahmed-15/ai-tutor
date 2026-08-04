"""
Renders a DrawScript beat to an MP4 using Manim.

WHY THIS EXISTS
    The web board (components/sketch/LiveSketch.tsx) draws a DrawScript live in SVG, driven
    by a narration `progress` value. This renders the SAME DrawScript ahead of time with
    Manim instead, so a beat can be played back as video.

THE ONE INVARIANT THAT MATTERS
    The output video's time axis is identical to the DrawScript's `at` axis. An op with
    at=0.4 begins exactly 40% of the way through the video. That is what lets the player
    scrub with `video.currentTime = progress * duration` and stay in sync with the narration
    frame-for-frame, exactly as LiveSketch does. Every timing decision below protects that:
    gaps are padded with waits, and an animation is never allowed to run past the start of
    the next op.

DELIBERATELY NOT SUPPORTED (yet)
    `scene` (the ten composite templates), `image` (data-URI photos), `reactAnimation` and
    `chalkBoard`. Unknown ops are skipped with a warning rather than failing the render —
    a board that is missing one decoration still teaches; a board that fails to render does
    not.

Usage:
    python render_beat.py <script.json> <output.mp4> [--quality low|medium|high]
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

# Manim reads config at import time, so anything that must be set before the renderer spins
# up (ffmpeg location) has to happen here.
import os

try:
    import imageio_ffmpeg

    os.environ.setdefault("FFMPEG_BINARY", imageio_ffmpeg.get_ffmpeg_exe())
except Exception:  # pragma: no cover - falls back to a system ffmpeg
    pass

from manim import (  # noqa: E402
    BLACK,
    DOWN,
    LEFT,
    RIGHT,
    UP,
    Arrow,
    Circle,
    Circumscribe,
    Create,
    Dot,
    Ellipse,
    Flash,
    GrowArrow,
    Indicate,
    Line,
    MovingCameraScene,
    Polygon,
    Rectangle,
    Restore,
    Text,
    VGroup,
    Write,
    config,
    rate_functions,
)

from scenes import build_compound_shape, build_scene, board_text  # noqa: E402

# ---------------------------------------------------------------- geometry

# DrawScript uses a 0-100 grid with y pointing DOWN (SVG convention). Manim uses a
# frame-sized coordinate system centred on the origin with y pointing UP.
GRID = 100.0


def to_point(x: float, y: float):
    """0-100 grid -> Manim scene coordinates."""
    fx = (x / GRID - 0.5) * config.frame_width
    fy = (0.5 - y / GRID) * config.frame_height
    return [fx, fy, 0.0]


def to_width(w: float) -> float:
    return (w / GRID) * config.frame_width


def to_height(h: float) -> float:
    return (h / GRID) * config.frame_height


COLORS = {
    "amber": "#fbbf24",
    "green": "#4ade80",
    "blue": "#60a5fa",
    "slate": "#94a3b8",
    "rose": "#fb7185",
    "violet": "#a78bfa",
    "teal": "#5eead4",
}
# Board surfaces, mirroring LiveSketch.tsx: a "paper" board is white with grey marker ink,
# a "dark" board is near-black. Ignoring this was why real beats looked blank — EVERY
# generated lecture beat is `surface: "paper"` and carries a palette chosen for white paper
# (#6b7280 and #7a7f87 greys, #14b8a6 teal), which on a near-black board is invisible.
#
# NOTE the dark ink is NOT LiveSketch's `INK = "#1e293b"`. That value only reads on its black
# board because every stroke there goes through the `live-glow` SVG filter, which Manim has no
# equivalent of. Copying it would reproduce this exact bug on the dark surface.
SURFACES = {
    "paper": {"bg": "#fbfbf8", "ink": "#334155", "accent": "#14b8a6"},
    "dark": {"bg": "#020617", "ink": "#e2e8f0", "accent": "#5eead4"},
}


def surface_of(script: dict) -> dict:
    return SURFACES.get(str(script.get("surface") or "dark"), SURFACES["dark"])


def _rgb(hex_color: str) -> tuple[int, int, int] | None:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c + c for c in h)
    if len(h) != 6:
        return None
    try:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    except ValueError:
        return None


def luma(hex_color: str) -> float:
    """Rec. 601 luma, the same measure isNearBackgroundDark uses in lib/drawSanitize.ts."""
    rgb = _rgb(hex_color)
    if rgb is None:
        return 128.0
    r, g, b = rgb
    return 0.299 * r + 0.587 * g + 0.114 * b


def ensure_contrast(ink: str, bg: str, min_delta: float = 60.0) -> str:
    """
    Pushes `ink` away from `bg` until the two are distinguishable.

    A colour is chosen by the model, and nothing downstream checked it against the board it
    would land on — which is how a whole lecture rendered as invisible grey-on-black. Blending
    toward black or white preserves hue, so a teal stays teal and only its lightness moves.
    """
    ink_rgb = _rgb(ink)
    bg_rgb = _rgb(bg)
    if ink_rgb is None or bg_rgb is None:
        return ink

    bg_luma = luma(bg)
    if abs(luma(ink) - bg_luma) >= min_delta:
        return ink

    # Move away from the background: darker ink on a light board, lighter ink on a dark one.
    target = 0 if bg_luma > 127 else 255
    for step in range(1, 21):  # up to 100% blend, in 5% increments
        t = step / 20
        blended = tuple(round(c + (target - c) * t) for c in ink_rgb)
        candidate = "#{:02x}{:02x}{:02x}".format(*blended)
        if abs(luma(candidate) - bg_luma) >= min_delta:
            return candidate
    return "#{:02x}{:02x}{:02x}".format(target, target, target)

DIRECTIONS = {
    "up": UP,
    "down": DOWN,
    "left": LEFT,
    "right": RIGHT,
    "upLeft": UP + LEFT,
    "upRight": UP + RIGHT,
    "downLeft": DOWN + LEFT,
    "downRight": DOWN + RIGHT,
}

FONT_SIZES = {"sm": 22, "md": 28, "lg": 38}


def op_color(op: dict, fallback: str | None = None, bg: str | None = None) -> str:
    """Resolves an op's colour against the board it will be drawn on."""
    surface_ink = fallback or SURFACES["dark"]["ink"]
    raw = op.get("color")
    if not raw:
        resolved = surface_ink
    else:
        resolved = COLORS.get(raw, raw if str(raw).startswith("#") else surface_ink)
    # Guard last, so a model-chosen colour can never sink into the background.
    return ensure_contrast(resolved, bg) if bg else resolved


def wrap(text: str, width: int = 34) -> str:
    """Greedy wrap, mirroring LiveSketch's wrapText so line breaks land in the same places."""
    words = str(text).split()
    lines: list[str] = []
    line = ""
    for word in words:
        candidate = f"{line} {word}".strip()
        if len(candidate) > width and line:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return "\n".join(lines)


# ------------------------------------------------------------ construction


def build_mobject(op: dict, registry: dict, theme: dict):
    """Turns one op into a Manim mobject, or None if the op draws nothing itself."""
    kind = op.get("kind")
    color = op_color(op, theme["ink"], theme["bg"])

    if kind in ("label", "note"):
        raw = str(op.get("text", ""))
        if not raw:
            return None
        # Board font + a halo of the background colour, so a label positioned on top of its
        # shape (which is how DrawScripts are written) stays readable instead of vanishing
        # into it.
        if kind == "label":
            size = FONT_SIZES.get(op.get("size", "md"), FONT_SIZES["md"])
            mobj = board_text(raw[:60], size, color, bg=theme["bg"], bold=True)
        else:
            mobj = board_text(wrap(raw[:160]), 20, color, bg=theme["bg"])

    elif kind == "shape":
        shape = op.get("shape", "circle")
        w = to_width(op.get("w") or 16)
        h = to_height(op.get("h") or 12)
        # Real silhouettes first: sun/droplet/leaf/stove used to fall through to the rounded
        # rectangle below, which is why a photosynthesis board showed a box labelled "sun".
        compound = build_compound_shape(shape, w, h, color)
        if compound is not None:
            mobj = compound
        elif shape == "circle":
            mobj = Circle(radius=max(w, h) / 2, color=color, fill_opacity=0.15)
        elif shape == "hexagon":
            r = max(w, h) / 2
            mobj = Polygon(
                *[
                    [r * math.cos(a), r * math.sin(a), 0]
                    for a in [math.pi / 3 * i for i in range(6)]
                ],
                color=color,
                fill_opacity=0.15,
            )
        elif shape in ("line", "chain"):
            pts = op.get("points") or []
            if len(pts) >= 2:
                mobj = VGroup(
                    *[
                        Line(to_point(a["x"], a["y"]), to_point(b["x"], b["y"]), color=color)
                        for a, b in zip(pts, pts[1:])
                    ]
                )
            else:
                mobj = Line(
                    to_point(op["x"] - (op.get("w") or 16) / 2, op["y"]),
                    to_point(op["x"] + (op.get("w") or 16) / 2, op["y"]),
                    color=color,
                )
        else:
            # rect and every compound shape (leaf/sun/droplet/stove) degrade to a rounded
            # rectangle: recognisably "an object here", without pretending to be the drawing.
            mobj = Rectangle(width=w, height=h, color=color, fill_opacity=0.12)

    elif kind == "arrow":
        return Arrow(
            to_point(op["x1"], op["y1"]),
            to_point(op["x2"], op["y2"]),
            color=color,
            buff=0,
            stroke_width=4,
        )

    elif kind == "callout":
        dot = Dot(to_point(op["x"], op["y"]), color=color, radius=0.07)
        text = board_text(wrap(str(op.get("text", ""))[:80], 26), 19, color, bg=theme["bg"])
        text.next_to(dot, UP, buff=0.25)
        return VGroup(dot, text)

    elif kind == "motion":
        # A travelling agent: the path plus the dot that runs along it.
        start = to_point(op.get("x1", op.get("cx", 20)), op.get("y1", op.get("cy", 50)))
        end = to_point(op.get("x2", op.get("cx", 80)), op.get("y2", op.get("cy", 50)))
        return VGroup(Line(start, end, color=color, stroke_opacity=0.35), Dot(start, color=color))

    elif kind == "morph":
        w = to_width(op.get("w") or 12)
        h = to_height(op.get("h") or 10)
        body = Circle(radius=max(w, h) / 2, color=color, fill_opacity=0.2)
        label = board_text(str(op.get("text", ""))[:18], 18, color, bg=theme["bg"])
        mobj = VGroup(body, label)

    else:
        return None

    # Position: an anchor beats literal coordinates. This is Manim's own next_to() — the API
    # that lib/anim/nextTo.ts was ported FROM — so here it is simply the native call.
    anchor_id = op.get("anchorTo")
    target = registry.get(anchor_id) if anchor_id else None
    if target is not None:
        direction = DIRECTIONS.get(op.get("anchorDir", "up"), UP)
        buff = (op.get("anchorBuff") or 6) / GRID * config.frame_height
        mobj.next_to(target, direction, buff=max(0.12, buff))
    else:
        mobj.move_to(to_point(op.get("x", 50), op.get("y", 50)))

    return mobj


def entry_animation(op: dict, mobj):
    """How this op arrives. Mirrors LiveSketch: text is written, geometry is drawn."""
    kind = op.get("kind")
    if kind in ("label", "note", "callout"):
        return Write(mobj)
    if kind == "arrow":
        return GrowArrow(mobj)
    return Create(mobj)


# ------------------------------------------------------------------- scene


class BeatScene(MovingCameraScene):
    """Plays a DrawScript on Manim's timeline, preserving each op's `at` position."""

    script: dict = {}
    theme: dict = SURFACES["dark"]

    def construct(self):
        script = self.script
        self.theme = surface_of(script)
        self.camera.background_color = self.theme["bg"]
        duration = max(1.0, float(script.get("durationMs", 11000)) / 1000.0)

        ops = [op for op in script.get("ops", []) if isinstance(op, dict)]
        ops.sort(key=lambda o: float(o.get("at", 0)))
        registry: dict = {}

        # A `manimScene` op owns the whole board — it is not one item on a timeline but a
        # purpose-built scene (a plotted graph, a shape transformation) that Manim renders far
        # better than the SVG board can. Same shape as chalkBoard/reactAnimation: the model
        # writes a brief, a second call fills in `spec`, and this renders it.
        scene_op = next((op for op in ops if op.get("kind") == "manimScene"), None)
        if scene_op is not None:
            spec = scene_op.get("spec")
            if isinstance(spec, dict) and build_scene(self, spec, self.theme, duration):
                # Pad to the full duration so video time still equals DrawScript time, which
                # is what lets the player scrub it against narration progress.
                remaining = duration - self.renderer.time
                if remaining > 0:
                    self.wait(remaining)
                return
            print("[render_beat] manimScene op had no usable spec; falling through", file=sys.stderr)

        self._fit_camera_to_content(ops)
        # Saved AFTER fitting, so a `focus` op with no target restores to the fitted frame
        # rather than snapping back out to the full board.
        self.camera.frame.save_state()

        cursor = 0.0  # seconds of video already committed
        for index, op in enumerate(ops):
            start = max(0.0, min(1.0, float(op.get("at", 0)))) * duration
            # How long this op owns before the next one begins. Same clamps as LiveSketch's
            # windowMs so the two renderers pace identically.
            next_start = (
                max(0.0, min(1.0, float(ops[index + 1].get("at", 1)))) * duration
                if index + 1 < len(ops)
                else duration
            )
            window = max(0.5, min(2.6, next_start - start))

            # Pad the gap so this op begins at its own `at`, never earlier.
            if start > cursor:
                self.wait(start - cursor)
                cursor = start
            # If ops overlap, the previous animation already consumed this slot; compress
            # rather than drift, because drift would break the progress<->currentTime map.
            run_time = max(0.25, min(window, max(0.25, next_start - cursor)))

            played = self._play_op(op, registry, run_time, duration)
            if played:
                cursor += run_time

        if cursor < duration:
            self.wait(duration - cursor)

    def _fit_camera_to_content(self, ops: list) -> None:
        """
        Zooms the camera to the region the board actually uses.

        Generated note-style boards lay their content out in a left column (x 12-50 on the
        0-100 grid), which on a full 16:9 frame leaves the right half empty and the text tiny.
        LiveSketch gets away with it because its board is a responsive SVG; a fixed-size video
        does not. Only kicks in when content genuinely under-fills the frame, so a board that
        already uses the whole width is left alone.
        """
        xs: list[float] = []
        ys: list[float] = []
        for op in ops:
            if op.get("kind") in ("scene", "image", "reactAnimation", "chalkBoard", "focus"):
                continue
            for x_key, y_key in (("x", "y"), ("x1", "y1"), ("x2", "y2"), ("toX", "toY")):
                x, y = op.get(x_key), op.get(y_key)
                if isinstance(x, (int, float)) and isinstance(y, (int, float)):
                    xs.append(float(x))
                    ys.append(float(y))
            for point in op.get("points") or []:
                if isinstance(point, dict):
                    xs.append(float(point.get("x", 50)))
                    ys.append(float(point.get("y", 50)))

        if len(xs) < 2:
            return

        pad = 9.0  # grid units of breathing room, and room for text that extends past its anchor
        min_x, max_x = max(0.0, min(xs) - pad * 1.6), min(100.0, max(xs) + pad * 1.6)
        min_y, max_y = max(0.0, min(ys) - pad), min(100.0, max(ys) + pad)
        used_w, used_h = (max_x - min_x) / 100.0, (max_y - min_y) / 100.0
        if used_w <= 0 or used_h <= 0:
            return

        # Already fills most of the board — leave the framing alone.
        if used_w > 0.8 and used_h > 0.8:
            return

        # Choose the centre BEFORE the size. If the content straddles the board's centre line,
        # keep the camera centred there — otherwise a heading deliberately centred at x=50 gets
        # shoved off to one side by a crop only meant to remove empty margin.
        centre_x = 50.0 if min_x <= 50.0 <= max_x else (min_x + max_x) / 2
        centre_y = 50.0 if min_y <= 50.0 <= max_y else (min_y + max_y) / 2

        # Then size the frame to contain the content AROUND that centre. Sizing from the raw
        # bounding-box width instead would clip everything on the far side of the centre —
        # a narrow frame centred at x=50 does not contain content sitting at x=12.
        half_w = max(centre_x - min_x, max_x - centre_x) / 100.0
        half_h = max(centre_y - min_y, max_y - centre_y) / 100.0
        if half_w <= 0 or half_h <= 0:
            return

        # Keep the frame's aspect ratio; grow the smaller axis rather than distorting.
        aspect = config.frame_width / config.frame_height
        frame_w = max(2 * half_w * config.frame_width, 2 * half_h * config.frame_height * aspect)
        frame_w = min(frame_w, config.frame_width)
        self.camera.frame.set(width=frame_w).move_to(to_point(centre_x, centre_y))

    # -- one op ------------------------------------------------------------

    def _play_op(self, op: dict, registry: dict, run_time: float, duration: float) -> bool:
        kind = op.get("kind")

        if kind in ("scene", "image", "reactAnimation", "chalkBoard"):
            print(f"[render_beat] skipping unsupported op kind: {kind}", file=sys.stderr)
            return False

        # Emphasis: Manim has these natively, which is the entire reason this port is cheap.
        if kind in ("indicate", "circumscribe", "flash"):
            target = registry.get(op.get("targetId"))
            color = op_color(op, "#fbbf24", self.theme["bg"])
            if kind == "flash" or target is None:
                point = to_point(op.get("x", 50), op.get("y", 50))
                self.play(Flash(point, color=color, flash_radius=0.6), run_time=run_time)
            elif kind == "indicate":
                self.play(Indicate(target, color=color, scale_factor=1.2), run_time=run_time)
            else:
                self.play(Circumscribe(target, color=color), run_time=run_time)
            return True

        # Camera. Manim's MovingCameraScene is what `focus` was modelled on.
        if kind == "focus":
            target = registry.get(op.get("targetId"))
            if target is None:
                self.play(Restore(self.camera.frame), run_time=run_time)
            else:
                scale = float(op.get("scale") or 0.55)
                self.play(
                    self.camera.frame.animate.set(width=config.frame_width * scale).move_to(target),
                    run_time=run_time,
                    rate_func=rate_functions.smooth,
                )
            return True

        mobj = build_mobject(op, registry, self.theme)
        if mobj is None:
            return False

        if op.get("id"):
            registry[op["id"]] = mobj

        if kind == "motion":
            path, dot = mobj[0], mobj[1]
            self.add(path)
            self.play(
                dot.animate.move_to(path.get_end()),
                run_time=run_time,
                rate_func=rate_functions.smooth,
            )
            return True

        if kind == "morph":
            self.play(entry_animation(op, mobj), run_time=run_time * 0.4)
            end = to_point(op.get("toX", op.get("x", 50)), op.get("toY", op.get("y", 50)))
            self.play(
                mobj.animate.move_to(end).set_color(
                    op_color(
                        {"color": op.get("toColor")},
                        op_color(op, self.theme["ink"], self.theme["bg"]),
                        self.theme["bg"],
                    )
                ),
                run_time=run_time * 0.6,
                rate_func=rate_functions.smooth,
            )
            return True

        self.play(entry_animation(op, mobj), run_time=run_time)
        return True


# -------------------------------------------------------------------- main


QUALITY = {
    "low": ("480p15", 480, 15),
    "medium": ("720p30", 720, 30),
    "high": ("1080p60", 1080, 60),
}


def _write_faststart(produced: Path, output_path: Path) -> None:
    """
    Copies the rendered MP4 with its `moov` atom moved to the front.

    Manim muxes through PyAV, which writes `moov` AFTER the payload (`mdat@44`, `moov@78678`
    on every file this produced). A browser cannot begin playback — or seek — until it has the
    metadata, so with `moov` at the end it must download the whole file first. Since the player
    scrubs `currentTime` rather than playing, that made seeking unreliable and the board showed
    frame 0: blank.

    `-c copy` rewrites the container only, no re-encode, so this costs a fraction of a second.
    A failure here falls back to the original bytes: a beat that plays imperfectly beats a beat
    that does not exist.
    """
    ffmpeg = os.environ.get("FFMPEG_BINARY")
    if ffmpeg and Path(ffmpeg).exists():
        remuxed = produced.with_name("beat_faststart.mp4")
        result = subprocess.run(
            [ffmpeg, "-y", "-loglevel", "error", "-i", str(produced),
             "-c", "copy", "-movflags", "+faststart", str(remuxed)],
            capture_output=True,
        )
        if result.returncode == 0 and remuxed.exists() and remuxed.stat().st_size > 0:
            output_path.write_bytes(remuxed.read_bytes())
            return
        detail = result.stderr.decode("utf-8", "replace").strip()[:300]
        print(f"[render_beat] faststart remux failed, using original: {detail}", file=sys.stderr)
    else:
        print("[render_beat] no ffmpeg binary for faststart remux; using original", file=sys.stderr)

    output_path.write_bytes(produced.read_bytes())


def render_script(script: dict, output: str | Path, quality: str = "medium") -> dict:
    """
    Renders one DrawScript to `output`, returning {"output", "durationMs"}.

    Kept separate from main() so render_worker.py can call it repeatedly in one process.
    Importing Manim costs ~3.3 seconds, which is roughly 38% of a cold render — paying that
    once per beat instead of once per process was the single biggest source of the "the
    narration finished before the video appeared" problem.
    """
    _, height, fps = QUALITY[quality]
    # Both dimensions MUST be even: libx264 with yuv420p subsamples chroma 2x2 and
    # avcodec_open2 fails outright on an odd axis. 16:9 of 480 is 853.33, and truncating gives
    # 853 — which is exactly how "low" quality died while medium (1280) and high (1920) worked.
    config.pixel_height = height - (height % 2)
    config.pixel_width = round(height * 16 / 9 / 2) * 2
    config.frame_rate = fps
    config.verbosity = "ERROR"
    config.disable_caching = True
    config.progress_bar = "none"

    output_path = Path(output)

    # Render into a scratch dir, then move the single artifact to `output`. Manim's own media
    # tree is an implementation detail the caller should never have to know about. A fresh
    # temp dir per job also stops one render's partial movie files being picked up by the next
    # one when several run in the same worker process.
    with tempfile.TemporaryDirectory(prefix="manim-beat-") as tmp:
        config.media_dir = tmp
        config.output_file = "beat"

        BeatScene.script = script
        scene = BeatScene()
        scene.render()

        produced = next(Path(tmp).rglob("beat.mp4"), None)
        if produced is None:
            raise RuntimeError("manim produced no output file")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        _write_faststart(produced, output_path)

    # The caller needs the real duration to map progress -> currentTime.
    return {"output": str(output_path), "durationMs": int(scene.renderer.time * 1000)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a DrawScript beat to MP4 with Manim.")
    parser.add_argument("script", help="Path to a DrawScript JSON file")
    parser.add_argument("output", help="Path to write the .mp4 to")
    parser.add_argument("--quality", choices=sorted(QUALITY), default="medium")
    args = parser.parse_args()

    try:
        script = json.loads(Path(args.script).read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[render_beat] could not read script: {exc}", file=sys.stderr)
        return 2

    try:
        result = render_script(script, args.output, args.quality)
    except Exception as exc:
        print(f"[render_beat] render failed: {exc}", file=sys.stderr)
        return 3

    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
