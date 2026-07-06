import OpenAI from "openai";

/**
 * Real-photo lookup for the mid-lecture "explain this further" question flow (see
 * app/api/explain/route.ts). AI-generated images for a spontaneous follow-up question are often
 * generic/wrong-looking; a real photo of the actual thing is usually better. Two steps:
 *
 *   1. Ask OpenAI (cheap, gpt-4o-mini) to turn the student's question + lecture context into a
 *      short, specific image search query.
 *   2. Look that query up via DuckDuckGo's image search and return the first result that looks
 *      like a real photo rather than an icon/thumbnail.
 *
 * Why DuckDuckGo and not Google: scraping Google Images requires executing its JavaScript (a
 * full headless browser) and still gets blocked/CAPTCHA'd constantly — not viable inside a
 * Next.js API route. DuckDuckGo exposes a simple internal JSON endpoint that plain `fetch` can
 * use directly, no headless browser or API key needed — the standard technique open-source
 * scraping tools use for this. Still unofficial/reverse-engineered (not a published, versioned
 * API), so it can break if DuckDuckGo changes that endpoint — every call here is wrapped so a
 * failure returns `null` rather than throwing, and the caller falls back to AI image generation.
 */

const KEYWORD_MODEL = process.env.IMAGE_SEARCH_KEYWORD_MODEL ?? "gpt-4o-mini";
const MIN_IMAGE_DIMENSION = 400; // shorter side, in pixels — filters out icons/thumbnails
const SCRAPE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const KEYWORD_PROMPT =
  "You turn a student's question into a short, specific image search query that would find a " +
  "real, relevant photograph illustrating the concept (not a diagram, not clip art). 3-8 words, " +
  "concrete nouns, no punctuation. Return JSON only: { \"query\": string }.";

interface DuckDuckGoImageResult {
  image?: string;
  width?: number;
  height?: number;
}

async function generateSearchQuery(client: OpenAI, question: string, context: string): Promise<string | null> {
  try {
    const completion = await client.chat.completions.create({
      model: KEYWORD_MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: KEYWORD_PROMPT },
        { role: "user", content: `Lecture context: "${context || "none"}". Student's question: "${question}".` },
      ],
    });
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as { query?: unknown };
    const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
    return query || null;
  } catch {
    return null;
  }
}

/** DuckDuckGo's image search JSON endpoint requires a short-lived `vqd` token, minted per query
 *  and embedded in the plain search page's HTML — fetch that page first and pull it out. */
async function fetchVqd(query: string): Promise<string | null> {
  try {
    const res = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
      headers: { "User-Agent": SCRAPE_USER_AGENT },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(/vqd=['"]?([\d-]+)['"]?/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function searchDuckDuckGoImages(query: string): Promise<string | null> {
  const vqd = await fetchVqd(query);
  if (!vqd) return null;

  try {
    const url = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": SCRAPE_USER_AGENT, Referer: "https://duckduckgo.com/" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: DuckDuckGoImageResult[] };
    const items = data.results ?? [];
    const good = items.find((item) => item.image && Math.min(item.width ?? 0, item.height ?? 0) >= MIN_IMAGE_DIMENSION);
    return good?.image ?? null;
  } catch {
    return null;
  }
}

/** Returns a direct image URL for the question, or `null` if the keyword step failed, the
 *  scrape failed/broke, or no qualifying result came back. Never throws. */
export async function findWebImageForQuestion(client: OpenAI, question: string, context: string): Promise<string | null> {
  const query = await generateSearchQuery(client, question, context);
  if (!query) return null;
  return searchDuckDuckGoImages(query);
}
