import { nextId } from "@aria/lesson-graph";
import type { LessonNode, StructuredVisual } from "@aria/lesson-graph";
import { getCorpus, toCitation } from "@aria/grounding";
import type { TutorReasoningProvider } from "../provider";

/**
 * Mock provider: no LLM call, deterministic, hand-written teaching sequence for the
 * one seeded topic (binary search). This exists so the whole pipeline — Lesson Graph,
 * Modality Lenses, UI, interrupt handling — can be built and demoed before any API key
 * is wired in (per the "no keys yet" decision). It follows the exact walkthrough in
 * README Section 6, so what you see in the demo matches what the README promises.
 *
 * Swapping this for a real LLM-backed provider later means implementing
 * TutorReasoningProvider against an actual model and pointing apps/web at it —
 * this file does not need to change.
 */
export class MockTutorReasoningProvider implements TutorReasoningProvider {
  async planLesson({ subject, topic }: { subject: string; topic: string }): Promise<LessonNode[]> {
    if (topic !== "binary-search") {
      throw new Error(
        `MockTutorReasoningProvider only has seeded content for "binary-search" (README Section 8/9: one subject seeded deeply for MVP). Got "${topic}".`
      );
    }

    const corpus = getCorpus(topic);
    if (!corpus) {
      throw new Error(`No corpus found for topic "${topic}".`);
    }
    const factById = (id: string) => {
      const fact = corpus.facts.find((f) => f.id === id);
      if (!fact) throw new Error(`Corpus for "${topic}" is missing expected fact "${id}".`);
      return fact;
    };

    const sortedArray: StructuredVisual = {
      primitive: "array",
      elements: [12, 19, 27, 34, 41, 56, 63, 78].map((value, i) => ({
        id: `el_${i}`,
        label: String(value),
        value,
      })),
    };

    const midHighlighted: StructuredVisual = {
      ...sortedArray,
      elements: sortedArray.elements.map((el, i) => ({ ...el, emphasis: i === 3 })),
    };

    const halfDiscarded: StructuredVisual = {
      ...sortedArray,
      elements: sortedArray.elements.map((el, i) => ({ ...el, emphasis: i === 3 })),
      relations: [
        { from: "el_4", to: "el_7", kind: "compares-to", label: "discarded — too high" },
      ],
    };

    return [
      {
        id: nextId("node"),
        type: "hook",
        concept: "binary-search",
        narration:
          "Say you're looking for a name in a sorted phone book. You wouldn't start at page one and read every name — you'd flip to the middle and decide which half to keep looking in. That's binary search.",
        strategy: "analogy",
      },
      {
        id: nextId("node"),
        type: "definition",
        concept: "binary-search-precondition",
        narration:
          "Binary search only works on data that's already sorted. If the array isn't sorted, the comparisons we're about to make don't tell us anything useful.",
        strategy: "definition",
        citations: [toCitation(corpus, factById("fact-precondition"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "diagram",
        concept: "binary-search-mechanism",
        narration:
          "Here's our sorted array. We're searching for 41. We start by checking the middle element.",
        visual: sortedArray,
        strategy: "visual-first",
        citations: [toCitation(corpus, factById("fact-mechanism"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "example",
        concept: "binary-search-mechanism",
        narration:
          "The middle element is 34. Our target, 41, is bigger than 34 — so the answer can only be in the right half. We just eliminated the entire left half in one comparison.",
        visual: midHighlighted,
        strategy: "worked-example",
        citations: [toCitation(corpus, factById("fact-mechanism"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "diagram",
        concept: "binary-search-elimination",
        narration:
          "We repeat the same idea on the right half: pick the new middle, compare, discard a half. Each step cuts the remaining search space in half, which is why this is so much faster than checking every element one by one.",
        visual: halfDiscarded,
        strategy: "visual-first",
        citations: [toCitation(corpus, factById("fact-complexity"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "checkpoint",
        concept: "binary-search-termination",
        narration:
          "Quick check before we move on: if we keep cutting the range in half, what happens when there's nothing left to check — how do we know the target just isn't in the array at all?",
        checkpoint: {
          prompt: "What signals that the target is not present in the array?",
          expectedAnswerKind: "prediction",
        },
        citations: [toCitation(corpus, factById("fact-termination"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "recap",
        concept: "binary-search",
        narration:
          "So: binary search needs sorted data, compares the target to the middle element, discards half the range each time, and finishes either by finding the target or by running out of range to check. That's how you get from checking every element to checking only a handful, even in a huge array.",
        strategy: "definition",
      },
    ];
  }

  async resolveInterrupt({
    interruptedNode,
    studentUtterance,
  }: {
    interruptedNode: LessonNode;
    studentUtterance: string;
  }): Promise<LessonNode[]> {
    const lower = studentUtterance.toLowerCase();

    // Mock pattern-matches the exact interrupt from README Section 6 so the signature
    // "annotate, don't restart" interrupt flow is demonstrable end-to-end without an LLM.
    if (lower.includes("why") && (lower.includes("half") || lower.includes("discard") || lower.includes("ignore"))) {
      return [
        {
          id: nextId("node"),
          type: "analogy",
          concept: interruptedNode.concept,
          narration:
            "Like a phone book — you don't check every page. Once you know the name you want comes after the page you're on, you don't need to look at any earlier page ever again, because the book is sorted. Same here: once we know 41 is bigger than the middle, 34, every value to the left of 34 is also smaller than 41, so none of them can be the answer.",
          strategy: "analogy",
        },
      ];
    }

    return [
      {
        id: nextId("node"),
        type: "analogy",
        concept: interruptedNode.concept,
        narration: `Good question. Let's slow down on "${interruptedNode.concept}": ${studentUtterance}`,
        strategy: "analogy",
      },
    ];
  }

  async evaluateCheckpointResponse({
    studentResponse,
  }: {
    node: LessonNode;
    studentResponse: string;
  }): Promise<{ understood: boolean; feedback: string }> {
    const lower = studentResponse.toLowerCase();
    const mentionsCrossedPointers =
      lower.includes("cross") || lower.includes("low") || lower.includes("high") || lower.includes("empty") || lower.includes("no more");

    if (mentionsCrossedPointers) {
      return {
        understood: true,
        feedback: "Exactly — once the search range becomes empty (the low and high pointers cross), the target isn't in the array.",
      };
    }

    return {
      understood: false,
      feedback:
        "Close — think about the two pointers marking the start and end of the range we're still searching. What happens to them as we keep discarding halves?",
    };
  }
}
