import "server-only";
import { TutorSession, MockTutorReasoningProvider } from "@aria/tutor-reasoning";
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

const provider = new MockTutorReasoningProvider();

export function createSession(
  subject: string,
  topic: string,
  lensId: ModalityLens["id"] = "default"
): { id: string; session: TutorSession; lens: ModalityLens } {
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
