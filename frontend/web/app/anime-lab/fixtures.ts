/**
 * Real generated morph beats, captured from /api/generate-lecture output.
 *
 * WHY THESE ARE CHECKED IN. Whether a lecture contains a TYPE E morph beat is decided by the
 * model at temperature 0.55, and measurement put that at roughly a 55% hit rate — the same topic
 * produces one on one run and not the next. Judging animation QUALITY through that lottery means
 * regenerating a full lecture (~2 minutes, real spend) until one appears.
 *
 * These are the actual ops the pipeline produced, so the lab renders exactly what a student would
 * see, instantly and repeatably. Add to them by copying any morph beat's "draw" object out of a
 * generate-lecture response.
 */
export type MorphFixture = { label: string; title: string; script: Record<string, unknown> };

export const MORPH_FIXTURES: Record<string, MorphFixture> = {
  "demorgan-full": {
    "label": "De Morgan — full board",
    "title": "Transforming Expressions with De Morgan's Law",
    "script": {
      "caption": "Transforming Expressions with De Morgan's Law",
      "durationMs": 50000,
      "ops": [
        {
          "kind": "label",
          "text": "Expression Transformation",
          "x": 50,
          "y": 12,
          "size": "lg",
          "color": "#1e293b",
          "at": 0.05
        },
        {
          "kind": "shape",
          "shape": "rect",
          "x": 28,
          "y": 45,
          "w": 30,
          "h": 16,
          "color": "#2563eb",
          "at": 0.15
        },
        {
          "kind": "morph",
          "shape": "rect",
          "x": 28,
          "y": 45,
          "w": 30,
          "h": 16,
          "toX": 70,
          "toY": 45,
          "text": "NOT(A OR B)",
          "toText": "NOT A AND NOT B",
          "color": "#2563eb",
          "toColor": "#15803d",
          "at": 0.3,
          "morphAt": 0.7
        },
        {
          "kind": "note",
          "text": "negation flips OR to AND",
          "x": 50,
          "y": 76,
          "color": "#d97706",
          "at": 0.8
        }
      ],
      "surface": "paper"
    }
  },
  "demorgan-min": {
    "label": "De Morgan — lone morph",
    "title": "De Morgan's Second Law",
    "script": {
      "caption": "De Morgan's Second Law",
      "durationMs": 48000,
      "ops": [
        {
          "kind": "morph",
          "shape": "rect",
          "x": 30,
          "y": 45,
          "toX": 70,
          "toY": 45,
          "text": "NOT(A OR B)",
          "toText": "NOT A AND NOT B",
          "at": 0.3,
          "morphAt": 0.7
        },
        {
          "kind": "note",
          "text": "disjunction negated becomes conjunction",
          "x": 50,
          "y": 75,
          "at": 0.8
        }
      ],
      "surface": "paper"
    }
  },
  "binary-search": {
    "label": "Binary search",
    "title": "Binary Search in Code",
    "script": {
      "caption": "Binary Search Code",
      "durationMs": 50000,
      "ops": [
        {
          "kind": "morph",
          "shape": "rect",
          "x": 20,
          "y": 30,
          "toX": 70,
          "toY": 30,
          "text": "Concept",
          "toText": "Code",
          "color": "#15803d",
          "toColor": "#2563eb",
          "at": 0.2,
          "morphAt": 0.7
        },
        {
          "kind": "note",
          "text": "Transform concept into code",
          "x": 50,
          "y": 70,
          "color": "#d97706",
          "at": 0.8
        }
      ],
      "surface": "paper"
    }
  },
  "demorgan-v2": {
    "label": "De Morgan — composed (new)",
    "title": "Transformation of Expressions",
    "script": {
      "caption": "Transformation of Expressions",
      "durationMs": 48000,
      "ops": [
        {
          "kind": "morph",
          "shape": "rect",
          "x": 30,
          "y": 45,
          "w": 28,
          "h": 15,
          "toX": 70,
          "toY": 45,
          "text": "NOT(A AND B)",
          "toText": "NOT A OR NOT B",
          "color": "#2563eb",
          "toColor": "#15803d",
          "at": 0.22,
          "morphAt": 0.62
        },
        {
          "kind": "label",
          "text": "De Morgan's Transformation",
          "x": 50,
          "y": 16,
          "size": "lg",
          "color": "#1e293b",
          "at": 0.05
        },
        {
          "kind": "note",
          "text": "negation flips AND to OR",
          "x": 50,
          "y": 80,
          "color": "#d97706",
          "at": 0.7
        },
        {
          "kind": "circumscribe",
          "x": 70,
          "y": 45,
          "w": 34,
          "h": 22,
          "color": "#15803d",
          "at": 0.82,
          "endAt": 0.96
        }
      ],
      "surface": "paper"
    }
  }
};
