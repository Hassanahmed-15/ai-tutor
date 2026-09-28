/**
 * Connector ENDS and artwork PLACEMENT, measured in the coordinates the student sees.
 *
 * The dangling-connector check was broken twice, and both halves are fixed together or not at all
 * (lib/boardConnectorGeometry.ts, header): the contract's frame rect anchored every stroke on the
 * board, so an arrow into blank paper passed; and under it every vertex of every unfilled outline
 * was tested, so with the frame gone a correct leaf outline was told "delete this stroke". These
 * tests pin both directions on the exact shapes that exposed them: the frame from the drawing
 * contract, the leaf-outline probe, a real arrow to nothing, and a real arrow into a labelled part.
 *
 * The artwork half: <Asset/> fitted its PAGE (ignoring the viewBox origin) into the model's box, so
 * a leaf drawn small on an A4 sheet, or a flask whose viewBox starts at -120.5, missed the box the
 * leader dots were aimed into.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  CONNECTOR_RULES,
  classifyConnectors,
  connectorEndIssues,
  parseTransform,
  pathSubpaths,
  readBoardGeometry,
  strokeSegments,
  textBoxesInBoardSpace,
  type Box,
} from "../boardConnectorGeometry";
import { assetRuntimeFor, findAssets, loadAssets, unwrap, type AssetMeta, type LoadedAsset } from "../assetCatalogue";
import { appPath } from "../appPaths";

/**
 * Text boxes for these fixtures: 0.55 em per character, 0.9 em above the baseline and 0.31 below —
 * the contract's own arithmetic. The critic measures with real glyph widths; here the geometry is
 * under test, not the font.
 */
function measure(markup: string): Box[] {
  const open = /<text\b([^>]*)>([\s\S]*?)<\/text>/.exec(markup);
  if (!open) return [];
  const num = (name: string) => Number(new RegExp(`(?:^|\\s)${name}="([-\\d.]+)"`).exec(open[1])?.[1] ?? NaN);
  const size = num("font-size") || 20;
  const text = open[2].replace(/<[^>]*>/g, "");
  const w = text.length * 0.55 * size;
  const anchor = /text-anchor="(middle|end)"/.exec(open[1])?.[1];
  const x = anchor === "end" ? num("x") - w : anchor === "middle" ? num("x") - w / 2 : num("x");
  return [{ text, x, y: num("y") - 0.9 * size, w, h: 1.21 * size }];
}

function endIssues(svg: string): string[] {
  const geometry = readBoardGeometry(svg);
  return connectorEndIssues(geometry, textBoxesInBoardSpace(geometry, measure));
}

const board = (body: string) => `<svg viewBox="0 0 1000 560">${body}</svg>`;

/** The frame rect exactly as the drawing contract (lib/drawPrompt.ts, committed) told every board to draw it. */
const CONTRACT_FRAME = '<rect x="40" y="24" width="920" height="512" fill="none" stroke="#e2e2dc"></rect>';
/** The abstract contract's 54 px-margin frame, and the paper, as a rendered board actually drew them. */
const RENDERED_FRAME = '<rect x="0" y="0" width="1000" height="560" fill="#fbfbf8"></rect><rect x="54" y="30" width="892" height="500" fill="none" stroke="#d1d5db" stroke-width="2"></rect>';

const MARKER =
  '<defs><marker id="head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">' +
  '<path d="M0 0 L10 5 L0 10 z" fill="#0f766e"></path></marker></defs>';

/* ── the frame rect is not something to attach to ────────────────────────── */

test("THE FRAME: a stroke from a part into blank paper is caught although the contract's frame surrounds it", () => {
  // The scratchpad's dangling probe: two strokes leave a chloroplast and end on nothing.
  const body =
    '<text x="76" y="78" font-size="34">Photosynthesis</text>' +
    '<ellipse cx="560" cy="300" rx="40" ry="22" fill="#7cc36b" stroke="#2f6b2f"></ellipse>' +
    '<path d="M600 300 L760 200" fill="none" stroke="#333"></path>';
  for (const frame of ["", CONTRACT_FRAME, RENDERED_FRAME]) {
    const issues = endIssues(board(frame + body));
    assert.equal(issues.length, 1, `frame ${JSON.stringify(frame.slice(0, 40))}: ${issues.join(" | ")}`);
    assert.match(issues[0], /ends in empty space at 760,200/);
  }
  const parts = readBoardGeometry(board(CONTRACT_FRAME + body)).parts;
  assert.equal(parts.some((p) => p.from === "rect"), false, "the 920x512 frame covers 84% of the board and is no part");
});

test("a rect that is a real part still anchors, however it is filled", () => {
  const svg = board(
    CONTRACT_FRAME +
      '<rect x="80" y="80" width="60" height="40" fill="none" stroke="#333"></rect>' +
      '<line x1="110" y1="100" x2="260" y2="100" stroke="#333"></line><text x="268" y="106" font-size="20">tank</text>',
  );
  assert.deepEqual(endIssues(svg), []);
});

/* ── the leaf outline is drawing, not a connector ────────────────────────── */

/** The exact leaf-outline probe (scratchpad dangling-probe.mjs): a correct, faithful, labelled leaf. */
const LEAF_PROBE =
  '<path d="M420 300 C 460 200, 600 180, 680 300 C 600 420, 460 400, 420 300" fill="none" stroke="#2f6b2f"/>' +
  '<path d="M430 300 L 520 290 L 600 300 L 670 300" fill="none" stroke="#2f6b2f"/>' +
  '<ellipse cx="560" cy="330" rx="22" ry="12" fill="#7cc36b"/>' +
  '<line x1="582" y1="330" x2="740" y2="330" stroke="#8a91a3"/>';
const LEAF_LABEL: Box = { text: "chloroplast", x: 748, y: 319, w: 0.62 * 22 * 11, h: 1.35 * 22 };

test("THE LEAF PROBE: a correct leaf outline passes with the frame AND without it", () => {
  for (const frame of [CONTRACT_FRAME, ""]) {
    const geometry = readBoardGeometry(board(frame + LEAF_PROBE));
    assert.deepEqual(connectorEndIssues(geometry, [LEAF_LABEL]), [], frame ? "with the frame" : "without the frame");
  }
});

test("only the leader is a connector; the outline and the vein are drawing", () => {
  const connectors = classifyConnectors(readBoardGeometry(board(LEAF_PROBE)));
  assert.equal(connectors.length, 1);
  assert.deepEqual([connectors[0].x1, connectors[0].y1, connectors[0].x2, connectors[0].y2], [582, 330, 740, 330]);
});

test("the outline's bounds include its bulge, which its on-curve points never reach", () => {
  // Every on-curve point of this outline lies on y=300; only points ON the curves span its height.
  const outline = readBoardGeometry(board(LEAF_PROBE)).parts.find((p) => p.from === "path");
  assert.ok(outline && outline.shape === "box");
  assert.ok(outline.y < 245 && outline.y + outline.h > 355, `outline spans y ${outline.y}..${outline.y + outline.h}`);
});

test("a vein that starts inside the leaf is attached even on a board with no timeline kinds", () => {
  const svg = board(LEAF_PROBE + '<path d="M470 300 Q 520 270 560 250" fill="none" stroke="#2f6b2f"></path>');
  assert.deepEqual(connectorEndIssues(readBoardGeometry(svg), [LEAF_LABEL]), []);
});

/* ── a real arrow to nothing fails; a real arrow into a labelled part passes ── */

const AIR_IN = '<text x="290" y="150" font-size="20" text-anchor="end">air in</text>';
const TRACHEA =
  '<g data-teach-order="6" data-teach-kind="diagram"><rect x="487" y="150" width="26" height="104" rx="11" fill="#dcebf8" stroke="#3f7cc0"></rect></g>' +
  '<g data-teach-order="7" data-teach-kind="label"><line x1="702" y1="166" x2="508" y2="166" stroke="#7b8496"></line><circle cx="508" cy="166" r="4" fill="#1b2440"></circle></g>' +
  '<text x="710" y="172" font-size="20">trachea</text>';

test("A REAL ARROW INTO A LABELLED PART PASSES: the contract's own 'air in' arrow and trachea leader", () => {
  const svg = board(
    MARKER +
      CONTRACT_FRAME +
      AIR_IN +
      TRACHEA +
      '<path d="M298 144 C384 126 462 118 496 144" fill="none" stroke="#0f766e" stroke-width="3" marker-end="url(#head)" data-teach-order="14" data-teach-kind="arrow"></path>',
  );
  assert.deepEqual(endIssues(svg), []);
  const roles = classifyConnectors(readBoardGeometry(svg)).map((c) => `${c.role}:${c.start.kind}-${c.end.kind}`);
  assert.deepEqual(roles.sort(), ["arrow:tail-head", "leader:tail-dot"]);
});

test("A REAL ARROW TO NOTHING FAILS: 'CO2 + water' pointing at the border, frame or no frame", () => {
  const arrow =
    '<text x="290" y="150" font-size="20" text-anchor="end">CO2 + water</text>' +
    '<path d="M298 144 C420 140 560 110 900 40" fill="none" stroke="#0f766e" stroke-width="3" marker-end="url(#head)" data-teach-order="14" data-teach-kind="arrow"></path>';
  for (const frame of [CONTRACT_FRAME, ""]) {
    const issues = endIssues(board(MARKER + frame + TRACHEA + arrow));
    assert.equal(issues.length, 1, issues.join(" | "));
    assert.match(issues[0], /an arrow's head points at nothing: it ends at 900,40/);
    assert.match(issues[0], /never at blank paper or the board edge/);
  }
});

test("an arrowhead must end within ~20 px of its part, not merely near it", () => {
  const at = (y: number) =>
    board(MARKER + AIR_IN + TRACHEA + `<path d="M298 144 L500 ${y}" fill="none" stroke="#0f766e" marker-end="url(#head)" data-teach-kind="arrow" data-teach-order="14"></path>`);
  assert.deepEqual(endIssues(at(144)), [], "6 px above the trachea");
  assert.equal(endIssues(at(150 - CONNECTOR_RULES.HEAD_TOLERANCE - 8)).length, 1, "28 px above it");
});

test("a leader whose dot sits in blank paper is named as such", () => {
  const svg = board(
    '<g data-teach-order="6" data-teach-kind="diagram"><rect x="487" y="150" width="26" height="104" fill="#dcebf8" stroke="#3f7cc0"></rect></g>' +
      '<g data-teach-order="7" data-teach-kind="label"><line x1="702" y1="166" x2="560" y2="166" stroke="#7b8496"></line><circle cx="560" cy="166" r="4" fill="#1b2440"></circle></g>' +
      '<text x="710" y="172" font-size="20">trachea</text>',
  );
  const issues = endIssues(svg);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /leader dot sits in empty space at 560,166/);
  assert.match(issues[0], /must sit inside the drawn part/);
});

test("the head marker template in <defs> is never read as a head on the board", () => {
  // Its triangle is drawn at 0..10 in marker units; read in place it was an arrowhead at 5,5.
  assert.equal(readBoardGeometry(board(MARKER)).arrowheads.length, 0);
  assert.equal(readBoardGeometry(board(MARKER)).pieces.length, 0);
});

/* ── hand-drawn heads, axes ──────────────────────────────────────────────── */

test("a head drawn as two barbs makes the stroke an arrow, and its tip is tested", () => {
  // As a generated BST board drew it, inside an "annotate" step.
  const arrow = (nodeX: number) =>
    board(
      '<g data-teach-order="9" data-teach-kind="annotate"><text x="74" y="452" font-size="20">Next in sorted order</text>' +
        '<path d="M300 445 C390 420 500 420 590 445" fill="none" stroke="#be185d" stroke-width="3"></path>' +
        '<path d="M590 445 l-12 -8 M590 445 l-4 -14" fill="none" stroke="#be185d" stroke-width="3"></path></g>' +
        `<circle cx="${nodeX}" cy="468" r="16" fill="#fde68a" stroke="#d97706"></circle>`,
    );
  const connectors = classifyConnectors(readBoardGeometry(arrow(600)));
  assert.equal(connectors.length, 1);
  assert.equal(connectors[0].end.kind, "head");
  assert.deepEqual(endIssues(arrow(600)), [], "the head ends beside the 60 node");
  assert.match(endIssues(arrow(760)).join(" "), /head points at nothing/, "with the node moved away");
});

test("a graph's arrowed axes point at no part and are not accused", () => {
  const axes =
    MARKER +
    '<g data-teach-order="3" data-teach-kind="diagram">' +
    '<path d="M112 358 L604 358" fill="none" stroke="#333" marker-end="url(#head)"></path>' +
    '<path d="M126 358 L126 176" fill="none" stroke="#333" marker-end="url(#head)"></path>' +
    '<path d="M126 330 C200 200 300 180 420 250" fill="none" stroke="#2563eb"></path></g>' +
    '<text x="60" y="160" font-size="20">f(x)</text>';
  assert.deepEqual(endIssues(board(axes)), []);
  // A lone arrow of the same length with no partner axis is a relation arrow again.
  const lone = MARKER + '<ellipse cx="200" cy="200" rx="30" ry="30" fill="#ccc"></ellipse>' + '<path d="M112 358 L604 358" fill="none" stroke="#333" marker-end="url(#head)" data-teach-kind="arrow" data-teach-order="4"></path>';
  assert.equal(endIssues(board(lone)).length, 2, "tail and head both touch nothing");
});

test("a labelled vector leaving its part is not an arrow to nothing; the same arrow unlabelled is", () => {
  // A force on a ball: the tail sits on the ball, the head points into open space by design, and
  // the words beside its body name it. "Delete the arrow" would delete correct physics.
  const force = (label: string) =>
    board(
      MARKER +
        '<g data-teach-order="3" data-teach-kind="diagram"><circle cx="400" cy="200" r="40" fill="#93c5fd" stroke="#1d4ed8"></circle></g>' +
        '<path d="M400 240 L400 380" fill="none" stroke="#b91c1c" stroke-width="3" marker-end="url(#head)" data-teach-order="4" data-teach-kind="arrow"></path>' +
        label,
    );
  assert.deepEqual(endIssues(force('<text x="412" y="330" font-size="20">weight</text>')), [], "labelled beside its body");
  assert.match(endIssues(force("")).join(" "), /head points at nothing/, "no words: it names nothing");
  // Starting from its own words is not leaving a part: the "CO2 + water" case stays a fault.
  const fromWords = board(
    MARKER +
      '<text x="290" y="150" font-size="20" text-anchor="end">CO2 + water</text>' +
      '<path d="M298 144 L700 144" fill="none" stroke="#0f766e" marker-end="url(#head)" data-teach-order="4" data-teach-kind="arrow"></path>' +
      '<text x="480" y="130" font-size="20">enters</text>',
  );
  assert.match(endIssues(fromWords).join(" "), /head points at nothing/);
});

/* ── the frame the student sees: transforms, subpaths, artwork ───────────── */

test("a part drawn inside a translated group is where the student sees it", () => {
  const svg = board(
    '<g transform="translate(600 300)" data-teach-order="3" data-teach-kind="diagram"><ellipse cx="0" cy="0" rx="40" ry="30" fill="#cde"></ellipse></g>' +
      '<g data-teach-order="4" data-teach-kind="label"><line x1="720" y1="300" x2="620" y2="300" stroke="#777"></line><circle cx="620" cy="300" r="4" fill="#111"></circle></g>' +
      '<text x="728" y="306" font-size="20">vacuole</text>',
  );
  assert.deepEqual(endIssues(svg), []);
  const ellipse = readBoardGeometry(svg).parts.find((p) => p.from === "ellipse" && p.shape === "ellipse" && p.rx === 40);
  assert.ok(ellipse && ellipse.shape === "ellipse" && ellipse.cx === 600 && ellipse.cy === 300);
});

test("transforms compose like SVG's: translate, scale, rotate about a point, CSS units", () => {
  const apply = (m: number[] | null, x: number, y: number) => (m ? [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]].map((v) => Math.round(v * 1000) / 1000) : null);
  assert.deepEqual(apply(parseTransform("translate(500 320) scale(2) translate(-500 -320)"), 510, 330), [520, 340]);
  assert.deepEqual(apply(parseTransform("rotate(90 100 100)"), 200, 100), [100, 200]);
  assert.deepEqual(apply(parseTransform("translate(10px, 20px) scale(1.5)"), 2, 2), [13, 23]);
  assert.equal(parseTransform("translate(50%, 0)"), null, "unreadable means unknown, not identity");
});

test("a rotated axis title is measured as the tall box it draws", () => {
  const geometry = readBoardGeometry(board('<text x="80" y="300" font-size="20" transform="rotate(-90 80 300)">rate of reaction</text>'));
  const [box] = textBoxesInBoardSpace(geometry, measure);
  assert.ok(box.h > box.w * 4, `rotated box is ${Math.round(box.w)} wide, ${Math.round(box.h)} tall`);
});

test("a path's subpaths never join: no phantom segment across the drawing", () => {
  // The prompt's own worked example drew its fissures as one path of three runs; joining their ends
  // invented a stroke from 473,320 to 338,420 that ended "in empty space".
  const d = "M343 314 C384 308 432 312 473 320 M338 420 C376 376 428 346 472 334 M662 336 C624 356 590 384 566 404";
  assert.equal(pathSubpaths(d).length, 3);
  const segments = strokeSegments(readBoardGeometry(board(`<path d="${d}" fill="none" stroke="#c2544d"></path>`)));
  assert.equal(segments.some((s) => s.x1 === 473 && s.y1 === 320 && s.x2 === 338), false);
});

test("arc flags written without separators parse, and arcs are sampled on the curve", () => {
  const [sub] = pathSubpaths("M100 200 a50 50 0 01100 0");
  assert.deepEqual(sub.points[sub.points.length - 1], [200, 200]);
  const top = Math.min(...sub.samples.map(([, y]) => y));
  assert.ok(Math.abs(top - 150) < 3, `the half circle rises to y=${top}`);
});

test("catalogue artwork is one part, known by the box <Asset/> reports; its inner paths are not read", () => {
  const svg = board(
    '<g data-teach-order="3" data-teach-kind="diagram"><g transform="translate(400,130) scale(2)" data-asset="cell" data-asset-box="400 130 300 360">' +
      '<path d="M0 0 L10 10 L20 0" fill="none" stroke="#000"></path><path d="M5 5 L100 5" fill="none" stroke="#000"></path></g></g>' +
      '<g data-teach-order="4" data-teach-kind="label"><line x1="780" y1="300" x2="640" y2="300" stroke="#777"></line><circle cx="640" cy="300" r="4" fill="#000"></circle></g>' +
      '<text x="788" y="306" font-size="20">nucleus</text>',
  );
  const geometry = readBoardGeometry(svg);
  assert.deepEqual(
    geometry.parts.filter((p) => p.from === "asset").map((p) => (p.shape === "box" ? [p.x, p.y, p.w, p.h] : [])),
    [[400, 130, 300, 360]],
  );
  assert.equal(geometry.pieces.filter((p) => p.from === "path").length, 0, "no artwork strokes in artwork coordinates");
  assert.deepEqual(endIssues(svg), []);
});

test("hidden elements are not parts: an opacity-0 part attaches nothing", () => {
  const svg = (opacity: string) =>
    board(
      `<ellipse cx="560" cy="300" rx="40" ry="22" fill="#7cc36b" opacity="${opacity}"></ellipse>` +
        '<g data-teach-order="4" data-teach-kind="label"><line x1="720" y1="300" x2="560" y2="300" stroke="#777"></line></g>' +
        '<text x="728" y="306" font-size="20">chloroplast</text>',
    );
  assert.deepEqual(endIssues(svg("1")), []);
  assert.equal(endIssues(svg("0")).length, 1);
});

/* ── through the critic: the rendered frame, as layoutIssues sees it ─────── */

/**
 * The contract's worked-example figure (lib/drawPrompt.ts), trimmed to what the connector checks
 * read: closed cubic lungs under a progress transform, fissures drawn as one multi-run path, a
 * trachea, leader+dot groups and their labels, and the "air in" arrow with a marker head.
 */
function lungsBoard(airInEnd: string): string {
  return `export default function Animation({ progress }) {
  const breath = phase(progress, 0.6, 1);
  const swell = 1 + 0.025 * thereAndBack(breath);
  return (
    <svg viewBox="0 0 1000 560" style={{ background: "#fbfbf8" }}>
      <defs>
        <marker id="airHead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" fill="#0f766e" />
        </marker>
      </defs>
      <text x="56" y="70" fontSize="32" fontWeight="800" data-teach-order="1" data-teach-kind="write" data-teach-weight="2" data-teach-sentence="0">The Respiratory System</text>
      <g transform={"translate(500 320) scale(" + swell + ") translate(-500 -320)"} data-teach-order="3" data-teach-kind="diagram" data-teach-weight="3" data-teach-sentence="1">
        <path d="M446 178 C404 176 360 236 342 312 C326 382 322 440 332 470 C366 450 424 446 474 462 C482 410 480 346 474 318 C469 296 478 264 476 226 C474 196 464 180 446 178 Z" fill="#f3b7ae" stroke="#c2544d" strokeWidth="2.5" />
        <path d="M554 178 C596 176 640 236 658 312 C674 382 678 440 668 470 C636 452 588 448 540 460 C540 436 556 420 566 404 C548 390 528 358 526 318 C531 296 522 264 524 226 C526 196 536 180 554 178 Z" fill="#f3b7ae" stroke="#c2544d" strokeWidth="2.5" />
        <path d="M343 314 C384 308 432 312 473 320 M338 420 C376 376 428 346 472 334 M662 336 C624 356 590 384 566 404" fill="none" stroke="#c2544d" strokeWidth="1.5" opacity="0.7" />
      </g>
      <g data-teach-order="6" data-teach-kind="diagram" data-teach-weight="2" data-teach-sentence="2">
        <rect x="487" y="150" width="26" height="104" rx="11" fill="#dcebf8" stroke="#3f7cc0" strokeWidth="2.5" />
      </g>
      <g data-teach-order="4" data-teach-kind="label" data-teach-weight="1" data-teach-sentence="1">
        <line x1="298" y1="352" x2="384" y2="352" stroke="#7b8496" strokeWidth="1.25" />
        <circle cx="384" cy="352" r="4" fill="#1b2440" />
      </g>
      <text x="290" y="358" fontSize="20" textAnchor="end" data-teach-order="5" data-teach-kind="label" data-teach-weight="1" data-teach-sentence="1">right lung</text>
      <g data-teach-order="7" data-teach-kind="label" data-teach-weight="1" data-teach-sentence="2">
        <line x1="702" y1="166" x2="508" y2="166" stroke="#7b8496" strokeWidth="1.25" />
        <circle cx="508" cy="166" r="4" fill="#1b2440" />
      </g>
      <text x="710" y="172" fontSize="20" data-teach-order="8" data-teach-kind="label" data-teach-weight="1" data-teach-sentence="2">trachea</text>
      <text x="290" y="150" fontSize="20" textAnchor="end" data-teach-order="13" data-teach-kind="label" data-teach-weight="1" data-teach-sentence="4">air in</text>
      <path d="M298 144 C384 126 462 118 ${airInEnd}" fill="none" stroke="#0f766e" strokeWidth="3" markerEnd="url(#airHead)" data-teach-order="14" data-teach-kind="arrow" data-teach-weight="2" data-teach-sentence="4" />
    </svg>
  );
}`;
}

test("THROUGH THE CRITIC: the contract's figure has no connector fault; the same arrow into blank paper has one", async () => {
  const { renderStaticFrame, layoutIssues } = await import("../reactAnimationVisionCritic");
  const connectorFaults = async (code: string) => {
    const frame = await renderStaticFrame(code);
    assert.ok(frame.svg, `render failed: ${frame.failure?.message}`);
    return layoutIssues(frame.svg).filter((issue) => /connector|arrow|leader/.test(issue));
  };
  assert.deepEqual(await connectorFaults(lungsBoard("496 144")), []);
  const faults = await connectorFaults(lungsBoard("880 60"));
  assert.equal(faults.length, 1, faults.join(" | "));
  assert.match(faults[0], /an arrow's head points at nothing: it ends at 880,60/);
});

/* ── <Asset/>: the drawn extent, with its origin, fitted into the model's box ── */

function runAsset(asset: LoadedAsset, props: Record<string, unknown>) {
  const createElement = (type: string, elementProps: Record<string, unknown>) => ({ type, props: elementProps });
  const Asset = new Function("React", `${assetRuntimeFor([asset])}\nreturn Asset;`)({ createElement }) as (p: Record<string, unknown>) => {
    props: Record<string, unknown>;
  };
  return Asset(props);
}

const meta = (id: string): AssetMeta => ({ id, name: id, category: "", author: "", licence: "cc-0", keywords: [] });

test("THE ORIGIN: a viewBox starting at -120.5,-155.3 lands inside the box, not 120 units right of it", () => {
  const parsed = unwrap('<svg viewBox="-120.5 -155.3 880.8 532.8"><path d="M0 0"/></svg>');
  assert.ok(parsed);
  assert.deepEqual([parsed.x, parsed.y, parsed.w, parsed.h], [-120.5, -155.3, 880.8, 532.8]);

  const element = runAsset({ ...meta("flask"), ...parsed }, { name: "flask", x: 380, y: 130, w: 320, h: 360 });
  const m = parseTransform(String(element.props.transform));
  assert.ok(m);
  const s = Math.min(320 / 880.8, 360 / 532.8);
  // The page's top-left corner maps onto the fitted box's top-left corner.
  const [x0, y0] = [m[0] * -120.5 + m[4], m[3] * -155.3 + m[5]];
  assert.ok(Math.abs(x0 - 380) < 0.05, `left edge at ${x0}`);
  assert.ok(Math.abs(y0 - (130 + (360 - 532.8 * s) / 2)) < 0.05, `top edge at ${y0}`);
  const box = String(element.props["data-asset-box"]).split(" ").map(Number);
  assert.ok(Math.abs(box[0] - 380) < 0.05 && Math.abs(box[2] - 320) < 0.05, `reported box ${box.join(" ")}`);
});

test("the runtime fits the MEASURED drawing, and survives string props", () => {
  // leaf.svg's shape: a 53x22 drawing on a 210x297 page. Fitted by its page, a 320x360 box drew it
  // 80 px wide; fitted by its drawing, it fills the box's width.
  const leaf: LoadedAsset = { ...meta("leafish"), body: "<path/>", x: 69.9, y: 48.1, w: 52.8, h: 22 };
  const element = runAsset(leaf, { name: "leafish", x: "380", y: "130", w: "320", h: "360" });
  const box = String(element.props["data-asset-box"]).split(" ").map(Number);
  assert.ok(Math.abs(box[0] - 380) < 0.05 && Math.abs(box[2] - 320) < 0.05, `drawn box ${box.join(" ")}`);
  assert.ok(Math.abs(box[1] + box[3] / 2 - 310) < 0.05, "centred vertically in the box");
  assert.match(String(element.props.transform), /^translate\(-?[\d.]+,-?[\d.]+\) scale\([\d.]+\)$/, "numbers, not concatenated strings");
});

test("loadAssets uses the catalogue's measured box; a dropped asset still loads for saved lectures", async () => {
  const index = JSON.parse(readFileSync(appPath("assets", "index.json"), "utf8")) as AssetMeta[];
  assert.ok(index.length > 600);
  for (const entry of index) {
    assert.ok(entry.bbox && entry.bbox.length === 4 && entry.bbox.every(Number.isFinite) && entry.bbox[2] > 0 && entry.bbox[3] > 0, `${entry.id} has no measured box`);
  }
  const flask = index.find((a) => a.id === "1000-ml-erlenmeyer-flask");
  assert.ok(flask?.bbox);
  const [loaded] = await loadAssets([meta(flask.id)]);
  assert.deepEqual([loaded.x, loaded.y, loaded.w, loaded.h], flask.bbox, "bare ids (the asset route) get the measured box");

  // leaf.svg fills 1.9% of its page: never offered again, but a lecture that already names it renders.
  assert.equal(index.some((a) => a.id === "leaf"), false);
  assert.equal((await findAssets("a leaf with its veins")).some((a) => a.id === "leaf"), false);
  const [leaf] = await loadAssets([meta("leaf")]);
  assert.deepEqual([leaf.x, leaf.y, leaf.w, leaf.h], [0, 0, 210, 297], "falls back to its page");
});
