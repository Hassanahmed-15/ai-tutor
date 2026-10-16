import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { solutionColour } from "../colours";
import { GLASS_W, clipBelow, conicalFlask, dots, num, poly, r1, rotate, solidColour, surface, text, tubeWalls } from "./apparatusKit";

/**
 * Filtration as O Level / IGCSE books draw it: a beaker of the mixture poured down a glass rod into
 * a filter funnel lined with a cone of filter paper, the funnel's stem in the neck of a conical
 * flask. The insoluble solid (residue) stays on the paper; the filtrate drips through into the flask.
 * The mixture is drawn as the filtrate's liquid with particles of the residue in it.
 */
export const filtration: FigureComponent = {
  name: "filtration",
  title: "Filtration apparatus: mixture poured down a glass rod into a filter funnel with filter paper, residue on the paper, filtrate collected in a conical flask",
  params: `mixture (what is being filtered, e.g. "sand and salt water"), residue (the insoluble solid left on the paper, e.g. "sand"), residueColour (sand, white, black, grey, blue, green, brown, yellow…; default sand), filtrate (the liquid that passes through, e.g. "salt solution"), filtrateColour (colourless, pale blue, blue, green, yellow…; default colourless), filtrateLevel (0-1, default 0.3)`,
  match: /^(?!.*\b(kidney|nephron|glomerul\w*|ultrafiltration|urinary|colorimet\w*|absorbance|cuvettes?)\b)[\s\S]*(\bfiltrat(e|ion)\b|\bfilter(ing|ed)?\b.*\b(funnel|paper|residue|mixture|insoluble)\b|\bfilter (funnel|paper)\b)/i,
  parts: [
    { id: "beaker", name: "Beaker" },
    { id: "mixture", name: "Mixture" },
    { id: "glass-rod", name: "Glass rod" },
    { id: "filter-funnel", name: "Filter funnel" },
    { id: "filter-paper", name: "Filter paper" },
    { id: "residue", name: "Residue" },
    { id: "conical-flask", name: "Conical flask" },
    { id: "filtrate", name: "Filtrate" },
  ],
  build(params: FigureParams) {
    const mixtureName = text(params.mixture, "Mixture");
    const residueName = text(params.residue, "Residue");
    const filtrateName = text(params.filtrate, "Filtrate");
    const solid = solidColour(params.residueColour, "sand");
    const liquid = solutionColour(params.filtrateColour, "colourless");
    const fLevel = num(params.filtrateLevel, 0.3, 0.08, 0.75);
    const shapes: FigureShape[] = [];

    const cx = 200, rimY = 150, rimHalf = 78, apexY = 232, stemHalf = 6;
    const half = (y: number) => stemHalf + ((apexY - y) / (apexY - rimY)) * (rimHalf - stemHalf);
    const neckTop = 292, base = 430;
    const W = cx + 112, H = base + 10;

    // ---- Conical flask and filtrate (with drops falling from the stem).
    const flask = conicalFlask(cx, neckTop, base, 19, 68, 24);
    const fl = base - (base - flask.neckBottom) * fLevel;
    shapes.push({ t: "path", part: "filtrate", d: flask.liquid(fl), fill: liquid, stroke: "none", opacity: 0.85 });
    shapes.push({ t: "path", part: "filtrate", d: surface(flask.wall(fl, -1), flask.wall(fl, 1), fl), stroke: "ink", width: 1.4, fill: "none" });
    dots(shapes, "filtrate", [{ x: cx - 1, y: 350 }, { x: cx - 1, y: 368 }], 2.6, liquid);
    shapes.push({ t: "path", part: "conical-flask", d: flask.outline, stroke: "ink", width: GLASS_W, fill: "none" });
    shapes.push({ t: "path", part: "conical-flask", d: flask.lip, stroke: "ink", width: GLASS_W, fill: "none" });

    // ---- Filter paper cone (folded in quarters), residue, the liquid standing above it.
    const pTop = rimY + 8, pApex = apexY - 6;
    const ph = (y: number) => half(y) - 4 - ((y - pTop) / (pApex - pTop)) * 2;
    const resTop = 200, liqTop = 184;
    const liq = poly([{ x: cx - ph(liqTop), y: liqTop }, { x: cx + ph(liqTop), y: liqTop }, { x: cx + ph(resTop), y: resTop }, { x: cx - ph(resTop), y: resTop }]);
    shapes.push({ t: "path", part: "filter-paper", d: `M${r1(cx - ph(pTop))} ${pTop} L${cx} ${pApex} L${r1(cx + ph(pTop))} ${pTop} Z`, fill: "paper", stroke: "ink", width: 1.5 });
    shapes.push({ t: "path", part: "filter-paper", d: `M${r1(cx - ph(pTop) + 22)} ${pTop} L${cx} ${pApex}`, fill: "none", stroke: "ink", width: 1, opacity: 0.6 });
    shapes.push({ t: "path", part: "mixture", d: liq, fill: liquid, stroke: "none", opacity: 0.85 });
    shapes.push({ t: "path", part: "mixture", d: surface(cx - ph(liqTop), cx + ph(liqTop), liqTop), stroke: "ink", width: 1.2, fill: "none" });
    let bumps = `M${r1(cx - ph(resTop))} ${resTop}`;
    for (let i = 1; i <= 6; i++) {
      const x = cx - ph(resTop) + (i * 2 * ph(resTop)) / 6;
      bumps += ` Q${r1(x - ph(resTop) / 6)} ${resTop - 4} ${r1(x)} ${resTop}`;
    }
    shapes.push({ t: "path", part: "residue", d: `${bumps} L${cx} ${pApex - 1} Z`, fill: solid, stroke: "ink", width: 1.3 });
    dots(shapes, "residue", [{ x: cx - 12, y: 207 }, { x: cx + 4, y: 210 }, { x: cx + 15, y: 205 }, { x: cx - 3, y: 216 }], 1.6, "ink", "none", 0);

    // ---- Filter funnel: cone and stem (tip cut at a slant, touching the inside of the neck).
    const tipL = 342, tipR = 332;
    shapes.push({ t: "path", part: "filter-funnel", d: `M${cx - rimHalf} ${rimY} L${cx - stemHalf} ${apexY} V${tipL} L${cx + stemHalf} ${tipR} V${apexY} L${cx + rimHalf} ${rimY}`, stroke: "ink", width: GLASS_W, fill: "none" });
    shapes.push({ t: "path", part: "filter-funnel", d: `M${cx - rimHalf - 3} ${rimY - 1} h7 M${cx + rimHalf - 4} ${rimY - 1} h7`, stroke: "ink", width: GLASS_W, fill: "none" });

    // ---- Glass rod from the beaker's lip down onto the paper; the mixture runs down it.
    const rodTop: Pt = { x: cx - 70, y: 40 }, rodEnd: Pt = { x: cx - 30, y: 192 };
    const lipY = 98, lip: Pt = { x: rodTop.x + ((lipY - rodTop.y) / (rodEnd.y - rodTop.y)) * (rodEnd.x - rodTop.x) - 3.5, y: lipY };
    const [ra, rb] = tubeWalls([rodTop, rodEnd], 3.2);
    shapes.push({ t: "path", part: "glass-rod", d: `${poly([...ra, ...rb.reverse()])}`, fill: "glass", stroke: "ink", width: 1.6 });
    shapes.push({ t: "path", part: "mixture", d: `M${lip.x + 2} ${lip.y - 2} L${rodEnd.x + 5} ${rodEnd.y - 2} L${rodEnd.x + 9} ${liqTop + 2}`, stroke: liquid, width: 3, fill: "none", opacity: 0.9 });

    // ---- Beaker, tilted about its lip, its liquid level horizontal just at the lip.
    const bw = 62, bh = 82, tilt = 42;
    const local = { TL: { x: lip.x - bw, y: lip.y }, BL: { x: lip.x - bw, y: lip.y + bh }, BR: { x: lip.x, y: lip.y + bh }, TR: lip };
    const [TL, BL, BR, TR] = rotate([local.TL, local.BL, local.BR, local.TR], lip, tilt);
    const inner = rotate([{ x: lip.x - bw + 2, y: lip.y + 2 }, { x: lip.x - bw + 2, y: lip.y + bh - 2 }, { x: lip.x - 2, y: lip.y + bh - 2 }, { x: lip.x - 2, y: lip.y + 2 }], lip, tilt);
    const level = lip.y + 1;
    const pool = clipBelow(inner, level);
    if (pool.length >= 3) {
      shapes.push({ t: "path", part: "mixture", d: poly(pool), fill: liquid, stroke: "none", opacity: 0.85 });
      const xs = pool.filter((p) => Math.abs(p.y - level) < 0.01).map((p) => p.x);
      if (xs.length >= 2) shapes.push({ t: "path", part: "mixture", d: `M${r1(Math.min(...xs))} ${level} H${r1(Math.max(...xs))}`, stroke: "ink", width: 1.2, fill: "none" });
      const inside = (p: Pt) => pool.every((a, i) => { const b = pool[(i + 1) % pool.length]; return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0; }) || pool.every((a, i) => { const b = pool[(i + 1) % pool.length]; return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0; });
      const grains: Pt[] = [];
      for (let gy = level + 8; gy < level + 80; gy += 9) for (let gx = lip.x - 140; gx < lip.x; gx += 11) { const p = { x: gx + ((gy / 9) % 2) * 5, y: gy }; if (inside(p)) grains.push(p); }
      dots(shapes, "mixture", grains.filter((_, i) => i % 2 === 0).slice(0, 18), 2.2, solid, "ink", 0.8);
    }
    const flare = { x: TR.x + (TR.x - TL.x) * 0.08, y: TR.y + (TR.y - TL.y) * 0.08 - 3 };
    shapes.push({ t: "path", part: "beaker", d: `M${r1(TL.x)} ${r1(TL.y)} L${r1(BL.x)} ${r1(BL.y)} L${r1(BR.x)} ${r1(BR.y)} L${r1(TR.x)} ${r1(TR.y)} Q${r1(TR.x + 2)} ${r1(TR.y - 1)} ${r1(flare.x)} ${r1(flare.y)}`, stroke: "ink", width: GLASS_W, fill: "none" });

    // Anchors: beaker, mixture, rod and flask (left wall) on the left; funnel, paper, residue, filtrate on the right.
    const mid = (a: Pt, b: Pt, t = 0.5): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const poolMid = pool.length >= 3 ? { x: pool.reduce((t, p) => t + p.x, 0) / pool.length, y: pool.reduce((t, p) => t + p.y, 0) / pool.length } : mid(BL, BR);
    const flaskY = base - 26;
    const parts: FigurePart[] = [
      { id: "beaker", name: "Beaker", anchor: mid(TL, BL, 0.4) },
      { id: "mixture", name: mixtureName, anchor: poolMid },
      { id: "glass-rod", name: "Glass rod", anchor: mid(rodTop, rodEnd, 0.05) },
      { id: "filter-funnel", name: "Filter funnel", anchor: { x: cx + half(176), y: 176 } },
      { id: "filter-paper", name: "Filter paper", anchor: { x: cx + ph(170) - 6, y: 170 } },
      { id: "residue", name: residueName, anchor: { x: cx + 9, y: 210 } },
      { id: "conical-flask", name: "Conical flask", anchor: { x: flask.wall(flaskY, -1), y: flaskY } },
      { id: "filtrate", name: filtrateName, anchor: { x: cx + 24, y: (fl + base) / 2 } },
    ];
    for (const p of parts) p.anchor = { x: r1(p.anchor.x), y: r1(p.anchor.y) };
    return { w: W, h: H, shapes, parts };
  },
};
