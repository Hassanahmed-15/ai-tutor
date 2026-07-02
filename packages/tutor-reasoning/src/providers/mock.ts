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
    if (topic === "rag") {
      return this.planRag(topic);
    }

    if (topic === "water-cycle") {
      return this.planWaterCycle(topic);
    }

    if (topic === "molecules") {
      return this.planMolecules(topic);
    }

    if (topic !== "binary-search") {
      throw new Error(
        `MockTutorReasoningProvider has seeded content for "binary-search", "water-cycle", and "rag". Got "${topic}".`
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
          "Watch how a good searcher thinks. If a list is already in order, we do not check every number. We stand in the middle, ask one question, and let the answer remove half the work.",
        strategy: "analogy",
      },
      {
        id: nextId("node"),
        type: "definition",
        concept: "binary-search-precondition",
        narration:
          "First teacher rule: this trick only works when the list is sorted. Sorted means every step to the right gets bigger, so a middle number can tell us which side is impossible.",
        strategy: "definition",
        citations: [toCitation(corpus, factById("fact-precondition"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "diagram",
        concept: "binary-search-mechanism",
        narration:
          "Eyes on the board. Here is the ordered list. We are hunting for 41, and I am going to touch the middle first instead of starting at the beginning.",
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
          "The middle is 34. Say it with me: 41 is bigger than 34. That means everything on the left is too small, so we can ignore that whole side in one move.",
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
          "Now the teacher move repeats. Pick the middle of what remains, compare, then cross out the half that cannot contain the answer. This is why the search feels fast.",
        visual: halfDiscarded,
        strategy: "visual-first",
        citations: [toCitation(corpus, factById("fact-complexity"))],
        groundingConfidence: 1,
        scene: {
          template: "shrink",
          caption: "Each guess removes half the list",
          steps: [
            { id: "n12", label: "12" },
            { id: "n19", label: "19" },
            { id: "n27", label: "27" },
            { id: "n34", label: "34" },
            { id: "n41", label: "41", emphasis: true },
            { id: "n56", label: "56" },
            { id: "n63", label: "63" },
            { id: "n78", label: "78" },
          ],
        },
      },
      {
        id: nextId("node"),
        type: "checkpoint",
        concept: "binary-search-termination",
        narration:
          "Your turn. Imagine we keep shrinking the search area. What tells us there is no answer left to find?",
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
          "Here is the whole lesson in teacher language: sorted list, ask the middle, keep the possible side, throw away the impossible side, and stop when you find the target or the search area becomes empty.",
        strategy: "definition",
      },
    ];
  }

  private async planRag(topic: string): Promise<LessonNode[]> {
    const corpus = getCorpus(topic);
    if (!corpus) {
      throw new Error(`No corpus found for topic "${topic}".`);
    }
    const factById = (id: string) => {
      const fact = corpus.facts.find((f) => f.id === id);
      if (!fact) throw new Error(`Corpus for "${topic}" is missing expected fact "${id}".`);
      return fact;
    };

    const ragStudio: StructuredVisual = {
      primitive: "diagram",
      elements: [
        { id: "question", label: "Question", emphasis: true },
        { id: "library", label: "Knowledge shelf" },
        { id: "docs", label: "Retrieved docs" },
        { id: "snippets", label: "Useful snippets" },
        { id: "answer", label: "Draft answer" },
        { id: "citations", label: "Citations" },
      ],
      relations: [
        { from: "question", to: "library", kind: "points-to", label: "Ask the shelf first" },
        { from: "library", to: "docs", kind: "contains", label: "Pull relevant documents" },
        { from: "docs", to: "snippets", kind: "contains", label: "Keep the best evidence" },
        { from: "snippets", to: "answer", kind: "transforms-into", label: "Write with evidence nearby" },
        { from: "answer", to: "citations", kind: "points-to", label: "Show where claims came from" },
      ],
    };

    const retrievalFocus: StructuredVisual = {
      ...ragStudio,
      elements: ragStudio.elements.map((el) => ({
        ...el,
        emphasis: el.id === "question" || el.id === "library" || el.id === "docs",
      })),
    };

    const groundingFocus: StructuredVisual = {
      ...ragStudio,
      elements: ragStudio.elements.map((el) => ({
        ...el,
        emphasis: el.id === "snippets" || el.id === "answer" || el.id === "citations",
      })),
    };

    return [
      {
        id: nextId("node"),
        type: "hook",
        concept: "rag",
        narration:
          "Imagine a teacher who does not answer from memory alone. First, they walk to the class library, pull the right pages, then explain with those pages open. That is the feel of RAG.",
        strategy: "analogy",
      },
      {
        id: nextId("node"),
        type: "diagram",
        concept: "rag-overview",
        narration:
          "Watch the board. A question flies in. The system scans a wall of documents, the relevant ones light up and fly out, and the answer writes itself using only that evidence.",
        visual: ragStudio,
        strategy: "visual-first",
        // Bespoke flying-documents animation (not the generic flowchart kit).
        customScene: "rag-flow",
      },
      {
        id: nextId("node"),
        type: "diagram",
        concept: "rag-retrieval",
        narration:
          "Step one is retrieval. The user asks a question. The system searches a knowledge shelf and pulls documents that look relevant to that question.",
        visual: retrievalFocus,
        strategy: "visual-first",
        citations: [toCitation(corpus, factById("fact-rag-retrieval"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "example",
        concept: "rag-generation",
        narration:
          "Step two is generation. The model reads the useful snippets beside the question, then writes an answer that is shaped by that context.",
        visual: groundingFocus,
        strategy: "worked-example",
        citations: [toCitation(corpus, factById("fact-rag-generation"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "diagram",
        concept: "rag-grounding",
        narration:
          "The special part is grounding. If the answer says something important, the system can point back to a snippet or citation, like a teacher saying: here is where I got that.",
        visual: groundingFocus,
        strategy: "visual-first",
        citations: [
          toCitation(corpus, factById("fact-rag-grounding")),
          toCitation(corpus, factById("fact-rag-citations")),
        ],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "checkpoint",
        concept: "rag-sequence",
        narration:
          "Your turn. Teach it back to me in one clean story. What happens first, what gets retrieved, and why do citations matter?",
        checkpoint: {
          prompt: "Explain RAG as a sequence: question, retrieval, answer, citations.",
          expectedAnswerKind: "prediction",
        },
        citations: [toCitation(corpus, factById("fact-rag-retrieval"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "recap",
        concept: "rag",
        narration:
          "RAG is a model with a research habit. It gets the question, retrieves relevant material, writes with that material in view, and shows sources so the answer can be inspected.",
        strategy: "definition",
      },
    ];
  }

  private async planWaterCycle(topic: string): Promise<LessonNode[]> {
    const corpus = getCorpus(topic);
    if (!corpus) {
      throw new Error(`No corpus found for topic "${topic}".`);
    }
    const factById = (id: string) => {
      const fact = corpus.facts.find((f) => f.id === id);
      if (!fact) throw new Error(`Corpus for "${topic}" is missing expected fact "${id}".`);
      return fact;
    };

    const cycleBase: StructuredVisual = {
      primitive: "diagram",
      elements: [
        { id: "sun", label: "Sun", emphasis: true },
        { id: "ocean", label: "Ocean" },
        { id: "vapor", label: "Vapor" },
        { id: "cloud", label: "Cloud" },
        { id: "rain", label: "Rain" },
        { id: "river", label: "River" },
      ],
      relations: [
        { from: "sun", to: "ocean", kind: "transforms-into", label: "Sun warms surface water" },
        { from: "ocean", to: "vapor", kind: "transforms-into", label: "Liquid water becomes vapor" },
        { from: "vapor", to: "cloud", kind: "transforms-into", label: "Vapor cools into cloud droplets" },
        { from: "cloud", to: "rain", kind: "transforms-into", label: "Heavy droplets fall as rain" },
        { from: "rain", to: "river", kind: "transforms-into", label: "Water gathers and flows back" },
      ],
    };

    const evaporationVisual: StructuredVisual = {
      ...cycleBase,
      elements: cycleBase.elements.map((el) => ({
        ...el,
        emphasis: el.id === "sun" || el.id === "ocean" || el.id === "vapor",
      })),
    };

    const cloudVisual: StructuredVisual = {
      ...cycleBase,
      elements: cycleBase.elements.map((el) => ({
        ...el,
        emphasis: el.id === "vapor" || el.id === "cloud",
      })),
    };

    const rainVisual: StructuredVisual = {
      ...cycleBase,
      elements: cycleBase.elements.map((el) => ({
        ...el,
        emphasis: el.id === "cloud" || el.id === "rain" || el.id === "river",
      })),
    };

    return [
      {
        id: nextId("node"),
        type: "hook",
        concept: "water-cycle",
        narration:
          "Look out a window after rain. The puddle does not stay forever. Today I want you to see water as a traveler: it rises, gathers, falls, and returns.",
        strategy: "visual-first",
      },
      {
        id: nextId("node"),
        type: "diagram",
        concept: "water-cycle-overview",
        narration:
          "Eyes on the board. This is the whole trip: Sun, ocean, vapor, cloud, rain, river. I will teach it as a loop, not as a list to memorize.",
        visual: cycleBase,
        strategy: "visual-first",
        scene: {
          template: "cycle",
          caption: "Water travels in a loop",
          steps: [
            { id: "sun", label: "Sun warms" },
            { id: "evap", label: "Evaporate" },
            { id: "cloud", label: "Cloud" },
            { id: "rain", label: "Rain" },
            { id: "collect", label: "Collect" },
          ],
        },
      },
      {
        id: nextId("node"),
        type: "diagram",
        concept: "evaporation",
        narration:
          "First move: the Sun warms water. Some liquid water gets enough energy to lift into the air as invisible water vapor. That move is called evaporation.",
        visual: evaporationVisual,
        strategy: "visual-first",
        citations: [toCitation(corpus, factById("fact-evaporation"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "example",
        concept: "condensation",
        narration:
          "Now picture that vapor rising into cooler air. Cooler air makes tiny water droplets huddle together. When enough droplets gather, we see a cloud. That is condensation.",
        visual: cloudVisual,
        strategy: "worked-example",
        citations: [toCitation(corpus, factById("fact-condensation"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "diagram",
        concept: "precipitation-collection",
        narration:
          "Last move: the cloud gets heavy. Water falls as rain, then collects in rivers, lakes, soil, and oceans. From there the Sun can start the loop again.",
        visual: rainVisual,
        strategy: "visual-first",
        citations: [
          toCitation(corpus, factById("fact-precipitation")),
          toCitation(corpus, factById("fact-collection")),
        ],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "checkpoint",
        concept: "water-cycle-sequence",
        narration:
          "Your turn. I am going to pause like a teacher would. Tell me the water story in order: what happens after the Sun warms surface water?",
        checkpoint: {
          prompt: "Explain the water cycle in order, starting with the Sun warming surface water.",
          expectedAnswerKind: "prediction",
        },
        citations: [toCitation(corpus, factById("fact-evaporation"))],
        groundingConfidence: 1,
      },
      {
        id: nextId("node"),
        type: "recap",
        concept: "water-cycle",
        narration:
          "Here is the picture to keep: Sun heats water, water evaporates, vapor condenses into clouds, clouds release rain, and collected water returns to the system. It is a cycle because the ending feeds the beginning.",
        strategy: "definition",
      },
    ];
  }

  /**
   * Showcase for the live-sketch engine: the board draws molecules the way a teacher does —
   * atom, then a bond, then the next atom, then a label, then a circled note — paced in
   * sequence. Coordinates are on the 0..100 grid the LiveSketch engine maps to the board.
   */
  private async planMolecules(topic: string): Promise<LessonNode[]> {
    // Water molecule, drawn live: O in the middle, two H's, two bonds, the bend, a note.
    const waterScript = {
      caption: "Let's draw a water molecule, H₂O",
      durationMs: 11000,
      ops: [
        { kind: "shape", shape: "circle", x: 50, y: 48, w: 11, h: 19, color: "#dc2626", at: 0.02 },
        { kind: "label", text: "O", x: 50, y: 51, size: "lg", color: "#dc2626", at: 0.12 },
        { kind: "shape", shape: "line", points: [{ x: 50, y: 48 }, { x: 33, y: 30 }], at: 0.26 },
        { kind: "shape", shape: "circle", x: 30, y: 27, w: 8, h: 14, color: "#2563eb", at: 0.36 },
        { kind: "label", text: "H", x: 30, y: 30, size: "md", color: "#2563eb", at: 0.44 },
        { kind: "shape", shape: "line", points: [{ x: 50, y: 48 }, { x: 67, y: 30 }], at: 0.56 },
        { kind: "shape", shape: "circle", x: 70, y: 27, w: 8, h: 14, color: "#2563eb", at: 0.66 },
        { kind: "label", text: "H", x: 70, y: 30, size: "md", color: "#2563eb", at: 0.72 },
        { kind: "arrow", x1: 38, y1: 60, x2: 62, y2: 60, curved: true, color: "#7c3aed", at: 0.82 },
        { kind: "note", text: "104.5° bent shape", x: 50, y: 75, at: 0.9 },
        { kind: "circleHighlight", x: 50, y: 48, w: 16, h: 26, color: "#16a34a", at: 0.96 },
      ],
    };

    // Methane, drawn live: central C, four H's around it, four bonds.
    const methaneScript = {
      caption: "Now methane, CH₄ — one carbon, four hydrogens",
      durationMs: 11000,
      ops: [
        { kind: "shape", shape: "circle", x: 50, y: 50, w: 10, h: 18, color: "#0f172a", at: 0.02 },
        { kind: "label", text: "C", x: 50, y: 53, size: "lg", color: "#0f172a", at: 0.12 },
        { kind: "shape", shape: "line", points: [{ x: 50, y: 50 }, { x: 50, y: 24 }], at: 0.22 },
        { kind: "label", text: "H", x: 50, y: 20, size: "md", color: "#2563eb", at: 0.3 },
        { kind: "shape", shape: "line", points: [{ x: 50, y: 50 }, { x: 50, y: 76 }], at: 0.4 },
        { kind: "label", text: "H", x: 50, y: 82, size: "md", color: "#2563eb", at: 0.48 },
        { kind: "shape", shape: "line", points: [{ x: 50, y: 50 }, { x: 26, y: 50 }], at: 0.58 },
        { kind: "label", text: "H", x: 21, y: 53, size: "md", color: "#2563eb", at: 0.66 },
        { kind: "shape", shape: "line", points: [{ x: 50, y: 50 }, { x: 74, y: 50 }], at: 0.76 },
        { kind: "label", text: "H", x: 79, y: 53, size: "md", color: "#2563eb", at: 0.84 },
        { kind: "note", text: "4 single bonds → tetrahedral", x: 50, y: 92, at: 0.92 },
      ],
    } as const;

    return [
      {
        id: nextId("node"),
        type: "hook",
        concept: "molecules",
        narration:
          "A molecule is just atoms held together by bonds. Instead of memorizing a picture, watch me draw one, piece by piece, the way you would on a whiteboard.",
        strategy: "analogy",
      },
      {
        id: nextId("node"),
        type: "diagram",
        concept: "water-molecule",
        narration:
          "Start with oxygen in the middle. Now one bond out to a hydrogen. Another bond to a second hydrogen. Notice the two bonds are not straight across — water is bent, about 104.5 degrees.",
        drawScript: waterScript as unknown as LessonNode["drawScript"],
        strategy: "visual-first",
      },
      {
        id: nextId("node"),
        type: "example",
        concept: "methane-molecule",
        narration:
          "Same idea, bigger. Carbon sits in the center and reaches out to four hydrogens, one bond each. Four single bonds means methane spreads out into a tetrahedral shape.",
        drawScript: methaneScript as unknown as LessonNode["drawScript"],
        strategy: "worked-example",
      },
      {
        id: nextId("node"),
        type: "checkpoint",
        concept: "molecule-bonds",
        narration:
          "Your turn. In the water molecule we just drew, how many bonds came out of the oxygen atom?",
        checkpoint: {
          prompt: "How many bonds connect to the oxygen in a water molecule?",
          expectedAnswerKind: "prediction",
        },
      },
      {
        id: nextId("node"),
        type: "recap",
        concept: "molecules",
        narration:
          "Keep the habit you just watched: place the central atom, draw each bond, add each atom, then note the shape. Atoms, bonds, shape — that is how every structure gets read.",
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
    node,
    studentResponse,
  }: {
    node: LessonNode;
    studentResponse: string;
  }): Promise<{ understood: boolean; feedback: string }> {
    const lower = studentResponse.toLowerCase();
    if (node.concept === "molecule-bonds") {
      const saysTwo = /\b(2|two)\b/.test(lower);
      if (saysTwo) {
        return {
          understood: true,
          feedback: "Exactly — two bonds come off the oxygen, one to each hydrogen. That's the H₂O you watched me draw.",
        };
      }
      return {
        understood: false,
        feedback: "Look back at the drawing: the oxygen reached out to two hydrogens, so it's two bonds.",
      };
    }

    if (node.concept === "water-cycle-sequence") {
      const hasEvaporation = lower.includes("evapor") || lower.includes("vapor") || lower.includes("rise");
      const hasCloud = lower.includes("cloud") || lower.includes("condens");
      const hasRain = lower.includes("rain") || lower.includes("precip");
      const hasCollection =
        lower.includes("collect") || lower.includes("river") || lower.includes("ocean") || lower.includes("lake");

      if (hasEvaporation && hasCloud && hasRain && hasCollection) {
        return {
          understood: true,
          feedback:
            "Yes. You told it like a loop: warming, evaporation, clouds, rain, and collection. That is the water cycle picture.",
        };
      }

      return {
        understood: false,
        feedback:
          "You are close. Try telling it as four picture steps: water rises, clouds form, rain falls, water collects.",
      };
    }

    if (node.concept === "rag-sequence") {
      const hasQuestion = lower.includes("question") || lower.includes("ask");
      const hasRetrieval = lower.includes("retriev") || lower.includes("search") || lower.includes("document");
      const hasAnswer = lower.includes("answer") || lower.includes("generate") || lower.includes("write");
      const hasCitation = lower.includes("citation") || lower.includes("source") || lower.includes("evidence");

      if (hasQuestion && hasRetrieval && hasAnswer && hasCitation) {
        return {
          understood: true,
          feedback:
            "Exactly. RAG starts with a question, retrieves useful material, generates with that material nearby, and shows sources so the answer can be checked.",
        };
      }

      return {
        understood: false,
        feedback:
          "Almost. Use this picture: question first, search documents second, write the answer third, show sources last.",
      };
    }

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
