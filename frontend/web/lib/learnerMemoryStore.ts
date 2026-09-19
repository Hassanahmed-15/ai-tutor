import "server-only";

import { ensureContainers, learnerProfiles } from "./db/cosmos";
import { emptyMemory, parseMemory, type LearnerMemory } from "./learnerModel";

/**
 * Persistence for lib/learnerModel.ts: one document per student in the `learner-profiles` container,
 * beside (not replacing) the existing five-field profile document.
 *
 * Writes are read-modify-write with an etag check. A checkpoint answer and the end of a lecture can
 * land at the same moment, and a blind overwrite would silently drop whichever came first. On a
 * conflict the change is re-applied to the fresh copy, once; a second conflict is given up on and
 * logged, because losing one piece of evidence is better than failing the student's request.
 */
type MemoryDoc = LearnerMemory & { id: string; userId: string; kind: "learner-memory" };

const docId = (userId: string) => `memory:${userId}`;

async function readDoc(userId: string): Promise<{ memory: LearnerMemory; etag: string | null }> {
  await ensureContainers();
  try {
    const { resource, etag } = await learnerProfiles().item(docId(userId), userId).read<MemoryDoc>();
    if (!resource) return { memory: emptyMemory(), etag: null };
    return { memory: parseMemory(resource), etag: etag ?? null };
  } catch (error) {
    if ((error as { code?: number }).code === 404) return { memory: emptyMemory(), etag: null };
    throw error;
  }
}

export async function loadLearnerMemory(userId: string): Promise<LearnerMemory> {
  return (await readDoc(userId)).memory;
}

/** Apply `change` to the stored memory and save it. Returns what was saved. */
export async function updateLearnerMemory(
  userId: string,
  change: (memory: LearnerMemory) => LearnerMemory,
): Promise<LearnerMemory> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { memory, etag } = await readDoc(userId);
    const next = change(memory);
    const doc: MemoryDoc = { ...next, id: docId(userId), userId, kind: "learner-memory" };
    try {
      if (etag) {
        await learnerProfiles().item(doc.id, userId).replace(doc, { accessCondition: { type: "IfMatch", condition: etag } });
      } else {
        await learnerProfiles().items.create(doc);
      }
      return next;
    } catch (error) {
      const code = (error as { code?: number }).code;
      // 412: someone else wrote since we read. 409: someone else created it first. Retry once.
      if ((code === 412 || code === 409) && attempt === 0) continue;
      throw error;
    }
  }
  throw new Error("learner memory update conflicted twice");
}

/** "Forget everything": the student's right to a clean slate. */
export async function deleteLearnerMemory(userId: string): Promise<void> {
  await ensureContainers();
  try {
    await learnerProfiles().item(docId(userId), userId).delete();
  } catch (error) {
    if ((error as { code?: number }).code !== 404) throw error;
  }
}
