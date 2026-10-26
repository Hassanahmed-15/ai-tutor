/**
 * VISUALS TAKEN FROM THE REFERENCE PAGES (owner, 2026-10-24: "except for DSA topics, is it not possible
 * to take visuals from the images in the links you take as a reference — for other CS topics?").
 *
 * A typed CS lesson that is not DSA is taught from web research (lib/webResearch.ts), and its pages draw
 * the topic's standard picture — omnisecu's TCP page has the handshake ladder the TCP lecture never drew.
 * Here the pages' diagrams are found, read by a vision model and kept as what they show; the board then
 * REDRAWS that picture natively (lib/canvas/sequence.ts and the other stages), synced to the narration.
 * The original image is never shown: revision sites' diagrams are not ours to copy, and a picture
 * cannot be drawn sentence by sentence.
 *
 * Runs while the lesson is planned (lib/canvas/progressive.ts), so the student never waits for it; a page
 * that cannot be read, or a lesson with no usable diagram, keeps the usual boards.
 */
import type OpenAI from "openai";
import { costFor } from "../modelPricing";
import type { SourcePack } from "../webSources";
import type { CanvasPlanBeat, CanvasStage, SourceDiagram } from "./types";

const VISION_MODEL = process.env.CANVAS_DIAGRAM_MODEL ?? process.env.OPENAI_VISION_MODEL ?? "gpt-5.6-luna";
const MAX_PAGES = 6;
const MAX_IMAGES = 4;
const PAGE_BYTES = 1_500_000;
const IMAGE_BYTES = 2_000_000;

export type PageImage = { src: string; alt: string; caption: string; heading: string; score: number; page: string };

const STOP = new Set(["the", "and", "for", "with", "how", "what", "why", "does", "this", "that", "from", "into", "are", "its", "work", "works", "explain", "about", "using", "use"]);
const words = (t: string) => (t.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w));
const JUNK = /logo|icon|avatar|sprite|banner|\bads?\b|advert|pixel|track|badge|button|social|facebook|twitter|linkedin|whatsapp|pinterest|gravatar|emoji|spinner|loader|author|profile|thumb(?:nail)?s?\b|cookie|captcha/i;
const DIAGRAM_WORD = /diagram|figure|\bfig\b|flow|handshake|sequence|process|steps?|layers?|architecture|model|states?|exchange|packet|segment|frame|header/i;
const attr = (tag: string, name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag)?.slice(2).find((v) => v !== undefined) ?? "";
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** A page we may fetch: http(s), and never this machine or a private network. */
export function isPublicHttpUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local") || h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return false;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  return true;
}

/**
 * The page's images that could be the topic's diagram, best first: an <img> (or lazy-loaded data-src)
 * with its alt text, its <figcaption> and the heading above it, scored by the topic's words. Logos,
 * icons, avatars, adverts, tiny images and SVGs (the vision model cannot read them) are left out.
 */
export function findPageImages(html: string, pageUrl: string, topic: string): PageImage[] {
  const want = new Set(words(topic));
  const out: PageImage[] = [];
  const headings = [...html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map((m) => ({ at: m.index ?? 0, text: plain(m[1]).slice(0, 120) }));
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const at = m.index ?? 0;
    const raw = attr(tag, "data-src") || attr(tag, "data-lazy-src") || attr(tag, "data-original") || attr(tag, "src") || (attr(tag, "srcset").split(/\s+/)[0] ?? "");
    if (!raw || raw.startsWith("data:")) continue;
    let src: string;
    try {
      src = new URL(raw.replace(/&amp;/g, "&"), pageUrl).toString();
    } catch {
      continue;
    }
    if (/\.svg(?:$|\?)/i.test(src) || !isPublicHttpUrl(src)) continue;
    const alt = plain(attr(tag, "alt") || attr(tag, "title")).slice(0, 160);
    const cls = `${attr(tag, "class")} ${attr(tag, "id")}`;
    const w = Number(attr(tag, "width")) || 0;
    const h = Number(attr(tag, "height")) || 0;
    if ((w && w < 120) || (h && h < 80)) continue;
    const file = decodeURIComponent(new URL(src).pathname.split("/").pop() ?? "");
    if (JUNK.test(`${file} ${cls} ${alt}`)) continue;
    // The caption of the <figure> this image is in, when it has one.
    const figStart = html.lastIndexOf("<figure", at);
    const figEnd = figStart >= 0 ? html.indexOf("</figure>", figStart) : -1;
    const caption = figStart >= 0 && figEnd > at ? plain(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(html.slice(figStart, figEnd))?.[1] ?? "").slice(0, 200) : "";
    const heading = [...headings].reverse().find((x) => x.at < at)?.text ?? "";
    const text = `${alt} ${caption} ${file.replace(/[-_.]+/g, " ")} ${heading}`;
    const hits = new Set(words(text).filter((x) => want.has(x))).size;
    const score = hits * 2 + (DIAGRAM_WORD.test(text) ? 1 : 0);
    if (hits < 1) continue;
    if (out.some((o) => o.src === src)) continue;
    out.push({ src, alt, caption, heading, score, page: pageUrl });
  }
  return out.sort((a, b) => b.score - a.score);
}

async function fetchCapped(url: string, ms: number, max: number, accept: RegExp): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!isPublicHttpUrl(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(ms), redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; AriaTutor/1.0; +https://aria-tutor)", accept: "text/html,image/*;q=0.9,*/*;q=0.5" } });
  if (!res.ok || !isPublicHttpUrl(res.url || url)) return null;
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!accept.test(type)) return null;
  if (Number(res.headers.get("content-length") ?? 0) > max) return null;
  const body = new Uint8Array(await res.arrayBuffer());
  return body.byteLength && body.byteLength <= max ? { bytes: body, type } : null;
}

export const DIAGRAM_PROMPT = `You read diagrams from the web pages a lesson was researched from, so the lesson can redraw them. For EACH image, decide whether it is a teaching diagram of the lesson's topic (a labelled drawing of how it works — not a photo, logo, screenshot of a website, advert or decoration). If it is, transcribe ONLY what is drawn in it — names, labels and values exactly as written; never add anything that is not in the image.
Kinds:
- "sequence": parties as vertical lines with messages passing between them over time (a handshake, a request and response). Give "lanes" (party names, left to right) and "messages" in order, top to bottom: {"from", "to", "label" (the message name, e.g. "SYN"), "detail" (what it carries, e.g. "seq=x", "ack=x+1"; omit if none)}; "states" for any state written beside a party's line: {"lane", "label", "after": the number of messages above it (0 = at the start)}.
- "state-machine": named states joined by labelled transitions: "transitions": [{"from", "to", "label"}].
- "layers": a stack of layers, top to bottom: "layers".
- "flow": boxes joined by arrows: "boxes" and "arrows": [{"from", "to", "label"}].
Return JSON only: {"diagrams": [{"image": the image number, "teaches": boolean, "kind": one of the kinds, "title": "what it shows, in a few words", ...its fields}]}. An image that is not a teaching diagram of this topic has "teaches": false and nothing else.`;

const s40 = (v: unknown, max = 40) => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim().slice(0, max) : "");

/** What the vision model said an image shows, kept only when it is a usable diagram. */
export function sanitizeSourceDiagram(raw: unknown, page: { url: string; site: string }): SourceDiagram | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.teaches !== true) return null;
  const kind = r.kind;
  const title = s40(r.title, 80);
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map((x) => s40(x)).filter(Boolean).slice(0, max);
  const edges = (v: unknown) => (Array.isArray(v) ? v : []).map((x) => (x && typeof x === "object" ? x as Record<string, unknown> : {})).map((e) => ({ from: s40(e.from), to: s40(e.to), ...(s40(e.label) ? { label: s40(e.label) } : {}) })).filter((e) => e.from && e.to).slice(0, 12);
  const base = { title: title || "Diagram", url: page.url, site: page.site };
  if (kind === "sequence") {
    const lanes = list(r.lanes, 4);
    // A party named a little differently in a message ("device a", "Device A (client)") is still that lane.
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const laneOf = (v: unknown) => {
      const n = norm(s40(v, 60));
      return n ? lanes.find((l) => norm(l) === n) ?? lanes.find((l) => norm(l).length >= 3 && (n.includes(norm(l)) || norm(l).includes(n))) : undefined;
    };
    const messages = (Array.isArray(r.messages) ? r.messages : []).map((x) => (x && typeof x === "object" ? x as Record<string, unknown> : {}))
      .map((m) => ({ from: laneOf(m.from) ?? "", to: laneOf(m.to) ?? "", label: s40(m.label, 24), ...(s40(m.detail) ? { detail: s40(m.detail) } : {}) }))
      .filter((m) => m.label && m.from && m.to && m.from !== m.to)
      .slice(0, 8);
    if (lanes.length < 2 || messages.length < 2) return null;
    const states = (Array.isArray(r.states) ? r.states : []).map((x) => (x && typeof x === "object" ? x as Record<string, unknown> : {}))
      .map((st) => ({ lane: laneOf(st.lane) ?? "", label: s40(st.label, 24), after: Math.max(0, Math.min(messages.length, Math.round(Number(st.after) || 0))) }))
      .filter((st) => st.label && st.lane)
      .slice(0, 8);
    return { kind, ...base, lanes, messages, ...(states.length ? { states } : {}) };
  }
  if (kind === "state-machine") {
    const transitions = edges(r.transitions);
    return transitions.length >= 2 ? { kind, ...base, transitions } : null;
  }
  if (kind === "layers") {
    const layers = list(r.layers, 8);
    return layers.length >= 3 ? { kind, ...base, layers } : null;
  }
  if (kind === "flow") {
    const boxes = list(r.boxes, 8);
    const arrows = edges(r.arrows);
    return boxes.length >= 3 ? { kind, ...base, boxes, ...(arrows.length ? { arrows } : {}) } : null;
  }
  return null;
}

/**
 * The reference pages' diagrams of this topic: up to 4 pages fetched, their best 4 candidate images read
 * in one vision call. Never throws; on any failure, no diagrams.
 */
/**
 * Wikipedia's articles on the topic: their diagrams are freely licensed and drawn to teach, and they are
 * there when the research cited one page with no diagram at all (NoSQL lesson, 2026-10-24).
 */
async function wikipediaPages(topic: string): Promise<Array<{ url: string; site: string; title: string }>> {
  const q = topic.replace(/\b(?:what is|how does|how do|explain|the|difference between|works?)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!q) return [];
  const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=2&srsearch=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(5_000), headers: { "user-agent": "AriaTutor/1.0 (lesson diagrams)" } }).catch(() => null);
  const json = res?.ok ? ((await res.json().catch(() => null)) as { query?: { search?: Array<{ title?: string }> } } | null) : null;
  return (json?.query?.search ?? []).flatMap((r) => (r.title ? [{ url: `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}`, site: "Wikipedia", title: r.title }] : []));
}

export async function readSourceDiagrams(openai: OpenAI, topic: string, pack: SourcePack | null | undefined): Promise<{ diagrams: SourceDiagram[]; costUsd: number; log: string }> {
  // The cited pages first, then the other pages the search found, then Wikipedia's articles.
  const seen = new Set<string>();
  const pages = [...(pack?.sources ?? []), ...(pack?.pages ?? []), ...(await wikipediaPages(topic).catch(() => []))]
    .filter((s) => isPublicHttpUrl(s.url) && !seen.has(s.url) && Boolean(seen.add(s.url)))
    .slice(0, MAX_PAGES);
  if (!pages.length) return { diagrams: [], costUsd: 0, log: "no reference pages" };
  try {
    const found = (await Promise.all(pages.map(async (p) => {
      const page = await fetchCapped(p.url, 6_000, PAGE_BYTES, /text\/html|application\/xhtml/).catch(() => null);
      return page ? findPageImages(new TextDecoder().decode(page.bytes), p.url, topic).slice(0, 2) : [];
    }))).flat().sort((a, b) => b.score - a.score);
    const images = (await Promise.all(found.slice(0, MAX_IMAGES + 2).map(async (img) => {
      const got = await fetchCapped(img.src, 6_000, IMAGE_BYTES, /image\/(?:png|jpe?g|gif|webp)/).catch(() => null);
      return got ? { ...img, dataUrl: `data:${got.type.split(";")[0]};base64,${Buffer.from(got.bytes).toString("base64")}` } : null;
    }))).filter((x): x is PageImage & { dataUrl: string } => Boolean(x)).slice(0, MAX_IMAGES);
    if (!images.length) return { diagrams: [], costUsd: 0, log: `no candidate image on ${pages.length} page(s)` };
    const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: "text", text: `The lesson's topic: ${topic}` }];
    images.forEach((img, i) => {
      content.push({ type: "text", text: `Image ${i + 1} — from ${new URL(img.page).hostname}${img.alt ? `, alt text "${img.alt}"` : ""}${img.caption ? `, caption "${img.caption}"` : ""}${img.heading ? `, under the heading "${img.heading}"` : ""}:` });
      content.push({ type: "image_url", image_url: { url: img.dataUrl, detail: "high" } });
    });
    const res = await openai.chat.completions.create({
      model: VISION_MODEL,
      messages: [{ role: "system", content: DIAGRAM_PROMPT }, { role: "user", content }],
      response_format: { type: "json_object" },
      max_completion_tokens: 6000,
    }, { signal: AbortSignal.timeout(45_000) });
    const costUsd = costFor(VISION_MODEL, res.usage);
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { diagrams?: unknown[] };
    const dropped: string[] = [];
    const diagrams = (Array.isArray(parsed.diagrams) ? parsed.diagrams : []).flatMap((d) => {
      const raw = (d ?? {}) as { image?: unknown; teaches?: unknown; kind?: unknown; title?: unknown };
      const img = images[Number(raw.image) - 1];
      if (!img) return [];
      const site = pages.find((p) => p.url === img.page)?.site ?? new URL(img.page).hostname;
      const kept = sanitizeSourceDiagram(d, { url: img.page, site });
      if (!kept && raw.teaches === true) dropped.push(`${String(raw.kind)} "${String(raw.title ?? "")}" (unusable)`);
      return kept ? [kept] : [];
    });
    const read = images.map((img) => new URL(img.src).pathname.split("/").pop()).join(", ");
    return { diagrams, costUsd, log: `${images.length} image(s) read (${read}) from ${pages.length} page(s); ${diagrams.length} diagram(s): ${diagrams.map((d) => `${d.kind} "${d.title}" (${d.site})`).join(", ") || "none"}${dropped.length ? `; dropped ${dropped.join(", ")}` : ""}` };
  } catch (error) {
    return { diagrams: [], costUsd: 0, log: `skipped — ${(error as Error).message}` };
  }
}

const DIAGRAM_STAGE: Record<SourceDiagram["kind"], CanvasStage> = { sequence: "sequence", "state-machine": "structure", layers: "flow", flow: "flow" };

function diagramWords(d: SourceDiagram): Set<string> {
  return new Set(words([d.title, ...(d.lanes ?? []), ...(d.messages ?? []).flatMap((m) => [m.label, m.detail ?? ""]), ...(d.states ?? []).map((s) => s.label), ...(d.transitions ?? []).flatMap((t) => [t.from, t.to, t.label ?? ""]), ...(d.layers ?? []), ...(d.boxes ?? [])].join(" ")));
}

/**
 * Each diagram goes to the board it fits best (most shared words with the board's title, brief and
 * script; at least 3), one diagram a board, and that board is drawn as the diagram's kind. The opening
 * map, code boards, refreshers and the recap keep theirs.
 */
/**
 * A "flow" whose arrows run between two to four parties and back again (a resolver asking one server after
 * another) is a message exchange: drawn as a flow chart its arrows crossed and its labels sat on them
 * (DNS test lecture, 2026-10-24). It is redrawn as a sequence, the arrows as messages in order.
 */
export function asSequence(d: SourceDiagram): SourceDiagram | null {
  if (d.kind === "sequence") return d;
  if (d.kind !== "flow" || (d.arrows?.length ?? 0) < 2) return null;
  const lanes: string[] = [];
  for (const a of d.arrows!) for (const p of [a.from, a.to]) if (!lanes.includes(p)) lanes.push(p);
  if (lanes.length < 2 || lanes.length > 4) return null;
  const back = d.arrows!.some((a) => d.arrows!.some((o) => o.from === a.to && o.to === a.from));
  if (!back) return null;
  return { kind: "sequence", title: d.title, url: d.url, site: d.site, lanes, messages: d.arrows!.slice(0, 6).map((a) => ({ from: a.from, to: a.to, label: (a.label ?? "message").slice(0, 24) })) };
}

export function matchDiagramsToBeats(beats: CanvasPlanBeat[], diagrams: SourceDiagram[]): string[] {
  const log: string[] = [];
  const taken = new Set<number>();
  for (const found of diagrams) {
    const d = asSequence(found) ?? found;
    const want = diagramWords(d);
    let best = -1, bestScore = 2;
    beats.forEach((b, i) => {
      if (i === 0 || taken.has(i) || b.refresher || b.overview || b.stage === "code" || b.stage === "exam" || b.sourceDiagram) return;
      // A board planned as a message sequence is never turned into a flow chart or a graph.
      if (b.stage === "sequence" && d.kind !== "sequence") return;
      const score = new Set(words(`${b.title} ${b.brief} ${b.script}`).filter((w) => want.has(w))).size;
      if (score > bestScore) { best = i; bestScore = score; }
    });
    if (best < 0) continue;
    taken.add(best);
    const b = beats[best];
    const stage = DIAGRAM_STAGE[d.kind];
    log.push(`${b.id}: ${b.stage} → ${stage}, redrawing the ${d.kind} diagram "${d.title}" from ${d.site}`);
    b.sourceDiagram = d;
    b.stage = stage;
    b.figure = undefined;
    if (b.requiredVisual) b.requiredVisual.stages = [stage];
  }
  return log;
}

/** What the board writer is told about the page's diagram it redraws (`stage`: what the board became — an OS lesson redraws a state machine as "states" and layers as "memory"). */
export function sourceDiagramBrief(d: SourceDiagram, stage?: CanvasStage): string {
  const what =
    d.kind === "sequence"
      ? `parties ${d.lanes!.join(" and ")}; messages in order: ${d.messages!.map((m, i) => `${i + 1}. ${m.from} → ${m.to}: ${m.label}${m.detail ? ` (${m.detail})` : ""}`).join("; ")}${d.states?.length ? `; states: ${d.states.map((s) => `${s.lane} ${s.label} after message ${s.after}`).join(", ")}` : ""}`
      : d.kind === "state-machine"
      ? `states and transitions: ${d.transitions!.map((t) => `${t.from} → ${t.to}${t.label ? ` on "${t.label}"` : ""}`).join("; ")}`
      : d.kind === "layers"
      ? `layers, top to bottom: ${d.layers!.join(", ")}`
      : `boxes: ${d.boxes!.join(", ")}${d.arrows?.length ? `; arrows: ${d.arrows.map((a) => `${a.from} → ${a.to}${a.label ? ` (${a.label})` : ""}`).join("; ")}` : ""}`;
  const how =
    d.kind === "sequence"
      ? `a "sequence" board: the same parties as lanes and the same messages in the same order, each on the sentence that sends it; where the page writes letters (seq=x, ack=x+1) use the lesson's own example values consistently`
      : d.kind === "state-machine" && stage === "states"
      ? `a "states" board — one oval per state, laid out like the page's figure, each transition labelled with its event and drawn on the sentence that names it`
      : d.kind === "layers" && stage === "memory"
      ? `a "memory" board — one column, one block per layer from top to bottom, in this order`
      : d.kind === "state-machine"
      ? `a "structure" board — a directed "graph" whose nodes are the states (short values) and whose links are the transitions, each added on the sentence that takes it`
      : d.kind === "layers"
      ? `a "flow" board with "arrangement": "chain" running top to bottom, one box per layer, in this order`
      : `a "flow" board with these boxes and arrows`;
  return `THE REFERENCE PAGE'S DIAGRAM (${d.site}: "${d.title}") — redraw this picture as ${how}. What the page draws: ${what}. Keep its parts, names and order; the narration explains each part as it is drawn.`;
}
