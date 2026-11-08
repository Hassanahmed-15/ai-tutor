// The visual router (spec §2): decides 2d / 3d_template / 3d_scene / both / none for every request.
// Order, first match wins: preference → follow-up on the visual on screen → rules table → LLM
// classifier (ambiguous only) → fallback; then the capability filter. Rules live in rules.json.
import RULES from "./rules.json" with { type: "json" };
import { templateIds } from "../registry";

export type Renderer = "2d" | "3d_template" | "3d_scene" | "both" | "none";
export interface VisualRequest { intent?: string; topic?: string; data?: unknown; preference?: "2d" | "3d" }
export interface ActiveVisual { renderer: Renderer; template_id: string | null; topic?: string }
export interface RouterContext {
  capabilities?: { webgl?: boolean; lowEnd?: boolean; reducedMotion?: boolean };
  active?: ActiveVisual | null;
  templates?: string[];
  classify?: (req: VisualRequest, ctx: RouterContext) => Promise<Decision | null>;
}
export interface Decision {
  renderer: Renderer;
  template_id: string | null;
  reason: string;
  confidence: number;
  step: "preference" | "followup" | "rules" | "classifier" | "fallback" | "capability";
  action?: { name: string; args: Record<string, unknown> };
}
type Rule = { id: string; kind: "3d" | "both" | "2d"; template?: string | null; keywords: string[]; weakKeywords?: string[] };

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A phrase matched as whole words (so "cone" does not match "second"); a plural also matches ("cache hits"). */
const rx = (k: string) => new RegExp(`(?<![a-z0-9])${esc(k.trim())}${/[a-z]$/.test(k.trim()) ? "(?:e?s)?(?![a-z0-9])" : /[0-9]$/.test(k.trim()) ? "(?![a-z0-9])" : ""}`);
const cache = new Map<string, RegExp>();
const has = (text: string, k: string) => {
  if (!cache.has(k)) cache.set(k, rx(k));
  return cache.get(k)!.test(text);
};
const any = (text: string, list: string[]) => list.find((k) => has(text, k)) ?? null;

export function normalise(s: string): string {
  return ` ${s.toLowerCase().replace(/[’']/g, "'").replace(/[−–—]/g, "-").replace(/\s+/g, " ").trim()} `;
}

const textOf = (r: VisualRequest) => normalise(`${r.intent ?? ""} ${r.topic ?? ""}`);

/** The best rule for this text: the longest keyword wins (more specific), ties by table order. */
export function matchRule(text: string): { rule: Rule; keyword: string } | null {
  const hits: { rule: Rule; keyword: string; start: number; end: number; weak: boolean }[] = [];
  for (const rule of RULES.rules as Rule[]) for (const [list, weak] of [[rule.keywords, false], [rule.weakKeywords ?? [], true]] as const) for (const k of list) {
    if (!cache.has(k)) cache.set(k, rx(k));
    const m = cache.get(k)!.exec(text);
    if (m) hits.push({ rule, keyword: k, start: m.index, end: m.index + k.trim().length, weak });
  }
  if (!hits.length) return null;
  // Broad words ("vectors", "graph", "tree") only count when nothing more specific matched.
  const strong = hits.filter((h) => !h.weak);
  if (strong.length) hits.splice(0, hits.length, ...strong);
  let best = hits.reduce((a, b) => (b.keyword.length > a.keyword.length ? b : a));
  // Two phrases that overlap ("bivariate normal" / "normal distribution"): the one that starts first
  // is the more specific reading, if it is a real phrase and not a single short word.
  const earlier = hits.filter((h) => h.start < best.start && h.end > best.start && h.keyword.trim().length >= 8);
  if (earlier.length) best = earlier.reduce((a, b) => (b.keyword.length > a.keyword.length ? b : a));
  return { rule: best.rule, keyword: best.keyword };
}

function resolve(rule: Rule, available: string[], why: string, confidence: number): Decision {
  const t = rule.template && available.includes(rule.template) ? rule.template : null;
  if (rule.kind === "3d") return t ? d("3d_template", t, `${why}: 3D carries real information here`, confidence, "rules") : d("3d_scene", null, `${why}: 3D needed, no template yet`, confidence * 0.9, "rules");
  if (rule.kind === "both") return t ? d("both", t, `${why}: 2D is clearer, 3D view available`, confidence, "rules") : d("2d", null, `${why}: clearer in 2D (no 3D template yet)`, confidence, "rules");
  return d("2d", null, `${why}: relational or flat content, clearer in 2D`, confidence, "rules");
}

const d = (renderer: Renderer, template_id: string | null, reason: string, confidence: number, step: Decision["step"], action?: Decision["action"]): Decision => ({ renderer, template_id, reason, confidence: Math.round(confidence * 100) / 100, step, ...(action ? { action } : {}) });

const numbers = (t: string) => [...t.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

/** Turn a follow-up into a template action (or a player command) with its arguments. */
export function followUpAction(text: string, active: ActiveVisual): Decision["action"] | null {
  const acts = (RULES.actions as Record<string, Record<string, string[]>>)[active.template_id ?? ""] ?? {};
  for (const [name, words] of Object.entries(acts)) {
    if (!any(text, words)) continue;
    const n = numbers(text);
    const args: Record<string, unknown> = {};
    if (["insert", "delete"].includes(name) && n.length) args.value = n[0];
    if (name === "search" && n.length) args.target = n[0];
    if (name === "traverse") args.order = /pre-?order/.test(text) ? "preorder" : /post-?order/.test(text) ? "postorder" : "inorder";
    if (name === "sort_with") args.algorithm = ["merge", "quick", "heap", "insertion", "selection", "bubble"].find((a) => text.includes(a));
    if (name === "set_values" || name === "set_input") (args[name === "set_values" ? "values" : "input"] = n);
    if (name === "probe" && n.length >= 2) (args.x = n[0]), (args.y = n[1]);
    if (name === "set_activation") args.activation = ["sigmoid", "tanh", "relu"].find((a) => text.includes(a));
    if (name === "set_expr") args.expr = (text.match(/z\s*=\s*(.+?)\s*$/)?.[1] ?? "").trim();
    if (["push", "enqueue", "push_front", "push_back"].includes(name) && n.length) args.value = n[0];
    if (name === "insert" && active.template_id === "linked_list") (args.value = n[0]), (args.index = n[1] ?? 0);
    if (name === "delete" && active.template_id === "linked_list" && n.length) (delete args.value), (args.index = n[0]);
    if (name === "search" && ["linked_list"].includes(active.template_id ?? "") && n.length) (delete args.target), (args.value = n[0]);
    if ((name === "insert" || name === "search") && active.template_id === "hash_table" && n.length) (delete args.value), (delete args.target), (args.key = n[0]);
    if (name === "resize" && n.length) args.size = n[0];
    if (name === "access" && n.length) args.index = n[0];
    if (name === "set" && n.length >= 2) (args.index = n[0]), (args.value = n[1]);
    if (name === "set_learning_rate" && n.length) args.learning_rate = n[0];
    if ((name === "set_start" || name === "move_point") && n.length >= 2) (args.x = n[0]), (args.y = n[1]);
    if (name === "set_type") args.type = ["cube", "cuboid", "prism", "pyramid", "cylinder", "cone", "sphere", "hemisphere", "tetrahedron", "octahedron", "dodecahedron", "icosahedron"].find((t) => text.includes(t));
    if (name === "run") (args.algorithm = /dfs|depth/.test(text) ? "dfs" : "bfs"), text.match(/from ([a-z])\b/) && (args.start = text.match(/from ([a-z])\b/)![1].toUpperCase());
    if (name === "set_matrix" && n.length >= 9) args.matrix = [n.slice(0, 3), n.slice(3, 6), n.slice(6, 9)];
    if (name === "set_vectors" && n.length >= 3) args.vectors = Array.from({ length: Math.min(3, Math.floor(n.length / 3)) }, (_, k) => n.slice(k * 3, k * 3 + 3));
    if (name === "set_equations" && n.length >= 12) args.equations = [n.slice(0, 4), n.slice(4, 8), n.slice(8, 12)];
    if (name === "set_n" && n.length) args.n = n[0];
    if (name === "set_plane" && n.length >= 4) (args.normal = n.slice(0, 3)), (args.d = n[3]);
    if (name === "set_rho" && n.length) args.rho = /minus|negative/.test(text) && n[0] > 0 ? -n[0] : n[0];
    if (name === "search" && active.template_id === "trie") (delete args.target), (args.word = (text.match(/["“']([a-z]+)["”']/) ?? text.match(/(?:for|search|find|up|there|contains) (?:the word |a word |the prefix )?([a-z]+)\s*\??$/))?.[1]);
    if (name === "set_mode") args.mode = /parallelogram/.test(text) ? "parallelogram" : "head_to_tail";
    return { name, args };
  }
  // The longest matching phrase wins ("go back a step" is prev_step, not "go" = play).
  let verb: { name: string; len: number } | null = null;
  for (const [name, words] of Object.entries(RULES.playerVerbs as Record<string, string[]>)) for (const w of words) if (has(text, w) && (!verb || w.length > verb.len)) verb = { name, len: w.length };
  if (verb) {
    const name = verb.name;
    if (name === "camera") return { name, args: { preset: /above|top/.test(text) ? "top" : /side/.test(text) ? "side" : /front/.test(text) ? "front" : "iso" } };
    if (name === "faster" || name === "slower") return { name: "set_speed", args: { speed: name === "faster" ? 2 : 0.5 } };
    return { name, args: {} };
  }
  return null;
}

/** Rules only (synchronous): used by decide() and by the eval script. */
export function decideByRules(req: VisualRequest, ctx: RouterContext = {}): Decision | null {
  const text = textOf(req);
  const available = ctx.templates ?? templateIds();
  const active = ctx.active ?? null;
  const match = matchRule(text);
  const activeTemplate = active?.template_id ?? (active?.topic ? matchRule(normalise(active.topic))?.rule.template ?? null : null);

  // 1. Explicit preference (tool argument or words in the request).
  const wants3d = req.preference === "3d" || !!any(text, RULES.ask3d);
  const wants2d = req.preference === "2d" || (!wants3d && !!any(text, RULES.formatWords2d));
  if (wants3d) {
    const t = match?.rule.template ?? activeTemplate;
    if (t && available.includes(t)) return d("3d_template", t, "asked for 3D", 0.95, "preference");
    return d("3d_scene", null, "asked for 3D; no template covers it", 0.85, "preference");
  }
  if (wants2d) return d("2d", null, "asked for a flat diagram", 0.95, "preference");

  // 2. A follow-up on what is already on screen.
  if (active && active.renderer !== "none") {
    const action = followUpAction(text, { ...active, template_id: activeTemplate });
    const newTopic = match && match.rule.template !== activeTemplate && match.rule.id !== "simple_ds" && match.keyword.length > 4;
    if (action && !newTopic) return d(active.renderer, activeTemplate, `follow-up on the visual on screen (${action.name})`, 0.9, "followup", action);
  }

  // 3. Clearly no visual (greetings, opinions, history, study tips).
  if (any(text, RULES.noneStrong)) return d("none", null, "no diagram would help here", 0.85, "rules");

  // 4. The rules table.
  if (match) {
    const generic = (match.rule.weakKeywords ?? []).includes(match.keyword);
    return resolve(match.rule, available, `matched "${match.keyword.trim()}"`, generic ? 0.6 : match.keyword.length >= 6 ? 0.9 : 0.78);
  }
  return null;
}

const decisionLog: { at: string; request: VisualRequest; decision: Decision }[] = [];
export const routerLog = () => decisionLog.slice(-200);

/** The full router. */
export async function decide(req: VisualRequest, ctx: RouterContext = {}): Promise<Decision> {
  const text = textOf(req);
  let out = decideByRules(req, ctx);
  // 5. The LLM classifier, only for what the rules could not settle (stubbed in Phase 1).
  if ((!out || out.confidence < 0.65) && ctx.classify) {
    const c = await ctx.classify(req, ctx).catch(() => null);
    if (c && c.confidence >= 0.6 && (c.renderer !== "3d_template" || (ctx.templates ?? templateIds()).includes(c.template_id ?? ""))) out = { ...c, step: "classifier" };
    else if (c && !out) out = d("2d", null, "classifier unsure, so 2D", 0.5, "classifier");
  }
  // 6. Fallback: 2D if it can be drawn, otherwise just explain.
  if (!out) out = any(text, RULES.visualVerbs) ? d("2d", null, "a diagram was asked for; 2D by default", 0.55, "fallback") : any(text, RULES.noneWeak) ? d("none", null, "a definition: explain in words", 0.6, "fallback") : d("none", null, "nothing to draw", 0.5, "fallback");
  // Capability filter: no WebGL means no 3D; a low-end device keeps 3D only where it is essential.
  const caps = ctx.capabilities ?? {};
  const is3d = out.renderer === "3d_template" || out.renderer === "3d_scene" || out.renderer === "both";
  if (is3d && caps.webgl === false) out = d("2d", null, "this device cannot show 3D", 0.9, "capability");
  else if (caps.lowEnd && (out.renderer === "both" || out.renderer === "3d_scene")) out = d("2d", null, "low-end device: 2D instead", 0.85, "capability");
  decisionLog.push({ at: new Date().toISOString(), request: req, decision: out });
  return out;
}
