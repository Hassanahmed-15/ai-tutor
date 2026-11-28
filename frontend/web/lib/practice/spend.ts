import "server-only";
import { withSpendScope } from "@/lib/spend/scope";

/**
 * Every practice-exam call goes into Aria's spend log under the tag "practice-exam" (kind "questions", with the
 * student's account). The OpenAI client (lib/openaiClient.ts createOpenAI) writes the row itself, once per call:
 * nothing here records it again.
 */
export const PRACTICE_SPEND_TAG = "practice-exam";

export function practiceSpend<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  return withSpendScope({ tag: PRACTICE_SPEND_TAG, kind: "questions", userId }, fn);
}
