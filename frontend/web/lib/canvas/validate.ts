/**
 * Model JSON in, a CanvasBoardSpec the renderer can always draw out — or null.
 *
 * Every field is checked and clamped rather than trusted: ids are slugged and de-duplicated, sentence
 * numbers are clamped to the narration, icons must be known, expressions must parse and read only
 * the board's own variables, and cues aimed at ids that do not exist are dropped. A board missing
 * what its stage needs to draw anything returns null, and the caller retries or falls back.
 */

import { compileExpr, exprUsesOnly } from "./expr";
import { figureComponent } from "../figures/registry";
import { drawnFigure } from "../figures/drawn";
import { snapEquilibrium } from "./graphCheck";
import {
  CANVAS_ICONS,
  CANVAS_STAGES,
  type CanvasBoardSpec,
  type CanvasCue,
  type CanvasIcon,
  type CanvasInteraction,
  type CodeStage,
  type CompareStage,
  type EquationStage,
  type FlowArrow,
  type FlowStage,
  type GraphStage,
  type FigureStage,
  type IllustrationStage,
  type MoleculeStage,
  type AtomMapStage,
  type SceneStage,
  type StageSpec,
} from "./types";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** Text, trimmed and capped. A list of strings is joined — models often answer "1 or 2 sentences" as an array. */
const str = (v: unknown, max = 80): string => {
  const text = typeof v === "string" ? v : Array.isArray(v) && v.every((x) => typeof x === "string") ? v.join(" ") : "";
  return text.replace(/\s+/g, " ").trim().slice(0, max);
};
/**
 * Text a student reads, kept to a length: cut at a word with "…", never mid-word ("Quantity of
 * loanable funds ($ bi" — audit 2026-10-15).
 */
const shown = (v: unknown, max = 80): string => {
  const text = str(v, 4000);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at >= max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:(–-]+$/, "")}…`;
};
const num = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export function slug(v: unknown, fallback: string): string {
  const s = str(v, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return s || fallback;
}

/**
 * A picture-icon must mean what its label says. The set is made for science, so for "Funding choice"
 * the model reached for "battery" (audit 2026-10-15): a wrong icon teaches something false, a plain
 * disc teaches nothing. Concrete icons need one of their words in the label; generic ones (person,
 * book, gear, earth, factory) fit anything.
 */
const ICON_MEANS: Partial<Record<CanvasIcon, RegExp>> = {
  battery: /batter|cell|charge|energy|power|circuit|voltage|current|store/i,
  magnet: /magnet|field|pole|attract|repel/i,
  sugar: /sugar|glucose|sucrose|starch|carbohydrate|sweet|food/i,
  chloroplast: /chloroplast|photosynth|chlorophyll/i,
  stomata: /stomat|pore|leaf|guard cell/i,
  lungs: /lung|breath|respir|air|gas exchange|alveol/i,
  heart: /heart|blood|pump|circulat|cardi/i,
  flame: /flame|fire|burn|combust|heat|hot|fuel/i,
  ice: /ice|freez|cold|solid|melt|frozen/i,
  steam: /steam|vapou?r|boil|evaporat/i,
  wing: /wing|bird|flight|fly|lift|insect/i,
  airplane: /plane|aircraft|flight|fly|travel|transport|international|global|abroad|border|foreign/i,
  oxygen: /oxygen|o2|o₂|breath|air/i,
  water: /water|h2o|h₂o|rain|sea|ocean|river|liquid|aqueous|hydr|moist/i,
  gas: /gas|co2|co₂|carbon dioxide|air|vapou?r|fume|emission/i,
  leaf: /leaf|leaves|plant|tree|green|photosynth|forest/i,
  plant: /plant|crop|tree|grow|flower|forest|vegetat/i,
  root: /root|soil|absor/i,
  cell: /cell/i,
  atom: /atom|element|nucle|particle|ion\b|molecul|proton|electron|neutron/i,
  wave: /wave|sound|light|signal|frequen|oscillat|vibrat|radiat/i,
  bulb: /bulb|lamp|light|idea|insight|innovat/i,
  force: /force|push|pull|weight|tension|friction|drag|thrust|pressure/i,
  sun: /sun|light|solar|star|day/i,
  energy: /energy|power|electric|heat|work|fuel/i,
  car: /car\b|vehicle|drive|road|traffic|transport/i,
  animal: /animal|organism|species|mammal|predator|prey|creature|wildlife/i,
  cloud: /cloud|weather|rain|sky|climate|data|storage/i,
  // A gear means a mechanism or a process step, never a piece of glassware (a burette drawn as a gear).
  gear: /gear|machine|mechanism|process|engine|system|method|step|procedure|control|regulat|catalys|enzyme|work/i,
};
const icon = (v: unknown, means = ""): CanvasIcon | undefined => {
  const s = str(v, 20).toLowerCase();
  if (!(CANVAS_ICONS as readonly string[]).includes(s)) return undefined;
  const need = ICON_MEANS[s as CanvasIcon];
  return !means || !need || need.test(means) ? (s as CanvasIcon) : undefined;
};
const color = (v: unknown): string | undefined => {
  const s = str(v, 9);
  return /^#[0-9a-f]{6}$/i.test(s) ? s : undefined;
};

export function validateCanvasSpec(raw: unknown, sentenceCount: number, vars: string[] = []): CanvasBoardSpec | null {
  const r = obj(raw);
  const lastS = Math.max(0, sentenceCount - 1);
  const sentence = (v: unknown, fallback = 0) => Math.max(0, Math.min(lastS, Math.round(num(v, fallback))));
  const used = new Set<string>(["heading", "stage", "board", "picture", "equation", "graph"]);
  const unique = (v: unknown, fallback: string) => {
    let id = slug(v, fallback);
    while (used.has(id)) id = `${id}-2`;
    used.add(id);
    return id;
  };

  const heading = shown(r.heading, 60);
  if (!heading) return null;

  const notes = arr(r.notes)
    .map((n, i) => {
      const o = typeof n === "string" ? { text: n } : obj(n);
      const text = shown(o.text, 48).replace(/\.$/, "");
      return text ? { id: unique(o.id ?? `note-${i + 1}`, `note-${i + 1}`), text, s: sentence(o.s ?? o.sentence, i) } : null;
    })
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .slice(0, 4);

  const interaction = validateInteraction(r.interaction);
  const knownVars = interaction?.kind === "try" ? interaction.controls.map((c) => c.var) : vars;

  const stage = validateStage(obj(r.stage), sentence, unique, knownVars);
  if (!stage) return null;
  // A figure title that repeats the board's heading is the same words twice, one above the other.
  if (stage.kind === "figure" && stage.params && typeof stage.params.title === "string") {
    const plain = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (plain(stage.params.title) === plain(heading)) delete stage.params.title;
  }

  const ids = new Set(used);
  const cues: CanvasCue[] = arr(r.cues)
    .map((c) => obj(c))
    .map((c): CanvasCue | null => {
      let action = str(c.action, 12) as CanvasCue["action"];
      if (!["point", "circle", "underline", "zoom", "unzoom", "visit"].includes(action)) return null;
      // Rings are retired (owner, 2026-10-17): a "circle" becomes a "point".
      if (action === "circle") action = "point";
      // A visit names another board; whether that board exists and came earlier is checked by the
      // caller, which knows the lesson.
      if (action === "visit") {
        const beat = str(c.beat ?? c.target, 40);
        return beat ? { s: sentence(c.s ?? c.sentence), at: Math.max(0, Math.min(0.9, num(c.at, 0.05))), action, beat } : null;
      }
      const target = c.target === undefined ? undefined : slug(c.target, "");
      if (action !== "unzoom" && (!target || !ids.has(target))) return null;
      return { s: sentence(c.s ?? c.sentence), at: Math.max(0, Math.min(0.95, num(c.at, 0.2))), action, target };
    })
    .filter((c): c is CanvasCue => Boolean(c))
    .slice(0, 14);

  const carry = arr(r.carry).map((c) => slug(c, "")).filter((c) => c && ids.has(c)).slice(0, 3);
  const insideRaw = obj(r.inside);
  const inside = str(insideRaw.beat, 40) && str(insideRaw.id, 40) ? { beat: str(insideRaw.beat, 40), id: slug(insideRaw.id, "") } : undefined;

  return {
    v: 1,
    heading,
    notes,
    stage,
    cues,
    ...(carry.length ? { carry } : {}),
    ...(inside ? { inside } : {}),
    ...(interaction ? { interaction } : {}),
    ...(r.overview === true ? { overview: true } : {}),
  };
}

function validateArrows(raw: unknown, sentence: (v: unknown, f?: number) => number, unique: (v: unknown, f: string) => string, nodeIds: Set<string>, vars: string[]): FlowArrow[] {
  return arr(raw)
    .map((a) => obj(a))
    .map((a, i): FlowArrow | null => {
      const from = slug(a.from, "");
      const to = slug(a.to, "");
      if (!nodeIds.has(from) || !nodeIds.has(to) || from === to) return null;
      const rate = str(a.rate, 120);
      return {
        id: unique(a.id ?? `${from}-to-${to}`, `arrow-${i + 1}`),
        from,
        to,
        label: shown(a.label, 28) || undefined,
        s: sentence(a.s ?? a.sentence),
        flow: a.flow === true,
        rate: rate && exprUsesOnly(rate, vars) ? rate : undefined,
        color: color(a.color),
      };
    })
    .filter((a): a is FlowArrow => Boolean(a))
    .slice(0, 10);
}

function validateStage(r: Raw, sentence: (v: unknown, f?: number) => number, unique: (v: unknown, f: string) => string, vars: string[]): StageSpec | null {
  const kind = str(r.kind, 16) as StageSpec["kind"];
  if (!(CANVAS_STAGES as readonly string[]).includes(kind)) return null;

  if (kind === "code") return validateCode(r, sentence, unique);

  if (kind === "molecule") {
    const molecules = arr(r.molecules).map((m) => obj(m)).map((m, mi) => {
      const atoms = arr(m.atoms).map((a) => obj(a)).map((a, ai) => ({
        id: slug(a.id, `atom-${ai + 1}`), element: str(a.element, 3),
        x: Math.max(-1, Math.min(1, num(a.x, 0))), y: Math.max(-1, Math.min(1, num(a.y, 0))), z: Math.max(-1, Math.min(1, num(a.z, 0))),
        lonePairs: Math.max(0, Math.min(4, Math.round(num(a.lonePairs, 0)))) || undefined, color: color(a.color),
      })).filter((a) => a.element).slice(0, 12);
      const atomIds = new Set(atoms.map((a) => a.id));
      const bonds = arr(m.bonds).map((b) => obj(b)).map((b) => {
        const from = slug(b.from, ""); const to = slug(b.to, "");
        const style = str(b.style, 8);
        const order = Math.max(1, Math.min(3, Math.round(num(b.order, 1)))) as 1 | 2 | 3;
        return atomIds.has(from) && atomIds.has(to) && from !== to ? { from, to, order, style: (["wedge", "dash"].includes(style) ? style : "line") as "line" | "wedge" | "dash" } : null;
      }).filter((b): b is NonNullable<typeof b> => Boolean(b)).slice(0, 18);
      return atoms.length >= 2 && bonds.length ? { id: unique(m.id ?? `molecule-${mi + 1}`, `molecule-${mi + 1}`), label: shown(m.label, 32) || `Molecule ${mi + 1}`, geometry: str(m.geometry, 28), bondAngle: str(m.bondAngle, 18) || undefined, atoms, bonds, s: sentence(m.s, mi) } : null;
    }).filter((m): m is NonNullable<typeof m> => Boolean(m)).slice(0, 3);
    return molecules.length ? ({ kind, molecules } satisfies MoleculeStage) : null;
  }

  if (kind === "atom-map") {
    const groups = (value: unknown, prefix: string) => arr(value).map((g) => obj(g)).map((g, gi) => {
      const atoms = arr(g.atoms).map((a) => obj(a)).map((a) => ({ element: str(a.element, 3), count: Math.max(1, Math.min(24, Math.round(num(a.count, 1)))) })).filter((a) => a.element).slice(0, 4);
      return atoms.length ? { id: unique(g.id ?? `${prefix}-${gi + 1}`, `${prefix}-${gi + 1}`), label: shown(g.label, 32) || `${prefix} ${gi + 1}`, atoms, s: sentence(g.s, gi) } : null;
    }).filter((g): g is NonNullable<typeof g> => Boolean(g)).slice(0, 4);
    const reactants = groups(r.reactants, "reactant");
    const products = groups(r.products, "product");
    if (!reactants.length || !products.length) return null;
    const energyRaw = obj(r.energy);
    const input = str(energyRaw.input, 40); const output = str(energyRaw.output, 40);
    const energy = input || output ? { input, output, s: sentence(energyRaw.s, 0) } : undefined;
    return { kind, reactants, products, ...(energy ? { energy } : {}) } satisfies AtomMapStage;
  }

  if (kind === "flow") {
    const nodes = arr(r.nodes)
      .map((n) => obj(n))
      .map((n, i) => {
        const label = shown(n.label, 28);
        if (!label) return null;
        const glow = str(n.glow, 120);
        const role = str(n.role, 8);
        const becomes = becomesOf(n.becomes, sentence);
        return {
          id: unique(n.id ?? label, `node-${i + 1}`),
          label,
          sub: shown(n.sub, 32) || undefined,
          icon: icon(n.icon, `${str(n.id, 40)} ${str(n.label, 60)} ${str(n.sub, 60)}`),
          color: color(n.color),
          role: (["input", "core", "output"].includes(role) ? role : undefined) as FlowStage["nodes"][number]["role"],
          s: sentence(n.s ?? n.sentence, i),
          glow: glow && exprUsesOnly(glow, vars) ? glow : undefined,
          ...(becomes ? { becomes } : {}),
        };
      })
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .slice(0, 7);
    if (nodes.length < 2) return null;
    const arrangement = str(r.arrangement, 24);
    const stage: FlowStage = {
      kind,
      arrangement: arrangement === "cycle" || arrangement === "chain" ? arrangement : "inputs-core-outputs",
      nodes,
      arrows: validateArrows(r.arrows, sentence, unique, new Set(nodes.map((n) => n.id)), vars),
    };
    return stage;
  }

  if (kind === "figure" && str(r.component, 40) === "library") {
    // A textbook diagram from the library: the server fills `asset` from the index before this runs
    // (lib/canvas/generate.ts), so only its shape is checked here; parts must be the asset's own.
    const asset = libraryAsset(r.asset);
    if (!asset) return null;
    const known = new Map(asset.parts.map((p) => [p.id, p]));
    const parts = arr(r.parts)
      .map((p) => (typeof p === "string" ? { id: p } : obj(p)))
      .map((p, i) => {
        const id = str(p.id, 60).toLowerCase();
        if (!known.has(id)) return null;
        const name = shown(p.name ?? p.label, 34) || known.get(id)!.name.slice(0, 34);
        const say = shown(p.say, 200);
        if (unique(id, id) !== id) return null;
        return { id, name, s: sentence(p.s ?? p.sentence, i), ...(say ? { say } : {}) };
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 8);
    if (!parts.length) return null;
    const stage: FigureStage = { kind, component: "library", params: {}, parts, asset };
    return stage;
  }

  if (kind === "figure" && str(r.component, 40) === "drawn") {
    // A diagram the board writer described (lib/figures/drawn.ts): checked, then labelled like any figure.
    const { drawing } = drawnFigure(r.drawing);
    if (!drawing) return null;
    const known = new Map(drawing.parts.map((p) => [p.id, p]));
    const parts = arr(r.parts)
      .map((p) => (typeof p === "string" ? { id: p } : obj(p)))
      .map((p, i) => {
        const id = slug(p.id, "");
        if (!known.has(id) || unique(id, id) !== id) return null;
        const name = shown(p.name ?? p.label, 34) || known.get(id)!.name;
        const say = shown(p.say, 200);
        return { id, name, s: sentence(p.s ?? p.sentence, i), ...(say ? { say } : {}) };
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 8);
    if (!parts.length) return null;
    const stage: FigureStage = { kind, component: "drawn", params: {}, parts, drawing };
    return stage;
  }

  if (kind === "figure") {
    const component = figureComponent(str(r.component, 40));
    if (!component) return null;
    // Parameters are plain values only; the component itself checks and defaults each one.
    const params: FigureStage["params"] = {};
    // Up to 16 settings; text up to 400 characters, so data figures can carry their data ("points": "1,2; 3,5; …").
    for (const [k, v] of Object.entries(obj(r.params)).slice(0, 16)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,23}$/.test(k)) continue;
      if (typeof v === "string") params[k] = str(v, 400);
      else if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
      else if (typeof v === "boolean") params[k] = v;
    }
    // Only parts this figure actually draws for these params (a transverse wave has no compression).
    const built = component.build(params).parts;
    const drawn = new Set(built.map((p) => p.id));
    // A name the figure worked out from its data (a timeline event's own text, a titrant's name) is
    // the part's name: the board writer's guess at which event is "event-2" once put labels on the
    // wrong cards (audit 2026-10-17).
    const derived = new Map(built.filter((p) => p.name !== component.parts.find((d) => d.id === p.id)?.name).map((p) => [p.id, p.name]));
    const known = new Map(component.parts.filter((p) => drawn.has(p.id)).map((p) => [p.id, p]));
    const parts = arr(r.parts)
      .map((p) => (typeof p === "string" ? { id: p } : obj(p)))
      .map((p, i) => {
        const id = slug(p.id, "");
        if (!known.has(id)) return null;
        const name = derived.get(id)?.slice(0, 34) ?? (shown(p.name ?? p.label, 34) || known.get(id)!.name);
        const say = shown(p.say, 200);
        // A part's id is the component's own (its anchor is looked up by it): a repeat is dropped, not renamed.
        if (unique(id, id) !== id) return null;
        return { id, name, s: sentence(p.s ?? p.sentence, i), ...(say ? { say } : {}) };
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 8);
    if (!parts.length) return null;
    const stage: FigureStage = { kind, component: component.name, params, parts };
    return stage;
  }

  if (kind === "illustration") {
    const subject = str(r.subject, 500);
    const parts = arr(r.parts)
      .map((p) => (typeof p === "string" ? { name: p } : obj(p)))
      .map((p, i) => {
        const name = shown(p.name, 32);
        const say = str(p.say, 220);
        // A placeholder is not a part: a cell picture was labelled "Callouts" (audit 2026-10-17).
        if (/^(callouts?|labels?|parts?|arrows?|annotations?|pointers?|items?|part \d+|label \d+)$/i.test(name ?? "")) return null;
        return name ? { id: unique(p.id ?? name, `part-${i + 1}`), name, s: sentence(p.s ?? p.sentence, i), ...(say ? { say } : {}), ...(Number.isFinite(Number(p.x)) ? { x: Number(p.x), y: Number(p.y) } : {}) } : null;
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .slice(0, 8);
    if (!subject || !parts.length) return null;
    const partIds = new Set(parts.map((p) => p.id));
    const stage: IllustrationStage = {
      kind,
      subject,
      parts,
      labels: arr(r.labels).map((l) => slug(l, "")).filter((l) => partIds.has(l)).slice(0, 6),
      ...(typeof r.src === "string" ? { src: r.src } : {}),
      ...(typeof r.paper === "string" ? { paper: r.paper } : {}),
    };
    return stage;
  }

  if (kind === "equation") {
    const tokens = arr(r.tokens)
      .map((t) => (typeof t === "string" ? { text: t } : obj(t)))
      .map((t, i) => {
        const text = str(t.text, 18);
        return text ? { id: unique(t.id ?? `t${i + 1}`, `t${i + 1}`), text, color: color(t.color), on: t.on === undefined ? undefined : slug(t.on, "") } : null;
      })
      .filter((t): t is NonNullable<typeof t> => Boolean(t))
      .slice(0, 16)
      .map((t, _, all) => (t.on && all.some((h) => h.id === t.on && h.id !== t.id) ? t : { ...t, on: undefined }));
    if (tokens.length < 2) return null;
    const tokenIds = new Set(tokens.map((t) => t.id));
    const steps = arr(r.steps)
      .map((st) => obj(st))
      .map((st) => {
        const order = arr(st.order).map((id) => slug(id, "")).filter((id) => tokenIds.has(id));
        return order.length
          ? { s: sentence(st.s ?? st.sentence), order: [...new Set(order)], highlight: arr(st.highlight).map((h) => slug(h, "")).filter((h) => tokenIds.has(h)), caption: shown(st.caption, 64) || undefined }
          : null;
      })
      .filter((st): st is NonNullable<typeof st> => Boolean(st))
      .sort((a, b) => a.s - b.s)
      .slice(0, 6);
    const stage: EquationStage = { kind, tokens, steps: steps.length ? steps : [{ s: 0, order: tokens.map((t) => t.id), highlight: [] }] };
    return stage;
  }

  if (kind === "graph") {
    const axis = (v: unknown, fallback: string) => {
      const a = obj(v);
      const min = num(a.min, 0);
      const max = num(a.max, 100);
      return { label: shown(a.label, 48) || fallback, min: Math.min(min, max - 1e-6), max: Math.max(max, min + 1e-6) };
    };
    const curveVars = [...vars, "x"];
    const curves = arr(r.curves)
      .map((c) => obj(c))
      .map((c, i) => {
        let expr = str(c.expr, 160);
        // A curve is a function of its x axis. Written in the slider's variable instead ("rate =
        // f(light)" with light on the x axis), it would draw flat — so that variable becomes x.
        const read = compileExpr(expr)?.vars ?? [];
        if (!read.includes("x") && read.length === 1 && vars.includes(read[0])) expr = expr.replace(new RegExp(`\\b${read[0]}\\b`, "g"), "x");
        if (!compileExpr(expr) || !exprUsesOnly(expr, curveVars)) return null;
        return { id: unique(c.id ?? `curve-${i + 1}`, `curve-${i + 1}`), expr, label: shown(c.label, 32) || undefined, color: color(c.color), s: sentence(c.s ?? c.sentence, i) };
      })
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .slice(0, 3);
    if (!curves.length) return null;
    const curveIds = new Set(curves.map((c) => c.id));
    const markers = arr(r.markers)
      .map((m) => obj(m))
      .map((m, i) => {
        const x = str(m.x, 80) || String(num(m.x, NaN));
        const curve = slug(m.curve, curves[0].id);
        if (!compileExpr(x) || !exprUsesOnly(x, vars) || !curveIds.has(curve)) return null;
        return { id: unique(m.id ?? `marker-${i + 1}`, `marker-${i + 1}`), x, curve, label: shown(m.label, 32) || undefined, s: sentence(m.s ?? m.sentence) };
      })
      .filter((m): m is NonNullable<typeof m> => Boolean(m))
      .slice(0, 2);
    const guides = arr(r.guides)
      .map((g) => obj(g))
      .map((g, i) => (Number.isFinite(Number(g.x)) && str(g.label, 32) ? { id: unique(g.id ?? `guide-${i + 1}`, `guide-${i + 1}`), x: Number(g.x), label: shown(g.label, 32), s: sentence(g.s ?? g.sentence) } : null))
      .filter((g): g is NonNullable<typeof g> => Boolean(g))
      .slice(0, 2);
    const trace = obj(r.trace);
    const stage: GraphStage = {
      kind,
      x: axis(r.x, "x"),
      y: axis(r.y, "y"),
      curves,
      ...(markers.length ? { markers } : {}),
      ...(guides.length ? { guides } : {}),
      ...(curveIds.has(slug(trace.curve, "")) ? { trace: { curve: slug(trace.curve, ""), s: sentence(trace.s ?? trace.sentence) } } : {}),
    };
    return snapEquilibrium(stage);
  }

  if (kind === "compare") {
    const side = (v: unknown, fallback: string) => {
      const s = obj(v);
      const title = shown(s.title, 32);
      const items = arr(s.items)
        .map((it) => (typeof it === "string" ? { text: it } : obj(it)))
        .map((it, i) => (str(it.text, 80) ? { id: unique(it.id ?? `${fallback}-${i + 1}`, `${fallback}-${i + 1}`), text: shown(it.text, 72), s: sentence(it.s ?? it.sentence, i) } : null))
        .filter((it): it is NonNullable<typeof it> => Boolean(it))
        .slice(0, 4);
      return title && items.length ? { id: unique(s.id ?? fallback, fallback), title, icon: icon(s.icon, `${str(s.title, 60)} ${items.map((i) => i.text).join(" ")}`), color: color(s.color), items } : null;
    };
    const left = side(r.left, "left");
    const right = side(r.right, "right");
    if (!left || !right) return null;
    const itemIds = new Set([...left.items, ...right.items].map((i) => i.id));
    const stage: CompareStage = {
      kind,
      left,
      right,
      links: arr(r.links)
        .map((l) => obj(l))
        .map((l) => ({ from: slug(l.from, ""), to: slug(l.to, "") }))
        .filter((l) => itemIds.has(l.from) && itemIds.has(l.to))
        .slice(0, 4),
    };
    return stage;
  }

  // scene
  const items = arr(r.items)
    .map((it) => obj(it))
    .map((it, i) => {
      const k = str(it.kind, 6);
      const cell = str(it.cell, 3).toUpperCase();
      if (!/^[A-F][1-4]$/.test(cell)) return null;
      return {
        id: unique(it.id ?? it.label ?? `item-${i + 1}`, `item-${i + 1}`),
        kind: (k === "box" || k === "text" ? k : "icon") as SceneStage["items"][number]["kind"],
        icon: icon(it.icon, `${str(it.id, 40)} ${str(it.label, 60)} ${str(it.detail, 90)}`),
        label: shown(it.label, 40) || undefined,
        ...(shown(it.detail, 90) ? { detail: shown(it.detail, 90) } : {}),
        cell,
        span: /^[1-6]x[1-4]$/.test(str(it.span, 3)) ? str(it.span, 3) : undefined,
        color: color(it.color),
        s: sentence(it.s ?? it.sentence, i),
        ...(becomesOf(it.becomes, sentence) ? { becomes: becomesOf(it.becomes, sentence) } : {}),
      };
    })
    .filter((it): it is NonNullable<typeof it> => Boolean(it))
    .slice(0, 12);
  if (!items.length) return null;
  const stage: SceneStage = { kind: "scene", items, arrows: validateArrows(r.arrows, sentence, unique, new Set(items.map((i) => i.id)), vars) };
  return stage;
}

/** A morph is only kept when it changes something and happens on a real sentence. */
/**
 * A program as the model wrote it, made safe to draw: lines keep their indentation (tabs become
 * spaces) and are capped in number and length; every step and trace row lands on a real sentence;
 * a step names real lines. The listing must be real code — at least one line that is not blank.
 */
function validateCode(r: Raw, sentence: (v: unknown, f?: number) => number, unique: (v: unknown, f: string) => string): CodeStage | null {
  const rawLines = Array.isArray(r.lines) ? r.lines : typeof r.code === "string" ? r.code.split("\n") : [];
  const lines = rawLines
    .map((l) => (typeof l === "string" ? l.replace(/\t/g, "    ").replace(/\s+$/, "").slice(0, 72) : ""))
    .slice(0, 18);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (!lines.some((l) => l.trim())) return null;
  unique("code", "code");
  lines.forEach((_, i) => unique(`line-${i + 1}`, `line-${i + 1}`));
  const lineNo = (v: unknown) => {
    const n = Math.round(num(v, 0));
    return n >= 1 && n <= lines.length ? n : 0;
  };
  const steps = arr(r.steps)
    .map((st) => obj(st))
    .map((st, i) => {
      const picked = (Array.isArray(st.lines) ? st.lines : [st.lines ?? st.line]).map(lineNo).filter(Boolean);
      if (picked.length === 0) return null;
      const note = str(st.note, 48);
      // What the variables hold after these lines: an object {"count": 1} or a list of {name, value}.
      const rawState = st.state ?? st.vars;
      const stateList = Array.isArray(rawState)
        ? rawState.map((v) => obj(v)).map((v) => ({ name: str(v.name, 14), value: cell(v.value) }))
        : Object.entries(obj(rawState)).map(([name, value]) => ({ name: str(name, 14), value: cell(value) }));
      const state = stateList.filter((v) => v.name && /^[A-Za-z_][\w.\[\]]*$/.test(v.name)).slice(0, 5);
      return { s: sentence(st.s ?? st.sentence, i), lines: [...new Set(picked)].slice(0, 6), ...(note ? { note } : {}), ...(state.length ? { state } : {}) };
    })
    .filter((st): st is NonNullable<typeof st> => Boolean(st))
    .sort((a, b) => a.s - b.s)
    .slice(0, 10);
  const traceRaw = obj(r.trace);
  const vars = arr(traceRaw.vars).map((v) => str(v, 14)).filter(Boolean).slice(0, 4);
  const rows = vars.length
    ? arr(traceRaw.rows)
        .map((row) => obj(row))
        // Values are often numbers or booleans in the model's JSON: each is written as text.
        .map((row, i) => ({ s: sentence(row.s ?? row.sentence, i), values: vars.map((_, k) => cell(arr(row.values)[k])) }))
        .slice(0, 8)
    : [];
  const outputRaw = obj(r.output);
  const outputText = typeof outputRaw.text === "string" ? outputRaw.text.split("\n").slice(0, 4).map((l) => l.slice(0, 48)).join("\n").trim() : "";
  if (rows.length) unique("trace", "trace");
  if (outputText) unique("output", "output");
  const groups = arr(r.groups)
    .map((g) => obj(g))
    .map((g, i) => {
      const from = lineNo(g.from);
      const to = lineNo(g.to ?? g.from);
      const label = shown(g.label, 22);
      return from && to && to >= from && label ? { from, to, label, s: sentence(g.s ?? g.sentence, i) } : null;
    })
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
    .filter((g, i, all) => !all.slice(0, i).some((h) => g.from <= h.to && h.from <= g.to))
    .slice(0, 4);
  const edits = arr(r.edits)
    .map((e) => obj(e))
    .map((e) => {
      const line = lineNo(e.line);
      const from = typeof e.from === "string" ? e.from.replace(/\t/g, "    ").replace(/\s+$/, "").slice(0, 72) : "";
      return line && from !== lines[line - 1] ? { s: sentence(e.s ?? e.sentence, 1), line, from } : null;
    })
    .filter((e): e is NonNullable<typeof e> => Boolean(e))
    .filter((e, i, all) => all.findIndex((x) => x.line === e.line) === i)
    .slice(0, 3);
  if (groups.length) groups.forEach((_, i) => unique(`group-${i + 1}`, `group-${i + 1}`));
  if (steps.some((st) => st.state)) unique("state", "state");
  return {
    kind: "code",
    language: str(r.language, 20).toLowerCase() || "python",
    lines,
    ...(r.reveal === "all" ? { reveal: "all" as const } : {}),
    ...(groups.length ? { groups } : {}),
    ...(edits.length ? { edits } : {}),
    steps: steps.length ? steps : [{ s: 0, lines: [1] }],
    ...(rows.length ? { trace: { vars, rows } } : {}),
    ...(outputText ? { output: { s: sentence(outputRaw.s ?? outputRaw.sentence, 0), text: outputText } } : {}),
  };
}

/** One trace cell as text: a number, boolean or string, capped. */
function cell(v: unknown): string {
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return str(v, 14);
}

function becomesOf(raw: unknown, sentence: (v: unknown, f?: number) => number): { icon?: CanvasIcon; label?: string; s: number } | undefined {
  const b = obj(raw);
  const next = { icon: icon(b.icon, str(b.label, 60)), label: shown(b.label, 28) || undefined };
  if (!next.icon && !next.label) return undefined;
  return { ...next, s: sentence(b.s ?? b.sentence, 1) };
}

export function validateInteraction(raw: unknown): CanvasInteraction | undefined {
  const r = obj(raw);
  const kind = str(r.kind, 6);
  const prompt = str(r.prompt ?? r.question, 200);
  if (!prompt) return undefined;
  if (kind === "draw") {
    const expect = str(r.expect, 400);
    return expect ? { kind: "draw", prompt, expect } : undefined;
  }
  if (kind === "quiz") {
    const options = arr(r.options)
      .map((o) => obj(o))
      .map((o) => ({ text: shown(o.text, 110), correct: o.correct === true, feedback: shown(o.feedback, 260) }))
      .filter((o) => o.text && o.feedback)
      .slice(0, 4);
    const right = options.filter((o) => o.correct);
    // The right answer must be right on its own. A model that marks an option correct and then says
    // "none of these is quite right" has written a broken question — refuse it, so the board is redone.
    const selfDoubting = /none of (these|the above)|not quite right|isn'?t (quite )?right|neither is|is (actually )?wrong/i;
    if (right.length !== 1 || selfDoubting.test(right[0].feedback)) return undefined;
    // The card's header already says "Predict it"; the question is the question.
    const question = prompt.replace(/^\s*predict\s*:\s*/i, "").replace(/^./, (c) => c.toUpperCase());
    return options.length === 3 || options.length === 4 ? { kind: "quiz", question, options } : undefined;
  }
  if (kind !== "try") return undefined;
  const controls = arr(r.controls)
    .map((c) => obj(c))
    .map((c) => {
      const v = str(c.var, 16).replace(/[^A-Za-z0-9_]/g, "");
      if (!/^[A-Za-z_]/.test(v) || v === "x") return null;
      const min = num(c.min, 0);
      const max = num(c.max, 100);
      if (!(max > min)) return null;
      return { var: v, label: str(c.label, 28) || v, min, max, step: num(c.step, (max - min) / 100), value: Math.max(min, Math.min(max, num(c.value, (min + max) / 2))), unit: str(c.unit, 10) || undefined };
    })
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .slice(0, 2);
  if (!controls.length) return undefined;
  const vars = controls.map((c) => c.var);
  return {
    kind: "try",
    prompt,
    controls,
    reactions: arr(r.reactions)
      .map((x) => obj(x))
      .map((x) => ({ when: str(x.when, 120), say: str(x.say, 220) }))
      .filter((x) => x.say && exprUsesOnly(x.when, vars))
      .slice(0, 6),
    readouts: arr(r.readouts)
      .map((x) => obj(x))
      .map((x) => ({ label: str(x.label, 24), expr: str(x.expr, 120), unit: str(x.unit, 16) || undefined }))
      .filter((x) => x.label && exprUsesOnly(x.expr, vars))
      .slice(0, 2),
  };
}

/**
 * A library diagram as a stage carries it (lib/figures/libraryIndex.ts stageAsset): checked for
 * shape only — a safe id (it becomes a URL path), a positive size, and parts whose anchors lie on
 * the art. Its contents come from the server's index, never from the model.
 */
function libraryAsset(v: unknown): NonNullable<FigureStage["asset"]> | null {
  const a = obj(v);
  const id = typeof a.id === "string" && /^[a-z0-9-]{1,80}$/.test(a.id) ? a.id : "";
  const w = num(a.w, 0), h = num(a.h, 0);
  if (!id || !(w > 0 && w < 1e5) || !(h > 0 && h < 1e5)) return null;
  const parts = arr(a.parts)
    .map((p) => obj(p))
    .map((p) => {
      const pid = typeof p.id === "string" && /^[a-z0-9-]{1,60}$/.test(p.id) ? p.id : "";
      const at = obj(p.anchor);
      const x = num(at.x, NaN), y = num(at.y, NaN);
      if (!pid || !Number.isFinite(x) || !Number.isFinite(y) || x < -w * 0.05 || x > w * 1.05 || y < -h * 0.05 || y > h * 1.05) return null;
      return { id: pid, name: str(p.name, 60) || pid, anchor: { x, y } };
    })
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .slice(0, 80);
  if (!parts.length) return null;
  return { id, w, h, credit: str(a.credit, 160), parts };
}
