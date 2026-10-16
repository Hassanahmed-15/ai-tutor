import type { FigureComponent, FigurePart, FigureParams, FigureShape, Ink, Pt } from "../types";
import { r2, smoothClosed, smoothOpen } from "./bioDraw";

/**
 * THE HUMAN ENDOCRINE GLANDS, placed as the O Level textbooks place them on a front-view body
 * outline: the pituitary under the brain, the thyroid in the neck either side of the trachea, the
 * adrenal glands capping the kidneys, the pancreas across the upper abdomen, and the ovaries in the
 * pelvis beside the uterus or the testes in the scrotum. The body is drawn from the front, so the
 * body's right is on the student's left. Faint organs (brain, trachea, kidneys, uterus) only locate
 * the glands; the glands are the one strong colour.
 */

type Sex = "female" | "male" | "both";
function sexOf(v: unknown): Sex {
  const s = String(v ?? "").toLowerCase();
  const f = /\b(female|woman|women|girl|ovar\w*)\b/.test(s), m = /\b(male|man|men|boy|test[ie]s)\b/.test(s);
  if (f && !m) return "female";
  if (m && !f) return "male";
  return "both";
}

const C = {
  body: "#fde68a" as Ink,
  gland: "#fca5a5" as Ink,
  glandLine: "#be123c" as Ink,
  organ: "muted" as Ink,
  brain: "#e9d5ff" as Ink,
};

const W = 560, H = 460, CX = 280;
const pt = (x: number, y: number): Pt => ({ x, y });
const mirror = (pts: Pt[]) => pts.map((p) => pt(2 * CX - p.x, p.y));
const ellipse = (c: Pt, rx: number, ry: number, rot = 0) => {
  const pts = Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2;
    const x = rx * Math.cos(a), y = ry * Math.sin(a);
    return pt(c.x + x * Math.cos(rot) - y * Math.sin(rot), c.y + x * Math.sin(rot) + y * Math.cos(rot));
  });
  return smoothClosed(pts);
};

export const endocrineGlands: FigureComponent = {
  name: "endocrineGlands",
  title: "Human endocrine glands: a front-view body outline with the pituitary, thyroid, adrenal glands, pancreas, and the ovaries and/or testes",
  params: `sex ("both" default: ovaries and testes both shown and named by sex | "female": ovaries beside the uterus | "male": testes in the scrotum).`,
  match: /\bendocrine (glands?|system|organs?)\b|\b(positions?|locations?) of (the )?(main |major )?(endocrine )?glands\b|\bpituitary gland\b(?=[\s\S]{0,240}\b(thyroid|adrenal|pancreas|ovar\w*|test[ie]s|glands)\b)|\b(thyroid|adrenal) glands?\b(?=[\s\S]{0,240}\b(pituitary|pancreas|ovar\w*|test[ie]s|endocrine)\b)|\bductless glands?\b/i,
  parts: [
    { id: "pituitary", name: "Pituitary gland" },
    { id: "thyroid", name: "Thyroid gland" },
    { id: "adrenal-glands", name: "Adrenal glands" },
    { id: "pancreas", name: "Pancreas" },
    { id: "ovaries", name: "Ovaries" },
    { id: "testes", name: "Testes" },
    { id: "kidney", name: "Kidney" },
    { id: "brain", name: "Brain" },
  ],
  build(params: FigureParams) {
    const sex = sexOf(params?.sex ?? params?.gender ?? params?.show);
    const female = sex !== "male", male = sex !== "female";
    const s: FigureShape[] = [];
    const glands: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const gland = (d: string, part: string) => glands.push({ t: "path", d, fill: C.gland, stroke: C.glandLine, width: 2.2, part });
    const faint = (d: string, part?: string, dash?: string) => s.push({ t: "path", d, fill: "none", stroke: C.organ, width: 1.8, ...(part ? { part } : {}), ...(dash ? { dash } : {}) });

    // ── The body outline: shoulders, arms at the sides, cut at the thighs. ──
    const leftDown = [pt(266, 88), pt(264, 112), pt(230, 122), pt(200, 132), pt(186, 156), pt(180, 214), pt(174, 280), pt(170, 314), pt(164, 336), pt(170, 352), pt(182, 348), pt(186, 320), pt(192, 268), pt(198, 214), pt(210, 172), pt(214, 214), pt(220, 262), pt(210, 308), pt(210, 360), pt(216, 410), pt(220, H)];
    const leftUp = [pt(256, H), pt(256, 410), pt(260, 372), pt(CX, 350)];
    const rightDown = mirror([...leftUp].reverse());
    const rightUp = mirror([...leftDown].reverse());
    const outline = `${smoothOpen(leftDown)} L${leftUp[0].x} ${H} ${smoothOpen([...leftUp, ...rightDown.slice(1)]).replace(/^M[^C]+/, "")} L${rightUp[0].x} ${H} ${smoothOpen(rightUp).replace(/^M[^C]+/, "")} Z`;
    s.push({ t: "path", d: outline, fill: C.body, stroke: "none", opacity: 0.3 });
    // Outline drawn open at the bottom: the legs carry on out of the picture.
    s.push({ t: "path", d: smoothOpen(leftDown), fill: "none", stroke: "ink", width: 2.4 });
    s.push({ t: "path", d: smoothOpen([...leftUp, ...rightDown.slice(1)]), fill: "none", stroke: "ink", width: 2.4 });
    s.push({ t: "path", d: smoothOpen(rightUp), fill: "none", stroke: "ink", width: 2.4 });
    // The head.
    const head = pt(CX, 50);
    s.push({ t: "path", d: ellipse(head, 32, 40), fill: C.body, stroke: "none", opacity: 0.3 });
    s.push({ t: "path", d: ellipse(head, 32, 40), fill: "none", stroke: "ink", width: 2.4 });

    // ── Faint organs that locate the glands. ──
    s.push({ t: "path", d: smoothClosed([pt(CX - 26, 44), pt(CX - 22, 24), pt(CX, 16), pt(CX + 22, 24), pt(CX + 26, 44), pt(CX + 12, 56), pt(CX - 12, 56)]), fill: C.brain, stroke: C.organ, width: 1.8, opacity: 0.9, part: "brain" });
    parts.push({ id: "brain", name: "Brain", anchor: pt(CX + 12, 32) });
    // The trachea down the neck, behind the thyroid.
    faint(`M${CX - 6} 80 V136 M${CX + 6} 80 V136`);
    // Kidneys (the body's right one a little lower), with the adrenal glands on top.
    const kL = pt(250, 246), kR = pt(310, 240);
    for (const k of [kL, kR]) faint(smoothClosed([pt(k.x - 12, k.y - 18), pt(k.x + 6, k.y - 22), pt(k.x + 13, k.y - 6), pt(k.x + 6, k.y + 2), pt(k.x + 13, k.y + 10), pt(k.x + 6, k.y + 24), pt(k.x - 12, k.y + 20), pt(k.x - 16, k.y)].map((p) => (k === kR ? pt(2 * k.x - p.x, p.y) : p))), "kidney");
    parts.push({ id: "kidney", name: "Kidney", anchor: pt(kR.x - 4, kR.y + 20) });

    // ── The glands. ──
    // Pituitary: a pea on a stalk under the brain.
    s.push({ t: "path", d: `M${CX} 56 V63`, stroke: C.glandLine, width: 2, fill: "none", part: "pituitary" });
    glands.push({ t: "circle", cx: CX, cy: 67, r: 5.5, fill: C.gland, stroke: C.glandLine, width: 2, part: "pituitary" });
    parts.push({ id: "pituitary", name: "Pituitary gland", anchor: pt(CX - 2, 67) });
    // Thyroid: two lobes either side of the trachea joined by the isthmus.
    gland(`${smoothClosed([pt(CX - 4, 100), pt(CX - 10, 90), pt(CX - 17, 92), pt(CX - 19, 106), pt(CX - 14, 116), pt(CX - 6, 112)])}`, "thyroid");
    gland(`${smoothClosed(mirror([pt(CX - 4, 100), pt(CX - 10, 90), pt(CX - 17, 92), pt(CX - 19, 106), pt(CX - 14, 116), pt(CX - 6, 112)]))}`, "thyroid");
    gland(`M${CX - 6} 103 h12 v7 h-12 Z`, "thyroid");
    parts.push({ id: "thyroid", name: "Thyroid gland", anchor: pt(CX + 13, 104) });
    // Adrenal glands: caps on the kidneys.
    for (const k of [kL, kR]) gland(smoothClosed([pt(k.x - 12, k.y - 20), pt(k.x - 4, k.y - 34), pt(k.x + 6, k.y - 32), pt(k.x + 10, k.y - 22)].map((p) => (k === kR ? pt(2 * k.x - p.x, p.y) : p)), 0.8), "adrenal-glands");
    parts.push({ id: "adrenal-glands", name: "Adrenal glands", anchor: pt(kL.x - 3, kL.y - 26) });
    // Pancreas: head in the curve of the duodenum (body's right), tail towards the spleen (body's left).
    gland(smoothClosed([pt(258, 258), pt(266, 248), pt(290, 246), pt(312, 236), pt(328, 230), pt(334, 236), pt(318, 250), pt(294, 260), pt(274, 270), pt(260, 270)], 0.9), "pancreas");
    parts.push({ id: "pancreas", name: "Pancreas", anchor: pt(312, 243) });

    if (female) {
      // Uterus with its oviducts (faint), an ovary at the end of each.
      faint(smoothClosed([pt(CX - 14, 300), pt(CX + 14, 300), pt(CX + 10, 322), pt(CX + 4, 336), pt(CX - 4, 336), pt(CX - 10, 322)], 0.8));
      faint(`M${CX - 13} 304 C${CX - 26} 292 ${CX - 38} 292 ${CX - 42} 302 M${CX + 13} 304 C${CX + 26} 292 ${CX + 38} 292 ${CX + 42} 302`);
      for (const x of [CX - 34, CX + 34]) gland(ellipse(pt(x, 312), 9, 6.5, x < CX ? 0.4 : -0.4), "ovaries");
      parts.push({ id: "ovaries", name: sex === "both" ? "Ovaries (female)" : "Ovaries", anchor: pt(CX - 36, 313) });
    }
    if (male) {
      // The scrotum below the body, a testis in each side.
      const sy = 372;
      const scrotum = `M${CX - 12} 352 C${CX - 26} 358 ${CX - 27} ${sy + 22} ${CX - 13} ${sy + 26} C${CX - 6} ${sy + 28} ${CX} ${sy + 22} ${CX} ${sy + 18} C${CX} ${sy + 22} ${CX + 6} ${sy + 28} ${CX + 13} ${sy + 26} C${CX + 27} ${sy + 22} ${CX + 26} 358 ${CX + 12} 352`;
      s.push({ t: "path", d: scrotum, fill: C.body, stroke: "none", opacity: 0.45 }, { t: "path", d: scrotum, fill: "none", stroke: "ink", width: 2 });
      for (const x of [CX - 10, CX + 10]) gland(ellipse(pt(x, sy + 8), 6.5, 10, x < CX ? 0.2 : -0.2), "testes");
      parts.push({ id: "testes", name: sex === "both" ? "Testes (male)" : "Testes", anchor: pt(CX + 11, sy + 9) });
    }

    const order = endocrineGlands.parts.map((p) => p.id);
    parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { w: W, h: H, shapes: [...s, ...glands], parts: parts.map((p) => ({ ...p, anchor: { x: r2(p.anchor.x), y: r2(p.anchor.y) } })) };
  },
};
