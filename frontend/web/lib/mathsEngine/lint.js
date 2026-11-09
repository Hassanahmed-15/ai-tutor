// Checks a scene spec before it plays: the mistakes a model makes when it writes one (a name that
// does not exist, an expression that does not parse, a field a type does not have, a point off the
// board, a sentence that is too long, too much drawing in one sentence, an animation that is too
// long or moves two things). Errors stop the board; warnings are shown beside it.
import { parse, namesIn, KNOWN } from "./expr.js";
import { COLOURS } from "./style.js";

const HELPERS = ["X", "Y", "Z", "dist", "angle", "slope", "integral", "trap"];
const MAX_WORDS = 28;
const MAX_ANIM_MS = 6000;
const MAX_DRAW_PER_STEP = 6;

// Field kinds: E expression · EL list of expressions · P 2-D point (id or [x, y]) · PL list of them ·
// P3 3-D point (id or [x, y, z]) · P3L · D3 direction · F function id · O object id · OL ids ·
// T text with {expr} values · C region conditions · X anything (checked by the type itself).
const E = (...vars) => ({ k: "E", vars });
const STYLE = ["color", "width", "dash", "opacity", "label", "labelColor", "labelSize", "labelPos", "labelDistance", "fill", "fillOpacity", "hidden", "note", "frame", "marker", "size", "marks", "parallel", "markColor"];
const LINEAR = { from: "P", to: "P", through: "P", gradient: E(), parallelTo: "X", perpendicularTo: "X", vertical: E(), horizontal: E(), angle: E(), length: E() };
const SEG3 = { from: "P3", to: "P3" };
export const SCHEMA = {
  point: { at: "P", on: "F", x: E(), root: "F", turning: "F", near: E(), intersect: "OL", pick: "X", midpoint: "PL", onCircle: "O", angle: E(), foot: "X", image: "X" },
  segment: LINEAR, vector: LINEAR, line: LINEAR, ray: LINEAR,
  function: { expr: E("x"), domain: "EL", labelAt: E() },
  curve: { x: E("t"), y: E("t"), t: "EL" },
  circle: { center: "P", radius: E(), through: "P" },
  arc: { center: "P", radius: E(), from: E(), to: E(), units: "X" },
  sector: { center: "P", radius: E(), from: E(), to: E(), units: "X" },
  polygon: { points: "PL", image: "X", edgeMarks: "X", parallelMarks: "X" },
  tangent: { to: "F", at: E(), length: E() },
  normal: { to: "F", at: E(), length: E() },
  area: { under: "F", between: "X", from: E(), to: E() },
  inequality: { expr: "X", shadeOpacity: "X" },
  feasible: { of: "OL" },
  angle: { points: "PL", radius: E(), square: "X", dp: "X" },
  text: { text: "T", at: "P", anchor: "O" },
  trace: { of: "O" },
  tree: { at: "P", branches: "X", stageWidth: "X", spread: "X", labelGap: "X" },
  ellipse: { center: "P", rx: E(), ry: E(), rotate: E(), labelAngle: E() },
  numberline: { y: E(), range: "EL", ticks: "X", minor: "X", labels: "X", numbers: "X", format: "X", arrows: "X", numberColor: "X", numberSize: "X" },
  interval: { on: "O", from: "X", to: "X", ends: "X", level: E() },
  jump: { on: "O", y: E(), from: E(), to: E(), side: "X" },
  region: { where: "C", any: "X", within: "O", outline: "X", resolution: "X" },
  implicit: { expr: "X", resolution: "X" },
  slopefield: { dydx: E("x", "y"), step: E(), length: E(), x: "EL", y: "EL" },
  strips: { under: "F", from: E(), to: E(), n: E(), rule: "X" },
  cobweb: { of: "F", x0: E(), n: E(), labels: "X" },
  polyline: { points: "PL", x: "EL", y: "EL", smooth: "X", markerColor: "X", closed: "X" },
  bars: { categories: "X", x: "EL", values: "EL", expr: E("x"), series: "X", mode: "X", width: E(), base: E(), showValues: "X", format: "X", valueSize: "X", nameSize: "X", stickWidth: "X", key: "X", name: "X", hideZero: "X", fillOpacity: "X" },
  histogram: { bounds: "EL", classes: "X", frequencies: "EL", per: E(), density: "X", showValues: "X", format: "X" },
  pie: { center: "P", at: "P", radius: E(), values: "EL", labels: "X", colors: "X", start: E(), clockwise: "X", showAngles: "X", angleFormat: "X" },
  scatter: { x: "EL", y: "EL", mean: "X", fit: "X", meanColor: "X", meanLabel: "T", fitColor: "X", fitLabel: "T", fitRange: "EL" },
  dotplot: { values: "EL", y: E(), gap: "X" },
  boxplot: { five: "EL", data: "EL", y: E(), height: E() },
  table: { at: "P", cell: "X", colWidths: "EL", rowHeights: "EL", rows: "X", rowCount: E(), colCount: E(), value: E("r", "c", "R", "C"), header: "X", shade: "X", shadeColor: "X", shadeOpacity: "X", border: "X", gap: E(), joiner: "X", shape: "X", textSize: "X", textColor: "X", headerColor: "X", cellColors: "X", format: "X", slowGrid: "X" },
  pictogram: { at: "P", categories: "X", values: "EL", unit: E(), symbol: "X", key: "X", rowHeight: E(), slot: E(), textSize: "X" },
  stemleaf: { at: "P", ordered: "X", data: "EL", left: "EL", stemUnit: E(), leafUnit: E(), stems: "EL", rowHeight: E(), slot: E(), stemWidth: E(), key: "X", textSize: "X", stemColor: "X", leafColor: "X", leftColor: "X" },
  point3: { at: "P3", on: "O", t: E(), midpoint: "P3L", along: "X", foot: "X", intersect: "OL" },
  segment3: SEG3, vector3: SEG3,
  line3: { through: "P3", dir: "D3", to: "P3", t: "EL" },
  polygon3: { points: "P3L" },
  plane3: { through: "P3", normal: "D3", spans: "X", size: "EL" },
  axes3: { x: "X", y: "X", z: "X", names: "X", ticks: E(), origin: "X" },
  angle3: { points: "P3L", radius: E(), square: "X", dp: "X" },
  solid: { kind: "X", at: "P3", size: "X", base: "X", cross: "X", height: E(), length: E(), apex: "X", points: "X", radius: E(), topRadius: E(), axis: "X", inverted: "X", flat: "X", bowl: "X", names: "X", labels: "X", edgeLabels: "X", level: E(), liquidColor: "X", liquidOpacity: "X", showHidden: "X", dimColor: "X", joined: "X" },
  net: { of: "X", size: "X", cross: "X", length: E(), base: "X", apex: "X", height: E(), radius: E(), faces: "X", fold: E(), at: "P", labels: "X" },
  revolution: { of: "F", between: "X", axis: "X", from: E(), to: E(), slice: E(), sliceColor: "X", profileColor: "X" },
};
// One of these must be given (alternatives).
const NEEDS = {
  point: [["at", "on", "root", "turning", "intersect", "midpoint", "onCircle", "foot", "image"]],
  function: [["expr"]], circle: [["center"], ["radius", "through"]], polygon: [["points", "image"]],
  tangent: [["to"], ["at"]], normal: [["to"], ["at"]], area: [["under", "between"], ["from"], ["to"]],
  inequality: [["expr"]], text: [["text"], ["at", "anchor"]], ellipse: [["center"], ["rx"]],
  interval: [["on"], ["from"], ["to"]], jump: [["from"], ["to"]], region: [["where", "any"]], implicit: [["expr"]],
  slopefield: [["dydx"]], strips: [["under"], ["from"], ["to"]], cobweb: [["of"], ["x0"]], polyline: [["points", "x"]],
  bars: [["categories", "x"], ["values", "expr", "series"]], histogram: [["bounds", "classes"], ["frequencies"]], pie: [["values"]],
  scatter: [["x"], ["y"]], dotplot: [["values"]], boxplot: [["five", "data"]], table: [["rows", "value", "rowCount", "header"]], stemleaf: [["data"]], pictogram: [["values"], ["categories"]],
  point3: [["at", "on", "midpoint", "along", "foot", "intersect"]], segment3: [["from"], ["to"]], vector3: [["from"], ["to"]],
  line3: [["through"], ["dir", "to"]], polygon3: [["points"]], plane3: [["through"], ["normal", "spans"]], angle3: [["points"]],
  solid: [["kind"]], net: [["of", "faces"]], revolution: [["of", "between"], ["from"], ["to"]],
};
const LINE_TYPES = ["segment", "vector", "line", "ray"];
const SOLID_KINDS = ["cuboid", "cube", "prism", "pyramid", "tetrahedron", "hull", "cylinder", "cone", "frustum", "sphere", "hemisphere"];
const NET_KINDS = ["cube", "cuboid", "prism", "pyramid", "tetrahedron", "cylinder", "cone"];

export function lintSpec(spec) {
  const errors = [];
  const warnings = [];
  if (!spec || typeof spec !== "object") return { errors: ["the spec is not an object"], warnings };
  if (!spec.board?.x || !spec.board?.y) errors.push("board needs x and y ranges");
  for (const k of Object.keys(spec.board ?? {})) if (!["x", "y", "aspect", "axes", "grid", "view", "notToScale"].includes(k)) warnings.push(`board has no field "${k}" (it is ignored)`);
  const ids = new Set(["axes"]);
  if (spec.board?.grid) ids.add("grid");
  const fnIds = new Set();
  const point3Ids = new Set();
  const lineIds = new Set();
  const params = new Set(Object.keys(spec.params ?? {}));
  const values = new Set(Object.keys(spec.values ?? {}));
  const tfIds = new Set((spec.transforms ?? []).map((t) => t.id));
  const frameIds = new Set((spec.frames ?? []).map((f) => f.id));
  for (const t of spec.transforms ?? []) if (!["rotate", "reflect", "translate", "enlarge"].includes(t.kind)) errors.push(`transform ${t.id}: kind must be rotate, reflect, translate or enlarge`);
  const known = (name) => ids.has(name) || ids.has(String(name).split(".")[0]);

  const exprCheck = (where, src, extra = []) => {
    if (typeof src === "number") return;
    if (typeof src !== "string") return errors.push(`${where}: expected a number or expression, got ${JSON.stringify(src)}`);
    try {
      const n = namesIn(parse(src));
      for (const v of n.vars) if (!params.has(v) && !values.has(v) && !KNOWN.consts.includes(v) && !extra.includes(v) && !known(v)) errors.push(`${where}: unknown name "${v}" in "${src}"`);
      for (const c of n.calls) if (!KNOWN.funcs.includes(c) && !HELPERS.includes(c) && !fnIds.has(c)) errors.push(`${where}: unknown function "${c}" in "${src}"`);
    } catch (e) {
      errors.push(`${where}: ${e.message}`);
    }
  };
  const templateCheck = (where, src) => {
    for (const m of String(src).matchAll(/\{([^}:|]+)(?::[^}]*)?\}/g)) exprCheck(where, m[1]);
  };
  const pointCheck = (where, ref, dims = 2) => {
    if (typeof ref === "string") {
      if (!known(ref)) errors.push(`${where}: no point called "${ref}" (define it first)`);
      else if (dims === 3 && ids.has(ref) && !point3Ids.has(ref)) errors.push(`${where}: "${ref}" is not a 3-D point`);
    } else if (Array.isArray(ref) && ref.length === dims) ref.forEach((v) => exprCheck(where, v));
    else errors.push(`${where}: a point is an id or ${dims === 3 ? "[x, y, z]" : "[x, y]"}`);
  };
  const check = (where, kind, v, d) => {
    const k = typeof kind === "string" ? kind : kind.k;
    switch (k) {
      case "E": return exprCheck(where, v, kind.vars ?? []);
      case "EL": return Array.isArray(v) ? v.forEach((x, i) => exprCheck(`${where}[${i}]`, x)) : errors.push(`${where}: expected a list`);
      case "P": return pointCheck(where, v);
      case "PL": return Array.isArray(v) ? v.forEach((r, i) => pointCheck(`${where}[${i}]`, r)) : errors.push(`${where}: expected a list of points`);
      case "P3": return pointCheck(where, v, 3);
      case "P3L": return Array.isArray(v) ? v.forEach((r, i) => pointCheck(`${where}[${i}]`, r, 3)) : errors.push(`${where}: expected a list of 3-D points`);
      case "D3": return typeof v === "string" ? (known(v) ? null : errors.push(`${where}: nothing called "${v}"`)) : Array.isArray(v) && v.length === 3 ? v.forEach((x) => exprCheck(where, x)) : errors.push(`${where}: a direction is [a, b, c]`);
      case "F": return fnIds.has(v) || lineIds.has(v) || (String(v).includes(".") && known(v)) ? null : errors.push(`${where}: no function or line called "${v}"`);
      case "O": return known(v) ? null : errors.push(`${where}: nothing called "${v}"`);
      case "OL": return Array.isArray(v) ? v.forEach((x) => (known(x) ? null : errors.push(`${where}: nothing called "${x}"`))) : errors.push(`${where}: expected a list of ids`);
      case "T": return templateCheck(where, v);
      case "C": return [].concat(v).forEach((c) => conditionCheck(where, c));
    }
    void d;
  };
  const conditionCheck = (where, c) => {
    if (c && typeof c === "object") {
      const id = c.inside ?? c.outside;
      if (!known(id)) errors.push(`${where}: nothing called "${id}"`);
      return;
    }
    const s = String(c).trim();
    if (known(s)) return;
    const neg = /^(?:not\s+|!|outside\s+)(.+)$/.exec(s);
    if (neg && known(neg[1].trim())) return;
    if (!/(<=|>=|≤|≥|<|>)/.test(s)) return errors.push(`${where}: "${s}" is not an object id, "not <id>" or an inequality in x and y`);
    for (const part of s.split(/\s+and\s+/)) for (const side of part.split(/<=|>=|≤|≥|<|>/)) exprCheck(where, side, ["x", "y"]);
  };

  for (const d of spec.objects ?? []) {
    const where = `object ${d.id ?? "?"}`;
    if (!d.id) errors.push(`an object of type ${d.type} has no id`);
    if (ids.has(d.id)) errors.push(`${where}: the id is used twice`);
    // Its own label may name it (a point labelled with its own coordinates).
    if (d.id) ids.add(d.id);
    const schema = SCHEMA[d.type];
    if (!schema) {
      errors.push(`${where}: unknown type "${d.type}" (use one of ${Object.keys(SCHEMA).join(", ")})`);
      continue;
    }
    if (d.color && !COLOURS.includes(d.color) && !String(d.color).startsWith("#")) warnings.push(`${where}: colour "${d.color}" is not one of ${COLOURS.join(", ")}`);
    if (d.frame && !frameIds.has(d.frame)) errors.push(`${where}: no frame called "${d.frame}"`);
    for (const key of Object.keys(d)) {
      if (key === "id" || key === "type" || STYLE.includes(key)) continue;
      if (!(key in schema)) warnings.push(`${where}: a ${d.type} has no field "${key}" (it is ignored)`);
    }
    for (const alts of NEEDS[d.type] ?? []) if (!alts.some((k) => d[k] !== undefined)) errors.push(`${where}: a ${d.type} needs ${alts.length > 1 ? "one of " : ""}${alts.join(", ")}`);
    for (const [key, kind] of Object.entries(schema)) if (d[key] !== undefined) check(`${where}.${key}`, kind, d[key], d);
    // Type-specific checks.
    if (LINE_TYPES.includes(d.type)) {
      for (const key of ["parallelTo", "perpendicularTo"]) if (d[key] !== undefined && typeof d[key] === "string" && !known(d[key])) errors.push(`${where}.${key}: nothing called "${d[key]}"`);
    }
    if (d.type === "point" && Array.isArray(d.foot)) pointCheck(`${where}.foot[0]`, d.foot[0]);
    if (d.image?.of && !known(d.image.of)) errors.push(`${where}.image: nothing called "${d.image.of}"`);
    if (d.image && !tfIds.has(d.image.by)) errors.push(`${where}.image: no transform called "${d.image.by}"`);
    if (d.type === "inequality" && !/(<=|>=|≤|≥|<|>)/.test(String(d.expr))) errors.push(`${where}: "${d.expr}" has no < or >`);
    if (d.type === "inequality") for (const side of String(d.expr).split(/<=|>=|≤|≥|<|>/)) exprCheck(`${where}.expr`, side, ["x", "y"]);
    if (d.type === "implicit") for (const side of String(d.expr).split(/(?<![<>!=])=(?!=)/)) exprCheck(`${where}.expr`, side, ["x", "y"]);
    if (d.type === "region" && d.any) [].concat(d.any).forEach((t, i) => [].concat(t).forEach((c) => conditionCheck(`${where}.any[${i}]`, c)));
    if ((d.type === "area" || d.type === "revolution") && d.between) for (const f of d.between) if (!fnIds.has(f)) errors.push(`${where}.between: no function called "${f}"`);
    if (d.type === "bars" && d.series) d.series.forEach((s, i) => { if (s.expr !== undefined) exprCheck(`${where}.series[${i}].expr`, s.expr, ["x"]); for (const v of s.values ?? []) exprCheck(`${where}.series[${i}].values`, v); });
    if (d.type === "bars" && d.categories && d.values && d.categories.length !== d.values.length) errors.push(`${where}: ${d.categories.length} categories but ${d.values.length} values`);
    if (d.type === "histogram" && d.bounds && d.frequencies && d.bounds.length !== d.frequencies.length + 1) errors.push(`${where}: ${d.bounds.length} bounds need ${d.bounds.length - 1} frequencies, not ${d.frequencies.length}`);
    if (d.type === "table" && d.shade !== undefined && !Array.isArray(d.shade)) exprCheck(`${where}.shade`, d.shade, ["r", "c", "R", "C"]);
    if (d.type === "table" && Array.isArray(d.rows)) d.rows.forEach((row, r) => [].concat(row).forEach((cell) => templateCheck(`${where}.rows[${r}]`, cell)));
    if (d.type === "interval") for (const key of ["from", "to"]) if (!(typeof d[key] === "string" && /^[+-]?inf/.test(d[key].trim()))) exprCheck(`${where}.${key}`, d[key]);
    if (d.type === "solid") {
      if (!SOLID_KINDS.includes(d.kind)) errors.push(`${where}: kind "${d.kind}" is not one of ${SOLID_KINDS.join(", ")}`);
      const names = typeof d.names === "string" ? d.names.split("") : d.names ?? [];
      for (const n of names) if (n && n !== " " && n !== "_") {
        if (ids.has(n)) errors.push(`${where}.names: "${n}" is already used`);
        ids.add(n);
        point3Ids.add(n);
      }
      for (const n of Object.keys(d.points ?? {})) {
        if (ids.has(n)) errors.push(`${where}.points: "${n}" is already used`);
        ids.add(n);
        point3Ids.add(n);
      }
      for (const key of ["level", "radius", "height", "topRadius", "length"]) if (d[key] !== undefined) exprCheck(`${where}.${key}`, d[key]);
      for (const pair of Object.keys(d.edgeLabels ?? {})) {
        const [a, b] = pair.length === 2 ? pair.split("") : pair.split(/[-,]/);
        if (!names.includes(a) || !names.includes(b)) errors.push(`${where}.edgeLabels: "${pair}" is not an edge between named corners`);
      }
    }
    if (d.type === "net" && d.of && !NET_KINDS.includes(d.of)) errors.push(`${where}: "${d.of}" is not one of ${NET_KINDS.join(", ")} (or give "faces")`);
    if (d.type === "net" && d.fold !== undefined && ["cylinder", "cone"].includes(d.of)) warnings.push(`${where}: a ${d.of} net does not fold (it is shown flat)`);
    if (d.type === "point" && Array.isArray(d.at) && !d.frame) {
      const [x, y] = d.at;
      if (typeof x === "number" && typeof y === "number" && spec.board?.x && (x < spec.board.x[0] || x > spec.board.x[1] || y < spec.board.y[0] || y > spec.board.y[1])) warnings.push(`${where}: (${x}, ${y}) is off the board`);
    }
    if (d.type === "point3") point3Ids.add(d.id);
    if (["segment", "line", "ray", "vector", "tangent", "normal", "inequality"].includes(d.type)) lineIds.add(d.id);
    if (d.type === "function" || (d.type === "polyline" && !d.closed)) fnIds.add(d.id);
  }
  for (const [k, v] of Object.entries(spec.values ?? {})) exprCheck(`values.${k}`, v);
  for (const k of ["azimuth", "elevation", "scale", "depth", "recede"]) if (spec.board?.view?.[k] !== undefined) exprCheck(`board.view.${k}`, spec.board.view[k]);
  for (const g of spec.groups ?? []) {
    for (const id of g.of ?? []) if (!known(id)) errors.push(`group ${g.id}: nothing called "${id}"`);
    ids.add(g.id);
  }

  const drawn = new Set();
  (spec.steps ?? []).forEach((st, i) => {
    const where = `step ${i + 1}`;
    if (!st.say) errors.push(`${where}: has nothing to say`);
    else {
      for (const sentence of String(st.say).split(/(?<=[.!?])\s+/)) {
        const words = sentence.split(/\s+/).filter(Boolean).length;
        if (words > MAX_WORDS) warnings.push(`${where}: a sentence has ${words} words (keep under ${MAX_WORDS})`);
      }
    }
    const draws = [].concat(st.draw ?? []);
    if (draws.length > MAX_DRAW_PER_STEP) warnings.push(`${where}: draws ${draws.length} things in one sentence (split it)`);
    for (const ref of draws) {
      if (!known(ref)) errors.push(`${where}: nothing called "${ref}" to draw`);
      drawn.add(String(ref).split(".")[0]);
      drawn.add(String(ref));
    }
    for (const w of [].concat(st.write ?? [])) for (const m of String(w).matchAll(/\{=([^}:]+)(?::[^}]*)?\}/g)) exprCheck(`${where}.write`, m[1]);
    const anims = [].concat(st.animate ?? []);
    for (const a of anims) {
      if ((a.ms ?? 3000) > MAX_ANIM_MS) warnings.push(`${where}: an animation of ${a.ms} ms is long (keep it under ${MAX_ANIM_MS})`);
      const kinds = ["param", "transform", "move"].filter((k) => a[k] !== undefined);
      if (kinds.length !== 1) errors.push(`${where}: each animation moves exactly one thing (param, transform or move)`);
      if (a.param !== undefined && !params.has(a.param)) errors.push(`${where}: no param called "${a.param}"`);
      if (a.transform !== undefined && !tfIds.has(a.transform)) errors.push(`${where}: no transform called "${a.transform}"`);
      if (a.move !== undefined && !ids.has(a.move)) errors.push(`${where}: no point called "${a.move}"`);
      for (const t of [].concat(a.path ?? [], a.to !== undefined && a.param !== undefined ? [a.to] : [])) exprCheck(`${where}.animate`, t);
      for (const id of [].concat(a.show ?? [], a.ghost ?? [])) if (!known(id)) errors.push(`${where}: nothing called "${id}" to show or ghost`);
      for (const id of [].concat(a.show ?? [])) drawn.add(id);
    }
    for (const id of [].concat(st.hide ?? [], st.highlight ?? [])) if (!known(id)) errors.push(`${where}: nothing called "${id}" to hide or highlight`);
    if (st.set) for (const k of Object.keys(st.set)) if (!params.has(k)) errors.push(`${where}: no param called "${k}"`);
  });
  const groupMembers = new Set((spec.groups ?? []).filter((g) => drawn.has(g.id)).flatMap((g) => g.of));
  // The image of an animated transformation appears when the animation runs.
  const animatedTf = new Set((spec.steps ?? []).flatMap((st) => [].concat(st.animate ?? [])).map((a) => a.transform).filter(Boolean));
  // A computed label ("R ({p1:frac})") must work out, or the board shows "?" (Aria's copy: a tree read
  // "R (?)" after "{expr:firstR:frac}"). The form is {expression} or {expression:format}. Checked once
  // every object is known, as a label may name its own point ("(X(P), Y(P))").
  for (const d of spec.objects ?? []) for (const lab of [d.label, ...(Array.isArray(d.labels) ? d.labels : [])]) if (typeof lab === "string" && lab.includes("{")) templateCheck(`object ${d.id ?? "?"}.label`, lab);
  for (const d of spec.objects ?? []) if (d.image && animatedTf.has(d.image.by)) drawn.add(d.id);
  for (const d of spec.objects ?? []) {
    if (d.id && !drawn.has(d.id) && !d.hidden && !groupMembers.has(d.id)) warnings.push(`object ${d.id} is never drawn`);
  }
  return { errors, warnings };
}
