import { readFile } from "node:fs/promises";
import path from "node:path";

/*
 * Deliberately NOT marked `import "server-only"`, unlike manimRender.ts.
 *
 * engines.ts reaches this module, and lab.test.ts reaches engines.ts, so the marker throws inside
 * the CommonJS test build the moment anything is required — it took the suite from 27 tests to 3.
 * The guarantee survives without it: reading `node:fs/promises` at module scope already fails a
 * client bundle at build time, so this cannot end up in the browser by accident.
 */

/**
 * Real artwork for the React sandbox, retrieved per prompt.
 *
 * The measurement that produced this: with the sandbox inventing its own silhouettes, the vision
 * critic scored the biology boards 2/5 — "the mitochondrion is a plain oval without the
 * characteristic cristae" — and regenerating with that exact complaint attached produced another
 * 2/5. A model told precisely what is wrong with its drawing still cannot draw an organelle. So it
 * should stop drawing them and start POSITIONING them.
 *
 * RETRIEVAL, NOT ENUMERATION. There are 710 licence-clean assets; a prompt cannot list them and a
 * sandbox document should not carry them. Keywords from the brief select a handful, and only those
 * are named in the prompt and injected into the page.
 *
 * COVERAGE IS THE HONEST LIMIT. Bioicons has 5 mitochondria and a nephron, one leaf, and no
 * chloroplast, thylakoid or granum at all. This raises the ceiling where the library reaches and
 * does nothing at all where it does not, which is why the critic stays: it is what notices.
 */

export type AssetMeta = {
  id: string;
  name: string;
  category: string;
  author: string;
  licence: string;
  keywords: string[];
};

export type LoadedAsset = AssetMeta & {
  /** Inner markup of the source SVG, with the root <svg> stripped. */
  body: string;
  /** The source viewBox, so the runtime can scale into whatever box the model asks for. */
  w: number;
  h: number;
};

const ASSET_DIR = path.join(process.cwd(), "assets");

let indexCache: AssetMeta[] | null = null;
async function loadIndex(): Promise<AssetMeta[]> {
  if (indexCache) return indexCache;
  try {
    indexCache = JSON.parse(await readFile(path.join(ASSET_DIR, "index.json"), "utf-8")) as AssetMeta[];
  } catch {
    // No catalogue built yet is a normal state, not an error: the sandbox simply draws its own
    // shapes, exactly as it did before. Run scripts/build-asset-catalogue.mjs to populate it.
    indexCache = [];
  }
  return indexCache;
}

/** Words worth matching on — "the", "of", "how" would match everything. */
const STOP = new Set([
  "the", "and", "for", "with", "into", "how", "what", "does", "diagram", "labelled", "labeled",
  "showing", "show", "inside", "structure", "internal", "process", "produces", "using", "from",
]);

function termsOf(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3 && !STOP.has(w)))];
}

/**
 * The handful of assets worth offering for this brief.
 *
 * TERM LENGTH IS THE WEIGHT, and that is the whole trick. The first version scored every matching
 * term equally, so a brief about "how a nephron filters blood" offered `blood-sample`,
 * `blood-sample-tube` and `arabidopsis-flower` while `nephron-2d` — the one genuinely right asset
 * in the catalogue — never made the shortlist. Short generic words ("blood", "cell", "chain") hit
 * hundreds of assets and drowned the specific one. Weighting by term length fixes it because
 * specificity and length correlate closely in this vocabulary: "mitochondrion" is a subject,
 * "chain" is a coincidence.
 *
 * Matching is on WHOLE WORDS, for the same reason — "chain" should not match
 * "antibody-heavy-chain-vdj-recombination" as strongly as "nephron" matches "nephron-2d". Stems
 * handle singular/plural, since "mitochondria" and "mitochondrion" must find each other.
 */
export async function findAssets(brief: string, limit = 8): Promise<AssetMeta[]> {
  const index = await loadIndex();
  if (index.length === 0) return [];
  const terms = termsOf(brief);
  if (terms.length === 0) return [];

  const scored = index
    .map((asset) => {
      const words = new Set([...asset.id.split("-"), ...asset.keywords, ...asset.name.toLowerCase().split(/\s+/)]);
      let score = 0;
      for (const term of terms) {
        // "mitochondrion" -> "mitochondri", so it reaches "mitochondria".
        const stem = term.slice(0, Math.max(4, term.length - 2));
        const weight = term.length;
        if (asset.id === term || asset.name.toLowerCase() === term) score += weight * 4;
        else if ([...words].some((w) => w === term || w.startsWith(stem))) score += weight * 2;
        else if (asset.id.includes(stem)) score += weight;
      }
      return { asset, score };
    })
    // A single short generic hit is noise, not a match. Requiring real weight keeps the shortlist
    // honest — offering eight irrelevant assets teaches the model that the catalogue is useless.
    .filter((s) => s.score >= 12)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map((s) => s.asset);
}

/** Strips the wrapper <svg> and reads its viewBox, so the body can be placed in any box. */
function unwrap(svg: string): { body: string; w: number; h: number } | null {
  const open = /<svg\b[^>]*>/i.exec(svg);
  const close = svg.lastIndexOf("</svg>");
  if (!open || close < 0) return null;

  const attrs = open[0];
  const viewBox = /viewBox\s*=\s*"([^"]+)"/i.exec(attrs)?.[1];
  let w = 100;
  let h = 100;
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      w = parts[2];
      h = parts[3];
    }
  } else {
    w = Number(/width\s*=\s*"([\d.]+)/i.exec(attrs)?.[1]) || 100;
    h = Number(/height\s*=\s*"([\d.]+)/i.exec(attrs)?.[1]) || 100;
  }
  const body = svg
    .slice(open.index + attrs.length, close)
    .replace(/<!--[\s\S]*?-->/g, "")
    // Injected into a page: the sandbox CSP would block a script, but the critic renders this same
    // string server-side, where it would not.
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    /*
     * EVERY NAMESPACE PREFIX MUST GO, except xlink.
     *
     * These files come out of Inkscape and carry `inkscape:label`, `sodipodi:nodetypes`, a
     * <sodipodi:namedview>, and an RDF <metadata> block. Their namespaces were declared on the
     * root <svg> this function just stripped, so what remains uses prefixes nothing declares.
     * Browsers shrug; resvg refuses to parse the document at all ("unknown namespace prefix
     * 'inkscape'", then 'rdf'), which silently cost the critic its opinion on exactly the boards
     * that used artwork — the failure mode this whole session keeps rediscovering.
     *
     * Written as a general rule rather than a list of prefixes because the list was already wrong
     * twice. None of this metadata affects rendering. `xlink:href` is load-bearing and stays.
     */
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, "")
    .replace(/<\/?(?!xlink:)[a-z][\w-]*:[\w-]+[^>]*>/gi, "")
    .replace(/\s(?!xlink:)[a-z][\w-]*:[\w-]+\s*=\s*"[^"]*"/gi, "");
  return { body, w, h };
}

export async function loadAssets(metas: AssetMeta[]): Promise<LoadedAsset[]> {
  const out: LoadedAsset[] = [];
  for (const meta of metas) {
    try {
      const raw = await readFile(path.join(ASSET_DIR, `${meta.id}.svg`), "utf-8");
      const parsed = unwrap(raw);
      if (parsed) out.push({ ...meta, ...parsed });
    } catch {
      /* a missing file just means one fewer option */
    }
  }
  return out;
}

/**
 * The JS injected into the sandbox — and into the critic's server-side render, which must see the
 * same board the student does or its score describes something nobody looked at.
 *
 * `Asset` scales the source viewBox into the box the model asks for and centres it, so the model
 * never has to reason about the artwork's own coordinate system.
 */
export function assetRuntimeFor(assets: LoadedAsset[]): string {
  const table = Object.fromEntries(assets.map((a) => [a.id, { b: a.body, w: a.w, h: a.h }]));
  return `
var __ASSETS__ = ${JSON.stringify(table)};
function Asset(props) {
  var a = __ASSETS__[props.name];
  if (!a) return null;
  var w = props.w || 200, h = props.h || 200, x = props.x || 0, y = props.y || 0;
  var s = Math.min(w / a.w, h / a.h);
  // Centre inside the requested box: artwork aspect ratios vary and the model is placing a box,
  // not a shape.
  var dx = x + (w - a.w * s) / 2, dy = y + (h - a.h * s) / 2;
  return React.createElement("g", {
    transform: "translate(" + dx + "," + dy + ") scale(" + s + ")",
    opacity: props.opacity,
    dangerouslySetInnerHTML: { __html: a.b }
  });
}
`.trim();
}

/** The shortlist as the prompt sees it, plus the credit line the licences require. */
export function assetPromptBlock(assets: LoadedAsset[]): string {
  if (assets.length === 0) return "";
  const lines = assets.map((a) => `- "${a.id}" — ${a.name}${a.category ? ` (${a.category})` : ""}`).join("\n");
  return `

REAL ARTWORK IS AVAILABLE — USE IT INSTEAD OF DRAWING THE SUBJECT YOURSELF.
<Asset name="id" x={n} y={n} w={n} h={n} /> renders a real, professionally drawn illustration,
scaled and centred into the box you give it. These are in scope for this board:
${lines}
Place the one that matches the subject with <Asset/>, then do your own work AROUND it — labels,
leader lines, arrows, highlights, and the progress-driven motion. Draw the subject by hand ONLY if
none of the above is actually the thing being taught; a hand-drawn organelle reads as a plain oval
and is the single biggest quality problem with these boards.
An <Asset/> still needs its data-teach attributes on a wrapping <g>, like any other step.`;
}

/** Attribution the CC-BY assets require, for the board footer. */
export function creditLine(assets: LoadedAsset[]): string {
  const needsCredit = assets.filter((a) => a.licence.startsWith("cc-by"));
  if (needsCredit.length === 0) return "";
  const authors = [...new Set(needsCredit.map((a) => a.author).filter(Boolean))];
  return `Artwork: Bioicons${authors.length ? ` — ${authors.join(", ")}` : ""} (CC BY 4.0)`;
}
