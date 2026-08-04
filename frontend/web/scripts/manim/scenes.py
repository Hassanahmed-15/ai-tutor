"""
Scene builders for `manimScene` ops — the things Manim renders better than the SVG board.

WHAT LIVES HERE AND WHY. Four kinds, each picked because testing showed Manim genuinely wins:

    graph      real axes and a real plotted curve. LiveSketch's GraphScene is a schematic
               squiggle; this plots actual values, shades actual areas, and tracks a point
               along the curve.
    transform  ReplacementTransform between shapes. The DrawScript `morph` op interpolates
               position only — it cannot turn a square into a circle. Manim can.
    flow       stages connected by arrows with particles travelling the real paths.
    geometry   angles, vectors and braces with measurements.

THE LATEX RULE — NOT OPTIONAL. LaTeX is not installed. Manim reaches for it in places that
look innocent: `Axes.add_coordinates()` renders axis numbers with MathTex and dies with
`compile_tex → FileNotFoundError`. So:

    * never call add_coordinates()
    * never construct MathTex, Tex, or SingleStringMathTex
    * every piece of text is Text(), which uses Pango and needs nothing

Axis tick labels are placed by hand with `c2p`, which is why `_tick_labels` exists below.
"""

from __future__ import annotations

import math

import manimpango

from manim import (
    Angle,
    Arrow,
    Brace,
    Circle,
    Create,
    Dot,
    FadeIn,
    GrowArrow,
    Line,
    MoveAlongPath,
    ReplacementTransform,
    RoundedRectangle,
    Square,
    Text,
    Triangle,
    VGroup,
    VMobject,
    Write,
    Axes,
    DOWN,
    LEFT,
    RIGHT,
    UP,
    config,
    rate_functions,
)

# ------------------------------------------------------------------- fonts

def _pick_font() -> str:
    """
    Picks a real UI font instead of Manim's default serif.

    Manim defaults to a Computer-Modern-ish serif, which is why the boards read as "a LaTeX
    document" rather than as the app's marker whiteboard. Pango exposes ~170 fonts here, so
    this is a default nobody changed, not a limitation. Resolved once at import; falls back to
    Manim's default (empty string) when none of the preferred faces exist.
    """
    try:
        available = set(manimpango.list_fonts())
    except Exception:  # pragma: no cover - Pango unavailable
        return ""
    for name in ("Segoe UI", "Calibri", "Trebuchet MS", "Verdana", "Arial", "DejaVu Sans"):
        if name in available:
            return name
    return ""


FONT = _pick_font()


def board_text(content: str, size: float, color: str, bg: str | None = None, bold: bool = False):
    """
    A Text in the board's font, optionally with a halo of the background colour behind it.

    The halo is the same trick LiveSketch uses (`paintOrder: "stroke"`): labels in a DrawScript
    are frequently positioned ON their shape, and without an outline they disappear into it.
    """
    kwargs = {"font_size": size, "color": color}
    if FONT:
        kwargs["font"] = FONT
    if bold:
        kwargs["weight"] = "BOLD"
    text = Text(content, **kwargs)
    if bg:
        text.set_stroke(color=bg, width=5, opacity=1, background=True)
    return text


# --------------------------------------------------- real object silhouettes

def _smooth_closed(points, color: str, fill: float, stroke: float = 4):
    shape = VMobject(color=color, stroke_width=stroke)
    shape.set_points_smoothly([*points, points[0]])
    shape.set_fill(color, opacity=fill)
    return shape


def build_compound_shape(kind: str, w: float, h: float, color: str):
    """
    Real silhouettes for the shapes the SVG board draws properly.

    `sun`, `droplet`, `leaf` and `stove` previously fell through to a rounded rectangle, so a
    photosynthesis board showed a box labelled "sun" and a box labelled "kitchen". These are
    plain Manim mobjects, so `Create` still draws them stroke-by-stroke like everything else.
    Returns None for anything not in this set.
    """
    if kind == "sun":
        r = min(w, h) / 2 * 0.58
        core = Circle(radius=r, color=color, fill_opacity=0.35, stroke_width=4)
        rays = VGroup(
            *[
                Line(
                    [math.cos(a) * r * 1.35, math.sin(a) * r * 1.35, 0],
                    [math.cos(a) * r * 1.95, math.sin(a) * r * 1.95, 0],
                    color=color,
                    stroke_width=4,
                )
                for a in [i * math.pi / 4 for i in range(8)]
            ]
        )
        return VGroup(core, rays)

    if kind == "droplet":
        hw, hh = w / 2, h / 2
        # Round belly, pointed top — a teardrop, not an oval.
        pts = [
            [0, hh, 0],
            [hw * 0.62, -hh * 0.05, 0],
            [hw * 0.72, -hh * 0.55, 0],
            [0, -hh, 0],
            [-hw * 0.72, -hh * 0.55, 0],
            [-hw * 0.62, -hh * 0.05, 0],
        ]
        return _smooth_closed(pts, color, 0.3)

    if kind == "leaf":
        hw, hh = w / 2, h / 2
        pts = [
            [0, hh, 0],                      # tip
            [hw * 0.85, hh * 0.15, 0],
            [hw * 0.55, -hh * 0.7, 0],
            [0, -hh, 0],                     # stem end
            [-hw * 0.55, -hh * 0.7, 0],
            [-hw * 0.85, hh * 0.15, 0],
        ]
        body = _smooth_closed(pts, color, 0.28)
        midrib = Line([0, -hh * 0.92, 0], [0, hh * 0.88, 0], color=color, stroke_width=3)
        return VGroup(body, midrib)

    if kind == "stove":
        body = RoundedRectangle(
            corner_radius=0.12, width=w, height=h * 0.78, color=color, fill_opacity=0.18, stroke_width=4
        )
        burners = VGroup(
            *[
                Circle(radius=min(w, h) * 0.11, color=color, stroke_width=3, fill_opacity=0.32).move_to(
                    [dx * w * 0.24, h * 0.12, 0]
                )
                for dx in (-1, 1)
            ]
        )
        return VGroup(body, burners)

    return None


# ------------------------------------------------------------------ curves

def _curve_fn(spec: dict):
    """
    Turns a curve spec into a plain Python callable.

    Deliberately a FIXED FAMILY rather than an expression string. The model names a shape and
    supplies coefficients; nothing it writes is ever parsed or evaluated. That is what keeps
    this safe without a sandbox — there is no code path from model output to execution.
    """
    kind = str(spec.get("fn", "linear"))
    a = float(spec.get("a", 1) or 0)
    b = float(spec.get("b", 0) or 0)
    c = float(spec.get("c", 0) or 0)

    if kind == "quadratic":
        return lambda x: a * x * x + b * x + c
    if kind == "exponentialGrowth":
        return lambda x: a * math.exp(min(20.0, max(-20.0, b * x))) + c
    if kind == "exponentialDecay":
        return lambda x: a * math.exp(min(20.0, max(-20.0, -abs(b) * x))) + c
    if kind == "sine":
        return lambda x: a * math.sin(b * x + c)
    if kind == "logistic":
        return lambda x: a / (1 + math.exp(min(20.0, max(-20.0, -b * (x - c)))))
    if kind == "inverse":
        return lambda x: a / x if abs(x) > 1e-6 else 0.0
    if kind == "sqrt":
        return lambda x: a * math.sqrt(max(0.0, x)) + c
    return lambda x: a * x + b  # linear


def _tick_labels(ax, values, axis: str, theme: dict, y_pos=0.0, x_pos=0.0):
    """
    Axis numbers as plain Text.

    `Axes.add_coordinates()` would be the obvious call and it is exactly the one that crashes
    without LaTeX. Placing the labels manually costs a few lines and removes the dependency.
    """
    labels = VGroup()
    for v in values:
        text = Text(f"{v:g}", font_size=18, color=theme["ink"])
        if axis == "x":
            text.next_to(ax.c2p(v, y_pos), DOWN, buff=0.16)
        else:
            text.next_to(ax.c2p(x_pos, v), LEFT, buff=0.16)
        labels.add(text)
    return labels


def _nice_ticks(lo: float, hi: float, count: int = 5) -> list[float]:
    """A handful of round tick values — enough to read the scale, not enough to clutter."""
    if hi <= lo:
        return [lo]
    raw = (hi - lo) / max(1, count)
    magnitude = 10 ** math.floor(math.log10(raw)) if raw > 0 else 1
    step = min([m * magnitude for m in (1, 2, 2.5, 5, 10)], key=lambda s: abs(s - raw))
    ticks, v = [], math.ceil(lo / step) * step
    while v <= hi + 1e-9 and len(ticks) < 12:
        ticks.append(round(v, 6))
        v += step
    return ticks


# ------------------------------------------------------------------- graph

def build_graph(scene, spec: dict, theme: dict, duration: float) -> None:
    """Axes + curves + optional shaded area + optional point tracked along the curve."""
    x_lo, x_hi = float(spec.get("xMin", 0)), float(spec.get("xMax", 10))
    y_lo, y_hi = float(spec.get("yMin", 0)), float(spec.get("yMax", 10))
    if x_hi <= x_lo:
        x_hi = x_lo + 1
    if y_hi <= y_lo:
        y_hi = y_lo + 1

    ax = Axes(
        x_range=[x_lo, x_hi, (x_hi - x_lo) / 5],
        y_range=[y_lo, y_hi, (y_hi - y_lo) / 5],
        x_length=9.2,
        y_length=4.9,
        axis_config={"color": theme["ink"], "include_tip": False, "stroke_width": 2.5},
        tips=False,
    )
    ax.to_edge(DOWN, buff=1.0)

    x_ticks = _tick_labels(ax, _nice_ticks(x_lo, x_hi), "x", theme, y_pos=y_lo)
    y_ticks = _tick_labels(ax, _nice_ticks(y_lo, y_hi), "y", theme, x_pos=x_lo)
    parts = VGroup(ax, x_ticks, y_ticks)

    if spec.get("xLabel"):
        parts.add(Text(str(spec["xLabel"])[:24], font_size=21, color=theme["ink"]).next_to(x_ticks, DOWN, buff=0.3))
    if spec.get("yLabel"):
        # Anchored to the tick-label column, not the axis: anchoring to the axis put the
        # rotated word straight through the widest number ("3000" and "balance" overlapped).
        parts.add(
            Text(str(spec["yLabel"])[:24], font_size=21, color=theme["ink"])
            .rotate(math.pi / 2)
            .next_to(y_ticks, LEFT, buff=0.25)
        )

    title = None
    if spec.get("title"):
        title = Text(str(spec["title"])[:48], font_size=30, color=theme["ink"], weight="BOLD").to_edge(UP, buff=0.5)

    scene.add(parts)
    if title:
        scene.play(Write(title), run_time=min(1.0, duration * 0.12))

    curves = (spec.get("curves") or [])[:2]
    budget = duration * 0.55
    for i, cspec in enumerate(curves):
        fn = _curve_fn(cspec)
        colour = cspec.get("color") or theme["accent"]
        graph = ax.plot(fn, x_range=[x_lo, x_hi], color=colour, stroke_width=5, use_smoothing=True)
        scene.play(Create(graph), run_time=max(0.6, budget / max(1, len(curves))))

        if cspec.get("label"):
            # Anchored to a point ~70% along the curve, not its end: a label hung off the final
            # point runs past the right edge of the frame, which is exactly what happened to
            # the second curve on the first render. Alternating above/below keeps two labels
            # apart where the curves converge.
            anchor_x = x_lo + (x_hi - x_lo) * 0.7
            lab = Text(str(cspec["label"])[:22], font_size=20, color=colour)
            lab.next_to(ax.c2p(anchor_x, fn(anchor_x)), UP if i == 0 else DOWN, buff=0.22)
            # Last resort if the text is still wide enough to overhang the frame.
            half = config.frame_width / 2 - 0.25
            if lab.get_right()[0] > half:
                lab.shift(RIGHT * (half - lab.get_right()[0]))
            scene.play(FadeIn(lab), run_time=0.35)

        area = cspec.get("area")
        if area and isinstance(area, dict):
            a_lo = max(x_lo, float(area.get("from", x_lo)))
            a_hi = min(x_hi, float(area.get("to", x_hi)))
            if a_hi > a_lo:
                shaded = ax.get_area(graph, x_range=[a_lo, a_hi], color=colour, opacity=0.22)
                scene.play(FadeIn(shaded), run_time=0.6)

        # A point running along the curve is the clearest way to show "as x grows, y does this".
        if cspec.get("trackPoint") and i == 0:
            dot = Dot(ax.c2p(x_lo, fn(x_lo)), color=colour, radius=0.085)
            scene.add(dot)
            scene.play(
                MoveAlongPath(dot, graph),
                run_time=max(0.8, duration * 0.22),
                rate_func=rate_functions.smooth,
            )


# --------------------------------------------------------------- transform

_SHAPES = {
    "square": lambda c: Square(side_length=2.3, color=c, fill_opacity=0.22, stroke_width=5),
    "circle": lambda c: Circle(radius=1.35, color=c, fill_opacity=0.22, stroke_width=5),
    "triangle": lambda c: Triangle(color=c, fill_opacity=0.22, stroke_width=5).scale(1.45),
    "rect": lambda c: RoundedRectangle(corner_radius=0.12, width=3.0, height=1.9, color=c, fill_opacity=0.22, stroke_width=5),
}


def build_transform(scene, spec: dict, theme: dict, duration: float) -> None:
    """One shape genuinely becoming another — what the DrawScript `morph` op cannot do."""
    stages = (spec.get("stages") or [])[:4]
    if not stages:
        return

    title = None
    if spec.get("title"):
        title = Text(str(spec["title"])[:48], font_size=30, color=theme["ink"], weight="BOLD").to_edge(UP, buff=0.6)
        scene.play(Write(title), run_time=min(0.9, duration * 0.12))

    def make(stage: dict):
        colour = stage.get("color") or theme["accent"]
        return _SHAPES.get(str(stage.get("shape", "circle")), _SHAPES["circle"])(colour)

    current = make(stages[0])
    caption = Text(str(stages[0].get("caption", ""))[:40], font_size=24, color=theme["ink"]).to_edge(DOWN, buff=1.0)
    scene.play(Create(current), run_time=0.8)
    if stages[0].get("caption"):
        scene.play(Write(caption), run_time=0.5)

    per = max(0.7, (duration * 0.6) / max(1, len(stages) - 1)) if len(stages) > 1 else 0.7
    for stage in stages[1:]:
        nxt = make(stage)
        scene.play(ReplacementTransform(current, nxt), run_time=per)
        current = nxt
        if stage.get("caption"):
            new_cap = Text(str(stage["caption"])[:40], font_size=24, color=theme["ink"]).to_edge(DOWN, buff=1.0)
            scene.play(ReplacementTransform(caption, new_cap), run_time=0.45)
            caption = new_cap


# -------------------------------------------------------------------- flow

def build_flow(scene, spec: dict, theme: dict, duration: float) -> None:
    """Stages joined by arrows, with a particle travelling each real path."""
    stages = [str(s)[:18] for s in (spec.get("stages") or [])][:4]
    if len(stages) < 2:
        return

    if spec.get("title"):
        scene.play(
            Write(Text(str(spec["title"])[:48], font_size=30, color=theme["ink"], weight="BOLD").to_edge(UP, buff=0.6)),
            run_time=min(0.9, duration * 0.12),
        )

    span = 9.6
    boxes, labels = VGroup(), VGroup()
    for i, name in enumerate(stages):
        box = RoundedRectangle(
            corner_radius=0.15,
            width=min(2.9, span / len(stages) - 0.5),
            height=1.35,
            color=theme["accent"],
            fill_opacity=0.14,
            stroke_width=4,
        )
        box.move_to([(i - (len(stages) - 1) / 2) * (span / len(stages)), 0, 0])
        boxes.add(box)
        labels.add(Text(name, font_size=21, color=theme["ink"]).move_to(box))

    scene.play(Create(boxes[0]), Write(labels[0]), run_time=0.7)
    per = max(0.6, (duration * 0.6) / max(1, len(stages) - 1))
    for i in range(len(stages) - 1):
        arrow = Arrow(boxes[i].get_right(), boxes[i + 1].get_left(), buff=0.12, color=theme["ink"], stroke_width=3)
        scene.play(GrowArrow(arrow), run_time=per * 0.35)
        particle = Dot(color=theme["accent"], radius=0.1)
        scene.play(
            MoveAlongPath(particle, Line(arrow.get_start(), arrow.get_end())),
            run_time=per * 0.35,
            rate_func=rate_functions.smooth,
        )
        scene.remove(particle)
        scene.play(Create(boxes[i + 1]), Write(labels[i + 1]), run_time=per * 0.3)


# ---------------------------------------------------------------- geometry

def build_geometry(scene, spec: dict, theme: dict, duration: float) -> None:
    """Angles, vectors and braces — measured constructions the SVG board only approximates."""
    mode = str(spec.get("mode", "vector"))
    accent = spec.get("color") or theme["accent"]

    if spec.get("title"):
        scene.play(
            Write(Text(str(spec["title"])[:48], font_size=30, color=theme["ink"], weight="BOLD").to_edge(UP, buff=0.6)),
            run_time=min(0.9, duration * 0.12),
        )

    if mode == "angle":
        degrees = max(5.0, min(175.0, float(spec.get("degrees", 45))))
        origin = [-1.5, -1.0, 0]
        base = Line(origin, [2.5, -1.0, 0], color=theme["ink"], stroke_width=4)
        rad = math.radians(degrees)
        arm = Line(origin, [origin[0] + 4 * math.cos(rad), origin[1] + 4 * math.sin(rad), 0], color=accent, stroke_width=4)
        scene.play(Create(base), run_time=0.6)
        scene.play(Create(arm), run_time=0.8)
        arc = Angle(base, arm, radius=0.8, color=accent, stroke_width=4)
        scene.play(Create(arc), run_time=0.6)
        scene.play(FadeIn(Text(f"{degrees:g}°", font_size=26, color=accent).next_to(arc, RIGHT, buff=0.2)), run_time=0.4)
        return

    if mode == "brace":
        line = Line([-3.4, 0, 0], [3.4, 0, 0], color=theme["ink"], stroke_width=5)
        scene.play(Create(line), run_time=0.7)
        brace = Brace(line, direction=DOWN, color=accent)
        scene.play(Create(brace), run_time=0.7)
        scene.play(
            FadeIn(Text(str(spec.get("measure", "length"))[:22], font_size=24, color=accent).next_to(brace, DOWN, buff=0.15)),
            run_time=0.5,
        )
        return

    # vector: one or two arrows from a shared origin, optionally with their resultant.
    vectors = (spec.get("vectors") or [{"dx": 3, "dy": 2, "label": "v"}])[:2]

    # Place the origin so the whole construction sits centred. Anchoring the origin at the
    # frame centre instead pushes everything into whichever quadrant the vectors point in,
    # which is how the first render ended up hugging the right-hand edge.
    tips = [(float(v.get("dx", 1)), float(v.get("dy", 1))) for v in vectors]
    if spec.get("showResultant") and len(tips) == 2:
        tips.append((tips[0][0] + tips[1][0], tips[0][1] + tips[1][1]))
    span_x = [0.0] + [t[0] for t in tips]
    span_y = [0.0] + [t[1] for t in tips]
    origin = [-(min(span_x) + max(span_x)) / 2, -(min(span_y) + max(span_y)) / 2 - 0.4, 0]
    drawn = []
    for v in vectors:
        dx, dy = float(v.get("dx", 1)), float(v.get("dy", 1))
        arrow = Arrow(origin, [origin[0] + dx, origin[1] + dy, 0], buff=0, color=v.get("color") or accent, stroke_width=5)
        scene.play(GrowArrow(arrow), run_time=0.7)
        drawn.append((arrow, dx, dy))
        if v.get("label"):
            scene.play(FadeIn(Text(str(v["label"])[:12], font_size=22, color=arrow.get_color()).next_to(arrow.get_end(), UP, buff=0.15)), run_time=0.35)

    if spec.get("showResultant") and len(drawn) == 2:
        rx = drawn[0][1] + drawn[1][1]
        ry = drawn[0][2] + drawn[1][2]
        resultant = Arrow(origin, [origin[0] + rx, origin[1] + ry, 0], buff=0, color=theme["ink"], stroke_width=6)
        scene.play(GrowArrow(resultant), run_time=0.8)
        scene.play(FadeIn(Text("resultant", font_size=22, color=theme["ink"]).next_to(resultant.get_end(), RIGHT, buff=0.15)), run_time=0.35)


BUILDERS = {
    "graph": build_graph,
    "transform": build_transform,
    "flow": build_flow,
    "geometry": build_geometry,
}


def build_scene(scene, spec: dict, theme: dict, duration: float) -> bool:
    """Dispatches to a builder. Returns False for an unknown kind rather than raising."""
    builder = BUILDERS.get(str((spec or {}).get("kind", "")))
    if builder is None:
        return False
    builder(scene, spec, theme, duration)
    return True
