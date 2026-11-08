// On Aria's board a step's words are her sentence (step.s), not the step's own "say": the engine's
// checker and player still expect a "say", so each step is given its sentence's place before either runs.
export function withSentences(spec) {
  if (!spec || typeof spec !== "object" || !Array.isArray(spec.steps)) return spec;
  return { ...spec, steps: spec.steps.map((st) => (st && typeof st === "object" && st.say === undefined ? { ...st, say: `(Aria's sentence ${st.s})` } : st)) };
}
