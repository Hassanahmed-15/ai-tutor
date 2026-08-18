import type { AccessibilityProfile } from "@/lib/db/cosmos";

/**
 * How each accessibility profile is presented, and the independent preferences that sit alongside.
 *
 * Shared by onboarding and settings so the two screens cannot drift — the failure mode otherwise is
 * a profile that reads one way when you pick it and another when you go back to change it.
 *
 * Phrasing is first-person and plain ("I use a screen reader"), not clinical. This is a form about
 * someone's body and mind and should not read like an intake questionnaire. Each `effect` says what
 * the lecture actually DOES differently, because a choice with no visible consequence is not worth
 * asking for.
 */
export type ProfileOption = {
  value: AccessibilityProfile;
  label: string;
  effect: string;
};

export const PROFILE_OPTIONS: ProfileOption[] = [
  {
    value: "none",
    label: "None of these",
    effect: "The standard lecture — spoken narration with an animated board.",
  },
  {
    value: "blind",
    label: "I am blind or use a screen reader",
    effect: "Every drawing is narrated aloud and the whole lesson is keyboard-driven.",
  },
  {
    value: "low-vision",
    label: "I have low vision",
    effect: "Larger type, higher contrast, and the board zooms to whatever is being explained.",
  },
  {
    value: "adhd",
    label: "I have ADHD",
    effect: "Shorter beats, frequent checkpoints, and a pause when attention drifts.",
  },
  {
    value: "dyslexia",
    label: "I have dyslexia",
    effect: "Less text on the board, more spoken explanation, and a dyslexia-friendly typeface.",
  },
  {
    value: "deaf",
    label: "I am deaf or hard of hearing",
    effect: "Everything spoken is also written — nothing lives in audio alone.",
  },
];

export function profileLabel(value: AccessibilityProfile | null): string {
  return PROFILE_OPTIONS.find((o) => o.value === value)?.label ?? "Not set";
}

/**
 * Preferences that genuinely compose, unlike the profile above.
 *
 * Someone using the ADHD profile may also want captions and a slower pace; none of the four
 * contradict each other, which is exactly why they are checkboxes and the profile is not.
 */
export const PREFERENCES: { key: "captions" | "reducedMotion" | "slowerPace" | "simplerLanguage"; label: string; hint: string }[] = [
  { key: "captions", label: "Always caption the narration", hint: "Useful whether or not you can hear it." },
  { key: "reducedMotion", label: "Reduce motion", hint: "Boards appear instead of animating." },
  { key: "slowerPace", label: "Go at a slower pace", hint: "Longer pauses, more time at checkpoints." },
  { key: "simplerLanguage", label: "Use simpler language", hint: "Shorter sentences, fewer clauses." },
];
