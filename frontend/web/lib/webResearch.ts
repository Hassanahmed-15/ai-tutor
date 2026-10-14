import "server-only";

import type OpenAI from "openai";
import { createOpenAI, spendScopeNow } from "./openaiClient";
import { recordSpend } from "./spend/record";
import { usdForUsage } from "./spend/usage";
import { webResearch } from "./db/cosmos";
import { briefLine } from "./lessonIntent";
import { betterChecklist, cleanUrl, jsonIn, packFromResearch, researchKey, sameUrl, sanitizeSourcePack, type LessonBrief, type SourcePack } from "./webSources";

/**
 * READING UP BEFORE TEACHING: OpenAI web search, once per new topic, cached for everyone.
 *
 * Once Aria knows what the student wants (lib/lessonIntent.ts), this searches the web for the
 * material and returns a SourcePack (lib/webSources.ts): what the syllabus expects, the facts to
 * teach from, and the pages each fact came from. The lecture is planned and taught from it, and each
 * slide ends with its links.
 *
 * TWO SEARCHES, IN PARALLEL, when a curriculum is named. Measured 2026-10-14: one search asked for
 * "the syllabus and the content" read the syllabus PDF and stopped — one source, every slide citing
 * the same link, and none of the named terms it explains. So one search reads the SYLLABUS (what to
 * learn: the checklist) and the other reads TEACHING PAGES at that level (how it works: the facts,
 * from several sites). A reasoning model searching in steps did better but took 40-60 s and
 * $0.14; these two take about 10 s and 5 cents together. A request with no curriculum gets the
 * content search alone.
 *
 * The links are the ones the SEARCH cited (its url_citation annotations), not URLs the model wrote
 * from memory. It never blocks a lesson: any failure returns null and planning goes on as before.
 */

const MODEL = process.env.WEB_RESEARCH_MODEL ?? "gpt-4o-mini";
const SEARCH_CALL_USD = Number(process.env.WEB_SEARCH_CALL_USD) || 0.025;
const TIMEOUT_MS = Number(process.env.WEB_RESEARCH_TIMEOUT_MS) || 45_000;

const JSON_SHAPE = `Return ONLY a JSON object — no prose before or after it, no markdown fence:
{"curriculum": string|null, "checklist": [string], "points": [{"text": string, "urls": [string]}]}`;

const NAMED_TERMS = `EVERY checklist item names the specific structures, terms, processes or quantities a student must know — never a broad heading. Good: "limiting factors of photosynthesis: light intensity, carbon dioxide concentration, temperature". Bad: "factors affecting photosynthesis". Good: "the stages of mitosis: prophase, metaphase, anaphase, telophase". Bad: "cell division".`;

/** What to learn: the exam board's own syllabus for this topic. */
const SYLLABUS_SEARCH = `You find what an exam syllabus requires for one topic. Search for the exam board's official syllabus or specification (the board's own site or PDF) for the curriculum named below, find the section on this topic, and read what students must know.
${JSON_SHAPE}
- "curriculum": the syllabus, with its code when you found it, or null.
- "checklist": every learning point the syllabus lists for THIS topic at THIS level (core and supplement), 10 to 25 items, in the syllabus's own terms. ${NAMED_TERMS}
- "points": up to 12 short facts stating what the syllabus says, each with the URL it came from.`;

/** How it works: teaching pages at the student's level, from several sites. */
const CONTENT_SEARCH = `You gather teaching material on a topic for a tutor who will teach it to the student described below. Search for pages that EXPLAIN the topic at THAT level. Read and cite AT LEAST FOUR DIFFERENT WEBSITES (different domains). For a school curriculum, prefer its revision sites — Save My Exams, BBC Bitesize, Cognito, Physics & Maths Tutor, Khan Academy — and Wikipedia; for university level, OpenStax, Britannica and university pages. Avoid forums, ads and AI-written content farms.
${JSON_SHAPE}
- "curriculum": the curriculum these pages are for, or null.
- "checklist": the key ideas a good lesson on this request must cover — 6 to 15 for a topic, 1 to 4 for one specific question. ${NAMED_TERMS}
- "points": 15 to 30 facts to teach from, one accurate sentence each at the student's level, that together explain every checklist item using its exact terms. Each lists the URLs of the pages that state it — only pages you found in this search — spread across your sources.`;

/** Bumped whenever the research changes, so older, thinner research is not reused from the cache. */
const RESEARCH_VERSION = "v8";

type Found = { pack: SourcePack; costUsd: number; cached: boolean };
type Searched = { json: Record<string, unknown> | null; cited: Array<{ url: string; title: string }>; costUsd: number; searches: number };

const memoryCache = new Map<string, SourcePack>();

async function cacheGet(key: string): Promise<SourcePack | null> {
  if (!process.env.COSMOS_CONNECTION_STRING) return memoryCache.get(key) ?? null;
  try {
    const container = await webResearch();
    const { resource } = await container.item(key, key).read<{ pack?: unknown }>();
    return resource ? sanitizeSourcePack(resource.pack) : null;
  } catch {
    return null;
  }
}

async function cachePut(key: string, pack: SourcePack): Promise<void> {
  memoryCache.set(key, pack);
  if (!process.env.COSMOS_CONNECTION_STRING) return;
  try {
    const container = await webResearch();
    await container.items.upsert({ id: key, pack, at: new Date().toISOString() });
  } catch (error) {
    console.warn("[research] could not cache:", error instanceof Error ? error.message : error);
  }
}

/** The pages the search cited, from the response's annotations: title and URL, as the search gave them. */
function citedPages(response: OpenAI.Responses.Response): Array<{ url: string; title: string }> {
  const pages: Array<{ url: string; title: string }> = [];
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type !== "output_text") continue;
      for (const a of part.annotations ?? []) {
        if (a.type !== "url_citation") continue;
        const url = cleanUrl(a.url);
        if (url && !pages.some((p) => sameUrl(p.url) === sameUrl(url))) pages.push({ url, title: a.title ?? "" });
      }
    }
  }
  return pages;
}

/** One web search turn; never throws (a failed search is an empty one). */
async function search(openai: OpenAI, instructions: string, input: string, label: string): Promise<Searched> {
  try {
    const response = await openai.responses.create(
      // tool_choice FORCES a search: left to choose, the model often answered from memory (measured
      // 2026-10-14: zero searches, zero citations, links typed from memory — all rightly dropped).
      { model: MODEL, tools: [{ type: "web_search_preview", search_context_size: "medium" }], tool_choice: { type: "web_search_preview" }, instructions, input, max_output_tokens: 5_000 },
      { timeout: TIMEOUT_MS, maxRetries: 0 },
    );
    const searches = (response.output ?? []).filter((item) => item.type === "web_search_call").length;
    const costUsd = (usdForUsage(MODEL, response.usage as Parameters<typeof usdForUsage>[1]) ?? 0) + searches * SEARCH_CALL_USD;
    const json = jsonIn(response.output_text ?? "");
    const cited = citedPages(response);
    if (!json) console.warn(`[research] ${label}: no JSON (status ${response.status}${response.incomplete_details ? `, ${response.incomplete_details.reason}` : ""}); began: ${(response.output_text ?? "").slice(0, 200).replace(/\s+/g, " ")}`);
    return { json, cited, costUsd, searches };
  } catch (error) {
    console.warn(`[research] ${label} failed: ${error instanceof Error ? error.message : error}`);
    return { json: null, cited: [], costUsd: 0, searches: 0 };
  }
}

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Read up on a topic for this brief. Cached by topic + curriculum + goal + scope; null on any failure
 * (no key, timeout, nothing usable) so the lesson is planned exactly as it was before this existed.
 */
export async function researchTopic(args: { topic: string; request?: string; brief?: LessonBrief | null; level?: string }): Promise<Found | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const key = `${RESEARCH_VERSION}|${researchKey(args.topic, args.brief)}`;
  const hit = await cacheGet(key);
  if (hit) return { pack: hit, costUsd: 0, cached: true };

  const query = [
    `Topic: ${args.topic}`,
    args.request && args.request.toLowerCase() !== args.topic.toLowerCase() ? `The student asked: "${args.request.slice(0, 300)}"` : "",
    briefLine(args.brief).trim(),
    args.level ? `The student: ${args.level}` : "",
  ].filter(Boolean).join("\n");

  const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const started = Date.now();
  const curriculum = args.brief?.curriculum && !/general|none/i.test(args.brief.curriculum) ? args.brief.curriculum : null;
  // A forced search reads one or two pages, so the teaching material comes from two searches aimed
  // at different kinds of site — revision and teaching pages, and an encyclopaedia — for a spread of
  // sources the slides can cite ("this from Wikipedia, this from Save My Exams").
  const [syllabus, content, encyclopaedia] = await Promise.all([
    curriculum ? search(openai, SYLLABUS_SEARCH, `${query}\nCurriculum: ${curriculum}`, "syllabus") : Promise.resolve(null),
    search(openai, CONTENT_SEARCH, `${query}\nThis search: revision notes and teaching pages for this level.`, "content"),
    search(openai, CONTENT_SEARCH, `${query}\nThis search: Wikipedia or Britannica — the encyclopaedia articles on this topic.`, "encyclopaedia"),
  ]);
  const costUsd = (syllabus?.costUsd ?? 0) + content.costUsd + encyclopaedia.costUsd;
  // The search fees are not in the token usage, and /responses is not metered by createOpenAI: logged here.
  const scope = await spendScopeNow();
  recordSpend({ ...scope, kind: "planning", model: `${MODEL}+web_search`, endpoint: "responses", usd: costUsd });

  // The syllabus says WHAT to learn (its checklist wins); every search's facts are the material.
  const merged: Record<string, unknown> | null = syllabus?.json || content.json || encyclopaedia.json
    ? {
        curriculum: syllabus?.json?.curriculum ?? content.json?.curriculum ?? null,
        checklist: betterChecklist(syllabus?.json?.checklist, content.json?.checklist ?? encyclopaedia.json?.checklist),
        points: [...list(content.json?.points), ...list(encyclopaedia.json?.points), ...list(syllabus?.json?.points)],
      }
    : null;
  const pack = packFromResearch(merged, [...(syllabus?.cited ?? []), ...content.cited, ...encyclopaedia.cited], query);
  const searches = (syllabus?.searches ?? 0) + content.searches + encyclopaedia.searches;
  console.log(`[research] "${args.topic}" ${pack ? `${pack.sources.length} sources, ${pack.points.length} points, ${pack.checklist.length} checklist` : "nothing usable"} in ${Math.round((Date.now() - started) / 1000)}s, ${searches} search(es), $${costUsd.toFixed(4)}`);
  if (!pack) return null;
  await cachePut(key, pack);
  return { pack, costUsd, cached: false };
}
