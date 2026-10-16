import "server-only";

import { users, type UserDoc } from "./db/cosmos";
import { loadLearnerMemory } from "./learnerMemoryStore";
import { buildStudentCard, type StudentCard } from "./studentCard";

/**
 * The student card for one lesson (lib/studentCard.ts), from the profile on the user record (with
 * how they like to learn and the support they chose) and the student's own "simpler" / "deeper" /
 * "more examples" tallies in their memory. Null for a student with no profile. lib/teachingPolicy.ts
 * turns it into how to teach.
 */
export async function studentCardFor(userId: string, topic: string): Promise<StudentCard | null> {
  const [{ resource: user }, memory] = await Promise.all([
    users().item(userId, userId).read<UserDoc>(),
    loadLearnerMemory(userId).catch(() => null),
  ]);
  const profile = user?.profile;
  return buildStudentCard(
    profile?.learner ?? null,
    topic,
    { simpler: memory?.signals?.simpler, deeper: memory?.signals?.deeper, moreExamples: memory?.signals?.["more-examples"] },
    { simplerLanguage: profile?.simplerLanguage, slowerPace: profile?.slowerPace, accessibility: profile?.accessibility },
  );
}
