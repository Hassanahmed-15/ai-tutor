// Spec expansion before checking and drawing: "repeat" blocks make many similar objects (or
// steps) from one template — dot patterns, pictograms, counters in a bag, a row of cards — and
// "group" names them so one step can draw them all. "$k" in any string is replaced by each value.
//
//   { "repeat": { "k": [1, 2, 3] },              "objects": [ { "id": "c$k", "type": "circle", "center": ["2 $k", 0], "radius": 0.4 } ], "group": "dots" }
//   { "repeat": { "k": { "from": 1, "to": 6 } }, "objects": [ … ] }      (two variables: every combination)

function valuesOf(spec) {
  if (Array.isArray(spec)) return spec;
  if (spec && typeof spec === "object") {
    const out = [];
    const step = spec.step ?? 1;
    for (let v = spec.from; step > 0 ? v <= spec.to + 1e-9 : v >= spec.to - 1e-9; v += step) out.push(Math.round(v * 1e9) / 1e9);
    if (out.length > 500) throw new Error("a repeat makes more than 500 copies");
    return out;
  }
  throw new Error(`can't repeat over ${JSON.stringify(spec)}`);
}

function combos(vars) {
  let out = [{}];
  for (const [name, spec] of Object.entries(vars)) {
    const next = [];
    for (const c of out) for (const v of valuesOf(spec)) next.push({ ...c, [name]: v });
    out = next;
  }
  return out;
}

function substitute(value, env) {
  if (typeof value === "string") {
    let s = value;
    for (const name of Object.keys(env).sort((a, b) => b.length - a.length)) s = s.replace(new RegExp(`\\$${name}(?![A-Za-z0-9_])`, "g"), String(env[name]));
    return s;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, env));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [substitute(k, env), substitute(v, env)]));
  return value;
}

function expandList(list, key, groups) {
  const out = [];
  for (const item of list ?? []) {
    if (item && item.repeat) {
      const made = [];
      for (const env of combos(item.repeat)) for (const t of item[key] ?? []) made.push(substitute(t, env));
      const nested = expandList(made, key, groups);
      out.push(...nested);
      if (item.group && key === "objects") groups.push({ id: item.group, of: nested.map((o) => o.id) });
    } else out.push(item);
  }
  return out;
}

export function expandSpec(spec) {
  if (!spec || typeof spec !== "object") return spec;
  const groups = [...(spec.groups ?? [])];
  const objects = expandList(spec.objects, "objects", groups);
  const steps = expandList(spec.steps, "steps", groups);
  return { ...spec, objects, steps, groups };
}
