import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { BIO, arrowShapes, capital, cleanName, r2, roundedPoly, softShape, transform } from "./bioDraw";

type Model = "lock-and-key" | "induced-fit";
type Inhibitor = "none" | "competitive" | "non-competitive";
type PanelKind = "approach" | "complex" | "products" | "denatured" | "competitive" | "non-competitive";

/* ── geometry, relative to the active site's mouth (0,0), y down; the enzyme hangs below ─────── */

/** The enzyme's body outside its active site: right shoulder, round the bottom, to the left shoulder. */
const BODY: Pt[] = [{ x: 74, y: -2 }, { x: 106, y: 16 }, { x: 112, y: 70 }, { x: 84, y: 110 }, { x: 8, y: 120 }, { x: -70, y: 112 }, { x: -108, y: 80 }, { x: -104, y: 24 }, { x: -74, y: -2 }];
/** The active site that fits the substrate exactly: two pockets either side of a ridge. */
const KEY: Pt[] = [{ x: -36, y: 0 }, { x: -30, y: 46 }, { x: -12, y: 46 }, { x: 0, y: 14 }, { x: 12, y: 46 }, { x: 30, y: 46 }, { x: 36, y: 0 }];
const KEY_R = [6, 5, 4, 4, 4, 5, 6];
/** Induced fit before binding: a wider, rounder site that is NOT yet the substrate's shape. */
const BOWL: Pt[] = [{ x: -46, y: 0 }, { x: -40, y: 34 }, { x: 0, y: 42 }, { x: 40, y: 34 }, { x: 46, y: 0 }];
/** Denatured: the bonds holding the shape have broken; the site is a different, irregular shape. */
const BROKEN: Pt[] = [{ x: -44, y: 0 }, { x: -18, y: 12 }, { x: -30, y: 30 }, { x: 0, y: 36 }, { x: 12, y: 16 }, { x: 30, y: 26 }, { x: 40, y: 4 }];
/** Non-competitive: binding elsewhere changes the site's shape (less than denaturing does). */
const ALTERED: Pt[] = [{ x: -36, y: 0 }, { x: -18, y: 20 }, { x: -28, y: 38 }, { x: 6, y: 32 }, { x: 22, y: 42 }, { x: 38, y: 2 }];
/** The substrate: feet that fit KEY, a block above the enzyme's surface. */
const SUBSTRATE: Pt[] = [...KEY.map((p) => ({ x: p.x, y: p.y - 1 })), { x: 36, y: -34 }, { x: -36, y: -34 }];
const SUBSTRATE_R = [...KEY_R, 12, 12];
/** Products: the substrate split at its middle ridge. */
const PRODUCT_L: Pt[] = [{ x: -36, y: -1 }, { x: -30, y: 45 }, { x: -12, y: 45 }, { x: -1, y: 15 }, { x: -1, y: -34 }, { x: -36, y: -34 }];
const PRODUCT_R: Pt[] = [{ x: 1, y: 15 }, { x: 12, y: 45 }, { x: 30, y: 45 }, { x: 36, y: -1 }, { x: 36, y: -34 }, { x: 1, y: -34 }];
/** A competitive inhibitor: the same feet as the substrate (it fits the site) with a different top. */
const COMPETITOR: Pt[] = [...KEY.map((p) => ({ x: p.x, y: p.y - 1 })), { x: 14, y: -30 }, { x: -14, y: -30 }];

const PW = 236, PH = 272, OY = 146, GAP = 64;

function choose<T extends string>(v: unknown, options: Array<[T, RegExp]>, fallback: T): T {
  const s = String(v ?? "").toLowerCase();
  for (const [value, re] of options) if (re.test(s)) return value;
  return fallback;
}

export type EnzymeSetup = { model: Model; inhibitor: Inhibitor; denatured: boolean; panels: PanelKind[]; enzyme: string; substrate: string; product: string };

/** What the figure shows, from the parameters: which panels, in which order. */
export function enzymeSetup(params: FigureParams): EnzymeSetup {
  const model = choose<Model>(params.model, [["induced-fit", /induc/], ["lock-and-key", /lock|key/]], "lock-and-key");
  const inhibitorRaw = params.inhibitor ?? params.inhibition;
  const inhibitor = inhibitorRaw === true ? "competitive" : choose<Inhibitor>(inhibitorRaw, [["non-competitive", /non|allost/], ["competitive", /compet/]], "none");
  const denatured = params.denatured === true || /^(true|yes|1)$/i.test(String(params.denatured ?? "")) || /denatur|high temp|extreme|ph/i.test(String(params.condition ?? ""));
  const stageWord = String(params.stage ?? params.stages ?? "all").toLowerCase();
  const single = /approach|before|free/.test(stageWord) ? "approach" : /complex|bound|bind/.test(stageWord) ? "complex" : /product|after|release/.test(stageWord) ? "products" : null;
  const altered: PanelKind | null = denatured ? "denatured" : inhibitor === "none" ? null : inhibitor;
  const panels: PanelKind[] = altered ? (single ? [altered] : ["complex", altered]) : single ? [single] : ["approach", "complex", "products"];
  return {
    model, inhibitor, denatured, panels,
    enzyme: cleanName(params.enzyme, 14),
    substrate: cleanName(params.substrate, 14),
    product: cleanName(params.product ?? params.products, 14),
  };
}

/** Text of a part's label with the board's names in brackets when they fit. */
const named = (base: string, extra: string) => (extra && `${base} (${extra})`.length <= 34 ? `${base} (${extra})` : base);

/** Lines (no fill) along the active site, with corners rounded like the outline's. */
function liningPath(pts: Pt[]): string {
  let d = `M${r2(pts[0].x)} ${r2(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], v = pts[i], b = pts[i + 1];
    const la = Math.hypot(a.x - v.x, a.y - v.y) || 1, lb = Math.hypot(b.x - v.x, b.y - v.y) || 1, r = Math.min(4, la / 2, lb / 2);
    const s = { x: v.x + ((a.x - v.x) / la) * r, y: v.y + ((a.y - v.y) / la) * r }, e = { x: v.x + ((b.x - v.x) / lb) * r, y: v.y + ((b.y - v.y) / lb) * r };
    d += ` L${r2(s.x)} ${r2(s.y)} Q${r2(v.x)} ${r2(v.y)} ${r2(e.x)} ${r2(e.y)}`;
  }
  const z = pts[pts.length - 1];
  return d + ` L${r2(z.x)} ${r2(z.y)}`;
}

/**
 * Enzyme action as textbooks draw it: an enzyme with an active site whose shape is complementary to
 * its substrate; the substrate binds to form an enzyme–substrate complex, and the products leave an
 * unchanged enzyme. Lock-and-key: the site already fits. Induced fit: the site is a looser shape until
 * the substrate binds, then moulds round it. Denatured (high temperature or extreme pH): the site's
 * shape has changed, so the substrate no longer fits. A competitive inhibitor occupies the active site;
 * a non-competitive one binds elsewhere and changes the site's shape.
 */
export const enzymeAction: FigureComponent = {
  name: "enzymeAction",
  title: "Enzyme action: active site, substrate, enzyme–substrate complex, products (lock-and-key or induced fit; denatured; inhibitors)",
  params: `model ("lock-and-key" — default — or "induced-fit"); stage ("all" — default: approach → enzyme–substrate complex → products; or one of "approach", "complex", "products"); denatured (true: high temperature or extreme pH has changed the active site's shape, so the substrate no longer fits — drawn beside a working enzyme); inhibitor ("competitive": occupies the active site; "non-competitive": binds elsewhere and changes the active site's shape — drawn beside a working enzyme); enzyme, substrate, product (names for the labels, e.g. "amylase", "starch", "maltose").`,
  match: /\bbiological catalysts?\b|\benzymes?\b(?=[\s\S]{0,300}\bcatalys\w*)|\block[- ]and[- ]key\b|\binduced[- ]fit\b|\bactive sites?\b|\benzyme[- –]substrate( complex)?\b|\b(how enzymes work|enzyme action|enzyme specificity|enzymes? (are|is) specific)\b|\bdenatur(e|ed|es|ing|ation)\b.*\benzymes?\b|\benzymes?\b.*\bdenatur(e|ed|es|ing|ation)\b|\b(non-?|un)?competitive inhibit(ors?|ion)\b|\benzyme inhibit(ors?|ion)\b/i,
  parts: [
    { id: "enzyme", name: "Enzyme" },
    { id: "active-site", name: "Active site" },
    { id: "substrate", name: "Substrate" },
    { id: "complex", name: "Enzyme–substrate complex" },
    { id: "products", name: "Products" },
    { id: "inhibitor", name: "Inhibitor" },
    { id: "denatured-site", name: "Denatured active site" },
  ],
  build(params: FigureParams) {
    const s = enzymeSetup(params);
    const shapes: FigureShape[] = [];
    const anchors = new Map<string, Pt>();
    const once = (id: string, p: Pt) => { if (!anchors.has(id)) anchors.set(id, { x: r2(p.x), y: r2(p.y) }); };
    const ENZ = BIO.violet, SUB = BIO.green, SITE = BIO.amber, INH = BIO.red;

    // Panel origins: one row, or (approach, complex, products) as approach → complex across the top
    // and products beneath, so every part is reachable from a margin.
    const three = s.panels.length === 3;
    const slots: Pt[] = three
      ? [{ x: 0, y: 0 }, { x: PW + GAP, y: 0 }, { x: (PW + GAP) / 2, y: PH + 26 }]
      : s.panels.map((_, i) => ({ x: i * (PW + GAP), y: 0 }));
    const W = three ? 2 * PW + GAP : s.panels.length * PW + (s.panels.length - 1) * GAP;
    const H = three ? 2 * PH + 26 : PH;

    const enzymeShape = (O: Pt, kind: PanelKind, tag: string | undefined) => {
      const site: Pt[] = kind === "denatured" ? BROKEN : kind === "non-competitive" ? ALTERED
        : s.model === "induced-fit" && kind !== "complex" && kind !== "competitive" ? BOWL : KEY;
      let body = BODY;
      if (kind === "denatured") body = BODY.map((p, i) => ({ x: p.x * (1 + (i % 2 ? 0.07 : -0.04)), y: p.y + (i % 3 ? 6 : -4) }));
      if (s.model === "induced-fit" && kind === "complex") {
        // Bound: the site has closed round the substrate; its rim rises against the substrate's sides.
        body = BODY.map((p, i) => (i === 0 ? { x: 68, y: -14 } : i === BODY.length - 1 ? { x: -68, y: -14 } : p));
      }
      let outline: Pt[] = [...body, ...site];
      let radii: number[] = [...body.map(() => 34), ...site.map((_, i) => (site === KEY ? KEY_R[i] : site === BOWL ? [6, 16, 22, 16, 6][i] : 5))];
      if (s.model === "induced-fit" && kind === "complex") {
        outline = [...body, { x: -39, y: -16 }, ...site, { x: 39, y: -16 }];
        radii = [...body.map(() => 34), 5, ...KEY_R, 5];
      }
      if (kind === "non-competitive") {
        // The allosteric site: a pocket in the right flank, where the inhibitor binds.
        const pocket = [{ x: 104, y: 32 }, { x: 90, y: 40 }, { x: 88, y: 52 }, { x: 92, y: 62 }, { x: 106, y: 68 }];
        outline = [body[0], body[1], ...pocket, ...body.slice(2), ...site];
        radii = [34, 26, 4, 8, 8, 8, 4, ...body.slice(2).map(() => 34), ...site.map(() => 5)];
      }
      const pts = transform(outline, { x: 0, y: 0 }, 0, O);
      shapes.push(...softShape(roundedPoly(pts, radii), ENZ, tag, { fillOpacity: 0.2, width: 2.4 }));
      const sitePts = transform(site, { x: 0, y: 0 }, 0, O);
      const siteTag = kind === "denatured" ? "denatured-site" : tag === "enzyme" ? "active-site" : tag;
      shapes.push({ t: "path", part: siteTag, d: liningPath(sitePts), stroke: kind === "denatured" ? INH : SITE, width: 4.5, fill: "none", opacity: 0.9 });
      return sitePts;
    };
    const piece = (pts: Pt[], radii: number[], O: Pt, colour: `#${string}`, tag: string | undefined, angle = 0, shift: Pt = { x: 0, y: 0 }) => {
      const moved = transform(pts, { x: 0, y: 4 }, angle, { x: O.x + shift.x, y: O.y + shift.y });
      shapes.push(...softShape(roundedPoly(moved, radii), colour, tag, { fillOpacity: 0.32, width: 2.2 }));
      return moved;
    };
    /** A point given in a piece's own coordinates, moved as the piece was. */
    const at = (O: Pt, angle: number, shift: Pt, p: Pt) => transform([p], { x: 0, y: 4 }, angle, { x: O.x + shift.x, y: O.y + shift.y })[0];
    const cross = (c: Pt) => {
      // "Cannot bind": a red cross between the substrate and the site.
      shapes.push({ t: "path", d: `M${r2(c.x - 9)} ${r2(c.y - 9)} L${r2(c.x + 9)} ${r2(c.y + 9)} M${r2(c.x + 9)} ${r2(c.y - 9)} L${r2(c.x - 9)} ${r2(c.y + 9)}`, stroke: INH, width: 4, fill: "none" });
    };
    const blockedSubstrate = (O: Pt, tag?: string) => {
      const p = piece(SUBSTRATE, SUBSTRATE_R, O, SUB, tag, -0.22, { x: -48, y: -92 });
      cross({ x: O.x - 4, y: O.y - 30 });
      return p;
    };

    s.panels.forEach((kind, i) => {
      const O = { x: slots[i].x + PW / 2, y: slots[i].y + OY };
      if (kind === "approach") {
        const site = enzymeShape(O, kind, "enzyme");
        const sub = piece(SUBSTRATE, SUBSTRATE_R, O, SUB, "substrate", -0.3, { x: -46, y: -96 });
        shapes.push(...arrowShapes({ x: O.x + 4, y: O.y - 92 }, { x: O.x + 26, y: O.y - 40 }, "muted", 2.2, undefined, { head: 10, bend: -10 }));
        once("enzyme", { x: O.x - 80, y: O.y + 84 });
        once("active-site", { x: site[0].x + 3, y: site[0].y + 9 });
        once("substrate", at(O, -0.3, { x: -46, y: -96 }, { x: -14, y: -12 }));
        void sub;
      } else if (kind === "complex") {
        enzymeShape(O, kind, s.panels.length === 2 ? "enzyme" : "complex");
        if (s.panels.length === 2) {
          // The working enzyme beside an altered one: its parts are the enzyme, its site, its substrate.
          piece(SUBSTRATE, SUBSTRATE_R, O, SUB, "substrate");
          once("enzyme", { x: O.x - 80, y: O.y + 84 });
          once("active-site", { x: O.x - 33, y: O.y + 22 });
          once("substrate", { x: O.x - 20, y: O.y - 18 });
        } else {
          piece(SUBSTRATE, SUBSTRATE_R, O, SUB, "complex");
          once("complex", { x: O.x + 80, y: O.y + 84 });
        }
      } else if (kind === "products") {
        enzymeShape(O, kind, s.panels.length === 1 ? "enzyme" : undefined);
        if (s.panels.length === 1) once("enzyme", { x: O.x - 80, y: O.y + 84 });
        if (s.panels.length === 1) once("active-site", { x: O.x - (s.model === "induced-fit" ? 43 : 33), y: O.y + 9 });
        const L = piece(PRODUCT_L, [6, 5, 4, 4, 12, 12], O, SUB, "products", -0.3, { x: -44, y: -74 });
        const R = piece(PRODUCT_R, [4, 4, 5, 6, 12, 12], O, SUB, "products", 0.3, { x: 44, y: -74 });
        void L;
        once("products", at(O, 0.3, { x: 44, y: -74 }, { x: 24, y: -14 }));
        void R;
      } else if (kind === "denatured") {
        const site = enzymeShape(O, kind, s.panels.length === 1 ? "enzyme" : undefined);
        if (s.panels.length === 1) once("enzyme", { x: O.x - 80, y: O.y + 84 });
        const sub = blockedSubstrate(O, s.panels.length === 1 ? "substrate" : undefined);
        if (s.panels.length === 1) once("substrate", at(O, -0.22, { x: -48, y: -92 }, { x: -18, y: -14 }));
        void sub;
        once("denatured-site", { x: site[site.length - 2].x + 6, y: site[site.length - 2].y - 2 });
      } else {
        const site = enzymeShape(O, kind, s.panels.length === 1 ? "enzyme" : undefined);
        if (s.panels.length === 1) {
          once("enzyme", { x: O.x - 80, y: O.y + 84 });
          if (kind === "non-competitive") once("active-site", { x: site[0].x + 3, y: site[0].y + 9 });
        }
        const sub = blockedSubstrate(O, s.panels.length === 1 ? "substrate" : undefined);
        if (s.panels.length === 1) once("substrate", at(O, -0.22, { x: -48, y: -92 }, { x: -18, y: -14 }));
        void sub;
        if (kind === "competitive") {
          const inh = piece(COMPETITOR, [...KEY_R, 8, 8], O, INH, "inhibitor");
          once("inhibitor", { x: O.x + 12, y: O.y - 14 });
          void inh;
        } else {
          const c = { x: O.x + 104, y: O.y + 50 };
          shapes.push(...softShape(roundedPoly([{ x: c.x - 13, y: c.y - 16 }, { x: c.x + 14, y: c.y - 14 }, { x: c.x + 16, y: c.y + 14 }, { x: c.x - 13, y: c.y + 15 }], 12), INH, "inhibitor", { fillOpacity: 0.38 }));
          once("inhibitor", { x: c.x + 10, y: c.y });
        }
      }
    });

    // Reaction arrows between panels.
    const enzMid = OY + 50;
    if (three) {
      shapes.push(...arrowShapes({ x: PW - 2, y: enzMid }, { x: PW + GAP + 2, y: enzMid }, "ink", 2.6, undefined, { head: 13 }));
      shapes.push(...arrowShapes({ x: PW + GAP + PW * 0.32, y: PH - 4 }, { x: (PW + GAP) / 2 + PW * 0.72, y: PH + 46 }, "ink", 2.6, undefined, { head: 13 }));
    } else if (s.panels.length === 2) {
      shapes.push(...arrowShapes({ x: PW - 2, y: enzMid }, { x: PW + GAP + 2, y: enzMid }, s.denatured ? INH : "ink", 2.6, undefined, { head: 13, ...(s.denatured ? {} : { dash: "7 6" }) }));
    }

    const name: Record<string, string> = {
      enzyme: named("Enzyme", s.enzyme),
      "active-site": s.model === "induced-fit" && s.panels[0] === "approach" ? "Active site (not yet fitting)" : "Active site",
      substrate: named("Substrate", s.substrate),
      complex: "Enzyme–substrate complex",
      products: named("Products", s.product),
      inhibitor: s.inhibitor === "non-competitive" ? "Non-competitive inhibitor" : "Competitive inhibitor",
      "denatured-site": "Denatured active site",
    };
    const order = ["enzyme", "active-site", "substrate", "complex", "products", "inhibitor", "denatured-site"];
    const parts: FigurePart[] = order.filter((id) => anchors.has(id)).map((id) => ({ id, name: capital(name[id]), anchor: anchors.get(id)! }));
    // Every shape names a part that is built.
    for (const sh of shapes) if (sh.part && !anchors.has(sh.part)) delete sh.part;
    return { w: W, h: H, shapes, parts };
  },
};
