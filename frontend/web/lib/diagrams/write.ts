import "server-only";

import { createHash } from "node:crypto";
import type OpenAI from "openai";
import { loadSharedDiagramRecord, saveSharedDiagramRecord } from "../canvas/store";
import type { FigureDrawing } from "../figures/types";
import { costFor } from "../modelPricing";
import { diagramIssues } from "./check";
import { compileDiagram } from "./grammar";
import { diagramPng } from "./render";

/**
 * VECTOR DIAGRAMS FOR ANY BOARD, WRITTEN, CHECKED AND REMEMBERED.
 *
 *   1. remembered: a diagram of the same board that passed before is compiled again from its stored
 *      description (no model call);
 *   2. written: a dedicated writer describes the textbook diagram in the diagram grammar
 *      (lib/diagrams/grammar.ts) — real coastlines, plotted data, exact counts, stacked layers;
 *   3. checked by code (lib/diagrams/check.ts): required parts, counts, no invented numbers;
 *   4. drawn as the student will see it, labels and all (lib/diagrams/render.ts), and checked by a
 *      vision model acting as a textbook editor;
 *   5. one repair with what failed; a diagram that still fails is not shown — the board is taught
 *      without one, which is better than a wrong one.
 */

const WRITER_MODEL = process.env.CANVAS_DIAGRAM_MODEL ?? process.env.CANVAS_SPEC_MODEL ?? "gpt-5.6-luna";
const CHECK_MODEL = process.env.ILLUSTRATION_LOCATE_MODEL ?? "gpt-5.6-luna";
export const DIAGRAM_STYLE_VERSION = "vector-1";

export const DIAGRAM_GUIDE = `You draw ONE textbook diagram for one board of a school lesson, in a JSON diagram grammar that code renders exactly. Return JSON only: {"diagram": {"w": 640, "h": 400, "elements": [...], "parts": [...]}} — or {"diagram": null, "why": "..."} when no diagram would teach this board better than words (an argument, a definition, an evaluation).

CHOOSE THE VIEW A TEXTBOOK USES for this idea:
- a place, a pattern over the Earth (ocean currents, winds, climate zones, plate boundaries, the ITCZ, a trade route): a "world" map with "geoArrow"s, "band"s and "geoPoint"s — the coastlines are real; you give longitudes and latitudes (east and north positive);
- a relationship or data (how one thing changes with another, a table of values, shares of a total): a "plot";
- a cross-section (soil, rock strata, the atmosphere, a leaf, skin, a tissue): "layers", with details on top;
- an exact number of things (23 pairs, 8 electrons, 4 chambers): "repeat" — the count must be exact;
- a structure, an organ, an apparatus, a force diagram, a circuit, a cycle of real places: shapes.

ELEMENTS (x right, y down, on the w×h canvas, w 200-900, h 150-640):
- {"t": "world", "lon": [min, max], "lat": [min, max], "x", "y", "w", "h", "latitudes": [0, 30, -30, …], "part"?} — a map window; keep its w/h near (lon span)/(lat span) so land is not stretched. Draw it first.
- {"t": "geoArrow", "points": [[lon, lat], …] (2-12, in order of flow), "color": "red"|"blue"|…, "width" 2-5, "dash"?, "part"} — a current, wind or movement along real coordinates; the head is at the last point. Convention: warm currents red, cold currents blue.
- {"t": "band", "lat": [south, north], "fill": yellow|…, "part"} — a latitude belt (the tropics, a climate zone, the ITCZ).
- {"t": "geoPoint", "lon", "lat", "color", "part"} — a city, a volcano, an epicentre.
- {"t": "plot", "x", "y", "w", "h" (the axes box; leave 60 left and 44 below for ticks and titles), "xAxis": {"label", "min", "max", "step"} or {"label", "categories": [...]} for bars, "yAxis": {"label", "min", "max", "step"}, "series": [{"kind": "line"|"points"|"area", "points": [[x, y], …], "color", "part"} | {"kind": "bars", "values": [one per category], "color", "part"}]} — code draws the axes, ticks and gridlines. Plot the lesson's OWN numbers; when it gives none, show the shape of the relationship with round values.
  A plot's "intersections": [{"of": [partA, partB], "part", "xPart", "yPart"}] — code finds where two line series cross (an equilibrium, a break-even point) and draws dashed guides to both axes; name the crossing and its axis readings (P2, Q2) as parts there. Never draw guide lines yourself.
- {"t": "loop", "x", "y", "w", "h", "direction": "clockwise"|"anticlockwise", "color", "part"} — a circulation loop with arrowheads: a Hadley/Ferrel/polar cell, a convection current, a sea breeze. Draw a cell model as adjacent loops turning the right way, with the ground as a line and "H"/"L" texts where air sinks and rises.
- {"t": "circulation", "x", "y", "w", "h", "stops": [{"label": "90°N", "flow": "sink"|"rise", "at"?: 0-1}, …] (left to right), "cells": [{"part", "color"}, …] (one per gap between stops), "pressure": true} — convection or circulation cells (the three-cell model, a sea breeze, convection currents): say only where air rises and sinks; code turns every cell the right way and writes L/H at the ground. Use this — never loops or arrows — for any circulation model.
- {"t": "rays", "angle" (direction of travel: 0 right, 90 down), "length", "hits": [[x, y], …] (where each ray lands, on the surface you drew), "color", "part", "reflect"?: {"angle", "length", "part"}} — parallel rays (sunlight, light on a surface) that end exactly on their hit points; reflections leave from them.
- {"t": "beam", "from": [x, y], "at": [x, y], "groups": [{"count", "turn" (0 straight on … 180 straight back), "part", "color"}, …], "spread"} — particles fired at a target, in the lesson's proportions (most → the largest count): alpha scattering, a beam through a slit.
- {"t": "layers", "x", "y", "w", "layers": [{"h", "fill", "texture": "dots"|"lines"|"none", "part"}, …] (top first), "wavy": true|false}.
- {"t": "repeat", "count", "shape": <one shape>, "dx", "dy", "cols", "part"} — copies laid out in rows of "cols", dx apart, rows dy apart.
- shapes: {"t": "rect", "x", "y", "w", "h", "rx"} | {"t": "ellipse", "cx", "cy", "rx", "ry"} | {"t": "circle", "cx", "cy", "r"} | {"t": "line"|"arrow", "x1", "y1", "x2", "y2"} | {"t": "polyline"|"polygon", "points": [[x, y], …]} | {"t": "curve", "points": [[x, y], …], "closed"} (a smooth outline — cells, organs, rivers, landforms) | {"t": "text", "x", "y", "text"} (≤12 characters: a sign, a symbol or a value the narration states — "+", "N", "H₂O", "30°C" — never a part's name; at most 10).
  Style on shapes: "fill": blue|green|red|yellow|orange|purple|pink|cyan|brown|grey|sand|sky|white|none, "stroke": ink|muted|none|red|blue|green|orange|purple|brown, "width" 1-4, "dash": true, "part".

PARTS — what the labels point at: 2-8 {"id", "name", "anchor"?: {"x", "y"}, "at"?: [lon, lat]}. Every part's elements carry "part": its id; code puts the label's dot on the part (give "anchor" only to choose the exact point ON the part; on a map, name a region with "at"). Names use the narration's own words, at most 34 characters. Labels are written by code beside the diagram — never write a name into the art.

RULES: parallel things are drawn parallel (the Sun's rays: "repeat" one arrow); a lining faces the space it lines (cilia point into the lumen); flows point from where they start to where they end; draw the standard textbook view, correct in every position and direction a teacher would check (which way each arrow points, which layer is on top, where each place is); fill most of the canvas; every number written or plotted is one the lesson states (axis scales excepted); show every required part; keep it uncluttered — only what this board teaches.`;

const CHECK_PROMPT = (title: string, narration: string, mustShow: string[]) => `You are a strict school-textbook editor checking ONE diagram before a student sees it. The board is "${title}". What the teacher says on this board:
${narration}
${mustShow.length ? `It must show: ${mustShow.join("; ")}.\n` : ""}First, privately, describe what is drawn: for each labelled part, where its label's dot lands and what that thing touches; which way every arrow points; which side of each layer faces what. Then compare that with the standard textbook diagram of this idea and with the narration.
Reject ("accurate": false) for anything a teacher would correct: a part in the wrong position or layer (cilia on the outside instead of facing the lumen); an arrow or flow pointing the wrong way; rays or forces that should be parallel but are not; a wrong count; a label whose dot lands on the wrong thing or on empty space; a misspelled label; a required part missing; data that contradicts the narration; a label overlapping another label; shapes so crude that the student could not recognise the thing. Places on a map are drawn from real coastlines: judge only what is drawn on them. Do not reject for being simple or for style.
Return JSON {"accurate": boolean, "problems": [each problem in a few words, saying exactly what to change]}.`;

export type VectorDiagramRequest = { title: string; brief?: string; narration: string; mustShow?: string[]; level?: string; topic?: string };
export type VectorDiagram = { drawing: FigureDrawing; raw: unknown; cached: boolean };
export type VectorDiagramResult = { diagram: VectorDiagram | null; costUsd: number; log: string };
type StoredDiagram = { key: string; raw: unknown; title: string; style: string; createdAt: string };

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
export function vectorDiagramKey(req: VectorDiagramRequest): string {
  const numbers = (req.narration.match(/\d+(?:\.\d+)?/g) ?? []).join(",");
  const signature = JSON.stringify({ style: DIAGRAM_STYLE_VERSION, title: norm(req.title), brief: norm(req.brief ?? ""), must: [...new Set((req.mustShow ?? []).map(norm))].sort(), numbers });
  return `asset-${createHash("sha256").update(signature).digest("hex").slice(0, 32)}`;
}

async function call(openai: OpenAI, model: string, messages: OpenAI.Chat.ChatCompletionMessageParam[], maxTokens: number, effort: "low" | "medium", ms: number): Promise<{ json: Record<string, unknown>; costUsd: number }> {
  const work = openai.chat.completions.create({ model, messages, response_format: { type: "json_object" }, max_completion_tokens: maxTokens, reasoning_effort: effort } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms); });
  const res = await Promise.race([work, limit]).finally(() => clearTimeout(timer));
  const costUsd = costFor(model, res.usage);
  try {
    return { json: JSON.parse(res.choices[0]?.message?.content ?? "{}") as Record<string, unknown>, costUsd };
  } catch {
    throw Object.assign(new Error("the diagram writer returned invalid JSON"), { costUsd });
  }
}

/** The textbook editor's verdict on the rendered diagram. */
async function checkRendered(openai: OpenAI, png: Buffer, req: VectorDiagramRequest): Promise<{ accurate: boolean; problems: string[]; costUsd: number }> {
  const { json, costUsd } = await call(openai, CHECK_MODEL, [{
    role: "user",
    content: [
      { type: "text", text: CHECK_PROMPT(req.title, req.narration.slice(0, 2500), req.mustShow ?? []) },
      { type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}` } },
    ],
  }], 5000, "medium", 45_000);
  const problems = Array.isArray(json.problems) ? json.problems.map((p) => String(p).slice(0, 200)).filter(Boolean).slice(0, 6) : [];
  return { accurate: json.accurate !== false, problems, costUsd };
}

/**
 * The pipeline. `share` stores and reuses verified diagrams across students (never for a student's
 * own document). Never throws: a diagram that cannot pass comes back null with the reason.
 */
export async function vectorDiagram(openai: OpenAI, req: VectorDiagramRequest, options: { share: boolean; timeLeft: () => number }): Promise<VectorDiagramResult> {
  const key = vectorDiagramKey(req);
  let costUsd = 0;
  if (options.share) {
    const record = await loadSharedDiagramRecord<StoredDiagram>(key).catch(() => null);
    const again = record?.style === DIAGRAM_STYLE_VERSION ? compileDiagram(record.raw) : undefined;
    if (again?.drawing) return { diagram: { drawing: again.drawing, raw: record!.raw, cached: true }, costUsd: 0, log: "verified diagram reused" };
  }
  const user = [
    req.topic ? `Lesson: ${req.topic}` : "",
    req.level ? `Level: ${req.level}` : "",
    `Board: ${req.title}`,
    req.brief ? `What it shows: ${req.brief}` : "",
    req.mustShow?.length ? `It must show, each as a named part: ${req.mustShow.join("; ")}` : "",
    `What the teacher says on this board:\n${req.narration}`,
  ].filter(Boolean).join("\n\n");
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: "system", content: DIAGRAM_GUIDE }, { role: "user", content: user }];
  let visionRounds = 0;
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1 && options.timeLeft() < 90_000) { last = `${last}; no time for another attempt`; break; }
    let raw: unknown;
    try {
      const written = await call(openai, WRITER_MODEL, messages, 12_000, "medium", Math.min(60_000, Math.max(20_000, options.timeLeft() - 70_000)));
      costUsd += written.costUsd;
      raw = written.json.diagram;
      if (raw === null) return { diagram: null, costUsd, log: `the writer judged no diagram helps: ${String(written.json.why ?? "").slice(0, 160)}` };
      messages.push({ role: "assistant", content: JSON.stringify(written.json) });
    } catch (error) {
      costUsd += (error as { costUsd?: number }).costUsd ?? 0;
      last = (error as Error).message;
      continue;
    }
    const compiled = compileDiagram(raw);
    const issues = compiled.drawing ? diagramIssues(compiled, { narration: req.narration, brief: req.brief, mustShow: req.mustShow }) : compiled.issues;
    if (issues.length || !compiled.drawing) {
      last = issues.join("; ");
      messages.push({ role: "user", content: `That diagram cannot be used yet: ${last}. Return the whole corrected diagram.` });
      continue;
    }
    const png = await diagramPng(compiled.drawing);
    if (png && options.timeLeft() > 70_000) {
      const verdict = await checkRendered(openai, png, req).catch((error: Error) => ({ accurate: true, problems: [] as string[], costUsd: (error as { costUsd?: number }).costUsd ?? 0, skipped: error.message }));
      costUsd += verdict.costUsd;
      if (!verdict.accurate) {
        last = `the textbook check rejected it: ${verdict.problems.join("; ") || "inaccurate"}`;
        if (++visionRounds >= 2) break;
        messages.push({ role: "user", content: `A textbook editor looked at your diagram as drawn and rejected it: ${verdict.problems.join("; ") || "it is inaccurate"}. Return the whole corrected diagram.` });
        continue;
      }
    }
    if (options.share) {
      const record: StoredDiagram = { key, raw, title: req.title, style: DIAGRAM_STYLE_VERSION, createdAt: new Date().toISOString() };
      await saveSharedDiagramRecord(key, record).catch(() => undefined);
    }
    return { diagram: { drawing: compiled.drawing, raw, cached: false }, costUsd, log: `vector diagram written, checked${png ? " and seen" : ""} (attempt ${attempt}, ${compiled.facts.kinds.join("+") || "shapes"})` };
  }
  return { diagram: null, costUsd, log: `no vector diagram — ${last.slice(0, 220)}` };
}
