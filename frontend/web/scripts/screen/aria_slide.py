"""
Aria's slide kit: the fixed frame every AI-written screen-mark slide is drawn on (app/api/screen/*,
lib/screen/slide.ts; first built in screen-lab/manim).

Code2Video's idea (showlab/Code2Video: the model writes Manim code, a layout grid of "anchors"
keeps it tidy, errors go back to the model) cut down to ONE quick slide. The model never guesses
coordinates: it puts each thing in named cells of a 6 x 4 grid, and place() shrinks it to fit
them, so a slide cannot spill off the frame. Whatever still goes wrong (text on text, something
off the frame) is printed by tear_down() as one `ARIA_LAYOUT {...}` line for the server to read.

    Columns A-F run left to right, rows 1-4 top to bottom. Row 1 is the heading band.
    "B2" is one cell, "A2:C4" the block from A2 to C4.

A slide is `from aria_slide import *` then `class Slide(AriaSlide)` with construct(self).
No LaTeX is installed: text is Text in the board hand (Patrick Hand), maths in Unicode.
"""

# Imported under private names: `from aria_slide import *` hands a slide all of Manim and the kit,
# never a module that reads files or the system (json, re, pathlib, manimpango).
import json as _json
import re as _re
from pathlib import Path as _Path

import manimpango as _manimpango
from manim import *  # noqa: F401,F403  (slides get all of Manim from here)

_FONT = _Path(__file__).resolve().parent / "PatrickHand-Regular.ttf"
_manimpango.register_font(str(_FONT))
FONT = "Patrick Hand"

config.background_color = "#000000"

# Bright ink on the black board, the same family as the lesson canvas.
WHITE_INK = "#F4F4EE"
YELLOW_INK = "#FFE45C"
CYAN_INK = "#5CE1FF"
PINK_INK = "#FF7AB6"
GREEN_INK = "#7CF29A"
ORANGE_INK = "#FFB25C"

COLS = "ABCDEF"
ROWS = 4
MARGIN = 0.3
HEADING_H = 1.3
_CELL = _re.compile(r"^\s*([A-Fa-f])([1-4])\s*(?::\s*([A-Fa-f])([1-4]))?\s*$")


def ink(text, size=46, color=WHITE_INK, **kwargs):
    """Text in the board hand."""
    return Text(str(text), font=FONT, font_size=size, color=color, **kwargs)


def _row_span(row):
    fh = config.frame_height
    top = fh / 2 - MARGIN
    if row == 1:
        return top, top - HEADING_H
    rest = (fh - 2 * MARGIN - HEADING_H) / (ROWS - 1)
    row_top = top - HEADING_H - (row - 2) * rest
    return row_top, row_top - rest


def cell_box(ref):
    """(left, right, top, bottom) of a cell or a cell range, in frame units."""
    m = _CELL.match(str(ref))
    if not m:
        raise ValueError(f'cell "{ref}" is not like "B2" or "A2:C4" (columns A-F, rows 1-4)')
    c1, r1 = COLS.index(m.group(1).upper()), int(m.group(2))
    c2 = COLS.index(m.group(3).upper()) if m.group(3) else c1
    r2 = int(m.group(4)) if m.group(4) else r1
    c1, c2 = sorted((c1, c2))
    r1, r2 = sorted((r1, r2))
    fw = config.frame_width
    col_w = (fw - 2 * MARGIN) / len(COLS)
    left = -fw / 2 + MARGIN + c1 * col_w
    right = -fw / 2 + MARGIN + (c2 + 1) * col_w
    return left, right, _row_span(r1)[0], _row_span(r2)[1]


def _texts(mobjects):
    seen, out = set(), []
    for top in mobjects:
        for m in top.get_family():
            if isinstance(m, (Text, MarkupText)) and id(m) not in seen and m.width > 0:
                seen.add(id(m))
                out.append(m)
    return out


def _box(m):
    return m.get_left()[0], m.get_right()[0], m.get_top()[1], m.get_bottom()[1]


class AriaSlide(Scene):
    def place(self, mob, ref, pad=0.15, aim="center"):
        """Shrink mob (never grow it) to fit the cells, then put it there. aim: center | left | right."""
        left, right, top, bottom = cell_box(ref)
        w, h = right - left - 2 * pad, top - bottom - 2 * pad
        if mob.width > 0 and mob.height > 0 and (mob.width > w or mob.height > h):
            mob.scale(min(w / mob.width, h / mob.height))
        y = (top + bottom) / 2
        if aim == "left":
            mob.move_to([left + pad + mob.width / 2, y, 0])
        elif aim == "right":
            mob.move_to([right - pad - mob.width / 2, y, 0])
        else:
            mob.move_to([(left + right) / 2, y, 0])
        return mob

    def heading(self, text, color=YELLOW_INK):
        t = self.place(ink(text, 62, color), "A1:F1")
        self.play(Write(t), run_time=min(1.2, 0.4 + 0.03 * len(str(text))))
        return t

    def note(self, text, ref, color=WHITE_INK, size=46, aim="center"):
        t = self.place(ink(text, size, color), ref, aim=aim)
        self.play(Write(t), run_time=min(1.4, 0.4 + 0.035 * len(str(text))))
        return t

    def tear_down(self):
        fw, fh = config.frame_width, config.frame_height
        issues = []
        for m in self.mobjects:
            if m.width == 0 and m.height == 0:
                continue
            left, right, top, bottom = _box(m)
            if left < -fw / 2 - 0.05 or right > fw / 2 + 0.05 or top > fh / 2 + 0.05 or bottom < -fh / 2 - 0.05:
                name = getattr(m, "text", None) or type(m).__name__
                issues.append(f'"{name}" goes off the frame')
        texts = _texts(self.mobjects)
        for i, a in enumerate(texts):
            for b in texts[i + 1:]:
                al, ar, at, ab = _box(a)
                bl, br, bt, bb = _box(b)
                w, h = min(ar, br) - max(al, bl), min(at, bt) - max(ab, bb)
                if w > 0 and h > 0 and w * h > 0.2 * min(a.width * a.height, b.width * b.height):
                    issues.append(f'"{a.text}" overlaps "{b.text}"')
        print("ARIA_LAYOUT " + _json.dumps({"issues": issues[:6]}), flush=True)
