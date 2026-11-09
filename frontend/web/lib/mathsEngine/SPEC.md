# Maths scene spec

A scene spec is one JSON file that describes a maths board: what exists on it, what Aria says, what the pencil draws on each sentence, what is written on the right, and what moves. The engine (`engine/`) draws any spec:
- step by step, with a pencil;
- with every value computed;
- with every label placed automatically;
- with only a few general kinds of animation.

Nothing in the engine knows any topic, and no diagram is written in code. The 62 boards in `specs/` are all plain data.

```
node maths-lab/serve.mjs   →   http://localhost:3600     (?lesson=<id>&autoplay&speed=4 for tests)
```

## Shape

```json
{
  "id": "tangent", "title": "Gradient of a curve", "topic": "Differentiation · A Level P1",
  "board": { "x": [-2.7, 2.7], "y": [-1.2, 5.2], "aspect": "equal",
             "axes": { "xTicks": [-2, -1, 1, 2], "yTicks": 1 }, "grid": 1, "view": { "azimuth": -60, "elevation": 20 } },
  "params": { "t": 1 },
  "values": { "m": "slope(f, t)" },
  "transforms": [ { "id": "rot", "kind": "rotate", "center": "O", "angle": -90 } ],
  "frames": [ { "id": "slope", "origin": [0, 0], "angle": 30 } ],
  "objects": [ … ],
  "groups": [ { "id": "counts", "of": ["r1", "r2"] } ],
  "steps": [ … ]
}
```

### board

- **`x`, `y`:** the visible ranges.
- **`aspect`:** `"equal"` (the default; circles stay round) or `"free"` (stretch y, for graphs and charts with big values).
- **`axes`** (optional):

| Field | What it does |
|---|---|
| `at: [x, y]` | Where the axes cross (default the origin) |
| `x`, `y` | The axis ranges, or `false` for no axis |
| `xTicks`, `yTicks` | A step (`1`, `"pi/2"`), or a list of numbers, expressions or `{ "at": …, "label": "…" }` |
| `xFormat`, `yFormat` | `"pi"` writes π/2 and 3π/4, `"frac"` writes 3/4, a number gives decimal places |
| `quietX`, `quietY` | Ticks with no number |
| `xLabel`, `yLabel` | Axis names; long ones sit beside the arrow |
| `origin` | `"O"` or `"0"` at the crossing |
| `grid`, `gridStep` | A faint grid |

- **`grid`:** squared paper with no axes, e.g. `"grid": 1`. Draw it with `"draw": ["grid"]`.
- **`view`:** the camera for 3-D objects. `azimuth` and `elevation` are in degrees and may be expressions of a param, so the camera can move. `scale` and `origin` place the drawing. Two kinds:
  - the default orthographic camera;
  - `{ "kind": "cabinet", "depth": 0.5, "recede": 45 }`, the textbook oblique look, with the front face in its true shape.

### The rest of the top level

- **`params`:** numbers that animations change. Anything defined from a param follows it.
- **`values`:** named expressions, worked out live, e.g. `"m": "(Y(B) - Y(A)) / (X(B) - X(A))"`.
- **`transforms`:** `rotate` (`center`, `angle`), `reflect` (`line`), `translate` (`vector`) or `enlarge` (`center`, `factor`).
- **`frames`:** a tilted coordinate frame, such as the surface of a slope. An object with `"frame": "slope"` reads its `[x, y]` along and across the frame, and its `angle` relative to the frame.
- **`groups`:** names for lists of objects, so one step can draw them all.

## Expressions

Expressions are written as text, for example `"x^2 - 4x + 3"`, `"5tan(35deg)"`, `"nCr(5, x) 0.3^x 0.7^(5 - x)"` or `"R + C == 7"`.

- **Writing style:**
  - Implicit multiplication works: `4x`, `2(x+1)`, `35deg`.
  - Unicode works too: `− × ÷ π ² ³`.
- **Comparisons and logic:** `< > <= >= == != and or not`. A comparison gives 1 when true and 0 when false.
- **Functions:**
  - trigonometry in radians: `sin cos tan asin acos atan`;
  - in degrees: `sind cosd tand asind acosd atand`;
  - others: `sqrt abs ln log exp min max floor ceil round`;
  - counting: `fact`, `nCr`, `nPr`.
- **Constants:** `pi`, `e`, `deg` (π/180).
- **Geometry helpers:**
  - `X(A)`, `Y(A)` and `Z(A)` give a point's coordinates. A 3-D point gives its 3-D ones.
  - `dist(A, B)` and `angle(A, V, B)` measure in 2-D or 3-D; angles are in degrees.
  - `slope(f, x)` is a curve's gradient; `slope(l)` is a line's.
  - `integral(f, a, b)` and `trap(f, a, b, n)` (the trapezium rule).
- **Calling objects:** any function or polyline can be called by its id, e.g. `f(2)`.
- **Dotted names:** points with dotted names can be used, such as polygon corners `T.1` and a scatter's mean point `S.mean`.

No expression is ever passed to `eval`. A small parser compiles it (`engine/expr.js`).

**Number formats** in `{expr:fmt}` labels:

| Format | Gives |
|---|---|
| `0`, `1`, `2` | That many decimal places |
| `3sf` | Three significant figures |
| `pi` | Multiples of π, e.g. 3π/4 |
| `frac` | A fraction, e.g. 7/3 |
| none | The shortest exact form |

## Objects

Every object has an `id` and a `type`. Most also take:
- `color`: white, yellow, cyan, pink, green, orange, grey, dim, red or violet;
- `width`, `dash`, `opacity`, `fill`, `fillOpacity`;
- `label`: text, which can include live values `{expr:fmt}`;
- `labelColor`, `labelSize`, `labelPos`;
- `hidden: true` marks a helper that is never drawn itself.

Labels are placed automatically, clear of every line, curve and text the board will show.

Parts are drawn with `"draw": ["id.part"]`, e.g. `S.mean`, `H.b3`, `G.row2`, `cube.hidden`.

### Points, lines, curves (2-D)

| type | Defined by |
|---|---|
| `point` | `at` · `on: f, x` · `root: f, near` · `turning: f, near` · `intersect: [a, b], pick` · `midpoint` · `onCircle, angle` · `foot: [P, line]` · `image: { of, by }`. `marker`: `dot`, `x` (a plotted cross), `+`, `open` (a hollow circle) |
| `segment`, `vector`, `line`, `ray` | `from`, `to` · `from`, `angle`, `length` (forces) · `through`, `gradient` · `through`, `parallelTo` / `perpendicularTo` · `vertical` · `horizontal`. Segments take `marks: 1–3` (equal-length ticks) and `parallel: 1–2` (arrows) |
| `function` | `expr` in x, optional `domain` |
| `curve` | parametric `x`, `y` in t, `t: [t0, t1]` |
| `implicit` | `expr: "x^3 + y^3 = 3x y"` |
| `polyline` | `points`, or `x` and `y` lists. `smooth: "curve"` (a spline) or `"monotone"` (cumulative frequency). `marker: "x"`. When x increases it is a function (`on`, `intersect` and read-offs work) |
| `circle`, `ellipse` | `center`, and `radius` / `through`, or `rx` / `ry` / `rotate`. The label goes outside, clear of other sets |
| `arc`, `sector` | `center`, `radius`, `from`, `to` (degrees, or `units: "rad"`) |
| `polygon` | `points`, or `image: { of, by }`. Corners are `<id>.1`, `<id>.2`, … `edgeMarks: [1, 1, 0]`, `parallelMarks: [1, 2, 1, 2]` |
| `tangent`, `normal` | `to: f`, `at: x`, `length` |
| `angle` | `points: [A, V, B]`. Always the inside angle; drawn as a square at 90°. `label: "auto"` writes the computed size |
| `text` | `text` (a template), with `at` or `anchor` |
| `trace` | `of: point`: the path it leaves while it moves |

### Regions and shading

| type | Defined by |
|---|---|
| `area` | `under: f` or `between: [f, g]`, `from`, `to` |
| `inequality` | `expr: "x + y < 5"`. A straight boundary, dashed when the inequality is strict, with the side that is not wanted shaded (Cambridge). Parts: `line`, `label`, `shade` |
| `feasible` | `of: [inequalities]`. Writes the label in the region where all of them hold |
| `region` | `where: [conditions]` (all must hold) or `any: [[…], […]]` (a union), optional `within`. A condition is an object id (inside it), `"not <id>"` (outside it), or an inequality in x and y (`"y <= x"`, `"(x-2)^2 + y^2 < 4"`, `"1 < x < 3"`). Gives Venn shading, segments, arc-bounded shapes and Argand regions. `fill: "none"` writes only the label, at the point furthest from the edges |
| `strips` | `under: f`, `from`, `to`, `n` (can be a param), `rule`: `trapezium`, `left`, `right` or `mid` |
| `slopefield` | `dydx` in x and y, `step` |
| `cobweb` | `of: f`, `x0`, `n`, `labels: true` (x₀, x₁ … with drop lines) |

### Number lines

| type | Defined by |
|---|---|
| `numberline` | `y`, `range`, `ticks` (a step or a list, with optional own labels), `minor` |
| `interval` | `on`, `from`, `to` (`"-inf"` / `"inf"` allowed), `ends: ["open", "closed"]`, `level` (raised above the line, with drop lines) |
| `jump` | `on`, `from`, `to`, `side`: a curved arrow with its label |

### Statistics and data

| type | Defined by |
|---|---|
| `bars` | `categories` or `x`, and `values` or `expr` in x (a distribution), or `series: [{ name, values, color }]` with `mode: "dual"` or `"stacked"`. `width: 0` draws sticks. `showValues`. Parts: `b1…`, `v1…`, `names`, `key` |
| `histogram` | `bounds` (or `classes`), `frequencies`. Bars show frequency density (f ÷ width × `per`) unless `density: false` |
| `pie` | `values`, `labels`, `colors`, `start`, `showAngles`. Parts: `s1…`, `n1…`, `a1…` |
| `scatter` | `x`, `y` lists. `mean: true` adds the point `<id>.mean`; `fit: true` adds the least-squares line `<id>.fit` (points can sit on it) |
| `dotplot` | `values`, `y`, `marker` |
| `boxplot` | `five: [min, Q1, median, Q3, max]` (expressions, e.g. read off a curve), or `data` |
| `table` | `at` (top-left), `cell: [w, h]`, `rows: [[…]]`, or `value` (an expression in r, c, R, C) with `header: { cols, rows, corner }`. `shade` (an expression or a list of [r, c]), `gap` and `joiner` (slots), `border`, `shape: "triangle"` (Pascal). Parts: `grid`, `header`, `cells`, `row1…`, `cell2_3`, `shade` |
| `stemleaf` | `at`, `data` (and `left` for back-to-back), `stemUnit`, `key`. Leaves sit in fixed columns, so they line up. `ordered: false` keeps the leaves in the data's order (the unsorted diagram) |
| `pictogram` | `at` (top-left), `categories`, `values`, `unit` (what one symbol stands for), `symbol` (default ●, which can be halved), `key` (the word for what is counted, e.g. "students"; `false` for none). Each value must be a whole number of symbols, or a half with ●. Parts: `names`, `r1…`, `key` |

### 3-D (needs `board.view`)

| type | Defined by |
|---|---|
| `point3` | `at: [x, y, z]` · `on: line, t` · `midpoint` · `along: [A, B, k]` · `foot: [P, line]` · `intersect: [l1, l2]` |
| `segment3`, `vector3` | `from`, `to` (3-D ids or [x, y, z]) |
| `line3` | `through`, `dir` (or `to`), `t: [t0, t1]` (the part drawn) |
| `polygon3`, `plane3` | `points`, or `through` with `normal` (or `spans`) and `size` |
| `axes3` | `x`, `y`, `z` ranges, `ticks`, `origin` |
| `angle3` | `points: [A, V, B]`. A square at 90°; `label: "auto"` |
| `solid` | `kind`: `cuboid`, `cube` (`size`), `prism` (`base` + `height`, or `cross` + `length`), `pyramid` (`size` / `base`, `height` / `apex`), `tetrahedron`, `hull` (`points`), `cylinder`, `cone` (`inverted`), `frustum` (`topRadius`), `sphere`, `hemisphere` (`bowl`). Corners are named with `names: "ABCDEFGH"`; curved solids name `points: { "O": "centre", "V": "apex", "P": "rim:30" }`. Also `edgeLabels: { "AB": "8 cm" }`, `level` (liquid depth, can be a param), `joined: ["top"]` (another solid sits on that face), `axis`, `at`. Visible edges are solid and hidden ones dashed, worked out from the camera every frame |
| `net` | `of`: `cube`, `cuboid`, `prism`, `pyramid`, `tetrahedron`, `cylinder` or `cone`, or your own `faces: [{ points, parent, hinge, angle }]`. `fold` (0 → 1, a param) folds it into the solid. Parts: `edges`, `folds` (dashed), `fills`, `labels` |
| `revolution` | `of: f`, `from`, `to`, `slice` (a param): the solid made by turning y = f(x) about the x-axis |

### Repeats

`{ "repeat": { "k": [1, 2, 3] }, "objects": [ … "$k" … ], "group": "dots" }` makes one copy of the template per value. Use `{ "from": 1, "to": 12 }` for a range, or two variables for every combination. It suits dot patterns, clock ticks, counters in a bag, pictograms and mapping arrows. Steps can repeat in the same way.

## Steps

```json
{ "say": "Pick a point P on the curve, where x is 1.",
  "draw": ["P"],
  "write": ["{pink|P = (1, 1)}", "gradient = {=slope(f, 1):0}"],
  "animate": [ { "param": "t", "path": [-1.6, 1.6], "ms": 4000 } ] }
```

- **say:** one or two short spoken sentences, at most 28 words each. The pencil fits the step's drawing into the time they take, and the next step waits for both.
- **draw:** ids to draw, in order: a whole object, a part (`i1.shade`, `H.b3`) or a group. Six or fewer per step.
- **write:** lines for the working on the right:
  - `{colour|text}` colours the text;
  - `{@id|text}` uses that object's colour;
  - `{=expr:fmt}` inserts a computed value, so no number is typed by hand.
- **animate:** each entry moves exactly one thing, for about 4 s (6 s at most):
  - `{ "param": "t", "to": 3 }` or `"path": [a, b, …]`: change a value. Graphs, points, areas, strips, liquid levels, camera angles and folds follow it.
  - `{ "transform": "rot", "ghost": ["T"] }`: apply a transformation. The image starts on the original, which stays as a faint "before".
  - `{ "move": "P", "to": [x, y] }`: move a point.
- **highlight:** briefly thicken objects, to point at them.
- **hide:** remove objects.
- **set:** jump a param.

## What is checked

Before a spec plays, `engine/lint.js` checks it against each type's own fields.

- **Errors** (the board does not play):
  - unknown or duplicate ids;
  - a field that should name a point, function or line but names nothing;
  - an expression that does not parse, or uses a name that does not exist;
  - an unknown type or solid kind;
  - a missing required field;
  - an animation that moves more than one thing.
- **Warnings** (it plays):
  - a field the type does not have;
  - a sentence over 28 words;
  - more than 6 things drawn in one step;
  - an animation over 6 s;
  - an object never drawn;
  - a point off the board.
- **After it plays:** the lab reports any texts that overlap.
