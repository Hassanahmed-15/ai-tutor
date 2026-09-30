import "server-only";

import { users, type UserDoc } from "./db/cosmos";
import { learnSubjectContext } from "./learnerBasics";

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
