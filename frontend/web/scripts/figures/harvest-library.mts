/**
 * HARVEST THE TEXTBOOK DIAGRAM LIBRARY from Wikimedia Commons (free; resumable).
 *
 *   npx tsx scripts/figures/harvest-library.mts [--only heart,nephron] [--per-seed 6] [--fresh]
 *
 * For each seed (the most-taught diagrams), searches Commons for SVGs, keeps only openly-licensed
 * files (lib/figures/libraryIndex.ts licenceGate), ranks them (featured/quality/valued, Mariana Ruiz
 * "LadyofHats", English labels, title words), and downloads the best few into
 * data/figures/.cache/raw. Every seed's search is saved, so a stalled run picks up where it stopped.
 * Then run scripts/figures/normalise-library.mts to build data/figures/library.
 *
 * NETWORK. This machine's connection to commons.wikimedia.org is reset intermittently (by SNI), while
 * the same Wikimedia front end answers for other hosts: when the direct request is reset, the API call
 * is sent to meta.wikimedia.org with `Host: commons.wikimedia.org` — the same servers, the same API.
 * Every request carries a descriptive User-Agent (Wikimedia policy), a timeout, and retries with backoff.
 */
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { createHash } from "node:crypto";
import { fileLanguage, licenceGate, words } from "../../lib/figures/libraryIndex.ts";

const UA = "AriaTutorDiagramHarvester/1.0 (education; contact via site)";
const ROOT = path.resolve(import.meta.dirname, "../..");
const CACHE = path.join(ROOT, "data/figures/.cache");
const RAW = path.join(CACHE, "raw");
const SEARCH = path.join(CACHE, "search");
const MAX_BYTES = 1_500_000;

export type Seed = { seed: string; queries: string[]; keywords: string[] };

/** The most-taught diagrams. `keywords` are the SUBJECT words a board must say to get this diagram. */
export const SEEDS: Seed[] = [
  { seed: "animal cell", queries: ["animal cell structure en", "animal cell diagram"], keywords: ["animal cell", "eukaryotic cell", "cell organelles", "organelle"] },
  { seed: "plant cell", queries: ["plant cell structure en", "plant cell diagram"], keywords: ["plant cell", "cell wall", "vacuole"] },
  { seed: "bacterial cell", queries: ["prokaryote cell diagram en", "bacterial cell structure"], keywords: ["bacterial cell", "bacterium", "bacteria", "prokaryote", "prokaryotic cell"] },
  { seed: "mitochondrion", queries: ["mitochondrion structure en", "mitochondrion diagram"], keywords: ["mitochondrion", "mitochondria", "cristae"] },
  { seed: "chloroplast", queries: ["chloroplast structure en", "chloroplast diagram"], keywords: ["chloroplast", "thylakoid", "granum", "grana"] },
  { seed: "heart", queries: ["heart diagram en", "diagram of the human heart", "heart anterior exterior view"], keywords: ["heart", "cardiac", "ventricle", "atrium", "atria"] },
  { seed: "circulatory system", queries: ["circulatory system en", "circulatory system diagram"], keywords: ["circulatory system", "circulation", "double circulation", "blood vessels"] },
  { seed: "respiratory system", queries: ["respiratory system complete en", "respiratory system diagram"], keywords: ["respiratory system", "lungs", "lung", "trachea", "bronchus", "bronchi", "breathing system", "gas exchange system"] },
  { seed: "alveolus", queries: ["alveolus diagram en", "alveoli gas exchange diagram"], keywords: ["alveolus", "alveoli", "gas exchange"] },
  { seed: "digestive system", queries: ["digestive system diagram en", "digestive system without labels"], keywords: ["digestive system", "alimentary canal", "digestion", "gut"] },
  { seed: "kidney", queries: ["kidney structures en", "kidney cross section diagram"], keywords: ["kidney", "kidneys", "renal", "excretory system", "urinary system"] },
  { seed: "nephron", queries: ["nephron diagram en", "kidney nephron"], keywords: ["nephron", "glomerulus", "bowman's capsule", "loop of henle"] },
  { seed: "eye", queries: ["schematic diagram of the human eye en", "eye diagram"], keywords: ["human eye", "eye", "retina", "cornea", "iris"] },
  { seed: "ear", queries: ["anatomy of the human ear en", "ear diagram"], keywords: ["human ear", "ear", "cochlea", "eardrum", "ossicles"] },
  { seed: "brain", queries: ["brain lobes diagram en", "human brain diagram"], keywords: ["brain", "cerebrum", "cerebellum", "medulla", "lobes of the brain"] },
  { seed: "neurone", queries: ["neuron diagram en", "complete neuron cell diagram"], keywords: ["neurone", "neuron", "nerve cell", "motor neurone", "axon", "dendrite"] },
  { seed: "reflex arc", queries: ["reflex arc diagram en", "reflex arc"], keywords: ["reflex arc", "reflex action", "relay neurone"] },
  { seed: "skin", queries: ["skin layers diagram en", "skin anatomy diagram"], keywords: ["skin", "epidermis", "dermis"] },
  { seed: "skeleton", queries: ["human skeleton front en", "human skeleton diagram"], keywords: ["skeleton", "skeletal system", "bones", "bone"] },
  { seed: "joint", queries: ["synovial joint diagram en", "synovial joint"], keywords: ["synovial joint", "joint", "cartilage", "ligament"] },
  { seed: "male reproductive system", queries: ["male reproductive system en", "male anatomy diagram"], keywords: ["male reproductive system", "testis", "testes", "sperm duct", "prostate"] },
  { seed: "female reproductive system", queries: ["female reproductive system en", "female reproductive system diagram"], keywords: ["female reproductive system", "uterus", "ovary", "ovaries", "oviduct", "fallopian tube"] },
  { seed: "flower", queries: ["mature flower diagram", "flower parts diagram en"], keywords: ["flower", "stamen", "carpel", "pollination", "petal", "anther", "stigma"] },
  { seed: "leaf cross-section", queries: ["leaf tissue structure", "leaf cross section diagram en"], keywords: ["leaf cross-section", "leaf structure", "structure of a leaf", "palisade", "spongy mesophyll", "mesophyll"] },
  { seed: "root hair cell", queries: ["root hair cell diagram", "root hair", "root tip structure en"], keywords: ["root hair cell", "root hair", "root hairs"] },
  { seed: "xylem and phloem", queries: ["xylem phloem diagram en", "vascular bundle diagram"], keywords: ["xylem", "phloem", "vascular bundle", "transpiration", "translocation"] },
  { seed: "stomata", queries: ["stoma diagram en", "stomata guard cells", "guard cells stoma", "stomata"], keywords: ["stomata", "stoma", "guard cell", "guard cells"] },
  { seed: "villus", queries: ["intestinal villus diagram", "villus en"], keywords: ["villus", "villi", "small intestine", "absorption"] },
  { seed: "synapse", queries: ["synapse diagram en", "chemical synapse schema"], keywords: ["synapse", "synaptic", "neurotransmitter"] },
  { seed: "muscle", queries: ["skeletal muscle diagram en", "muscle fiber structure", "skeletal muscle structure", "blausen skeletal muscle"], keywords: ["skeletal muscle", "muscle fibre", "muscle fiber", "myofibril", "sarcomere"] },
  { seed: "tooth", queries: ["tooth section diagram en", "tooth anatomy", "tooth diagram", "human tooth diagram en"], keywords: ["tooth", "teeth", "enamel", "dentine", "pulp cavity"] },
  { seed: "river meander", queries: ["meander oxbow lake diagram", "oxbow lake formation"], keywords: ["meander", "meanders", "oxbow lake", "ox-bow lake"] },
  { seed: "waterfall formation", queries: ["waterfall formation diagram", "waterfall erosion diagram", "waterfall diagram", "waterfall formation"], keywords: ["waterfall", "plunge pool", "gorge"] },
  { seed: "river long profile", queries: ["river long profile diagram", "river course diagram en", "river profile", "river landforms diagram", "drainage basin diagram"], keywords: ["long profile", "river course", "upper course", "lower course", "river landforms", "drainage basin"] },
  { seed: "coastal landforms", queries: ["coastal landforms diagram", "spit formation diagram", "wave cut platform diagram", "stack stump arch"] , keywords: ["coastal landforms", "spit", "wave-cut platform", "sea stack", "headland", "longshore drift", "sea arch"] },
  { seed: "volcano", queries: ["volcano cross section en", "volcano diagram"], keywords: ["volcano", "volcanoes", "magma chamber", "eruption", "lava"] },
  { seed: "plate boundaries", queries: ["plate boundaries diagram en", "tectonic plate boundary diagram", "tectonic plate boundaries", "subduction diagram en"], keywords: ["plate boundary", "plate boundaries", "tectonic plates", "subduction", "constructive margin", "destructive margin"] },
  { seed: "rain shadow", queries: ["rain shadow diagram", "orographic rainfall diagram"], keywords: ["rain shadow", "relief rainfall", "orographic rainfall"] },
  { seed: "water cycle", queries: ["water cycle diagram en", "water cycle"], keywords: ["water cycle", "hydrological cycle", "evaporation", "condensation", "precipitation"] },
  { seed: "carbon cycle", queries: ["carbon cycle diagram", "carbon cycle en"], keywords: ["carbon cycle"] },
  { seed: "nitrogen cycle", queries: ["nitrogen cycle diagram", "nitrogen cycle en"], keywords: ["nitrogen cycle", "nitrogen fixation", "nitrification", "denitrification"] },
  { seed: "rock cycle", queries: ["rock cycle diagram en", "rock cycle"], keywords: ["rock cycle", "igneous", "sedimentary", "metamorphic"] },
  { seed: "atmosphere layers", queries: ["atmosphere layers en", "layers of the atmosphere diagram"], keywords: ["layers of the atmosphere", "atmosphere", "troposphere", "stratosphere"] },
  { seed: "earth structure", queries: ["earth interior structure en", "earth layers diagram"], keywords: ["structure of the earth", "earth's structure", "inner core", "outer core", "mantle", "crust"] },
  { seed: "population pyramid", queries: ["population pyramid", "age structure diagram"], keywords: ["population pyramid", "age structure", "age-sex pyramid"] },
];

/* ── network ──────────────────────────────────────────────────────────────────────────────── */

function get(url: string, opts: { front?: string; timeoutMs?: number } = {}): Promise<Buffer> {
  const u = new URL(url);
  const connectHost = opts.front ?? u.hostname;
  return new Promise((resolve, reject) => {
    const req = https.request({ host: connectHost, servername: connectHost, path: u.pathname + u.search, headers: { Host: u.hostname, "User-Agent": UA, "Accept-Encoding": "identity" }, timeout: opts.timeoutMs ?? 30_000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), opts));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(Object.assign(new Error(`HTTP ${res.statusCode} ${url}`), { retryAfter: Number(res.headers["retry-after"] ?? 0) })); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size > MAX_BYTES * 1.2) { req.destroy(new Error("too large")); return; } chunks.push(c); });
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`timeout ${url}`)));
    req.on("error", reject);
    req.end();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url: string, label: string): Promise<Buffer> {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    // Commons' own host is reset from this machine now and then; the same front end answers as meta.
    const front = new URL(url).hostname === "commons.wikimedia.org" && attempt % 2 === 0 ? "meta.wikimedia.org" : undefined;
    try {
      return await get(url, { front });
    } catch (err) {
      last = err;
      if (String(err).includes("too large") || String(err).includes("HTTP 404")) throw err;
      // A 429 (too many requests) waits as long as the server asks, and never less than 20 s.
      const retryAfter = (err as { retryAfter?: number }).retryAfter ?? 0;
      const wait = String(err).includes("HTTP 429") ? Math.max(30_000, retryAfter * 1000) : 1500 * 2 ** attempt;
      console.warn(`  ${label}: ${String(err).slice(0, 80)} — retry in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw last;
}

/* ── search ───────────────────────────────────────────────────────────────────────────────── */

type Page = { title: string; size: number; url: string; descriptionurl: string; meta: Record<string, string>; categories: string[]; revision: number };
const strip = (html: string | undefined) => (html ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const QUALITY = ["Category:Featured pictures on Wikimedia Commons", "Category:Quality images", "Category:Valued images sorted by promotion date"];

async function search(query: string): Promise<Page[]> {
  const q = new URLSearchParams({
    action: "query", format: "json", formatversion: "2",
    generator: "search", gsrnamespace: "6", gsrsearch: `filemime:image/svg+xml ${query}`, gsrlimit: "40",
    prop: "imageinfo|categories|revisions", rvprop: "ids", iiprop: "url|extmetadata|size",
    iiextmetadatafilter: "LicenseShortName|License|LicenseUrl|Artist|Credit|UsageTerms|ObjectName",
    clcategories: QUALITY.join("|"), cllimit: "max",
  });
  const body = await fetchRetry(`https://commons.wikimedia.org/w/api.php?${q}`, `search "${query}"`);
  const json = JSON.parse(body.toString("utf8")) as { query?: { pages?: Array<Record<string, unknown>> } };
  return (json.query?.pages ?? []).map((p) => {
    const ii = ((p.imageinfo as Array<Record<string, unknown>>) ?? [])[0] ?? {};
    const em = (ii.extmetadata as Record<string, { value: string }>) ?? {};
    return {
      title: String(p.title),
      size: Number(ii.size ?? 0),
      url: String(ii.url ?? ""),
      descriptionurl: String(ii.descriptionurl ?? ""),
      meta: Object.fromEntries(Object.entries(em).map(([k, v]) => [k, String(v?.value ?? "")])),
      categories: ((p.categories as Array<{ title: string }>) ?? []).map((c) => c.title),
      revision: Number(((p.revisions as Array<{ revid: number }>) ?? [])[0]?.revid ?? 0),
    };
  });
}

export type Candidate = {
  seed: string;
  title: string;
  url: string;
  page: string;
  size: number;
  author: string;
  licence: string;
  licenceUrl: string;
  revision: number;
  quality: string[];
  preScore: number;
  file: string;
};

function preScore(seed: Seed, p: Page, author: string): number {
  let s = 0;
  if (p.categories.some((c) => c.includes("Featured"))) s += 4;
  if (p.categories.some((c) => c.includes("Quality"))) s += 3;
  if (p.categories.some((c) => c.includes("Valued"))) s += 2;
  if (/ladyofhats|mariana ruiz/i.test(author)) s += 3;
  const lang = fileLanguage(p.title);
  if (lang === "en") s += 2;
  const titleWords = p.title.toLowerCase();
  const subject = [seed.seed, ...seed.keywords].filter((k) => titleWords.includes(k.toLowerCase().replace(/s$/, ""))).length;
  s += subject ? Math.min(3, subject) * 2 : -5;
  if (/\b(blank|no ?labels?|no ?text|without (?:labels|text)|unlabell?ed|numbered|icon|logo|map of|locator|stamp|flag)\b/i.test(p.title)) s -= 6;
  // A diagram OF the thing beats a process that involves it ("Plant cell structure" over "Turgor pressure on plant cells").
  if (/\b(structure|anatomy|diagram|parts|section|cross[- ]section|layers|labell?ed|schematic)\b/i.test(p.title)) s += 2;
  if (/\b(cycle|mitosis|meiosis|division|junction|transport|signal\w*|pathway|osmosis|turgor|propagation|evolution|comparison|wall)\b/i.test(p.title) && !/\b(cycle|wall)\b/i.test(seed.seed)) s -= 6;
  if (p.size > 900_000) s -= 2;
  if (p.size < 12_000) s -= 3;
  return s;
}

async function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  const perSeed = args.includes("--per-seed") ? Number(args[args.indexOf("--per-seed") + 1]) : 6;
  const fresh = args.includes("--fresh");
  fs.mkdirSync(RAW, { recursive: true });
  fs.mkdirSync(SEARCH, { recursive: true });
  const candFile = path.join(CACHE, "candidates.json");
  const all: Candidate[] = fs.existsSync(candFile) && !fresh ? JSON.parse(fs.readFileSync(candFile, "utf8")) : [];
  const counts = { found: 0, licenceOk: 0, rejectedLicence: 0, otherLanguage: 0, tooBig: 0, downloaded: 0, failed: 0 };
  const rejections: Record<string, number> = {};
  const queues: Candidate[][] = [];
  // More subjects for every course (data/figures/seeds-extra.json); duplicates of a built-in seed are skipped.
  const extraFile = path.join(ROOT, "data/figures/seeds-extra.json");
  const extra: Seed[] = fs.existsSync(extraFile) ? JSON.parse(fs.readFileSync(extraFile, "utf8")) : [];
  const allSeeds = [...SEEDS, ...extra.filter((e) => !SEEDS.some((s) => s.seed === e.seed))];
  for (const seed of allSeeds) {
    if (only && !only.includes(seed.seed)) continue;
    const cacheFile = path.join(SEARCH, `${seed.seed.replace(/[^a-z0-9]+/gi, "-")}.json`);
    let pages: Page[];
    if (fs.existsSync(cacheFile) && !fresh) pages = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    else {
      const seen = new Map<string, Page>();
      for (const q of seed.queries) {
        try { for (const p of await search(q)) if (!seen.has(p.title)) seen.set(p.title, p); }
        catch (err) { console.warn(`  search failed for "${q}": ${String(err).slice(0, 100)}`); }
        await sleep(600);
      }
      pages = [...seen.values()];
      if (pages.length) fs.writeFileSync(cacheFile, JSON.stringify(pages));
    }
    counts.found += pages.length;
    const ranked: Candidate[] = [];
    for (const p of pages) {
      const gate = licenceGate(p.meta.LicenseShortName, p.meta.License);
      if (!gate.ok) { counts.rejectedLicence++; rejections[gate.reason.replace(/\(.*\)/, "").trim()] = (rejections[gate.reason.replace(/\(.*\)/, "").trim()] ?? 0) + 1; continue; }
      counts.licenceOk++;
      if (fileLanguage(p.title) === "other") { counts.otherLanguage++; continue; }
      if (p.size > MAX_BYTES || !p.url) { counts.tooBig++; continue; }
      const author = strip(p.meta.Artist).replace(/^(?:author|own work)[:\s]*/i, "").slice(0, 80) || "Unknown author";
      ranked.push({
        seed: seed.seed, title: p.title.replace(/^File:/, ""), url: p.url.split("?")[0], page: p.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
        size: p.size, author, licence: gate.licence, licenceUrl: p.meta.LicenseUrl || (gate.licence === "Public domain" ? "https://en.wikipedia.org/wiki/Public_domain" : ""),
        revision: p.revision, quality: p.categories.map((c) => c.replace(/^Category:/, "")), preScore: preScore(seed, p, author),
        file: `${createHash("sha1").update(p.title).digest("hex").slice(0, 16)}.svg`,
      });
    }
    ranked.sort((a, b) => b.preScore - a.preScore);
    // Only files whose title names the subject are worth an original download (one a minute).
    const named = (c: Candidate) => { const t = words(c.title.replace(/\.svg$/i, "")); return [seed.seed, ...seed.keywords].some((k) => { const kw = words(k); return kw.length > 0 && kw.every((w) => t.includes(w)); }); };
    queues.push(ranked.filter(named).slice(0, perSeed));
    console.log(`${seed.seed}: ${pages.length} found, ${ranked.length} usable → ${queues[queues.length - 1].map((c) => `${c.title} (${c.preScore})`).join(" | ")}`);
  }
  // Downloads go round-robin — every seed's best file first, then every seed's second — so a run
  // cut short by the rate limit still covers every subject.
  const order: Candidate[] = [];
  for (let r = 0; r < perSeed; r++) for (const q of queues) if (q[r]) order.push(q[r]);
  const record = (c: Candidate) => {
    const prior = all.findIndex((x) => x.title === c.title && x.seed === c.seed);
    if (prior >= 0) all[prior] = c; else all.push(c);
    fs.writeFileSync(candFile, JSON.stringify(all, null, 1));
  };
  const fetched = new Set(fs.readdirSync(RAW));
  for (const c of order) {
    if (fetched.has(c.file)) { record(c); continue; }
    try {
      const body = await fetchRetry(c.url, c.title);
      fs.writeFileSync(path.join(RAW, c.file), body);
      fetched.add(c.file);
      counts.downloaded++;
      record(c);
      console.log(`  ↓ ${c.seed}: ${c.title} (${Math.round(body.length / 1000)} KB) [${counts.downloaded}/${order.length}]`);
      // upload.wikimedia.org allows about ten originals per ten minutes from one address (429 with
      // Retry-After: 600 past that), so originals are fetched one a minute.
      await sleep(62_000);
    } catch (err) {
      counts.failed++;
      console.warn(`  download failed ${c.title}: ${String(err).slice(0, 100)}`);
    }
  }
  console.log(JSON.stringify({ ...counts, rejections, candidates: all.length }, null, 1));
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main().catch((err) => { console.error(err); process.exit(1); });
