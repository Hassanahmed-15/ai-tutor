export type ForkWorld = {
  title: string;
  chain: string[];
};

export type ConceptFork = {
  id: string;
  change: string;
  whyItMatters: string;
  predictionQuestion: string;
  choices: string[];
  correctIndex: number;
  before: ForkWorld;
  after: ForkWorld;
  reveal: string;
  transferQuestion: string;
};

export type LearningTwinEvent = {
  id: string;
  topic: string;
  beatId: string;
  beatTitle: string;
  change: string;
  correct: boolean;
  confidence: number;
  createdAt: string;
};

export const LEARNING_TWIN_STORAGE_KEY = "aria-learning-twin-v1";

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item, maxLength)).filter(Boolean).slice(0, maxItems)
    : [];
}

export function sanitizeConceptFork(raw: unknown, fallbackTitle: string): ConceptFork | null {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const choices = stringList(obj.choices, 3, 90);
  const beforeRaw = obj.before && typeof obj.before === "object" ? obj.before as Record<string, unknown> : {};
  const afterRaw = obj.after && typeof obj.after === "object" ? obj.after as Record<string, unknown> : {};
  const beforeChain = stringList(beforeRaw.chain, 4, 82);
  const afterChain = stringList(afterRaw.chain, 4, 82);
  const correctIndex = Number(obj.correctIndex);
  const change = text(obj.change, 100);
  const predictionQuestion = text(obj.predictionQuestion, 180);
  const reveal = text(obj.reveal, 320);
  if (!change || !predictionQuestion || choices.length !== 3 || beforeChain.length < 2 || afterChain.length < 2 || !reveal) return null;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= choices.length) return null;

  return {
    id: text(obj.id, 50) || `fork-${Date.now()}`,
    change,
    whyItMatters: text(obj.whyItMatters, 180) || `This changes one condition in ${fallbackTitle}.`,
    predictionQuestion,
    choices,
    correctIndex,
    before: {
      title: text(beforeRaw.title, 54) || "As taught",
      chain: beforeChain,
    },
    after: {
      title: text(afterRaw.title, 54) || "With one rule changed",
      chain: afterChain,
    },
    reveal,
    transferQuestion: text(obj.transferQuestion, 180) || "Where else would the same causal rule apply?",
  };
}

