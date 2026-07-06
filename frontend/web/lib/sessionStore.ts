import "server-only";
import {
  TutorSession,
  MockTutorReasoningProvider,
  OpenAITutorReasoningProvider,
  type TutorReasoningProvider,
} from "@aria/tutor-reasoning";
import { getLens, type ModalityLens } from "@aria/modality-lenses";

/**
 * In-memory session store. Acceptable for MVP only: sessions vanish on server restart
 * and this does not scale beyond a single Node process. README Section 9 lists
 * persistence/multi-instance scaling as not-yet-solved rather than pretending this is
 * production-ready — swapping this for a real store (Redis/Postgres) is a clean swap
 * because every route below only talks to this module, never to TutorSession directly.
 */
interface SessionRecord {
  session: TutorSession;
  lens: ModalityLens;
}

const sessions = new Map<string, SessionRecord>();

const mockProvider = new MockTutorReasoningProvider();

/** Topics the hand-written mock provider has deterministic content for. */
const MOCK_TOPICS = new Set(["binary-search", "water-cycle", "rag", "molecules"]);

let openAIProvider: OpenAITutorReasoningProvider | null = null;
function getOpenAIProvider(): OpenAITutorReasoningProvider | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openAIProvider) openAIProvider = new OpenAITutorReasoningProvider();
  return openAIProvider;
}

/**
 * Picks the provider: seeded topics use the deterministic mock (fast, no cost, no key).
 * Any other (user-typed) topic uses the OpenAI provider when a key is configured —
 * that's what makes "type any topic" work. With no key, only the seeded topics exist.
 */
function pickProvider(topic: string): TutorReasoningProvider {
  if (MOCK_TOPICS.has(topic)) return mockProvider;
  const openai = getOpenAIProvider();
  if (openai) return openai;
  throw new Error(
    `No content for "${topic}". Seed it in backend/content/, or set OPENAI_API_KEY in frontend/web/.env.local to generate lessons for any topic.`
  );
}

export function createSession(
  subject: string,
  topic: string,
  lensId: ModalityLens["id"] = "default"
): { id: string; session: TutorSession; lens: ModalityLens } {
  const provider = pickProvider(topic);
  const session = new TutorSession(provider, subject, topic);
  const lens = getLens(lensId);
  const id = crypto.randomUUID();
  sessions.set(id, { session, lens });
  return { id, session, lens };
}

export function getSessionRecord(id: string): SessionRecord | undefined {
  return sessions.get(id);
}

export function getSession(id: string): TutorSession | undefined {
  return sessions.get(id)?.session;
}
