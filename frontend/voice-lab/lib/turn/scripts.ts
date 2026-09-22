/**
 * WHAT THE TUTOR SAYS IN EACH MODE — scripted, so a test run is repeatable.
 *
 *   normal    a lecture: the tutor narrates continuously; interruptions are expensive.
 *   pdf       the same, but the material is a document and questions point at pages and figures.
 *   chat      WhatsApp-style: the tutor is idle until spoken to, then replies and goes quiet.
 *   planning  the tutor asks questions and WAITS — a plain answer must count as a turn.
 */
import type { LabMode } from "./livePipeline";

export const LECTURE_SENTENCES = [
  "Let's look at the demand curve for a moment.",
  "The curve slopes downward because as price rises, quantity demanded falls.",
  "Economists call the reason for that the substitution effect.",
  "When coffee gets expensive, some people switch to tea, so less coffee is bought at the higher price.",
  "There is also an income effect: a higher price makes your money go less far, so you buy less of everything.",
  "Put those two together and you get the downward slope we see on the board.",
  "Now notice what happens when we move along the curve rather than shifting it.",
  "A change in the good's own price moves you along the curve; a change in anything else shifts the whole curve.",
  "That distinction is the single most common mistake on exams, so hold onto it.",
  "Next we'll draw the supply curve on the same axes and find where the two meet.",
];

export const PDF_SENTENCES = [
  "We're reading from page three of your document, the section headed Elasticity.",
  "Figure two shows two demand curves, one steep and one shallow.",
  "The shallow one is elastic: a small price change produces a large change in quantity.",
  "The steep one is inelastic: quantity barely moves when the price changes.",
  "The formula on page four defines elasticity as the percentage change in quantity over the percentage change in price.",
  "Table one lists elasticities for coffee, petrol and cinema tickets, and petrol is the least elastic of the three.",
  "That is why a petrol tax raises revenue without cutting consumption much.",
  "On page five the author applies the same idea to supply.",
];

export const CHAT_GREETING = ["Hi, I'm here whenever you want to ask something about demand curves."];

export const PLANNING_QUESTIONS = [
  "Before we plan the lesson, tell me: have you seen a demand curve before?",
  "Got it. Would you rather start with the intuition or with the maths?",
  "And roughly how long do you have today, ten minutes or thirty?",
  "Perfect, I have what I need. I'll build the lesson now.",
];

export function replyFor(mode: LabMode, transcript: string): string[] {
  const heard = transcript.trim() ? `You asked: ${transcript.trim()}.` : "I heard you, but I didn't catch the words.";
  if (mode === "planning") return [heard, "Thanks, that helps."];
  if (mode === "chat") return [heard, "The demand curve slopes down because people buy less when things cost more. Anything else?"];
  return [heard, "Good question. The sign is negative because quantity falls as price rises, so the slope of the line is negative.", "Let me pick the lecture back up where we were."];
}

export const TOPIC_WORDS = ["demand", "curve", "price", "quantity", "slope", "downward", "substitution", "income", "elastic", "elasticity", "supply", "petrol", "figure", "page"];
