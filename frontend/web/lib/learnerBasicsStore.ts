import "server-only";

import { users, type UserDoc } from "./db/cosmos";
import { learnSubjectContext } from "./learnerBasics";
import { loadLearnerMemory } from "./learnerMemoryStore";
import { buildStudentCard, type StudentCard } from "./studentCard";

/**
 * After a lesson starts: let the learner profile learn what that lesson said about the student's
 * level and curriculum in one of their subjects (lib/learnerBasics.ts learnSubjectContext). Read,
 * update, replace — only when something new was learned, so most lessons cost one read.
 */
export async function learnFromLesson(userId: string, topic: string, background?: string | null): Promise<boolean> {
  const item = users().item(userId, userId);
  const { resource: user } = await item.read<UserDoc>();
  if (!user?.profile?.learner) return false;
  const learned = learnSubjectContext(user.profile.learner, topic, background);
  if (!learned) return false;
  await item.replace({ ...user, profile: { ...user.profile, learner: learned, updatedAt: new Date().toISOString() } });
  return true;
}

/**
 * The student card for one lesson (lib/studentCard.ts), from the profile on the user record and the
 * student's own "simpler" / "deeper" tallies in their memory. Null for a student with no profile.
 */
export async function studentCardFor(userId: string, topic: string): Promise<StudentCard | null> {
  const [{ resource: user }, memory] = await Promise.all([
    users().item(userId, userId).read<UserDoc>(),
    loadLearnerMemory(userId).catch(() => null),
  ]);
  return buildStudentCard(user?.profile?.learner ?? null, topic, { simpler: memory?.signals?.simpler, deeper: memory?.signals?.deeper });
}
