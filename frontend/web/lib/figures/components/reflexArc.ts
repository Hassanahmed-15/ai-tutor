import type { FigureComponent, FigurePart, FigureParams, FigureShape, Ink, Pt } from "../types";
import { arrowShapes, r2, smoothClosed, smoothOpen } from "./bioDraw";
import { thinLine } from "./nephron";

/**
 * THE REFLEX ARC, as the O Level textbooks draw it: a receptor in the skin, the sensory neurone
 * running to the spinal cord with its cell body in the dorsal root ganglion, a relay neurone in the
 * grey matter, and the motor neurone (cell body in the ventral horn) leaving by the ventral root
 * to the effector. The spinal cord is a transverse section — the butterfly of grey matter inside
 * the white matter, the central canal at its middle — and arrows beside the fibres give the
 * direction of the impulse, receptor to effector.
 */

const C = {
  sensory: "#2563eb" as Ink,
  relay: "#6d28d9" as Ink,
  motor: "#c2410c" as Ink,
  white: "#e2e8f0" as Ink,
  grey: "#94a3b8" as Ink,
  root: "#fef3c7" as Ink,
  skin: "#fde68a" as Ink,
  dermis: "#fef3c7" as Ink,
  muscle: "#fca5a5" as Ink,
  gland: "#bbf7d0" as Ink,
  stimulus: "#d97706" as Ink,
};

const W = 700, H = 440;
const pt = (x: number, y: number): Pt => ({ x, y });
/** The spinal cord section's centre and radii. */
const SC = pt(540, 214), RX = 150, RY = 126;
const onCord = (deg: number, k = 1): Pt => ({ x: SC.x + RX * k * Math.cos((deg * Math.PI) / 180), y: SC.y + RY * k * Math.sin((deg * Math.PI) / 180) });
/** Grey-matter coordinates (a unit butterfly) on the figure. */
const GK = 1.4;
const gm = (x: number, y: number): Pt => pt(SC.x + x * GK, SC.y + y * GK);

/** The butterfly of grey matter: thin dorsal horns (top), broad ventral horns (bottom). */
function greyMatter(): Pt[] {
  const half: Pt[] = [pt(0, -14), pt(-14, -22), pt(-28, -46), pt(-40, -66), pt(-52, -70), pt(-50, -54), pt(-40, -28), pt(-50, -6), pt(-72, 18), pt(-78, 44), pt(-64, 64), pt(-40, 60), pt(-20, 32), pt(0, 24)];
  const right = half.slice(1, -1).reverse().map((p) => pt(-p.x, p.y));
  return [...half, ...right].map((p) => gm(p.x, p.y));
}

/** A neurone's cell body: a soft round body with its nucleus. */
function cellBody(c: Pt, r: number, colour: Ink, part: string): FigureShape[] {
  return [
    { t: "circle", cx: c.x, cy: c.y, r, fill: "paper", stroke: colour, width: 2.4, part },
    { t: "circle", cx: c.x, cy: c.y, r: r * 0.36, fill: colour, stroke: "none", part },
  ];
}

export const reflexArc: FigureComponent = {
  name: "reflexArc",
  title: "A reflex arc: receptor, sensory neurone with its cell body in the dorsal root ganglion, relay neurone in the grey matter of the spinal cord, motor neurone and effector, with the direction of the impulse",
  params: `effector ("muscle" default | "gland"). arrows (true default: arrows beside the fibres showing the direction of the impulse).`,
  match: /\breflex arcs?\b|\b(relay|sensory|motor) neur(on|one)s?\b(?=[\s\S]{0,200}\b(relay|sensory|motor|spinal cord|reflex|effector|receptor)\b)|\bdorsal root( ganglion)?\b|\bventral root\b|\breflex (action|response)s?\b(?=[\s\S]{0,200}\b(neur\w*|spinal|receptor|effector|arc)\b)|\bspinal reflex\w*\b|\bknee[- ]jerk\b|\bwithdrawal reflex\b/i,
  parts: [
    { id: "receptor", name: "Receptor" },
    { id: "sensory-neurone", name: "Sensory neurone" },
    { id: "dorsal-root-ganglion", name: "Dorsal root ganglion" },
    { id: "relay-neurone", name: "Relay neurone" },
    { id: "motor-neurone", name: "Motor neurone" },
    { id: "effector", name: "Effector (muscle)" },
    { id: "grey-matter", name: "Grey matter" },
    { id: "white-matter", name: "White matter" },
    { id: "cell-body", name: "Cell body of sensory neurone" },
    { id: "synapse", name: "Synapse" },
    { id: "dorsal-root", name: "Dorsal root" },
    { id: "ventral-root", name: "Ventral root" },
    { id: "central-canal", name: "Central canal" },
    { id: "stimulus", name: "Stimulus" },
    { id: "skin", name: "Skin" },
    { id: "impulse", name: "Direction of impulse" },
  ],
  build(params: FigureParams) {
    const gland = /gland/i.test(String(params?.effector ?? ""));
    const arrowsOn = !/^(false|no|off|0|none|hide)$/i.test(String(params?.arrows ?? "true").trim());
    const s: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const nerve = (route: Pt[], colour: Ink, part: string, width = 2.6) => s.push(...thinLine(route, { stroke: colour, width, part }));

    // ── Spinal cord in transverse section. ──
    const roots: FigureShape[] = [];
    // Roots first (behind the cord): pale nerve sheaths the fibres run along.
    const dorsalEnd = onCord(-124), ventralEnd = onCord(146);
    const gang = pt(352, 112);
    const dorsalRoute = [pt(262, 112), gang, pt(410, 110), pt(dorsalEnd.x - 6, dorsalEnd.y - 2), pt(dorsalEnd.x + 8, dorsalEnd.y + 8)];
    const ventralRoute = [pt(ventralEnd.x + 8, ventralEnd.y - 6), pt(ventralEnd.x - 16, ventralEnd.y + 8), pt(340, 318), pt(262, 344)];
    for (const [route, part] of [[dorsalRoute, "dorsal-root"], [ventralRoute, "ventral-root"]] as const) {
      roots.push({ t: "path", d: smoothOpen(route), stroke: "ink", width: 22, fill: "none", part }, { t: "path", d: smoothOpen(route), stroke: C.root, width: 17.6, fill: "none", part });
    }
    // The ganglion: a swelling on the dorsal root.
    roots.push({ t: "path", d: smoothClosed([pt(gang.x - 44, gang.y), pt(gang.x - 22, gang.y - 30), pt(gang.x + 20, gang.y - 32), pt(gang.x + 46, gang.y - 2), pt(gang.x + 22, gang.y + 24), pt(gang.x - 22, gang.y + 22)]), fill: C.root, stroke: "ink", width: 2.2, part: "dorsal-root-ganglion" });
    s.push(...roots);
    parts.push({ id: "dorsal-root", name: "Dorsal root", anchor: pt(418, 110) }, { id: "ventral-root", name: "Ventral root", anchor: pt(352, 314) }, { id: "dorsal-root-ganglion", name: "Dorsal root ganglion", anchor: pt(gang.x + 28, gang.y + 10) });

    const cordPts = Array.from({ length: 36 }, (_, i) => onCord((i / 36) * 360));
    s.push({ t: "path", d: smoothClosed(cordPts), fill: C.white, stroke: "ink", width: 2.4, part: "white-matter" });
    // The dorsal median sulcus and ventral fissure.
    s.push({ t: "path", d: `M${SC.x} ${SC.y - RY} v22`, stroke: "ink", width: 1.8, fill: "none", part: "white-matter" });
    s.push({ t: "path", d: `M${SC.x - 6} ${SC.y + RY} L${SC.x} ${SC.y + RY - 24} L${SC.x + 6} ${SC.y + RY}`, stroke: "ink", width: 1.8, fill: "paper", part: "white-matter" });
    s.push({ t: "path", d: smoothClosed(greyMatter(), 0.9), fill: C.grey, stroke: "ink", width: 2, opacity: 0.85, part: "grey-matter" });
    const canal = gm(0, 5);
    s.push({ t: "circle", cx: canal.x, cy: canal.y, r: 6, fill: "paper", stroke: "ink", width: 1.8, part: "central-canal" });
    parts.push({ id: "white-matter", name: "White matter", anchor: onCord(-28, 0.86) }, { id: "grey-matter", name: "Grey matter", anchor: gm(56, 40) }, { id: "central-canal", name: "Central canal", anchor: canal });

    // ── A block of skin with the receptor in it, top left; the stimulus arrives from above. ──
    const skinTop = (x: number) => 60 + 4 * Math.sin(x / 26);
    const top = Array.from({ length: 12 }, (_, i) => pt(16 + i * 18, skinTop(16 + i * 18)));
    const epi = top.map((p) => pt(p.x, p.y + 16));
    s.push({ t: "path", d: `${smoothOpen(top)} L214 162 L16 162 Z`, fill: C.dermis, stroke: "ink", width: 2, part: "skin" });
    s.push({ t: "path", d: `${smoothOpen(top)} L${epi[epi.length - 1].x} ${epi[epi.length - 1].y} ${smoothOpen([...epi].reverse()).replace(/^M/, "L")} Z`, fill: C.skin, stroke: "ink", width: 1.6, part: "skin" });
    const R = pt(96, 118);
    // An encapsulated receptor: concentric layers round the nerve ending.
    for (const [rx, ry] of [[24, 14], [16, 9.5], [8, 5]] as const) {
      s.push({ t: "path", d: `M${R.x - rx} ${R.y} a${rx} ${ry} 0 1 0 ${2 * rx} 0 a${rx} ${ry} 0 1 0 ${-2 * rx} 0`, fill: rx === 24 ? "#dbeafe" : "none", stroke: C.sensory, width: rx === 24 ? 2.2 : 1.6, part: "receptor" });
    }
    parts.push({ id: "receptor", name: "Receptor", anchor: pt(R.x - 14, R.y) }, { id: "skin", name: "Skin", anchor: pt(40, 148) });
    s.push(...arrowShapes(pt(R.x, 6), pt(R.x, 52), C.stimulus, 3.2, "stimulus", { head: 14 }));
    parts.push({ id: "stimulus", name: "Stimulus", anchor: pt(R.x, 24) });

    // ── The sensory neurone: receptor → ganglion (cell body on a short stalk) → dorsal horn. ──
    const sensEnd = gm(-38, -48);
    const sensoryRoute = [pt(R.x + 24, R.y), pt(160, 116), pt(214, 113), pt(262, 112), pt(gang.x - 30, 112), pt(gang.x, 112), pt(410, 110), pt(dorsalEnd.x - 6, dorsalEnd.y - 2), pt(dorsalEnd.x + 8, dorsalEnd.y + 8), gm(-46, -64), sensEnd];
    nerve(sensoryRoute, C.sensory, "sensory-neurone", 3);
    nerve([pt(gang.x, 112), pt(gang.x, 100)], C.sensory, "cell-body", 3);
    s.push(...cellBody(pt(gang.x, 89), 12, C.sensory, "cell-body"));
    parts.push({ id: "sensory-neurone", name: "Sensory neurone", anchor: pt(240, 112) }, { id: "cell-body", name: "Cell body of sensory neurone", anchor: pt(gang.x, 89) });

    // ── The relay neurone, wholly in the grey matter, dorsal horn → ventral horn. ──
    const relayA = gm(-34, -44), relayBody = gm(-26, -8), relayB = gm(-44, 30);
    nerve([relayA, gm(-30, -26), relayBody], C.relay, "relay-neurone", 3);
    nerve([relayBody, gm(-34, 12), relayB], C.relay, "relay-neurone", 3);
    s.push(...cellBody(relayBody, 9, C.relay, "relay-neurone"));
    parts.push({ id: "relay-neurone", name: "Relay neurone", anchor: gm(-30, -26) });

    // ── The motor neurone: cell body in the ventral horn, axon out by the ventral root to the effector. ──
    const motorBody = gm(-58, 40);
    const eff = pt(118, 388);
    const endAt = pt(176, 342);
    const motorRoute = [motorBody, gm(-70, 46), pt(ventralEnd.x + 8, ventralEnd.y - 6), pt(ventralEnd.x - 16, ventralEnd.y + 8), pt(340, 318), pt(262, 344), pt(220, 340), endAt];
    nerve(motorRoute, C.motor, "motor-neurone", 3);
    for (const [dx, dy] of [[8, -10], [12, 4], [2, 12], [-4, -12]] as const) nerve([motorBody, gm(-58 + dx, 40 + dy)], C.motor, "motor-neurone", 2);
    s.push(...cellBody(motorBody, 11, C.motor, "motor-neurone"));
    parts.push({ id: "motor-neurone", name: "Motor neurone", anchor: pt(222, 340) });

    // Synapses: each fibre ends in a small knob with a gap before the next neurone.
    const syn1 = sensEnd, syn2 = gm(-48, 34);
    s.push({ t: "circle", cx: syn1.x, cy: syn1.y, r: 4.6, fill: C.sensory, stroke: "none", part: "synapse" });
    nerve([relayB, syn2], C.relay, "relay-neurone", 3);
    s.push({ t: "circle", cx: syn2.x, cy: syn2.y, r: 4.6, fill: C.relay, stroke: "none", part: "synapse" });
    parts.push({ id: "synapse", name: "Synapse", anchor: syn1 });

    // ── The effector: a muscle (motor end plates on its fibres) or a gland. ──
    if (gland) {
      const lobes = [pt(eff.x - 62, eff.y), pt(eff.x - 42, eff.y - 32), pt(eff.x - 6, eff.y - 38), pt(eff.x + 32, eff.y - 28), pt(eff.x + 54, eff.y), pt(eff.x + 32, eff.y + 32), pt(eff.x - 6, eff.y + 38), pt(eff.x - 44, eff.y + 30)];
      s.push({ t: "path", d: smoothClosed(lobes), fill: C.gland, stroke: "ink", width: 2.2, part: "effector" });
      for (const c of [pt(eff.x - 28, eff.y - 8), pt(eff.x + 2, eff.y - 16), pt(eff.x + 24, eff.y + 6), pt(eff.x - 10, eff.y + 18)]) s.push({ t: "circle", cx: c.x, cy: c.y, r: 10, fill: "none", stroke: "#16a34a", width: 1.8, part: "effector" });
      s.push({ t: "path", d: `M${eff.x - 4} ${eff.y + 38} C${eff.x - 4} ${eff.y + 52} ${eff.x - 20} ${eff.y + 58} ${eff.x - 34} ${eff.y + 62}`, stroke: "ink", width: 2.2, fill: "none", part: "effector" });
    } else {
      s.push({ t: "path", d: `M${eff.x - 104} ${eff.y} C${eff.x - 64} ${eff.y - 44} ${eff.x + 34} ${eff.y - 48} ${eff.x + 72} ${eff.y - 6} C${eff.x + 34} ${eff.y + 44} ${eff.x - 64} ${eff.y + 42} ${eff.x - 104} ${eff.y} Z`, fill: C.muscle, stroke: "ink", width: 2.2, part: "effector" });
      for (const k of [-16, 0, 16]) s.push({ t: "path", d: `M${eff.x - 76} ${eff.y + k * 0.5} C${eff.x - 44} ${eff.y + k * 1.4} ${eff.x + 20} ${eff.y + k * 1.4} ${eff.x + 52} ${eff.y + k * 0.4}`, stroke: "#be123c", width: 1.4, fill: "none", opacity: 0.6, part: "effector" });
    }
    // Motor end plates: the axon branches onto the effector.
    for (const tip of [pt(eff.x - 28, eff.y - 22), pt(eff.x + 2, eff.y - 18), pt(eff.x + 30, eff.y - 12)]) {
      nerve([endAt, pt((endAt.x + tip.x) / 2, (endAt.y + tip.y) / 2 + 2), tip], C.motor, "motor-neurone", 2.2);
      s.push({ t: "path", d: `M${r2(tip.x - 6)} ${r2(tip.y + 4)} L${r2(tip.x + 2)} ${r2(tip.y - 5)}`, stroke: C.motor, width: 3.6, fill: "none", part: "motor-neurone" });
    }
    parts.push({ id: "effector", name: gland ? "Effector (gland)" : "Effector (muscle)", anchor: pt(eff.x - 44, eff.y + 2) });

    // ── Impulse direction: arrows beside the fibres, receptor → effector. ──
    if (arrowsOn) {
      const arrows: Array<[Pt, Pt]> = [[pt(150, 96), pt(212, 94)], [pt(404, 92), pt(446, 98)], [gm(-14, -40), gm(-14, -10)], [gm(-12, 4), gm(-26, 30)], [pt(372, 340), pt(320, 356)], [pt(252, 324), pt(206, 322)]];
      for (const [a, b] of arrows) s.push(...arrowShapes(a, b, "ink", 2.2, "impulse", { head: 11 }));
      parts.push({ id: "impulse", name: "Direction of impulse", anchor: pt(346, 348) });
    }

    const order = reflexArc.parts.map((p) => p.id);
    parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { w: W, h: H, shapes: s, parts };
  },
};
